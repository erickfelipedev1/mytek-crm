/**
 * Cria uma automation_rule pronta pra avisar o n8n/Make quando algo muda no
 * CRM — ação `call_webhook` (já existe no motor, `lib/automation/actions/call-webhook.ts`):
 * POST com envelope `{event, occurred_at, data:{...lead, ...contact}}`,
 * assinatura HMAC-sha256 opcional e retry 3x.
 *
 * Do lado do n8n: um node "Webhook" (Production URL) recebe o POST; do lado
 * do Make: um "Webhooks > Custom webhook". Cole essa URL em N8N_WEBHOOK_URL.
 *
 * Uso:
 *   N8N_WEBHOOK_URL="https://seu-n8n.exemplo.com/webhook/deskcomm" \
 *   N8N_WEBHOOK_SECRET="opcional-mas-recomendado" \
 *   AUTOMATION_TRIGGER_EVENT="lead.stage_changed" \
 *   AUTOMATION_RULE_ACTIVE=true \
 *   npx tsx scripts/create-n8n-webhook-rule.ts
 *
 * TRIGGER_EVENT aceita os 5 que o motor reconhece (lib/schemas/webhooks.ts):
 *   lead.created | lead.stage_changed | lead.tag_added | contact.tag_added | message.received
 *
 * Sem AUTOMATION_RULE_ACTIVE=true a regra nasce PAUSADA (mesmo default da
 * tela) — ligue pela UI (Automações) depois de conferir a configuração, ou
 * rode de novo com a env pra já nascer ativa.
 */
import { createClient } from "@supabase/supabase-js";
import * as fs from "node:fs";
import * as path from "node:path";

function loadEnv(): Record<string, string> {
  const out: Record<string, string> = { ...process.env } as Record<string, string>;
  for (const file of [".env", ".env.local"]) {
    const p = path.join(process.cwd(), file);
    if (!fs.existsSync(p)) continue;
    for (const line of fs.readFileSync(p, "utf8").split("\n")) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m && !out[m[1]!]) out[m[1]!] = m[2]!.replace(/^"(.*)"$/, "$1");
    }
  }
  return out;
}

const env = loadEnv();

const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE = env.SUPABASE_SERVICE_ROLE_KEY;
const ORG_SLUG = env.SERVICE_ACCOUNT_ORG_SLUG || "minha-empresa";
const WEBHOOK_URL = env.N8N_WEBHOOK_URL;
const WEBHOOK_SECRET = env.N8N_WEBHOOK_SECRET || "";
const TRIGGER_EVENT = env.AUTOMATION_TRIGGER_EVENT || "lead.stage_changed";
const RULE_NAME = env.AUTOMATION_RULE_NAME || `n8n — ${TRIGGER_EVENT}`;
const ACTIVE = (env.AUTOMATION_RULE_ACTIVE || "false").toLowerCase() === "true";

if (!SUPABASE_URL || !SERVICE_ROLE) {
  throw new Error("Faltam NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY.");
}
if (!WEBHOOK_URL) {
  throw new Error("Falta N8N_WEBHOOK_URL — a URL de produção do node Webhook no n8n (ou do Custom webhook no Make).");
}

const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function main(): Promise<void> {
  const { data: org, error: orgError } = await admin
    .from("organizations")
    .select("id")
    .eq("slug", ORG_SLUG)
    .maybeSingle();
  if (orgError || !org) throw new Error(`Organização não encontrada: ${ORG_SLUG}`);
  const orgId = (org as { id: string }).id;
  console.log(`📋 Organização: ${orgId}`);

  let secretEnc: string | undefined;
  if (WEBHOOK_SECRET) {
    const { data, error } = await admin.rpc("fn_encrypt_oauth", { plaintext: WEBHOOK_SECRET });
    if (error || !data) {
      throw new Error(
        `Não deu pra cifrar o secret (${error?.message ?? "sem chave"}). Configure NUVEMSHOP_OAUTH_ENCRYPTION_KEY ou rode sem N8N_WEBHOOK_SECRET.`,
      );
    }
    secretEnc = (data as string).replace(/^\\x/, "");
    console.log("🔐 Secret cifrado — o n8n recebe o header X-Deskcomm-Signature (HMAC-sha256 do body).");
  } else {
    console.log("⚠️  Sem secret: o webhook vai SEM assinatura. Recomendado configurar N8N_WEBHOOK_SECRET.");
  }

  const { data: created, error: insErr } = await admin
    .from("automation_rules")
    .insert({
      organization_id: orgId,
      created_by_user_id: null,
      name: RULE_NAME,
      trigger_event: TRIGGER_EVENT,
      conditions: [],
      actions: [
        {
          type: "call_webhook",
          config: {
            url: WEBHOOK_URL,
            ...(secretEnc ? { secret_enc: secretEnc } : {}),
          },
        },
      ],
      is_active: ACTIVE,
    })
    .select("id, name, trigger_event, is_active")
    .single();
  if (insErr) throw new Error(`Falha ao criar a regra: ${insErr.message}`);

  console.log(`\n✅ Regra criada!\n`);
  console.log(`📌 Nome:      ${created.name}`);
  console.log(`📌 Gatilho:   ${created.trigger_event}`);
  console.log(`📌 Ativa:     ${created.is_active ? "sim" : "NÃO — ligue em Automações na tela do CRM"}`);
  console.log(`📌 URL:       ${WEBHOOK_URL}`);
  console.log(
    `\nQualquer ${TRIGGER_EVENT} vai virar um POST em ${WEBHOOK_URL} com {event, occurred_at, data:{lead, contact, ...}}.`,
  );
}

main().catch((err) => {
  console.error("❌ Erro:", err.message);
  process.exit(1);
});
