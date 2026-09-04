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

// ------------------------- O CORPO DO MODELO VEM DA META (01/set/2026)
//
// A pendencia escrita em 31/ago era: o corpo guardado em `modelos_canal` era
// RECONSTRUIDO do repositorio, nao lido da Meta, porque a leitura exige o
// WABA id e tres caminhos de descoberta pela API recusaram. Ele chegou
// sozinho no `entry[].id` do primeiro webhook depois do deploy.
//
// ⚠ E A DIFERENCA NAO ERA TEORICA: o corpo aprovado tem quebra de linha no
// MEIO das frases e a reconstrucao juntou as linhas com espaco. Mesmo
// tamanho, texto diferente — o tipo de divergencia que ninguem acha olhando.
const vigia = fonte("apps/web/lib/vigia-canal.ts");
verifica("o vigia le os modelos aprovados da Meta", vigia.includes("modelosAprovados("), true);
verifica("e so com o waba id, que chega pelo webhook", vigia.includes("whatsapp_waba_id"), true);
// ⚠ NADA DE `upsert` COM `onConflict`. A regra nasceu de um estrago: gravacao
// falhando em SILENCIO por dias, com 200 devolvido a Meta. Aqui e update e,
// so se nao mexeu em nada, insert.
verifica("a gravacao nao usa upsert com onConflict", codigo("apps/web/lib/vigia-canal.ts").includes("onConflict"), false);

// ------------------------- VALOR NAO SE RECOMBINA (01/set/2026)
//
// ⚠ DUAS MENSAGENS COM PRECO ERRADO CHEGARAM A CLIENTES REAIS. O DNA declarava
// o mesmo dinheiro em DOIS campos que se contradiziam: `valor` dizia
// "1x R$ 168,00 + 11x R$ 109,00" (com a adesao ja embutida na primeira
// parcela) e `condicao` dizia "adesao R$ 59" de novo.
//
// A IA nao inventou nada — ela COMBINOU os dois campos, e anunciou
// "R$ 59 de adesao + 11x R$ 109": uma parcela a menos, R$ 109 a menos no
// plano. A recepcao enviou sem ler.
//
// O dado foi corrigido para a forma que o fundador pediu ("adesao de R$ 59,00
// + 12x R$ 109,00", aritmeticamente identica e sem ambiguidade). Esta regra e
// a outra metade: proibir a recombinacao, porque dado ambiguo volta a
// aparecer no DNA da proxima empresa e ninguem vai lembrar deste dia.
verifica(
  "o prompt proibe somar, dividir ou recombinar valor",
  ia.includes("VALOR SE CITA COMO ESTA, NUNCA SE RECOMBINA") || ia.includes("VALOR SE CITA COMO ESTÁ, NUNCA SE RECOMBINA"),
  true,
);

// ------------------------- NAO REPETIR A MESMA OFERTA (04/set/2026)
//
// O fundador leu uma conversa e nomeou: "ele propoe duas datas como
// alternativa, o cliente responde, e quando o sistema responde de novo, ele vem
// com as duas alternativas de data, para a mesma pessoa, no mesmo contexto.
// Isso e chato e nao parece fluido, mostra claramente alguem te empurrando algo
// de maneira forcada."
//
// O caso medido e a Debora: em 21/08 ela pediu sexta 28, o sistema ofereceu
// terca ou quarta; ela nao escolheu. Em 25/08 ela voltou perguntando OUTRA
// coisa e recebeu a mesma proposta de novo, com as datas empurradas.
//
// A causa esta numa regra BOA: o prompt manda "use fechamento por
// alternativa", que e tecnica correta — aplicada a CADA mensagem, vira
// insistencia. E prima de DEPOIS_DO_SIM_PARE: la o erro e empilhar venda sobre
// um sim, aqui e repetir a pergunta para quem nao respondeu a primeira.
//
// A trava e de LIGACAO: a regra existir em `lib/prompt.ts` e nao ser
// interpolada no prompt e exatamente o defeito que este arquivo guarda —
// texto curado que nao chega em quem redige nao existe.
verifica(
  "a regra de nao repetir a oferta esta escrita",
  fonte("apps/web/lib/prompt.ts").includes("NUNCA REPITA UMA PROPOSTA"),
  true,
);
verifica(
  "e ela CHEGA no prompt de quem redige",
  codigo("apps/web/app/painel/responder/ai-actions.ts").includes("NAO_REPITA_A_OFERTA"),
  true,
);

console.log(falhas ? `\n${falhas} FALHA(S)` : "\ntudo certo");
process.exit(falhas ? 1 : 0);
