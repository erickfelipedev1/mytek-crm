/**
 * GET    /api/v1/integrations/meta-ads — status da conexão (nunca devolve segredo).
 * POST   /api/v1/integrations/meta-ads — cria/atualiza a conexão (upsert por
 *   `organization_id, provider` — já UNIQUE, migration 0177).
 * DELETE /api/v1/integrations/meta-ads — desconecta (status='disconnected';
 *   NÃO apaga a linha — histórico de quando foi conectado/por quem fica).
 *
 * Não é fluxo OAuth (a Meta não oferece um pra Lead Ads/CAPI server-to-server
 * pensado pra este uso): o operador gera o access token e o app secret no
 * próprio Meta Business/Developers e cola aqui. Passo a passo em
 * `docs/integrations/meta-ads.md`.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { connectMetaAdsSchema } from "@/lib/schemas";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { encryptWebhookSecret } from "@/lib/webhooks/secrets";

export const dynamic = "force-dynamic";

const PROVIDER = "meta_ads";

export async function GET(): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("manager", { requestId, resource: "tenant_integrations" });
  if (!authz.ok) return authz.response;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("tenant_integrations")
    .select("status, status_reason, scopes, store_metadata, last_health_check_at, created_at, updated_at")
    .eq("organization_id", authz.org.orgId)
    .eq("provider", PROVIDER)
    .maybeSingle();
  if (error) return fail("internal_error", error.message, 500, { requestId });
  if (!data) return ok({ connected: false }, { requestId });

  const storeMetadata = (data.store_metadata ?? {}) as Record<string, unknown>;
  return ok(
    {
      connected: data.status !== "disconnected",
      status: data.status,
      status_reason: data.status_reason,
      scopes: data.scopes,
      page_id: storeMetadata.page_id ?? null,
      pixel_id: storeMetadata.pixel_id ?? null,
      default_pipeline_id: storeMetadata.default_pipeline_id ?? null,
      default_stage_id: storeMetadata.default_stage_id ?? null,
      last_health_check_at: data.last_health_check_at,
      created_at: data.created_at,
      updated_at: data.updated_at,
    },
    { requestId },
  );
}

export async function POST(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("manager", { requestId, resource: "tenant_integrations" });
  if (!authz.ok) return authz.response;
  const { user, org: activeOrg } = authz;

  let raw: unknown = {};
  try {
    raw = await req.json();
  } catch {
    raw = {};
  }
  const parsed = connectMetaAdsSchema.safeParse(raw);
  if (!parsed.success) {
    return fail("invalid_request", "Dados inválidos.", 400, { requestId, details: parsed.error.flatten() });
  }

  // Valida que pipeline/stage pertencem à org ANTES de gravar — evita
  // conexão "pronta" que sempre falha ao criar lead (stage de outro tenant).
  const supabase = await createClient();
  const { data: stage } = await supabase
    .from("crm_stages")
    .select("id, pipeline_id, organization_id")
    .eq("id", parsed.data.default_stage_id)
    .maybeSingle();
  if (!stage || stage.organization_id !== activeOrg.orgId || stage.pipeline_id !== parsed.data.default_pipeline_id) {
    return fail("invalid_request", "Pipeline/etapa padrão inválidos para esta organização.", 400, { requestId });
  }

  const admin = createAdminClient();
  const [accessTokenEnc, appSecretEnc] = await Promise.all([
    encryptWebhookSecret(admin, parsed.data.access_token),
    encryptWebhookSecret(admin, parsed.data.app_secret),
  ]);
  if (accessTokenEnc === null || appSecretEnc === null) {
    return fail(
      "encryption_unavailable",
      "Não foi possível guardar as credenciais com segurança. Configure NUVEMSHOP_OAUTH_ENCRYPTION_KEY (chave de cifra do banco) e tente de novo.",
      422,
      { requestId },
    );
  }

  const { data: upserted, error: upsertErr } = await admin
    .from("tenant_integrations")
    .upsert(
      {
        organization_id: activeOrg.orgId,
        provider: PROVIDER,
        oauth_access_token_encrypted: accessTokenEnc,
        webhook_secret_encrypted: appSecretEnc,
        scopes: ["leads_retrieval", "ads_management"],
        status: "healthy",
        status_reason: null,
        store_metadata: {
          page_id: parsed.data.page_id,
          pixel_id: parsed.data.pixel_id,
          default_pipeline_id: parsed.data.default_pipeline_id,
          default_stage_id: parsed.data.default_stage_id,
        },
      },
      { onConflict: "organization_id,provider" },
    )
    .select("id")
    .maybeSingle();
  if (upsertErr || !upserted) {
    return fail("internal_error", upsertErr?.message ?? "meta_ads_upsert_failed", 500, { requestId });
  }

  void audit({
    action: "meta_ads.connected",
    actorUserId: user.id,
    organizationId: activeOrg.orgId,
    resourceType: "tenant_integration",
    resourceId: upserted.id,
    requestId,
    metadata: { page_id: parsed.data.page_id, pixel_id: parsed.data.pixel_id },
  });

  return ok({ connected: true }, { requestId, status: 201 });
}

export async function DELETE(): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("manager", { requestId, resource: "tenant_integrations" });
  if (!authz.ok) return authz.response;
  const { user, org: activeOrg } = authz;

  const admin = createAdminClient();
  const { data: updated, error } = await admin
    .from("tenant_integrations")
    .update({ status: "disconnected", status_reason: "desconectado manualmente" })
    .eq("organization_id", activeOrg.orgId)
    .eq("provider", PROVIDER)
    .select("id")
    .maybeSingle();
  if (error) return fail("internal_error", error.message, 500, { requestId });
  if (!updated) return fail("not_found", "Nenhuma conexão Meta Ads encontrada.", 404, { requestId });

  void audit({
    action: "meta_ads.disconnected",
    actorUserId: user.id,
    organizationId: activeOrg.orgId,
    resourceType: "tenant_integration",
    resourceId: updated.id,
    requestId,
  });

  return ok({ connected: false }, { requestId });
}
