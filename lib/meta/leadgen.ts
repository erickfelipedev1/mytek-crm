/**
 * Meta Lead Ads (formulário nativo) — funções puras de verificação e mapeamento.
 *
 * O webhook `leadgen` da Meta manda só o ID do lead (`leadgen_id`); os dados
 * de fato (`field_data`) vêm de uma segunda chamada à Graph API
 * (`GET /{leadgen_id}?fields=field_data,...`). Este módulo só cuida da forma
 * dos dados — quem faz as duas chamadas HTTP é a rota
 * `app/api/v1/webhooks/meta/leadgen/route.ts`.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export interface MetaLeadgenChange {
  field: string;
  value: {
    leadgen_id?: string;
    page_id?: string;
    form_id?: string;
    adgroup_id?: string;
    ad_id?: string;
    campaign_id?: string;
    created_time?: number;
  };
}

export interface MetaLeadgenEntry {
  id: string; // page id
  time?: number;
  changes: MetaLeadgenChange[];
}

export interface MetaWebhookPayload {
  object?: string;
  entry?: MetaLeadgenEntry[];
}

/** Achata `payload.entry[].changes[]` filtrando só `field === "leadgen"`. */
export function extractLeadgenEvents(
  payload: MetaWebhookPayload,
): Array<{ pageId: string; value: MetaLeadgenChange["value"] }> {
  const out: Array<{ pageId: string; value: MetaLeadgenChange["value"] }> = [];
  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      if (change.field === "leadgen" && change.value?.leadgen_id) {
        out.push({ pageId: entry.id, value: change.value });
      }
    }
  }
  return out;
}

/**
 * `X-Hub-Signature-256: sha256=<hex hmac do body cru>`, assinado com o App
 * Secret do app Meta que entrega o webhook (docs: "Validating Payloads").
 * `timingSafeEqual` — mesmo padrão do restante do produto (comparação de HMAC
 * nunca por `===`, que vaza timing).
 */
export function verifyMetaSignature(rawBody: string, header: string | null, appSecret: string): boolean {
  if (!header) return false;
  const [scheme, hex] = header.split("=");
  if (scheme !== "sha256" || !hex) return false;
  const expected = createHmac("sha256", appSecret).update(rawBody, "utf8").digest("hex");
  const a = Buffer.from(hex, "hex");
  const b = Buffer.from(expected, "hex");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export interface MetaFieldDatum {
  name: string;
  values: string[];
}

export interface MappedMetaLead {
  name: string | null;
  email: string | null;
  phone: string | null;
  custom_fields: Record<string, string>;
}

// Nomes de campo que o construtor de formulário nativo da Meta usa com mais
// frequência (campos "padrão" do formulário instantâneo). Um campo fora desta
// lista não é perdido — entra em custom_fields, igual ao mapeador genérico de
// `lib/webhooks/inbound.ts`.
const NAME_FIELDS = ["full_name", "first_name"];
const EMAIL_FIELDS = ["email"];
const PHONE_FIELDS = ["phone_number"];

function firstValue(fieldData: MetaFieldDatum[], names: string[]): string | null {
  for (const name of names) {
    const found = fieldData.find((f) => f.name.toLowerCase() === name);
    if (found?.values?.[0]?.trim()) return found.values[0].trim();
  }
  return null;
}

/** Mapeia `field_data` da Graph API para o formato aceito por `createLeadHandler`. */
export function mapLeadgenFieldData(fieldData: MetaFieldDatum[]): MappedMetaLead {
  const name = firstValue(fieldData, NAME_FIELDS);
  const email = firstValue(fieldData, EMAIL_FIELDS);
  const phone = firstValue(fieldData, PHONE_FIELDS);

  const known = new Set([...NAME_FIELDS, ...EMAIL_FIELDS, ...PHONE_FIELDS]);
  const custom_fields: Record<string, string> = {};
  for (const f of fieldData) {
    if (known.has(f.name.toLowerCase())) continue;
    if (f.values?.[0] !== undefined) custom_fields[f.name] = f.values[0];
  }

  return { name, email, phone, custom_fields };
}
