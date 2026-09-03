import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { hashEmailForCapi, hashPhoneForCapi, buildCapiEventPayload } from "@/lib/meta/capi";

const sha256 = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

describe("hashEmailForCapi", () => {
  it("normaliza (trim + lowercase) antes de hashear", () => {
    expect(hashEmailForCapi("  Fulano@Example.com  ")).toBe(sha256("fulano@example.com"));
  });
  it("null para vazio/ausente", () => {
    expect(hashEmailForCapi(null)).toBeNull();
    expect(hashEmailForCapi(undefined)).toBeNull();
    expect(hashEmailForCapi("   ")).toBeNull();
  });
});

describe("hashPhoneForCapi", () => {
  it("mantém só dígitos (remove '+', espaço, traço) antes de hashear", () => {
    expect(hashPhoneForCapi("+55 11 99999-0000")).toBe(sha256("5511999990000"));
  });
  it("null para vazio/ausente", () => {
    expect(hashPhoneForCapi(null)).toBeNull();
    expect(hashPhoneForCapi("")).toBeNull();
  });
});

describe("buildCapiEventPayload", () => {
  it("monta user_data só com os campos presentes, e event_id = leadId (dedup na Meta)", () => {
    const payload = buildCapiEventPayload("Lead", {
      email: "a@b.com",
      phone: null,
      valueCents: 12345,
      currency: "BRL",
      leadId: "lead-42",
    });
    expect(payload.data).toHaveLength(1);
    const evt = payload.data[0]!;
    expect(evt.event_name).toBe("Lead");
    expect(evt.action_source).toBe("system_generated");
    expect(evt.event_id).toBe("lead-42");
    expect(evt.user_data.em).toEqual([sha256("a@b.com")]);
    expect(evt.user_data.ph).toBeUndefined();
    expect(evt.custom_data).toEqual({ value: 123.45, currency: "BRL" });
    expect(typeof evt.event_time).toBe("number");
  });

  it("sem e-mail nem telefone: user_data vazio (o chamador decide não mandar)", () => {
    const payload = buildCapiEventPayload("Lead", {});
    const evt = payload.data[0]!;
    expect(evt.user_data).toEqual({});
  });

  it("sem value/currency: custom_data ausente", () => {
    const payload = buildCapiEventPayload("Lead", { email: "a@b.com" });
    const evt = payload.data[0]!;
    expect(evt.custom_data).toBeUndefined();
  });
});
