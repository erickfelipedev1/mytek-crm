/**
 * GET  /api/v1/webhooks/meta/leadgen — handshake de verificação da Callback
 *   URL (Meta manda `hub.mode=subscribe&hub.verify_token=...&hub.challenge=...`
 *   uma vez, ao configurar o webhook no painel do App).
 * POST /api/v1/webhooks/meta/leadgen — evento `leadgen` (alguém preencheu o
 *   formulário nativo do Facebook/Instagram). O corpo só traz o ID do lead —
 *   os dados de fato vêm de uma segunda chamada à Graph API.
 *
 * Diferente do webhook genérico (`webhooks/in/[token]`), esta URL é ÚNICA por
 * instalação (é a Callback URL cadastrada UMA vez no App Meta, que pode ter
 * várias Páginas inscritas) — não há path_token por organização. A
 * organização é resolvida pelo `page_id` que vem em `entry[].id`, comparado
 * contra `tenant_integrations.store_metadata->>'page_id'`.
 *
 * Sempre responde 200 (mesmo quando uma entry falha) — é o contrato da Meta:
 * uma resposta != 2xx acumula falha e, depois de falhas demais, a Meta
 * DESLIGA a inscrição do webhook sozinha. Falha de UMA entry vira log/audit,
 * nunca 4xx/5xx pro conjunto — o reenvio da Meta reprocessaria as OUTRAS
 * entries também, e idempotência (external_id=leadgen_id) já cobre o reenvio
 * da mesma entry.
 */
import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";

import { audit } from "@/lib/audit";
import { logger } from "@/lib/logger";
import { env } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import { createLeadHandler } from "@/app/api/v1/leads/_handler";
import { decryptWebhookSecret } from "@/lib/webhooks/secrets";
import {
  extractLeadgenEvents,
  verifyMetaSignature,
  mapLeadgenFieldData,
  type MetaFieldDatum,
  type MetaWebhookPayload,
} from "@/lib/meta/leadgen";
import { ApiError } from "@/lib/api/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const GRAPH_API_VERSION = "v21.0";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const url = new URL(req.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");

  // Fail-closed: sem META_WEBHOOK_VERIFY_TOKEN configurado (instalação que
  // não usa Lead Ads), qualquer tentativa de assinatura é recusada — nunca
  // aceita "sem token configurado == aceita qualquer coisa".
  if (mode === "subscribe" && token && env.META_WEBHOOK_VERIFY_TOKEN && token === env.META_WEBHOOK_VERIFY_TOKEN) {
    return new NextResponse(challenge ?? "", { status: 200 });
  }
  return new NextResponse("forbidden", { status: 403 });
}

interface MetaIntegrationRow {
  id: string;
  organization_id: string;
  oauth_access_token_encrypted: string;
  webhook_secret_encrypted: string;
  store_metadata: Record<string, unknown>;
}

/**
 * A Meta assina o corpo INTEIRO (todas as entries juntas) com o App Secret do
 * App — não há um secret "por Página" na assinatura. Como o corpo pode trazer
 * Páginas de organizações diferentes (agência com um App só, várias contas),
 * resolvemos a organização pelo `page_id` primeiro e então validamos a
 * assinatura com O SECRET DAQUELA org — se ela não bater, a entry é
 * descartada sem criar nada, mas as outras entries (de outra org, com outro
 * secret) seguem sendo avaliadas independentemente.
 *
 * Busca todas as linhas (não filtra por jsonb no Postgres): em instalação
 * self-host o número de conexões Meta Ads é pequeno (poucas dezenas no
 * limite), então o filtro em memória é mais simples que apostar na sintaxe
 * exata de path-filter do PostgREST para `store_metadata->>page_id`.
 */
async function findOrgByPageId(
  admin: ReturnType<typeof createAdminClient>,
  pageId: string,
): Promise<MetaIntegrationRow | null> {
  const { data } = await admin
    .from("tenant_integrations")
    .select("id, organization_id, oauth_access_token_encrypted, webhook_secret_encrypted, store_metadata, status")
    .eq("provider", "meta_ads");
  const rows = (data ?? []) as Array<MetaIntegrationRow & { status: string }>;
  const match = rows.find((r) => r.status !== "disconnected" && (r.store_metadata as Record<string, unknown>)?.page_id === pageId);
  return match ?? null;
}

async function fetchLeadFieldData(leadgenId: string, accessToken: string): Promise<MetaFieldDatum[]> {
  const url = `https://graph.facebook.com/${GRAPH_API_VERSION}/${leadgenId}?fields=field_data&access_token=${encodeURIComponent(accessToken)}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) {
    throw new Error(`graph_api_${res.status}`);
  }
  const json = (await res.json()) as { field_data?: MetaFieldDatum[] };
  return json.field_data ?? [];
}

/** Upsert simples por telefone/e-mail — espelha o padrão de `webhooks/in/[token]`, condensado. */
async function upsertContact(
  admin: ReturnType<typeof createAdminClient>,
  organizationId: string,
  name: string | null,
  phone: string | null,
  email: string | null,
): Promise<string | undefined> {
  if (!phone && !email) return undefined;

  const findActive = (column: "phone_number" | "email_normalized", value: string) =>
    admin
      .from("contacts")
      .select("id")
      .eq("organization_id", organizationId)
      .eq(column, value)
      .is("is_merged_into", null)
      .maybeSingle();

  if (phone) {
    const { data: byPhone } = await findActive("phone_number", phone);
    if (byPhone) return byPhone.id as string;
  }
  if (email) {
    const { data: byEmail } = await findActive("email_normalized", email.trim().toLowerCase());
    if (byEmail) return byEmail.id as string;
  }

  const { data: created, error: insertErr } = await admin
    .from("contacts")
    .insert({
      organization_id: organizationId,
      name: name ?? phone ?? email,
      phone_number: phone,
      email,
      source: "meta_leadgen",
    })
    .select("id")
    .maybeSingle();
  if (!insertErr) return (created?.id as string | undefined) ?? undefined;

  // Corrida (23505): outra requisição criou o mesmo contato entre o select e o
  // insert — re-seleciona o vencedor em vez de falhar (mesmo precedente do
  // webhook genérico).
  if (insertErr.code === "23505") {
    if (phone) {
      const { data: winner } = await findActive("phone_number", phone);
      if (winner) return winner.id as string;
    }
    if (email) {
      const { data: winner } = await findActive("email_normalized", email.trim().toLowerCase());
      if (winner) return winner.id as string;
    }
  }
  logger.error("[webhooks.meta_leadgen] contact insert failed", { organizationId, errorCode: insertErr.code });
  return undefined;
}

async function processEntry(
  admin: ReturnType<typeof createAdminClient>,
  requestId: string,
  pageId: string,
  value: { leadgen_id?: string; form_id?: string; ad_id?: string; campaign_id?: string },
  rawBody: string,
  signatureHeader: string | null,
): Promise<void> {
  const leadgenId = value.leadgen_id;
  if (!leadgenId) return;

  const org = await findOrgByPageId(admin, pageId);
  if (!org) {
    await audit({
      action: "meta_ads.leadgen_org_unresolved",
      requestId,
      metadata: { page_id: pageId, leadgen_id: leadgenId },
    });
    return;
  }

  const appSecret = await decryptWebhookSecret(admin, org.webhook_secret_encrypted);
  if (appSecret && !verifyMetaSignature(rawBody, signatureHeader, appSecret)) {
    await audit({
      action: "meta_ads.leadgen_invalid_signature",
      organizationId: org.organization_id,
      resourceType: "tenant_integration",
      resourceId: org.id,
      requestId,
    });
    return;
  }

  const pipelineId = org.store_metadata.default_pipeline_id as string | undefined;
  const stageId = org.store_metadata.default_stage_id as string | undefined;
  if (!pipelineId || !stageId) {
    logger.error("[webhooks.meta_leadgen] conexão sem pipeline/etapa padrão", { organizationId: org.organization_id });
    return;
  }

  const accessToken = await decryptWebhookSecret(admin, org.oauth_access_token_encrypted);
  if (!accessToken) {
    logger.error("[webhooks.meta_leadgen] decrypt do access token falhou", { organizationId: org.organization_id });
    return;
  }

  let fieldData: MetaFieldDatum[];
  try {
    fieldData = await fetchLeadFieldData(leadgenId, accessToken);
  } catch (err) {
    logger.error("[webhooks.meta_leadgen] Graph API falhou", {
      organizationId: org.organization_id,
      error: err instanceof Error ? err.message : String(err),
    });
    return;
  }

  const mapped = mapLeadgenFieldData(fieldData);
  const contactId = await upsertContact(admin, org.organization_id, mapped.name, mapped.phone, mapped.email);

  try {
    const lead = await createLeadHandler(
      admin,
      { organization_id: org.organization_id, actor: { type: "webhook_source", id: org.id }, requestId },
      {
        pipeline_id: pipelineId,
        stage_id: stageId,
        title: mapped.name ?? mapped.phone ?? mapped.email ?? "Lead do Facebook/Instagram",
        contact_id: contactId,
        currency: "BRL",
        tags: [],
        source: "meta_leadgen",
        custom_fields: mapped.custom_fields,
        source_metadata: { form_id: value.form_id, ad_id: value.ad_id, campaign_id: value.campaign_id },
        external_id: leadgenId,
      },
    );
    await audit({
      action: "meta_ads.leadgen_received",
      organizationId: org.organization_id,
      resourceType: "crm_lead",
      resourceId: String(lead.id),
      requestId,
      metadata: { leadgen_id: leadgenId, form_id: value.form_id ?? null },
    });
  } catch (err) {
    // uniq_crm_leads_org_source_external: reenvio do mesmo leadgen_id — não é
    // erro, é o contrato de idempotência funcionando.
    if (err instanceof ApiError && err.message?.includes("uniq_crm_leads_org_source_external")) return;
    logger.error("[webhooks.meta_leadgen] createLeadHandler falhou", {
      organizationId: org.organization_id,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const requestId = randomUUID();
  const rawBody = await req.text();
  const signatureHeader = req.headers.get("x-hub-signature-256");

  let payload: MetaWebhookPayload;
  try {
    payload = rawBody ? (JSON.parse(rawBody) as MetaWebhookPayload) : {};
  } catch {
    // Corpo ilegível: nada a processar, mas ainda 200 — não é isto que deve
    // levar a Meta a desligar a inscrição.
    return NextResponse.json({ received: true }, { status: 200 });
  }

  const admin = createAdminClient();
  const events = extractLeadgenEvents(payload);
  for (const evt of events) {
    await processEntry(admin, requestId, evt.pageId, evt.value, rawBody, signatureHeader);
  }

  return NextResponse.json({ received: true }, { status: 200 });
}
