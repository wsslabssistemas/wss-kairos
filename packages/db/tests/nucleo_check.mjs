/**
 * A LEI 1 VIRANDO TRAVA — o núcleo não pode conhecer segmento.
 *
 * ⚠ POR QUE ESTE ARQUIVO NASCEU EM 5/set/2026.
 *
 * O fundador perguntou o que era dele e o que era de todo mundo: *"essa mudança
 * de regras, como a de não entrar mais em contato quando o cliente manifesta
 * esse desejo, fica apenas nessa empresa ou passa a ser regra para outros
 * ramos?"*.
 *
 * Fui conferir para responder — e achei um erro **meu**, do dia anterior. O
 * veto de convênio, que é regra de núcleo, tinha esta linha dentro:
 *
 *     c.convenio === "gympass" ? "Gympass" : c.convenio === "totalpass" ? ...
 *
 * Duas marcas de um ramo, no arquivo que decide para todos os ramos. Não
 * quebrava nada, passava no typecheck, passava numa leitura distraída — e no
 * dia em que uma clínica declarasse `convenio: "unimed"` a mensagem sairia em
 * minúsculo, sem ninguém entender por quê.
 *
 * ⚠ E O CLAUDE.md JÁ DIZIA COMO ISSO DEVERIA SER PEGO: *"violação das três leis
 * deve FALHAR O BUILD, não gerar comentário em revisão"*. A Lei 2 (Skill é
 * dado) tem o validador de manifesto; a Lei 3 (tenant_id sempre) tem a RLS. A
 * Lei 1 era a única sem trava — protegida por atenção, que é o que falha.
 *
 * ⚠ O QUE ESTA TRAVA É E O QUE ELA NÃO É. Ela não prova que o núcleo é
 * genérico: nenhuma lista de palavras prova isso. Ela pega a classe barata e
 * frequente — **nome de coisa de um ramo escrito à mão num arquivo de
 * decisão** —, que é justamente a que passa despercebida por ser inofensiva.
 *
 * ⚠ E ELA OLHA SÓ CÓDIGO, NUNCA COMENTÁRIO. Os comentários desta casa CITAM o
 * caso real que originou cada regra ("a Marcela respondeu que já faz com o
 * gympass"), e essa é a parte mais valiosa deles. Uma trava que acusasse a
 * explicação faria alguém apagar a explicação — o oposto exato do que ela
 * deveria proteger.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

/**
 * Os arquivos que DECIDEM para todo mundo.
 *
 * Não é o `lib/` inteiro de propósito: tela sabe de segmento (ela mostra o
 * rótulo que o manifesto declara), e importador conhece o formato do arquivo do
 * cliente. O que não pode conhecer ramo é quem decide **se uma mensagem sai**,
 * **para quem** e **o que ela diz**.
 */
const NUCLEO = [
  "apps/web/lib/motor.ts",
  "apps/web/lib/fase2.ts",
  "apps/web/lib/fila.ts",
  "apps/web/lib/cadence.ts",
  "apps/web/lib/roteamento.ts",
  "apps/web/lib/adiamento.ts",
  "apps/web/lib/fecho.ts",
  "apps/web/lib/optout.ts",
  "apps/web/lib/espacamento.ts",
  "apps/web/lib/alertas.ts",
];

/**
 * Palavras que só existem dentro de um ramo.
 *
 * ⚠ LISTA CURTA E CONCRETA, nunca uma tentativa de cobrir o português. Cada
 * uma entrou por ter aparecido de verdade num manifesto ou num dado de cliente
 * — e a lista cresce quando um segmento novo trouxer a sua.
 */
const DE_SEGMENTO = [
  // academia
  "gympass", "totalpass", "wellhub", "musculacao", "musculação",
  "matricula", "matrícula", "rematricula", "aluno", "alunos", "treino",
  // barbearia / salão
  "barbearia", "barbeiro", "corte de cabelo",
  // clínica
  "consulta", "paciente", "unimed",
  // energia solar
  "fatura de luz", "placa solar", "kwh",
];

/** O arquivo sem comentários — ver a nota do cabeçalho. */
function codigo(rel) {
  const bruto = fs.readFileSync(path.join(ROOT, rel), "utf8");
  // ⚠ NORMALIZA CRLF: os arquivos desta máquina estão em CRLF e o CI roda em
  // LF. Trava que mede coisa diferente nos dois é trava que se desliga.
  const linhas = bruto.split(String.fromCharCode(13)).join("").split("\n");
  const fora = [];
  let emBloco = false;
  for (const l of linhas) {
    const t = l.trim();
    if (emBloco) {
      if (t.includes("*/")) emBloco = false;
      continue;
    }
    if (t.startsWith("/*")) {
      if (!t.includes("*/")) emBloco = true;
      continue;
    }
    if (t.startsWith("//") || t.startsWith("*")) continue;
    fora.push(l);
  }
  return fora.join("\n");
}

let falhas = 0;
for (const rel of NUCLEO) {
  if (!fs.existsSync(path.join(ROOT, rel))) {
    console.log(`FALHA  ${rel} não existe — a lista do núcleo ficou desatualizada`);
    falhas++;
    continue;
  }
  const fonte = codigo(rel).toLowerCase();
  const achadas = DE_SEGMENTO.filter((p) => fonte.includes(p));
  if (achadas.length) {
    falhas++;
    console.log(`FALHA  ${rel} — vocabulário de segmento no código: ${achadas.join(", ")}`);
    console.log("       O núcleo decide para todo ramo. O nome da coisa vem do MANIFESTO");
    console.log("       ou do DADO do contato, nunca escrito aqui.");
  } else {
    console.log(`  ok   ${rel}`);
  }
}

console.log(
  falhas === 0
    ? "\n✓ PASSOU — o núcleo não conhece segmento (Lei 1)"
    : `\n✗ FALHOU — ${falhas} arquivo(s) do núcleo com vocabulário de ramo`,
);
process.exit(falhas === 0 ? 0 : 1);
