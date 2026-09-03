# Meta Ads — Lead Ads (formulário nativo) + Conversions API

Duas integrações, uma credencial: (1) o formulário nativo do Facebook/Instagram vira lead no
CRM automaticamente; (2) quando um lead é marcado como qualificado, o CRM avisa a Meta pra o
algoritmo de anúncios aprender a buscar gente parecida.

Backend já implementado (migration `0177`, `lib/meta/`, `app/api/v1/integrations/meta-ads`,
`app/api/v1/webhooks/meta/leadgen`, ação de automação `meta_capi`). **O que falta é o lado
Meta** — você precisa criar um App e gerar as credenciais abaixo. Não há UI de conexão ainda:
é feito com um `curl`/Postman autenticado (rota `POST /api/v1/integrations/meta-ads`).

## 1. Crie o App no Meta for Developers

1. [developers.facebook.com](https://developers.facebook.com) → **Meus Apps** → **Criar App** → tipo **Negócios**.
2. Adicione o produto **Webhooks** e o produto **Marketing API** (ou **Lead Ads** conforme o app estiver).
3. Em **Configurações do App → Básico**, copie o **App Secret** — é o `app_secret` do passo 3.

## 2. Gere o token de acesso

Precisa de um token de longa duração (Page Access Token ou System User Token, via Business Manager)
com os escopos:
- `leads_retrieval` — ler os dados de quem preencheu o formulário
- `pages_manage_ads` / `ads_management` — necessário pro Conversions API

O caminho mais estável é criar um **System User** no Business Manager (Configurações do
Negócio → Usuários → Usuários do sistema), atribuir a Página e a Conta de Anúncios a ele, e
gerar um token de sistema (não expira, ao contrário do token de usuário de 60 dias).

## 3. Pegue os IDs

- **Page ID**: na própria Página do Facebook, em Configurações → Sobre.
- **Pixel ID / Dataset ID**: Gerenciador de Eventos (Events Manager) → seu Pixel/Dataset.

## 4. Conecte no CRM

```bash
curl -X POST https://SEU-CRM/api/v1/integrations/meta-ads \
  -H "Content-Type: application/json" \
  -H "Cookie: <cookie de sessão de um manager/admin>" \
  -d '{
    "access_token": "EAAG...",
    "app_secret": "o App Secret do passo 1",
    "page_id": "1234567890",
    "pixel_id": "9876543210",
    "default_pipeline_id": "<uuid do funil onde o lead do Facebook entra>",
    "default_stage_id": "<uuid da etapa inicial>"
  }'
```

`GET /api/v1/integrations/meta-ads` devolve o status (nunca as credenciais). `DELETE` desconecta.

Pipeline/etapa: pegue os UUIDs em **Funis** na tela do CRM (ou `crm_list_pipelines`/`crm_list_stages`
pelo MCP).

## 5. Registre a Callback URL do webhook

No painel do App → **Webhooks** → **Página** → **Assinar** → campo `leadgen`:

- **Callback URL**: `https://SEU-CRM/api/v1/webhooks/meta/leadgen`
- **Verify Token**: qualquer string sua — cole a MESMA no `.env` do CRM em
  `META_WEBHOOK_VERIFY_TOKEN` **antes** de clicar em Verificar (a Meta faz um GET de handshake
  na hora; se a env não bater ela recusa).

Depois, na Página em si, inscreva-a no evento `leadgen` desse App (Configurações da Página →
Webhooks, ou via `POST /{page-id}/subscribed_apps`).

A partir daqui, alguém preenchendo o formulário nativo do anúncio vira lead no funil/etapa
configurados em ~segundos.

## 6. Ligue o feedback de qualificação (CAPI)

Na tela **Automações** do CRM, crie uma regra:

- **Gatilho**: `lead.stage_changed`
- **Condição**: `stage_id` **igual a** o UUID da etapa que você considera "qualificado"
- **Ação**: `meta_capi`, `event_name` = `Qualified Lead` (ou o nome que você configurou como
  evento customizado no Gerenciador de Eventos)

Cada vez que um lead entrar nessa etapa, a Meta recebe o evento (e-mail/telefone hasheados
SHA-256 — nunca em claro) e o Ads Manager passa a otimizar a campanha buscando gente com o
mesmo perfil.

## Limitações desta entrega

- Sem UI de conexão — passo 4 é via API direta.
- `pnpm test:db`/`pnpm test:e2e` não foram executados nesta sessão (sem Postgres efêmero
  disponível) — só `typecheck`, `lint` e `test:unit` (funções puras de hash/mapeamento/assinatura
  e a ação `meta_capi` com servidor HTTP local). A validação ponta-a-ponta contra a Graph API e o
  Business Manager reais ainda não foi feita.
- Um App Meta serve uma Callback URL só — se você tiver várias organizações (agência), todas
  compartilham o mesmo App/Verify Token; cada uma tem sua própria Página/Pixel/token.
