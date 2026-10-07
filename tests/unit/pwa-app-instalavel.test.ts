import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { isPublicPath } from "@/lib/auth/public-paths";

const RAIZ = process.cwd();

describe("app instalável (PWA)", () => {
  it("manifesto, ícone e tela offline são públicos — o navegador os busca sem sessão", () => {
    expect(isPublicPath("/manifest.webmanifest")).toBe(true);
    expect(isPublicPath("/pwa-icon")).toBe(true);
    expect(isPublicPath("/offline.html")).toBe(true);
  });

  it("as entradas são ancoradas — não abrem rotas vizinhas", () => {
    expect(isPublicPath("/pwa-icon/x")).toBe(false);
    expect(isPublicPath("/pwa-icons")).toBe(false);
    expect(isPublicPath("/admin/manifest.webmanifest")).toBe(false);
    expect(isPublicPath("/offline.html/../app")).toBe(false);
  });

  it("sw.js e offline.html não carregam nome de marca — a imagem é uma só para todas", () => {
    for (const arquivo of ["public/sw.js", "public/offline.html"]) {
      const texto = readFileSync(join(RAIZ, arquivo), "utf8").toLowerCase();
      expect(texto, arquivo).not.toMatch(/deskcomm|mytek/);
    }
  });

  it("o service worker não faz cache de dado: só navegação, só a tela offline", () => {
    const sw = readFileSync(join(RAIZ, "public/sw.js"), "utf8");
    expect(sw).toContain('event.request.mode !== "navigate"');
    expect(sw).not.toMatch(/cache\.put|cache\.addAll|cache\.match\(event\.request/);
  });
});
