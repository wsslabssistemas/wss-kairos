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
//   https://wa.me/5551941934124?text=Oi!%20Vim%20pelo%20site%20e%20quero%20saber%20mais
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

/** O que o link do site manda escrito. Mude aqui E no site, nunca só num. */
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
  return t.includes(normalizar(FRASE_DO_SITE)) ? "site" : null;
}
