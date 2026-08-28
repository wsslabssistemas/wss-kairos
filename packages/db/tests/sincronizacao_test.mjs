/**
 * A SINCRONIZAÇÃO COM A FONTE EXTERNA — sem banco e sem chave.
 *
 * ⚠ ESTE TESTE GUARDA DUAS COISAS: que a ausência vire histórico, e que ela
 * NÃO vire histórico quando a fonte não é confiável.
 *
 * O fundador viu o problema sozinho: *"toda vez que eu atualizar a aba
 * Matriculas, quem virou ex-cliente vai ser apagado, e o sistema perde o
 * histórico."* A saída não foi o sistema manter uma aba — foi ele COMPARAR a
 * foto de hoje com o que já sabia. Ausência é informação, e só o sistema
 * enxerga, porque só ele lembra do que havia antes.
 *
 * E a metade perigosa: se a planilha vier PARCIAL — filtro aplicado, aba
 * baixada pela metade — a mesma regra daria baixa em massa em quem continua
 * pagando. É a classe de defeito que já custou o curso inteiro aqui: o
 * `seed-curso.mjs` derrubou oito módulos ao lado **saindo com três ✓ verdes**,
 * porque o relatório só mostrava o que ele mesmo escrevera.
 *
 * ESPERADO: 20/20.
 *
 *   node packages/db/tests/sincronizacao_test.mjs
 */
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const { comparar, marcarPorCruzamento, LIMITE_DESAPARECIDOS } = await import(
  pathToFileURL(path.join(ROOT, "apps/web/lib/sincronizacao.ts")).href
);

let falhas = 0;
function verifica(nome, obtido, esperado) {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "✓" : "✗"} ${nome}`);
  if (!ok) console.log(`    esperado: ${JSON.stringify(esperado)}\n    obtido:   ${JSON.stringify(obtido)}`);
}
const tipoDe = (r, chave) => r.eventos.find((e) => e.chave === chave)?.tipo;

// Uma base de 20 ativos, para a proporção da trava ter sentido.
const ativos = (n, ate = "2026-12-31") =>
  Array.from({ length: n }, (_, i) => ({ chave: `c${i}`, nome: `Pessoa ${i}`, vigencia_ate: ate }));
const fonteDe = (b) => b.map(({ chave, nome, vigencia_ate }) => ({ chave, nome, vigencia_ate }));

// ------------------------------------------------------ O CASO MARIA ISABEL

// Vigência que ANDA PARA FRENTE é renovação OBSERVADA — fato, não dedução
// sobre dado velho. Sem isto ela seguiria como "venceu" para sempre.
const banco = [{ chave: "7386", nome: "Maria Isabel", vigencia_ate: "2026-08-10" }, ...ativos(19)];
const comRenovacao = [{ chave: "7386", nome: "Maria Isabel", vigencia_ate: "2027-02-10" }, ...fonteDe(ativos(19))];
const r1 = comparar(comRenovacao, banco);
verifica("vigência que anda para frente é renovação", tipoDe(r1, "7386"), "renovou");
verifica("e a renovação não bloqueia nada", r1.bloqueio, null);
verifica("quem não mudou não vira evento de mudança", tipoDe(r1, "c0"), "sem_mudanca");

// ⚠ VIGÊNCIA QUE ANDA PARA TRÁS NÃO É CANCELAMENTO. Quase sempre é erro de
// digitação ou exportação. Encurtar em silêncio colocaria gente na fila de
// renovação sem motivo — então vira evento para alguém olhar.
const r2 = comparar(
  [{ chave: "7386", vigencia_ate: "2026-06-01" }, ...fonteDe(ativos(19))],
  banco,
);
verifica("vigência encurtada vira aviso, não baixa", tipoDe(r2, "7386"), "vigencia_recuou");

// ------------------------------------ RENOVAÇÃO × AJUSTE DE DATA
//
// ⚠ ACHADO NA PRIMEIRA EXECUÇÃO CONTRA A PLANILHA REAL (13/ago).
//
// Das 7 vigências que andaram para frente na base da Be Fitness, **4 eram
// ajuste de data** — 6, 13, 20 e 21 dias: mudança de dia de cobrança, crédito
// de dias parados, correção de digitação. Só 3 eram renovação (183, 365 e 92
// dias, batendo com semestral, anual e trimestral).
//
// Tratar ajuste como renovação erra dos dois lados, e o segundo é o caro:
// mandaria "obrigado por renovar" a quem não renovou **e tiraria da fila de
// renovação alguém cujo contrato continua vencendo logo** — perdendo
// exatamente a receita que a fila existe para proteger.
const mudou = (de, para, ciclo) => comparar(
  [{ chave: "k", nome: "P", vigencia_ate: para, ciclo_dias: ciclo }],
  [{ chave: "k", nome: "P", vigencia_ate: de }],
).eventos[0].tipo;

// O caso Maria Isabel: semestral, +183 dias.
verifica("meio ciclo à frente é renovação", mudou("2026-08-10", "2027-02-09", 180), "renovou");
// O caso Michélle: +6 dias num plano anual.
verifica("seis dias num plano anual é ajuste", mudou("2027-05-03", "2027-05-09", 365), "ajuste_de_data");
// Mensal que anda 30 dias É renovação — por isso a régua é proporcional ao
// ciclo, e não um número fixo que trataria mensal e anual igual.
verifica("mensal que anda um mês é renovação", mudou("2026-08-01", "2026-08-31", 30), "renovou");
verifica("anual que anda um mês é ajuste", mudou("2026-08-01", "2026-08-31", 365), "ajuste_de_data");
// Sem ciclo declarado, vale o piso absoluto de 28 dias — abaixo do menor
// ciclo real que existe nos planos.
verifica("sem ciclo, o piso absoluto decide",
  [mudou("2026-08-01", "2026-08-20", null), mudou("2026-08-01", "2026-09-15", null)],
  ["ajuste_de_data", "renovou"]);

// --------------------------------------------------- AUSÊNCIA VIRA HISTÓRICO
//
// ⚠ A VIGÊNCIA DESTES CASOS PASSOU A SER VENCIDA (28/ago). Antes o padrão do
// `ativos()` era 2026-12-31 — futuro —, e a ausência da fonte virava "encerrou"
// de qualquer jeito. Hoje ausência COM CONTRATO CORRENDO é contradição, não
// encerramento, e vira `sumiu_vigente`. Estes testes descrevem o encerramento
// legítimo — contrato que acabou —, então a data acompanha o que eles medem.

const VENCIDO = "2026-06-30";

// Um sumido em 20 ativos = 5%, abaixo do limite: aplica.
const r3 = comparar(fonteDe(ativos(20, VENCIDO)).slice(0, 19), ativos(20, VENCIDO));
verifica("quem sumiu da fonte encerrou", tipoDe(r3, "c19"), "encerrou");
verifica("um sumido não bloqueia", r3.bloqueio, null);
verifica("o resumo conta o encerramento", r3.resumo.encerraram, 1);

// Quem estava baixado e voltou não é gente nova — é retorno, e a diferença é
// o histórico que o fundador quer manter.
const r4 = comparar(
  [{ chave: "x", nome: "Voltou", vigencia_ate: "2027-01-01" }],
  [{ chave: "x", nome: "Voltou", vigencia_ate: "2026-01-01", encerrado: true }],
);
verifica("quem estava baixado e voltou é reaparecimento", tipoDe(r4, "x"), "reapareceu");

// Quem nunca existiu é entrada.
verifica("quem não existia entrou",
  tipoDe(comparar([{ chave: "novo" }], []), "novo"), "entrou");

// ------------------------------------------------------- A TRAVA DA PARCIAL

// ⚠ O CASO QUE ESTA TRAVA EXISTE PARA IMPEDIR: planilha com filtro aplicado.
// 5 de 20 sumidos = 25%, acima dos 15%. Nada pode ser aplicado.
const parcial = comparar(fonteDe(ativos(20, VENCIDO)).slice(0, 15), ativos(20, VENCIDO));
verifica("planilha parcial BLOQUEIA", parcial.bloqueio !== null, true);
verifica("e a mensagem diz que nada foi gravado",
  parcial.bloqueio.includes("nada foi gravado"), true);
// Os eventos continuam sendo devolvidos — para o humano VER o que teria
// acontecido. Bloquear e esconder seria pedir para alguém desligar a trava.
verifica("mas os eventos continuam visíveis para conferência",
  parcial.eventos.filter((e) => e.tipo === "encerrou").length, 5);

// Fonte VAZIA é o caso extremo e tem mensagem própria: 100% sumiriam.
const vazia = comparar([], ativos(20));
verifica("fonte vazia bloqueia com aviso próprio",
  vazia.bloqueio.includes("veio VAZIA"), true);

// E a trava é por PROPORÇÃO: 5 sumidos em 200 ativos é 2,5% e passa. O mesmo
// número absoluto que bloqueia numa base pequena é rotina numa base grande.
verifica("a trava é proporcional, não absoluta",
  comparar(fonteDe(ativos(200)).slice(0, 195), ativos(200)).bloqueio, null);
verifica("o limite é 15%", LIMITE_DESAPARECIDOS, 0.15);

// ------------------------------------------- CRUZAMENTO DAS ABAS DE CONVÊNIO

// O fundador recusou manter uma coluna à mão — "vai ter que ser manual, então
// sem chances" — e estava certo: trabalho manual recorrente para de acontecer,
// e aí o dado fica errado em silêncio. O sistema deriva.
const cruz = marcarPorCruzamento(
  [{ chave: "a" }, { chave: "b" }, { chave: "c" }],
  [{ marcacao: "wellhub", linhas: [{ chave: "a" }, { chave: "zzz" }] },
   { marcacao: "totalpass", linhas: [{ chave: "b" }] }],
);
verifica("a marcação é derivada do cruzamento",
  cruz.linhas.map((l) => [l.chave, l.marcacoes ?? []]),
  [["a", ["wellhub"]], ["b", ["totalpass"]], ["c", []]]);
// Órfão é informação: quem está na aba do convênio e não na base significa que
// as abas divergiram — e é exatamente isso que se quer ver.
verifica("quem está no convênio e não na base vira órfão, não some",
  cruz.orfaos, [{ marcacao: "wellhub", chaves: ["zzz"] }]);

// ============================================ O DENOMINADOR DA TRAVA (28/ago)
//
// ⚠ O CASO REAL DA BE FITNESS. O fundador exportou a relação de matriculados —
// 304 pessoas, correta — e a trava respondeu "1148 de 1434 contratos ativos
// (80%) sumiram da fonte". O numero 1.434 estava errado: ele contava toda
// pessoa com codigo do sistema que nunca passara por uma sincronizacao, e
// **996 dessas ja estavam em `ex_aluno` ha meses**. Sobravam 307 convertidos —
// compativel com os 304 da planilha.
//
// ⚠ ALARME QUE TOCA SEMPRE E ALARME DESLIGADO. Medindo assim, a trava
// dispararia em TODA importacao e ensinaria a clicar em "aplicar mesmo assim"
// sem ler — e no dia da planilha de verdade parcial, ninguem pararia. A trava
// existe justamente para esse dia.

const ATIVA = "convertido";
const banco1434 = [
  ...Array.from({ length: 996 }, (_, i) => ({ chave: `ex${i}`, etapa: "ex_aluno" })),
  ...Array.from({ length: 127 }, (_, i) => ({ chave: `pd${i}`, etapa: "perdido" })),
  ...Array.from({ length: 307 }, (_, i) => ({ chave: `at${i}`, etapa: "convertido" })),
];
// A planilha correta: 304 dos 307 convertidos continuam la.
const fonte304 = Array.from({ length: 304 }, (_, i) => ({ chave: `at${i}`, vigencia_ate: "2027-01-01" }));

const antes = comparar(fonte304, banco1434, undefined, false, null);
verifica(
  "sem a etapa ativa, a trava BLOQUEIA uma planilha correta (o defeito)",
  antes.bloqueio !== null,
  true,
);
const depois = comparar(fonte304, banco1434, undefined, false, ATIVA);
verifica("com a etapa ativa, a mesma planilha PASSA", depois.bloqueio, null);
verifica("e o denominador vira 307, nao 1.434", depois.resumo.noBanco, 307);
verifica("os que somem de verdade sao 3", depois.resumo.encerraram >= 3, true);

// ⚠ MAS OS QUE ESTAO FORA DA ETAPA CONTINUAM SENDO REGISTRADOS. Eles saem do
// DENOMINADOR do alarme, nunca do relatorio: quem some da planilha ganha o
// carimbo de encerrado de qualquer forma — o que muda e que nao move ninguem.
const encerrouTudo = depois.eventos.filter((e) => e.tipo === "encerrou").length;
verifica("ex-aluno e perdido continuam aparecendo como encerrados", encerrouTudo > 1000, true);

// ⚠ E A FONTE VAZIA CONTINUA BARRADA SEM SAIDA, com ou sem etapa declarada.
// Nenhuma confirmacao torna razoavel dar baixa em todo mundo a partir de um
// arquivo sem uma linha: isso e sempre exportacao quebrada, nunca a realidade.
verifica("fonte vazia barra mesmo com etapa ativa",
  comparar([], banco1434, undefined, true, ATIVA).bloqueio !== null, true);

// ⚠ MANIFESTO SEM `active_stage` MANTEM O COMPORTAMENTO ANTIGO. Omissao nao
// pode afrouxar trava: medir de menos e pior que medir demais aqui.
// 996 + 127 + 307 = 1.430 neste cenario montado. Na Be Fitness real eram
// 1.434 porque havia mais 4 em `recusou` e `experimentacao` — a natureza do
// erro e a mesma: cadastro contado como contrato.
verifica("sem etapa declarada, o denominador volta a ser o antigo (todo mundo)",
  comparar(fonte304, banco1434, undefined, false, null).resumo.noBanco, 1430);

// ================================ SUMIU COM CONTRATO CORRENDO (28/ago, tarde)
//
// ⚠ O SEGUNDO DEFEITO DO MESMO DIA, e a trava dos 15% nao pegava. Depois de
// corrigido o denominador, a previsao ficou em 27 baixas sobre 307 ativos —
// 8,8%, dentro do limite, sem alarme nenhum. Mas **20 daquelas 27 tinham
// contrato correndo**, uma ate agosto de 2027.
//
// Conferidos tres na fonte, deram tres respostas diferentes:
//   • um cancelou de verdade (mudou de cidade);
//   • um combinou pagar o anual em duas parcelas, a segunda ainda por vencer;
//   • um **tinha pago o ano inteiro a vista e nao devia nada**.
// A exportacao de "plano ativo" nao era "quem e aluno": era, na pratica, uma
// lista de cobranca em aberto.
//
// ⚠ CONTAR NAO SUBSTITUI CONFERIR. A trava de 15% mede QUANTOS somem; esta
// olha QUEM some. Vinte mensagens de "voce parou de treinar, quer voltar?"
// para alunos pagantes e dano que nenhum percentual mede — e o pior deles
// tinha pago um ano adiantado.

const HOJE = "2026-08-28";
const bancoMisto = [
  // venceu este mes: saida coerente, fecha sozinho
  { chave: "v1", nome: "Venceu Um", etapa: "convertido", vigencia_ate: "2026-08-15" },
  { chave: "v2", nome: "Venceu Dois", etapa: "convertido", vigencia_ate: "2026-08-20" },
  // contrato correndo: contradicao, NAO fecha sozinho
  { chave: "f1", nome: "Pagou O Ano", etapa: "convertido", vigencia_ate: "2027-06-06" },
  { chave: "f2", nome: "Parcelou", etapa: "convertido", vigencia_ate: "2027-08-08" },
  // continua na fonte
  { chave: "ok", nome: "Segue", etapa: "convertido", vigencia_ate: "2027-01-01" },
];
const fonteMista = [{ chave: "ok", vigencia_ate: "2027-01-01" }];

const r = comparar(fonteMista, bancoMisto, undefined, false, "convertido", HOJE);
verifica("quem venceu vira 'encerrou'", r.resumo.encerraram, 2);
verifica("quem tem contrato correndo vira 'sumiu_vigente'", r.resumo.vigentesSumidos, 2);

// ⚠ OS DOIS GRUPOS APARECEM. Esconder o segundo trocaria uma baixa errada por
// uma ausencia silenciosa — a pessoa precisa LER a lista para decidir.
const vig = r.eventos.filter((e) => e.tipo === "sumiu_vigente");
verifica("e o motivo vai escrito, com a data do contrato",
  vig.every((e) => e.descricao.includes("contrato vai até")), true);
verifica("o texto avisa que nao ha baixa sem marcar",
  vig[0].descricao.includes("NÃO recebe baixa"), true);

// ⚠ A BORDA: vigencia que termina HOJE ainda esta correndo. Fechar quem vence
// hoje seria dar baixa em quem pode renovar amanha.
const borda = comparar([], [{ chave: "b", etapa: "convertido", vigencia_ate: HOJE }],
  undefined, true, "convertido", HOJE);
verifica("contrato que termina hoje ainda conta como vigente", borda.resumo.vigentesSumidos, 1);

// ⚠ SEM DATA DE VIGENCIA nao vira contradicao: nao ha contrato correndo para
// contradizer. Fecha pelo caminho normal.
const semData = comparar([], [{ chave: "s", etapa: "convertido", vigencia_ate: null }],
  undefined, true, "convertido", HOJE);
verifica("sem data de vigencia fecha normal", semData.resumo.encerraram, 1);

console.log(falhas === 0 ? "\nOK — 20/20" : `\nFALHOU — ${falhas} de 20`);
process.exit(falhas === 0 ? 0 : 1);
