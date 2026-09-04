"use client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api/client";
import { showApiError } from "@/components/feedback/ApiErrorToast";
import type { Conversation } from "@/lib/types/messaging";

interface ArchiveArgs {
  conversation_id: string;
}

/**
 * "Excluir" na tela = arquivar por baixo (`status: 'archived'`, PATCH que já
 * existia). Sem hard-delete: LGPD/auditoria exigem que a conversa continue
 * rastreável — arquivar já basta para o efeito que o usuário pede ("some da
 * fila"), porque `CONVERSATION_QUEUE_STATUSES`/`CONVERSATION_TERMINAL_STATUSES`
 * já excluem `archived` de toda visão ativa do inbox.
 */
export function useArchiveConversation() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (args: ArchiveArgs) =>
      apiClient.patch<{ data: Conversation }>(`/api/v1/conversations/${args.conversation_id}`, {
        status: "archived",
      }),
    onError: (err, args) => {
      qc.invalidateQueries({ queryKey: ["conversations"] });
      qc.invalidateQueries({ queryKey: ["conversation", args.conversation_id] });
      showApiError(err);
    },
    onSuccess: (_data, args) => {
      qc.invalidateQueries({ queryKey: ["conversations"] });
      qc.invalidateQueries({ queryKey: ["conversation", args.conversation_id] });
    },
  });
}
