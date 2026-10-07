import { redirect } from "next/navigation";

import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK } from "@/lib/auth/types";
import { createClient } from "@/lib/supabase/server";
import { carregarCredenciaisDaTela } from "@/lib/ai/credenciais-da-tela";
import { CredentialsList } from "./_components/CredentialsList";

export const dynamic = "force-dynamic";

export default async function CredentialsPage() {
  const user = await requireAuth();
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg) redirect("/app");
  if (ROLE_RANK[activeOrg.role] < ROLE_RANK.manager) {
    redirect("/403");
  }

  const supabase = await createClient();
  const { credentials, usageMap } = await carregarCredenciaisDaTela(
    supabase,
    activeOrg.orgId,
  );
  const canWrite = ROLE_RANK[activeOrg.role] >= ROLE_RANK.admin;

  return (
    <div className="flex h-full flex-col gap-6 p-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Chaves de acesso à IA</h1>
        <p className="text-sm text-muted-foreground">
          A conta de inteligência artificial é sua: você contrata direto na Anthropic,
          OpenAI ou Google e cola a chave aqui. Ela é guardada criptografada e nunca
          mais aparece na tela depois de salva — nem para você.
        </p>
      </header>
      <CredentialsList
        initialData={credentials}
        canWrite={canWrite}
        usageMap={usageMap}
      />
    </div>
  );
}
