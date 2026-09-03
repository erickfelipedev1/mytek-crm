/**
 * Zod schemas for webhook-sources e automation-rules (feature Webhooks, Task 12).
 * TRIGGER_EVENTS deve espelhar exatamente os 5 eventos que o motor
 * (`lib/automation/engine.ts` → EXPECTED_ENTITY_KIND) reconhece.
 */
import { z } from "zod";

export const TRIGGER_EVENTS = [
  "lead.created",
  "lead.stage_changed",
  "message.received",
  "lead.tag_added",
  "contact.tag_added",
] as const;

export const conditionSchema = z.object({
  field: z.string().min(1).max(200),
  op: z.enum(["eq", "neq", "contains"]),
  value: z.string().max(500),
});

export const actionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("create_or_move_lead"), config: z.object({ pipeline_id: z.string().uuid(), stage_id: z.string().uuid() }) }),
  z.object({ type: z.literal("send_whatsapp_message"), config: z.object({ channel_session_id: z.string().uuid(), template: z.string().min(1).max(2000) }) }),
  z.object({ type: z.literal("add_tag"), config: z.object({ tags: z.array(z.string().min(1).max(60)).min(1).max(10) }) }),
  z.object({ type: z.literal("assign_owner"), config: z.object({ user_id: z.string().uuid() }) }),
  z.object({
    type: z.literal("send_ai_message"),
    config: z.object({
      /** Agente PUBLICADO que assina a mensagem. */
      agent_id: z.string().uuid(),
      channel_session_id: z.string().uuid(),
      /**
       * O que fazer com os dados do formulário. Mesmo teto do `prompt_hint` de
       * um passo de follow-up (1000): é instrução, não roteiro — quem escreve
       * mais que isso está tentando pôr o prompt do agente aqui dentro.
       */
      instruction: z.string().min(1).max(1000),
    }),
  }),
  z.object({
    type: z.literal("call_webhook"),
    config: z.object({
      url: z.string().url().max(2000),
      // Input do usuário (plaintext, write-only) — a rota troca por secret_enc.
      secret: z.string().max(200).optional(),
      // Ciphertext hex (round-trip do editor: GET devolve, PATCH preserva).
      secret_enc: z.string().max(4000).optional(),
    }),
  }),
  z.object({
    type: z.literal("meta_capi"),
    config: z.object({
      // Nome do evento no Meta Ads Manager. Default "Lead" se omitido — a
      // ação (lib/automation/actions/meta-capi.ts) resolve o default, então
      // aqui é só opcional.
      event_name: z.string().min(1).max(60).optional(),
      // Sobrepõe o pixel_id da conexão (tenant_integrations.store_metadata) —
      // só necessário em conta com mais de um pixel/dataset.
      pixel_id: z.string().min(1).max(60).optional(),
    }),
  }),
]);

/**
 * Origem de browser, na forma EXATA que o header `Origin` traz:
 * `https://site.com.br`, sem barra final, sem caminho.
 *
 * A comparação em `lib/webchat/source.ts` é `allowed.includes(origin)` —
 * igualdade de string. Aceitar `https://site.com.br/` aqui gravaria um valor que
 * nunca casa, e o sintoma seria um chat que não abre em site nenhum, sem erro
 * que aponte a barra. Por isso o refine exige `v === new URL(v).origin`, que é a
 * mesma normalização que o browser aplica.
 */
const origemDeBrowser = z
  .string()
  .trim()
  .max(255)
  .refine(
    (v) => {
      try {
        const u = new URL(v);
        return (u.protocol === "https:" || u.protocol === "http:") && v === u.origin;
      } catch {
        return false;
      }
    },
    { message: "Use a origem exata, sem barra final nem caminho. Ex.: https://seusite.com.br" },
  );

export const createWebhookSourceSchema = z.object({
  name: z.string().min(1).max(120),
  default_pipeline_id: z.string().uuid(),
  default_stage_id: z.string().uuid(),
  kind: z.enum(["lead_capture", "webchat"]).optional(),
  allowed_origins: z.array(origemDeBrowser).max(20).optional(),
  redirect_to: z.string().url().max(2000).nullish(),
  field_map: z
    .object({
      name: z.array(z.string()).optional(),
      phone: z.array(z.string()).optional(),
      email: z.array(z.string()).optional(),
    })
    .optional(),
  secret: z.string().min(16).max(200).nullish(),
});
export const updateWebhookSourceSchema = createWebhookSourceSchema.partial().extend({
  is_active: z.boolean().optional(),
});

export const createAutomationRuleSchema = z.object({
  name: z.string().min(1).max(120),
  trigger_event: z.enum(TRIGGER_EVENTS),
  conditions: z.array(conditionSchema).max(10).default([]),
  actions: z.array(actionSchema).min(1).max(10),
});
export const updateAutomationRuleSchema = createAutomationRuleSchema.partial().extend({
  is_active: z.boolean().optional(),
});

export type CreateWebhookSourceInput = z.infer<typeof createWebhookSourceSchema>;
export type UpdateWebhookSourceInput = z.infer<typeof updateWebhookSourceSchema>;
export type CreateAutomationRuleInput = z.infer<typeof createAutomationRuleSchema>;
export type UpdateAutomationRuleInput = z.infer<typeof updateAutomationRuleSchema>;
