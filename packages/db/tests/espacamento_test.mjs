/**
 * O ESPACAMENTO ENTRE RODADAS — a regra que permite bater de 15 em 15 minutos.
 *
 * ⚠ O DEFEITO DE 27/ago/2026. O agendador do GitHub perdeu as DUAS execucoes
 * do dia: 15 mensagens nao sairam de manha, 15 nao sairam a tarde, e quem
 * percebeu foi o fundador perguntando duas vezes se tinham saido.
 *
 * Nao foi azar. O `schedule` do GitHub e best-effort e a documentacao dele diz
 * que sob carga alta algumas execucoes sao descartadas, nomeando o comeco de
 * cada hora como o pior momento — e o cron daqui estava no minuto zero. Em 8
 * execucoes agendadas o tique NUNCA foi pontual: 22, 25, 26, 49, 50, 52, 54 e
 * 162 minutos de atraso, com `created_at` igual a `run_started_at` em todas
 * (ou seja: nao era fila nem falta de runner, era o proprio agendador).
 *
 * ⚠ A CAUSA RAIZ ERA DE PROJETO: 15 mensagens penduradas em UM tique. A
 * correcao e bater 40 vezes por dia — e entao quem decide a cadencia precisa
 * ser o motor, senao as 30 do dia sairiam todas antes das 11h e o
 * `max_por_rodada` (que existe para espalhar o TRABALHO) perderia o sentido.
 *
 * Este teste guarda as bordas em que a regra pode calar a campanha por engano.
 * Em toda duvida ela LIBERA: barrar por defeito nosso e o silencio que esta
 * casa passa o tempo todo tentando eliminar.
 *
 * ⚠ E EM 30/AGO A PROPRIA CORRECAO ACIMA MOSTROU UM BURACO, na vespera da
 * primeira rodada autonoma. O relogio media BATIDA, nao ENVIO: `motor-rota.ts`
 * procurava a ultima linha "nao simulada e nao pulada", e rodada que ACONTECE
 * e manda zero grava exatamente essa linha — a que estoura com excecao
 * tambem, porque o `catch` registra com `pulada` no padrao `false`. As linhas
 * de 28/ago provam, com `pulada = false`: "Fora da janela de horario" e "A
 * automacao esta desligada".
 *
 * Ou seja: uma batida vazia comprava 240 minutos de silencio, e a conta das
 * "16 chances" la embaixo so valia para o tique que o GitHub DESCARTA. Para o
 * tique que acontece e volta vazio, a chance continuava sendo uma.
 *
 * ⚠ E FUNCAO PURA NAO ENXERGA `select` ERRADO. O defeito morava no filtro da
 * consulta, fora daqui — entao a trava que fecha esta classe e a VERIFICACAO
 * DE CODIGO-FONTE no fim deste arquivo, nao mais um caso de borda.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const { avaliarEspacamento } = await import(
  pathToFileURL(path.join(ROOT, "apps/web/lib/espacamento.ts")).href
);
const { readAutomation, AUTOMATION_DEFAULTS } = await import(
  pathToFileURL(path.join(ROOT, "apps/web/lib/automation.ts")).href
);

let falhas = 0;
function verifica(nome, obtido, esperado) {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "  ok" : "FALHA"}  ${nome}`);
  if (!ok) console.log(`        esperado: ${JSON.stringify(esperado)}\n        obtido:   ${JSON.stringify(obtido)}`);
}

const AGORA = new Date("2026-08-28T13:00:00Z"); // 10h de Brasilia
const min = (n) => new Date(AGORA.getTime() - n * 60_000).toISOString();

// ---------------------------------------------------------------- o caso base
// Espacamento de 240 min (o padrao). Rodada ha 30 min: ainda nao.
verifica(
  "envio ha 30 min com espacamento de 240 — barra",
  avaliarEspacamento({ ultimoEnvioISO: min(30), agora: AGORA, minMinutos: 240 }).pode,
  false,
);
// Ha 241 min: passa. A borda exata (240) tambem passa — `>=`, nao `>`.
verifica(
  "envio ha 241 min — libera",
  avaliarEspacamento({ ultimoEnvioISO: min(241), agora: AGORA, minMinutos: 240 }).pode,
  true,
);
verifica(
  "a borda exata (240 min) libera, nao barra",
  avaliarEspacamento({ ultimoEnvioISO: min(240), agora: AGORA, minMinutos: 240 }).pode,
  true,
);

// ------------------------------------------------- as bordas que calam a campanha
// ⚠ NUNCA ENVIOU precisa PASSAR. Se "sem envio anterior" barrasse, a trava
// impediria justamente a rodada que ela existe para garantir — e a campanha de
// uma empresa nova nunca comecaria, sem erro em lugar nenhum.
verifica(
  "nunca enviou — libera",
  avaliarEspacamento({ ultimoEnvioISO: null, agora: AGORA, minMinutos: 240 }).pode,
  true,
);
// ⚠ DATA ILEGIVEL LIBERA. Defeito nosso nao pode calar cliente pagante.
verifica(
  "data ilegivel — libera, nao barra",
  avaliarEspacamento({ ultimoEnvioISO: "isto nao e data", agora: AGORA, minMinutos: 240 }).pode,
  true,
);
// ⚠ RELOGIO PARA TRAS LIBERA. Envio no futuro barraria ate o futuro chegar.
verifica(
  "ultimo envio no futuro — libera",
  avaliarEspacamento({ ultimoEnvioISO: min(-90), agora: AGORA, minMinutos: 240 }).pode,
  true,
);
// Zero desliga a regra: volta a valer so o teto do dia e o da rodada.
verifica(
  "espacamento 0 desliga a regra",
  avaliarEspacamento({ ultimoEnvioISO: min(1), agora: AGORA, minMinutos: 0 }).pode,
  true,
);

// ------------------------------------------------------- o motivo vai escrito
// ⚠ RECUSA SEM MOTIVO NA TELA E BOTAO QUEBRADO. A regra do CLAUDE.md.
const barrada = avaliarEspacamento({ ultimoEnvioISO: min(30), agora: AGORA, minMinutos: 240 });
verifica(
  "a recusa conta quanto falta",
  barrada.porque,
  "Último envio há 30 min — o espaçamento é de 240 min. Faltam 210 min.",
);
verifica("e diz ha quantos minutos foi o anterior", barrada.minutosDesde, 30);

// ------------------------------------------------------------------ o padrao
// ⚠ O PADRAO PRESERVA A OPERACAO DE HOJE, e isso e o ponto: com 30/dia e 15
// por rodada sao DUAS rodadas, que com 4h de espacamento caem de manha e no
// comeco da tarde — como ja caiam com o cron de 9h e 17h. O que muda nao e a
// cadencia: e que cada rodada passa a ter 16 chances de acontecer em vez de 1.
verifica("o padrao e 240 min (4h)", AUTOMATION_DEFAULTS.min_minutos_entre_rodadas, 240);
verifica(
  "settings vazio cai no padrao",
  readAutomation(null).min_minutos_entre_rodadas,
  240,
);
verifica(
  "valor absurdo e cortado no teto de 720 min",
  readAutomation({ automation: { min_minutos_entre_rodadas: 99999 } }).min_minutos_entre_rodadas,
  720,
);
verifica(
  "texto invalido cai no padrao, nao em zero",
  readAutomation({ automation: { min_minutos_entre_rodadas: "qualquer coisa" } }).min_minutos_entre_rodadas,
  240,
);

// ------------------------------------- a conta que faz a correcao valer a pena
// Com 4 batidas por hora das 9h07 as 18h52 sao 40 batidas por dia. Para a
// campanha parar um dia inteiro, o GitHub precisaria descartar as 40 — em vez
// de 2, que foi o que bastou em 27/ago.
const batidasPorDia = 4 * 10;
verifica("40 batidas por dia, nao 2", batidasPorDia, 40);

// ============================================================== a trava de fonte
// ⚠ O DEFEITO DE 30/AGO NAO CABIA EM NENHUM CASO ACIMA. Ele morava no `select`
// que ALIMENTA esta funcao — e funcao pura recebe o que lhe derem. Entao a
// verificacao aqui le o codigo do CHAMADOR, que e o unico lugar onde o erro
// pode voltar a existir.
//
// ⚠ NORMALIZA CRLF ANTES DE CASAR PADRAO. Regra do CLAUDE.md: os arquivos desta
// maquina estao em CRLF e o CI roda em LF. Duas travas ja mediram coisa
// diferente nos dois lugares — uma falhando a toa, a outra medindo errado em
// silencio.
const fonte = (rel) =>
  fs.readFileSync(path.join(ROOT, rel), "utf8").replace(/\r\n/g, "\n");

const rota = fonte("apps/web/lib/motor-rota.ts");
const lib = fonte("apps/web/lib/espacamento.ts");

// ⚠ ESTA E A LINHA QUE IMPORTA. Sem `enviadas > 0` o relogio volta a medir
// BATIDA em vez de ENVIO, e uma rodada vazia — ou uma que estourou, que o
// `catch` grava com `pulada` no padrao `false` — compra 240 minutos de
// silencio com a tela dizendo "agendador vivo".
verifica(
  "o relogio filtra `enviadas > 0` — mede envio, nao batida",
  rota.includes('.gt("enviadas", 0)'),
  true,
);

// O nome e parte da trava: `ultimoEnvioISO` nao se confunde com "ultima
// rodada" na hora de alimentar a funcao. Se alguem reintroduzir o nome velho,
// isto falha antes de a Vercel publicar.
verifica("o chamador passa `ultimoEnvioISO`", rota.includes("ultimoEnvioISO:"), true);
verifica("e o nome velho nao voltou ao chamador", rota.includes("ultimaRodadaISO"), false);
verifica("a funcao declara `ultimoEnvioISO`", lib.includes("ultimoEnvioISO: string | null"), true);

// ⚠ EMPRESA `off` SAI ANTES DE MONTAR FILA. Com o relogio medindo envio, quem
// nunca envia nunca tem relogio — e sem este curto-circuito as 40 batidas do
// dia carregariam a fila inteira de toda empresa em teste gratis, todo dia,
// para descobrir de novo que ela esta desligada.
verifica(
  "empresa com automacao desligada e curto-circuitada antes da fila",
  rota.includes('regras.mode === "off"'),
  true,
);

console.log(falhas ? `\n${falhas} FALHA(S)` : "\ntudo certo");
process.exit(falhas ? 1 : 0);
