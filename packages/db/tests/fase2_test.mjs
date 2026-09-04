/**
 * FASE 2 — a IA respondendo sozinha, e as recusas que a mantêm honesta.
 *
 * ⚠ POR QUE ESTE ARQUIVO EXISTE.
 *
 * Esta é a primeira peça do produto que **escreve no nome da empresa sem
 * ninguém ler antes**. O que autorizou isso foi `origem_ia` — 69 casos, 82,6%
 * de sugestões aceitas sem edição — e esse número mede uma coisa só: que o
 * texto é bom o bastante para sair como está. Ele não mede se a IA sabe
 * QUANDO calar, e é disso que este arquivo trata.
 *
 * As propriedades guardadas aqui, todas fáceis de desfazer sem perceber:
 *
 *   1. **O padrão é desligado.** Nenhuma máquina começa a falar por omissão.
 *   2. **Reagir não é escrever.** Responder a um 👍 é mensagem paga
 *      respondendo a um aceno — e reabre conversa que a pessoa fechou.
 *   3. **Descadastro vence tudo.** O custo de errar não fica contido na
 *      pessoa: denúncia derruba a qualidade do NÚMERO.
 *   4. **Fora da janela de 24h não é resposta, é retomada** — e retomada tem
 *      motivo, e é trabalho da fila.
 *   5. **A pausa é sorteada, e depois dela o sistema confere de novo.** Sem
 *      essa segunda conferência a pausa vira defeito: em 30 segundos a
 *      recepção responde, ou a pessoa manda mais duas mensagens.
 *   6. **Desistir não é falhar.** Uma tela cheia de "falhou" onde o sistema
 *      acertou treina a pessoa a ignorar a tela.
 *
 * Valor esperado escrito no arquivo. "Parece certo" não é critério.
 */

import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const { decidirResposta, aindaEhAVez, pausaDaResposta, lerRespostaAutomatica } =
  await import(pathToFileURL(path.join(ROOT, "apps/web/lib/fase2.ts")).href);

let falhas = 0;
function verifica(nome, obtido, esperado) {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "  ok" : "FALHA"}  ${nome}`);
  if (!ok) console.log(`        esperado: ${JSON.stringify(esperado)}\n        obtido:   ${JSON.stringify(obtido)}`);
}

/** O caso normal: ligado, mensagem de verdade, janela aberta, nada contra. */
const BOM = {
  ligado: true,
  tipoDaMensagem: "customer_message",
  texto: "quanto tá o plano mensal?",
  descadastrado: false,
  janelaAberta: true,
  encerrada: false,
  sorteio: 0.5,
};

// ---------------------------------------------------------------------
// 1. O INTERRUPTOR — e o padrão é desligado
// ---------------------------------------------------------------------

// Esperado: `false` para settings vazio, nulo e para qualquer coisa que não
// seja o booleano `true`. ⚠ Ligar isto faz uma máquina escrever no nome da
// empresa sem ninguém ler antes — nenhuma configuração assim pode nascer
// ligada por omissão, e "true" como TEXTO é justamente o que vem de um
// formulário mal lido.
verifica(
  "resposta automática: o padrão é desligado, e só o booleano true liga",
  [
    lerRespostaAutomatica(null),
    lerRespostaAutomatica({}),
    lerRespostaAutomatica({ automation: {} }),
    lerRespostaAutomatica({ automation: { resposta_automatica: "true" } }),
    lerRespostaAutomatica({ automation: { resposta_automatica: 1 } }),
    lerRespostaAutomatica({ automation: { resposta_automatica: true } }),
  ],
  [false, false, false, false, false, true],
);

// Esperado: desligada, não responde — e o motivo diz isso, não outra coisa.
verifica(
  "desligada, não responde",
  decidirResposta({ ...BOM, ligado: false }).responder,
  false,
);

// ---------------------------------------------------------------------
// 2. O QUE NÃO PEDE RESPOSTA
// ---------------------------------------------------------------------

// Esperado: recusa. Reagir com emoji é acenar com a cabeça. No automático,
// responder a um 👍 é mensagem paga respondendo a um aceno — e ainda reabre
// uma conversa que a pessoa tinha acabado de fechar.
verifica(
  "reação com emoji não vira resposta",
  decidirResposta({ ...BOM, tipoDaMensagem: "customer_reaction" }).responder,
  false,
);

// Esperado: recusa para o que não tem UMA LETRA, e resposta para "ok".
// ⚠ A regra é a ausência de letra, nunca uma lista de emojis — lista de emoji
// nunca fica pronta. E "ok" é palavra: fechar por engano deixa alguém
// esperando para sempre, que é o erro caro desta tela.
verifica(
  "sem uma única letra não há o que responder; 'ok' é palavra",
  [
    decidirResposta({ ...BOM, texto: "👍" }).responder,
    decidirResposta({ ...BOM, texto: "!!!" }).responder,
    decidirResposta({ ...BOM, texto: "   " }).responder,
    decidirResposta({ ...BOM, texto: "ok" }).responder,
  ],
  [false, false, false, true],
);

// Esperado: recusa. Honrar descadastro é exigência da LGPD e da política do
// WhatsApp, e o custo de errar não fica contido na pessoa que reclamou.
verifica(
  "quem pediu para sair não recebe resposta automática",
  decidirResposta({ ...BOM, descadastrado: true }).responder,
  false,
);

// Esperado: recusa. Passadas 24h a Meta não entrega texto livre, e responder
// por modelo aprovado seria "responder" com um texto escrito dias antes.
verifica(
  "fora da janela de 24h não é resposta, é retomada",
  decidirResposta({ ...BOM, janelaAberta: false }).responder,
  false,
);

// Esperado: recusa. Alguém leu a conversa e disse que acabou.
verifica(
  "atendimento encerrado não recebe resposta automática",
  decidirResposta({ ...BOM, encerrada: true }).responder,
  false,
);

// Esperado: responde, e com uma espera dentro da faixa.
verifica(
  "o caso normal responde",
  decidirResposta(BOM).responder,
  true,
);

// ---------------------------------------------------------------------
// 3. A PAUSA — 20 a 40 segundos, e SORTEADA
// ---------------------------------------------------------------------

// Esperado: 20s no piso, 40s no teto, 30s no meio. ⚠ Resposta em 800ms
// anuncia robô na primeira frase, e anunciar robô é perder a conversa que a
// campanha pagou para começar.
verifica(
  "a pausa vai de 20s a 40s",
  [pausaDaResposta(0), pausaDaResposta(0.5), pausaDaResposta(1)],
  [20000, 30000, 40000],
);

// Esperado: sorteio fora da faixa não estoura o intervalo. Valor doido vindo
// de fora não pode produzir espera negativa (responder na hora) nem eterna.
verifica(
  "sorteio fora da faixa continua dentro do intervalo",
  [pausaDaResposta(-5), pausaDaResposta(99)],
  [20000, 40000],
);

// ---------------------------------------------------------------------
// 4. DEPOIS DA PAUSA — ainda é a nossa vez?
// ---------------------------------------------------------------------
//
// ⚠ SEM ISTO A PAUSA VIRA DEFEITO EM VEZ DE CUIDADO. Trinta segundos é tempo
// de sobra para a recepção responder primeiro (e aí saem duas respostas para a
// mesma pergunta) ou para a pessoa completar o raciocínio em mais duas
// mensagens (e aí esta rodada responde metade da frase).

const DA_RODADA = "2026-09-04T12:00:00.000Z";

// Esperado: segue. Nada aconteceu durante a pausa.
verifica(
  "nada mudou na pausa: segue",
  aindaEhAVez({ mensagemDaRodadaISO: DA_RODADA, ultimaEntradaISO: DA_RODADA, ultimaSaidaISO: null }).segue,
  true,
);

// Esperado: desiste. Ele mandou outra mensagem — quem responde é a rodada da
// última, com o texto inteiro na mão.
verifica(
  "ele escreveu de novo na pausa: desiste",
  aindaEhAVez({
    mensagemDaRodadaISO: DA_RODADA,
    ultimaEntradaISO: "2026-09-04T12:00:15.000Z",
    ultimaSaidaISO: null,
  }).segue,
  false,
);

// Esperado: desiste. A recepção respondeu primeiro, e o sistema não atropela a
// própria equipe no meio da conversa.
verifica(
  "a equipe respondeu na pausa: desiste",
  aindaEhAVez({
    mensagemDaRodadaISO: DA_RODADA,
    ultimaEntradaISO: DA_RODADA,
    ultimaSaidaISO: "2026-09-04T12:00:20.000Z",
  }).segue,
  false,
);

// Esperado: segue. A saída ANTERIOR à mensagem dele é a mensagem da campanha
// que ele está respondendo — se ela desse "desiste", o sistema nunca
// responderia ninguém, porque toda reativação começa com uma saída nossa.
verifica(
  "a saída anterior à mensagem dele não impede a resposta",
  aindaEhAVez({
    mensagemDaRodadaISO: DA_RODADA,
    ultimaEntradaISO: DA_RODADA,
    ultimaSaidaISO: "2026-09-04T09:00:00.000Z",
  }).segue,
  true,
);

// Esperado: desiste, e o motivo fala em pausa — não em erro. Registro que
// chama de "falha" o que foi acerto treina a pessoa a ignorar a tela.
verifica(
  "desistir explica que foi a pausa fazendo o trabalho",
  aindaEhAVez({
    mensagemDaRodadaISO: DA_RODADA,
    ultimaEntradaISO: DA_RODADA,
    ultimaSaidaISO: "2026-09-04T12:00:20.000Z",
  }).porque.includes("durante a pausa"),
  true,
);

// Esperado: não segue. Data inválida não pode virar "pode responder": na
// dúvida, o lado seguro é calar, porque o outro lado manda mensagem paga com
// contexto errado.
verifica(
  "data inválida não autoriza resposta",
  aindaEhAVez({ mensagemDaRodadaISO: "não é data", ultimaEntradaISO: null, ultimaSaidaISO: null }).segue,
  false,
);

console.log(falhas === 0 ? "\nfase2: tudo certo." : `\nfase2: ${falhas} falha(s).`);
process.exit(falhas === 0 ? 0 : 1);
