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
