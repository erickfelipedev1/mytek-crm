import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import { extractLeadgenEvents, verifyMetaSignature, mapLeadgenFieldData } from "@/lib/meta/leadgen";

describe("extractLeadgenEvents", () => {
  it("achata entry[].changes[] filtrando só field=leadgen", () => {
    const payload = {
      object: "page",
      entry: [
        {
          id: "page-1",
          time: 123,
          changes: [
            { field: "leadgen", value: { leadgen_id: "lg-1", form_id: "f-1" } },
            { field: "feed", value: {} as never },
          ],
        },
        { id: "page-2", changes: [{ field: "leadgen", value: { leadgen_id: "lg-2" } }] },
      ],
    };
    const out = extractLeadgenEvents(payload);
    expect(out).toEqual([
      { pageId: "page-1", value: { leadgen_id: "lg-1", form_id: "f-1" } },
      { pageId: "page-2", value: { leadgen_id: "lg-2" } },
    ]);
  });

  it("ignora changes sem leadgen_id", () => {
    const payload = { entry: [{ id: "page-1", changes: [{ field: "leadgen", value: {} }] }] };
    expect(extractLeadgenEvents(payload)).toEqual([]);
  });

  it("payload sem entry: lista vazia", () => {
    expect(extractLeadgenEvents({})).toEqual([]);
  });
});

describe("verifyMetaSignature", () => {
  const secret = "app-secret-123";
  const body = JSON.stringify({ hello: "world" });

  it("aceita HMAC-sha256 correto no formato sha256=<hex>", () => {
    const sig = `sha256=${createHmac("sha256", secret).update(body, "utf8").digest("hex")}`;
    expect(verifyMetaSignature(body, sig, secret)).toBe(true);
  });

  it("recusa assinatura errada", () => {
    expect(verifyMetaSignature(body, "sha256=deadbeef", secret)).toBe(false);
  });

  it("recusa header ausente ou sem o esquema sha256=", () => {
    expect(verifyMetaSignature(body, null, secret)).toBe(false);
    expect(verifyMetaSignature(body, "sha1=abcd", secret)).toBe(false);
  });
});

describe("mapLeadgenFieldData", () => {
  it("mapeia full_name/email/phone_number e joga o resto em custom_fields", () => {
    const mapped = mapLeadgenFieldData([
      { name: "full_name", values: ["Fulano da Silva"] },
      { name: "email", values: ["fulano@example.com"] },
      { name: "phone_number", values: ["+5511999990000"] },
      { name: "qual_seu_orcamento", values: ["10000"] },
    ]);
    expect(mapped).toEqual({
      name: "Fulano da Silva",
      email: "fulano@example.com",
      phone: "+5511999990000",
      custom_fields: { qual_seu_orcamento: "10000" },
    });
  });

  it("campos ausentes viram null, nunca lançam", () => {
    expect(mapLeadgenFieldData([])).toEqual({ name: null, email: null, phone: null, custom_fields: {} });
  });
});
