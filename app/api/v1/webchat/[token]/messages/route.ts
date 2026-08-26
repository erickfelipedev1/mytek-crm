/**
 * Mensagens do webchat.
 *
 *   POST — o visitante fala. Grava `messages` inbound e emite no barramento os
 *          MESMOS eventos do ingest de WhatsApp (`ai_agent.dispatch_requested`
 *          e `message.received`), para que agente de IA, motor de regras,
 *          sentimento e roteamento reajam sem saber que o canal é outro.
 *   GET  — o visitante lê. Devolve as `outbound` posteriores a `since`; é assim
 *          que a resposta do atendente (ou da IA) chega ao site enquanto a
 *          entrega não for por Realtime.
 *
 * Autorização é o `X-Webchat-Session` assinado, NUNCA o `conversation_id` do
 * cliente: o id da conversa é identificador público (aparece no inbox e no
 * MCP), e aceitá-lo como credencial deixaria qualquer um ler conversa alheia.
 * Toda query filtra `organization_id` vindo do token — service role bypassa RLS
 * (anti-pattern nº 10).
 */
import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { checkRateLimit } from "@/lib/ai/dispatcher/rate-limit";
import { logger } from "@/lib/logger";
import { createAdminClient } from "@/lib/supabase/admin";
import { corsHeadersParaOrigem, resolveWebchatSource } from "@/lib/webchat/source";
import { verifyWebchatSession, type WebchatSessionPayload } from "@/lib/webchat/session-token";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface RouteCtx {
  params: Promise<{ token: string }>;
}

const RATE_LIMIT_POST_PER_MIN = 30;
const RATE_LIMIT_GET_PER_MIN = 120;
const MAX_BODY = 4096;

const PostSchema = z.object({
  body: z.string().trim().min(1).max(MAX_BODY),
});

interface Preflight {
  cors: Record<string, string>;
  session: WebchatSessionPayload;
  organizationId: string;
}

/**
 * Origem autorizada + sessão válida + sessão emitida para ESTA fonte. O último
 * gate importa: sem ele, um token assinado para a fonte de outro site (mesmo
 * segredo de HMAC, outro tenant) valeria aqui.
 */
async function preflight(
  req: NextRequest,
  token: string,
  requestId: string,
): Promise<Preflight | NextResponse> {
  const admin = createAdminClient();
  const source = await resolveWebchatSource(admin, token);
  if (!source) return fail("not_found", "unknown webchat token", 404, { requestId });

  const cors = corsHeadersParaOrigem(req.headers.get("origin"), source.allowed_origins);
  if (!cors) return fail("forbidden", "origin_not_allowed", 403, { requestId });

  const raw = req.headers.get("x-webchat-session");
  const session = raw ? verifyWebchatSession(raw) : null;
  if (!session) {
    return fail("unauthenticated", "sessão inválida ou expirada", 401, { requestId, headers: cors });
  }
  if (session.source_token !== token || session.organization_id !== source.organization_id) {
    return fail("forbidden", "sessão de outra origem", 403, { requestId, headers: cors });
  }

  return { cors, session, organizationId: source.organization_id };
}

export async function OPTIONS(req: NextRequest, ctx: RouteCtx): Promise<NextResponse> {
  const { token } = await ctx.params;
  const admin = createAdminClient();
  const source = await resolveWebchatSource(admin, token);
  const cors = source ? corsHeadersParaOrigem(req.headers.get("origin"), source.allowed_origins) : null;
  if (!cors) return new NextResponse(null, { status: 403 });
  return new NextResponse(null, { status: 204, headers: cors });
}

export async function POST(req: NextRequest, ctx: RouteCtx): Promise<NextResponse> {
  const requestId = randomUUID();
  const { token } = await ctx.params;

  const pre = await preflight(req, token, requestId);
  if (pre instanceof NextResponse) return pre;
  const { cors, session } = pre;

  const rl = await checkRateLimit(
    `webchat_msg:${session.conversation_id}`,
    RATE_LIMIT_POST_PER_MIN,
    60,
  );
  if (!rl.allowed) {
    return fail("rate_limited", "Too many requests.", 429, {
      requestId,
      headers: { ...cors, "Retry-After": "60" },
    });
  }

  let parsed: z.infer<typeof PostSchema>;
  try {
    parsed = PostSchema.parse(await req.json());
  } catch {
    return fail("invalid_request", "mensagem vazia ou longa demais", 400, {
      requestId,
      headers: cors,
    });
  }

  const admin = createAdminClient();

  const { data: inserida, error: msgErr } = await admin
    .from("messages")
    .insert({
      organization_id: session.organization_id,
      conversation_id: session.conversation_id,
      contact_id: session.contact_id,
      channel_session_id: null,
      type: "text",
      direction: "inbound",
      status: "received",
      sent_via: "system",
      body: parsed.body,
    })
    .select("id, sent_at")
    .maybeSingle();

  if (msgErr || !inserida) {
    logger.error("[webchat.messages] insert failed", {
      organizationId: session.organization_id,
      conversationId: session.conversation_id,
      errorCode: msgErr?.code,
      errorMessage: msgErr?.message,
    });
    return fail("internal_error", "não foi possível registrar a mensagem", 500, {
      requestId,
      headers: cors,
    });
  }

  const agora = new Date().toISOString();
  await admin
    .from("conversations")
    .update({
      last_message_at: agora,
      last_inbound_at: agora,
      last_message_preview: parsed.body.slice(0, 280),
      // Mensagem nova reabre conversa resolvida: quem voltou a falar está
      // esperando resposta, e deixá-la fora do inbox é perder a pessoa.
      status: "open",
    })
    .eq("id", session.conversation_id)
    .eq("organization_id", session.organization_id)
    .in("status", ["open", "pending", "resolved", "ai_handling", "claimed"]);

  // Barramento: os mesmos dois eventos do ingest de WhatsApp. Fire-and-forget —
  // falhar aqui não pode derrubar a mensagem que já está gravada.
  const payloadComum = {
    organization_id: session.organization_id,
    conversation_id: session.conversation_id,
    contact_id: session.contact_id,
    channel_session_id: null,
    inbound_message_id: inserida.id,
  };

  void admin
    .rpc("emit_event" as never, {
      p_event_type: "ai_agent.dispatch_requested",
      p_entity_kind: "message",
      p_entity_id: inserida.id,
      p_payload: payloadComum,
      p_metadata: { source: "webchat", request_id: requestId },
      p_organization_id: session.organization_id,
    } as never)
    .then(({ error }) => {
      if (error) logger.error("[webchat.messages] emit dispatch_requested failed", { errorMessage: error.message });
    });

  void admin
    .rpc("emit_event" as never, {
      p_event_type: "message.received",
      p_entity_kind: "message",
      p_entity_id: inserida.id,
      p_payload: {
        conversation_id: session.conversation_id,
        contact_id: session.contact_id,
        channel_session_id: null,
        body_preview: parsed.body.slice(0, 280),
      },
      p_metadata: { source: "webchat", request_id: requestId },
      p_organization_id: session.organization_id,
    } as never)
    .then(({ error }) => {
      if (error) logger.error("[webchat.messages] emit message.received failed", { errorMessage: error.message });
    });

  return ok({ id: inserida.id, sent_at: inserida.sent_at }, { requestId, headers: cors });
}

export async function GET(req: NextRequest, ctx: RouteCtx): Promise<NextResponse> {
  const requestId = randomUUID();
  const { token } = await ctx.params;

  const pre = await preflight(req, token, requestId);
  if (pre instanceof NextResponse) return pre;
  const { cors, session } = pre;

  const rl = await checkRateLimit(
    `webchat_poll:${session.conversation_id}`,
    RATE_LIMIT_GET_PER_MIN,
    60,
  );
  if (!rl.allowed) {
    return fail("rate_limited", "Too many requests.", 429, {
      requestId,
      headers: { ...cors, "Retry-After": "10" },
    });
  }

  const sinceRaw = req.nextUrl.searchParams.get("since");
  const since = sinceRaw && !Number.isNaN(Date.parse(sinceRaw)) ? sinceRaw : null;

  const admin = createAdminClient();
  let q = admin
    .from("messages")
    .select("id, body, sent_at, sent_via, type")
    .eq("organization_id", session.organization_id)
    .eq("conversation_id", session.conversation_id)
    .eq("direction", "outbound")
    .order("sent_at", { ascending: true })
    .limit(50);

  if (since) q = q.gt("sent_at", since);

  const { data, error } = await q;
  if (error) {
    logger.error("[webchat.messages] poll failed", {
      organizationId: session.organization_id,
      conversationId: session.conversation_id,
      errorMessage: error.message,
    });
    return fail("internal_error", "não foi possível carregar as mensagens", 500, {
      requestId,
      headers: cors,
    });
  }

  return ok({ messages: data ?? [] }, { requestId, headers: cors });
}
