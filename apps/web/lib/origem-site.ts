// DE ONDE A PESSOA VEIO, quando ela chega pelo site.
//
// ⚠ POR QUE ISTO EXISTE. Em 31/ago/2026 o site novo da Be Fitness entrou no ar
// com os botões apontando para o número da automação. A partir dali todo lead
// vindo do site passou a nascer com `source = "whatsapp"` — indistinguível de
// quem viu o número no Instagram, pegou por indicação ou digitou na mão.
//
// O WhatsApp é o MEIO, nunca a origem. Essa frase já está escrita no webhook
// para o caso do anúncio da Meta (que vem com o bloco `referral`), e o site é
// o mesmo problema sem o mesmo socorro: a Meta não avisa que o clique veio de
// um link nosso.
//
// ⚠ E ORIGEM É A ÚNICA DIMENSÃO QUE O FUNDADOR IMPÔS COMO OBRIGATÓRIA na
// medição — convênio responde 9%, WhatsApp responde 54%. Somar site com
// indicação é medir duas coisas e chamar de uma. Sem isto, o site sobe e
// ninguém consegue provar que ele trouxe alguém.
//
// COMO FUNCIONA. O link do site leva um texto pronto:
//
//   https://wa.me/5551994193412?text=Oi!%20Vim%20pelo%20site%20e%20quero%20saber%20mais
//
// ⚠ O NÚMERO ACIMA É O DA BE FITNESS E TEM O NONO DÍGITO. A Meta EXIBE o
// número brasileiro sem ele ("+55 51 9419-3412"), e copiar da tela dela
// produz um link que não abre conversa nenhuma. É a mesma armadilha que já
// duplicou contato no webhook — ver `variantesArmazenadas` em `lib/phone.ts`.
// Eu mesmo errei este número num comentário em 31/ago; quem conferiu foi o
// fundador, publicando o site.
//
// A pessoa vê o texto já escrito na conversa e só aperta enviar. A primeira
// mensagem chega com a marca, e é ela que diz a origem.
//
// ⚠ POR QUE UMA FRASE, E NÃO UM CÓDIGO. Um marcador tipo `#ref=site` aparece
// para a pessoa e parece rastreamento — o suficiente para alguém apagar antes
// de mandar, ou desconfiar. A frase é natural, sobrevive à leitura e continua
// sendo a primeira coisa que o vendedor lê.
//
// ⚠ E ELA PODE SER EDITADA, de propósito. Quem apagar e escrever outra coisa
// entra como `whatsapp`, que é a verdade: não dá para provar de onde veio.
// **Origem que se perde é melhor que origem inventada** — a regra do produto
// inteiro aplicada à medição dele.

/**
 * AS FRASES QUE REVELAM DE ONDE A PESSOA VEIO, e a origem de cada uma.
 *
 * ⚠ INSTAGRAM E FACEBOOK ENTRARAM EM 01/set, e o motivo é o mesmo do site: os
 * botões e a bio das redes apontam para o número da automação, e sem marca
 * toda essa gente nasce como `whatsapp`. A base da Be Fitness já tem 37
 * contatos marcados como `facebook` e 7 como `instagram` — todos digitados à
 * mão na importação. Quem chega hoje pelas redes some dentro de `whatsapp`.
 *
 * ⚠ A ORDEM: a primeira frase que casar vence, e as redes vêm antes do site —
 * quando as duas marcas aparecem inteiras, a rede é a origem e o site é o
 * caminho. É um desempate raro, e ele NÃO cobre "vim pelo site do instagram":
 * essa frase não contém "vim pelo instagram", contém "vim pelo site", e é como
 * site que ela entra. Eu tinha escrito o contrário aqui; a trava pegou.
 *
 * ⚠ E MENCIONAR A REDE DE PASSAGEM NÃO É MARCA. "vi vocês no instagram, quanto
 * custa?" entra como `whatsapp` — não temos como provar de onde veio o clique,
 * e origem que se perde é melhor que origem inventada.
 *
 * ⚠ E TODA ORIGEM AQUI PRECISA ESTAR DECLARADA EM `lead_sources` NO MANIFESTO
 * DE TODO SEGMENTO. Gravar uma origem que o ramo não conhece quebra a regra do
 * `CLAUDE.md` — dimensão de análise é enum, nunca texto livre — e faz a
 * pessoa ver na ficha um valor que o seletor dela não oferece. Guardado por
 * `origem_check.mjs`.
 */
export const MARCADORES: { frase: string; origem: string }[] = [
  { frase: "vim pelo instagram", origem: "instagram" },
  { frase: "vim pelo insta", origem: "instagram" },
  { frase: "vim pelo facebook", origem: "facebook" },
  { frase: "vim pelo face", origem: "facebook" },
  { frase: "vim pelo site", origem: "site" },
];

/** Compatibilidade com quem já usava a constante do site. */
export const FRASE_DO_SITE = "vim pelo site";

/**
 * Sem acento e em minúscula, para "Vim pelo Site" e "vim pelo síte" caírem no
 * mesmo lugar. Mesmo tratamento que a busca da biblioteca usa.
 */
function normalizar(t: string): string {
  return t
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

/**
 * A origem que a PRIMEIRA mensagem revela. `null` quando não revela nada.
 *
 * ⚠ SÓ VALE NA CRIAÇÃO DO CONTATO. Uma pessoa que já é lead e um dia escreve
 * "vim pelo site" não muda de origem: ela já veio de algum lugar, e reescrever
 * a origem depois faz o relatório do mês passado mudar sozinho.
 */
export function origemDaPrimeiraMensagem(texto: string | null | undefined): string | null {
  const t = normalizar((texto ?? "").trim());
  if (!t) return null;
  for (const m of MARCADORES) {
    if (t.includes(normalizar(m.frase))) return m.origem;
  }
  return null;
}
