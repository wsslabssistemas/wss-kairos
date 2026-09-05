// A FILA DE ENVIO — uma lista só, ordenada por prioridade, sem banco.
//
// O último item do `COS_Kairos_Vende_Kairos.md`: *"o motor proativo decide QUEM
// contatar e O QUE dizer; a mensagem cai numa fila; a pessoa abre e envia pelo
// `wa.me` com um clique. Sem API, sem template aprovado, sem risco de banimento
// do número — e com a parte difícil, que é quem e o quê, já resolvida."*
//
// POR QUE UMA FILA E NÃO QUATRO TELAS. Hoje o produto sabe de quatro motivos
// para falar com alguém, e cada um mora num lugar: o combinado com data, a
// cadência de follow-up, a renovação e a recompra. Quatro listas fazem o
// vendedor escolher por qual começar — e escolher é o trabalho que ele não vai
// fazer todo dia. Uma fila decide por ele.
//
// A ORDEM NÃO É POR DATA, É POR CUSTO DE FURAR:
//   1. COMBINADO — ele prometeu voltar num dia. O cliente lembra que marcou, e
//      furar isso custa a confiança inteira.
//   2. RENOVAÇÃO — receita já vendida saindo pela porta. Reconquistar custa
//      muito mais que renovar.
//   3. FOLLOW-UP — a cadência do ramo. É a maior perda medida do piloto (8 de
//      cada 9 perdas são silêncio), mas o relógio dela é mais frouxo.
//   4. RECOMPRA — o ciclo do cliente. Importante e o que mais tolera um dia
//      a mais.
//
// Dentro de cada motivo, o mais atrasado primeiro.

export type MotivoDaFila = "combinado" | "renovacao" | "followup" | "recompra" | "lembrete" | "reativacao";

export const PESO: Record<MotivoDaFila, number> = {
  combinado: 0,
  renovacao: 1,
  followup: 2,
  recompra: 3,
  // ÚLTIMO DE PROPÓSITO. `lembrete` é uma data marcada SEM ninguém ter escrito
  // por quê — ela não sabe o motivo, então não pode mascarar quem sabe. Ver a
  // regra do pretexto abaixo.
  lembrete: 4,
  /**
   * ⚠ DEPOIS DE TUDO, e é o que protege a operação do dia.
   *
   * Reativação é o único motivo que fala com quem **não é cliente**. Os quatro
   * primeiros são negócio corrente: gente que espera resposta, contrato saindo
   * pela porta, lead esfriando. Com 1.200 ex-alunos entrando de uma vez contra
   * ~600 contatos ativos, qualquer peso maior faria a reativação **afogar a
   * operação** — e o vendedor passaria o dia falando com quem saiu enquanto o
   * contrato de quem ficou vence sem uma mensagem.
   *
   * A ração de 10/dia é o outro lado disso: ela garante que sobre espaço para
   * a reativação, sem que a reativação tome o espaço de ninguém.
   */
  reativacao: 5,
};

export const ROTULO: Record<MotivoDaFila, string> = {
  combinado: "Você combinou de voltar",
  renovacao: "Contrato a vencer",
  followup: "Follow-up devido",
  recompra: "Hora de chamar de volta",
  lembrete: "Data marcada, sem motivo anotado",
  // ⚠ "EX-CLIENTE", NUNCA "EX-ALUNO". O rótulo aparece na tela de QUALQUER
  // ramo — numa distribuidora, "ex-aluno" é palavra que não existe. É a Lei 1
  // no lugar mais fácil de vazar: um texto de interface que só quem opera lê,
  // e que ninguém revisa procurando vocabulário.
  reativacao: "Ex-cliente — trazer de volta",
};

/**
 * ⚠ EM QUAL MOTIVO O MAIS ATRASADO VEM PRIMEIRO — e onde ele vem POR ÚLTIMO.
 *
 * Nos quatro motivos de negócio corrente, atraso é urgência: um combinado
 * furado há 10 dias é pior que um de ontem.
 *
 * Na REATIVAÇÃO é o contrário, e a diferença é comercial, não estética. Quem
 * parou de pagar mês passado ainda lembra da academia, do professor e do
 * horário; quem parou em 2023 mudou de bairro, de rotina e de vida. Ordenar
 * pelo mais atrasado colocaria os 201 de 2023 na frente dos 182 de 2026 —
 * gastando o começo da operação na conversa mais fria que existe.
 *
 * Foi a decisão do fundador em 15/ago: *"entram, mas ficam por último."*
 */
const MAIS_RECENTE_PRIMEIRO = new Set<MotivoDaFila>(["reativacao"]);

export type ItemDaFila = {
  contactId: string;
  name: string;
  phone: string | null;
  ownerId: string | null;
  motivo: MotivoDaFila;
  /** O que fazer neste toque — vem do manifesto ou da regra de renovação. */
  intencao: string;
  /** Dias de atraso. 0 = vence hoje. */
  atraso: number;
  /**
   * O que alguém anotou na ficha, quando anotou — **contexto, nunca pretexto.**
   *
   * ⚠ A DISTINÇÃO QUE ESTE CAMPO EXISTE PARA GUARDAR.
   *
   * `contacts.next_action` chegou preenchido em 257 contatos da Be Fitness e
   * `next_action_note` em ZERO. E o conteúdo do `next_action` é rótulo de
   * fluxo do sistema anterior, não algo que o cliente disse: "Retornar
   * contato", "Continuar descoberta e qualificar". Pior, ele **não é
   * invalidado quando a pessoa muda de etapa** — há 11 pessoas em "Parou de
   * responder" com "Continuar descoberta", uma matriculada com
   * "Acompanhamento do trial (Dia 2)", e a Noeli da Silva, matriculada desde
   * 22/jul, com "Continuar conversa e descobrir necessidades".
   *
   * Um rótulo desses vira pretexto errado com aparência de pretexto certo —
   * a IA escreveria "vamos continuar nossa conversa para eu entender o que
   * você procura?" para quem é aluna há 19 dias. Fluente e errado é o pior
   * defeito possível numa mensagem que sai no nome da academia.
   *
   * Então ele aparece para o HUMANO julgar, e vai para a IA marcado como
   * anotação de procedência desconhecida — nunca como o motivo do contato.
   */
  observacao?: string;
  /**
   * QUAL toque este item é, quando a ORIGEM sabe melhor que a contagem.
   *
   * ⚠ ELE EXISTE PORQUE RENOVAÇÃO NÃO SE CONTA, SE DATA. A reativação é uma
   * sequência: o 1º toque, depois o 2º, e o número sai de quantos já saíram. A
   * renovação não — ela tem TRÊS conversas diferentes presas ao vencimento (60,
   * 30 e 7 dias), e o manifesto diz que a de 60 dias **não pode nem mencionar
   * renovação**, enquanto a de 7 tem que trazer data, valor e forma de
   * pagamento.
   *
   * Se o texto fosse escolhido pela CONTAGEM, quem só recebesse o primeiro
   * toque a 5 dias do vencimento receberia a pergunta sobre resultado — e o
   * contrato venceria enquanto a gente conversava sobre outra coisa.
   *
   * `undefined` = quem lê conta os toques daquele motivo, que é o certo para
   * as origens que são sequência.
   */
  toque?: number;
};

/**
 * QUITAÇÃO — o toque só é devido se ninguém falou com a pessoa DEPOIS que ele
 * venceu.
 *
 * ⚠ ESTA É A REGRA QUE FALTAVA NO `combinado`, e a falta dela é o que fez a
 * Be Fitness ver a mesma aluna todo dia por um mês.
 *
 * As outras três origens já quitavam sozinhas, cada uma do seu jeito: a
 * cadência compara o último contato com o vencimento do passo, e recompra e
 * "esfriando" são calculadas A PARTIR do último contato, então avançam
 * sozinhas. O `combinado` não: ele é uma DATA FIXA em `next_action_at`, e
 * nada nunca a limpava. Uma vez vencida, a pessoa ficava na fila para sempre
 * — no motivo de prioridade 1, que MASCARA todos os outros. Medido na base
 * real: 233 dos 251 combinados vencidos, 74 deles com a pessoa já tendo
 * respondido depois da data.
 *
 * O padrão é o da casa: não apareceu como erro nenhum. A lista simplesmente
 * não encolhia.
 *
 * **Por que "qualquer interação" e não só a nossa.** O toque proativo existe
 * para fazer a conversa acontecer. Se ela aconteceu — ele escreveu, nós
 * respondemos, tanto faz quem começou — o motivo do toque foi cumprido, e
 * cobrar de novo é o que o fundador descreveu: falar duas vezes com quem já
 * respondeu. É também a regra que `computeDueTouches` já usava, então as
 * quatro origens passam a quitar do MESMO jeito em vez de cada uma do seu.
 *
 * O que isto NÃO faz: apagar o combinado do banco. `next_action_at` continua
 * sendo o que o vendedor escreveu. A quitação é derivada do histórico, então
 * ela se corrige sozinha — e um registro de envio que falhe não destrói o
 * compromisso, só adia a baixa. Falhar ≠ corromper, como em `paraE164BR`.
 */
export function quitado(
  ultimoContatoISO: string | undefined,
  vencimentoISO: string,
): boolean {
  if (!ultimoContatoISO) return false;
  // Comparação por DIA. O vencimento vem como data (`2026-07-12`) e a
  // interação como instante; comparar as strings cruas faria
  // "2026-07-12T14:00" perder para "2026-07-12" e o toque continuaria devido
  // no próprio dia em que foi feito.
  return ultimoContatoISO.slice(0, 10) >= vencimentoISO.slice(0, 10);
}

/**
 * Junta as quatro origens numa fila só.
 *
 * UM CONTATO APARECE UMA VEZ, pelo motivo de MAIOR prioridade. Sem isso, quem
 * está atrasado em tudo apareceria quatro vezes e a fila viraria uma lista de
 * repetições — e o vendedor mandaria quatro mensagens para a mesma pessoa no
 * mesmo dia, que é a forma mais rápida de ser bloqueado.
 */
export function montarFila(itens: ItemDaFila[]): ItemDaFila[] {
  const melhor = new Map<string, ItemDaFila>();
  // A ANOTAÇÃO SOBREVIVE À DEDUÇÃO. Ela costuma vir junto do `lembrete`, que é
  // o motivo de menor prioridade e quase sempre perde — e perder o motivo é
  // certo, perder o contexto não. Quem vai escrever a mensagem precisa saber
  // que alguém anotou alguma coisa naquela ficha.
  const anotacao = new Map<string, string>();
  for (const i of itens) if (i.observacao) anotacao.set(i.contactId, i.observacao);
  for (const i of itens) {
    const atual = melhor.get(i.contactId);
    if (!atual || PESO[i.motivo] < PESO[atual.motivo]) melhor.set(i.contactId, i);
  }
  for (const [id, obs] of anotacao) {
    const v = melhor.get(id);
    if (v && !v.observacao) melhor.set(id, { ...v, observacao: obs });
  }
  return [...melhor.values()].sort((a, b) => {
    const porMotivo = PESO[a.motivo] - PESO[b.motivo];
    if (porMotivo !== 0) return porMotivo;
    // Dentro do motivo: o mais atrasado primeiro — menos na reativação, onde
    // quem saiu há MENOS tempo é quem tem mais chance de voltar.
    const porTempo = MAIS_RECENTE_PRIMEIRO.has(a.motivo)
      ? a.atraso - b.atraso
      : b.atraso - a.atraso;
    return porTempo || a.name.localeCompare(b.name, "pt-BR");
  });
}

/**
 * CONSTRÓI A FILA INTEIRA — as quatro origens, quitadas e deduplicadas.
 *
 * ⚠ POR QUE ISTO SAIU DA TELA E VIROU FUNÇÃO.
 *
 * A regra "uma pessoa, um motivo" existia — mas só dentro de `/painel/fila`,
 * porque a montagem morava no componente. O Painel inicial montava CINCO
 * listas próprias e independentes ("Você combinou de voltar", "Contratos a
 * vencer", "Hora de chamar de volta", "Leads esfriando", "Para hoje"), sem
 * nenhuma dedução entre elas. A mesma aluna aparecia em três delas ao mesmo
 * tempo, e o vendedor não tinha como saber que era a mesma pessoa.
 *
 * Regra que ficou escrita: **fila é lógica, não é tela.** Lista de quem
 * contatar que não passa por aqui vai divergir — e vai divergir em silêncio,
 * porque duas listas erradas parecem duas listas.
 *
 * `phases` × `cadence` são a MESMA coisa declarada duas vezes no manifesto —
 * `convertido` da academia tem 4 fases (7/30/60/90) e a cadência
 * `pos_matricula` com os mesmos 4 passos. `computeDueTouches` lê a cadência e
 * quita; o `computeAlerts` da agenda lê as fases e emite UMA LINHA POR FASE
 * VENCIDA, sem quitação nenhuma — por isso 313 matriculadas geravam duas
 * pendências cada. Aqui vale a cadência, uma só; a agenda continua sendo o
 * calendário, não a fila de trabalho.
 */
export function construirFila(params: {
  contatos: ContatoDaFila[];
  /** Última interação por contato (QUALQUER direção), ISO. */
  ultimoContato: Record<string, string>;
  /**
   * Quantas mensagens NOSSAS já saíram para cada contato na etapa atual.
   *
   * É o que diz em qual passo da régua a pessoa está. Sem isso a cadência
   * colapsa no acervo — ver a nota em `computeDueTouches`. Opcional para não
   * quebrar quem monta a fila sem histórico (os testes), e a ausência
   * significa "nenhum toque dado", que é o começo da régua.
   */
  toquesNossos?: Record<string, number>;
  stages: EtapaDaFila[];
  cadences: CadenciaDaFila[];
  recurrence: unknown;
  /** `contract.renewal` do manifesto — o texto de cada janela, na voz do ramo. */
  renewal?: unknown;
  /**
   * `contract.ended_stage` do manifesto: a etapa de quem SAIU.
   *
   * É o que separa reativação de follow-up. Sem ela, todo mundo em etapa de
   * perda viraria "ex-aluno" — inclusive o lead que só parou de responder e
   * nunca foi cliente.
   */
  etapaDeSaida?: string | null;
  hojeISO: string;
  deps: DepsDaFila;
}): ItemDaFila[] {
  const { contatos, ultimoContato, toquesNossos = {}, stages, cadences, recurrence, renewal, hojeISO, deps } = params;
  const foraDeJogo = deps.stagesForaDeJogo(stages);
  const itens: ItemDaFila[] = [];
  const porId = new Map(contatos.map((c) => [c.id, c]));

  // 1. COMBINADO — o compromisso que a PESSOA assumiu com o cliente.
  //
  // ⚠ A REGRA DO PRETEXTO: uma DATA não é um MOTIVO.
  //
  // O fundador pegou a Noeli da Silva na fila — matriculada desde 22/jul,
  // plano trimestral até jan/2027 — sob o rótulo "Você combinou de voltar",
  // sem nada dizendo por quê. E fez a pergunta que decide o produto: *se
  // fosse automático, com que pretexto ele abordaria? ele saberia o real
  // motivo?*
  //
  // Hoje, sem esta regra, **não saberia** — e isso é o mais grave, porque ele
  // escreveria mesmo assim. Havia uma data (24/jul) e um rótulo herdado do
  // sistema antigo ("Continuar conversa e descobrir necessidades", escrito
  // quando ela ainda era lead). A IA transformaria isso numa mensagem
  // simpática e completamente errada para quem é aluna há 19 dias.
  //
  // A separação que resolve, e que vale para o dia em que isto for
  // automático:
  //
  //   • MOTIVO é DERIVADO do estado — etapa, dias na etapa, vigência do
  //     contrato, régua do ramo. Ele é recalculado a cada abertura da tela e
  //     por isso **não envelhece**.
  //   • PRETEXTO só pode vir de FATO ESCRITO POR ALGUÉM (`next_action_note`)
  //     ou da régua curada do segmento. Texto de procedência desconhecida
  //     vira anotação, não pretexto.
  //
  // Sem nota, o combinado não some — ele vira `lembrete`, que é o motivo de
  // MENOR prioridade justamente para não mascarar quem sabe o porquê. No caso
  // da Noeli, o motivo que aparece passa a ser o certo: a cadência
  // `pos_matricula` do dia 7 ("Primeira semana: como foi vir, e o que já
  // mudou na rotina"), vencida há 12 dias e nunca feita.
  //
  // É a mesma trava anti-invenção do Responder, aplicada um nível acima: lá
  // ela impede inventar o preço; aqui, inventar o assunto.
  for (const c of contatos) {
    if (!c.next_action_at || c.next_action_at > hojeISO) continue;
    if (foraDeJogo.has(c.journey_stage)) continue;
    if (quitado(ultimoContato[c.id], c.next_action_at)) continue;
    const nota = c.next_action_note?.trim();
    const rotulo = c.next_action?.trim();
    itens.push({
      contactId: c.id, name: c.name, phone: c.phone, ownerId: c.owner_id,
      motivo: nota ? "combinado" : "lembrete",
      intencao: nota
        ? `Retomar o que ficou combinado: ${nota}`
        : "Alguém marcou esta data no sistema, mas ninguém anotou o motivo. Abra a ficha e confira o histórico antes de escrever — não invente o assunto.",
      atraso: Math.round((Date.parse(hojeISO) - Date.parse(c.next_action_at)) / 86400000),
      ...(nota ? {} : rotulo ? { observacao: `anotado na ficha: "${rotulo}"` } : {}),
    });
  }

  // 2. RENOVAÇÃO — receita já vendida saindo pela porta.
  //
  // ⚠ ELA TAMBÉM QUITA, e a falta disso era um bug ao vivo (15/ago). A
  // Luciana mandou a mensagem para a Bruna Cristina e a viu de volta na fila:
  // a renovação é calculada só a partir de `contract_end`, então a pessoa
  // ficava na lista **todos os dias** até o contrato mudar.
  //
  // Era o mesmo defeito do `combinado`, no único dos quatro motivos que tinha
  // escapado — e o comentário acima afirmava que "as outras três já quitavam
  // sozinhas" sem reparar que a renovação não era uma delas. Ocorrência
  // corrigida não fecha classe; a classe aqui é **todo motivo precisa de uma
  // data a partir da qual uma conversa o cumpre.**
  //
  // Um toque por janela: falou depois que a janela abriu, está feito, e volta
  // quando a próxima abrir (60 → 30 → 7 → vencido). Cada janela é uma conversa
  // diferente, com outro texto — por isso a seguinte não fica quitada junto.
  for (const r of deps.computeRenovacoes(contatos, foraDeJogo, undefined, renewal)) {
    const c = porId.get(r.contactId);
    if (!c) continue;
    if (r.janelaAbriuEm && quitado(ultimoContato[r.contactId], r.janelaAbriuEm)) continue;
    itens.push({
      contactId: r.contactId, name: r.name, phone: r.phone, ownerId: c.owner_id,
      motivo: "renovacao", intencao: r.intencao,
      atraso: r.vencido ? Math.abs(r.diasParaVencer) : 0,
      // ⚠ O TOQUE VEM DA JANELA, não da contagem — ver `toque` em `ItemDaFila`.
      // A ordem é a da conversa (resultado → continuidade → condição), e o
      // vencido usa a mesma da condição: quem já venceu precisa de data, valor
      // e forma de pagamento, não de uma pergunta sobre resultado.
      toque: r.janela === "resultado" ? 1 : r.janela === "continuidade" ? 2 : 3,
      // O AVISO VAI JUNTO ATÉ A TELA. Vencimento não confirmado é o caso em
      // que o motor sabe menos do que parece saber, e quem vai escrever
      // precisa ver isso antes de clicar em "preparar mensagem".
      ...(r.vencido && r.vencimentoConfirmado === false
        ? { observacao: "vigência não conferida na fonte desde antes do vencimento" }
        : {}),
    });
  }

  // 3. FOLLOW-UP — a cadência do ramo, que é a maior perda medida do piloto.
  // ⚠ SÓ A ETAPA DE QUEM SAIU É REATIVAÇÃO — e a primeira versão disto errou
  // feio, de um jeito que valia a pena escrever.
  //
  // Eu marquei como reativação toda etapa `lost` não-terminal. Isso apanhou o
  // `perdido` junto, que na academia é *"Parou de responder"* — 174 pessoas
  // que **nunca foram alunas**, só sumiram no meio da conversa. Duas coisas
  // quebravam de uma vez:
  //
  //   • O RÓTULO passaria a dizer "Ex-aluno — trazer de volta" para quem nunca
  //     pisou lá, e o manifesto tem `hard_rule` explícita contra isso: *"nunca
  //     dizer 'voltar', 'retornar' ou 'novamente' para quem nunca foi aluno."*
  //   • A PRIORIDADE cairia de 2 para 5, jogando para o fim da fila o lead que
  //     acabou de esfriar — e silêncio é 8 de cada 9 perdas medidas no piloto.
  //     Seria enterrar a tese do produto para acomodar um caso novo.
  //
  // A etapa certa é a que o manifesto declara em `contract.ended_stage`: a
  // mesma chave que a sincronização usa para mover quem sumiu da planilha.
  // Uma fonte só, e nenhuma chave de segmento escrita no núcleo (Lei 1).
  const etapaDeSaida = params.etapaDeSaida ?? null;
  for (const t of deps.computeDueTouches(contatos, ultimoContato, stages, cadences, toquesNossos)) {
    itens.push({
      contactId: t.contactId, name: t.name, phone: t.phone, ownerId: t.ownerId,
      motivo: etapaDeSaida && porId.get(t.contactId)?.journey_stage === etapaDeSaida
        ? "reativacao"
        : "followup",
      // O TEXTO VEM DO MANIFESTO NOS DOIS CAMINHOS. Antes, `semCadencia`
      // trocava a intenção por uma frase genérica escrita aqui no núcleo —
      // jogando fora o `goal` que o segmento já declarava. O que muda entre
      // os dois casos é só a MOLDURA: com cadência existe passo ("toque 2 de
      // 4"); sem cadência é alarme de silêncio, e dizer há quantos dias
      // ninguém fala é o que dá o tom certo para quem vai escrever.
      intencao: t.semCadencia
        ? `${t.intent} — ninguém fala com ele há ${t.daysSince} dias.`
        : `${t.intent} (toque ${t.stepNumber} de ${t.totalSteps})`,
      atraso: t.overdueDays,
    });
  }

  // 4. RECOMPRA — o ciclo do cliente conquistado.
  for (const r of deps.computeDue(contatos, ultimoContato, recurrence, deps.stagesWithoutRecurrence(stages))) {
    const c = porId.get(r.contactId);
    if (!c) continue;
    itens.push({
      contactId: r.contactId, name: r.name, phone: r.phone, ownerId: c.owner_id,
      motivo: "recompra",
      // O TEXTO É DO SEGMENTO. Antes era esta frase, escrita aqui, servindo
      // igual para o corte de 21 dias da barbearia e para a reposição de
      // estoque da distribuidora — conversas diferentes: hábito pessoal de um
      // lado, ruptura de prateleira do outro. O ciclo em dias continua sendo
      // cálculo do núcleo e entra como fato.
      intencao: `${(recurrence as { intent?: string } | null)?.intent
        ?? "Está no ponto de voltar. Sugira uma data concreta, sem cobrar a ausência."} (ciclo de ${r.intervalDays} dias)`,
      atraso: Math.max(0, r.overdueDays),
    });
  }

  return montarFila(itens);
}

/**
 * Puxa o carimbo de conferência de dentro do `custom` para o campo tipado.
 *
 * O importador grava em `custom.contrato_conferido_em` porque `custom` é o
 * saco de dados do segmento e não exige migration a cada campo novo. Mas o
 * núcleo não lê `custom` — ele leria vocabulário de mercado junto (Lei 1).
 * Esta função é a fronteira: converte um dado do segmento num fato do núcleo.
 */
export function comCarimbo<T extends { custom?: Record<string, unknown> | null }>(c: T) {
  const v = c.custom?.["contrato_conferido_em"];
  return { ...c, contrato_conferido_em: typeof v === "string" ? v : null };
}

export type ContatoDaFila = {
  id: string;
  name: string;
  phone: string | null;
  owner_id: string | null;
  journey_stage: string;
  stage_entered_at: string;
  next_action_at: string | null;
  /** Escrito por uma pessoa. É o único texto que pode virar pretexto. */
  next_action_note: string | null;
  /** Rótulo de fluxo, de procedência desconhecida. Vira anotação, nunca pretexto. */
  next_action?: string | null;
  contract_end: string | null;
  /** Quando a vigência foi conferida na fonte. Ver `lib/renovacao.ts`. */
  contrato_conferido_em?: string | null;
};

type EtapaDaFila = { key: string; label: string; terminal?: boolean; won?: boolean; lost?: boolean; goal?: string };
type CadenciaDaFila = { key: string };

/**
 * Os cálculos entram por PARÂMETRO, não por import.
 *
 * `lib/fila.ts` é o núcleo (Lei 1): ele não pode conhecer segmento, e também
 * não precisa conhecer cadência, recorrência ou vigência — ele só sabe juntar
 * e desempatar. Quem sabe calcular cada motivo continua no seu arquivo, e a
 * tela injeta. O efeito colateral útil é que a fila fica testável sem banco e
 * sem manifesto.
 */
export type DepsDaFila = {
  stagesForaDeJogo: (s: EtapaDaFila[]) => Set<string>;
  stagesWithoutRecurrence: (s: EtapaDaFila[]) => Set<string>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  computeRenovacoes: (c: any, fora: Set<string>, hoje?: Date, renewal?: any) => { contactId: string; name: string; phone: string | null; intencao: string; diasParaVencer: number; vencido: boolean; vencimentoConfirmado?: boolean; janelaAbriuEm?: string; janela?: string }[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  computeDueTouches: (c: any, ultimo: Record<string, string>, s: any, cad: any, toques?: Record<string, number>) => { contactId: string; name: string; phone: string | null; ownerId: string | null; intent: string; stepNumber: number; totalSteps: number; overdueDays: number; daysSince: number; semCadencia: boolean }[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  computeDue: (c: any, ultimo: Record<string, string>, rec: any, excl: Set<string>) => { contactId: string; name: string; phone: string | null; intervalDays: number; overdueDays: number }[];
};

/**
 * O link de um toque.
 *
 * `wa.me` com o texto já preenchido: a pessoa clica, o WhatsApp abre com a
 * mensagem escrita, ela lê, ajusta se quiser e envia. **O envio continua
 * humano**, e isso não é limitação temporária — é o que evita template
 * aprovado pela Meta e, principalmente, o que protege o número do cliente
 * pagante de ser banido por padrão de disparo.
 *
 * Devolve `null` sem telefone: link de WhatsApp sem número abre uma tela de
 * erro, e tela de erro no meio de uma fila faz a pessoa abandonar a fila.
 */
// O TEXTO É OPCIONAL, e isso não é conveniência: é o caminho de quem vai
// escrever à mão. Quando a trava anti-invenção escala, não existe texto para
// levar — e o vendedor ainda precisa abrir a conversa. Link sem texto abre o
// WhatsApp na pessoa certa e deixa o resto com quem sabe.
export function linkDeEnvio(numeroE164Digits: string | null, texto?: string): string | null {
  if (!numeroE164Digits) return null;
  return texto
    ? `https://wa.me/${numeroE164Digits}?text=${encodeURIComponent(texto)}`
    : `https://wa.me/${numeroE164Digits}`;
}
// NOTA: esta função recebe o número JÁ derivado (`lib/phone.ts` → `paraE164BR`)
// e por isso continua burra de propósito — quem sabe converter é um lugar só.
// Quando o canal virar API oficial, quem muda é `lib/envio.ts`; esta linha
// segue igual, porque link para humano clicar não deixa de existir: ele é o
// que sobra quando a janela de 24 horas fecha.
