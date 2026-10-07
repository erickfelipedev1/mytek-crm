import type { MetadataRoute } from "next";

import { marcaDaSaida } from "@/lib/branding/saida";

/**
 * Manifesto do PWA: é o que deixa o CRM instalável ("Adicionar à tela de
 * início") e aberto em tela cheia, como app de celular.
 *
 * ─── Dinâmico de propósito ──────────────────────────────────────────────────
 * A imagem self-host é UMA SÓ para todas as marcas (mesmo motivo de
 * `app/icon.tsx`): um `manifest.json` estático em `public/` instalaria o app de
 * todo revendedor com o NOSSO nome e a NOSSA cor. Nome e cor saem do mesmo
 * resolvedor que pinta a aba e os e-mails (`marcaDaSaida`), que nunca lança.
 * Os ícones apontam para `/pwa-icon`, que desenha a marca em runtime.
 *
 * `force-dynamic`: sem isto o `next build` congelaria a marca de quem buildou.
 *
 * ⚠️ `/manifest.webmanifest` precisa estar em `PUBLIC_PATHS` — o navegador o
 * pede ANTES de existir sessão e sem cookie; o matcher do `proxy.ts` só
 * dispensa caminho com extensão conhecida, e `.webmanifest` não é uma delas.
 */
export const dynamic = "force-dynamic";

export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const marca = await marcaDaSaida(null);
  return {
    id: "/app",
    name: marca.nome,
    // Embaixo do ícone, no celular, cabem ~12 caracteres antes de cortar.
    short_name: marca.nome.length > 12 ? (marca.nome.split(/\s+/)[0] ?? marca.nome).slice(0, 12) : marca.nome,
    description: "Atendimento e vendas por WhatsApp, com agentes de IA.",
    start_url: "/app",
    scope: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: marca.accent,
    lang: "pt-BR",
    icons: [
      { src: "/pwa-icon?s=192", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/pwa-icon?s=512", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/pwa-icon?s=512&maskable=1", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
