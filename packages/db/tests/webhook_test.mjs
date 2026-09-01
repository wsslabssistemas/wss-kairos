// O WEBHOOK DO WHATSAPP — assinatura, desmontagem e a janela de 24h.
//
// POR QUE ESTE TESTE EXISTE ANTES DE HAVER CREDENCIAL
// O webhook é o único endereço do produto que qualquer um na internet pode
// chamar, e ele ESCREVE no histórico de um cliente pagante. Testar isso "em
// produção quando a conta sair" significa testar com dado real de quem paga.
//
// As três coisas medidas aqui não precisam de rede nem de banco: se a
// assinatura confere, o que o pacote significa, e se a janela está aberta.
// O resto da rota é só "isto é válido? então grave".

import { createHmac } from "node:crypto";
import {
  assinaturaConfere,
  respostaDoDesafio,
  desmontarPacote,
  janelaDeAtendimento,
  phoneNumberIdDoPacote,
} from "../../../apps/web/lib/whatsapp-webhook.ts";
import { variantesArmazenadas } from "../../../apps/web/lib/phone.ts";
import { origemDaPrimeiraMensagem } from "../../../apps/web/lib/origem-site.ts";

let passou = 0;
const falhas = [];

const eq = (nome, obtido, esperado) => {
  const a = JSON.stringify(obtido), b = JSON.stringify(esperado);
  if (a === b) passou++;
  else falhas.push(`${nome}\n    esperado: ${b}\n    obtido:   ${a}`);
};
const verdade = (nome, cond) => {
  if (cond) passou++;
  else falhas.push(nome);
};

const SEGREDO = "segredo-de-teste";
const assinar = (corpo) => "sha256=" + createHmac("sha256", SEGREDO).update(corpo, "utf8").digest("hex");

// ---------------------------------------------------------------------
// 1. ASSINATURA — a porta da rua
// ---------------------------------------------------------------------
const corpo = JSON.stringify({ object: "whatsapp_business_account", entry: [] });

verdade("assinatura correta passa", assinaturaConfere(corpo, assinar(corpo), SEGREDO).ok);
verdade("assinatura de OUTRO corpo é recusada",
  !assinaturaConfere(corpo, assinar(corpo + " "), SEGREDO).ok);
verdade("assinatura com segredo errado é recusada",
  !assinaturaConfere(corpo, "sha256=" + createHmac("sha256", "outro").update(corpo).digest("hex"), SEGREDO).ok);
verdade("sem cabeçalho é recusado", !assinaturaConfere(corpo, null, SEGREDO).ok);
verdade("cabeçalho sem o prefixo sha256= é recusado", !assinaturaConfere(corpo, "abc123", SEGREDO).ok);
verdade("hash de tamanho diferente não explode, só recusa",
  !assinaturaConfere(corpo, "sha256=abc", SEGREDO).ok);

// SEM SEGREDO CONFIGURADO TEM QUE RECUSAR, não liberar. É a falha que se
// parece com "ainda não configurei" e deixa o endereço aberto para qualquer
// um escrever no histórico do cliente.
verdade("sem WHATSAPP_APP_SECRET recusa (não libera)", !assinaturaConfere(corpo, assinar(corpo), null).ok);
verdade("segredo vazio também recusa", !assinaturaConfere(corpo, assinar(corpo), "").ok);

// ---------------------------------------------------------------------
// 2. O DESAFIO DE VERIFICAÇÃO
// ---------------------------------------------------------------------
const q = (o) => new URLSearchParams(o);
eq("desafio com token certo devolve o challenge",
  respostaDoDesafio(q({ "hub.mode": "subscribe", "hub.verify_token": "T", "hub.challenge": "1234" }), "T"),
  { ok: true, desafio: "1234" });
verdade("token errado é recusado",
  !respostaDoDesafio(q({ "hub.mode": "subscribe", "hub.verify_token": "X", "hub.challenge": "1" }), "T").ok);
verdade("modo diferente de subscribe é recusado",
  !respostaDoDesafio(q({ "hub.mode": "unsubscribe", "hub.verify_token": "T", "hub.challenge": "1" }), "T").ok);
verdade("sem token configurado recusa",
  !respostaDoDesafio(q({ "hub.mode": "subscribe", "hub.verify_token": "T", "hub.challenge": "1" }), null).ok);

// ---------------------------------------------------------------------
// 3. DESMONTAR O PACOTE
// ---------------------------------------------------------------------
// Instante fixo, calculado em vez de escrito à mão: a primeira versão deste
// teste usou um epoch decorado que era de 2025 e a asserção "vira 2026"
// falhou — o defeito estava no fixture, não no código. Número mágico em teste
// mente com a mesma cara de bug.
const QUANDO = new Date(Date.UTC(2026, 7, 8, 12, 0, 0));
const EPOCH_SEG = String(Math.floor(QUANDO.getTime() / 1000));

const pacoteReal = {
  object: "whatsapp_business_account",
  entry: [{
    // ⚠ ISTO É O WABA ID. Ver a asserção lá embaixo.
    id: "102290129340398",
    changes: [{
      field: "messages",
      value: {
        messaging_product: "whatsapp",
        metadata: { display_phone_number: "5551999999999", phone_number_id: "PHONE_ID_1" },
        contacts: [{ profile: { name: "Maria" }, wa_id: "5551982512270" }],
        messages: [{
          id: "wamid.AAA", from: "5551982512270", timestamp: EPOCH_SEG,
          type: "text", text: { body: "oi, quanto custa a mensalidade?" },
        }],
      },
    }],
  }],
};

const p = desmontarPacote(pacoteReal);
eq("uma mensagem de texto é lida", p.mensagens.length, 1);
eq("wamid", p.mensagens[0]?.wamid, "wamid.AAA");
eq("remetente", p.mensagens[0]?.de, "5551982512270");
eq("nome do perfil é casado pelo wa_id", p.mensagens[0]?.nome, "Maria");

// ⚠ DE ONDE VEIO: O SITE (31/ago/2026).
//
// O site novo entrou no ar com os botoes apontando para o numero da automacao.
// Sem marca na primeira mensagem, todo lead vindo dele nasce como "whatsapp" —
// indistinguivel de quem viu no Instagram, pegou por indicacao ou digitou. E
// origem e a unica dimensao que o fundador imps como obrigatoria na medicao.
//
// ⚠ E QUEM APAGAR O TEXTO ENTRA COMO "whatsapp", de proposito: nao da para
// provar de onde veio. Origem que se perde e melhor que origem inventada.
eq("a frase do site vira origem", origemDaPrimeiraMensagem("Oi! Vim pelo site e quero saber mais"), "site");
eq("instagram tem marca propria", origemDaPrimeiraMensagem("Oi! Vim pelo Instagram e quero saber os planos"), "instagram");
eq("o apelido tambem conta", origemDaPrimeiraMensagem("oi, vim pelo insta"), "instagram");
eq("facebook tem marca propria", origemDaPrimeiraMensagem("Oi! Vim pelo Facebook"), "facebook");
// ⚠ A ORDEM SO DESEMPATA COM AS DUAS FRASES INTEIRAS na mesma mensagem, que e
// raro — e a rede ganha, porque ela e a origem e o site e o caminho. Eu tinha
// escrito este caso como "vim pelo site do instagram" e estava errado: essa
// frase NAO contem "vim pelo instagram", so "vim pelo site". A trava pegou.
eq("com as duas marcas inteiras, a rede ganha", origemDaPrimeiraMensagem("vim pelo instagram e vim pelo site"), "instagram");
// E o que nao tem marca nenhuma continua sem origem inventada.
eq("mencionar a rede de passagem nao vira origem", origemDaPrimeiraMensagem("vi voces no instagram, quanto custa?"), null);
eq("sem acento e em caixa alta tambem", origemDaPrimeiraMensagem("OI, VIM PELO SÍTE"), "site");
eq("mensagem comum nao inventa origem", origemDaPrimeiraMensagem("quanto custa a mensalidade?"), null);
eq("vazio nao inventa origem", origemDaPrimeiraMensagem(""), null);
eq("nulo nao quebra", origemDaPrimeiraMensagem(null), null);

// ⚠ O WABA ID CHEGA EM TODO PACOTE E ERA JOGADO FORA (31/ago/2026).
//
// `entry[].id` é o ID da conta do WhatsApp Business. Ele NÃO é nenhuma das
// quatro caixas que a pessoa cola na instalação, e sem ele não dá para ler os
// modelos aprovados pela API — então o corpo deles fica reconstruído do
// repositório, e um texto reaprovado na Meta faria o histórico registrar uma
// conversa diferente da que aconteceu.
//
// Três caminhos de descoberta pela API recusam com o token que temos. Este
// estava no corpo de toda mensagem, o tempo inteiro.
eq("o WABA id vem de entry[].id", p.wabaId, "102290129340398");
verdade(
  "pacote sem id na entrada devolve null, nao string vazia",
  desmontarPacote({ object: "whatsapp_business_account", entry: [{ changes: [] }] }).wabaId === null,
);
eq("texto", p.mensagens[0]?.texto, "oi, quanto custa a mensalidade?");
eq("phone_number_id — é ele que diz de qual empresa é", p.mensagens[0]?.phoneNumberId, "PHONE_ID_1");

// O epoch da Meta vem em SEGUNDOS. Ler como milissegundos joga a data para
// 1970 — e uma interação em 1970 não quebra tela nenhuma: ela só some do
// "últimos 30 dias" e o atendimento parece nunca ter acontecido.
eq("epoch em SEGUNDOS vira o instante certo, não 1970",
  p.mensagens[0]?.quando.toISOString(), QUANDO.toISOString());

// ⚠ ÁUDIO E IMAGEM VIRAM INTERAÇÃO — e esta regra MUDOU em 18/ago/2026.
//
// Este teste guardava o comportamento antigo ("áudio não vira interação") e
// falhou quando a regra mudou, que é exatamente o que ele existe para fazer.
// O que ele guarda agora é o motivo da mudança, que é maior do que "o vendedor
// não via a foto":
//
// **Qualquer mensagem do cliente abre a janela de 24 horas.** Descartar o
// áudio fazia o sistema achar que a janela continuava fechada — o cliente
// respondia por áudio, a janela abria de verdade na Meta, e o produto se
// recusava a responder alegando que precisava de modelo aprovado. Quem
// responde por áudio não podia ser atendido, e responder por áudio é o caso
// mais comum que existe no WhatsApp brasileiro.
//
// A mídia NÃO é baixada: baixar custa, exige armazenamento e guarda dado
// pessoal sem necessidade. Fica o registro de que algo chegou, com o tipo.
const comAudio = structuredClone(pacoteReal);
comAudio.entry[0].changes[0].value.messages = [
  { id: "wamid.B", from: "5551982512270", timestamp: EPOCH_SEG, type: "audio", audio: { id: "x" } },
];
const pa = desmontarPacote(comAudio);
eq("áudio VIRA interação, senão a janela de 24h não abre", pa.mensagens.length, 1);
eq("com uma descrição legível no lugar do conteúdo",
  pa.mensagens[0]?.texto, "(áudio recebido — ouça no WhatsApp)");
eq("e o tipo preservado, para a operação saber o que chegou", pa.mensagens[0]?.tipo, "audio");
// Continua contado: se metade das respostas for áudio, isso muda o que o
// produto precisa fazer, e esse número não pode sumir.
eq("e continua contado como mídia", pa.ignorados, ['mensagem do tipo "audio"']);

// Texto continua sendo texto, e agora com o tipo marcado. (O corpo já é
// conferido lá em cima — não repetir a mesma asserção duas vezes.)
eq("texto tem tipo text", p.mensagens[0]?.tipo, "text");

// Status de entrega
const comStatus = {
  object: "whatsapp_business_account",
  entry: [{ id: "0", changes: [{ field: "messages", value: {
    metadata: { phone_number_id: "PHONE_ID_1" },
    statuses: [{ id: "wamid.AAA", status: "delivered", timestamp: EPOCH_SEG, recipient_id: "5551982512270" }],
  } }] }],
};
const ps = desmontarPacote(comStatus);
eq("status de entrega é lido", ps.status.length, 1);
eq("status", ps.status[0]?.status, "delivered");

// NUNCA LANÇAR. Webhook que devolve erro faz a Meta reenviar, e reenviar o que
// sempre quebra vira laço — com a assinatura desativada no fim.
eq("pacote vazio não explode", desmontarPacote({}).mensagens.length, 0);
eq("null não explode", desmontarPacote(null).mensagens.length, 0);
eq("pacote de outro produto é ignorado, não aceito",
  desmontarPacote({ object: "page", entry: [] }).ignorados.length, 1);
eq("entry sem changes não explode",
  desmontarPacote({ object: "whatsapp_business_account", entry: [{ id: "0" }] }).mensagens.length, 0);

// ---------------------------------------------------------------------
// 4. A JANELA DE 24 HORAS
//
// A regra que decide o que pode ser dito e quanto custa — e a que separa o
// produto em dois: o Responder quase sempre cabe nela; a FILA vive fora dela
// por definição, porque existe para falar com quem parou de falar.
// ---------------------------------------------------------------------
const agora = new Date("2026-08-08T12:00:00Z");
const hAtras = (h) => new Date(agora.getTime() - h * 3600_000);

verdade("escreveu há 1h: janela aberta", janelaDeAtendimento(hAtras(1), agora).aberta);
verdade("escreveu há 23h: ainda aberta", janelaDeAtendimento(hAtras(23), agora).aberta);
verdade("escreveu há 25h: fechada", !janelaDeAtendimento(hAtras(25), agora).aberta);
verdade("exatamente 24h: fechada (o limite não é inclusivo)",
  !janelaDeAtendimento(hAtras(24), agora).aberta);
verdade("nunca escreveu: fechada e com aviso",
  !janelaDeAtendimento(null, agora).aberta && !!janelaDeAtendimento(null, agora).aviso);
verdade("data inválida não explode", !janelaDeAtendimento("banana", agora).aberta);

eq("minutos restantes com 23h de janela", janelaDeAtendimento(hAtras(23), agora).minutosRestantes, 60);
verdade("aviso aparece quando falta pouco (1h)", !!janelaDeAtendimento(hAtras(23), agora).aviso);
verdade("sem aviso quando ainda há muito tempo (falta 22h)",
  janelaDeAtendimento(hAtras(2), agora).aviso === null);

// ---------------------------------------------------------------------
// 5. O CAMINHO DE VOLTA — casar o número da Meta com o cadastro
//
// A Meta manda E.164 completo; a base guarda quatro formatos diferentes.
// Procurar só pelo E.164 acharia 56% dos contatos e DUPLICARIA os outros 44% —
// e duplicata parte o histórico em dois, fazendo quem já é aluno aparecer na
// fila como se nunca tivesse conversado.
// ---------------------------------------------------------------------
const v = variantesArmazenadas("5551982512270").sort();
eq("as quatro formas do mesmo telefone", v,
  ["5182512270", "51982512270", "5551982512270", "555182512270"].sort());
verdade("a forma que a Meta manda está entre elas", v.includes("5551982512270"));
verdade("a forma sem código de país está entre elas", v.includes("51982512270"));
verdade("a forma antiga sem o nono dígito está entre elas", v.includes("5182512270"));

// Fixo não ganha variante de nono dígito — não existe "fixo antigo".
eq("fixo tem só duas formas", variantesArmazenadas("555133334444").sort(),
  ["5133334444", "555133334444"].sort());

// ---------------------------------------------------------------------
// ================= DE QUEM E O PACOTE, ANTES DE CONFERIR A ASSINATURA =====
//
// O app secret e POR EMPRESA (cada cliente tem o proprio app na Meta), entao
// descobrir qual segredo usar exige ler o `phone_number_id` de dentro do corpo
// — ou seja, ANTES de a assinatura ser conferida.
//
// Isso e seguro por um motivo especifico: ler para ESCOLHER A CHAVE e diferente
// de confiar no conteudo. Quem mentir esse campo so escolhe contra qual segredo
// vai ser conferido, e a assinatura dele nao bate com nenhum.
//
// O que estes casos guardam e o LADO PARA O QUAL SE ERRA: qualquer formato
// inesperado devolve `null`, e `null` leva a recusa.
const pacoteCom = (id) => JSON.stringify({
  entry: [{ changes: [{ value: { metadata: { phone_number_id: id } } }] }],
});

eq("acha o id do numero no pacote", phoneNumberIdDoPacote(pacoteCom("1072873705913820")), "1072873705913820");
eq("JSON invalido devolve null, e null recusa", phoneNumberIdDoPacote("{isso nao e json"), null);
eq("pacote sem metadata devolve null", phoneNumberIdDoPacote(JSON.stringify({ entry: [] })), null);
eq("id vazio conta como ausente", phoneNumberIdDoPacote(pacoteCom("   ")), null);
eq("id que nao e texto nao vira texto", phoneNumberIdDoPacote(pacoteCom(12345)), null);

// ⚠ O TOTAL É CALCULADO AQUI, no fim. Ele morava no meio do arquivo e por isso
// contava só as asserções escritas ACIMA dele: a saída dizia "46/41", com mais
// aprovados do que existem. Número que soma errado num teste é o pior lugar
// possível para um número errado — é o instrumento de medida.
const total = passou + falhas.length;

if (falhas.length) {
  console.error(`\n✗ FALHOU — ${passou}/${total}\n`);
  for (const f of falhas) console.error(`  ✗ ${f}\n`);
  process.exit(1);
}
console.log(`\n✓ PASSOU — ${passou}/${total}`);
