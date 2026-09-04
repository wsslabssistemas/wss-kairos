// FASE 2 — a decisão de responder sozinho, sem banco e sem rede.
//
// Arquivo puro e SEM IMPORTS, como `lib/optout.ts` e `lib/modelo.ts`: dá para
// testar em Node sem bundler, e regra de automação testada "abrindo a tela e
// vendo se parece certo" não vale nada. O erro típico aqui é o que NUNCA
// dispara — e ele se parece exatamente com "ninguém escreveu hoje".
//
// ⚠ O QUE AUTORIZOU ISTO, e o que NÃO autorizou.
//
// `interactions.origem_ia` chegou a 69 casos com 82,6% de sugestões aceitas sem
// edição. Isso mede uma coisa só: **o texto que a IA escreve é bom o bastante
// para sair como está.** Não mede se ela sabe QUANDO calar, nem o que fazer
// quando falta um fato — essas duas continuam sendo trabalho de código, e é o
// que este arquivo faz.
//
// ⚠ E O HORÁRIO NÃO ENTRA AQUI, de propósito. A janela de 9h–19h existe em UM
// lugar (`lib/motor.ts`, o motor proativo) e é decisão do fundador:
// *"mandar mensagem para quem não perguntou nada, aí sim vale a regra"*. Lead
// que escreve às 2h da manhã está no momento de intenção; restringir a resposta
// ao horário comercial remove exatamente as horas em que a automação ganha —
// que é, aliás, quando mais chega mensagem pelo Instagram e pelo Facebook.

/** O que a rodada decidiu. Espelha o `check` de `respostas_automaticas`. */
export type DecisaoDaResposta =
  | { responder: true; esperarMs: number }
  | { responder: false; decisao: "recusou" | "desistiu"; porque: string };

/**
 * A PAUSA ANTES DE RESPONDER — 20 a 40 segundos, sorteados.
 *
 * ⚠ ELA NÃO É ENFEITE, e o fundador pediu antes de eu propor. Resposta que
 * chega em 800ms anuncia robô, e anunciar robô na primeira frase é perder a
 * conversa que a campanha pagou para começar.
 *
 * ⚠ E O SORTEIO IMPORTA TANTO QUANTO A ESPERA. Trinta segundos cravados em
 * toda mensagem é padrão igual — é a mesma razão de `pausaMs` no motor variar
 * ±40%: o que denuncia máquina não é a velocidade, é a regularidade.
 *
 * ⚠ E ELA TEM UMA SEGUNDA FUNÇÃO, que é a que mais salva: **gente manda três
 * mensagens seguidas.** "Oi" · "vi a mensagem de vocês" · "quanto tá o plano?"
 * chegam em quinze segundos. Sem pausa, isso vira três respostas para uma
 * pergunta só — e a terceira responde algo que a pessoa já tinha completado.
 * A pausa é o que dá tempo de a frase inteira chegar; `desistir` faz o resto.
 */
export function pausaDaResposta(sorteio = Math.random()): number {
  const MIN = 20_000;
  const MAX = 40_000;
  const s = Math.min(1, Math.max(0, sorteio));
  return Math.round(MIN + s * (MAX - MIN));
}

/**
 * Devemos responder esta mensagem sozinhos? Decidido ANTES da pausa.
 *
 * Tudo que é barato e definitivo mora aqui: o que não muda durante os 30
 * segundos. O que PODE mudar nesse intervalo — alguém responder, chegar outra
 * mensagem — é `aindaEhAVez`, chamado depois.
 */
export function decidirResposta(entrada: {
  /** A empresa ligou a resposta automática. Padrão do produto: desligada. */
  ligado: boolean;
  /** `customer_message`, `customer_reaction`… — o papel da mensagem que chegou. */
  tipoDaMensagem: string;
  /** O texto que chegou. */
  texto: string;
  /** A pessoa pediu para não receber mais (`contacts.do_not_contact`). */
  descadastrado: boolean;
  /** A janela de 24h da Meta está aberta — só ela permite texto livre. */
  janelaAberta: boolean;
  /** Alguém declarou que esta conversa está encerrada, e ele não escreveu depois. */
  encerrada: boolean;
  /**
   * ESTA MENSAGEM É A DESPEDIDA DELE — ver `fechaAConversa`.
   *
   * ⚠ É A TRAVA CONTRA O LOOPING, e o fundador pediu antes de existir: *"nem
   * sempre a gente vai ter que ser os últimos a mandar mensagem, o cliente
   * também pode ser o último"*. Uma máquina que responde a "obrigada" recebe
   * "de nada" e responde de novo — isso não é hipótese, é o comportamento
   * padrão de quem sempre tem o que dizer.
   */
  despedida: boolean;
  /**
   * ELA JÁ DECIDIU — ver `lib/adiamento.ts`.
   *
   * `adiou` = disse não agora e assumiu o prazo do retorno. `chega` = pediu
   * para parar de perguntar.
   *
   * ⚠ NOS DOIS CASOS NÃO SOBROU PERGUNTA, e responder é insistir. A Valéria,
   * em 4/set: *"no momento não irei retornar, assim que puder eu retorno,
   * obrigada"* — e recebeu uma pergunta sobre o motivo, respondeu, recebeu um
   * agradecimento, e então escreveu *"agora basta de pergunta OK?"*.
   */
  sinal: "adiou" | "chega" | null;
  /** Sorteio da pausa. Injetável para o teste não depender de `Math.random`. */
  sorteio?: number;
}): DecisaoDaResposta {
  const nao = (
    decisao: "recusou" | "desistiu",
    porque: string,
  ): DecisaoDaResposta => ({ responder: false, decisao, porque });

  if (!entrada.ligado) {
    return nao("recusou", "A resposta automática está desligada nesta empresa.");
  }

  // ⚠ REAGIR NÃO É ESCREVER. Reação com emoji é aceno: fica no histórico
  // porque é sinal, e não é pergunta. No automático, responder a um 👍 é
  // mensagem paga respondendo a um aceno — e ainda reabre uma conversa que a
  // pessoa tinha acabado de fechar.
  if (entrada.tipoDaMensagem === "customer_reaction") {
    return nao("recusou", "Foi uma reação com emoji, não uma mensagem — aceno não pede resposta.");
  }

  // Sem uma única letra não há pergunta possível: é emoji, pontuação ou figura.
  // Mesma regra do fecho automático (`lib/fecho.ts`), e pela mesma razão — a
  // ausência de letra, nunca uma lista de emojis, que nunca fica pronta.
  if (!/\p{L}/u.test(entrada.texto ?? "")) {
    return nao("recusou", "A mensagem não tem uma única letra — não há o que responder.");
  }

  // ⚠ ELA JÁ DECIDIU — e aqui a última palavra é dela, não nossa.
  //
  // Vem antes da despedida porque é mais forte: quem adia com prazo próprio ou
  // pede para parar não está encerrando um papo, está dizendo o que quer que
  // aconteça daqui para frente. Quem chama trata isto como PAUSA com prazo —
  // nunca como descadastro, que apagaria para sempre alguém que pode voltar em
  // março, e nunca como nada, que a traria de volta em cinco dias.
  if (entrada.sinal === "chega") {
    return nao("recusou", "Ela pediu para parar de perguntar — mais uma mensagem agora é o que faz bloquear.");
  }
  if (entrada.sinal === "adiou") {
    return nao("recusou", "Ela disse que volta quando puder: o prazo é dela, e não há o que perguntar.");
  }

  // ⚠ A DESPEDIDA DELA ENCERRA — e responder aqui é o looping começando.
  //
  // Vem antes da janela e do encerramento porque é a mais barata de decidir e
  // a mais cara de errar no automático: cada resposta a um "obrigada" é uma
  // mensagem paga que convida outra. Quem chama trata isto como fim de
  // atendimento, não como recusa — a conversa não falhou, ela acabou.
  if (entrada.despedida) {
    return nao("recusou", "Ela se despediu depois da nossa resposta — a conversa terminou com ela.");
  }

  // ⚠ O DESCADASTRO VENCE TUDO, e vem antes da janela: honrar o pedido é
  // exigência da LGPD e da política do WhatsApp, e o custo de errar aqui não
  // fica contido na pessoa — denúncia derruba a qualidade do NÚMERO.
  if (entrada.descadastrado) {
    return nao("recusou", "Ele pediu para não receber mais mensagens.");
  }

  // Fora da janela a Meta não entrega texto livre, e responder por modelo
  // aprovado seria "responder" com um texto escrito dias antes, sem relação com
  // o que a pessoa perguntou. Passadas 24h aquilo virou retomada, e retomada é
  // trabalho da fila — com motivo e com o modelo do toque certo.
  if (!entrada.janelaAberta) {
    return nao("recusou", "Faz mais de 24h que ele escreveu: a Meta não entrega texto livre, e isto virou retomada.");
  }

  if (entrada.encerrada) {
    return nao("recusou", "Alguém marcou este atendimento como encerrado.");
  }

  return { responder: true, esperarMs: pausaDaResposta(entrada.sorteio) };
}

/**
 * Passada a pausa, AINDA é a nossa vez de responder?
 *
 * ⚠ SEM ISTO A PAUSA VIRA DEFEITO EM VEZ DE CUIDADO. Trinta segundos é tempo
 * de sobra para duas coisas acontecerem, e as duas são comuns:
 *
 *   • **a recepção responder primeiro** — e aí saem duas respostas para a
 *     mesma pergunta, uma delas assinada por ninguém. É o sistema atropelando
 *     a própria equipe, a versão em tempo real do cooldown do motor.
 *   • **a pessoa completar o raciocínio** em mais uma ou duas mensagens. Aí
 *     esta rodada responde a metade da frase, e a rodada da mensagem seguinte
 *     responde a outra metade.
 *
 * Nos dois casos a saída certa é a mesma: **desistir em silêncio.** Não é
 * falha — a rodada da última mensagem assume, com o texto inteiro na mão. Por
 * isso `desistiu` é uma decisão própria no registro, e não um erro: uma tela
 * cheia de "falhou" onde o sistema acertou treina a pessoa a ignorar a tela.
 */
export function aindaEhAVez(entrada: {
  /** `occurred_at` da mensagem que disparou esta rodada. */
  mensagemDaRodadaISO: string;
  /** A última mensagem DELE agora — pode ser outra, chegada durante a pausa. */
  ultimaEntradaISO: string | null;
  /** A última saída NOSSA agora. Se for depois dela, alguém já respondeu. */
  ultimaSaidaISO: string | null;
}): { segue: true } | { segue: false; porque: string } {
  const daRodada = Date.parse(entrada.mensagemDaRodadaISO);
  if (!Number.isFinite(daRodada)) {
    return { segue: false, porque: "A mensagem desta rodada está sem data válida." };
  }

  const ultima = entrada.ultimaEntradaISO ? Date.parse(entrada.ultimaEntradaISO) : NaN;
  if (Number.isFinite(ultima) && ultima > daRodada) {
    return {
      segue: false,
      porque: "Ele escreveu de novo durante a pausa — quem responde é a rodada da última mensagem.",
    };
  }

  const saida = entrada.ultimaSaidaISO ? Date.parse(entrada.ultimaSaidaISO) : NaN;
  if (Number.isFinite(saida) && saida > daRodada) {
    return {
      segue: false,
      porque: "Alguém da equipe já respondeu durante a pausa.",
    };
  }

  return { segue: true };
}

/**
 * Lê o interruptor da resposta automática em `tenants.settings.automation`.
 *
 * ⚠ CHAVE PRÓPRIA, e NÃO o `mode: auto` do motor. São duas decisões
 * diferentes com consequências opostas: `auto` faz a empresa FALAR com quem
 * não pediu nada (gasta dinheiro, arrisca o número); isto faz a empresa
 * RESPONDER quem perguntou (o oposto em risco, e o que ela já faria à mão).
 * Amarrar as duas na mesma chave obrigaria a desligar a campanha para parar de
 * responder sozinho — ou pior, ligar a campanha sem querer ao ligar a resposta.
 *
 * ⚠ E O PADRÃO É DESLIGADO. Ligar isto faz uma máquina escrever no nome da
 * empresa sem ninguém ler antes. Nenhuma configuração assim pode nascer ligada
 * por omissão — é a mesma regra de `ROTEAMENTO_PADRAO`.
 */
export function lerRespostaAutomatica(settings: unknown): boolean {
  const v = (settings as { automation?: { resposta_automatica?: unknown } } | null)
    ?.automation?.resposta_automatica;
  return v === true;
}
