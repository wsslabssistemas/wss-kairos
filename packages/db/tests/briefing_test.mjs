/**
 * BRIEFING NAO E FALA DO CLIENTE — e a metrica que erra a favor.
 *
 * ⚠ O ACHADO DE 27/ago/2026. Quem atende escreve, no campo de mensagem da aba
 * Responder, coisas como *"faca uma mensagem de proposta para o retorno da
 * aluna"* ou *"MATRICULA RENOVADA POR MAIS 6 MESES"*. Isso e BOM: e briefing, e
 * a IA gera resposta melhor com ele. O defeito era o texto ficar gravado como
 * `customer_message` — como se a cliente tivesse dito aquilo.
 *
 * ⚠ E O ERRO APONTAVA PARA O LADO BONITO. A pessoa escreve o briefing e a
 * resposta sai em segundos: ela responde a si mesma. Isso entrava no tempo de
 * resposta e puxava mediana e p90 para BAIXO. Eram 183 de 1.274 entradas — 14%
 * — e o produto parecia atender mais rapido do que atende, justamente na
 * metrica que ele vende. Numero que lisonjeia ninguem audita.
 *
 * ⚠ E A CAIXA JA EXISTIA. O `0001_foundation.sql` escreveu, no primeiro dia:
 * "input_kind separa tres coisas... mensagem real do cliente, ANOTACAO DO
 * VENDEDOR, e iniciativa do sistema". A terceira gaveta nunca foi usada.
 *
 * Este arquivo guarda as tres regras que a `0068` fixou.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
// ⚠ NORMALIZA CRLF. Os arquivos aqui estao em CRLF e o CI roda em LF: trava que
// mede coisa diferente na maquina do fundador e no CI e trava que se desliga.
const ler = (p) => fs.readFileSync(path.join(ROOT, p), "utf8").replace(/\r\n/g, "\n");

let falhas = 0;
function verifica(nome, ok, detalhe = "") {
  if (!ok) falhas++;
  console.log(`${ok ? "  ok" : "FALHA"}  ${nome}`);
  if (!ok && detalhe) console.log(`        ${detalhe}`);
}

// ------------------------------------------------------ 1. a gravacao
const aiActions = ler("apps/web/app/painel/responder/ai-actions.ts");
const actions = ler("apps/web/app/painel/responder/actions.ts");
verifica(
  "aba Responder grava o briefing como agent_note",
  aiActions.includes('input_kind: "agent_note"'),
  "responder/ai-actions.ts precisa gravar o texto digitado como agent_note",
);
verifica(
  "e o registro manual tambem",
  actions.includes('input_kind: "agent_note"'),
  "responder/actions.ts precisa gravar inbound como agent_note",
);
verifica(
  "nenhum dos dois volta a gravar inbound como customer_message",
  !/direction: "inbound",\s*(\/\/[^\n]*\n\s*)*input_kind: "customer_message"/.test(aiActions) &&
    !/direction: "inbound", input_kind: "customer_message"/.test(actions),
  "so o webhook pode gravar customer_message — e o cliente que escreve",
);

// ⚠ O WEBHOOK CONTINUA GRAVANDO customer_message. Se esta trava inverter, a
// mensagem real do cliente sai do tempo de resposta e a metrica zera em
// silencio — o contrario do defeito, com a mesma cara.
const rota = ler("apps/web/app/api/[[...route]]/route.ts");
verifica(
  "o webhook segue gravando customer_message (o cliente e quem fala)",
  rota.includes('"customer_message"'),
);

// -------------------------------------------- 2. a janela de 24h da Meta
// ⚠ O CASO CARO. A janela e um conceito da META: so abre com mensagem que
// passou pelo canal. Briefing interno e conversa do WhatsApp pessoal
// registrada a mao NAO abrem nada — mas faziam o codigo concluir que estava
// aberta, mandar TEXTO LIVRE, e a Meta recusar. E a recusa se le como
// "credencial errada": uma anotacao interna derrubava um envio e mandava quem
// investigasse olhar o token.
const despacho = ler("apps/web/lib/despacho.ts");
const trechoJanela = despacho.slice(
  despacho.indexOf("const { data: ultimaEntrada }"),
  despacho.indexOf("const janela = janelaDeAtendimento"),
);
verifica(
  "so o que chegou pela Meta abre a janela de 24h",
  trechoJanela.includes('.not("external_id", "is", null)'),
  "lib/despacho.ts: a busca da ultima entrada precisa exigir external_id",
);

// ------------------------------------------------- 3. quem conta atendimento
const equipe = ler("apps/web/app/painel/equipe/page.tsx");
verifica(
  "o placar da equipe ignora o que nao e fala do cliente",
  equipe.includes('i.input_kind !== "customer_message"'),
  "equipe/page.tsx contava briefing como atendimento — e inflava a favor de quem usa mais a ferramenta",
);
verifica(
  "e carrega input_kind para conseguir filtrar",
  equipe.includes("input_kind: string"),
);

const provas = ler("apps/web/app/painel/provas/actions.ts");
verifica(
  "o banco de provas so julga fala de cliente",
  provas.includes('.eq("input_kind", "customer_message")'),
  "provas/actions.ts: julgar a resposta a um briefing mede outra coisa",
);

// ⚠ A GESTAO JA FILTRAVA — e e ela que calcula mediana e p90. Se alguem tirar
// este filtro, o defeito volta inteiro e para o lado bonito de novo.
for (const f of ["apps/web/app/painel/gestao/page.tsx", "apps/web/app/painel/gestao/ia-actions.ts"]) {
  verifica(
    `${path.basename(f)} mantem o filtro do tempo de resposta`,
    ler(f).includes('i.input_kind === "customer_message"'),
  );
}

// ------------------------------------------------- 4. o que NAO pode mudar
// ⚠ O BRIEFING CONTINUA INDO PARA O PROMPT. Foi o ponto do fundador: escrito
// assim, a IA responde bem. O historico da geracao seleciona direction/content
// e NAO filtra input_kind. Se alguem filtrar, a qualidade cai sem nada quebrar.
const histDaGeracao = aiActions.slice(
  aiActions.indexOf('.select("direction, content, occurred_at")'),
  aiActions.indexOf('.select("direction, content, occurred_at")') + 400,
);
verifica(
  "o historico do prompt NAO filtra input_kind — o briefing segue alimentando a IA",
  histDaGeracao.length > 0 && !histDaGeracao.includes("input_kind"),
  "filtrar aqui apagaria o briefing do contexto e a geracao pioraria em silencio",
);

console.log(falhas ? `\n${falhas} FALHA(S)` : "\ntudo certo");
process.exit(falhas ? 1 : 0);
