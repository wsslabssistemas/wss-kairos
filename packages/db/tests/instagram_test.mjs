/**
 * O DIRECT DO INSTAGRAM — desmontar o pacote sem confundir com o do WhatsApp.
 *
 * ⚠ POR QUE UM DESMONTADOR SEPARADO. Os dois formatos nao se parecem: aqui o
 * caminho e `entry[].messaging[]` e o texto vem em `message.text`; la e
 * `entry[].changes[].value.messages[]`. Juntar num `if` seria a segunda versao
 * da regra — com o agravante de que um erro no ramo do Instagram derrubaria o
 * canal que hoje fatura.
 *
 * ⚠ E AQUI SO SE RECEBE. No Instagram nao existe modelo aprovado nem envio
 * proativo: o webhook so dispara depois que a pessoa escreve, e ha 24h para
 * responder. Campanha de reativacao NAO roda neste canal.
 *
 *   node packages/db/tests/instagram_test.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const { desmontarInstagram } = await import(
  pathToFileURL(path.join(ROOT, "apps/web/lib/instagram-webhook.ts")).href
);

const RAIZ = ROOT;
let falhas = 0;
const eq = (nome, obtido, esperado) => {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "  ok" : "FALHA"}  ${nome}`);
  if (!ok) console.log(`        esperado: ${JSON.stringify(esperado)}\n        obtido:   ${JSON.stringify(obtido)}`);
};

const pacote = (messaging) => ({
  object: "instagram",
  entry: [{ id: "17841400000000000", time: 1756000000000, messaging }],
});

// ------------------------------------------------------------ o caso normal
const p = desmontarInstagram(pacote([{
  sender: { id: "IGSID-123" },
  recipient: { id: "17841400000000000" },
  timestamp: 1756000000000,
  message: { mid: "mid.AAA", text: "oi, quanto custa a mensalidade?" },
}]));
eq("le uma mensagem de texto", p.mensagens.length, 1);
eq("o mid vira a chave contra duplicata", p.mensagens[0]?.mid, "mid.AAA");
eq("o remetente e o id do Instagram, nao telefone", p.mensagens[0]?.de, "IGSID-123");
eq("e a conta da empresa vem de entry[].id", p.mensagens[0]?.contaDaEmpresa, "17841400000000000");
// ⚠ MILISSEGUNDOS. O Instagram manda ms e o WhatsApp manda segundos; confundir
// joga a conversa para 1970 e a ordem do historico quebra sem erro nenhum.
eq("o timestamp e lido como milissegundos", p.mensagens[0]?.quando.getUTCFullYear(), 2025);

// ------------------------------------------------------------------- o eco
// ⚠ A META REENVIA O QUE O PROPRIO APP MANDOU, marcado com `is_echo`. Gravar
// isso como fala do cliente encheria o historico do lado errado — e faria a
// janela de 24h parecer aberta por uma mensagem NOSSA.
const eco = desmontarInstagram(pacote([{
  sender: { id: "17841400000000000" },
  recipient: { id: "IGSID-123" },
  timestamp: 1756000000000,
  message: { mid: "mid.ECO", text: "ola!", is_echo: true },
}]));
eq("o eco e lido e marcado como eco", [eco.mensagens.length, eco.mensagens[0]?.eco], [1, true]);

// --------------------------------------------------------------- os anexos
// Foto, audio e figurinha de direct viram DESCRICAO — o que importa e a
// mensagem EXISTIR, para a conversa aparecer e alguem responder.
const anexo = desmontarInstagram(pacote([{
  sender: { id: "IGSID-9" }, recipient: { id: "17841400000000000" }, timestamp: 1756000000000,
  message: { mid: "mid.IMG", attachments: [{ type: "image" }] },
}]));
eq("anexo vira descricao, nao some", anexo.mensagens[0]?.texto, "(anexo recebido no direct — veja no Instagram)");

// ------------------------------------------------- o que nao e mensagem
// Confirmacao de leitura e de entrega chegam pelo mesmo caminho e NAO sao
// conversa. Contadas em `ignorados`, nunca descartadas em silencio.
const leitura = desmontarInstagram(pacote([{ sender: { id: "IGSID-9" }, recipient: { id: "x" }, read: { mid: "m" } }]));
eq("confirmacao de leitura nao vira mensagem", leitura.mensagens.length, 0);
eq("e fica contada em ignorados", leitura.ignorados.length, 1);

// ⚠ PACOTE DO WHATSAPP NAO PODE ENTRAR AQUI. Se um dia alguem apontar os dois
// webhooks para o mesmo endereco, o desmontador errado nao pode "quase
// funcionar" — ele recusa, e a recusa fica contada.
const doWhats = desmontarInstagram({ object: "whatsapp_business_account", entry: [] });
eq("pacote do WhatsApp e recusado", [doWhats.mensagens.length, doWhats.ignorados.length], [0, 1]);
eq("corpo vazio nao quebra", desmontarInstagram(null).mensagens.length, 0);

// ------------------ A PAGINA DO FACEBOOK (03/set/2026)
//
// Mesmo formato interno (`entry[].messaging[]`), `object` diferente: a pagina
// manda `page`. O desmontador e o mesmo e a plataforma e DECLARADA por quem
// chama, nunca deduzida do pacote.
//
// ⚠ POR QUE DECLARADA. Cada endereco tem o seu SEGREDO de assinatura — o
// Instagram usa a chave do "app do Instagram" e a pagina usa a do app.
// Deduzir do corpo faria um endereco aceitar o formato do outro, conferido com
// a chave errada; e o que aceitasse com a chave certa entregaria ao codigo um
// pacote que ele nao sabe tratar.
const doFacebook = {
  object: "page",
  entry: [{ id: "PAGINA-123", time: 1756000000000, messaging: [{
    sender: { id: "PSID-999" }, recipient: { id: "PAGINA-123" },
    timestamp: 1756000000000, message: { mid: "mid.FB", text: "voces abrem sabado?" },
  }] }],
};
const pFb = desmontarInstagram(doFacebook, "facebook");
eq("le a mensagem da pagina do Facebook", pFb.mensagens.length, 1);
eq("o remetente e o PSID", pFb.mensagens[0]?.de, "PSID-999");
eq("e a conta e o id da PAGINA", pFb.mensagens[0]?.contaDaEmpresa, "PAGINA-123");

// ⚠ E CADA ENDERECO SO ACEITA O SEU. Pacote do Facebook chegando no
// desmontador do Instagram e recusado, e vice-versa: se um dia os dois
// apontarem para o mesmo lugar, o errado nao pode "quase funcionar".
eq("pacote do Facebook e recusado pelo desmontador do Instagram",
  desmontarInstagram(doFacebook, "instagram").mensagens.length, 0);
eq("e o do Instagram e recusado pelo do Facebook",
  desmontarInstagram(pacote([{ sender: { id: "a" }, recipient: { id: "b" }, message: { mid: "m", text: "oi" } }]), "facebook").mensagens.length, 0);

// ⚠ E A GRAVACAO USA COLUNAS DIFERENTES POR PLATAFORMA. O mesmo ser humano tem
// um id no Instagram e OUTRO no Facebook; procurar os dois na mesma coluna
// faria o historico de uma pessoa aparecer na conversa de outra — pior que nao
// achar ninguem.
const rotaFonte = fs.readFileSync(
  path.join(RAIZ, "apps/web/app/api/[[...route]]/route.ts"), "utf8",
).split(String.fromCharCode(13)).join("");
eq("a coluna do contato muda com a plataforma",
  rotaFonte.includes('const coluna = plataforma === "instagram" ? "instagram_id" : "facebook_id"'), true);
eq("e a conta da empresa tambem",
  rotaFonte.includes('"instagram_account_id" : "facebook_page_id"'), true);

console.log(falhas ? `\n${falhas} FALHA(S)` : "\ntudo certo");
process.exit(falhas ? 1 : 0);
