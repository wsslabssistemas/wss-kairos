/**
 * O QUE A RESPOSTA DA META QUER DIZER — a leitura, separada de quem pergunta.
 *
 * ⚠ RESPONDER NÃO É ESTAR BEM, e essa é a distinção que o vigia existe para
 * fazer. A Meta pode responder 200 com o número em qualidade BAIXA, com o nome
 * REJEITADO ou com o envio restringido. Tratar "a chamada funcionou" como "o
 * canal está bom" seria trocar um silêncio por um verde falso — que é pior,
 * porque verde falso ninguém investiga.
 *
 * ⚠ TRÊS ESTADOS, NÃO DOIS. "Não deu para perguntar" é diferente de "perguntei
 * e está ruim": o primeiro pode ser rede, o segundo é decisão da Meta sobre o
 * número do cliente pagante. Colapsar os dois num booleano faria a tela dizer
 * a mesma coisa para uma falha de internet e para um número prestes a ser
 * bloqueado.
 *
 * Puro de propósito — sem banco, sem rede: é o que permite testar cada estado
 * sem depender da Meta estar de pé.
 */

export type Gravidade = "ok" | "atencao" | "parado";

export type Veredito = {
  gravidade: Gravidade;
  /** Uma frase, escrita para quem opera — não para quem programou. */
  resumo: string;
};

export type LeituraDoCanal =
  | { ok: false; erro: string }
  | {
      ok: true;
      quality_rating?: string;
      name_status?: string;
      messaging_limit_tier?: string;
      verified_name?: string;
    };

export function avaliarSaude(leitura: LeituraDoCanal): Veredito {
  // ⚠ NÃO CONSEGUIR PERGUNTAR É O ESTADO MAIS GRAVE, mesmo parecendo o mais
  // banal. Token vencido e número removido chegam exatamente assim, e é o
  // único caso em que ninguém consegue nem mandar nem receber.
  if (!leitura.ok) {
    return { gravidade: "parado", resumo: `Não consegui falar com a Meta: ${leitura.erro}` };
  }

  const q = (leitura.quality_rating ?? "").toUpperCase();
  const nome = (leitura.name_status ?? "").toUpperCase();

  // ⚠ FLAGGED É O AVISO QUE ANTECEDE O BLOQUEIO. Ignorá-lo é perder a única
  // janela em que ainda dá para reduzir volume e recuperar a nota.
  if (q === "RED" || q === "FLAGGED") {
    return { gravidade: "parado", resumo: "A Meta baixou a qualidade do número para BAIXA. Reduza o volume hoje." };
  }
  if (q === "YELLOW" || q === "MEDIUM") {
    return { gravidade: "atencao", resumo: "Qualidade do número em MÉDIA — a Meta está reagindo a bloqueios ou denúncias." };
  }

  // ⚠ NOME REJEITADO NÃO IMPEDE ENVIO, e por isso passa despercebido: tudo
  // funciona, e quem recebe lê um nome errado antes de decidir se abre.
  if (nome === "REJECTED" || nome === "DECLINED") {
    return { gravidade: "atencao", resumo: `O nome de exibição foi rejeitado — quem recebe vê "${leitura.verified_name ?? "?"}".` };
  }
  if (nome === "PENDING_REVIEW" || nome === "PENDING") {
    return { gravidade: "atencao", resumo: "O nome de exibição está em revisão na Meta." };
  }

  const nota = q === "GREEN" || q === "HIGH" ? "alta" : q ? q.toLowerCase() : "não informada";
  return { gravidade: "ok", resumo: `Canal respondendo, qualidade ${nota}.` };
}
