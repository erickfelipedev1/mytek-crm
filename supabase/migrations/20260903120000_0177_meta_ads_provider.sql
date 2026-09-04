-- ============================================================================
-- 0177 — MOTIVA A CONEXÃO COM META ADS (lead ads + conversions api).
--
-- Duas necessidades do negócio, uma única credencial por trás:
--   (a) formulário nativo do Facebook/Instagram (Lead Ads) precisa entrar no
--       CRM como lead, igual a qualquer outro formulário — mas a captação
--       chega pelo webhook `leadgen` da Meta, não por um POST do site do
--       cliente;
--   (b) quando o time marca um lead como qualificado no Kanban, o CRM avisa a
--       Meta via Conversions API (evento `Lead`/custom) pra o algoritmo de
--       anúncios aprender a buscar gente parecida.
--
-- `tenant_integrations` já é o lugar certo pela DIRC (Integrar): já guarda
-- token OAuth cifrado, webhook secret cifrado, path token e store_metadata
-- por provider — exatamente a forma de (a) [webhook_secret_encrypted valida a
-- assinatura do `leadgen`] e (b) [oauth_access_token_encrypted + store_metadata
-- ->>'pixel_id' alimentam o CAPI]. Não nasce tabela nova; só o provider ganha
-- um valor a mais no vocabulário fechado. `organization_id, provider` já é
-- UNIQUE (migration da tabela original) — uma conexão Meta Ads por org.
--
-- Aditiva: só ALARGA o conjunto aceito pelo CHECK — nenhuma linha existente
-- passa a violar, nada para deduplicar antes (doutrina de migrations, item 8
-- não se aplica). CHECK reconstruído em UM bloco só (lição do #159/#175: N
-- blocos quebram o update.sh de clone com vocabulário posterior).
-- ============================================================================

alter table public.tenant_integrations
  drop constraint if exists tenant_integrations_provider_check;

alter table public.tenant_integrations
  add constraint tenant_integrations_provider_check check (provider in (
    'nuvemshop',
    'vtex',
    'shopify',
    -- (migration 0177) Lead Ads (formulário nativo) + Conversions API.
    -- store_metadata carrega { page_id, pixel_id, default_pipeline_id,
    -- default_stage_id }; webhook_secret_encrypted guarda o App Secret do
    -- app Meta (valida X-Hub-Signature-256 do webhook leadgen);
    -- oauth_access_token_encrypted guarda o access token (Page/System User)
    -- usado tanto pra buscar o lead na Graph API quanto pra postar no CAPI.
    'meta_ads'
  ));

comment on column public.tenant_integrations.provider is
  'nuvemshop/vtex/shopify = e-commerce (OAuth, webhooks de pedido). '
  'meta_ads = Meta Lead Ads + Conversions API (ver migration 0177 e docs/integrations/meta-ads.md).';
