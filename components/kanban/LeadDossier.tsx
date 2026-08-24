"use client";
import { useRef } from "react";
import { Mail, Phone } from "lucide-react";

import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useLeadTimeline } from "@/hooks/leads/useLeadTimeline";
import { useContact } from "@/hooks/contacts/useContact";
import type { Lead } from "@/lib/types/leads";
import { LeadFieldsForm } from "./LeadFieldsForm";
import { ScoreSlot } from "./ScoreSlot";
import { LeadTimeline } from "./LeadTimeline";
import { OwnerBadge } from "./OwnerBadge";
import { resolveLeadOwner } from "@/lib/kanban/owner";

/** "segmento_atuacao" → "Segmento atuacao". Sem dicionário de rótulos por
 * campo: custom_fields é aberto por natureza (webhooks/integrações escrevem
 * chaves arbitrárias), então a única opção sem manutenção é derivar do nome. */
function humanizeFieldKey(key: string): string {
  const spaced = key.replace(/_/g, " ").trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  lead: Lead;
  pipelineId: string;
  stageName: string;
  ownerNames?: Map<string, string | null>;
}

function formatBRL(cents: number | null, currency: string | null): string {
  if (cents === null) return "—";
  try {
    return new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: currency ?? "BRL",
      maximumFractionDigits: 0,
    }).format(cents / 100);
  } catch {
    return `R$ ${(cents / 100).toFixed(0)}`;
  }
}

/**
 * O dossiê do negócio: cabeçalho vivo → timeline → campos.
 *
 * A ORDEM É a mudança em relação ao diálogo de edição: quem abre um lead quer
 * primeiro saber O QUE ACONTECEU, e só depois mexer. O formulário íntegro fica
 * por último, e o cabeçalho tem um atalho para ele — ordem preservada, custo de
 * rolagem resolvido.
 *
 * SALVAR NÃO FECHA. Quem edita precisa ver a atividade que acabou de gerar
 * entrar na timeline; fechar esconderia o registro justamente de quem o
 * produziu, e a funcionalidade que prova "sua ação fica registrada" provaria
 * isso para todo mundo menos para o autor.
 */
export function LeadDossier({
  open,
  onOpenChange,
  lead,
  pipelineId,
  stageName,
  ownerNames,
}: Props) {
  const campos = useRef<HTMLDivElement | null>(null);
  const timeline = useLeadTimeline(open ? lead.id : null, lead.contact_id);
  const contactQuery = useContact(open && lead.contact_id ? lead.contact_id : "");
  const contact = contactQuery.data?.data ?? null;
  const owner = resolveLeadOwner(lead, ownerNames);
  const score = lead.score ?? null;
  // empresa/segmento/momento têm campo próprio e editável no LeadFieldsForm
  // agora — mostrá-los de novo aqui, somente leitura, seria o mesmo dado
  // duas vezes na mesma tela.
  const CAMPOS_COM_INPUT_PROPRIO = new Set(["empresa", "segmento", "momento"]);
  const customFieldEntries = Object.entries(lead.custom_fields ?? {}).filter(
    ([key, value]) =>
      value !== null && value !== undefined && value !== "" && !CAMPOS_COM_INPUT_PROPRIO.has(key),
  );

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 overflow-y-auto sm:max-w-md"
        // Observável pelo mesmo motivo do board: "a assinatura morreu" e "nada
        // aconteceu" têm a mesma aparência, que é silêncio.
        data-realtime-status={timeline.realtimeStatus.toLowerCase()}
        // Observável como no board: "a entrega morreu" e "nada aconteceu"
        // têm a mesma aparência, e no dossiê a segunda é ainda mais crível —
        // negócio sem novidade é um estado normal.
        data-refetch-divergencias={timeline.seguranca.divergencias}
      >
        <SheetHeader className="pb-3">
          <SheetTitle className="text-base leading-6">{lead.title}</SheetTitle>
        </SheetHeader>

        {/* ① cabeçalho vivo */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-border pb-3 text-xs">
          <span className="font-medium tabular-nums text-text">
            {formatBRL(lead.value_cents, lead.currency)}
          </span>
          <span className="text-text-muted">{stageName}</span>
          <OwnerBadge
            ownerKind={owner.kind}
            ownerName={owner.name}
            agentVersion={owner.agentVersion}
          />
          {score && (
            // O MESMO componente do card, não uma cópia do medidor.
            // "Superfície nova herda as decisões da antiga" só vale como
            // mecanismo: herdar por cópia é como as duas listas do evidence —
            // funciona hoje e diverge no mês em que alguém mudar um dos dois.
            // De brinde, o rótulo honesto da âncora ("registro que sustenta",
            // nunca "momento da conversa") vem junto, sem eu reescrever nada.
            <ScoreSlot
              probability={score.probability}
              band={score.band}
              reason={score.reason}
              factors={score.factors.slice(0, 3)}
            />
          )}

          <button
            type="button"
            onClick={() => campos.current?.scrollIntoView({ behavior: "smooth", block: "start" })}
            className="ml-auto text-text-muted underline-offset-2 hover:text-text hover:underline"
          >
            Editar campos
          </button>
        </div>

        {/* O score NÃO aparece na timeline: recálculo é telemetria e não emite
            atividade (silêncio para telemetria, pulso para mudança de estado).
            Sem esta linha, quem visse o número mudando no cabeçalho e nunca na
            timeline concluiria que a timeline está incompleta. */}
        {score?.at && (
          <p className="pt-2 text-[11px] text-text-muted">
            Probabilidade recalculada automaticamente · {new Date(score.at).toLocaleString("pt-BR")}
          </p>
        )}

        {/* Contato — vive na tabela `contacts` (DIRC: Integrar, não Duplicar),
            então busca à parte por contact_id em vez de esperar o board já
            trazer telefone/e-mail embutidos no lead. */}
        {lead.contact_id && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-border py-3 text-xs text-text-muted">
            {contactQuery.isLoading && <span>Carregando contato…</span>}
            {contact?.phone_number && (
              <span className="inline-flex items-center gap-1.5">
                <Phone size={13} /> {contact.phone_number}
              </span>
            )}
            {contact?.email && (
              <span className="inline-flex items-center gap-1.5">
                <Mail size={13} /> {contact.email}
              </span>
            )}
            {!contactQuery.isLoading && contact && !contact.phone_number && !contact.email && (
              <span>Contato sem telefone/e-mail cadastrado.</span>
            )}
          </div>
        )}

        {/* ② timeline */}
        <section className="flex-1 py-3">
          <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-text-muted">
            Linha do tempo
          </h3>
          <LeadTimeline
            itens={timeline.itens}
            chegouAoVivo={timeline.chegouAoVivo}
            isLoading={timeline.isLoading}
            isError={timeline.isError}
          />
        </section>

        {/* ③ campos, por último */}
        <div ref={campos} className="border-t border-border pt-3">
          <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-text-muted">
            Dados do negócio
          </h3>
          <LeadFieldsForm lead={lead} pipelineId={pipelineId} />

          {/* Campos adicionais: dado que já chegou (webhook, importação) mas
              não tem schema declarado em pipeline.settings.fields — por isso
              é exibição genérica e somente leitura, não um formulário editável. */}
          {customFieldEntries.length > 0 && (
            <div className="mt-5 space-y-2 border-t border-border pt-4">
              <h4 className="text-xs font-medium uppercase tracking-wide text-text-muted">
                Campos adicionais
              </h4>
              <dl className="space-y-1.5">
                {customFieldEntries.map(([key, value]) => (
                  <div key={key} className="flex justify-between gap-3 text-sm">
                    <dt className="text-text-muted">{humanizeFieldKey(key)}</dt>
                    <dd className="text-right text-text">{String(value)}</dd>
                  </div>
                ))}
              </dl>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
