/**
 * POST /api/v1/webchat/[token]/session — abre (ou reabre) a conversa do visitante.
 *
 * Espelha o `webhooks/in/[token]`: o `path_token` resolve o tenant, o contato é
 * upsertado pela IDENTIDADE do envio e o lead nasce pelo handler compartilhado,
 * de modo que o motor de regras enxergue `lead.created` igual à captação de
 * formulário. A diferença é que aqui a conversa também nasce — é ela que o
 * inbox mostra e que o agente de IA atende.
 *
 * Identidade no webchat é o **e-mail** primeiro (o formulário do site pede
 * e-mail; telefone é opcional), invertendo a ordem do WhatsApp, onde o telefone
 * é a chave do canal. Os dois índices parciais (`uniq_contacts_org_email` e
 * `uniq_contacts_org_phone`) cobrem só a linha ativa, daí o `is_merged_into
 * null` e o mesmo tratamento de corrida (23505) do webhook.
 */
import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { ApiError } from "@/lib/api/types";
import { audit } from "@/lib/audit";
import { checkRateLimit } from "@/lib/ai/dispatcher/rate-limit";
import { logger } from "@/lib/logger";
import { createAdminClient } from "@/lib/supabase/admin";
import { createLeadHandler } from "@/app/api/v1/leads/_handler";
import type { CreateLeadInput } from "@/lib/schemas";
import { corsHeadersParaOrigem, resolveWebchatSource } from "@/lib/webchat/source";
import { signWebchatSession } from "@/lib/webchat/session-token";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface RouteCtx {
  params: Promise<{ token: string }>;
}

const RATE_LIMIT_PER_MIN = 20;

const BodySchema = z.object({
  name: z.string().trim().min(1).max(200),
  email: z.string().trim().email().max(200),
  // Telefone é opcional e tolerante: o widget manda o que a pessoa digitou. Um
  // número mal formatado NÃO derruba a abertura da conversa — ele é descartado
  // com o resto preservado, porque perder o contato inteiro por causa da máscara
  // do telefone é o pior desfecho possível aqui.
  phone: z.string().trim().max(40).optional(),
});

/** E.164 pt-BR; devolve null quando não dá para normalizar com segurança. */
function normalizarTelefoneBR(bruto: string | undefined): string | null {
  if (!bruto) return null;
  const digitos = bruto.replace(/\D/g, "");
  if (digitos.startsWith("55") && digitos.length >= 12 && digitos.length <= 13) {
    return `+${digitos}`;
  }
  if (digitos.length === 10 || digitos.length === 11) return `+55${digitos}`;
  return null;
}

export async function OPTIONS(req: NextRequest, ctx: RouteCtx): Promise<NextResponse> {
  const { token } = await ctx.params;
  const admin = createAdminClient();
  const source = await resolveWebchatSource(admin, token);
  const cors = source ? corsHeadersParaOrigem(req.headers.get("origin"), source.allowed_origins) : null;
  if (!cors) return new NextResponse(null, { status: 403 });
  return new NextResponse(null, { status: 204, headers: cors });
}

export async function POST(req: NextRequest, ctx: RouteCtx): Promise<NextResponse> {
  const requestId = randomUUID();
  const { token } = await ctx.params;
  if (!token || token.length < 8) {
    return fail("not_found", "unknown webchat token", 404, { requestId });
  }

  const admin = createAdminClient();
  const source = await resolveWebchatSource(admin, token);
  if (!source) return fail("not_found", "unknown webchat token", 404, { requestId });

  const cors = corsHeadersParaOrigem(req.headers.get("origin"), source.allowed_origins);
  if (!cors) {
    return fail("forbidden", "origin_not_allowed", 403, { requestId });
  }

  const rl = await checkRateLimit(`webchat_session:${token}`, RATE_LIMIT_PER_MIN, 60);
  if (!rl.allowed) {
    return fail("rate_limited", "Too many requests.", 429, {
      requestId,
      headers: { ...cors, "Retry-After": "60" },
    });
  }

  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await req.json());
  } catch {
    return fail("invalid_request", "nome e e-mail válidos são obrigatórios", 400, {
      requestId,
      headers: cors,
    });
  }

  const email = body.email.toLowerCase();
  const phone = normalizarTelefoneBR(body.phone);

  // ---- contato pela identidade (e-mail primeiro no webchat) ----
  const selecionarPorEmail = () =>
    admin
      .from("contacts")
      .select("id")
      .eq("organization_id", source.organization_id)
      .eq("email_normalized", email)
      .is("is_merged_into", null)
      .maybeSingle();

  let contactId: string | null = null;
  const { data: existente } = await selecionarPorEmail();
  if (existente) {
    contactId = existente.id as string;
  } else {
    const { data: criado, error: insertErr } = await admin
      .from("contacts")
      .insert({
        organization_id: source.organization_id,
        name: body.name,
        email: body.email,
        phone_number: phone,
        source: "webchat",
        source_metadata: { webhook_source_id: source.id, raw_phone: body.phone ?? null },
      })
      .select("id")
      .maybeSingle();

    if (insertErr) {
      // 23505 tem DUAS causas aqui: corrida no mesmo e-mail, ou o telefone
      // digitado já pertencer a outro contato ativo. Na segunda, insistir sem
      // telefone é o certo — o e-mail é a identidade desta conversa, e o
      // telefone é só um enfeite que não pode custar o atendimento.
      if (insertErr.code === "23505") {
        const { data: vencedor } = await selecionarPorEmail();
        if (vencedor) {
          contactId = vencedor.id as string;
        } else if (phone) {
          const { data: semTelefone } = await admin
            .from("contacts")
            .insert({
              organization_id: source.organization_id,
              name: body.name,
              email: body.email,
              source: "webchat",
              source_metadata: {
                webhook_source_id: source.id,
                raw_phone: body.phone ?? null,
                phone_conflict: true,
              },
            })
            .select("id")
            .maybeSingle();
          contactId = (semTelefone?.id as string | undefined) ?? null;
        }
      } else {
        logger.error("[webchat.session] contact insert failed", {
          webhookSourceId: source.id,
          organizationId: source.organization_id,
          errorCode: insertErr.code,
          errorMessage: insertErr.message,
        });
      }
    } else {
      contactId = (criado?.id as string | undefined) ?? null;
    }
  }

  if (!contactId) {
    return fail("internal_error", "não foi possível registrar o contato", 500, {
      requestId,
      headers: cors,
    });
  }

  // ---- conversa de webchat viva do contato ----
  // `uniq_conversations_org_contact_webchat` (0149) garante no BANCO que só
  // existe uma; aqui vai o fast-path, e o 23505 cobre a corrida.
  const selecionarConversa = () =>
    admin
      .from("conversations")
      .select("id")
      .eq("organization_id", source.organization_id)
      .eq("contact_id", contactId)
      .eq("channel", "webchat")
      .not("status", "in", '("closed","archived")')
      .maybeSingle();

  let conversationId: string | null = null;
  const { data: conversaViva } = await selecionarConversa();
  if (conversaViva) {
    conversationId = conversaViva.id as string;
  } else {
    const { data: novaConversa, error: convErr } = await admin
      .from("conversations")
      .insert({
        organization_id: source.organization_id,
        contact_id: contactId,
        channel: "webchat",
        channel_session_id: null,
        status: "open",
        metadata: { webhook_source_id: source.id, origin: req.headers.get("origin") },
      })
      .select("id")
      .maybeSingle();

    if (convErr) {
      if (convErr.code === "23505") {
        const { data: vencedora } = await selecionarConversa();
        conversationId = (vencedora?.id as string | undefined) ?? null;
      } else {
        logger.error("[webchat.session] conversation insert failed", {
          organizationId: source.organization_id,
          errorCode: convErr.code,
          errorMessage: convErr.message,
        });
      }
    } else {
      conversationId = (novaConversa?.id as string | undefined) ?? null;
    }
  }

  if (!conversationId) {
    return fail("internal_error", "não foi possível abrir a conversa", 500, {
      requestId,
      headers: cors,
    });
  }

  // ---- lead, pelo handler compartilhado ----
  // Idempotente por conversa: o `external_id` é a própria conversa, então
  // reabrir a sessão (F5, aba nova, token expirado) não cria lead repetido.
  const externalId = `webchat:${conversationId}`;
  const { data: leadExistente } = await admin
    .from("crm_leads")
    .select("id")
    .eq("organization_id", source.organization_id)
    .eq("source", "webchat")
    .eq("external_id", externalId)
    .maybeSingle();

  if (!leadExistente) {
    const leadInput: CreateLeadInput & {
      source_metadata?: Record<string, unknown>;
      external_id?: string;
    } = {
      pipeline_id: source.default_pipeline_id,
      stage_id: source.default_stage_id,
      title: body.name,
      contact_id: contactId,
      currency: "BRL",
      tags: [],
      source: "webchat",
      source_metadata: { webhook_source_id: source.id, conversation_id: conversationId },
      external_id: externalId,
    };
    try {
      await createLeadHandler(
        admin,
        {
          organization_id: source.organization_id,
          actor: { type: "webhook_source", id: source.id },
          requestId,
        },
        leadInput,
      );
    } catch (err) {
      // Lead é o registro comercial; a CONVERSA é o atendimento. Falhar aqui
      // não pode fechar o chat na cara de quem já está digitando — loga e segue.
      if (!(err instanceof ApiError)) throw err;
      logger.error("[webchat.session] lead creation failed", {
        organizationId: source.organization_id,
        conversationId,
        errorCode: err.code,
        errorMessage: err.message,
      });
    }
  }

  await admin
    .from("webhook_sources")
    .update({ last_received_at: new Date().toISOString() })
    .eq("id", source.id);

  await audit({
    action: "webchat.session_opened",
    organizationId: source.organization_id,
    resourceType: "conversation",
    resourceId: conversationId,
    requestId,
    metadata: { webhook_source_id: source.id },
  });

  const sessionToken = signWebchatSession({
    conversation_id: conversationId,
    contact_id: contactId,
    organization_id: source.organization_id,
    source_token: token,
  });

  return ok({ session_token: sessionToken, conversation_id: conversationId }, {
    requestId,
    headers: cors,
  });
}
