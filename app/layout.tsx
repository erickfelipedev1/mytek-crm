import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Toaster } from "sonner";
import { branding } from "@/lib/branding";
import { ThemeProvider } from "@/lib/theme";
import { Providers } from "./providers";
import { PublicEnvScript } from "./public-env-script";
import "./globals.css";

// Geist — a mesma família do site da marca (mytek).
//
// A variável é `--font-sans`, e NÃO a antiga `--font-atkinson`: o showcase em
// `app/design/` carrega a Atkinson de verdade na variável de mesmo nome. Manter
// o nome aqui deixaria a mesma variável apontando para duas fontes diferentes
// conforme a rota — o tipo de armadilha que só aparece meses depois, quando
// alguém mexe no showcase e a fonte do app inteiro muda junto.
const geistSans = Geist({
  subsets: ["latin", "latin-ext"],
  display: "swap",
  variable: "--font-sans",
});

const geistMono = Geist_Mono({
  subsets: ["latin", "latin-ext"],
  display: "swap",
  variable: "--font-mono",
});

/**
 * Metadata dinâmica (não `export const metadata`) para a marca ser lida em RUNTIME.
 * Constante seria resolvida durante o `next build`, e a imagem self-host — que é
 * pré-buildada — carregaria a nossa marca para sempre. Ver `lib/branding.ts`.
 *
 * O `template` é o que faz a marca existir em UM lugar só: as páginas filhas
 * declaram apenas o próprio nome ("Entrar") e herdam o sufixo daqui.
 */
export function generateMetadata(): Metadata {
  const { name } = branding();
  return {
    title: {
      default: `${name} — atendimento e vendas por WhatsApp com agentes de IA`,
      template: `%s · ${name}`,
    },
    description:
      "Centralize o atendimento por WhatsApp num funil só. Agentes de IA resolvem o que dá pra resolver e passam para o time humano o que importa — com tudo registrado. Multi-tenant, LGPD-nativo, feito para operações brasileiras.",
    applicationName: name,
    authors: [{ name }],
    keywords: [
      "CRM",
      "atendimento",
      "WhatsApp",
      "IA conversacional",
      "LGPD",
      "multi-tenant",
    ],
    robots: { index: false, follow: false },
  };
}

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#faf9f6" },
    { media: "(prefers-color-scheme: dark)", color: "#161510" },
  ],
};

// Inline FOUC-prevention. Conteúdo é string literal estática (zero input do usuário),
// portanto seguro. Lê localStorage + prefers-color-scheme antes do primeiro paint.
const THEME_INIT_SCRIPT = `(function(){try{var s=localStorage.getItem('deskcomm-theme');var d=window.matchMedia('(prefers-color-scheme: dark)').matches;var r=(s==='dark'||s==='light')?s:((s==='system'||!s)&&d?'dark':'light');document.documentElement.setAttribute('data-theme',r);}catch(e){document.documentElement.setAttribute('data-theme','light');}})();`;

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="pt-BR"
      data-theme="light"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable}`}
    >
      <head>
        {/* Config pública do Supabase em runtime (imagem genérica self-host). */}
        <PublicEnvScript />
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="min-h-screen bg-bg font-sans text-text antialiased">
        <Providers>
          <ThemeProvider>{children}</ThemeProvider>
          <Toaster
            position="top-right"
            richColors
            closeButton
            duration={4000}
          />
        </Providers>
      </body>
    </html>
  );
}
