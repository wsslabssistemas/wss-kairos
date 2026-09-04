/**
 * O "👍" QUE NÃO PEDE RESPOSTA.
 *
 * ⚠ POR QUE ESTE TESTE É DOS MAIS IMPORTANTES DA PASTA, apesar do assunto
 * pequeno. Os dois erros aqui não custam a mesma coisa:
 *
 *   • fechar por engano → a pessoa espera resposta para sempre, e ninguém
 *     descobre, porque ela sai da lista;
 *   • não fechar → sobra uma linha que um clique resolve.
 *
 * Então a regra só pode fechar sozinha o que NÃO PODE conter pergunta. Este
 * arquivo existe para que ninguém, no futuro, "melhore" a regra incluindo
 * palavras — e transforme silêncio em cliente perdido.
 *
 * Valor esperado escrito no arquivo. Roda sem banco.
 */
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const { tipoDeFecho, fechaAConversa } = await import(
  pathToFileURL(path.join(ROOT, "apps/web/lib/fecho.ts")).href
);

let falhas = 0;
function verifica(nome, obtido, esperado) {
  const ok = obtido === esperado;
  if (!ok) falhas++;
  console.log(`${ok ? "  ok" : "FALHA"}  ${nome}`);
  if (!ok) console.log(`        esperado: ${esperado}\n        obtido:   ${obtido}`);
}

// ---------------------------------------------------------------------
// SEM CONTEÚDO — fecha sozinho, porque não cabe pergunta
// ---------------------------------------------------------------------
verifica("um emoji sozinho", tipoDeFecho("👍"), "sem_conteudo");
verifica("emoji com pele e variação", tipoDeFecho("🙏🏻"), "sem_conteudo");
verifica("vários emojis", tipoDeFecho("😊😊👏"), "sem_conteudo");
verifica("coração", tipoDeFecho("❤️"), "sem_conteudo");
verifica("só pontuação", tipoDeFecho("..."), "sem_conteudo");

// ⚠ A REGRA NÃO É UMA LISTA DE EMOJIS — é a ausência de letra. Lista de emoji
// nunca fica pronta, e cada um que faltasse seria uma conversa parada na fila.
verifica("emoji que ninguém previu", tipoDeFecho("🫶🩵"), "sem_conteudo");

// ---------------------------------------------------------------------
// CORTESIA — SUGERE fechar, nunca fecha sozinho
// ---------------------------------------------------------------------
verifica("ok", tipoDeFecho("ok"), "cortesia");
verifica("Combinado (o caso real da Daniela)", tipoDeFecho("Combinado"), "cortesia");
verifica("obrigada com acento", tipoDeFecho("Obrigada"), "cortesia");
verifica("cortesia com emoji junto", tipoDeFecho("obrigada 🙏"), "cortesia");
verifica("valeu abreviado", tipoDeFecho("vlw"), "cortesia");

// ---------------------------------------------------------------------
// ⚠ O QUE NÃO PODE FECHAR — a metade que protege o cliente
// ---------------------------------------------------------------------
//
// As duas primeiras COMEÇAM como cortesia. Se a regra olhasse o começo do
// texto em vez do texto inteiro, ela silenciaria quem está perguntando preço.
verifica("obrigada, mas com pergunta atrás",
  tipoDeFecho("Obrigada, mas preciso saber o valor do mensal"), null);
verifica("ok seguido de pedido",
  tipoDeFecho("ok, me manda o endereço por favor"), null);
verifica("pergunta curta", tipoDeFecho("quanto?"), null);
verifica("um número é conteúdo", tipoDeFecho("2"), null);
verifica("nome de dia é conteúdo", tipoDeFecho("terça"), null);
verifica("vazio não é fecho", tipoDeFecho(""), null);
verifica("nulo não é fecho", tipoDeFecho(null), null);


// ---------------------------------------------------------------------
// A HORA DO "CHEGA" — quando a conversa terminou COM ELA (4/set/2026)
//
// ⚠ `tipoDeFecho` classifica a mensagem sozinha, e por isso é conservador:
// "obrigada" solto vira sugestão para uma pessoa, nunca decisão. Enquanto
// havia gente lendo, isso bastava.
//
// Com a IA respondendo sozinha, não basta — e o fundador nomeou o risco antes
// de ele acontecer: *"tenho receio dele entender a hora de parar de enviar
// mensagem, e evitar entrar em looping infinito com o cliente; nem sempre a
// gente vai ter que ser os últimos a mandar mensagem, o cliente também pode
// ser o último a nos enviar mensagem"*.
//
// Uma máquina que responde a "obrigada" recebe "de nada" e responde de novo.
// O looping não é hipótese: é o comportamento padrão de quem sempre tem o que
// dizer.
//
// O QUE TORNA A DECISÃO SEGURA É O CONTEXTO, e é a metade que faltava: a
// pergunta deixou de ser "esta palavra fecha?" e passou a ser "esta palavra
// fecha DEPOIS DO QUE NÓS DISSEMOS?".
// ---------------------------------------------------------------------

// Esperado: fecha. Nós afirmamos algo, ela agradeceu — fim natural do papo.
verifica(
  "agradecimento depois de uma AFIRMAÇÃO nossa encerra",
  fechaAConversa({
    texto: "obrigada!",
    nossaUltimaMensagem: "Funcionamos de segunda a sexta das 6h30 às 22h.",
  }).fecha,
  true,
);

// ⚠ ESTE É O CASO QUE PROTEGE O DINHEIRO. "Posso te encaixar quinta?" seguido
// de "ok" é um SIM, não uma despedida — fechar aqui jogaria fora exatamente o
// momento que a conversa inteira buscava, e ela ficaria esperando um combinado
// que nunca vem. É o erro caro: ninguém reclama, some.
verifica(
  "'ok' depois de uma PERGUNTA nossa não encerra — pode ser um sim",
  fechaAConversa({
    texto: "ok",
    nossaUltimaMensagem: "Posso te encaixar quinta de manhã?",
  }).fecha,
  false,
);

// Esperado: não fecha. Sem nada nosso antes, "oi, obrigada" não é despedida —
// é alguém começando uma conversa.
verifica(
  "cortesia sem mensagem nossa antes não encerra",
  fechaAConversa({ texto: "obrigada", nossaUltimaMensagem: null }).fecha,
  false,
);

// Esperado: não fecha. Tem conteúdo, e conteúdo pede resposta.
verifica(
  "mensagem com conteúdo nunca encerra",
  fechaAConversa({
    texto: "obrigada, mas qual o valor do mensal?",
    nossaUltimaMensagem: "Somos uma academia de bairro.",
  }).fecha,
  false,
);

// Esperado: fecha. Emoji depois da nossa mensagem é aceno de fim de papo — a
// mesma regra do 👍, agora com o contexto que faltava.
verifica(
  "emoji depois da nossa mensagem encerra",
  fechaAConversa({ texto: "👍", nossaUltimaMensagem: "Te espero quinta então!" }).fecha,
  true,
);

// Esperado: o motivo é legível por gente. Registro que só diz "true" não conta
// nada para quem abre a tela depois querendo entender o silêncio.
verifica(
  "o motivo explica que a conversa terminou com ela",
  fechaAConversa({
    texto: "valeu",
    nossaUltimaMensagem: "Fico à disposição.",
  }).porque.includes("terminou com ela"),
  true,
);

console.log(falhas === 0 ? "\nfecho: tudo certo." : `\nfecho: ${falhas} falha(s).`);
process.exit(falhas === 0 ? 0 : 1);
