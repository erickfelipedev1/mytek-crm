"use client";
import * as React from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  useCreateWebhookSource,
  usePipelines,
  usePipelineStages,
  type WebhookSourceRow,
} from "@/hooks/webhooks/useWebhookSources";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (source: WebhookSourceRow) => void;
}

/**
 * Origens digitadas viram lista: uma por linha, vírgula também aceita porque é
 * como as pessoas colam. A barra final some aqui em vez de virar erro — ela é o
 * engano mais comum e o mais silencioso (o header `Origin` nunca a traz, então
 * a origem gravada com barra jamais casaria e o chat não abriria em lugar
 * nenhum, sem nada na tela explicando por quê).
 */
function origensDoTexto(texto: string): string[] {
  return texto
    .split(/[\n,]/)
    .map((o) => o.trim().replace(/\/+$/, ""))
    .filter((o) => o.length > 0);
}

export function CreateSourceDialog({ open, onOpenChange, onCreated }: Props) {
  const [name, setName] = React.useState("");
  const [kind, setKind] = React.useState<"lead_capture" | "webchat">("lead_capture");
  const [origens, setOrigens] = React.useState("");
  const [pipelineId, setPipelineId] = React.useState<string>("");
  const [stageId, setStageId] = React.useState<string>("");
  const [redirectTo, setRedirectTo] = React.useState("");

  const { data: pipelinesRes, isLoading: pipelinesLoading } = usePipelines();
  const { data: boardRes, isLoading: stagesLoading } = usePipelineStages(pipelineId || null);
  const create = useCreateWebhookSource();

  const pipelines = pipelinesRes?.data ?? [];
  const stages = boardRes?.data?.stages ?? [];

  React.useEffect(() => {
    if (!open) {
      setName("");
      setKind("lead_capture");
      setOrigens("");
      setPipelineId("");
      setStageId("");
      setRedirectTo("");
    }
  }, [open]);

  React.useEffect(() => {
    setStageId("");
  }, [pipelineId]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pipelineId || !stageId) {
      toast.error("Escolha o funil e o estágio de entrada.");
      return;
    }
    const listaDeOrigens = origensDoTexto(origens);
    // Barrado aqui e não no servidor porque uma fonte de chat sem origem não
    // atende ninguém: ela seria criada, apareceria "ativa" na lista, e recusaria
    // toda tentativa de abrir conversa. Ativa e inútil é pior que recusada.
    if (kind === "webchat" && listaDeOrigens.length === 0) {
      toast.error("Diga em qual endereço o chat vai ficar. Sem isso ele não abre em site nenhum.");
      return;
    }
    try {
      const res = await create.mutateAsync({
        name,
        kind,
        allowed_origins: kind === "webchat" ? listaDeOrigens : undefined,
        default_pipeline_id: pipelineId,
        default_stage_id: stageId,
        redirect_to: kind === "webchat" ? undefined : redirectTo.trim() || undefined,
      });
      toast.success(
        kind === "webchat"
          ? "Chat criado. Copie o token e cole no site."
          : "Fonte criada. Agora é só conectar seu site.",
      );
      onOpenChange(false);
      onCreated(res.data);
    } catch {
      /* erro já mostrado pelo showApiError */
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Nova entrada de contatos</DialogTitle>
          <DialogDescription>
            {kind === "webchat"
              ? "O chat do seu site abre a conversa aqui dentro, no mesmo lugar onde você já atende."
              : "Dê um nome e diga em qual funil o contato deve entrar quando alguém preencher seu formulário."}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label>Tipo</Label>
            <Select
              value={kind}
              onValueChange={(v) => setKind(v as "lead_capture" | "webchat")}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="lead_capture">Formulário — vira contato e some</SelectItem>
                <SelectItem value="webchat">Chat no site — abre conversa</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {kind === "webchat"
                ? "Cada visitante que escrever vira uma conversa na sua caixa de entrada, e o que você responder aparece no site."
                : "Um envio vira um contato no funil. Não há troca de mensagens."}
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="src-name">Nome</Label>
            <Input
              id="src-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={
                kind === "webchat" ? "Chat do site" : "Landing page de Black Friday"
              }
              minLength={1}
              maxLength={120}
              required
            />
          </div>
          {kind === "webchat" && (
            <div className="space-y-2">
              <Label htmlFor="src-origins">Endereço do site</Label>
              <textarea
                id="src-origins"
                value={origens}
                onChange={(e) => setOrigens(e.target.value)}
                placeholder={"https://seusite.com.br\nhttps://www.seusite.com.br"}
                rows={3}
                className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
              />
              <p className="text-xs text-muted-foreground">
                Um por linha. Só esses endereços podem abrir o chat — é o que impede outro site
                de usar o seu. Se o seu site responde com e sem <code>www</code>, coloque os dois.
              </p>
            </div>
          )}
          <div className="space-y-2">
            <Label>Funil de entrada</Label>
            <Select value={pipelineId} onValueChange={setPipelineId} disabled={pipelinesLoading}>
              <SelectTrigger>
                <SelectValue placeholder="Escolha o funil" />
              </SelectTrigger>
              <SelectContent>
                {pipelines.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Estágio de entrada</Label>
            <Select
              value={stageId}
              onValueChange={setStageId}
              disabled={!pipelineId || stagesLoading}
            >
              <SelectTrigger>
                <SelectValue
                  placeholder={pipelineId ? "Escolha o estágio" : "Escolha o funil primeiro"}
                />
              </SelectTrigger>
              <SelectContent>
                {stages.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {/* Não existe "página de obrigado" em chat: ninguém sai da página — a
              conversa continua ali mesmo. */}
          {kind !== "webchat" && (
            <div className="space-y-2">
              <Label htmlFor="src-redirect">URL de obrigado (opcional)</Label>
              <Input
                id="src-redirect"
                type="url"
                value={redirectTo}
                onChange={(e) => setRedirectTo(e.target.value)}
                placeholder="https://seusite.com/obrigado"
              />
              <p className="text-xs text-muted-foreground">
                Para onde enviar a pessoa depois que ela preencher seu formulário.
              </p>
            </div>
          )}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={create.isPending}>
              Criar fonte
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
