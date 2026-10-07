import { redirect } from "next/navigation";

import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK } from "@/lib/auth/types";
import { createClient } from "@/lib/supabase/server";
import { carregarCredenciaisDaTela } from "@/lib/ai/credenciais-da-tela";
import { ConexoesShell } from "@/components/connections/ConexoesShell";

export const dynamic = "force-dynamic";

export default async function ConnectionsPage() {
  const user = await requireAuth();
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg) redirect("/app");
  if (!user.is_platform_admin && ROLE_RANK[activeOrg.role] < ROLE_RANK.admin) {
    redirect("/403");
  }

  const key = process.env.WAHA_API_KEY;
  const wahaConfigured = Boolean(
    process.env.WAHA_API_BASE_URL && key && key !== "dev_plaintext_change_me",
  );

  // A aba de IA mostra a mesma lista de `/app/ai/credentials`. Esta tela já
  // exige admin, então quem chega aqui pode gravar chave.
  const supabase = await createClient();
  const { credentials, usageMap } = await carregarCredenciaisDaTela(
    supabase,
    activeOrg.orgId,
  );

  return (
    <div className="flex h-full flex-col gap-6 p-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Conexões</h1>
        <p className="text-sm text-muted-foreground">
          Por onde seu negócio fala com o cliente — e a inteligência artificial que atende por
          ele. Conecte números por QR ou o número oficial da Meta, ligue a sua conta de IA e
          acompanhe a saúde de cada um.
        </p>
      </header>
      <ConexoesShell
        wahaConfigured={wahaConfigured}
        ia={{ credentials, usageMap, canWrite: true }}
      />
    </div>
  );
}
