/**
 * Token de sessão do visitante do webchat — HMAC-SHA256 stateless, na mesma
 * forma do convite (`lib/auth/invite-token.ts`): `<body>.<sig>` base64url,
 * verificado com `timingSafeEqual`.
 *
 * **Por que o UUID da conversa não serve como credencial:** ele aparece na URL
 * do inbox, no MCP (`crm_list_conversations`) e em log — é identificador, não
 * segredo. Se o widget mandasse `conversation_id` cru, qualquer um que visse um
 * id leria a conversa alheia. O token amarra org + conversa + contato numa
 * asserção assinada pelo servidor, e o cliente nunca escolhe o que ele diz.
 *
 * TTL curto de propósito: a sessão é a visita, não a pessoa. Quem volta ao site
 * depois refaz o formulário e cai na MESMA conversa pela identidade (e-mail) —
 * a continuidade vive no CRM, não num token de longa vida no navegador.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

const SECRET = (): string =>
  process.env.WEBCHAT_TOKEN_SECRET ?? process.env.INTERNAL_SECRET ?? "dev-fallback";

export interface WebchatSessionPayload {
  conversation_id: string;
  contact_id: string;
  organization_id: string;
  /** `path_token` da webhook_source que abriu a sessão — amarra o token à fonte. */
  source_token: string;
  exp: number; // epoch seconds
}

export const WEBCHAT_SESSION_TTL_SECONDS = 60 * 60 * 8; // 8h — uma visita longa

function b64url(buf: Buffer): string {
  return buf.toString("base64url");
}

export function signWebchatSession(
  payload: Omit<WebchatSessionPayload, "exp"> & { exp?: number },
): string {
  const completo: WebchatSessionPayload = {
    ...payload,
    exp: payload.exp ?? Math.floor(Date.now() / 1000) + WEBCHAT_SESSION_TTL_SECONDS,
  };
  const body = b64url(Buffer.from(JSON.stringify(completo), "utf8"));
  const sig = b64url(createHmac("sha256", SECRET()).update(body).digest());
  return `${body}.${sig}`;
}

export function verifyWebchatSession(token: string): WebchatSessionPayload | null {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [body, sig] = parts;
  if (!body || !sig) return null;

  const expected = b64url(createHmac("sha256", SECRET()).update(body).digest());
  if (sig.length !== expected.length) return null;

  try {
    if (!timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  } catch {
    return null;
  }

  let payload: WebchatSessionPayload;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as WebchatSessionPayload;
  } catch {
    return null;
  }

  if (
    typeof payload.conversation_id !== "string" ||
    typeof payload.contact_id !== "string" ||
    typeof payload.organization_id !== "string" ||
    typeof payload.source_token !== "string" ||
    typeof payload.exp !== "number"
  ) {
    return null;
  }

  if (payload.exp * 1000 < Date.now()) return null;
  return payload;
}
