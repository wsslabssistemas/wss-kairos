/**
 * O MOTOR PROATIVO — as regras anti-bloqueio finalmente sendo obedecidas.
 *
 * ⚠ POR QUE ESTE TESTE EXISTE.
 *
 * As seis regras da tela de Automação (`max_per_day`, `min_hours_between`,
 * `max_no_reply`, `cooldown_hours`, a janela de horário e `stop_after_days`)
 * eram gravadas desde que a tela nasceu e **nenhuma linha do sistema as lia**.
 * Um formulário que salva e ninguém cumpre promete um freio que não existe.
 *
 * E regra de horário testada "rodando e vendo" não vale nada: o defeito típico
 * é a janela que nunca abre, e ela se parece exatamente com "não havia nada
 * para enviar". Por isso o relógio é injetado.
 *
 * Valor esperado escrito no arquivo.
 */

import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const { planejar, dentroDaJanela } = await import(
  pathToFileURL(path.join(ROOT, "apps/web/lib/motor.ts")).href
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

const REGRAS = {
  mode: "auto", max_per_day: 30, min_hours_between: 24, max_no_reply: 3,
  cooldown_hours: 48, window_start: 9, window_end: 19, stop_after_days: 14,
  reativacao_max_dias: 90,
  max_por_rodada: 0,
  pausa_entre_envios_seg: 6,
};

const livre = (id) => ({
  contactId: id, motivo: "reativacao",
  horasDesdeUltimoContato: null, semResposta: 0,
  diasSemEngajamento: null, horasDesdeRespostaDele: null,
  // Sem data de entrada na etapa. O recorte NAO barra quem nao tem data — ver
  // o bloco 6. Quem tem data diz isso explicitamente, com `exAluno`.
  diasNaEtapa: null,
});

const plano = (over = {}, cands = [livre("a")], enviadosHoje = 0, horaLocal = 10) =>
  planejar({ candidatos: cands, regras: { ...REGRAS, ...over }, enviadosHoje, horaLocal });

// ---------------------------------------------------------------------
// 1. A JANELA DE HORÁRIO — e o caso que devolveria SEMPRE falso
// ---------------------------------------------------------------------

verifica("janela normal: 10h está dentro de 9–19", dentroDaJanela(10, 9, 19), true);
verifica("janela normal: 20h está fora", dentroDaJanela(20, 9, 19), false);
verifica("o fim é exclusivo: 19h já está fora", dentroDaJanela(19, 9, 19), false);

// ⚠ O CASO QUE UMA COMPARAÇÃO INGÊNUA QUEBRA. `h >= 22 && h < 6` é sempre
// falso — a automação nunca rodaria, e "não enviou nada" se parece com "não
// havia nada para enviar".
verifica("janela que vira a meia-noite: 23h está dentro de 22–6", dentroDaJanela(23, 22, 6), true);
verifica("janela que vira a meia-noite: 3h está dentro de 22–6", dentroDaJanela(3, 22, 6), true);
verifica("janela que vira a meia-noite: 12h está fora de 22–6", dentroDaJanela(12, 22, 6), false);

// Início igual ao fim = 24 horas. A leitura alternativa ("zero horas") é a
// errada: quem digita o mesmo número duas vezes quer "sempre", e "nunca" é
// silencioso.
verifica("início igual ao fim significa o dia inteiro", dentroDaJanela(3, 9, 9), true);

// Esperado: inativo, e o motivo diz a hora. Bloqueio sem motivo legível é o
// que faz alguém concluir que o sistema quebrou.
verifica("fora da janela o motor não envia", plano({}, [livre("a")], 0, 22).ativo, false);
verifica("e o motivo diz a hora", plano({}, [livre("a")], 0, 22).porque.includes("22h"), true);

// ---------------------------------------------------------------------
// 2. O MODO
// ---------------------------------------------------------------------

verifica("desligado não envia nada", plano({ mode: "off" }).enviar.length, 0);
verifica("e diz que está desligado", plano({ mode: "off" }).porque, "A automação está desligada.");

// Simulação PLANEJA igual e marca `simulado`. Quem não envia é o executor —
// se a decisão mudasse aqui, a simulação estaria calibrando outra coisa.
verifica("simulação planeja igual ao automático", plano({ mode: "simulation" }).enviar, ["a"]);
verifica("e vem marcada como simulada", plano({ mode: "simulation" }).simulado, true);

// ---------------------------------------------------------------------
// 3. O TETO DO DIA
// ---------------------------------------------------------------------

// Esperado: 2 enviados de 5 candidatos, porque já saíram 28 de 30.
verifica(
  "o teto do dia corta a lista",
  plano({}, ["a", "b", "c", "d", "e"].map(livre), 28).enviar,
  ["a", "b"],
);

// ⚠ Esperado: "amanhã" no motivo, não "bloqueado". São coisas diferentes para
// quem lê a tela.
verifica(
  "quem sobra do teto fica para amanhã, e o texto diz isso",
  plano({}, ["a", "b", "c"].map(livre), 29).vereditos.find((v) => v.contactId === "b")?.motivo.includes("amanhã"),
  true,
);

verifica("teto já estourado não envia ninguém", plano({}, [livre("a")], 30).enviar.length, 0);

// ---------------------------------------------------------------------
// 4. AS QUATRO REGRAS POR PESSOA
// ---------------------------------------------------------------------

// Esperado: barrado. Insistir com quem nunca dá sinal é o padrão que faz o
// WhatsApp marcar a conta.
verifica(
  "parou de engajar há mais que o limite: barrado",
  plano({}, [{ ...livre("a"), diasSemEngajamento: 20 }]).enviar.length,
  0,
);

// ⚠ Esperado: PASSA. "Nunca engajou" é diferente de "parou de engajar" — o
// ex-aluno importado nunca respondeu por aqui, e vetá-lo esvaziaria a
// reativação inteira, que é o motivo de o motor existir.
verifica(
  "quem NUNCA engajou não é barrado por stop_after_days",
  plano({}, [{ ...livre("a"), diasSemEngajamento: null }]).enviar,
  ["a"],
);

verifica(
  "mensagens demais sem resposta: barrado",
  plano({}, [{ ...livre("a"), semResposta: 3 }]).enviar.length,
  0,
);

// ⚠ Esperado: barrado. Quem acabou de responder está sendo atendido por uma
// PESSOA — toque proativo em cima disso é o sistema atropelando o vendedor no
// meio da conversa.
verifica(
  "respondeu há pouco: cooldown segura",
  plano({}, [{ ...livre("a"), horasDesdeRespostaDele: 2 }]).enviar.length,
  0,
);
verifica(
  "passado o cooldown, libera",
  plano({}, [{ ...livre("a"), horasDesdeRespostaDele: 50 }]).enviar,
  ["a"],
);

verifica(
  "falamos há menos que o intervalo mínimo: barrado",
  plano({}, [{ ...livre("a"), horasDesdeUltimoContato: 3 }]).enviar.length,
  0,
);

// Zero desliga a regra, em vez de barrar todo mundo. Regra que barra tudo
// quando está zerada é a que ninguém entende por que parou.
verifica(
  "limite zero desliga a regra em vez de barrar tudo",
  plano({ min_hours_between: 0, max_no_reply: 0, cooldown_hours: 0, stop_after_days: 0 },
    [{ contactId: "a", motivo: "reativacao", horasDesdeUltimoContato: 0, semResposta: 99, diasSemEngajamento: 999, horasDesdeRespostaDele: 0 }]).enviar,
  ["a"],
);

// ---------------------------------------------------------------------
// 5. TODO MUNDO TEM VEREDITO — nada sai da lista em silêncio
// ---------------------------------------------------------------------

// ⚠ Esperado: 3 vereditos para 3 candidatos. Sumir da lista sem explicação é
// o defeito da casa: a fila só fica menor e ninguém sabe por quê.
const p5 = plano({}, [
  livre("a"),
  { ...livre("b"), semResposta: 5 },
  { ...livre("c"), horasDesdeUltimoContato: 1 },
]);
verifica("cada candidato tem um veredito", p5.vereditos.length, 3);
verifica("só um sai", p5.enviar, ["a"]);
verifica("e os dois barrados têm motivo escrito",
  p5.vereditos.filter((v) => !v.enviar && v.motivo.length > 10).length, 2);

// ---------------------------------------------------------------------
// 5b. A JANELA VALE PARA ENVIAR, NÃO PARA CONFERIR
// ---------------------------------------------------------------------
//
// ⚠ O fundador confere a lista NOME POR NOME antes de disparar — aluno atual,
// convênio, quem nunca foi cliente — e quer fazer isso às 8h, antes de abrir a
// academia. Com a janela valendo na simulação, a resposta era "fora do
// horário" e a conferência só podia começar quando a campanha já podia sair.
//
// A janela protege QUEM RECEBE. Simular não manda mensagem nenhuma.
const p5b = planejar({
  candidatos: [livre("a")], regras: REGRAS, enviadosHoje: 0,
  horaLocal: 8, ignorarJanela: true,
});
verifica("às 8h, simulando, a lista aparece", p5b.enviar, ["a"]);
verifica("e o plano diz que foi fora da janela", p5b.foraDaJanela, true);

// ⚠ E O ENVIO CONTINUA PRESO AO HORÁRIO. Sem esta linha, a mudança acima
// teria transformado a trava de horário em enfeite.
verifica("às 8h, enviando, continua barrado", plano({}, [livre("a")], 0, 8).ativo, false);
verifica("e dentro da janela nada muda", plano({}, [livre("a")], 0, 10).enviar, ["a"]);
verifica("dentro da janela, `foraDaJanela` é falso",
  plano({}, [livre("a")], 0, 10).foraDaJanela, false);

// ---------------------------------------------------------------------
// 5c. O TETO POR RODADA — espalhar o TRABALHO, não enganar a Meta
// ---------------------------------------------------------------------
//
// ⚠ O teto do dia sozinho não espalha nada: com 40 no dia e duas rodadas
// agendadas, a primeira mandava as 40 e a segunda não achava ninguém.
//
// E o motivo de espalhar não é a Meta — é que RESPOSTA VEM EM ONDA. 40 de uma
// vez viram seis conversas simultâneas para quem estiver atendendo; 20 e 20
// viram três de manhã e três à tarde.
const cinco = ["a", "b", "c", "d", "e"].map(livre);

verifica("sem teto de rodada, sai todo mundo que couber no dia",
  plano({ max_per_day: 40 }, cinco).enviar.length, 5);
verifica("com teto de 2 por rodada, saem 2",
  plano({ max_per_day: 40, max_por_rodada: 2 }, cinco).enviar.length, 2);

// ⚠ E QUEM FICA PRECISA SABER QUE VOLTA HOJE, não amanhã. "Fica para amanhã"
// numa pessoa que sai às 17h é a tela mentindo sobre a própria regra.
verifica("e os barrados sabem que voltam na próxima rodada",
  plano({ max_per_day: 40, max_por_rodada: 2 }, cinco)
    .vereditos.filter((v) => !v.enviar && v.motivo.includes("próxima rodada")).length, 3);

// ⚠ O MENOR DOS DOIS MANDA. Teto de rodada maior que o do dia não pode furar
// o teto do dia — que é o que protege o número.
verifica("o teto do DIA continua sendo o limite duro",
  plano({ max_per_day: 3, max_por_rodada: 10 }, cinco).enviar.length, 3);

// ---------------------------------------------------------------------
// 6. O RECORTE DA CAMPANHA — quem saiu HÁ QUANTO TEMPO entra no lote
// ---------------------------------------------------------------------
//
// ⚠ POR QUE ELE EXISTE. Sem recorte, a reativação da Be Fitness são 1.049
// pessoas. O `max_per_day` não resolve: ele fatia o acervo em semanas e manda
// para todo mundo do mesmo jeito — quem escolhe QUEM é este campo. A primeira
// campanha começa pelos 35 dos últimos 90 dias porque ela existe para ENSINAR,
// e disparar o acervo inteiro é experimento sem controle na reputação do
// número, que é o ativo mais caro que existe aqui.

const exAluno = (id, dias) => ({ ...livre(id), diasNaEtapa: dias });

// Esperado: barrado, com o recorte marcado — é o que deixa a tela AGRUPAR os
// mil e poucos numa linha só, em vez de enterrar os vereditos que importam.
const p6 = plano({}, [exAluno("velho", 200)]);
verifica("saiu há 200 dias, recorte de 90: não sai", p6.enviar.length, 0);
verifica("e o veredito se declara recorte", p6.vereditos[0].recorte, true);
verifica("e o motivo diz há quantos dias ele saiu", p6.vereditos[0].motivo.includes("200 dias"), true);

// Esperado: sai. É o lote da primeira campanha.
verifica("saiu há 30 dias: entra no lote", plano({}, [exAluno("novo", 30)]).enviar, ["novo"]);

// O limite é inclusivo: 90 dias com recorte de 90 ainda é "dentro dos últimos
// 90". Exclusivo seria o erro de borda que tira uma pessoa da campanha sem
// ninguém notar.
verifica("exatamente no limite ainda entra", plano({}, [exAluno("borda", 90)]).enviar, ["borda"]);
verifica("um dia além do limite não entra", plano({}, [exAluno("borda", 91)]).enviar.length, 0);

// Zero desliga o recorte, como todo limite desta tela. Quem quiser o acervo
// inteiro escreve 0 — e aí é decisão tomada, não esquecimento.
verifica("recorte zero libera o acervo inteiro",
  plano({ reativacao_max_dias: 0 }, [exAluno("velho", 2000)]).enviar, ["velho"]);

// ⚠ O RECORTE É SÓ DA REATIVAÇÃO. A renovação também mede tempo de etapa, e
// ali etapa antiga é o CLIENTE FIEL: aplicar o recorte barraria o melhor aluno
// da casa — o oposto exato do que o campo existe para fazer.
verifica("renovação não é barrada pelo recorte",
  plano({}, [{ ...exAluno("fiel", 900), motivo: "renovacao" }]).enviar, ["fiel"]);

// Sem data registrada o recorte não barra: barrar por ausência de dado tiraria
// a pessoa da campanha em silêncio, e "sem data" é problema de cadastro.
verifica("sem data de entrada na etapa, o recorte não barra",
  plano({}, [livre("sem-data")]).enviar, ["sem-data"]);

// ⚠ O RECORTE VEM ANTES DAS OUTRAS REGRAS. Dizer "cooldown" para quem saiu há
// três anos manda a pessoa procurar um problema que não existe.
verifica("o recorte tem precedência sobre o cooldown",
  plano({}, [{ ...exAluno("velho", 800), horasDesdeRespostaDele: 1 }]).vereditos[0].recorte, true);

// ⚠ E QUANDO NINGUÉM PASSA, A TELA PRECISA SABER SE FOI O RECORTE. "Nenhum
// candidato passou nas regras" seria a mesma frase para um defeito e para o
// funcionamento normal de uma campanha recortada.
const p6b = plano({}, [exAluno("a", 200), exAluno("b", 300)]);
verifica("o porquê aponta o recorte quando ele barrou todo mundo",
  p6b.porque.includes("recorte de 90 dias"), true);

// ---------------------------------------------------------------------
// 7. O PADRÃO DA EMPRESA QUE NUNCA CONFIGUROU
// ---------------------------------------------------------------------
//
// ⚠ Campo ausente vale 90, e isso MUDA o comportamento de quem já tinha
// `automation` salvo. É deliberado: barrar demais aparece na simulação com o
// motivo escrito em cada pessoa; soltar demais aparece na fatura da Meta e no
// número marcado.
verifica("sem nada salvo, o recorte já vem em 90 dias",
  readAutomation(null).reativacao_max_dias, 90);
verifica("e o padrão declarado é o mesmo",
  AUTOMATION_DEFAULTS.reativacao_max_dias, 90);
verifica("zero salvo é respeitado, não substituído pelo padrão",
  readAutomation({ automation: { reativacao_max_dias: 0 } }).reativacao_max_dias, 0);

console.log(falhas === 0 ? "\nmotor: tudo certo." : `\nmotor: ${falhas} falha(s).`);
process.exit(falhas === 0 ? 0 : 1);
