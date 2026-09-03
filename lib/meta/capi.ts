/**
 * Meta Conversions API (CAPI) — funções puras de montagem do evento.
 *
 * O CAPI recebe PII só como hash SHA-256 (doc oficial da Meta: "Hashing
 * Customer Information"). email é normalizado (trim + lowercase) antes de
 * hashear; telefone é normalizado para dígitos puros COM código do país (sem
 * "+", sem espaço/traço) antes de hashear — é o formato que o endpoint espera
 * em `user_data.ph`.
 *
 * Sem rede aqui de propósito: a ação (`lib/automation/actions/meta-capi.ts`)
 * é quem faz o fetch, e estas funções ficam testáveis sem servidor HTTP.
 */
import { createHash } from "node:crypto";

export function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

/** null se não há e-mail (a chamada não pode mandar um hash de string vazia). */
export function hashEmailForCapi(email: string | null | undefined): string | null {
  const trimmed = email?.trim().toLowerCase();
  if (!trimmed) return null;
  return sha256Hex(trimmed);
}

/**
 * Aceita o formato já normalizado do produto (`+5511999999999`, ver
 * `lib/phone/normalizePhoneBR.ts`) ou qualquer string com dígitos soltos —
 * remove tudo que não é dígito antes de hashear. Sem "+".
 */
export function hashPhoneForCapi(phone: string | null | undefined): string | null {
  const digits = phone?.replace(/\D/g, "");
  if (!digits) return null;
  return sha256Hex(digits);
}

export interface CapiLeadContext {
  email?: string | null;
  phone?: string | null;
  valueCents?: number | null;
  currency?: string | null;
  leadId?: string | null;
}

export interface CapiEventPayload {
  data: Array<{
    event_name: string;
    event_time: number;
    action_source: "system_generated";
    event_id?: string;
    user_data: Record<string, string[]>;
    custom_data?: Record<string, unknown>;
  }>;
}

/**
 * Monta o corpo de `/{pixel_id}/events`. `event_id` = o id do lead: dedup do
 * lado da Meta se a mesma automação disparar duas vezes para o mesmo negócio
 * (reenvio de evento, retry do event_log) — a Meta deduplica eventos com o
 * mesmo `event_id` dentro de uma janela de 48h.
 */
export function buildCapiEventPayload(eventName: string, ctx: CapiLeadContext): CapiEventPayload {
  const em = hashEmailForCapi(ctx.email);
  const ph = hashPhoneForCapi(ctx.phone);
  const user_data: Record<string, string[]> = {};
  if (em) user_data.em = [em];
  if (ph) user_data.ph = [ph];

  const custom_data: Record<string, unknown> = {};
  if (typeof ctx.valueCents === "number") custom_data.value = ctx.valueCents / 100;
  if (ctx.currency) custom_data.currency = ctx.currency;

  return {
    data: [
      {
        event_name: eventName,
        event_time: Math.floor(Date.now() / 1000),
        action_source: "system_generated",
        ...(ctx.leadId ? { event_id: ctx.leadId } : {}),
        user_data,
        ...(Object.keys(custom_data).length ? { custom_data } : {}),
      },
    ],
  };
}
