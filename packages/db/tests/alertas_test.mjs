/**
 * O ALERTA ATIVO — e as duas maneiras de ele não servir para nada.
 *
 * ⚠ POR QUE ESTE ARQUIVO EXISTE.
 *
 * Registro o produto já tinha: `motor_execucoes`, o vigia do canal, a validade
 * do token, o alarme de silêncio. Tudo desenhava na tela e esperava alguém
 * abrir — e a peça inteira roda quando ninguém está olhando. O fundador
 * resumiu em 04/set: *"eu até pensei que já tinha, pois eu já havia
 * solicitado"*. Tinha registro; não tinha alerta.
 *
 * Um alarme falha de dois jeitos opostos, e os dois são silenciosos:
 *
 *   1. **Nunca toca.** Se parece exatamente com "está tudo bem" — que é o
 *      defeito que este produto já pagou tantas vezes.
 *   2. **Toca sempre.** Um token vencendo em 7 dias renderia um e-mail a cada
 *      15 minutos por uma semana: 672 e-mails. Na terceira hora a pessoa cria
 *      uma regra de caixa de entrada, e a partir daí NENHUM alerta desta casa
 *      chega em ninguém, para sempre. Alarme que toca à toa é alarme
 *      desligado — só que desligado na cabeça de quem recebe, onde nenhum
 *      teste alcança.
 *
 * A `chave` é o que separa os dois: ela cala a repetição e deixa passar a
 * PIORA, que é a única novidade que importa num alarme.
 *
 * Valor esperado escrito no arquivo. "Parece certo" não é critério.
 */

import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const { alertasDoEstado, filtrarJaAvisados, silencioDe } = await import(
  pathToFileURL(path.join(ROOT, "apps/web/lib/alertas.ts")).href
);

let falhas = 0;
function verifica(nome, obtido, esperado) {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "  ok" : "FALHA"}  ${nome}`);
  if (!ok) console.log(`        esperado: ${JSON.stringify(esperado)}\n        obtido:   ${JSON.stringify(obtido)}`);
}

/** Tudo em ordem: nada deve tocar. */
const CALMO = {
  minutosSemBatida: 3,
  decisoesPendentes: [],
  qualidade: "alta",
  diasDoToken: 40,
};

// ---------------------------------------------------------------------
// 1. O SILÊNCIO NORMAL — alarme que toca com tudo certo é o pior de todos
// ---------------------------------------------------------------------

// Esperado: nenhum alerta. Este é o estado do produto na maior parte do tempo,
// e é o caso que precisa ser mudo.
verifica("com tudo em ordem, nada toca", alertasDoEstado(CALMO), []);

// Esperado: nada. Agendador batendo há 59 minutos ainda está dentro da regra —
// o alarme é de UMA hora, e antecipá-lo faria ele tocar em toda batida lenta.
verifica(
  "59 minutos sem batida ainda não é alarme",
  alertasDoEstado({ ...CALMO, minutosSemBatida: 59 }),
  [],
);

// Esperado: nada. `null` é "nunca bateu" — empresa nova, que nunca ligou a
// automação. Tocar aqui seria alarme à toa em toda empresa em teste grátis,
// e é o mesmo cuidado que a tela já toma.
verifica(
  "empresa que nunca teve batida não dispara alarme",
  alertasDoEstado({ ...CALMO, minutosSemBatida: null }),
  [],
);

// ---------------------------------------------------------------------
// 2. O QUE TOCA
// ---------------------------------------------------------------------

// Esperado: um alerta urgente de agendador mudo.
verifica(
  "uma hora sem batida toca, e é urgente",
  alertasDoEstado({ ...CALMO, minutosSemBatida: 61 }).map((a) => [a.tipo, a.gravidade]),
  [["agendador_mudo", "urgente"]],
);

// Esperado: um alerta por decisão pendente, com o nome da pessoa no título.
// ⚠ É o caso mais importante da fase 2: a trava recusou escrever (o produto
// funcionando) e tem gente esperando resposta que não vem sozinha.
verifica(
  "cada decisão pendente vira um alerta com o nome de quem espera",
  alertasDoEstado({
    ...CALMO,
    decisoesPendentes: [
      { id: "d1", nome: "Lilian", porque: "faltam fatos" },
      { id: "d2", nome: "Jeferson", porque: "faltam fatos" },
    ],
  }).map((a) => [a.tipo, a.chave, a.titulo]),
  [
    ["decisao_pendente", "d1", "Lilian está esperando resposta"],
    ["decisao_pendente", "d2", "Jeferson está esperando resposta"],
  ],
);

// Esperado: média é aviso, baixa é urgente — e alta não toca.
verifica(
  "a nota do número: alta cala, média avisa, baixa é urgente",
  ["alta", "media", "baixa"].map(
    (q) => alertasDoEstado({ ...CALMO, qualidade: q }).map((a) => a.gravidade)[0] ?? null,
  ),
  [null, "aviso", "urgente"],
);

// Esperado: 8 dias não toca, 7 avisa, 3 é urgente, vencido é urgente.
// ⚠ Token vencido não dá erro visível: o canal para inteiro e o sintoma é
// tudo parecer normal com nada chegando.
verifica(
  "token: 8 dias cala, 7 avisa, 3 e vencido são urgentes",
  [8, 7, 3, -1].map((d) => {
    const a = alertasDoEstado({ ...CALMO, diasDoToken: d }).find((x) => x.tipo === "token_vencendo");
    return a ? a.gravidade : null;
  }),
  [null, "aviso", "urgente", "urgente"],
);

// ---------------------------------------------------------------------
// 3. A JANELA DE SILÊNCIO — e a piora que precisa furá-la
// ---------------------------------------------------------------------

const AGORA = new Date("2026-09-04T12:00:00.000Z");
const umAlerta = (tipo, chave) => [{ tipo, chave, gravidade: "aviso", titulo: "t", corpo: "c" }];

// Esperado: calado. Avisado há uma hora, e a janela do token é de 24h.
verifica(
  "avisado há uma hora não avisa de novo",
  filtrarJaAvisados(
    umAlerta("token_vencendo", "7"),
    [{ tipo: "token_vencendo", chave: "7", enviado_em: "2026-09-04T11:00:00.000Z" }],
    AGORA,
  ).length,
  0,
);

// Esperado: toca. Passada a janela, o mesmo alerta volta — porque o problema
// também voltou (ou nunca foi resolvido).
verifica(
  "passada a janela, o mesmo alerta volta",
  filtrarJaAvisados(
    umAlerta("token_vencendo", "7"),
    [{ tipo: "token_vencendo", chave: "7", enviado_em: "2026-09-03T11:00:00.000Z" }],
    AGORA,
  ).length,
  1,
);

// ⚠ ESTE É O CASO QUE JUSTIFICA A `chave` EXISTIR. O aviso de "7 dias" saiu
// hoje de manhã; agora o token vence em 3 e a coisa ficou urgente. Sem chave,
// a janela de 24h engoliria justamente a piora — e a piora é a única novidade
// que importa num alarme.
verifica(
  "a piora fura o silêncio do aviso anterior",
  filtrarJaAvisados(
    umAlerta("token_vencendo", "3"),
    [{ tipo: "token_vencendo", chave: "7", enviado_em: "2026-09-04T11:00:00.000Z" }],
    AGORA,
  ).length,
  1,
);

// Esperado: passa. Data ilegível deixa o alerta sair — perder um alerta é pior
// que repetir um, e é a mesma direção de erro que o resto da casa escolhe.
verifica(
  "registro com data ilegível deixa o alerta passar",
  filtrarJaAvisados(
    umAlerta("token_vencendo", "7"),
    [{ tipo: "token_vencendo", chave: "7", enviado_em: "ontem de manhã" }],
    AGORA,
  ).length,
  1,
);

// Esperado: tipo desconhecido tem janela padrão, nunca zero. Janela zero faria
// um alerta novo virar metralhadora no dia em que alguém o criasse.
verifica(
  "tipo sem janela declarada usa o padrão, e o padrão não é zero",
  [silencioDe("inventado_agora") > 0, silencioDe("token_vencendo")],
  [true, 24],
);

// ---------------------------------------------------------------------
// MODELO APROVADO E MODELO RECUSADO (5/set/2026)
//
// ⚠ O fundador submeteu dois modelos e pediu: *"me avisa quando forem
// aprovados"*. Depender de eu estar numa conversa para isso e o mesmo defeito
// de todo o resto: a noticia chega quando ninguem esta olhando.
//
// ⚠ E A RECUSA E A NOTICIA QUE NINGUEM DESCOBRE SOZINHO. Modelo recusado nao
// aparece na lista de aprovados — e nao aparecer se parece exatamente com
// continuar em analise. O dono ficaria esperando indefinidamente por uma
// aprovacao que ja foi negada.
// ---------------------------------------------------------------------

// Esperado: PENDING nao toca. Submeter nao e noticia — ele acabou de submeter.
verifica(
  "modelo em analise nao gera alerta",
  alertasDoEstado({ ...CALMO, modelos: [{ nome: "convenio_retomada", status: "PENDING" }] }),
  [],
);

// Esperado: aprovado avisa, e o corpo diz o que fazer depois — sem isso o
// aviso e so uma boa noticia, e boa noticia sem proximo passo nao vira acao.
verifica(
  "modelo aprovado avisa, com a chave do estado",
  alertasDoEstado({ ...CALMO, modelos: [{ nome: "convenio_retomada", status: "APPROVED" }] })
    .map((a) => [a.tipo, a.chave, a.gravidade]),
  [["modelo_status", "convenio_retomada:APPROVED", "aviso"]],
);

// Esperado: recusado e URGENTE. Quem depende dele para de falar, sem erro em
// lugar nenhum.
verifica(
  "modelo recusado e urgente",
  alertasDoEstado({ ...CALMO, modelos: [{ nome: "convenio_retomada", status: "REJECTED" }] })
    .map((a) => a.gravidade),
  ["urgente"],
);

// ⚠ A CHAVE CARREGA O ESTADO, e e isso que faz a mudanca furar o silencio: o
// mesmo modelo, avisado como aprovado, avisa DE NOVO se for suspenso depois.
verifica(
  "aprovado antes nao cala a suspensao depois",
  filtrarJaAvisados(
    alertasDoEstado({ ...CALMO, modelos: [{ nome: "x", status: "PAUSED" }] }),
    [{ tipo: "modelo_status", chave: "x:APPROVED", enviado_em: "2026-09-05T11:00:00.000Z" }],
    new Date("2026-09-05T12:00:00.000Z"),
  ).length,
  1,
);

// Esperado: a mesma noticia nao se repete a cada hora. A leitura roda de hora
// em hora; sem isto, "foi aprovado" viraria 24 e-mails por dia.
verifica(
  "a mesma aprovacao nao avisa duas vezes",
  filtrarJaAvisados(
    alertasDoEstado({ ...CALMO, modelos: [{ nome: "x", status: "APPROVED" }] }),
    [{ tipo: "modelo_status", chave: "x:APPROVED", enviado_em: "2026-09-05T11:00:00.000Z" }],
    new Date("2026-09-05T12:00:00.000Z"),
  ).length,
  0,
);

console.log(falhas === 0 ? "\nalertas: tudo certo." : `\nalertas: ${falhas} falha(s).`);
process.exit(falhas === 0 ? 0 : 1);
