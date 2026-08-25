# Spec — Canal `webchat`

> Chat no site do cliente que conversa com o CRM pelo mesmo inbox do WhatsApp.
> Branch: `feat/canal-webchat`. Migration: **0149**.

## Problema

O site (`mytek.com.br`) tem um widget de chat. Hoje ele só consegue **captar**:
posta em `/api/v1/webhooks/in/[token]`, que cria contato + lead. O texto que o
visitante digita **não vira mensagem** — vai como dado do lead e morre ali.

Consequências medidas em produção (2026-08-25):

- A conversa criada nasce `channel = 'whatsapp'`. A saudação automática da IA
  sai por WhatsApp e volta `status: 'failed'` quando o visitante não tem número
  válido. O inbox mostra só essas falhas.
- Não existe caminho **inbound** no MCP (`crm_send_whatsapp_message` é outbound).
  Então nenhuma integração externa consegue injetar a fala do visitante.
- O atendente responde no inbox achando que é WhatsApp; a resposta não chega a
  quem está no site.

## Decisão

Um canal de primeira classe `webchat`, que usa **as mesmas** `conversations` e
`messages` do WhatsApp. Assim o inbox, a fila, o roteamento, os agentes de IA,
o handoff e o RAG funcionam sem saber que o canal é outro — que é exatamente o
que o seam de canais (`lib/channels/`) existe para permitir.

Rejeitado: tabela própria de chat de site. Duplicaria conversa/mensagem/fila e
exigiria uma segunda tela — violando DIRC (Duplicar) e o Living System (a
feature teria que reconstruir porta, timeline e log próprios).

## Schema (migration 0149 + apêndice no baseline)

| Mudança | Porquê |
|---|---|
| `conversations_channel_check` aceita `'webchat'` | hoje trava em `'whatsapp'` |
| `conversations.channel_session_id` vira **nullable** | webchat não tem sessão WAHA (a coluna FK aponta pra `channel_sessions`, que tem telefone e engine) |
| `messages.channel_session_id` vira **nullable** | idem, por mensagem |
| Índice único parcial `uniq_conversations_org_contact_webchat` | `conversations_unique_per_contact_session` inclui `channel_session_id`; com NULL o Postgres considera cada linha distinta e o contato ganharia conversa nova a cada mensagem |
| `webhook_sources.kind` passa a aceitar `'webchat'` | a coluna **já existe** com `check (kind in ('lead_capture'))`; aqui o vocabulário é estendido, nunca trocado |
| `webhook_sources.allowed_origins text[]` | CORS: só os domínios declarados podem abrir sessão |

**Por que reusar `webhook_sources` em vez de tabela nova:** os campos são os
mesmos (org, pipeline, stage, `path_token`, `is_active`, `last_received_at`), e
a tela `/app/webhooks` + o `crm_list_webhook_sources` do MCP já os renderizam.
A feature nasce com porta e com tela — requisitos 13 e 14 do Definition of Done —
em vez de precisar de uma UI nova só para ela.

`channel_session_id` nullable é a mudança de maior raio. Mitigação: o índice
parcial acima + os invariantes novos abaixo. Nenhuma linha existente muda
(`whatsapp` continua NOT NULL na prática, garantido por CHECK condicional:
`channel = 'whatsapp'` implica `channel_session_id is not null`).

## Endpoints (públicos, CORS por `allowed_origins`, rate-limited)

```
POST /api/v1/webchat/[token]/session
     body { name, email, phone? }  →  { session_token, conversation_id }
POST /api/v1/webchat/[token]/messages
     header X-Webchat-Session: <session_token>   body { body }
GET  /api/v1/webchat/[token]/messages?since=<iso>
     header X-Webchat-Session: <session_token>   → mensagens outbound novas
```

`session_token` é HMAC-assinado no servidor (org + conversation_id + exp), no
mesmo espírito do cursor opaco base64+HMAC da API. **O UUID da conversa nunca é
credencial** — sem isso, adivinhar/vazar um id daria leitura da conversa alheia.

Fluxo do POST de mensagem, espelhando o ingest do WhatsApp:
contato por identidade (email primeiro no webchat, telefone se vier) →
get-or-create conversa `webchat` → insere `messages` inbound →
atualiza `last_inbound_at`/preview → **emite `event_log`** para o motor de
regras e o agente de IA reagirem igual ao WhatsApp.

## Outbound

`app/api/v1/messages/_handler.ts` resolve adapter a partir de
`channel_sessions` e exige `status === 'WORKING'`; com webchat não há sessão e a
mensagem ficaria `queued` para sempre. Branch cedo: `channel === 'webchat'`
grava a mensagem já como `sent` e **não** chama adapter nenhum — a entrega é o
widget puxando no GET. Um `webchat.ts` em `lib/channels/adapters/` mantém a
forma do seam para quando a entrega virar Realtime.

## Verificação (o que prova que está pronto)

1. `pnpm test:db` — invariantes novos:
   - conversa `whatsapp` **não** pode ter `channel_session_id` nulo (o CHECK
     condicional não afrouxou o canal antigo)
   - dois POSTs do mesmo visitante geram **uma** conversa, não duas
   - isolamento: sessão da org A não lê mensagem da org B
2. `pnpm gov:verify` — typecheck + lint + `lint:channels` (o nome `webchat` é
   canal, não provider: não viola o invariante 1 da restrição de canal)
3. **Prova por tela** (doutrina de QA Visual): Playwright abre o site, digita no
   widget, e a mensagem aparece no inbox do CRM; o atendente responde pelo inbox
   e a resposta aparece no widget. `curl` não conta.

## Fora de escopo (dívida declarada)

- Entrega por Supabase Realtime — MVP faz polling.
- Anexos/mídia no webchat.
- Histórico persistente entre visitas (o `session_token` expira e a conversa
  reabre pelo email).
