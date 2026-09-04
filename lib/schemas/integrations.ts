/**
 * Zod schema da conexão Meta Ads (Lead Ads webhook + Conversions API).
 * Ver `docs/integrations/meta-ads.md` pro passo a passo de onde tirar cada
 * campo no Meta Business/Developers.
 */
import { z } from "zod";

export const connectMetaAdsSchema = z.object({
  /** Token de acesso de longa duração (Page ou System User) com `leads_retrieval` + `ads_management`. */
  access_token: z.string().min(20).max(4000),
  /** App Secret do App Meta que entrega o webhook `leadgen` — valida `X-Hub-Signature-256`. */
  app_secret: z.string().min(10).max(200),
  /** ID numérico da Página do Facebook dona do formulário nativo. */
  page_id: z.string().regex(/^\d+$/, "Use o ID numérico da Página.").max(40),
  /** Pixel ID (ou Dataset ID) que recebe os eventos do Conversions API. */
  pixel_id: z.string().regex(/^\d+$/, "Use o ID numérico do Pixel/Dataset.").max(40),
  /** Onde o lead do formulário nativo entra no Kanban. */
  default_pipeline_id: z.string().uuid(),
  default_stage_id: z.string().uuid(),
});
export type ConnectMetaAdsInput = z.infer<typeof connectMetaAdsSchema>;
