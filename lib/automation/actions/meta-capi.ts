/**
 * Ação `meta_capi` — manda o Meta Conversions API o evento do lead do
 * contexto (ex.: quando `lead.stage_changed` casa a condição "etapa =
 * Qualificado"), pra o algoritmo de anúncios aprender a buscar gente
 * parecida com quem qualificou.
 *
 * Credencial NÃO mora na regra (diferente de `call_webhook`): vem de
 * `tenant_integrations` (provider='meta_ads'), uma por organização — é
 * conexão de conta, não de automação, e várias regras reusam a mesma. `config`
 * só carrega o que MUDA por regra: `event_name` (default "Lead") e um
 * `pixel_id` opcional pra sobrepor o da conexão (multi-pixel).
 */
import { registerAction } from "@/lib/automation/actions";
import type { ActionCtx, ActionResultDetail } from "@/lib/automation/types";
import { decryptWebhookSecret } from "@/lib/webhooks/secrets";
import { buildCapiEventPayload } from "@/lib/meta/capi";

const GRAPH_API_VERSION = "v21.0";
const TIMEOUT_MS = 10_000;

export async function executeMetaCapi(
  ctx: ActionCtx,
  config: Record<string, unknown>,
  opts: { apiBase?: string } = {},
): Promise<ActionResultDetail> {
  const eventName =
    typeof config.event_name === "string" && config.event_name.trim() ? config.event_name.trim() : "Lead";

  const { data: integration, error } = await ctx.admin
    .from("tenant_integrations")
    .select("oauth_access_token_encrypted, store_metadata, status")
    .eq("organization_id", ctx.organizationId)
    .eq("provider", "meta_ads")
    .maybeSingle();
  if (error) return { type: "meta_capi", status: "failed", error: error.message };
  if (!integration || integration.status === "disconnected") {
    return { type: "meta_capi", status: "failed", error: "meta_ads_not_connected" };
  }

  const storeMetadata = (integration.store_metadata ?? {}) as Record<string, unknown>;
  const pixelId =
    typeof config.pixel_id === "string" && config.pixel_id
      ? config.pixel_id
      : (storeMetadata.pixel_id as string | undefined);
  if (!pixelId) return { type: "meta_capi", status: "failed", error: "missing_pixel_id" };

  const accessToken = await decryptWebhookSecret(ctx.admin, integration.oauth_access_token_encrypted as string);
  if (!accessToken) return { type: "meta_capi", status: "failed", error: "decrypt_failed" };

  const contact = ctx.context.contact as { email?: string | null; phone_number?: string | null } | undefined;
  const lead = ctx.context.lead as
    | { id?: string; value_cents?: number | null; currency?: string | null }
    | undefined;

  const payload = buildCapiEventPayload(eventName, {
    email: contact?.email,
    phone: contact?.phone_number,
    valueCents: lead?.value_cents,
    currency: lead?.currency,
    leadId: lead?.id,
  });

  // Sem e-mail nem telefone hasheável não há com quem a Meta casar o evento —
  // mandar mesmo assim só sujaria o dataset. `skipped`, não `failed`: a regra
  // casou certo, só não havia dado de identidade neste contato.
  // Non-null: buildCapiEventPayload sempre devolve exatamente 1 elemento.
  const event = payload.data[0]!;
  if (!event.user_data.em && !event.user_data.ph) {
    return { type: "meta_capi", status: "skipped", detail: { reason: "no_identifying_data" } };
  }

  const base = opts.apiBase ?? "https://graph.facebook.com";
  const url = `${base}/${GRAPH_API_VERSION}/${pixelId}/events?access_token=${encodeURIComponent(accessToken)}`;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const bodyText = await res.text();
    if (!res.ok) {
      return {
        type: "meta_capi",
        status: "failed",
        error: `http_${res.status}`,
        detail: { response_status: res.status, response_body: bodyText.slice(0, 500) },
      };
    }
    return { type: "meta_capi", status: "success", detail: { event_name: eventName, response_status: res.status } };
  } catch (err) {
    return { type: "meta_capi", status: "failed", error: err instanceof Error ? err.message : String(err) };
  }
}

registerAction({ type: "meta_capi", execute: (ctx, config) => executeMetaCapi(ctx, config) });
