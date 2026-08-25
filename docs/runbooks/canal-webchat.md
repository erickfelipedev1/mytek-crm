# Runbook — Subir o canal `webchat` (chat do site)

> Liga o chat do site do cliente ao inbox do CRM. Duas pontas em repositórios
> diferentes, e **a ordem importa**.
>
> Spec: [`docs/specs/canal-webchat.md`](../specs/canal-webchat.md) ·
> Migration: `0149` · Deploy geral: [`deploy.md`](deploy.md)

## O que muda

Antes, o widget do site só sabia **captar**: um POST criava contato e lead, e o
texto que a pessoa digitava não virava mensagem. Depois disto, o que o visitante
escreve entra como mensagem `inbound` na mesma caixa de entrada do WhatsApp, e o
que o atendente responde aparece de volta no site.

## A ordem é obrigatória, e o motivo é assimétrico

```
1. CRM (schema + código)  →  2. criar a fonte  →  3. site
```

Subir o **site antes do CRM** deixa o widget chamando rotas que ainda não
existem: todo visitante vê "não consegui abrir a conversa". Subir o **CRM antes
do site** não quebra nada — o canal fica lá, ocioso, esperando alguém usar. Na
dúvida, o CRM primeiro.

---

## Fase 0 — antes de mergear

Confirme os quatro checks do PR do CRM ([erickfelipedev1/mytek-crm#7]):

```bash
gh pr checks 7 --repo erickfelipedev1/mytek-crm
```

O que interessa mais é o **`invariants`**: é ele que aplica o `baseline.sql`
num Postgres cru (modo install *e* update) e roda os invariantes do canal. Verde
ali é a prova de que a 0149 entra sem derrubar o banco de um clone.

---

## Fase 1 — CRM

**1.1** Merge do PR #7 na `main`. O `publish-image.yml` dispara e publica
`ghcr.io/<repo>:latest` (~6 min).

**1.2** Na VPS, rode o atualizador do kit:

```bash
./update.sh
```

Ele faz, nesta ordem: baixa o código novo → **re-aplica o `baseline.sql`**
(é assim que a 0149 chega ao banco) → puxa a imagem nova → reinicia → confere se
o app voltou.

> Se por algum motivo for fazer o deploy à mão em vez do `update.sh`, os **dois**
> `-f` são obrigatórios — ver `deploy.md` §1. Omitir o `docker-compose.traefik.yml`
> faz o domínio inteiro responder 404 com o contêiner `healthy`.

**1.3** Verifique antes de seguir:

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://crm.mytek.com.br
# esperado: 307 (redireciona pro login). 404 = roteamento quebrado.
```

---

## Fase 2 — criar a fonte de webchat (pela tela)

No CRM, **Webhooks → Nova fonte**:

| Campo | Valor |
|---|---|
| Tipo | **Chat no site — abre conversa** |
| Nome | `Chat do site` |
| Endereço do site | `https://mytek.com.br`<br>`https://www.mytek.com.br` |
| Funil / Estágio | onde o lead do chat deve entrar |

Salve, abra a fonte criada e **copie o token**.

Três coisas que costumam morder aqui:

- **`www` e sem `www` são origens diferentes** para o navegador. Se o site
  responde nos dois, declare os dois — senão o chat abre em um e falha no outro.
- **Nunca com barra no final.** O header `Origin` nunca traz barra, então
  `https://mytek.com.br/` jamais casa. A tela remove a barra ao salvar, mas
  confira o que ficou gravado.
- **Sem nenhum endereço, a fonte fica ativa e inútil**: ela recusa toda tentativa
  de abrir conversa. A tela avisa em vermelho quando a lista está vazia.

O token fica visível no código da página do site, e **isso é por desenho** — quem
autoriza é a lista de endereços, não o sigilo do token. Ele também não serve para
despejar lead pelo endpoint de captação: aquele caminho só aceita fonte do tipo
formulário.

---

## Fase 3 — site

**3.1** No Cloudflare Pages do projeto do site → **Settings → Environment
variables** (ambiente **Production**):

```
NEXT_PUBLIC_CRM_URL      = https://crm.mytek.com.br
NEXT_PUBLIC_WEBCHAT_TOKEN = <o token da Fase 2>
```

> **A armadilha número um.** Variáveis `NEXT_PUBLIC_*` são embutidas no bundle
> **durante o build**, não lidas em tempo de execução. Salvar a variável e não
> disparar um build novo deixa o site publicado sem ela — e o widget
> simplesmente não aparece, sem erro nenhum no console para explicar.

**3.2** Merge do PR do site ([myttrindade/mytek-site#1]). O push na `main`
dispara o build do Pages, que já nasce com as variáveis acima.

Se as variáveis foram criadas **depois** do último build, force um novo
(*Deployments → Retry deployment*).

---

## Fase 4 — provar que funciona (não é formalidade)

O caminho feliz **nunca foi executado ponta a ponta** — dependia da 0149 estar
num banco de verdade. Esta fase é o primeiro teste real, não uma conferência.

1. Abra `https://mytek.com.br` e confirme que a bolha azul aparece no canto.
   *Não apareceu?* → variável ausente no build (Fase 3.1).
2. Preencha nome, e-mail e telefone → **Começar conversa**.
   *Erro "não consegui abrir"?* → origem não declarada (Fase 2) ou CRM fora.
3. Escreva uma mensagem.
4. No CRM, abra o inbox: a conversa tem que estar lá, com o texto que você
   digitou, e o contato criado com o e-mail informado.
5. **Responda pelo inbox.** Em até ~3 segundos a resposta tem que aparecer na
   janela do chat no site.

O passo 5 é o que fecha o laço — é a diferença entre "o formulário capturou" e
"o chat conversa". Os passos 1 a 4 podiam funcionar no mundo antigo; o 5, não.

---

## Se der errado

**Desligar o chat sem deploy nenhum:** no CRM, pause a fonte de webchat. O widget
para de abrir conversa na hora. É o botão de emergência — use-o antes de pensar
em reverter código.

**Tirar o widget do ar:** limpe `NEXT_PUBLIC_WEBCHAT_TOKEN` no Cloudflare e
refaça o build. Sem token, o widget não renderiza (é o default seguro).

**A migration não precisa ser revertida.** A 0149 só *acrescenta*: um valor no
CHECK do canal, colunas novas, e um afrouxamento de `NOT NULL` que continua
cobrado para WhatsApp por constraint própria. Nada que existia antes depende dela.
Reverter o código sem reverter o banco é seguro.

---

## Depois de subir

- [ ] Marcar a jornada em `docs/testing/user-journey-map.md` com o resultado real
- [ ] Se a Fase 4 achar bug: conserto na causa raiz, migration versionada se tocar
      schema, e re-teste verde como prova (doutrina de QA Visual)
