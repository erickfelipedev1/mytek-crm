import type { SupabaseClient } from "@supabase/supabase-js";

import type { CredentialRow } from "@/hooks/ai/useCredentials";

/**
 * Dados que a lista de credenciais de IA precisa — compartilhados pela tela
 * própria (`/app/ai/credentials`) e pela aba "Inteligência artificial" de
 * Conexões. Duas telas mostrando a MESMA lista têm que ler da mesma fonte; com
 * a consulta copiada, a segunda a ser editada fica com colunas ou contagem de
 * uso diferentes da primeira, e o operador vê dois números para a mesma chave.
 *
 * Só colunas seguras: a view `ai_provider_credentials_safe` nunca expõe a chave.
 * O cliente recebido é o de SESSÃO (RLS por tenant); o `organization_id` vem de
 * `resolveActiveOrg`, nunca do body.
 */
const SAFE_COLUMNS =
  "id, organization_id, provider, label, api_key_last4, validated_at, validation_error, models_available, is_active, created_by, created_at, updated_at";

export interface CredenciaisDaTela {
  credentials: CredentialRow[];
  /** credential_id → quantos agentes ativos a referenciam como publicada. */
  usageMap: Record<string, number>;
}

type LinkedRow = {
  credential_id: string;
  ai_agents:
    | { archived_at: string | null; published_version_id: string | null }
    | { archived_at: string | null; published_version_id: string | null }[]
    | null;
};

export async function carregarCredenciaisDaTela(
  supabase: SupabaseClient,
  orgId: string,
): Promise<CredenciaisDaTela> {
  const { data } = await supabase
    .from("ai_provider_credentials_safe")
    .select(SAFE_COLUMNS)
    .eq("organization_id", orgId)
    .order("created_at", { ascending: false });

  const credentials = (data ?? []) as unknown as CredentialRow[];

  const usageMap: Record<string, number> = {};
  if (credentials.length > 0) {
    const { data: linked } = await supabase
      .from("ai_agent_versions")
      .select(
        "credential_id, ai_agents!ai_agent_versions_agent_id_fkey!inner(archived_at, published_version_id)",
      )
      .eq("organization_id", orgId)
      .in(
        "credential_id",
        credentials.map((c) => c.id),
      );

    const rows = (linked ?? []) as unknown as LinkedRow[];
    for (const row of rows) {
      const agent = Array.isArray(row.ai_agents) ? row.ai_agents[0] : row.ai_agents;
      if (!agent || agent.archived_at) continue;
      if (!agent.published_version_id) continue;
      // Aproximado: conta a credencial se ela está numa versão de agente não
      // arquivado. Mais conservador que o DELETE, mas suficiente para a UX.
      usageMap[row.credential_id] = (usageMap[row.credential_id] ?? 0) + 1;
    }
  }

  return { credentials, usageMap };
}
