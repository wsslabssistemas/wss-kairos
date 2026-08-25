import { createClient } from "@/lib/supabase/server";

import type { RecurrenceConfig } from "./recurrence";
import type { RenewalConfig } from "./renovacao";
import type { Cadence } from "./cadence";
import type { SchedulingConfig } from "./scheduling";

export type ContactField = {
  key: string;
  label: string;
  type: string;
  options?: string[];
};
export type Phase = { key: string; label: string; offset_days: number };
export type Stage = {
  key: string;
  label: string;
  terminal?: boolean;
  won?: boolean;
  lost?: boolean;
  phases?: Phase[];
  /** Cadência de follow-up que governa esta etapa (chave em `cadences`). */
  cadence?: string;
  /**
   * O que esta etapa existe para fazer, na voz do segmento.
   *
   * ⚠ ESTE CAMPO SEMPRE EXISTIU NO MANIFESTO E O NÚCLEO O IGNORAVA — e é por
   * isso que ele está tipado agora. Etapa sem cadência declarada caía num
   * texto genérico escrito em `lib/cadence.ts` ("retome com um ângulo novo"),
   * igual para academia e para indústria, enquanto o manifesto já dizia
   * "Quebrar o gelo e descobrir o objetivo. Nunca abrir com preço." e
   * "Mix, giro, público e quem assina."
   *
   * São **39 das 80 etapas vivas** dos 15 segmentos — quase todas o miolo da
   * venda (contato, descoberta, proposta, negociação). O núcleo estava
   * escrevendo prosa de venda genérica exatamente onde a venda acontece.
   */
  goal?: string;
};

/** Config de formulário vinda do manifesto da Skill (campos são dado, não código). */
export async function getSkillFormConfig(skillKey: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("skills")
    .select("manifest")
    .eq("key", skillKey)
    .limit(1)
    .maybeSingle();

  const m =
    (data?.manifest as {
      contact_fields?: ContactField[];
      lead_sources?: string[];
      journey?: { stages?: Stage[] };
      recurrence?: RecurrenceConfig;
      vocabulary?: Record<string, string>;
      cadences?: Cadence[];
      scheduling?: SchedulingConfig;
      services?: { enabled?: boolean; label?: string; item_label?: string };
      // Vigência de contrato: nem todo ramo tem. Academia, curso, escola
      // esportiva e software vendem PERÍODO; barbearia vende corte. O núcleo
      // sabe o que é "contrato com vigência" — não o que é matrícula (Lei 1).
      contract?: {
        enabled?: boolean;
        label?: string;
        renewal?: RenewalConfig;
        /**
         * A etapa de quem SAIU — a chave vem do manifesto porque o núcleo não
         * pode conhecer o vocabulário do ramo (Lei 1). Sem ela declarada, a
         * sincronização marca o encerramento e **não mexe na etapa**, que é o
         * comportamento seguro: mover gente de etapa por engano é pior que
         * deixar parado.
         */
        ended_stage?: string;
      };
      churn_reasons?: { key: string; label: string; o_que_fazer?: string }[];
    } | null) ?? {};

  return {
    fields: m.contact_fields ?? [],
    sources: m.lead_sources ?? [],
    stages: m.journey?.stages ?? [],
    // Segmentos de recompra (barbearia, distribuidora) declaram o ciclo aqui.
    recurrence: m.recurrence ?? null,
    vocabulary: m.vocabulary ?? {},
    // Sequência de toques de follow-up por etapa.
    cadences: m.cadences ?? [],
    // Segmentos com hora marcada declaram duração e passo aqui.
    scheduling: m.scheduling ?? null,
    // Registro de atendimento com valor: só em segmento de serviço repetido.
    services: m.services ?? null,
    // Quem vende período mostra início/vencimento no cadastro e recebe as
    // três janelas de renovação (`lib/renovacao.ts`).
    contract: m.contract ?? null,
    // ⚠ POR QUE A PESSOA PAROU — lista fechada, do MANIFESTO. "Lesão" e "outra
    // academia" são vocabulário de academia; numa distribuidora o equivalente
    // é "mudou de fornecedor". Enum no banco exigiria migration a cada
    // segmento novo e quebraria a Lei 2.
    churnReasons: m.churn_reasons ?? [],
  };
}
