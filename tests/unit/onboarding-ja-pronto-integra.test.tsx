import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { JaEstaPronto } from "@/app/onboarding/_components/JaEstaPronto";
import type { RetratoDaInstalacao } from "@/lib/instalacao/retrato";

/**
 * n8n/Make e Meta Ads são CAPACIDADE do software (todo build a partir da
 * v1.6.2 já traz), não passo de instalação — por isso aparecem sempre,
 * independente do estado real da instalação (retrato mínimo/vazio abaixo).
 */
const retratoMinimo = {
  empresa: { nome: null, aindaSemNomeProprio: true },
  inteligencia: {
    provedor: "",
    rotulo: "",
    origemDaChave: "nenhuma",
    chaveEmVerificacao: false,
    chaveDaOrg: null,
    modeloCurado: null,
    prontaParaPublicar: false,
  },
  whatsapp: { transporteApontado: false, canais: null },
  email: { configurado: false },
  funil: null,
} as unknown as RetratoDaInstalacao;

describe("JaEstaPronto — n8n e Meta Ads aparecem como capacidade do software", () => {
  it("mostra as duas linhas mesmo com a instalação toda incompleta", () => {
    render(<JaEstaPronto retrato={retratoMinimo} />);
    expect(screen.getByText(/n8n\/Make/)).toBeTruthy();
    expect(screen.getByText(/Meta Ads/)).toBeTruthy();
  });
});
