import { describe, expect, it } from "vitest";

import { isPublicPath } from "@/lib/auth/public-paths";

/**
 * O canal `webchat` é chamado pelo NAVEGADOR DO VISITANTE, que não tem sessão do
 * CRM. Se as rotas dele não estiverem na lista pública, o `proxy.ts` devolve 401
 * antes de a rota rodar.
 *
 * Este teste existe porque isso aconteceu: a feature foi implementada, mergeada,
 * versionada e instalada em produção com as rotas inalcançáveis. O sintoma não
 * apontava para cá — o widget dizia "não consegui abrir a conversa", e as três
 * origens testadas (duas legítimas e uma forjada) recebiam **401 idêntico**, o
 * que escondia inclusive o gate de origem: um 403 seletivo virava 401 uniforme,
 * e "origem recusada" ficava indistinguível de "rota não existe".
 */
describe("as rotas do webchat são alcançáveis sem sessão", () => {
  it("a abertura de conversa e a troca de mensagens são públicas", () => {
    expect(isPublicPath("/api/v1/webchat/qualquer-token/session")).toBe(true);
    expect(isPublicPath("/api/v1/webchat/qualquer-token/messages")).toBe(true);
  });

  it("mas o resto da API v1 continua fechado (controle positivo)", () => {
    // Sem esta metade, um `isPublicPath` que devolvesse `true` para tudo — ou um
    // regex acidentalmente amplo como /^\/api\/v1\// — deixaria o teste acima
    // verde enquanto abre o CRM inteiro.
    expect(isPublicPath("/api/v1/leads")).toBe(false);
    expect(isPublicPath("/api/v1/conversations")).toBe(false);
    expect(isPublicPath("/api/v1/contacts")).toBe(false);
  });

  it("o prefixo não vaza para caminhos vizinhos", () => {
    // `webchat` não pode abrir `webchat-admin` ou coisa parecida que venha depois.
    expect(isPublicPath("/api/v1/webchatadmin")).toBe(false);
    expect(isPublicPath("/api/v1/webchat")).toBe(false);
  });
});
