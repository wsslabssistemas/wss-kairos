import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSkillFormConfig } from "@/lib/skill";
import { computeDueTouches, historicoPorContato } from "@/lib/cadence";
import { computeDue, stagesWithoutRecurrence, stagesForaDeJogo } from "@/lib/recurrence";
import { computeRenovacoes } from "@/lib/renovacao";
import { construirFila, comCarimbo, type ItemDaFila } from "@/lib/fila";
import { lerTudo } from "@/lib/paginado";
import { paraE164BR } from "@/lib/phone";
import { idsComGemeoAtivo } from "@/lib/gemeo";

// A CARGA DA FILA — ler o banco e montar a lista de conversas devidas.
//
// ⚠ POR QUE ESTE ARQUIVO EXISTE, e por que ele nasceu ANTES do motor.
//
// A montagem da fila já morava em `lib/fila.ts` (lógica pura), mas a CARGA —
// quais contatos, quais interações, qual manifesto — vivia dentro de
// `/painel/fila/page.tsx`. Enquanto só a tela precisava dela, isso passava.
//
// O motor proativo precisa da mesma lista, e não tem tela. Copiar a carga para
// dentro dele criaria **duas filas divergindo em silêncio** — que não é risco
// teórico nesta casa: é exatamente o que aconteceu quando o Painel inicial
// montava as SUAS cinco listas próprias e a regra "uma pessoa, um motivo" não
// valia lá. A mesma aluna aparecia em três lugares e ninguém sabia qual estava
// certo.
//
// E a divergência aqui seria pior que a de antes: uma lista decide o que uma
// PESSOA faz hoje; a outra decide o que a MÁQUINA manda em nome do cliente
// pagante. Se as duas discordarem, a que erra é a que ninguém está olhando.
//
// Por isso a regra é a mesma de `lib/despacho.ts`: **um caminho só, e quem
// chama traz o cliente que tem.** A tela passa o do usuário (com RLS ligada);
// o motor passa o admin, porque não há sessão para a RLS avaliar. O
// `tenant_id` é explícito nas duas consultas de qualquer jeito — a RLS é a
// defesa, nunca a única.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ClienteSupabase = SupabaseClient<any, any, any>;

export type ContatoDaCarga = {
  id: string;
  name: string;
  phone: string | null;
  owner_id: string | null;
  journey_stage: string;
  stage_entered_at: string;
  next_action_at: string | null;
  next_action: string | null;
  next_action_note: string | null;
  contract_end: string | null;
  /** Inicio do contrato — a regua de renovacao precisa dele. Ver `lib/renovacao.ts`. */
  contract_start: string | null;
  custom: Record<string, unknown> | null;
  /** Marcado como "nao contatar" (0059). Nao entra em lista proativa nenhuma. */
  do_not_contact: boolean;
  do_not_contact_reason: string | null;
};

export type InteracaoDaCarga = {
  contact_id: string | null;
  occurred_at: string;
  direction: string;
  created_by: string | null;
  /**
   * Identificador da mensagem no provedor (`wamid`). **NULO quando a interacao
   * nao passou pela Meta** — toque registrado a mao, mensagem colada no
   * Responder, envio pelo `wa.me`.
   *
   * ⚠ E o unico jeito de separar "saiu pelo numero da empresa" de "saiu do
   * WhatsApp do vendedor", e essa distincao decide o teto do dia da automacao.
   */
  external_id: string | null;
};

export type CargaDaFila = {
  /** A fila montada, já deduplicada e ordenada por custo de furar. */
  fila: ItemDaFila[];
  /** TODOS os contatos do tenant, não só os do dono filtrado. */
  todos: ContatoDaCarga[];
  /** Todas as interações — quem chama usa para ração, placar e histórico. */
  interacoes: InteracaoDaCarga[];
  /** Última conversa por contato (qualquer direção). */
  ultimo: Record<string, string>;
  /** Toques NOSSOS por contato, na etapa atual. */
  toques: Record<string, number>;
  /** `tenants.settings` cru — ração, roteamento, modelos e teto moram aqui. */
  settings: Record<string, unknown> | null;
  /** A data de referência usada na montagem, em ISO curto. */
  hojeISO: string;
  /** Quantos contatos estao marcados como "nao contatar". Para a tela dizer. */
  naoContatar: number;
  /** Cadastros velhos escondidos por ja existir a mesma pessoa como cliente. */
  gemeosAtivos: number;
};

/**
 * Carrega e monta a fila de uma empresa.
 *
 * `ownerId` filtra a carteira ANTES da montagem — é o que faz o vendedor abrir
 * na lista dele. `null` monta a fila da empresa inteira, que é o que o gestor
 * vê e o que o motor precisa.
 *
 * ⚠ LEITURA PAGINADA, e não é otimização — é correção. O PostgREST corta em
 * 1.000 linhas SEM AVISAR. Com 273 contatos ninguém via; com os 9 mil que
 * podem entrar, a fila calcularia sobre 1.000 contatos ARBITRÁRIOS e a lista
 * do dia sairia errada com cara de certa.
 */
export async function carregarFila(entrada: {
  supabase: ClienteSupabase;
  tenantId: string;
  skillKey: string;
  /** Filtra pela carteira de um membro. `null` = a empresa inteira. */
  ownerId?: string | null;
}): Promise<CargaDaFila> {
  const { supabase, tenantId, skillKey, ownerId = null } = entrada;

  // ⚠ O MANIFESTO É LIDO COM O CLIENTE DE QUEM CHAMOU. A tela passa o do
  // usuário; o motor passa o admin, porque no agendador não existe sessão.
  //
  // Sem isto a policy `skills_read_installed` negava a leitura do agendador e
  // devolvia `null` sem erro: `stages` vinha vazio, ninguém casava com etapa
  // nenhuma, e a fila saía VAZIA. O motor então registrava, muito bem
  // comportado, "Nenhum candidato passou nas regras agora" — a frase que
  // esta casa passa o tempo todo tentando distinguir de "está quebrado".
  const { stages, cadences, recurrence, contract } = await getSkillFormConfig(skillKey, supabase);

  // ⚠ MANIFESTO SEM ETAPA É DEFEITO, NÃO OPERAÇÃO NORMAL — e precisa PARAR.
  //
  // Toda Skill instalada declara etapas; zero etapas só acontece quando a
  // leitura falhou (RLS negando, `skill_key` errada, manifesto não semeado).
  // Deixar seguir produz uma fila vazia indistinguível de um dia sem trabalho,
  // e foi exatamente assim que o agendador passou dias parecendo saudável.
  //
  // Quem chama trata: o motor grava a rodada com `erro` (e por isso ela NÃO
  // reinicia o relógio do espaçamento, ver `lib/espacamento.ts`), e a tela
  // mostra a mensagem em vez de uma lista vazia sem explicação.
  if (stages.length === 0) {
    throw new Error(
      `A Skill "${skillKey}" voltou sem nenhuma etapa. Ou a leitura de \`skills\` foi ` +
      `negada (cliente sem sessão numa policy que exige vínculo), ou a \`skill_key\` ` +
      `da empresa não existe, ou o manifesto não foi semeado no banco ` +
      `(\`node scripts/seed-skills.mjs ${skillKey}\`). A fila NÃO é vazia: ela não foi montada.`,
    );
  }

  const [cData, ixData, { data: tRow }] = await Promise.all([
    lerTudo<ContatoDaCarga>(
      (de, ate) => supabase
        .from("contacts")
        .select("id, name, phone, owner_id, journey_stage, stage_entered_at, next_action_at, next_action, next_action_note, contract_end, contract_start, custom, do_not_contact, do_not_contact_reason")
        .eq("tenant_id", tenantId)
        .is("deleted_at", null)
        .order("id")
        .range(de, ate),
      { rotulo: "contatos da fila" },
    ),
    lerTudo<InteracaoDaCarga>(
      (de, ate) => supabase
        .from("interactions")
        .select("contact_id, occurred_at, direction, created_by, external_id")
        .eq("tenant_id", tenantId)
        .order("occurred_at", { ascending: false })
        .range(de, ate),
      { rotulo: "interações da fila" },
    ),
    // A ração, o roteamento e o teto de mensagem moram em `tenants.settings`.
    // `getActiveTenant` não traz `settings` de propósito: ele roda em toda
    // página do painel e é o caminho mais quente do sistema.
    supabase.from("tenants").select("settings").eq("id", tenantId).maybeSingle(),
  ]);

  // ⚠ O HISTÓRICO É CALCULADO SOBRE **TODOS**, não sobre o recorte da carteira.
  //
  // `stage_entered_at` de todo mundo precisa entrar aqui, senão o contato de
  // outro dono ficaria sem entrada na etapa e a contagem de toques dele viria
  // zerada — e a régua colapsaria justamente quando o gestor trocasse de
  // filtro. O recorte acontece DEPOIS, na montagem.
  const { ultimo, toques } = historicoPorContato(
    ixData,
    Object.fromEntries(cData.map((c) => [c.id, c.stage_entered_at])),
  );

  // ⚠ "NAO CONTATAR" E FILTRADO AQUI, NUM PONTO SO — e esse ponto e o motivo
  // de a carga ter sido extraida antes do motor.
  //
  // A tela e o motor usam esta mesma funcao, entao marcar alguem vale para os
  // dois no mesmo instante. Se o filtro morasse na tela, o motor continuaria
  // mandando para quem pediu para sair — e seria exatamente o caso em que o
  // erro e mais caro: ninguem esta olhando quando a maquina manda.
  //
  // Fica DEPOIS do historico e ANTES da montagem, de proposito. O historico
  // precisa de todo mundo (senao a regua de quem sobra colapsa); a fila nao
  // pode ver quem esta marcado.
  const hojeISO = new Date().toISOString().slice(0, 10);

  // ⚠ E QUEM JA E CLIENTE COM OUTRO CADASTRO TAMBEM SAI — o caso Lilian.
  //
  // Ela renovou, alguem cadastrou um contato NOVO em vez de achar o que
  // existia, e o telefone foi digitado com um digito a menos. Ficaram duas
  // linhas: uma matriculada com plano anual, outra parada em `ex_aluno`. A
  // regua olhou a segunda e fez o que devia — o fundador viu na simulacao e
  // nomeou: *"nao daria para automatizar e oferecer algo para alguem ja
  // matriculado."*
  //
  // O sinal e o TELEFONE normalizado, nunca o nome: a base tem um contato
  // chamado so "Leticia" que, por prefixo, casaria com quatro Leticias
  // diferentes. Ver `lib/gemeo.ts`.
  const comGemeo = idsComGemeoAtivo(
    cData.map((c) => {
      const n = paraE164BR(c.phone);
      return { id: c.id, digitos: n.ok ? n.digitos : null, contract_end: c.contract_end };
    }),
    hojeISO,
  );

  const elegiveis = cData.filter((c) => !c.do_not_contact && !comGemeo.has(c.id));
  const contatos = ownerId ? elegiveis.filter((c) => c.owner_id === ownerId) : elegiveis;

  // AS ORIGENS MORAM EM `lib/fila.ts`, não aqui. Este arquivo lê; ele decide.
  const fila = construirFila({
    contatos: contatos.map(comCarimbo),
    ultimoContato: ultimo,
    toquesNossos: toques,
    stages,
    cadences,
    recurrence,
    renewal: contract?.renewal,
    etapaDeSaida: contract?.ended_stage ?? null,
    hojeISO,
    deps: { stagesForaDeJogo, stagesWithoutRecurrence, computeRenovacoes, computeDueTouches, computeDue },
  });

  return {
    fila,
    todos: cData,
    interacoes: ixData,
    ultimo,
    toques,
    settings: (tRow?.settings ?? null) as Record<string, unknown> | null,
    hojeISO,
    naoContatar: cData.length - elegiveis.length,
    /** Cadastros velhos escondidos porque a pessoa ja e cliente em outra linha. */
    gemeosAtivos: comGemeo.size,
  };
}
