/**
 * A VALIDADE DO TOKEN — perguntada à Meta, nunca anotada por alguém.
 *
 * ⚠ O PEDIDO DO FUNDADOR, em 02/set, ao ouvir que o token do Instagram vence
 * em 60 dias: *"todo o trabalho manual é ruim, ainda mais os que dependem da
 * memória de um humano, então vamos ter que colocar alertas de lembrete de
 * token expirando"*.
 *
 * A saída é melhor que lembrete: o `debug_token` DEVOLVE a data de expiração.
 * O vigia pergunta a cada leitura, e a tela mostra quantos dias faltam.
 *
 * ⚠ E TOKEN VENCIDO NÃO DÁ ERRO VISÍVEL. A Meta recusa a chamada, o motor
 * registra falha, e do lado de fora aparece como "o sistema parou de
 * responder" — o padrão que esta casa paga desde agosto.
 *
 *   node packages/db/tests/token_check.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const { diasAteVencer, DIAS_DE_ALERTA } = await import(
  pathToFileURL(path.join(ROOT, "apps/web/lib/token-validade.ts")).href
);
const CR = String.fromCharCode(13);
const fonte = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8").split(CR).join("");

let falhas = 0;
function verifica(nome, obtido, esperado) {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "  ok" : "FALHA"}  ${nome}`);
  if (!ok) console.log(`        esperado: ${JSON.stringify(esperado)}\n        obtido:   ${JSON.stringify(obtido)}`);
}

const AGORA = new Date("2026-09-02T12:00:00Z");
const emDias = (n) => new Date(AGORA.getTime() + n * 86400000);

verifica("conta os dias que faltam", diasAteVencer(emDias(30), AGORA), 30);
verifica("a borda do alerta e 15 dias", DIAS_DE_ALERTA, 15);
verifica("vencido devolve numero negativo, nao zero", diasAteVencer(emDias(-2), AGORA), -2);
verifica("vence hoje da zero", diasAteVencer(new Date(AGORA.getTime() + 3600000), AGORA), 0);

// ⚠ `expires_at: 0` SIGNIFICA "NUNCA VENCE", nao "venceu em 1970". E o valor
// dos tokens permanentes de usuario do sistema. Ler isso como data faria a
// tela gritar todo dia sobre um token que esta perfeito — e alarme para o que
// esta certo e como se aprende a ignorar alarme.
verifica("token sem validade nao vira alarme", diasAteVencer(null, AGORA), null);

const perfil = fonte("apps/web/lib/perfil-canal.ts");
verifica("o zero da Meta e tratado como 'nunca vence'", perfil.includes("seg > 0 ? new Date(seg * 1000) : null"), true);

// ⚠ A PERGUNTA MORA NO VIGIA, que ja roda a cada batida do agendador. Colocar
// num lugar novo criaria mais uma peca agendada para vigiar.
const vigia = fonte("apps/web/lib/vigia-canal.ts");
verifica("o vigia pergunta a validade junto da saude", vigia.includes("validadeDoToken"), true);
verifica("e guarda as duas colunas", vigia.includes("token_expira_em") && vigia.includes("token_valido"), true);

// ⚠ E A TELA SO FALA QUANDO IMPORTA. Token com muitos dias vira uma linha
// discreta; perto de vencer, alarme; invalido, vermelho.
const tela = fonte("apps/web/app/painel/automacao/page.tsx");
verifica("a tela avisa quando falta pouco", tela.includes("diasDoToken <= DIAS_DE_ALERTA"), true);
verifica("e grita quando o token ja nao vale", tela.includes("token_valido === false"), true);

// ⚠ E O TOKEN DO INSTAGRAM SE COLA PELA TELA, nao pelo banco. Trabalho manual
// que exige abrir o Supabase nao escala para a segunda empresa.
const canal = fonte("apps/web/app/painel/automacao/Canal.tsx");
verifica("o token do Instagram tem campo proprio", canal.includes('name="instagram_token"'), true);
verifica("e o id da conta tambem", canal.includes('name="instagram_account_id"'), true);

console.log(falhas ? `\n${falhas} FALHA(S)` : "\ntudo certo");
process.exit(falhas ? 1 : 0);
