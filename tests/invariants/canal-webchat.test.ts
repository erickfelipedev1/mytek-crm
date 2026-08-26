import { beforeAll, describe, expect, it } from "vitest";

import {
  GOV_ORG,
  GOV_SESSION,
  columnExists,
  countAs,
  indexExists,
  seedGov,
  sql,
} from "./gov-helpers";

/**
 * Canal `webchat` (migration 0176, spec docs/specs/canal-webchat.md).
 *
 * O chat do site usa AS MESMAS `conversations`/`messages` do WhatsApp. Isso é o
 * que faz inbox, fila, roteamento, agentes e RAG servirem o canal novo sem
 * saber que ele existe — e é exatamente por isso que os invariantes daqui
 * importam: afrouxar `channel_session_id` para caber o webchat mexe numa coluna
 * que TODO o caminho de WhatsApp assume preenchida.
 *
 * O que este arquivo prova:
 *  1. o canal antigo NÃO afrouxou junto (whatsapp sem sessão continua recusado);
 *  2. webchat sem sessão é aceito — o ponto da migration;
 *  3. um visitante tem UMA conversa viva, não uma por mensagem;
 *  4. conversa encerrada libera a vaga (quem volta meses depois abre outra);
 *  5. o vocabulário de `webhook_sources.kind` aceita os DOIS valores;
 *  6. `allowed_origins` nasce vazio — recusar tudo é o default seguro;
 *  7. isolamento: a org B não enxerga conversa nem mensagem de webchat da org A.
 */

// Namespace próprio (bbbbbbbb) — não colide com gov-helpers (cccccccc) nem com
// webhooks-rls (ffffffff), e os arquivos rodam em paralelo no mesmo banco.
const WC_ORG_B = "bbbbbbbb-0000-4000-8000-000000000002";
const WC_MANAGER_B = "bbbbbbbb-1111-4000-8000-000000000002";
const WC_CONTACT = "bbbbbbbb-3333-4000-8000-000000000001";
const WC_CONTACT_VAGA = "bbbbbbbb-3333-4000-8000-000000000002";
const WC_CONTACT_WA = "bbbbbbbb-3333-4000-8000-000000000003";
const WC_CONV = "bbbbbbbb-4444-4000-8000-000000000001";
const WC_CONV_DUPLICADA = "bbbbbbbb-4444-4000-8000-000000000002";
const WC_CONV_VAGA_1 = "bbbbbbbb-4444-4000-8000-000000000003";
const WC_CONV_VAGA_2 = "bbbbbbbb-4444-4000-8000-000000000004";
const WC_CONV_WA = "bbbbbbbb-4444-4000-8000-000000000005";
const WC_MSG = "bbbbbbbb-7777-4000-8000-000000000001";
const WC_SOURCE_CHAT = "bbbbbbbb-5555-4000-8000-000000000001";
const WC_SOURCE_FORM = "bbbbbbbb-5555-4000-8000-000000000002";
const WC_PIPELINE = "bbbbbbbb-5555-4000-8000-000000000003";
const WC_STAGE = "bbbbbbbb-5555-4000-8000-000000000004";

beforeAll(() => {
  seedGov();
  sql(`
    insert into auth.users (id, email)
      values ('${WC_MANAGER_B}', 'webchat-manager-org-b@invariant.test')
      on conflict do nothing;
    insert into public.organizations (id, slug, legal_name, display_name)
      values ('${WC_ORG_B}', 'webchat-inv-b', 'Webchat Invariant Org B', 'Webchat Inv B')
      on conflict do nothing;
    insert into public.user_organizations (user_id, organization_id, role, accepted_at)
      values ('${WC_MANAGER_B}', '${WC_ORG_B}', 'manager', now())
      on conflict do nothing;

    insert into public.contacts (id, organization_id, display_name)
      values
        ('${WC_CONTACT}', '${GOV_ORG}', 'Webchat Invariant Visitante'),
        ('${WC_CONTACT_VAGA}', '${GOV_ORG}', 'Webchat Invariant Volta'),
        ('${WC_CONTACT_WA}', '${GOV_ORG}', 'Webchat Invariant WhatsApp')
      on conflict do nothing;

    insert into public.crm_pipelines (id, organization_id, name, slug)
      values ('${WC_PIPELINE}', '${GOV_ORG}', 'Webchat Invariant', 'webchat-inv')
      on conflict do nothing;
    insert into public.crm_stages (id, organization_id, pipeline_id, name, slug, position)
      values ('${WC_STAGE}', '${GOV_ORG}', '${WC_PIPELINE}', 'Novo', 'novo', 1000)
      on conflict do nothing;
  `);
});

describe("canal webchat — schema (migration 0176)", () => {
  it("o apêndice do baseline chegou: coluna e índice existem", () => {
    // Controle do INSTRUMENTO antes de qualquer conclusão: sem isto, uma
    // migration que não entrou no baseline faria os testes abaixo passarem por
    // motivo errado (nada a violar quando a constraint não existe).
    expect(columnExists("webhook_sources", "allowed_origins")).toBe(true);
    expect(indexExists("uniq_conversations_org_contact_webchat")).toBe(true);
  });

  it("webchat dispensa sessão de canal — é o ponto da migration", () => {
    sql(`
      insert into public.conversations (id, organization_id, contact_id, channel, channel_session_id, status)
        values ('${WC_CONV}', '${GOV_ORG}', '${WC_CONTACT}', 'webchat', null, 'open')
        on conflict do nothing;
    `);
    const criadas = sql(
      `select count(*) from public.conversations where id = '${WC_CONV}' and channel_session_id is null;`,
    );
    expect(criadas).toBe("1");
  });

  it("mensagem de webchat também vive sem sessão", () => {
    sql(`
      insert into public.messages
        (id, organization_id, conversation_id, contact_id, channel_session_id, type, direction, status, body)
        values ('${WC_MSG}', '${GOV_ORG}', '${WC_CONV}', '${WC_CONTACT}', null, 'text', 'inbound', 'received', 'oi')
        on conflict do nothing;
    `);
    expect(
      sql(`select count(*) from public.messages where id = '${WC_MSG}' and channel_session_id is null;`),
    ).toBe("1");
  });

  it("o canal ANTIGO não afrouxou junto: whatsapp sem sessão é recusado", () => {
    // O invariante que justifica `conversations_whatsapp_exige_sessao`. Sem
    // ele, uma conversa de WhatsApp sem sessão nasceria e toda mensagem dela
    // ficaria `queued` para sempre, sem nada apontando o porquê — o caminho de
    // envio resolve o adapter A PARTIR da sessão.
    expect(() =>
      sql(`
        insert into public.conversations (id, organization_id, contact_id, channel, channel_session_id, status)
          values ('${WC_CONV_WA}', '${GOV_ORG}', '${WC_CONTACT_WA}', 'whatsapp', null, 'open');
      `),
    ).toThrow(/conversations_whatsapp_exige_sessao/);
  });

  it("whatsapp COM sessão continua sendo aceito (controle positivo)", () => {
    sql(`
      insert into public.conversations (id, organization_id, contact_id, channel, channel_session_id, status)
        values ('${WC_CONV_WA}', '${GOV_ORG}', '${WC_CONTACT_WA}', 'whatsapp', '${GOV_SESSION}', 'open')
        on conflict do nothing;
    `);
    expect(sql(`select count(*) from public.conversations where id = '${WC_CONV_WA}';`)).toBe("1");
  });

  it("canal fora do vocabulário é recusado", () => {
    expect(() =>
      sql(`
        insert into public.conversations (id, organization_id, contact_id, channel, channel_session_id, status)
          values ('${WC_CONV_DUPLICADA}', '${GOV_ORG}', '${WC_CONTACT}', 'telegram', null, 'open');
      `),
    ).toThrow(/conversations_channel_check/);
  });
});

describe("canal webchat — uma conversa viva por visitante", () => {
  it("o mesmo visitante NÃO abre uma segunda conversa enquanto a dele está viva", () => {
    // Este é o invariante que a `conversations_unique_per_contact_session` não
    // cobre: ela inclui `channel_session_id`, e com NULL o Postgres trata cada
    // linha como distinta. Sem o índice parcial da 0176, o visitante ganharia
    // conversa nova A CADA MENSAGEM e o inbox viraria uma pilha de fragmentos.
    expect(() =>
      sql(`
        insert into public.conversations (id, organization_id, contact_id, channel, channel_session_id, status)
          values ('${WC_CONV_DUPLICADA}', '${GOV_ORG}', '${WC_CONTACT}', 'webchat', null, 'open');
      `),
    ).toThrow(/uniq_conversations_org_contact_webchat/);
  });

  it("conversa encerrada libera a vaga — quem volta depois abre outra", () => {
    sql(`
      insert into public.conversations (id, organization_id, contact_id, channel, channel_session_id, status)
        values ('${WC_CONV_VAGA_1}', '${GOV_ORG}', '${WC_CONTACT_VAGA}', 'webchat', null, 'open')
        on conflict do nothing;
      update public.conversations set status = 'closed' where id = '${WC_CONV_VAGA_1}';
      insert into public.conversations (id, organization_id, contact_id, channel, channel_session_id, status)
        values ('${WC_CONV_VAGA_2}', '${GOV_ORG}', '${WC_CONTACT_VAGA}', 'webchat', null, 'open')
        on conflict do nothing;
    `);
    // As DUAS existem: o histórico da visita antiga não é reescrito, e a nova
    // conversa é uma conversa nova de verdade.
    expect(
      sql(
        `select count(*) from public.conversations where contact_id = '${WC_CONTACT_VAGA}' and channel = 'webchat';`,
      ),
    ).toBe("2");
  });
});

describe("canal webchat — fonte de entrada", () => {
  it("`kind` aceita os DOIS valores do vocabulário", () => {
    // `lead_capture` está aqui por cicatriz: a primeira versão da 0176 recriou
    // este CHECK apenas com ('form','webchat') e derrubou toda linha existente,
    // reprovando dois testes de RLS que nem falam de webchat.
    sql(`
      insert into public.webhook_sources
        (id, organization_id, name, path_token, kind, default_pipeline_id, default_stage_id)
        values
          ('${WC_SOURCE_FORM}', '${GOV_ORG}', 'Formulário', 'wc-tok-form-${WC_SOURCE_FORM}', 'lead_capture', '${WC_PIPELINE}', '${WC_STAGE}'),
          ('${WC_SOURCE_CHAT}', '${GOV_ORG}', 'Chat do site', 'wc-tok-chat-${WC_SOURCE_CHAT}', 'webchat', '${WC_PIPELINE}', '${WC_STAGE}')
        on conflict do nothing;
    `);
    expect(
      sql(
        `select count(*) from public.webhook_sources where id in ('${WC_SOURCE_FORM}', '${WC_SOURCE_CHAT}');`,
      ),
    ).toBe("2");
  });

  it("`kind` fora do vocabulário é recusado", () => {
    expect(() =>
      sql(`
        insert into public.webhook_sources
          (organization_id, name, path_token, kind, default_pipeline_id, default_stage_id)
          values ('${GOV_ORG}', 'Inventado', 'wc-tok-invalido', 'form', '${WC_PIPELINE}', '${WC_STAGE}');
      `),
    ).toThrow(/webhook_sources_kind_check/);
  });

  it("`allowed_origins` nasce VAZIO — recusar toda origem é o default seguro", () => {
    // Uma fonte de chat que nascesse liberando qualquer origem deixaria
    // qualquer site abrir conversa no CRM de outra empresa usando o token que
    // está no HTML dela. O default tem de ser o que não atende ninguém.
    expect(
      sql(`select allowed_origins = '{}'::text[] from public.webhook_sources where id = '${WC_SOURCE_CHAT}';`),
    ).toBe("t");
  });
});

describe("canal webchat — isolamento entre organizações", () => {
  it("a org B não enxerga a conversa de webchat da org A", () => {
    expect(
      countAs(
        WC_MANAGER_B,
        `select count(*) from public.conversations where id = '${WC_CONV}';`,
      ),
    ).toBe(0);
  });

  it("a org B não enxerga a mensagem de webchat da org A", () => {
    expect(
      countAs(WC_MANAGER_B, `select count(*) from public.messages where id = '${WC_MSG}';`),
    ).toBe(0);
  });

  it("a org B não enxerga a fonte de webchat da org A", () => {
    // O token da fonte é a credencial pública do widget: vazá-lo entre tenants
    // deixaria uma empresa abrir conversa no CRM da outra.
    expect(
      countAs(
        WC_MANAGER_B,
        `select count(*) from public.webhook_sources where id = '${WC_SOURCE_CHAT}';`,
      ),
    ).toBe(0);
  });
});
