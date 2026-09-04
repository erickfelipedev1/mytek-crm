import { createServer, type Server } from "node:http";
import { describe, it, expect, afterEach } from "vitest";
import { executeMetaCapi } from "@/lib/automation/actions/meta-capi";
import type { ActionCtx } from "@/lib/automation/types";

interface FakeIntegrationRow {
  oauth_access_token_encrypted: string;
  store_metadata: Record<string, unknown>;
  status: string;
}

/** Fake mínimo do admin client: só os dois métodos que a ação chama. */
function fakeAdmin(integration: FakeIntegrationRow | null, decryptedToken: string) {
  return {
    from() {
      return {
        select() {
          return this;
        },
        eq() {
          return this;
        },
        async maybeSingle() {
          return { data: integration, error: null };
        },
      };
    },
    async rpc(fn: string) {
      if (fn === "fn_decrypt_oauth") return { data: decryptedToken, error: null };
      return { data: null, error: new Error("unexpected rpc") };
    },
  } as unknown as ActionCtx["admin"];
}

function baseCtx(admin: ActionCtx["admin"], context: Record<string, unknown>): ActionCtx {
  return {
    admin,
    organizationId: "org-1",
    ruleId: "rule-1",
    ruleName: "Lead qualificado → Meta",
    requestId: "req-1",
    event: {
      id: "evt-1",
      organization_id: "org-1",
      event_type: "lead.stage_changed",
      entity_kind: "crm_lead",
      entity_id: "lead-1",
      payload: {},
      metadata: {},
      consumed_by: [],
      attempts: 0,
    },
    context,
  };
}

async function listen(server: Server): Promise<{ base: string; close: () => Promise<void> }> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  return {
    base: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

describe("executeMetaCapi", () => {
  let server: Server | undefined;

  afterEach(async () => {
    if (server) {
      await new Promise<void>((resolve) => server!.close(() => resolve()));
      server = undefined;
    }
  });

  it("meta_ads_not_connected quando não há linha em tenant_integrations", async () => {
    const ctx = baseCtx(fakeAdmin(null, "tok"), { contact: { email: "a@b.com" } });
    const result = await executeMetaCapi(ctx, {});
    expect(result.status).toBe("failed");
    expect(result.error).toBe("meta_ads_not_connected");
  });

  it("missing_pixel_id quando a conexão não tem pixel_id nem config override", async () => {
    const admin = fakeAdmin(
      { oauth_access_token_encrypted: "\\xdead", store_metadata: {}, status: "healthy" },
      "tok",
    );
    const ctx = baseCtx(admin, { contact: { email: "a@b.com" } });
    const result = await executeMetaCapi(ctx, {});
    expect(result.status).toBe("failed");
    expect(result.error).toBe("missing_pixel_id");
  });

  it("skipped quando o contato não tem e-mail nem telefone", async () => {
    const admin = fakeAdmin(
      { oauth_access_token_encrypted: "\\xdead", store_metadata: { pixel_id: "999" }, status: "healthy" },
      "tok",
    );
    const ctx = baseCtx(admin, { contact: {} });
    const result = await executeMetaCapi(ctx, {});
    expect(result.status).toBe("skipped");
    expect(result.detail?.reason).toBe("no_identifying_data");
  });

  it("sucesso: POST em /{pixel_id}/events com access_token na query e evento hasheado", async () => {
    let received: { url: string; body: string } | undefined;
    server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        received = { url: req.url ?? "", body: Buffer.concat(chunks).toString("utf8") };
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ events_received: 1 }));
      });
    });
    const { base, close } = await listen(server);

    const admin = fakeAdmin(
      { oauth_access_token_encrypted: "\\xdead", store_metadata: { pixel_id: "999" }, status: "healthy" },
      "the-token",
    );
    const ctx = baseCtx(admin, {
      contact: { email: "fulano@example.com" },
      lead: { id: "lead-1", value_cents: 10000, currency: "BRL" },
    });

    const result = await executeMetaCapi(ctx, { event_name: "Qualified Lead" }, { apiBase: base });

    expect(result.status).toBe("success");
    expect(received!.url).toContain("/v21.0/999/events");
    expect(received!.url).toContain("access_token=the-token");
    const body = JSON.parse(received!.body);
    expect(body.data[0].event_name).toBe("Qualified Lead");
    expect(body.data[0].user_data.em).toBeDefined();
    expect(body.data[0].user_data.em[0]).not.toContain("fulano"); // hasheado, não em claro
    expect(JSON.stringify(body)).not.toContain("fulano@example.com");

    await close();
  });

  it("falha HTTP: status failed com response_status", async () => {
    server = createServer((req, res) => {
      req.resume();
      req.on("end", () => {
        res.writeHead(400);
        res.end("bad request");
      });
    });
    const { base, close } = await listen(server);

    const admin = fakeAdmin(
      { oauth_access_token_encrypted: "\\xdead", store_metadata: { pixel_id: "999" }, status: "healthy" },
      "tok",
    );
    const ctx = baseCtx(admin, { contact: { email: "a@b.com" } });
    const result = await executeMetaCapi(ctx, {}, { apiBase: base });

    expect(result.status).toBe("failed");
    expect(result.detail?.response_status).toBe(400);

    await close();
  });
});
