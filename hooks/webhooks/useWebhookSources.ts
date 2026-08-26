"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api/client";
import { showApiError } from "@/components/feedback/ApiErrorToast";
import type { Pipeline, Stage } from "@/lib/kanban/types";
import type { CreateWebhookSourceInput as CreateWebhookSourceSchemaInput } from "@/lib/schemas";

export interface WebhookSourceRow {
  id: string;
  organization_id: string;
  name: string;
  path_token: string;
  is_active: boolean;
  /** `lead_capture` (formulário) ou `webchat` (chat de site) — migration 0176. */
  kind: string;
  /** Origens autorizadas a abrir chat. Vazio recusa todas. Só usado em `webchat`. */
  allowed_origins: string[];
  last_received_at: string | null;
  default_pipeline_id: string;
  default_stage_id: string;
  redirect_to: string | null;
  field_map: Record<string, unknown>;
  has_secret: boolean;
  created_at: string;
  updated_at: string;
  /** Quem mexeu por último (migration 0101). `null` nas fontes anteriores a ela. */
  last_change_actor_kind: string | null;
  last_change_at: string | null;
}

export interface WebhookSourceEvent {
  id: string;
  created_at: string;
  valid_signature: boolean | null;
  payload_parsed: unknown;
  status: string;
}

/**
 * O contrato de criação vem do MESMO Zod que a rota valida.
 *
 * Antes havia uma cópia manual aqui, com quatro campos. Ela não estava errada —
 * estava DESATUALIZADA, que é pior: o schema já aceitava `field_map` e `secret`,
 * e a tela não tinha como saber que existiam. Ao acrescentar `kind` e
 * `allowed_origins` ao schema, a cópia mandaria o servidor recusar um campo que
 * o TypeScript da tela nem deixava escrever. Derivar do schema faz o compilador
 * ser quem cobra o alinhamento.
 */
export type CreateWebhookSourceInput = CreateWebhookSourceSchemaInput;

const SOURCES_KEY = ["webhook-sources"];

export function useWebhookSources() {
  return useQuery({
    queryKey: SOURCES_KEY,
    queryFn: async () => apiClient.get<{ data: WebhookSourceRow[] }>("/api/v1/webhook-sources"),
    staleTime: 15_000,
  });
}

export function useCreateWebhookSource() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateWebhookSourceInput) =>
      apiClient.post<{ data: WebhookSourceRow }>("/api/v1/webhook-sources", input),
    onError: showApiError,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: SOURCES_KEY });
    },
  });
}

/**
 * Campos que a tela edita. A lista é explícita, e não `Partial<WebhookSourceRow>`,
 * para o PATCH não virar porta de entrada de coluna que a tela não deveria
 * mexer (`path_token`, `organization_id`, a autoria da última mudança).
 */
type PatchDeFonte = {
  is_active?: boolean;
  allowed_origins?: string[];
  name?: string;
};

export function useUpdateWebhookSource() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...patch }: { id: string } & PatchDeFonte) =>
      apiClient.patch<{ data: WebhookSourceRow }>(`/api/v1/webhook-sources/${id}`, patch),
    onError: showApiError,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: SOURCES_KEY });
    },
  });
}

export function useDeleteWebhookSource() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => apiClient.delete(`/api/v1/webhook-sources/${id}`),
    onError: showApiError,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: SOURCES_KEY });
    },
  });
}

export function useWebhookSourceEvents(sourceId: string | null) {
  return useQuery({
    queryKey: ["webhook-source-events", sourceId],
    queryFn: async () =>
      apiClient.get<{ data: WebhookSourceEvent[] }>(
        `/api/v1/webhook-sources/${sourceId}/events?limit=20`,
      ),
    enabled: !!sourceId,
    refetchInterval: 5_000,
  });
}

export function usePipelines() {
  return useQuery({
    queryKey: ["pipelines"],
    queryFn: async () => apiClient.get<{ data: Pipeline[] }>("/api/v1/pipelines"),
    staleTime: 60_000,
  });
}

export function usePipelineStages(pipelineId: string | null) {
  return useQuery({
    queryKey: ["pipeline-stages", pipelineId],
    queryFn: async () =>
      apiClient.get<{ data: { stages: Stage[] } }>(`/api/v1/pipelines/${pipelineId}/board`),
    enabled: !!pipelineId,
    staleTime: 60_000,
  });
}
