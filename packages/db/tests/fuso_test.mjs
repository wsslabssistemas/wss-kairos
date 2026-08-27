/**
 * A HORA LOCAL DA EMPRESA — e por que `getHours()` nao serve.
 *
 * ⚠ O DEFEITO DE 20/ago/2026. O executor do motor passava
 * `new Date().getHours()` como "hora local". O servidor da Vercel roda em UTC
 * e o Brasil e UTC-3: as 18h de Porto Alegre o processo lia 21h. Com a janela
 * padrao de 9h-19h, o motor NUNCA rodaria a tarde e rodaria as 6h da manha.
 *
 * O sintoma que chegou foi "nao estou conseguindo puxar a simulacao, nao gera
 * lista nenhuma". Nada quebrou: a lista voltava vazia com um motivo plausivel.
 *
 * ⚠ E o tipo em `lib/motor.ts` JA dizia "quem converte o fuso e quem chama".
 * Quem chamava nao convertia — comentario e codigo discordando em silencio.
 */

import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const { horaLocal, diaLocalISO, lerFuso, FUSO_PADRAO, dataHoraLocal, dataLocal, horaMinutoLocal } = await import(
  pathToFileURL(path.join(ROOT, "apps/web/lib/fuso.ts")).href
);

let falhas = 0;
function verifica(nome, obtido, esperado) {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "  ok" : "FALHA"}  ${nome}`);
  if (!ok) console.log(`        esperado: ${JSON.stringify(esperado)}\n        obtido:   ${JSON.stringify(obtido)}`);
}

// ⚠ O CASO EXATO DO DEFEITO. 21:45 UTC e 18:45 em Porto Alegre — dentro da
// janela de 9h-19h. `getUTCHours()` daria 21 e barraria a automacao.
const oCaso = new Date("2026-08-20T21:45:00Z");
verifica("21:45 UTC e 18h no Brasil (o caso do defeito)", horaLocal(oCaso), 18);
verifica("e getUTCHours daria 21 — o numero que barrava tudo", oCaso.getUTCHours(), 21);

// A virada do dia: 02:00 UTC ainda e o dia ANTERIOR no Brasil. O teto diario
// zerava no meio da noite de quem opera ate 22h.
const madrugada = new Date("2026-08-21T02:00:00Z");
verifica("02:00 UTC ainda e 23h do dia anterior no Brasil", horaLocal(madrugada), 23);
verifica("e o dia da empresa ainda e 20/08", diaLocalISO(madrugada), "2026-08-20");

// Meio-dia UTC = 9h no Brasil: a borda de abertura da janela padrao.
verifica("12:00 UTC e 9h no Brasil — abertura da janela", horaLocal(new Date("2026-08-20T12:00:00Z")), 9);

// Meia-noite local nao pode virar 24.
verifica("meia-noite local e 0, nunca 24", horaLocal(new Date("2026-08-20T03:00:00Z")), 0);

// O fuso vem das configuracoes, com padrao seguro.
verifica("settings vazio usa o padrao", lerFuso(null), FUSO_PADRAO);
verifica("fuso valido e respeitado", lerFuso({ timezone: "America/Manaus" }), "America/Manaus");
// ⚠ Fuso invalido NAO explode: erro de digitacao na configuracao nao pode
// derrubar o motor, e o padrao esta certo para 100% da base atual.
verifica("fuso invalido cai no padrao em vez de quebrar", lerFuso({ timezone: "Nao/Existe" }), FUSO_PADRAO);
verifica("fuso vazio cai no padrao", lerFuso({ timezone: "   " }), FUSO_PADRAO);

// Manaus e UTC-4: a mesma hora UTC da numero diferente. Prova que o fuso da
// empresa e lido de verdade, e nao um "-3" chumbado.
verifica("Manaus (UTC-4) as 21:45 UTC e 17h", horaLocal(oCaso, "America/Manaus"), 17);

// ================================================================ EXIBICAO
// ⚠ O DEFEITO DE 27/ago/2026 — o MESMO deste arquivo, na camada de tela. O
// fundador disparou a campanha as 17h37 e o Canal oficial mostrou **20:37**:
// `toLocaleString("pt-BR")` sem `timeZone` usa o relogio de QUEM RENDERIZA, e
// pagina de servidor renderiza na Vercel, que roda em UTC.
//
// ⚠ E ELE E PIOR QUE O DE CIMA, nao menor. Aquele fazia o motor nao rodar, e
// ninguem acredita num numero que nao apareceu. Este mostra hora PLAUSIVEL e
// errada: quem conferir se a mensagem saiu no horario combinado conclui que o
// produto disparou fora da janela de operacao.
const oEnvio = new Date("2026-08-27T20:37:00Z"); // 17h37 em Brasilia
verifica("o envio das 17h37 aparece 17:37, nao 20:37", dataHoraLocal(oEnvio), "27/08, 17:37");
verifica("e so a hora tambem", horaMinutoLocal(oEnvio), "17:37");

// ⚠ A VIRADA DO DIA. Sem fuso, uma conversa das 22h de sexta aparece no
// sabado — e some de quem filtra por dia.
verifica("01:00 UTC de 28/08 e 22:00 de 27/08 aqui", dataHoraLocal("2026-08-28T01:00:00Z"), "27/08, 22:00");
verifica("e a data segue sendo 27", dataLocal("2026-08-28T01:00:00Z"), "27/08/2026");

// Manaus de novo: prova que o fuso e parametro, nao "-3" chumbado.
verifica("o mesmo instante em Manaus e 16:37", horaMinutoLocal(oEnvio, "America/Manaus"), "16:37");

// ⚠ VALOR AUSENTE OU PODRE VIRA TRACO, nunca "Invalid Date" na cara de quem usa.
verifica("nulo vira traco", dataHoraLocal(null), "—");
verifica("vazio vira traco", dataHoraLocal(""), "—");
verifica("lixo vira traco, nao Invalid Date", dataHoraLocal("nao e data"), "—");

console.log(falhas === 0 ? "\nfuso: tudo certo." : `\nfuso: ${falhas} falha(s).`);
process.exit(falhas === 0 ? 0 : 1);
