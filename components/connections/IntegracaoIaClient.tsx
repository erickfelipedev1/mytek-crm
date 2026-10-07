"use client";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  useApiTokens,
  useCreateApiToken,
  useRevokeApiToken,
  type CreatedApiToken,
} from "@/hooks/team/useApiTokens";
import { copyToClipboard } from "@/lib/clipboard";

/**
 * Integração com IA — a pessoa conecta a PRÓPRIA IA (Claude Desktop, Claude
 * Code…) ao CRM via MCP, e passa a pedir "quais leads entraram hoje" ou "move
 * esse lead de etapa" direto na conversa com ela.
 *
 * ─── Por que isto vive em Conexões ─────────────────────────────────────────
 * O servidor MCP (`/api/mcp`) e os tokens (`/api/v1/settings/api-tokens`) já
 * existiam, mas a única porta era Configurações › Tokens de API: uma tabela de
 * escopos crus (`mcp:read`, `role:manager`…) que quem não é desenvolvedor não
 * sabe montar. Aqui o operador escolhe o que a IA pode fazer em uma frase, gera
 * o token e recebe o comando de conexão já pronto.
 *
 * ─── Dois níveis, e o padrão é o mais seguro ───────────────────────────────
 * "Só consultar" emite `mcp:read`. "Consultar e agir" emite também `mcp:write` +
 * `role:manager` (sem o papel, as ferramentas de criar lead e atribuir conversa
 * respondem "Role 'agent' insufficient" — ver lib/mcp/auth.ts). Agir inclui
 * mexer em lead e mandar mensagem para cliente de verdade, então não nasce
 * marcado: quem quer escolhe.
 *
 * ChatGPT fica de fora de propósito: ele só conecta por OAuth, e o `/api/mcp`
 * autentica por Bearer. Prometer o passo-a-passo aqui seria entregar uma tela
 * que não funciona.
 */
type Nivel = "ler" | "agir";

const ESCOPOS_POR_NIVEL: Record<Nivel, string[]> = {
  ler: ["mcp:read"],
  agir: ["mcp:read", "mcp:write", "role:manager"],
};

function formatarData(iso: string | null): string {
  return iso ? new Date(iso).toLocaleDateString("pt-BR") : "—";
}

export function IntegracaoIaClient() {
  const { data, isLoading } = useApiTokens();
  const create = useCreateApiToken();
  const revoke = useRevokeApiToken();

  const [nome, setNome] = useState("");
  const [nivel, setNivel] = useState<Nivel>("ler");
  const [criado, setCriado] = useState<CreatedApiToken | null>(null);

  const tokens = data?.data ?? [];
  const urlDoServidor =
    typeof window !== "undefined" ? `${window.location.origin}/api/mcp` : "/api/mcp";

  const copiar = (texto: string, aviso: string): void => {
    void copyToClipboard(texto).then((ok) => {
      if (ok) toast.success(aviso);
      else toast.error("Não foi possível copiar — selecione o texto na tela.");
    });
  };

  const gerar = async (): Promise<void> => {
    try {
      const res = await create.mutateAsync({
        name: nome.trim().length >= 2 ? nome.trim() : "Minha IA",
        scopes: ESCOPOS_POR_NIVEL[nivel],
      });
      setCriado(res.data);
      setNome("");
    } catch {
      /* o hook já mostra o erro da API */
    }
  };

  const revogar = async (id: string): Promise<void> => {
    const ok = window.confirm(
      "Revogar esse token? A IA conectada com ele para de funcionar na hora — não dá pra desfazer.",
    );
    if (!ok) return;
    await revoke.mutateAsync(id);
    toast.success("Token revogado.");
  };

  const comandoClaudeCode = criado
    ? `claude mcp add --transport http mytek-crm ${urlDoServidor} --header "Authorization: Bearer ${criado.plaintext}"`
    : "";

  return (
    <div className="flex flex-col gap-6">
      <p className="text-sm text-muted-foreground">
        Conecte sua própria IA (Claude Desktop, Claude Code…) ao CRM. Depois de conectada, você
        pode pedir coisas como “quais leads entraram hoje” e ela consulta o sistema de verdade, em
        nome da sua organização.
      </p>

      <Card className="flex flex-col gap-3 p-5">
        <h2 className="text-sm font-semibold">Gerar novo token</h2>
        <p className="text-xs text-muted-foreground">
          Dá pra ter mais de um (ex.: um pro Claude Desktop, outro pro Claude Code) — cada um pode
          ser revogado sem afetar os outros.
        </p>

        <div className="flex flex-col gap-2">
          <Label htmlFor="ia-nome">Nome pra identificar (opcional)</Label>
          <Input
            id="ia-nome"
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            placeholder="Ex.: Notebook"
            maxLength={100}
            className="max-w-xs"
          />
        </div>

        <div className="flex flex-col gap-2">
          <Label>O que essa IA pode fazer?</Label>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              aria-pressed={nivel === "ler"}
              onClick={() => setNivel("ler")}
              className={`rounded-md border px-3 py-2 text-left text-xs ${
                nivel === "ler" ? "border-primary bg-primary/10" : "border-border"
              }`}
            >
              <strong className="block text-sm">Só consultar</strong>
              Ler leads, contatos e conversas. Não altera nada.
            </button>
            <button
              type="button"
              aria-pressed={nivel === "agir"}
              onClick={() => setNivel("agir")}
              className={`rounded-md border px-3 py-2 text-left text-xs ${
                nivel === "agir" ? "border-primary bg-primary/10" : "border-border"
              }`}
            >
              <strong className="block text-sm">Consultar e agir</strong>
              Também criar lead, atribuir conversa e enviar mensagem.
            </button>
          </div>
        </div>

        <div>
          <Button onClick={() => void gerar()} disabled={create.isPending}>
            {create.isPending ? "Gerando…" : "Gerar token"}
          </Button>
        </div>
      </Card>

      {criado ? (
        <Card className="flex flex-col gap-3 border-green-600/30 bg-green-600/5 p-5">
          <p className="text-sm font-semibold">
            Token criado! Copie agora — ele não aparece de novo depois que você sair dessa tela.
          </p>
          <div className="flex items-center gap-2">
            <code className="flex-1 break-all rounded-md border bg-background px-3 py-2 text-xs">
              {criado.plaintext}
            </code>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => copiar(criado.plaintext, "Token copiado.")}
            >
              Copiar
            </Button>
          </div>

          <div className="flex flex-col gap-2 text-xs text-muted-foreground">
            <p className="font-medium text-foreground">Como conectar:</p>
            <p>
              <strong className="text-foreground">Endereço do servidor:</strong>{" "}
              <code className="rounded bg-muted px-1.5 py-0.5 text-foreground">
                {urlDoServidor}
              </code>
            </p>
            <div>
              <p>
                <strong className="text-foreground">Claude Code:</strong> no terminal, rode:
              </p>
              <div className="mt-1 flex items-start gap-2">
                <code className="flex-1 break-all rounded bg-muted px-1.5 py-1 text-foreground">
                  {comandoClaudeCode}
                </code>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => copiar(comandoClaudeCode, "Comando copiado.")}
                >
                  Copiar
                </Button>
              </div>
            </div>
            <p>
              <strong className="text-foreground">Claude Desktop:</strong> em Configurações →
              Conectores → Adicionar conector personalizado, cole o endereço acima e, em
              cabeçalhos (headers), adicione{" "}
              <code className="rounded bg-muted px-1.5 py-0.5 text-foreground">Authorization</code>{" "}
              com o valor{" "}
              <code className="break-all rounded bg-muted px-1.5 py-0.5 text-foreground">
                Bearer {criado.plaintext}
              </code>
              .
            </p>
          </div>

          <div>
            <Button type="button" variant="ghost" size="sm" onClick={() => setCriado(null)}>
              Já copiei, fechar
            </Button>
          </div>
        </Card>
      ) : null}

      <div className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold">Seus tokens</h2>
        {isLoading ? (
          <p className="text-xs text-muted-foreground">Carregando…</p>
        ) : tokens.length === 0 ? (
          <p className="text-xs text-muted-foreground">Nenhum token gerado ainda.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {tokens.map((t) => {
              const ativo = !t.revoked_at;
              const agir = t.scopes.includes("mcp:write");
              return (
                <Card key={t.id} className="flex items-center justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <code className="text-xs">{t.prefix}…</code>
                      <span className="truncate text-xs text-muted-foreground">{t.name}</span>
                      <Badge variant={ativo ? "default" : "secondary"}>
                        {ativo ? "Ativo" : "Revogado"}
                      </Badge>
                      <Badge variant="secondary">{agir ? "Consulta e age" : "Só consulta"}</Badge>
                    </div>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">
                      Criado em {formatarData(t.created_at)}
                      {t.last_used_at ? ` · usado pela última vez em ${formatarData(t.last_used_at)}` : ""}
                    </p>
                  </div>
                  {ativo ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={revoke.isPending}
                      onClick={() => void revogar(t.id)}
                    >
                      Revogar
                    </Button>
                  ) : null}
                </Card>
              );
            })}
          </div>
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        Precisa de permissões mais finas (só contatos, só mensagens…)?{" "}
        <Link href="/app/settings/api-tokens" className="underline underline-offset-2">
          Tokens de API avançados
        </Link>
        .
      </p>
    </div>
  );
}
