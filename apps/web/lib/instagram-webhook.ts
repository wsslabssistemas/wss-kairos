// O PACOTE DO INSTAGRAM — desmontar o direct que chega.
//
// ⚠ O FORMATO NAO E O DO WHATSAPP, e mandar os dois para o mesmo desmontador
// seria a segunda versao da regra que este repositorio combate em cinco
// lugares. Aqui o caminho e `entry[].messaging[]`, e o texto vem em
// `message.text`:
//
//   { object: "instagram",
//     entry: [{ id: "<id da conta da empresa>", time: 0,
//               messaging: [{ sender: { id: "<id de quem escreveu>" },
//                             recipient: { id: "<id da conta da empresa>" },
//                             timestamp: 0,
//                             message: { mid: "...", text: "oi" } }] }] }
//
// ⚠ NUNCA LANCA, pela mesma razao do webhook do WhatsApp: pacote que sempre
// quebra vira laco de reenvio, e a Meta desativa a assinatura depois de muitas
// falhas. Pacote estranho e CONTADO em `ignorados` e a rota responde 200 —
// aceitar e nao entender e melhor que recusar e ser desligado.

export type DirectRecebido = {
  /** `mid` — a chave contra duplicata, como o `wamid` do WhatsApp. */
  mid: string;
  /** O Instagram-scoped id de quem escreveu. Nao e telefone, nao e @. */
  de: string;
  /** A conta DA EMPRESA que recebeu — e o que diz de qual tenant e o direct. */
  contaDaEmpresa: string;
  texto: string;
  quando: Date;
  /**
   * ⚠ ECO DA NOSSA PROPRIA MENSAGEM. A Meta reenvia para o webhook o que o
   * PROPRIO app mandou, marcado com `is_echo`. Gravar isso como fala do
   * cliente encheria o historico de mensagens nossas do lado errado — e faria
   * a janela de 24h parecer aberta por uma mensagem que nao foi dele.
   */
  eco: boolean;
};

export type PacoteDoInstagram = {
  mensagens: DirectRecebido[];
  ignorados: string[];
};

/**
 * De onde veio o pacote. O Instagram manda `object: "instagram"`; a página do
 * Facebook manda `object: "page"` — e o resto do formato é IDÊNTICO.
 *
 * ⚠ A PLATAFORMA NÃO É DETALHE COSMÉTICO. Ela decide em qual coluna o contato
 * é procurado: o mesmo ser humano tem um id no Instagram e OUTRO no Facebook,
 * e casar os dois na mesma coluna faria o histórico de uma pessoa aparecer na
 * conversa de outra.
 */
export type Plataforma = "instagram" | "facebook";

const paraData = (ts: unknown): Date => {
  const n = Number(ts);
  // O Instagram manda milissegundos; o WhatsApp manda segundos. Confundir os
  // dois joga a conversa para 1970 ou para o ano 56000 — e nos dois casos a
  // ordem do historico quebra sem erro nenhum.
  return Number.isFinite(n) && n > 0 ? new Date(n) : new Date();
};

/**
 * @param plataforma Qual dos dois o chamador está esperando. Declarado, e não
 *   deduzido do pacote, de propósito: cada endereço tem o seu SEGREDO de
 *   assinatura, e aceitar o outro formato ali seria conferir a assinatura com
 *   a chave errada — ou pior, aceitar com a chave certa um pacote que o
 *   chamador não sabe tratar.
 */
export function desmontarInstagram(
  corpo: unknown,
  plataforma: Plataforma = "instagram",
): PacoteDoInstagram {
  const out: PacoteDoInstagram = { mensagens: [], ignorados: [] };
  const esperado = plataforma === "instagram" ? "instagram" : "page";
  const raiz = corpo as { object?: string; entry?: unknown[] } | null;
  if (!raiz || raiz.object !== esperado || !Array.isArray(raiz.entry)) {
    out.ignorados.push(`pacote fora do formato esperado (${esperado})`);
    return out;
  }

  for (const entrada of raiz.entry) {
    const e = entrada as { id?: unknown; messaging?: unknown[] };
    const conta = typeof e.id === "string" ? e.id : "";
    if (!Array.isArray(e.messaging)) {
      // ⚠ NAO ENTENDI + O QUE VEIO. "Entrada sem `messaging`" sozinho e um
      // beco: se o formato real do direct um dia for outro, o sintoma seria
      // exatamente esta linha, e ninguem saberia POR QUE. Listar as chaves do
      // pacote transforma "nao entendi" em "nao entendi, e olha o que chegou"
      // — a diferenca entre um defeito que se acha em minutos e um que dura
      // dias. Sao nomes de campo, nunca conteudo: mensagem de cliente nao vai
      // para log.
      const chaves = Object.keys((entrada ?? {}) as Record<string, unknown>).join(", ");
      out.ignorados.push(`entrada sem \`messaging\` (veio com: ${chaves || "nada"})`);
      continue;
    }

    for (const m of e.messaging) {
      const mm = m as {
        sender?: { id?: unknown };
        recipient?: { id?: unknown };
        timestamp?: unknown;
        message?: { mid?: unknown; text?: unknown; is_echo?: unknown; attachments?: unknown[] };
      };
      const msg = mm.message;
      if (!msg) { out.ignorados.push("evento sem mensagem (leitura, entrega ou reacao)"); continue; }

      const mid = typeof msg.mid === "string" ? msg.mid : "";
      const de = typeof mm.sender?.id === "string" ? mm.sender.id : "";
      if (!mid || !de || !conta) { out.ignorados.push("mensagem sem id, remetente ou conta"); continue; }

      const texto = typeof msg.text === "string" ? msg.text.trim() : "";
      // ⚠ MIDIA VIRA DESCRICAO, como no WhatsApp. Audio de direct tambem da
      // para transcrever um dia; hoje o que importa e a mensagem EXISTIR, para
      // a conversa aparecer e alguem responder.
      const conteudo = texto || (Array.isArray(msg.attachments) && msg.attachments.length
        ? "(anexo recebido no direct — veja no Instagram)"
        : "");
      if (!conteudo) { out.ignorados.push("mensagem sem texto e sem anexo"); continue; }

      out.mensagens.push({
        mid,
        de,
        contaDaEmpresa: conta,
        texto: conteudo,
        quando: paraData(mm.timestamp),
        eco: msg.is_echo === true,
      });
    }
  }

  return out;
}
