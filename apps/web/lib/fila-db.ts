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
  /** O motivo de saída registrado no encerramento. Ver o veto em `lib/motor.ts`. */
  motivo_saida: string | null;
  /**
   * Quando alguém — pessoa ou a própria IA — declarou o atendimento encerrado.
   *
   * ⚠ ELE EXISTIA E A RÉGUA NÃO OLHAVA. Encerrar tirava a conversa da tela de
   * Conversas e não dizia nada para a fila: cinco dias depois a pessoa voltava
   * a aparecer para ser tocada, porque a cadência só conhecia toques e
   * silêncio. Com a resposta automática ligada, isso vira o looping que o
   * fundador temia — *"nem sempre a gente vai ter que ser os últimos a mandar
   * mensagem"*.
   */
  atendimento_encerrado_em: string | null;
  /**
   * Até quando o sistema não fala sozinho com esta pessoa (`AAAA-MM-DD`).
   *
   * ⚠ SILÊNCIO COM PRAZO — o estado que faltava entre `do_not_contact` (para
   * sempre) e nada (volta em cinco dias). Nasceu do Deoclécio, que pediu um
   * tempo, e da Valéria, que teve de escrever *"agora basta de pergunta"*.
   */
  pausado_ate: string | null;
  pausa_motivo: string | null;
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
  /**
   * O PAPEL da interacao: `system_initiated` (toque proativo, nosso),
   * `agent_briefing` (resposta a quem escreveu) ou `customer_message`.
   *
   * ⚠ E o que separa os DOIS BOLSOS do teto diario. Ate 3/set o teto contava
   * toda saida com `external_id` — e resposta da equipe pelo canal oficial tem
   * `external_id`. Em 3/set a campanha parou as 17h30 dizendo "o teto do dia
   * (30) ja foi atingido", e as tres ultimas saidas do dia eram a equipe
   * respondendo cliente que tinha escrito. **Dia movimentado encolhia a
   * campanha, justamente no dia em que ela funcionava.**
   */
  input_kind: string | null;
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
  /**
   * Quantos ficaram de fora por treinarem pelo convênio (Gympass/Totalpass).
   *
   * ⚠ Existe para a tela DIZER. Esconder mil pessoas em silêncio é a mesma
   * classe do `idsComGemeoAtivo`, que deixou cadastro dobrado invisível por um
   * mês: a decisão de esconder estava certa e a falta do número é que doeu.
   */
  comConvenio: number;
  /**
   * Quantos estão quietos porque o atendimento foi encerrado e nada novo
   * aconteceu depois. Aparece na tela pelo mesmo motivo dos outros dois: o que
   * o sistema esconde, alguém precisa poder ver.
   */
  encerrados: number;
  /** Quantos estão em pausa com prazo — pediram um tempo, e o prazo não venceu. */
  pausados: number;
  /**
   * Os motivos de saída do RAMO, com o que fazer em cada um.
   *
   * ⚠ Vem daqui porque a carga já leu o manifesto — pedir de novo lá em cima
   * seria uma segunda leitura do mesmo arquivo, e duas leituras do manifesto
   * são duas chances de divergirem no dia em que uma for filtrada.
   */
  churnReasons: { key: string; label: string; fora_da_campanha?: boolean; pausa_dias?: number; abordagem?: string }[];
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
  const { stages, cadences, recurrence, contract, churnReasons } = await getSkillFormConfig(skillKey, supabase);

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
        .select("id, name, phone, owner_id, journey_stage, stage_entered_at, next_action_at, next_action, next_action_note, contract_end, contract_start, custom, do_not_contact, do_not_contact_reason, motivo_saida, atendimento_encerrado_em, pausado_ate, pausa_motivo")
        .eq("tenant_id", tenantId)
        .is("deleted_at", null)
        .order("id")
        .range(de, ate),
      { rotulo: "contatos da fila" },
    ),
    lerTudo<InteracaoDaCarga>(
      (de, ate) => supabase
        .from("interactions")
        .select("contact_id, occurred_at, direction, created_by, external_id, input_kind")
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

  // ⚠ E QUEM TREINA POR CONVÊNIO TAMBÉM SAI DA LISTA — por enquanto.
  //
  // São 1.090 pessoas do Gympass e do Totalpass importadas em 4/set. Elas não
  // são leads: já treinam na academia, por outra porta. Deixá-las na fila
  // encheria a lista de quem executa com mil linhas de trabalho que não existe
  // — e a lista de trabalho morre exatamente assim, por dívida de três dígitos
  // toda manhã (é a razão de a ração existir).
  //
  // ⚠ ISTO É ESCONDER, E ESCONDER PRECISA APARECER. `comConvenio` volta na
  // carga para a tela poder dizer quantas são. A regra da casa é literal:
  // *"toda vez que o sistema esconder algo para se proteger, alguém precisa
  // ver o que foi escondido"* — foi o que custou um mês de ficha dobrada
  // invisível.
  //
  // Sai quando existir régua própria de convênio: um toque a cada um ou dois
  // meses, com assunto diferente em cada um.
  const temConvenio = (c: ContatoDaCarga) =>
    typeof (c.custom as Record<string, unknown> | null)?.convenio === "string";
  const comConvenio = cData.filter(temConvenio).length;

  // ⚠ E A CONVERSA PODE TERMINAR COM ELE — a régua fica quieta até motivo NOVO.
  //
  // Pedido do fundador, e ele nomeou a razão: *"nem sempre a gente vai ter que
  // ser os últimos a mandar mensagem, temos que aprender que o cliente também
  // pode ser o último a nos enviar mensagem"*.
  //
  // Encerrar já existia e não dizia nada para a fila: a conversa saía da tela
  // de Conversas e cinco dias depois a pessoa voltava para ser tocada, porque
  // a cadência só conhece toques dados e silêncio. Com a IA respondendo
  // sozinha, isso é o looping.
  //
  // ⚠ "MOTIVO NOVO" É DEFINIDO, e são dois — nenhum deles é o relógio:
  //
  //   • ela falou DEPOIS do encerramento (a mensagem nova reabre tudo, e a
  //     comparação é com a DATA, nunca com um interruptor);
  //   • existe um `next_action_at` marcado para depois do encerramento — o
  //     combinado que ELA pediu. Encerrar o papo de hoje não pode apagar
  //     "me chama em outubro": furar uma data que a pessoa marcou é o erro
  //     mais caro que existe aqui.
  const quietoPorEncerramento = (c: ContatoDaCarga) => {
    if (!c.atendimento_encerrado_em) return false;
    const fechou = Date.parse(c.atendimento_encerrado_em);
    if (!Number.isFinite(fechou)) return false;
    const ultimaConversa = ultimo[c.id] ? Date.parse(ultimo[c.id]) : 0;
    if (ultimaConversa > fechou) return false;
    const combinado = c.next_action_at ? Date.parse(c.next_action_at) : 0;
    if (combinado > fechou) return false;
    return true;
  };
  const encerrados = cData.filter(quietoPorEncerramento).length;

  // ⚠ E QUEM PEDIU UM TEMPO FICA EM PAZ ATÉ A DATA. A comparação é com o dia
  // da empresa, e ela expira sozinha: passada a data, a pessoa volta a ser
  // candidata sem ninguém precisar lembrar de desmarcar nada. Pausa que só
  // sai no braço é pausa que vira `do_not_contact` na prática.
  const pausado = (c: ContatoDaCarga) => !!c.pausado_ate && c.pausado_ate > hojeISO;
  const pausados = cData.filter(pausado).length;

  const elegiveis = cData.filter(
    (c) =>
      !c.do_not_contact &&
      !comGemeo.has(c.id) &&
      !temConvenio(c) &&
      !quietoPorEncerramento(c) &&
      !pausado(c),
  );
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
    churnReasons: (churnReasons ?? []) as { key: string; label: string; fora_da_campanha?: boolean; pausa_dias?: number; abordagem?: string }[],
    naoContatar: cData.length - elegiveis.length,
    /** Cadastros velhos escondidos porque a pessoa ja e cliente em outra linha. */
    gemeosAtivos: comGemeo.size,
    comConvenio,
    encerrados,
    pausados,
  };
}
