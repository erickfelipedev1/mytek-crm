/**
 * Resolução da fonte de webchat e política de origem (CORS).
 *
 * O `path_token` da URL é a fonte confiável do tenant — nunca o body (doutrina
 * de multi-tenancy). É o mesmo contrato do `webhooks/in/[token]`, e por isso o
 * webchat reusa `webhook_sources`, agora com `kind = 'webchat'`.
 *
 * **Origem é gate, não enfeite.** Estas rotas são públicas e chamadas por
 * browser: sem checar `Origin` contra a lista declarada, qualquer site abriria
 * conversa no CRM de outra empresa usando o token que está no HTML dela. Por
 * isso `allowed_origins` vazio bloqueia tudo em vez de liberar tudo — o default
 * de uma fonte `form` que nunca pensou em navegador tem de ser o seguro.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export interface WebchatSource {
  id: string;
  organization_id: string;
  default_pipeline_id: string;
  default_stage_id: string;
  allowed_origins: string[];
  is_active: boolean;
}

export const WEBCHAT_SOURCE_COLUMNS =
  "id, organization_id, default_pipeline_id, default_stage_id, allowed_origins, is_active, kind";

export async function resolveWebchatSource(
  admin: SupabaseClient,
  pathToken: string,
): Promise<WebchatSource | null> {
  const { data, error } = await admin
    .from("webhook_sources")
    .select(WEBCHAT_SOURCE_COLUMNS)
    .eq("path_token", pathToken)
    .eq("kind", "webchat")
    .maybeSingle();

  if (error || !data || data.is_active !== true) return null;
  return {
    id: data.id as string,
    organization_id: data.organization_id as string,
    default_pipeline_id: data.default_pipeline_id as string,
    default_stage_id: data.default_stage_id as string,
    allowed_origins: (data.allowed_origins as string[] | null) ?? [],
    is_active: true,
  };
}

/**
 * Devolve os headers de CORS quando a origem é autorizada, ou `null` quando
 * não é. `null` faz a rota recusar — devolver a resposta sem os headers
 * deixaria o browser barrar a leitura mas o efeito colateral já teria
 * acontecido no servidor.
 */
export function corsHeadersParaOrigem(
  origin: string | null,
  allowed: string[],
): Record<string, string> | null {
  if (!origin || allowed.length === 0) return null;
  if (!allowed.includes(origin)) return null;
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Webchat-Session",
    "Access-Control-Max-Age": "86400",
    // A resposta varia por origem; sem isto um cache intermediário serviria a
    // um site o header liberado para outro.
    Vary: "Origin",
  };
}
