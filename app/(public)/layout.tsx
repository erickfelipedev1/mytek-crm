import { branding } from "@/lib/branding";

/**
 * Chrome das telas públicas (entrar, criar conta).
 *
 * O logo fica AQUI, e não dentro de cada página: as duas telas são a mesma
 * superfície de marca, e duas cópias do mesmo cabeçalho divergem na primeira
 * troca de arte. Quem não configurou logo não ganha espaço vazio — o bloco só
 * existe quando há o que mostrar.
 */
export default function PublicLayout({ children }: { children: React.ReactNode }) {
  const brand = branding();

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="w-full max-w-sm">
        {brand.logoUrl && (
          <div className="mb-6 flex justify-center">
            {/* <img> em vez de next/image pelo mesmo motivo da sidebar: a URL
                vem do .env de quem hospeda, e next/image exige allowlist de
                domínios fechada em build.

                alt="" (decorativo) porque as duas páginas já dizem o nome da
                marca em texto logo abaixo — com alt preenchido, o leitor de
                tela anunciaria a mesma marca duas vezes seguidas. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={brand.logoUrl}
              alt=""
              className="h-12 w-auto max-w-[9rem] object-contain"
            />
          </div>
        )}
        {children}
      </div>
    </div>
  );
}
