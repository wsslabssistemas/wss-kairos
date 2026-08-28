// A SINCRONIZAÇÃO COM A FONTE EXTERNA — comparar a foto de hoje com o que o
// banco lembra, e transformar a diferença em fato.
//
// Sem banco e sem imports, para ser testável em Node puro.
//
// ⚠ POR QUE ISTO EXISTE, E POR QUE NÃO É UM IMPORTADOR.
//
// O sistema da academia não tem API: a verdade sobre matrícula e vigência mora
// numa planilha que o fundador atualiza. Ele viu o problema sozinho: *"toda
// vez que eu atualizar a aba Matriculas, quem virou ex-cliente vai ser
// apagado, e o sistema perde o histórico"* — e propôs que o sistema mantivesse
// uma aba própria.
//
// A recomendação foi outra, e a razão é a mesma que atravessa este projeto
// inteiro: **histórico numa planilha que um humano sobrescreve toda semana é o
// mesmo defeito com mais passos**, e ainda cria dois donos escrevendo no mesmo
// dado.
//
// A DIVISÃO QUE RESOLVE:
//
//   • A planilha é a FOTOGRAFIA DE HOJE. Um trabalho só: o que é verdade agora.
//   • O histórico é do BANCO, e nasce da COMPARAÇÃO.
//   • O sistema NUNCA escreve na planilha. Sem conflito, sem sobrescrever
//     edição de humano.
//
// **A ideia central: ausência é informação, e só o sistema enxerga.** Ele
// apaga a linha; o sistema percebe a falta *porque lembra do que havia antes*.
// O fundador não mantém histórico nenhum e ganha um histórico completo.
//
// E é a mesma comparação que resolve o caso Maria Isabel: `vigencia_ate` que
// anda para frente é uma RENOVAÇÃO, e renovação observada é fato — diferente
// de vencimento deduzido de dado velho.

/** Uma linha da fonte externa, já normalizada pelo leitor. */
export type LinhaDaFonte = {
  /** Chave de reconciliação. Na Be Fitness é o código do sistema da academia. */
  chave: string;
  nome?: string | null;
  /** ISO (YYYY-MM-DD). Ausente quando a fonte não declara vigência. */
  vigencia_ate?: string | null;
  /** Marcação derivada pelo sistema (ex.: veio da aba de convênio). */
  marcacoes?: string[];
  /**
   * O que a linha REPRESENTA — contrato, aula avulsa ou cortesia.
   *
   * ⚠ Vem da coluna `Plano`, classificada pelo manifesto do segmento
   * (`lib/planos.ts`). Ausente significa `contrato`, que é o padrão seguro:
   * plano desconhecido tratado como contrato entra na carteira e alguém
   * percebe; tratado como avulso, some da renovação em silêncio.
   */
  tipo?: "contrato" | "avulso" | "experimental";
  /**
   * O NOME do plano, cru, como veio da planilha ("Treino Avulso", "Anual").
   *
   * Fica separado de `tipo` de propósito: o nome é FATO da fonte, o tipo é
   * INTERPRETAÇÃO nossa. Guardar os dois deixa a classificação conferível — dá
   * para ver que "Semana FREE2" virou `experimental` e por quê.
   */
  plano?: string | null;
  /**
   * Duração do ciclo em dias, quando a fonte declara (Mensal=30, Anual=365…).
   *
   * ⚠ SEM ISTO, TODO PROLONGAMENTO VIRA "RENOVOU" — e a primeira execução
   * contra a planilha real da Be Fitness mostrou por que isso não serve: das
   * 7 vigências que andaram para frente, **3 eram renovação e 4 eram ajuste
   * de data** (6, 13, 20 e 21 dias). Ver `EXTENSAO_MINIMA` abaixo.
   */
  ciclo_dias?: number | null;
};

/** O que o banco lembra da última sincronização. */
export type EstadoConhecido = {
  chave: string;
  nome?: string | null;
  vigencia_ate?: string | null;
  /** Já foi baixado como encerrado numa sincronização anterior? */
  encerrado?: boolean;
  /**
   * A etapa em que a pessoa está HOJE.
   *
   * ⚠ ELA ENTROU PORQUE A TRAVA MEDIA ERRADO. "Contrato ativo" era toda pessoa
   * com código do sistema que nunca passou por uma sincronização — e na Be
   * Fitness isso somava 1.434, dos quais **996 já estavam em `ex_aluno` há
   * meses**. Uma planilha CORRETA, com 304 alunos, era comparada contra 1.434
   * e disparava "80% sumiram da fonte" em toda importação.
   */
  etapa?: string | null;
};

export type TipoDeEvento =
  | "entrou"
  | "renovou"
  | "ajuste_de_data"
  | "vigencia_recuou"
  | "encerrou"
  | "sumiu_vigente"
  | "reapareceu"
  | "sem_mudanca";

export type Evento = {
  chave: string;
  tipo: TipoDeEvento;
  de?: string | null;
  para?: string | null;
  /** Frase para o log e para a tela de conferência. Não é mensagem ao cliente. */
  descricao: string;
};

export type Resultado = {
  eventos: Evento[];
  /** Quando preenchido, NADA deve ser aplicado. Ver a trava abaixo. */
  bloqueio: string | null;
  resumo: {
    naFonte: number; noBanco: number; entraram: number; renovaram: number;
    ajustaram: number; encerraram: number; reapareceram: number;
    /** Sumiram da fonte com o contrato ainda correndo — não recebem baixa sozinhos. */
    vigentesSumidos: number;
  };
};

/**
 * ⚠ A TRAVA DA PLANILHA PARCIAL — e ela é a parte mais importante do arquivo.
 *
 * "Sumiu da fonte" só significa "encerrou" se a fonte estiver COMPLETA. Uma
 * exportação com filtro aplicado, uma aba baixada pela metade, um erro de
 * cópia — e a comparação daria baixa em massa em gente que continua pagando.
 *
 * É exatamente a classe de defeito que já custou o curso inteiro neste
 * repositório: o `seed-curso.mjs` recarregava um arquivo e derrubava oito
 * módulos ao lado, **saindo com três ✓ verdes**, porque o relatório só mostrava
 * o que ele havia escrito. *Relatório que só mostra o que a operação escreveu
 * não enxerga o que ela derrubou.*
 *
 * Por isso a trava é por PROPORÇÃO e não por número absoluto, e por isso ela
 * bloqueia em vez de avisar: aviso em operação destrutiva é aviso que alguém
 * lê depois.
 *
 * ⚠ MAS ELA TEM SAÍDA — e essa parte faltava (20/ago/2026).
 *
 * O fundador subiu a exportação de matrículas e levou "não dá para aplicar:
 * 1.129 de 1.439 sumiram da fonte (78%)". A trava fez o trabalho dela: ele foi
 * conferir. E o arquivo estava **certo** — 393 linhas de 2023 a 2026, a base
 * inteira, não um recorte. O que estava inflado era o BANCO, com contratos
 * velhos que nunca receberam baixa.
 *
 * Trava sem saída transforma "confira antes de aplicar" em "nunca aplique". O
 * objetivo dela é **fazer alguém olhar**, e quem olhou precisa poder seguir —
 * senão a pessoa contorna por fora, editando planilha até caber no limite, que
 * é o pior desfecho possível.
 *
 * Por isso o bloqueio continua sendo o padrão e passa a aceitar uma
 * confirmação EXPLÍCITA, que diz em número o que vai acontecer. Confirmar é um
 * segundo ato deliberado, não um clique a mais no mesmo botão.
 */
export const LIMITE_DESAPARECIDOS = 0.15;

/**
 * ⚠ QUANTO A VIGÊNCIA PRECISA ANDAR PARA SER RENOVAÇÃO.
 *
 * Achado na primeira execução contra a planilha real (13/ago): das 7 vigências
 * que andaram para frente, **4 eram ajuste de data** — 6, 13, 20 e 21 dias.
 * Mudança de dia de cobrança, crédito de dias parados, correção de digitação.
 *
 * Tratar ajuste como renovação erra dos dois lados, e o segundo é o caro:
 * mandaria "obrigado por renovar" para quem não renovou, **e tiraria da fila
 * de renovação alguém cujo contrato continua vencendo logo** — perdendo a
 * receita que a fila existe para proteger.
 *
 * A régua é PROPORCIONAL ao ciclo quando a fonte o declara: meio ciclo já é
 * renovação (mensal que anda 30 dias renovou; anual que anda 20 não). Sem
 * ciclo declarado, vale o piso absoluto — 28 dias, abaixo do menor ciclo real
 * que existe nos planos (mensal).
 */
export const EXTENSAO_MINIMA_DIAS = 28;
export const EXTENSAO_MINIMA_FRACAO = 0.5;

const dias = (a: string, b: string) =>
  Math.round((Date.parse(b) - Date.parse(a)) / 86400000);

/** Renovação de verdade, ou só a data andando? */
export function ehRenovacao(de: string, para: string, cicloDias?: number | null): boolean {
  const andou = dias(de, para);
  if (andou <= 0) return false;
  const minimo = cicloDias && cicloDias > 0
    ? Math.max(1, Math.round(cicloDias * EXTENSAO_MINIMA_FRACAO))
    : EXTENSAO_MINIMA_DIAS;
  return andou >= minimo;
}

/**
 * Compara a foto com o que o banco sabe.
 *
 * Não escreve nada e não decide nada — devolve os eventos e, se for o caso, o
 * motivo pelo qual a aplicação deve parar. Quem aplica é o chamador, depois de
 * mostrar ao humano.
 */
export function comparar(
  fonte: LinhaDaFonte[],
  banco: EstadoConhecido[],
  limite = LIMITE_DESAPARECIDOS,
  /**
   * A pessoa conferiu a exportação e assume a baixa em massa.
   *
   * ⚠ Só vale para o limite de desaparecidos. **Fonte VAZIA continua barrada
   * sem saída**: nenhuma confirmação torna razoável dar baixa em todo mundo a
   * partir de um arquivo sem uma linha — isso é sempre exportação quebrada,
   * nunca a realidade.
   */
  confirmado = false,
  /**
   * A etapa de quem tem contrato de pé, vinda do manifesto
   * (`contract.active_stage`). Núcleo não conhece "convertido" nem "ex_aluno".
   *
   * ⚠ `null` MANTÉM O COMPORTAMENTO ANTIGO, de propósito: manifesto que não
   * declara a etapa não pode ter a trava desligada por omissão. Sem ela, medir
   * de menos seria pior que medir demais — a trava existe para impedir baixa em
   * massa por planilha parcial.
   */
  etapaAtiva: string | null = null,
  /** O "hoje" da empresa, para saber se a vigência ainda corre. Parâmetro por testabilidade. */
  hoje: string = new Date().toISOString().slice(0, 10),
): Resultado {
  const naFonte = new Map(fonte.map((l) => [l.chave, l]));
  const noBanco = new Map(banco.map((b) => [b.chave, b]));
  const eventos: Evento[] = [];

  // ------------------------------------------------------------- O QUE ESTÁ LÁ
  for (const l of fonte) {
    // ⚠ AULA AVULSA NÃO É CONTRATO — e ignorá-la aqui é o que impede gente de
    // passagem de virar "aluno" e depois "ex-aluno".
    //
    // Na exportação da Be Fitness são 46 linhas de "Treino Avulso": turista
    // que treinou um dia. Tratá-las como contrato faz o sistema oferecer
    // RETORNO a quem nunca foi cliente — a mesma classe do Gympass, mensagem
    // plausível chegando em quem não deveria receber, no nome da academia.
    //
    // E o efeito não para na mensagem: 46 pessoas de passagem contadas como
    // carteira fazem a conversão e a retenção mentirem para baixo.
    //
    // `experimental` NÃO cai aqui de propósito: quem fez a semana grátis estava
    // avaliando a academia, e se não fechou é lead esfriado — exatamente o
    // público da reativação. Decisão do fundador em 20/ago.
    if (l.tipo === "avulso") continue;

    const b = noBanco.get(l.chave);

    if (!b) {
      eventos.push({ chave: l.chave, tipo: "entrou", para: l.vigencia_ate ?? null,
        descricao: `${l.nome ?? l.chave} não existia no sistema.` });
      continue;
    }

    // REAPARECEU: estava baixado e voltou à fonte. É renovação depois de uma
    // saída, e tratar como "entrou de novo" apagaria a história de que ele já
    // foi cliente antes — que é justamente o dado que o fundador quer manter.
    if (b.encerrado) {
      eventos.push({ chave: l.chave, tipo: "reapareceu", de: b.vigencia_ate ?? null, para: l.vigencia_ate ?? null,
        descricao: `${l.nome ?? l.chave} voltou depois de ter encerrado.` });
      continue;
    }

    const antes = b.vigencia_ate ?? null;
    const agora = l.vigencia_ate ?? null;

    if (antes && agora && agora > antes) {
      // ⚠ ISTO É O CASO MARIA ISABEL, e é a razão de a comparação existir.
      // Vencimento que anda para frente é RENOVAÇÃO OBSERVADA — fato, não
      // dedução sobre dado velho. Sem esta linha, ela seguiria como "venceu".
      //
      // Mas nem todo prolongamento é renovação: ver `ehRenovacao`. Ajuste de
      // data vira evento próprio, para não desligar a conversa de renovação
      // de quem continua vencendo logo.
      const renovou = ehRenovacao(antes, agora, l.ciclo_dias);
      eventos.push({
        chave: l.chave,
        tipo: renovou ? "renovou" : "ajuste_de_data",
        de: antes, para: agora,
        descricao: renovou
          ? `${l.nome ?? l.chave} renovou: vigência foi de ${antes} para ${agora}.`
          : `${l.nome ?? l.chave} teve a vigência ajustada em ${dias(antes, agora)} dia(s) (${antes} → ${agora}) — curto demais para ser renovação. Continua na régua de vencimento.`,
      });
      continue;
    }

    if (antes && agora && agora < antes) {
      // Vigência que ANDA PARA TRÁS quase sempre é erro de digitação ou de
      // exportação. Não é tratado como cancelamento: vira evento para alguém
      // olhar. Encurtar contrato em silêncio colocaria gente na fila de
      // renovação sem motivo.
      eventos.push({ chave: l.chave, tipo: "vigencia_recuou", de: antes, para: agora,
        descricao: `${l.nome ?? l.chave} teve a vigência ENCURTADA de ${antes} para ${agora}. Confira antes de aplicar.` });
      continue;
    }

    eventos.push({ chave: l.chave, tipo: "sem_mudanca", de: antes, para: agora, descricao: "" });
  }

  // -------------------------------------------------- O QUE SUMIU (a informação)
  // ⚠ O DENOMINADOR CONTA QUEM TEM CONTRATO DE PÉ, não quem tem cadastro.
  //
  // Antes ele contava toda pessoa com código que nunca passou por uma
  // sincronização — incluindo ex-alunos importados há meses. O efeito era uma
  // trava que gritava "80% sumiram" diante de uma planilha correta, em TODA
  // importação. **Alarme que toca sempre é alarme desligado:** ela ensinava a
  // clicar em "aplicar mesmo assim" sem ler, e no dia da planilha de verdade
  // parcial ninguém pararia.
  const comContratoDePe = banco.filter(
    (b) => !b.encerrado && (!etapaAtiva || b.etapa === etapaAtiva),
  );
  const sumidos = comContratoDePe.filter((b) => !naFonte.has(b.chave));

  // ⚠ QUEM SUMIU E JÁ ESTAVA FORA CONTINUA SENDO REGISTRADO como encerrado —
  // o carimbo é escrituração e não move ninguém. O que mudou é que ele saiu do
  // DENOMINADOR do alarme, não do relatório.
  const sumidosForaDaEtapa = banco.filter(
    (b) => !b.encerrado && etapaAtiva && b.etapa !== etapaAtiva && !naFonte.has(b.chave),
  );
  /**
   * ⚠ SUMIR DA FONTE COM CONTRATO CORRENDO É CONTRADIÇÃO, NÃO ENCERRAMENTO.
   *
   * O DEFEITO DE 28/ago. A exportação de "plano ativo" da Be Fitness trouxe
   * 304 pessoas e 27 sumiram — mas **20 delas tinham contrato até 2027**, uma
   * até agosto. Conferidos três na fonte: um cancelou de verdade, um combinou
   * pagar em duas parcelas, e **um tinha pago o ano inteiro à vista e não
   * devia nada**. A exportação não era "quem é aluno": era, na prática, uma
   * lista de cobrança em aberto.
   *
   * ⚠ E A TRAVA DOS 15% NÃO PEGA ISSO. Eram 27 de 307, 8,8% — dentro do
   * limite, sem alarme nenhum. Ela conta QUANTOS somem; esta olha QUEM some.
   * Contar não substitui conferir: 20 mensagens de "você parou de treinar,
   * quer voltar?" para alunos pagantes é dano que nenhum percentual mede.
   *
   * ⚠ E NÃO DÁ PARA SIMPLESMENTE IGNORAR: cancelamento no meio do contrato
   * existe (o caso do Jean, que se mudou). Por isso vira grupo SEPARADO, com o
   * motivo escrito, e a baixa deles exige uma confirmação PRÓPRIA — nunca a
   * mesma que autoriza passar do limite de 15%. Duas decisões diferentes com
   * uma caixa só é como se aprende a marcar tudo sem ler.
   */
  const aindaVigente = (b: EstadoConhecido) => !!b.vigencia_ate && b.vigencia_ate >= hoje;
  for (const b of sumidos) {
    if (aindaVigente(b)) {
      eventos.push({ chave: b.chave, tipo: "sumiu_vigente", de: b.vigencia_ate ?? null,
        descricao: `${b.nome ?? b.chave} sumiu da fonte, mas o contrato vai até ${b.vigencia_ate}. Pode ser cancelamento no meio do plano — ou filtro na exportação. NÃO recebe baixa sem você marcar.` });
      continue;
    }
    eventos.push({ chave: b.chave, tipo: "encerrou", de: b.vigencia_ate ?? null,
      descricao: `${b.nome ?? b.chave} não está mais na fonte e a vigência já venceu${b.vigencia_ate ? ` em ${b.vigencia_ate}` : ""} — contrato encerrado.` });
  }
  for (const b of sumidosForaDaEtapa) {
    eventos.push({ chave: b.chave, tipo: "encerrou", de: b.vigencia_ate ?? null,
      descricao: `${b.nome ?? b.chave} não está na fonte — carimbado como encerrado. Já estava fora da etapa ativa, então NÃO muda de etapa nem de data.` });
  }

  // ------------------------------------------------------------------ A TRAVA
  let bloqueio: string | null = null;
  const proporcao = comContratoDePe.length ? sumidos.length / comContratoDePe.length : 0;
  if (fonte.length === 0 && comContratoDePe.length > 0) {
    bloqueio = `A fonte veio VAZIA e o sistema conhece ${comContratoDePe.length} contratos ativos. Isso daria baixa em todos. Nada foi aplicado.`;
  } else if (proporcao > limite && !confirmado) {
    bloqueio =
      `${sumidos.length} de ${comContratoDePe.length} contratos ativos (${Math.round(proporcao * 100)}%) sumiram da fonte, ` +
      `acima do limite de ${Math.round(limite * 100)}%. Planilha parcial ou filtro aplicado dariam exatamente este resultado. ` +
      `Confira a exportação antes de aplicar — nada foi gravado.`;
  }

  return {
    eventos,
    bloqueio,
    resumo: {
      naFonte: fonte.length,
      noBanco: comContratoDePe.length,
      entraram: eventos.filter((e) => e.tipo === "entrou").length,
      renovaram: eventos.filter((e) => e.tipo === "renovou").length,
      ajustaram: eventos.filter((e) => e.tipo === "ajuste_de_data").length,
      encerraram: eventos.filter((e) => e.tipo === "encerrou").length,
      vigentesSumidos: eventos.filter((e) => e.tipo === "sumiu_vigente").length,
      reapareceram: eventos.filter((e) => e.tipo === "reapareceu").length,
    },
  };
}

/**
 * Cruza as abas de convênio com a base de cadastros, por chave.
 *
 * ⚠ POR QUE O SISTEMA DERIVA EM VEZ DE PEDIR UMA COLUNA.
 *
 * A recomendação inicial foi o fundador manter uma coluna `convenio` na aba de
 * cadastros. Ele respondeu o que fechava a questão: *"vai ter que ser manual,
 * então sem chances."* Está certo — trabalho manual recorrente é trabalho que
 * para de acontecer, e aí o dado fica errado em silêncio, que é pior.
 *
 * Então o sistema lê as abas separadas e deriva a marcação sozinho. O que se
 * perde é a GARANTIA de que as abas concordam; o que se ganha é o sistema
 * RELATAR a divergência em vez de exigir que ela seja evitada. Divergência
 * relatada é conserto; divergência silenciosa é o defeito.
 */
export function marcarPorCruzamento(
  base: LinhaDaFonte[],
  recortes: { marcacao: string; linhas: LinhaDaFonte[] }[],
): { linhas: LinhaDaFonte[]; orfaos: { marcacao: string; chaves: string[] }[] } {
  const porChave = new Map(base.map((l) => [l.chave, { ...l, marcacoes: [...(l.marcacoes ?? [])] }]));
  const orfaos: { marcacao: string; chaves: string[] }[] = [];

  for (const r of recortes) {
    const semPar: string[] = [];
    for (const l of r.linhas) {
      const alvo = porChave.get(l.chave);
      // ÓRFÃO É INFORMAÇÃO, NÃO ERRO. Alguém na aba do convênio que não está
      // na base de cadastros significa que as duas abas divergiram — e é
      // exatamente isso que se quer ver, em vez de descartar em silêncio.
      if (!alvo) { semPar.push(l.chave); continue; }
      if (!alvo.marcacoes!.includes(r.marcacao)) alvo.marcacoes!.push(r.marcacao);
    }
    if (semPar.length) orfaos.push({ marcacao: r.marcacao, chaves: semPar });
  }

  return { linhas: [...porChave.values()], orfaos };
}
