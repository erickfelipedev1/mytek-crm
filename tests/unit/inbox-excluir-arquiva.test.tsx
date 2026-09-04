import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { ConversationHeader } from "@/components/inbox/ConversationHeader";

/**
 * "Excluir" no header do inbox = arquivar por baixo (`status: 'archived'`),
 * não hard-delete — LGPD/auditoria exigem que a conversa continue
 * rastreável. O botão é o pedido do usuário ("limpa essas conversas" — a
 * tela não tinha exclusão nenhuma); o efeito visível (some da Fila/Minhas/IA)
 * já vinha de graça porque essas três abas já excluem `archived` do filtro
 * (`CONVERSATION_QUEUE_STATUSES`/`exclude_finished`) — não é este teste que
 * prova isso, é `inbox-aba-minhas-sem-fechadas.test.ts` e o filtro da Fila.
 * Este teste prova só o botão: aparece, confirma, chama o PATCH certo, e
 * some quando a conversa já está arquivada (não faz sentido arquivar de novo).
 */

const archiveMutate = vi.fn();

vi.mock("@/hooks/inbox/useClaimConversation", () => ({
  useClaimConversation: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("@/hooks/inbox/useCloseConversation", () => ({
  useCloseConversation: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("@/hooks/inbox/useReleaseConversation", () => ({
  useReleaseConversation: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("@/hooks/inbox/useResumeAiAttendance", () => ({
  useResumeAiAttendance: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("@/hooks/inbox/useArchiveConversation", () => ({
  useArchiveConversation: () => ({ mutate: archiveMutate, isPending: false }),
}));
vi.mock("@/hooks/auth/AuthProvider", () => ({
  useAuth: () => ({ user: { id: "u-1" }, activeOrg: { orgId: "org-1", role: "manager" } }),
}));

function conversationWithStatus(status: string) {
  return {
    id: "cv-1",
    organization_id: "org-1",
    contact_id: "ct-1",
    status,
    assigned_to_user_id: null,
    assignee_kind: "ai",
    snooze_until: null,
    tags: [],
    contacts: { id: "ct-1", display_name: "Fulana", name: null, phone_number: "5511999" },
  } as unknown as React.ComponentProps<typeof ConversationHeader>["conversation"];
}

function renderHeader(status: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ConversationHeader conversation={conversationWithStatus(status)} />
    </QueryClientProvider>,
  );
}

describe("header do inbox — Excluir arquiva, não apaga", () => {
  afterEach(() => {
    archiveMutate.mockReset();
    vi.restoreAllMocks();
  });

  it("existe em conversa aberta, e em conversa já fechada — é lá que mora o lixo de teste", () => {
    renderHeader("open");
    expect(screen.getByText("Excluir")).toBeTruthy();
    renderHeader("closed");
    expect(screen.getAllByText("Excluir").length).toBeGreaterThan(0);
  });

  it("some em conversa já arquivada — arquivar de novo não é ação", () => {
    renderHeader("archived");
    expect(screen.queryByText("Excluir")).toBeNull();
  });

  it("pede confirmação e só chama o PATCH archived se confirmar", () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    renderHeader("open");
    fireEvent.click(screen.getByText("Excluir"));
    expect(confirmSpy).toHaveBeenCalled();
    expect(archiveMutate).not.toHaveBeenCalled();
  });

  it("confirmado, chama archive.mutate com o id da conversa (PATCH status=archived)", () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    renderHeader("open");
    fireEvent.click(screen.getByText("Excluir"));
    expect(archiveMutate).toHaveBeenCalledWith({ conversation_id: "cv-1" });
  });
});
