import { ImageResponse } from "next/og";

import { letraDoIcone } from "@/lib/branding/icone";
import { marcaDaSaida } from "@/lib/branding/saida";

/**
 * Ícones do app instalado (tela inicial do celular), desenhados em runtime com
 * a marca da instalação — mesma lógica e mesmos motivos de `app/icon.tsx`
 * (cor + inicial, nunca `logo_url`; nada estático em `public/`).
 *
 * `?s=` escolhe o tamanho (só 180, 192 ou 512 — valor livre deixaria qualquer
 * um pedir uma imagem de 10000px e queimar CPU). `?maskable=1` desenha para o
 * Android recortar: fundo até a borda e letra dentro da zona segura (o círculo
 * central de 80%), senão o recorte come a inicial.
 *
 * ⚠️ `/pwa-icon` precisa estar em `PUBLIC_PATHS`: o navegador o busca ao
 * instalar, sem sessão.
 */
export const dynamic = "force-dynamic";

const TAMANHOS = new Set([180, 192, 512]);

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const pedido = Number(url.searchParams.get("s"));
  const lado = TAMANHOS.has(pedido) ? pedido : 512;
  const maskable = url.searchParams.get("maskable") === "1";

  const marca = await marcaDaSaida(null);
  const letra = letraDoIcone(marca.nome);

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: marca.accent,
          color: marca.accentFg,
          fontSize: Math.round(lado * (maskable ? 0.4 : 0.6)),
        }}
      >
        {letra ?? ""}
      </div>
    ),
    {
      width: lado,
      height: lado,
      headers: {
        "cache-control": "public, max-age=60, stale-while-revalidate=600",
      },
    },
  );
}
