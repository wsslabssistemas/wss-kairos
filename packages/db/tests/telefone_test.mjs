// E.164 BRASILEIRO — o teste do P1 da auditoria.
//
// POR QUE ESTE TESTE É O MAIS IMPORTANTE DA PASTA
// Todo o resto que erra devolve resposta ruim. Este erra devolvendo mensagem
// PARA OUTRA PESSOA. É o único ponto do sistema em que um defeito sai da
// empresa e chega em quem não pediu nada — e o telefone de um cliente
// corrompido não se recupera olhando o banco depois.
//
// A auditoria adiou o E.164 com o motivo escrito: "normalizar no chute
// corrompe número de cliente". O que destrava agora não é pressa, é escopo:
// um país só, com as regras da Anatel, que são fechadas. Este arquivo é a
// prova de que as regras foram aplicadas e não chutadas.
//
// Roda sem banco.

import { paraE164BR, whatsappNumber, normalizePhone, variantesArmazenadas } from "../../../apps/web/lib/phone.ts";

let passou = 0;
const falhas = [];

function ok(nome, entrada, esperadoDigitos, esperadoAjuste = undefined) {
  const r = paraE164BR(entrada);
  if (!r.ok) {
    falhas.push(`${nome}\n    esperado: ${esperadoDigitos}\n    obtido:   RECUSOU (${r.motivo})`);
    return;
  }
  if (r.digitos !== esperadoDigitos) {
    falhas.push(`${nome}\n    esperado: ${esperadoDigitos}\n    obtido:   ${r.digitos}`);
    return;
  }
  const temAjuste = r.ajuste !== undefined;
  if (temAjuste !== (esperadoAjuste === true)) {
    falhas.push(`${nome}\n    ajuste esperado: ${esperadoAjuste === true}\n    ajuste obtido:   ${temAjuste}`);
    return;
  }
  passou++;
}

function recusa(nome, entrada) {
  const r = paraE164BR(entrada);
  if (r.ok) falhas.push(`${nome}\n    esperado: RECUSA\n    obtido:   ${r.digitos}`);
  else passou++;
}

// ---------------------------------------------------------------------
// 1. O caso normal — celular de Porto Alegre, como a recepção digita
// ---------------------------------------------------------------------
ok("celular com máscara", "(51) 98251-2270", "5551982512270");
ok("celular com espaços", "51 98251 2270", "5551982512270");
ok("celular só dígitos", "51982512270", "5551982512270");
ok("já com código de país", "5551982512270", "5551982512270");
ok("com + na frente", "+55 51 98251-2270", "5551982512270");
ok("com 00 internacional", "005551982512270", "5551982512270");
ok("fixo de 8 dígitos", "5133334444", "555133334444");
ok("fixo com código de país", "555133334444", "555133334444");

// ---------------------------------------------------------------------
// 2. O BUG QUE ISTO EXISTE PARA MATAR — DDD 55, Santa Maria/RS
//
// A regra antiga (`d.startsWith("55") ? d : "55"+d`) devolvia o número de 11
// dígitos intacto, e o WhatsApp lia +55 98 7654-321. Mensagem para estranho,
// em silêncio, no mesmo estado da primeira empresa real do produto.
//
// O comprimento desambigua sozinho: 11 dígitos NÃO tem código de país.
// ---------------------------------------------------------------------
ok("DDD 55 (Santa Maria) não é código de país", "55987654321", "5555987654321");
ok("DDD 55 com máscara", "(55) 98765-4321", "5555987654321");
ok("DDD 55 já internacionalizado tem 13", "5555987654321", "5555987654321");
ok("DDD 54 (Caxias) segue igual", "54991234567", "5554991234567");
ok("fixo de Santa Maria", "5532221111", "555532221111");

// ---------------------------------------------------------------------
// 3. Celular antigo sem o nono dígito
//
// A Anatel tornou o 9 obrigatório em 2016. Assinante de 8 dígitos começando
// em 6-9 é cadastro velho — acrescentar o 9 é aplicar a regra. Mas vem
// MARCADO, porque interpretar não é o mesmo que saber.
// ---------------------------------------------------------------------
ok("celular antigo ganha o 9 e é marcado", "5182512270", "5551982512270", true);
ok("celular antigo começando em 7", "5172512270", "5551972512270", true);
ok("fixo começando em 3 NÃO ganha 9", "5133334444", "555133334444", false);
ok("fixo começando em 2 NÃO ganha 9", "5122334455", "555122334455", false);

// ---------------------------------------------------------------------
// 4. O que tem que ser RECUSADO
//
// Recusar é a metade que protege. Uma mensagem que não sai alguém conserta;
// uma que sai errada vira reclamação do cliente do cliente.
// ---------------------------------------------------------------------
recusa("vazio", "");
recusa("nulo", null);
recusa("só pontuação", "()- ");
recusa("curto demais", "98251227");
recusa("DDD que não existe (00)", "00912345678");
recusa("DDD que não existe (10)", "10912345678");
recusa("DDD que não existe (20)", "20912345678");
recusa("celular de 9 dígitos que não começa em 9", "51812345678");
recusa("número longo demais", "555519825122701234");
recusa("estrangeiro (Portugal)", "351912345678");

// ---------------------------------------------------------------------
// 5. O contrato com o resto do sistema
// ---------------------------------------------------------------------
if (whatsappNumber("(51) 98251-2270") === "5551982512270") passou++;
else falhas.push("whatsappNumber devolve os dígitos com país");

if (whatsappNumber("abc") === null) passou++;
else falhas.push("whatsappNumber devolve null quando não dá para derivar");

// O VALOR GUARDADO NÃO MUDA. É o que mantém válido o motivo do adiamento na
// auditoria: derivamos para enviar, nunca gravamos por cima. Se a derivação
// estiver errada, o cadastro continua intacto.
if (normalizePhone("(51) 98251-2270") === "51982512270") passou++;
else falhas.push("normalizePhone continua devolvendo só dígitos, sem código de país");

// ---------------------------------------------------------------------
// ---------------------------------------------------------------------
// O CAMINHO DE VOLTA — achar o cadastro quando a mensagem CHEGA
// ---------------------------------------------------------------------
//
// ⚠ ESTE BLOCO NASCEU DE UM DEFEITO AO VIVO, em 24/ago/2026, no primeiro
// envio real que este sistema fez pela Meta.
//
// O modelo saiu para `5551993742002` (13 dígitos, com o nono acrescentado por
// `paraE164BR`). A pessoa leu e respondeu. E a Meta devolveu o remetente como
// **`555193742002` — 12 dígitos, SEM o nono**.
//
// A busca procurou só pelas formas sem o 9, o cadastro estava gravado COM o 9,
// não achou, e o webhook criou um SEGUNDO contato. A conversa foi parar no
// cadastro novo e a caixa de resposta do original apareceu cinza, com a janela
// de 24h "fechada" — porque naquele contato ninguém tinha escrito mesmo.
//
// ⚠ É a mesma classe da Lilian com a direção invertida: lá o cadastro estava
// sem o 9 e a mensagem chegava com; aqui o cadastro tem e a mensagem chega
// sem. Consertar uma direção e não a outra faz o defeito voltar com outra
// cara — e este voltaria em TODA resposta da campanha.

function variantes(nome, entrada, precisaConter) {
  const v = variantesArmazenadas(entrada);
  const faltando = precisaConter.filter((x) => !v.includes(x));
  if (faltando.length) {
    falhas.push(`${nome}\n    faltou nas variantes: ${faltando.join(", ")}\n    obtido: ${v.join(", ")}`);
    return;
  }
  passou++;
}

// Esperado: as quatro formas. É o caso REAL de 24/ago.
variantes(
  "Meta manda SEM o nono; o cadastro tem COM",
  "555193742002",
  ["555193742002", "5193742002", "5551993742002", "51993742002"],
);

// A direção que já existia continua valendo — 39% da base está assim.
variantes(
  "Meta manda COM o nono; o cadastro tem SEM",
  "5551993742002",
  ["5551993742002", "51993742002", "555193742002", "5193742002"],
);

// ⚠ FIXO NÃO GANHA NONO DÍGITO. `5551` + `32250000` começa em 3: é telefone
// fixo, e inventar um 9 na frente procuraria um celular que não existe.
variantes("fixo continua sendo fixo", "555132250000", ["555132250000", "5132250000"]);
{
  const v = variantesArmazenadas("555132250000");
  if (v.some((x) => x.includes("932250000"))) {
    falhas.push("fixo NÃO pode ganhar o nono dígito\n    obtido: " + v.join(", "));
  } else passou++;
}

const total = passou + falhas.length;
if (falhas.length) {
  console.error(`\n✗ FALHOU — ${passou}/${total}\n`);
  for (const f of falhas) console.error(`  ✗ ${f}\n`);
  process.exit(1);
}
console.log(`\n✓ PASSOU — ${passou}/${total}`);
