import { createClient } from "@/lib/supabase/server";
import type { SupabaseClient } from "@supabase/supabase-js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ClienteSupabase = SupabaseClient<any, any, any>;

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

/**
 * Config de formulário vinda do manifesto da Skill (campos são dado, não código).
 *
 * ⚠ O CLIENTE VEM DE QUEM CHAMA — e ignorar isso foi o defeito mais caro de
 * 30/ago/2026, descoberto na véspera da primeira rodada autônoma.
 *
 * Esta função criava o próprio cliente de sessão. Em toda tela isso está
 * certo: existe usuário, a policy `skills_read_installed` passa pelo vínculo
 * do tenant, e o cliente do usuário é o mais seguro que existe.
 *
 * **No agendador não existe sessão.** A consulta saía como `anon`, a policy
 * negava, e o `maybeSingle()` devolvia `null` — **sem erro, sem aviso**. Daí
 * `stages` vinha `[]`, `computeDueTouches` não achava a etapa de ninguém, a
 * fila saía VAZIA e o motor registrava, muito bem comportado, *"Nenhum
 * candidato passou nas regras agora"*.
 *
 * O estrago medido: **o motor agendado nunca conseguiu montar fila.** As 11
 * rodadas com `origem = 'agendador'` em `motor_execucoes` têm todas
 * `enviadas = 0` e `avaliados = 0`; as 61 mensagens da campanha saíram, todas,
 * do botão *Enviar agora* — que roda numa Server Action, com a sessão do
 * fundador. O painel provava que o motor funcionava; o agendador provava que
 * "não havia ninguém para falar". Nenhum dos dois era verdade.
 *
 * É a classe que o `CLAUDE.md` documenta em letras garrafais — **RLS que
 * devolve vazio não é erro** — encontrada em uma peça que roda sozinha e gasta
 * dinheiro do cliente. Guardado por `skills_client_check.mjs`.
 *
 * @param cliente Opcional. Quem roda SEM sessão (motor, cron, webhook) é
 *   obrigado a passar o seu — normalmente o admin. Sem isso a leitura volta
 *   vazia e o silêncio vira "não havia ninguém".
 */
export async function getSkillFormConfig(skillKey: string, cliente?: ClienteSupabase) {
  const supabase = cliente ?? (await createClient());
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
        /**
         * A etapa de quem tem contrato de pé.
         *
         * ⚠ Ela é o DENOMINADOR da trava da sincronização. Sem ela, "contrato
         * ativo" virava "tem cadastro", ex-aluno importado há meses entrava na
         * conta, e uma planilha correta disparava "80% sumiram" em toda
         * importação — alarme que toca sempre é alarme desligado.
         *
         * É também quem pode ser MOVIDO: só sai da etapa quem está nela.
         */
        active_stage?: string;
      };
      churn_reasons?: {
        key: string;
        label: string;
        o_que_fazer?: string;
        /**
         * ⚠ ESTE MOTIVO TIRA A PESSOA DA CAMPANHA AUTOMÁTICA.
         *
         * Ela **continua na lista de quem uma pessoa pode procurar** — o que
         * sai é o disparo automático, com o modelo aprovado que diz "você
         * acabou parando". Chamava-se `encerra_reativacao` até 02/set;
         * "encerra" prometia mais do que entrega, e nome que promete demais
         * vira decisão errada seis meses depois.
         *
         * Quem declara é o segmento, nunca o núcleo (Lei 1).
         */
        fora_da_campanha?: boolean;
        /**
         * Dias de silêncio antes de alguém procurar de novo. Só faz sentido
         * junto de `fora_da_campanha`: é o intervalo entre o motivo ter sido
         * registrado e a conversa voltar a ser apropriada.
         */
        pausa_dias?: number;
        /**
         * COMO abordar quando a conversa voltar — texto para quem escreve, não
         * para o cliente. Vai junto no prompt: sem ele, a IA reaproveitaria o
         * tom de campanha exatamente onde ele não cabe.
         */
        abordagem?: string;
      }[];
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
