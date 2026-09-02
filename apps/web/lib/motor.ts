// O MOTOR PROATIVO — a DECISÃO de quem falar agora, sem banco e sem rede.
//
// ⚠ POR QUE ISTO É UM ARQUIVO PURO, e não código dentro do job.
//
// As regras anti-bloqueio da tela de Automação existem desde que ela nasceu e
// **nunca foram obedecidas**: `max_per_day`, `min_hours_between`,
// `max_no_reply`, `cooldown_hours`, a janela de horário e `stop_after_days`
// eram gravadas e nenhuma linha do sistema as lia. Um formulário que salva e
// ninguém cumpre é pior que não ter o formulário: ele promete um freio que não
// existe.
//
// Escrever essas seis regras dentro de um job agendado significaria só poder
// testá-las esperando o job rodar — e regra de horário testada "rodando e
// vendo" é o mesmo defeito da repescagem: o intervalo que nunca vence se
// parece exatamente com "ainda não chegou a hora". Aqui elas são função pura
// com relógio injetado.
//
// ⚠ E O MOTOR NÃO DECIDE O QUE DIZER, NEM PARA QUEM.
// Quem escolhe a pessoa é a fila (`lib/fila.ts`), com a mesma regra do manual.
// Quem escreve é o motor de IA, com a mesma trava anti-invenção. Este arquivo
// responde uma pergunta só: **destes que a fila já escolheu, quais podem sair
// AGORA, e quantos.** Duplicar a escolha aqui criaria duas filas divergindo em
// silêncio — o defeito de `phases` × `cadence`, pela terceira vez.

import type { MotivoDaFila } from "./fila";

/** O que o motor precisa saber de cada candidato. Tudo já calculado. */
/**
 * Os motivos de saída que TIRAM a pessoa da reativação para sempre.
 *
 * ⚠ A LISTA VEM DO MANIFESTO (Lei 1). O núcleo não sabe o que é "mudou de
 * endereço" — ele sabe que existe motivo de saída e que alguns deles são
 * definitivos. Quem declara qual é qual é o segmento, em `churn_reasons`, com
 * `fora_da_campanha: true`.
 *
 * Na academia é UM só, e a curadoria já dizia por quê: *"Fora do alcance. Não
 * insistir — e é o único motivo que tira a pessoa da reativação de vez."*
 * Preço, tempo e desânimo NÃO entram: quem saiu por eles volta quando a
 * condição muda, e é exatamente para essa gente que a campanha existe.
 */
export type Candidato = {
  contactId: string;
  motivo: MotivoDaFila;
  /** Horas desde a última conversa (qualquer direção). `null` = nunca houve. */
  horasDesdeUltimoContato: number | null;
  /** Mensagens NOSSAS seguidas sem ele responder. */
  semResposta: number;
  /** Dias desde a última vez que ELE deu qualquer sinal. `null` = nunca. */
  diasSemEngajamento: number | null;
  /** Ele respondeu recentemente — dispara o cooldown. Horas, ou `null`. */
  horasDesdeRespostaDele: number | null;
  /**
   * Dias desde a entrada na etapa atual. Para o ex-aluno, é **há quanto tempo
   * ele saiu** — a data real, não a da importação.
   *
   * `null` = sem data registrada. Nesse caso o recorte NÃO barra: barrar por
   * ausência de dado tiraria a pessoa da campanha em silêncio, e "sem data" é
   * problema de cadastro, não decisão de campanha.
   */
  diasNaEtapa: number | null;
  /**
   * O motivo de saída registrado na ficha (`contacts.motivo_saida`), ou `null`.
   *
   * ⚠ ELE ERA GRAVADO E NUNCA LIDO. Até 01/set/2026 o campo existia, a tela de
   * encerramento o preenchia, a biblioteca curada dizia o que fazer com cada
   * valor — e **nenhuma linha do motor ou da fila o consultava**. O fundador
   * perguntou, sobre um ex-aluno que avisou ter se mudado: *"o sistema tem que
   * reconhecer esse público e não chamar mais o cliente?"*. A resposta era não.
   */
  motivoSaida: string | null;
  /**
   * A data em que o contrato dele termina (`AAAA-MM-DD`), ou `null`.
   *
   * ⚠ ELA EXISTE POR CAUSA DA LILIAN. Em 28/ago saiu uma mensagem de
   * reativação — *"você treinou com a gente e acabou parando"* — para uma
   * aluna com **contrato até 09/08/2027**. E para o Jeferson, com contrato até
   * janeiro. Nenhum dos dois tinha parado nada.
   *
   * A etapa dizia `ex_aluno` e estava errada: os dois foram importados como
   * ex-alunos, rematricularam depois, e a sincronização **atualiza a vigência
   * mas nunca traz ninguém de volta para a etapa ativa**. Etapa que só anda
   * para um lado mente com o tempo.
   *
   * ⚠ ETAPA É INTERPRETAÇÃO; CONTRATO CORRENDO É FATO. Por isso a vigência
   * veta aqui, no motor, e não só na sincronização: consertar a origem do dado
   * é necessário e não é suficiente — o dia em que a etapa estiver errada de
   * novo, por qualquer caminho, esta linha continua segurando a mensagem.
   */
  contratoAte?: string | null;
};

export type RegrasDoMotor = {
  /**
   * Os motivos de saída que encerram a reativação, vindos do MANIFESTO.
   *
   * ⚠ NÃO É CONFIGURAÇÃO DA EMPRESA, é curadoria do ramo. Deixar isso na tela
   * de Automação faria cada academia decidir sozinha se "mudou de endereço"
   * tem volta — e a resposta não depende da empresa, depende do negócio.
   * Vazio quando o segmento não declara motivos de saída (14 dos 15 hoje).
   */
  motivos_que_encerram: string[];
  mode: "off" | "simulation" | "auto";
  max_per_day: number;
  min_hours_between: number;
  max_no_reply: number;
  cooldown_hours: number;
  window_start: number;
  window_end: number;
  stop_after_days: number;
  /** O recorte da reativação, em dias. 0 = sem recorte. Ver `automation.ts`. */
  reativacao_max_dias: number;
  /** Teto de UMA rodada. 0 = só o teto do dia manda. */
  max_por_rodada: number;
};

export type Veredito =
  | { contactId: string; enviar: true }
  | {
      contactId: string;
      enviar: false;
      motivo: string;
      /**
       * Barrado pelo RECORTE da campanha, não por comportamento dele.
       *
       * ⚠ Existe para a tela poder AGRUPAR. O recorte barra centenas de
       * pessoas pelo mesmo motivo, e uma lista de 1.014 linhas iguais enterra
       * os poucos vereditos que alguém precisa de fato ler. Agrupar com a
       * contagem à vista continua honrando a regra da casa: o barrado aparece
       * e diz por quê — sumir é que não pode.
       */
      recorte?: true;
    };

export type PlanoDoMotor = {
  /**
   * Quantos candidatos o RECORTE barrou — e só ele.
   *
   * ⚠ EXISTE PARA A ESCADA DO RECORTE poder distinguir "acabou o público desta
   * faixa" de "todo mundo está em cooldown". Alargar a faixa no segundo caso
   * seria trocar um problema temporário por uma decisão permanente.
   */
  foraDoRecorte: number;
  /** `false` quando NADA sai agora — e `porque` diz o motivo, sempre. */
  ativo: boolean;
  porque: string;
  /** Só quem passou em tudo, já cortado pelo teto do dia. */
  enviar: string[];
  /** Todo mundo, com o veredito de cada um. É o que a tela mostra. */
  vereditos: Veredito[];
  /** `true` no modo simulação: gera e conta, não envia. */
  simulado: boolean;
  /**
   * A lista foi montada FORA da janela de horário — ela é o que sairia na
   * próxima abertura, não o que sai agora. Só acontece em simulação.
   */
  foraDaJanela: boolean;
};

/**
 * A JANELA DE HORÁRIO, e ela precisa suportar virar a meia-noite.
 *
 * `9 → 19` é o caso normal. `22 → 6` é madrugada, e uma comparação ingênua
 * (`h >= inicio && h < fim`) devolveria SEMPRE falso — a automação nunca
 * rodaria e ninguém saberia por quê, porque "não enviou nada" se parece com
 * "não havia nada para enviar".
 *
 * `inicio === fim` significa 24 horas. Zero horas seria a leitura alternativa
 * e é a errada: quem digita o mesmo número duas vezes quer "sempre", não
 * "nunca", e "nunca" é silencioso.
 */
export function dentroDaJanela(hora: number, inicio: number, fim: number): boolean {
  if (inicio === fim) return true;
  if (inicio < fim) return hora >= inicio && hora < fim;
  return hora >= inicio || hora < fim;
}

/**
 * O plano do motor para AGORA.
 *
 * `enviadosHoje` vem do banco (contagem de saídas do dia), não de um contador
 * próprio: contador paralelo diverge em silêncio, e divergência num freio só
 * aparece na fatura — é a mesma lição de `cota-db.ts`.
 */
export function planejar(entrada: {
  /** O dia da EMPRESA (`AAAA-MM-DD`), para comparar com a vigência do contrato. */
  hojeISO?: string;
  /**
   * A NOTA DA META SOBRE O NÚMERO — e o motor se molda a ela sozinho.
   *
   * ⚠ POR QUE AUTOMÁTICO. O vigia já PERGUNTA a qualidade a cada 15 minutos e
   * a tela já diz o que fazer ("PARE de ampliar", "PARE a campanha"). Mas isso
   * dependia de alguém abrir a tela e reagir — e a queda de qualidade acontece
   * num sábado, num feriado, às 22h. Quando a pessoa vê, a Meta já restringiu.
   *
   * ⚠ ELE SÓ SABE FREAR, NUNCA ACELERAR. Qualidade alta não aumenta nada além
   * do que foi configurado: subir o teto sozinho seria a máquina decidindo
   * gastar mais dinheiro do cliente. Frear é prudência; acelerar é decisão de
   * gente.
   *
   * ⚠ E `desconhecida` NÃO FREIA. Número novo, vigia sem registro ou Meta fora
   * do ar caem aí — barrar por ausência de informação calaria a campanha sem
   * defeito nenhum, que é a mesma classe do recorte que barra por falta de
   * dado. Sem saber, vale o que a pessoa configurou.
   */
  qualidade?: "alta" | "media" | "baixa" | "desconhecida" | null;
  candidatos: Candidato[];
  regras: RegrasDoMotor;
  enviadosHoje: number;
  /**
   * A hora local DA EMPRESA, 0–23.
   *
   * ⚠ NUNCA `new Date().getHours()` DIRETO. O servidor da Vercel roda em UTC,
   * e o Brasil é UTC-3: às 18h de Porto Alegre o processo acha que são 21h.
   * Com a janela padrão de 9h–19h, isso significava **a automação nunca rodar
   * à tarde** e rodar às 6h da manhã — e o sintoma foi o fundador dizendo
   * "não estou conseguindo puxar a simulação, não gera lista nenhuma".
   *
   * Quem converte é `lib/motor-db.ts`, com o fuso da empresa. Esta função
   * continua pura e recebe o número pronto.
   */
  horaLocal: number;
  /**
   * ⚠ A SIMULAÇÃO IGNORA A JANELA; O ENVIO NUNCA.
   *
   * O fundador confere a lista NOME POR NOME antes de disparar — se alguém já
   * é aluno, se é convênio, se nunca foi cliente. Esse trabalho leva tempo e
   * ele quer fazer às 8h, antes de abrir a academia. Com a janela valendo na
   * simulação, a resposta às 8h era "fora do horário", e a conferência só
   * podia começar quando a campanha já podia sair — o pior momento possível.
   *
   * A janela existe para proteger QUEM RECEBE, não para atrapalhar quem
   * prepara. Simular não manda mensagem nenhuma.
   *
   * ⚠ E O PLANO DIZ QUE IGNOROU. Mostrar a lista sem avisar faria a pessoa
   * concluir que aquilo sairia agora — e a diferença entre "sai" e "sairia às
   * 9h" é a única coisa que ela precisa saber neste momento.
   */
  ignorarJanela?: boolean;
}): PlanoDoMotor {
  const { candidatos, regras, enviadosHoje, horaLocal, ignorarJanela = false } = entrada;
  /**
   * O "hoje" para comparar com a vigência do contrato.
   *
   * ⚠ PARÂMETRO, e não `new Date()` dentro do laço: função pura é o que permite
   * testar a borda (contrato que vence HOJE) sem depender do relógio de quem
   * roda o teste. Quem chama passa o dia da EMPRESA (`lib/fuso.ts`), nunca o
   * do servidor — foi o defeito de 20/ago e ele não volta por esta porta.
   */
  const hojeISO = entrada.hojeISO ?? new Date().toISOString().slice(0, 10);

  const vazio = (porque: string): PlanoDoMotor => ({
    ativo: false, porque, enviar: [], vereditos: [], foraDoRecorte: 0,
    simulado: regras.mode === "simulation", foraDaJanela: false,
  });

  /**
   * ⚠ O FREIO DA QUALIDADE, aplicado ANTES de qualquer conta de teto.
   *
   *   baixa  → não sai NADA de proativo. E note o que continua: RESPONDER a
   *            quem escreveu segue livre, porque responder é justamente o que
   *            RECUPERA a nota. Calar a resposta junto com a campanha pioraria
   *            o problema que o freio existe para resolver.
   *   média  → metade do teto do dia. E como a fila já ordena "quem saiu há
   *            menos tempo primeiro", cortar pela metade entrega sozinho a
   *            outra metade da recomendação da Meta: falar com quem esfriou há
   *            menos tempo, que bloqueia menos.
   */
  const nivel = entrada.qualidade ?? "desconhecida";
  if (nivel === "baixa") {
    return vazio(
      "A Meta baixou a qualidade do número para BAIXA. O envio proativo está " +
      "parado sozinho até a nota melhorar — insistir agora é o caminho para " +
      "perder o número. Responder a quem escreveu continua normal, e é o que " +
      "recupera a nota.",
    );
  }
  const tetoDoDia = nivel === "media"
    ? Math.floor(regras.max_per_day / 2)
    : regras.max_per_day;

  if (regras.mode === "off") return vazio("A automação está desligada.");

  const foraDaJanela = !dentroDaJanela(horaLocal, regras.window_start, regras.window_end);
  if (foraDaJanela && !ignorarJanela) {
    return vazio(
      `Fora da janela de horário (${regras.window_start}h às ${regras.window_end}h). ` +
      `Agora são ${horaLocal}h na empresa.`,
    );
  }

  const doDia = tetoDoDia - enviadosHoje;
  if (doDia <= 0) {
    return vazio(
      nivel === "media"
        ? `Qualidade MÉDIA: o teto do dia caiu para ${tetoDoDia} (metade de ${regras.max_per_day}) e já foi atingido — ${enviadosHoje} saíram.`
        : `O teto do dia (${tetoDoDia}) já foi atingido: ${enviadosHoje} saíram.`,
    );
  }

  // ⚠ O MENOR DOS DOIS MANDA. O teto do dia protege o número; o da rodada
  // espalha o TRABALHO — resposta vem em onda, e 40 de uma vez viram seis
  // conversas simultâneas para quem estiver atendendo.
  const resta = regras.max_por_rodada > 0
    ? Math.min(doDia, regras.max_por_rodada)
    : doDia;

  const vereditos: Veredito[] = [];
  const enviar: string[] = [];

  for (const c of candidatos) {
    const nao = (motivo: string) => vereditos.push({ contactId: c.contactId, enviar: false, motivo });

    // ⚠ O RECORTE DA CAMPANHA, e ele vem ANTES das regras de comportamento de
    // propósito: quem está fora do lote não devia nem ser avaliado, e um
    // veredito dizendo "cooldown" para alguém que saiu há três anos manda a
    // pessoa procurar um problema que não existe.
    //
    // ⚠ NÃO CHAME DE EX-ALUNO QUEM TEM CONTRATO CORRENDO. Vem ANTES de todos
    // os outros vetos porque é o único que protege a RELAÇÃO, não o número: as
    // outras regras adiam uma mensagem, esta impede a mensagem errada.
    //
    // O caso de 28/ago: reativação enviada para dois contratos até 2027, e os
    // dois por motivos DIFERENTES — a distinção importa e o texto do veredito
    // não pode escolher um lado.
    //
    //   • A Lilian rematriculou e a etapa não acompanhou: ela é aluna, paga em
    //     dia, e "você acabou parando" lê como a academia não saber quem ela é.
    //   • O Jeferson fez o anual, pagou três meses e abandonou sem cancelar: a
    //     etapa estava CERTA, ele saiu mesmo. O contrato é que continua no
    //     papel, com dívida junto.
    //
    // ⚠ O VETO SERVE AOS DOIS, O DIAGNÓSTICO NÃO. Para ela "corrija o
    // cadastro" é a ação certa; para ele não há nada a corrigir, e mandar
    // consertar o que está certo faz a pessoa desconfiar do aviso na próxima
    // vez. Por isso o texto DESCREVE O FATO — o contrato corre — e nomeia as
    // duas causas possíveis, sem afirmar qual é.
    //
    // ⚠ E O JEFERSON É UM TERCEIRO ESTADO QUE O PRODUTO AINDA NÃO TEM:
    // abandonou com contrato aberto e valor em atraso. Ele não é aluno ativo
    // nem ex-aluno, e a conversa dele é retomada + cobrança — nenhuma das duas
    // réguas que existem. Enquanto esse estado não existir, ele fica visível
    // no veredito da simulação e em nenhuma fila. Está anotado, não resolvido.
    //
    // ⚠ E O DEFEITO NÃO ESTAVA AQUI, estava na etapa. É de propósito: dado
    // errado chega por caminhos que ninguém previu, e o veto de última hora é
    // o que sobra quando a origem falha. Vale só para `reativacao` — na
    // renovação, contrato correndo é exatamente o motivo de falar.
    // ⚠ MOTIVO DE SAÍDA DEFINITIVO — quem avisou que foi embora não é chamado
    // de novo. Vem ANTES até do veto de contrato, porque aqui não há dúvida a
    // resolver: a pessoa DISSE, alguém registrou, e a biblioteca do ramo já
    // classificou aquele motivo como sem volta.
    //
    // ⚠ E ISTO É A REGRA CURADA FINALMENTE SENDO CUMPRIDA. O manifesto da
    // academia diz, sobre mudança de endereço: "Fora do alcance. Não insistir
    // — e é o único motivo que tira a pessoa da reativação de vez." A frase
    // estava escrita desde que a Skill nasceu, o campo era preenchido pela
    // tela de encerramento, e o motor nunca leu nenhum dos dois.
    //
    // Vale SÓ para a reativação: numa renovação, quem se mudou pode continuar
    // cliente à distância dependendo do ramo, e o motivo de saída nem existe.
    if (
      c.motivo === "reativacao" &&
      c.motivoSaida &&
      regras.motivos_que_encerram.includes(c.motivoSaida)
    ) {
      vereditos.push({
        contactId: c.contactId,
        enviar: false,
        motivo:
          `Ele registrou saída por um motivo que não tem volta ("${c.motivoSaida}"). ` +
          `A biblioteca deste ramo classifica esse motivo como fora de alcance — ` +
          `insistir aqui é o caminho mais rápido para um bloqueio.`,
      });
      continue;
    }

    if (c.motivo === "reativacao" && c.contratoAte && c.contratoAte >= hojeISO) {
      vereditos.push({
        contactId: c.contactId,
        enviar: false,
        motivo:
          `O contrato dele vai até ${c.contratoAte}. Reativação é conversa de quem ` +
          `saiu, e no papel ele não saiu — pode ser rematrícula que a etapa não ` +
          `acompanhou, ou plano abandonado sem cancelar. As duas pedem outra conversa.`,
      });
      continue;
    }

    // Vale SÓ para a reativação. A renovação também mede tempo de etapa, e ali
    // etapa antiga é o CLIENTE FIEL — barrá-lo seria o recorte fazendo o
    // oposto exato do que existe para fazer.
    if (
      c.motivo === "reativacao" &&
      regras.reativacao_max_dias > 0 &&
      c.diasNaEtapa !== null &&
      c.diasNaEtapa > regras.reativacao_max_dias
    ) {
      vereditos.push({
        contactId: c.contactId,
        enviar: false,
        recorte: true,
        motivo:
          `Saiu há ${c.diasNaEtapa} dias — a campanha está recortada nos últimos ` +
          `${regras.reativacao_max_dias}. Ele volta a ser candidato quando o recorte aumentar.`,
      });
      continue;
    }

    // ⚠ PAROU DE INTERAGIR HÁ MUITO TEMPO — a regra que protege o número.
    // Insistir com quem nunca dá sinal é o padrão que faz o WhatsApp marcar a
    // conta. Vem PRIMEIRO porque é a mais grave: as outras adiam, esta veta.
    if (
      regras.stop_after_days > 0 &&
      c.diasSemEngajamento !== null &&
      c.diasSemEngajamento >= regras.stop_after_days
    ) {
      nao(`Sem nenhum sinal dele há ${c.diasSemEngajamento} dias (limite: ${regras.stop_after_days}).`);
      continue;
    }

    // Nunca engajou é DIFERENTE de parou de engajar, e por isso não cai na
    // regra acima: o ex-aluno importado nunca respondeu por aqui, e vetá-lo
    // esvaziaria a reativação inteira — que é o motivo de o motor existir.

    if (regras.max_no_reply > 0 && c.semResposta >= regras.max_no_reply) {
      nao(`Já foram ${c.semResposta} mensagens nossas sem resposta (limite: ${regras.max_no_reply}).`);
      continue;
    }

    // ⚠ COOLDOWN APÓS ELE RESPONDER. Quem acabou de responder está sendo
    // atendido por uma PESSOA — mandar toque proativo em cima disso é o
    // sistema atropelando o próprio vendedor no meio da conversa.
    if (
      regras.cooldown_hours > 0 &&
      c.horasDesdeRespostaDele !== null &&
      c.horasDesdeRespostaDele < regras.cooldown_hours
    ) {
      nao(`Ele respondeu há ${Math.floor(c.horasDesdeRespostaDele)}h — o cooldown é de ${regras.cooldown_hours}h.`);
      continue;
    }

    if (
      regras.min_hours_between > 0 &&
      c.horasDesdeUltimoContato !== null &&
      c.horasDesdeUltimoContato < regras.min_hours_between
    ) {
      nao(`Falamos com ele há ${Math.floor(c.horasDesdeUltimoContato)}h — o mínimo é ${regras.min_hours_between}h.`);
      continue;
    }

    if (enviar.length >= resta) {
      // NÃO é recusa: é o teto do dia. O texto diz isso porque "bloqueado" e
      // "amanhã" são coisas diferentes para quem lê a tela.
      nao(
        regras.max_por_rodada > 0 && resta === regras.max_por_rodada
          ? `Fica para a próxima rodada: saem ${regras.max_por_rodada} por vez.`
          : `Fica para amanhã: o teto de ${regras.max_per_day}/dia se esgota antes dele.`,
      );
      continue;
    }

    enviar.push(c.contactId);
    vereditos.push({ contactId: c.contactId, enviar: true });
  }

  // Quantos o RECORTE barrou. Sem este número, "nenhum candidato passou nas
  // regras" diria a mesma coisa para "as regras estão apertadas demais" e para
  // "a campanha está recortada em 90 dias e ninguém saiu nesse prazo" — que são
  // o defeito e o funcionamento normal, respectivamente.
  const foraDoRecorte = vereditos.filter((v) => !v.enviar && v.recorte).length;

  return {
    foraDoRecorte,
    ativo: enviar.length > 0,
    porque: enviar.length
      ? `${enviar.length} de ${candidatos.length} podem sair agora (restavam ${resta} no teto do dia).`
      : foraDoRecorte > 0 && foraDoRecorte === candidatos.length
        ? `Ninguém saiu: os ${candidatos.length} candidatos estão fora do recorte de ` +
          `${regras.reativacao_max_dias} dias. O recorte se muda em Automação.`
        : "Nenhum candidato passou nas regras agora.",
    enviar,
    vereditos,
    simulado: regras.mode === "simulation",
    foraDaJanela,
  };
}
