/**
 * O QUE CHEGA EM QUEM REDIGE — as quatro ligações que faltavam.
 *
 * ⚠ POR QUE ESTE ARQUIVO EXISTE. Em 31/ago/2026 o fundador leu uma conversa
 * real de reativação e disse que a resposta da IA era óbvia, sem técnica. Ele
 * estava certo, e a causa não era o modelo nem o prompt: era que **nada da
 * técnica curada chegava até ele**. Quatro defeitos somados, todos silenciosos:
 *
 *   1. A busca da biblioteca usava só a ÚLTIMA MENSAGEM. "Emagrecer", uma
 *      palavra, casava com ZERO entradas.
 *   2. O envio de modelo aprovado gravava no histórico só o NOME —
 *      `(modelo "reativacao_ex_aluno")` — então a IA respondia a um "Oi sim"
 *      sem saber qual era a pergunta. *"Uma resposta jogada ao ar."*
 *   3. Os gatilhos eram todos PERGUNTAS DO CLIENTE, e em campanha proativa o
 *      cliente RESPONDE. Quatro entradas não tinham gatilho nenhum — entre
 *      elas a que governa a reativação inteira.
 *   4. A lista curada de MOTIVOS DE SAÍDA, com `o_que_fazer` para cada um,
 *      era carregada só para preencher um `<select>` de encerramento.
 *
 * ⚠ E O FALLBACK MENTIA. Sem casamento, o código mandava
 * `allEntries.slice(0, 6)` — as seis primeiras na ordem do banco — sob o
 * rótulo de "entradas relevantes". Numa conversa sem objeção nenhuma, cinco
 * eram de contorno de objeção. **Técnica errada com confiança é pior que
 * técnica nenhuma**, e é a mesma família da regra dos 1.000: sem `ORDER BY`,
 * o que volta é arbitrário.
 *
 * Nada disso dava erro. As três primeiras foram achadas medindo; a quarta,
 * lendo. Por isso a trava é de CÓDIGO-FONTE: são LIGAÇÕES, e ligação que some
 * não quebra nada — só empobrece a mensagem que sai no nome do cliente.
 *
 *   node packages/db/tests/resposta_check.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const { renderizarModelo } = await import(
  pathToFileURL(path.join(ROOT, "apps/web/lib/modelo.ts")).href
);

// ⚠ NORMALIZA CRLF ANTES DE CASAR PADRÃO — regra do CLAUDE.md: os arquivos
// desta máquina estão em CRLF e o CI roda em LF.
const CR = String.fromCharCode(13);
const fonte = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8").split(CR).join("");

/**
 * O arquivo SEM comentário.
 *
 * ⚠ As verificações de "isto NÃO pode existir" precisam disto, e a razão é
 * concreta: os comentários deste projeto CITAM o defeito que descrevem
 * ("caía em allEntries.slice(0, 6)"). Sem tirar comentário, a trava acusaria
 * a própria explicação dela — e a saída fácil seria apagar a explicação, que
 * é justamente o que não pode acontecer aqui.
 */
const codigo = (rel) =>
  fonte(rel)
    .split("\n")
    .filter((l) => {
      const t = l.trim();
      return !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*");
    })
    .join("\n");

let falhas = 0;
function verifica(nome, obtido, esperado) {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "  ok" : "FALHA"}  ${nome}`);
  if (!ok) console.log(`        esperado: ${JSON.stringify(esperado)}\n        obtido:   ${JSON.stringify(obtido)}`);
}

// ------------------------------------------------- 2. o texto do que foi dito
const corpo = "Oi, {{1}}! Aqui é da {{2}} — tudo bem?";
verifica(
  "o modelo vira a fala, com as variaveis trocadas",
  renderizarModelo(corpo, ["Daiane", "Be Fitness"]),
  "Oi, Daiane! Aqui é da Be Fitness — tudo bem?",
);
// ⚠ VARIÁVEL SEM VALOR FICA VISÍVEL, de propósito. Trocar por vazio produz
// uma frase que PARECE certa e perdeu um fato — o defeito que não se acha.
verifica(
  "variavel sem valor fica visivel, nao vira vazio",
  renderizarModelo("Vence em {{3}}.", ["Ana", "Be Fitness"]),
  "Vence em {{3}}.",
);
verifica("corpo sem variavel passa inteiro", renderizarModelo("Oi!", []), "Oi!");

const despacho = fonte("apps/web/lib/despacho.ts");
verifica(
  "o envio guarda o corpo renderizado, nao so o rotulo",
  despacho.includes("corpoRenderizado ?? `(modelo"),
  true,
);
verifica(
  "e o corpo vem de `modelos_canal`, nao de constante no codigo",
  despacho.includes('from("modelos_canal")'),
  true,
);

// -------------------------------------------- 1 e 4. o que chega no redator
const ia = fonte("apps/web/app/painel/responder/ai-actions.ts");

// ⚠ A CONSULTA É A SITUAÇÃO. `matchEntries(message, ...)` é o defeito de
// 31/ago: resposta de WhatsApp tem uma palavra e não tem sinal nenhum.
verifica(
  "a busca da biblioteca usa a SITUACAO, nao so a ultima mensagem",
  ia.includes("matchEntries(consulta"),
  true,
);
verifica(
  "e o nome velho nao voltou",
  codigo("apps/web/app/painel/responder/ai-actions.ts").includes("matchEntries(message"),
  false,
);

// ⚠ O FALLBACK NÃO PODE INVENTAR RELEVÂNCIA.
verifica(
  "sem casamento NAO caem entradas arbitrarias no prompt",
  codigo("apps/web/app/painel/responder/ai-actions.ts").includes("allEntries.slice("),
  false,
);
verifica(
  "e o prompt DIZ que nenhuma entrada casou",
  ia.includes("NENHUMA entrada da biblioteca casou"),
  true,
);

// ⚠ OS MOTIVOS DE SAÍDA CHEGAM EM QUEM REDIGE, não só no `<select>`.
verifica(
  "os motivos de saida do ramo sao carregados para o prompt",
  ia.includes("churnReasons"),
  true,
);
verifica("e entram no texto enviado ao modelo", ia.includes("${motivosDeSaida"), true);
// ⚠ SÓ NA ETAPA DE QUEM SAIU, e a chave vem do MANIFESTO (Lei 1): numa
// conversa de primeiro contato esta lista faria o modelo perguntar por que a
// pessoa parou — de quem nunca começou.
verifica(
  "so na etapa de quem saiu, com a chave vinda do manifesto",
  ia.includes("contract?.ended_stage && etapaAtualDoContato === contract.ended_stage"),
  true,
);

console.log(falhas ? `\n${falhas} FALHA(S)` : "\ntudo certo");
process.exit(falhas ? 1 : 0);
