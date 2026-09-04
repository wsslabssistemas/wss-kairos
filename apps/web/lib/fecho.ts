// MENSAGEM QUE NÃO PEDE RESPOSTA — o "👍" e o "ok" no fim de uma conversa.
//
// ⚠ POR QUE ISTO EXISTE, e a pergunta que o fundador fez pensando na
// automação completa: *"toda vez que um contato nos enviar apenas um
// emoticon num contexto de encerramento, dar como encerrada e não
// responder... muitas vezes não será ela a enviar a última mensagem"*.
//
// Ele está certo, e o problema é maior no automático: com uma pessoa no meio,
// responder a um 👍 é um item a mais na lista. Sem ninguém no meio, é uma
// mensagem PAGA, no nome da empresa, respondendo a um aceno — para alguém que
// muitas vezes acabou de dizer que não quer voltar agora.
//
// ⚠ A DIVISÃO EM DOIS NÍVEIS É O CUIDADO PRINCIPAL, porque os dois erros aqui
// não custam a mesma coisa:
//
//   • Fechar por engano → a pessoa espera resposta para sempre e ninguém
//     descobre. É o defeito mais caro desta tela.
//   • Não fechar → sobra uma linha na lista, que um clique resolve.
//
// Então só fecha sozinho o que NÃO PODE conter pergunta: emoji e pontuação,
// texto sem uma única letra. "ok", "obrigada" e "combinado" são palavras — e
// palavra pode vir seguida de qualquer coisa. Elas viram SUGESTÃO na tela,
// nunca decisão automática.
//
// ⚠ E "combinado" foi exatamente o caso da Daniela, em 25/ago: fecho de
// cortesia que qualquer pessoa lê como fim de papo, e que o sistema não tem
// como distinguir de "combinado, mas me manda o endereço".

export type TipoDeFecho =
  /** Só emoji, pontuação ou espaço. Não cabe pergunta aqui. */
  | "sem_conteudo"
  /** Palavra curta de cortesia. Parece fecho — mas é palpite, não certeza. */
  | "cortesia"
  | null;

/**
 * Frases de cortesia que costumam encerrar. Sem acento e em minúsculas: a
 * comparação normaliza os dois lados, porque ninguém digita com acento no
 * WhatsApp — a mesma decisão de `lib/optout.ts`.
 */
const CORTESIA = new Set([
  "ok", "okay", "okey", "blz", "beleza", "combinado", "combinada",
  "obrigado", "obrigada", "obg", "vlw", "valeu", "isso", "certo",
  "perfeito", "otimo", "otima", "show", "tranquilo", "tranquila",
  "ta bom", "esta bom", "tudo bem", "de nada", "abraco", "abracos",
  "ate mais", "ate logo", "bom dia", "boa tarde", "boa noite",
]);

const semAcento = (t: string) =>
  t.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();

/**
 * O que este texto é, do ponto de vista de precisar de resposta.
 *
 * ⚠ O TESTE DE "SEM CONTEÚDO" É A AUSÊNCIA DE LETRA E DE DÍGITO, não uma lista
 * de emojis. Lista de emoji nunca fica pronta — surgem novos todo ano, e cada
 * um que faltasse viraria uma conversa parada na fila. Perguntar "tem alguma
 * letra aqui?" vale para qualquer emoji que exista ou venha a existir.
 */
export function tipoDeFecho(texto: string | null | undefined): TipoDeFecho {
  const t = (texto ?? "").trim();
  if (!t) return null;

  // Nenhuma letra e nenhum dígito em nenhum alfabeto: emoji, pontuação, sinal.
  if (!/[\p{L}\p{N}]/u.test(t)) return "sem_conteudo";

  // ⚠ O TETO DE TAMANHO É PARTE DA REGRA. "obrigada" fecha; "obrigada, mas
  // preciso saber o valor" não fecha — e as duas começam igual.
  if (t.length > 40) return null;

  // Tira emoji e pontuação para comparar só as palavras: "ok 👍" é "ok".
  const limpo = semAcento(t)
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

  return limpo && CORTESIA.has(limpo) ? "cortesia" : null;
}

/**
 * ESTA MENSAGEM ENCERRA A CONVERSA? — a hora do "chega".
 *
 * ⚠ POR QUE ISTO PASSOU A EXISTIR (4/set/2026), e por que não existia antes.
 *
 * `tipoDeFecho` classifica a MENSAGEM sozinha, e por isso ele é conservador de
 * propósito: *"obrigada"* solto pode ser fim de papo ou o começo de outra
 * frase, então vira sugestão para uma pessoa, nunca decisão. Enquanto havia
 * gente lendo, isso bastava.
 *
 * Com a IA respondendo sozinha, não basta mais — e o fundador nomeou o risco
 * exato: *"tenho receio de ele entender a hora de parar de enviar mensagem, e
 * evitar entrar em looping infinito com o cliente; nem sempre a gente vai ter
 * que ser os últimos a mandar mensagem, o cliente também pode ser o último"*.
 *
 * Uma máquina que responde a *"obrigada"* recebe *"de nada"* e responde de
 * novo. O looping não é hipótese: é o comportamento padrão de quem sempre tem
 * o que dizer.
 *
 * ⚠ O QUE MUDA AQUI É O CONTEXTO, e é ele que torna a decisão segura. A
 * pergunta não é mais "esta palavra fecha?", é **"esta palavra fecha DEPOIS DO
 * QUE NÓS DISSEMOS?"**:
 *
 *   • nós afirmamos algo e ela respondeu *"ok"* → é o fim natural do papo;
 *   • nós PERGUNTAMOS algo e ela respondeu *"ok"* → isso é um SIM, não uma
 *     despedida. Fechar aqui perderia exatamente o momento em que ela aceitou.
 *
 * A segunda metade é o que impede o defeito caro que `tipoDeFecho` evita
 * calando: fechar por engano faz a pessoa esperar para sempre, e ninguém
 * descobre.
 */
export function fechaAConversa(entrada: {
  /** O que ela acabou de escrever. */
  texto: string | null | undefined;
  /**
   * A última mensagem NOSSA antes desta. `null` quando não houve — e aí não
   * há despedida possível: ninguém se despede de uma conversa que não começou.
   */
  nossaUltimaMensagem: string | null | undefined;
}): { fecha: boolean; porque: string } {
  const tipo = tipoDeFecho(entrada.texto);
  if (tipo === null) {
    return { fecha: false, porque: "A mensagem tem conteúdo — pede resposta." };
  }

  const nossa = (entrada.nossaUltimaMensagem ?? "").trim();
  if (!nossa) {
    return {
      fecha: false,
      porque: "Ela escreveu isto sem nada nosso antes — não é despedida, é o começo de algo.",
    };
  }

  // ⚠ SE A NOSSA ÚLTIMA MENSAGEM PERGUNTOU, "ok" É RESPOSTA, NÃO TCHAU.
  //
  // *"Posso te encaixar quinta de manhã?"* seguido de *"ok"* é um SIM — e
  // fechar aqui jogaria fora a única coisa que a conversa inteira buscava.
  // Errar para este lado é o erro caro: ela fica esperando o combinado que
  // nunca vem, e ninguém descobre.
  if (nossa.includes("?")) {
    return {
      fecha: false,
      porque: "Nós perguntamos algo antes — uma resposta curta aqui pode ser um sim, não uma despedida.",
    };
  }

  return {
    fecha: true,
    porque:
      tipo === "sem_conteudo"
        ? "Ela respondeu com emoji ou pontuação depois da nossa mensagem: é aceno de fim de papo."
        : "Ela agradeceu depois da nossa resposta, e nós não tínhamos perguntado nada: a conversa terminou com ela.",
  };
}
