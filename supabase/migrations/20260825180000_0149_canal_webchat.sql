-- 0149 — Canal `webchat`: chat de site na mesma conversa do WhatsApp.
--
-- Spec: docs/specs/canal-webchat.md
--
-- O widget de site só conseguia CAPTAR (webhooks/in cria contato+lead); o texto
-- do visitante não virava mensagem. A conversa nascia `whatsapp`, a saudação da
-- IA saía por WhatsApp e voltava `failed` para quem não tem número — o inbox
-- mostrava só a falha. Aqui o canal vira cidadão de primeira classe, reusando
-- `conversations`/`messages` para que inbox, fila, roteamento, agentes e RAG
-- funcionem sem saber que o canal mudou.
--
-- A mudança de maior raio é `channel_session_id` virar nullable: ela é a FK para
-- a sessão WAHA (telefone + engine), que webchat não tem. Para o canal antigo
-- não afrouxar junto, entra um CHECK condicional que mantém a exigência onde
-- ela sempre valeu.

-- ---- conversations.channel aceita 'webchat' ----
alter table public.conversations
  drop constraint if exists conversations_channel_check;

alter table public.conversations
  add constraint conversations_channel_check
  check (channel = any (array['whatsapp'::text, 'webchat'::text]));

-- ---- sessão de canal deixa de ser obrigatória ----
-- Idempotente por natureza: `drop not null` numa coluna já nullable é no-op.
alter table public.conversations alter column channel_session_id drop not null;
alter table public.messages      alter column channel_session_id drop not null;

-- ---- ...mas continua obrigatória para whatsapp ----
-- Sem isto, um bug de escrita criaria conversa de WhatsApp sem sessão e a
-- mensagem ficaria `queued` para sempre, sem nada apontando o porquê.
-- Nenhuma linha existente viola: a coluna era NOT NULL até agora.
alter table public.conversations
  drop constraint if exists conversations_whatsapp_exige_sessao;

alter table public.conversations
  add constraint conversations_whatsapp_exige_sessao
  check (channel <> 'whatsapp' or channel_session_id is not null);

-- `messages` NÃO ganha CHECK equivalente de propósito: a tabela não tem coluna
-- `channel` (ela vive na conversa) e CHECK não aceita subquery. O invariante
-- correspondente é exercitado em tests/invariants/canal-webchat.test.ts.

-- ---- uma conversa de webchat viva por contato ----
-- `conversations_unique_per_contact_session` inclui `channel_session_id`; com
-- NULL o Postgres trata cada linha como distinta e o mesmo visitante ganharia
-- conversa nova a cada mensagem. O predicado exclui os estados terminais: uma
-- conversa encerrada libera a vaga, então quem volta ao site meses depois abre
-- uma nova em vez de ressuscitar a antiga.
create unique index if not exists uniq_conversations_org_contact_webchat
  on public.conversations (organization_id, contact_id)
  where channel = 'webchat' and status <> all (array['closed'::text, 'archived'::text]);

-- ---- fonte de captação ganha o tipo webchat e origens permitidas ----
-- Reusa `webhook_sources` em vez de tabela nova: os campos são os mesmos (org,
-- pipeline, stage, path_token, is_active, last_received_at) e a tela
-- /app/webhooks + o `crm_list_webhook_sources` do MCP já os renderizam — a
-- feature nasce com tela e com porta.
--
-- `kind` JÁ EXISTE, com `default 'lead_capture' check (kind in ('lead_capture'))`
-- na criação da tabela. Aqui o vocabulário é ESTENDIDO, não trocado: a primeira
-- versão desta migration criava o valor 'form' como sinônimo de um conceito que
-- já tinha nome e recriava o CHECK só com ('form','webchat') — o que rejeitava
-- toda linha existente. O CI pegou (`webhook_sources_kind_check` violado por uma
-- linha `lead_capture`), e é o modo de falha que a doutrina de migrations
-- descreve: constraint criada sem conferir os dados que já estão lá.
alter table public.webhook_sources
  drop constraint if exists webhook_sources_kind_check;

alter table public.webhook_sources
  add constraint webhook_sources_kind_check
  check (kind = any (array['lead_capture'::text, 'webchat'::text]));

-- CORS: só os domínios declarados abrem sessão de chat. Vazio = nenhuma origem
-- de browser aceita, que é o default seguro para uma fonte `form` existente.
alter table public.webhook_sources
  add column if not exists allowed_origins text[] not null default '{}'::text[];

comment on column public.webhook_sources.kind is
  'lead_capture = captação de formulário (POST único vira lead); webchat = chat de site (abre conversa e troca mensagens).';

comment on column public.webhook_sources.allowed_origins is
  'Origens de browser autorizadas a abrir sessão de webchat (Origin exato, ex.: https://mytek.com.br). Vazio bloqueia todas.';
