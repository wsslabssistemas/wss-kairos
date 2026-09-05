import "server-only";

// AS PERMISSÕES DA META, MEDIDAS PELO EFEITO — nunca pelo papel.
//
// ⚠ POR QUE MEDIR EM VEZ DE PERGUNTAR. O estado de uma revisão de app só é
// legível com um token de APLICATIVO (`app_id|app_secret`), e o segredo mora na
// Vercel marcado como sensível — que não devolve valor nem pelo CLI. Então o
// caminho de "perguntar o status" está fechado por construção.
//
// O caminho que sobra é melhor: **tentar a chamada que a permissão libera.**
// Ela responde a pergunta que interessa de verdade — não "o formulário foi
// aprovado?", e sim "o sistema consegue fazer isto?". As duas divergem: uma
// permissão aparece como concedida no painel e falha na chamada quando o token
// foi gerado antes dela.
//
// ⚠ E TEM UMA COISA QUE ISTO **NÃO** CONSEGUE VER: o Acesso Avançado. Para a
// conta que o próprio app administra, o Acesso Padrão já faz tudo funcionar —
// então de dentro da Be Fitness as duas situações são idênticas. A diferença só
// aparece quando OUTRA empresa tenta conectar. Não existe sonda para isso, e
// fingir que existe seria pior que não ter: um verde falso.
//
// ⚠ E TODA SONDA É DE LEITURA. Nada aqui escreve, assina, publica ou manda
// mensagem — uma verificação que muda estado é uma verificação que ninguém
// deixa rodar sozinha.

export type Sonda = {
  /** O nome da permissão, como a Meta escreve. É a chave do alerta. */
  permissao: string;
  /** O que ela destrava, em português, para o alerta dizer por que importa. */
  destrava: string;
};

/**
 * As permissões que o produto QUER e ainda não tem.
 *
 * Curta de propósito: sonda só o que muda alguma coisa quando chegar. Listar
 * tudo que a Meta oferece encheria o alarme de notícia que não vira trabalho.
 */
export const SONDAS: Sonda[] = [
  {
    permissao: "pages_manage_metadata",
    destrava:
      "assinar sozinho o webhook da página do Facebook. Hoje isso é um clique manual no painel " +
      "da Meta, e é a única coisa que separa a página de receber mensagem no Kairós.",
  },
];

/**
 * Testa uma permissão pelo efeito. `null` = não deu para saber (rede, token).
 *
 * ⚠ `null` NÃO É `false`. Falha de rede tratada como "não tem permissão"
 * faria o alarme de liberação nunca tocar depois de um erro passageiro — e
 * ninguém procuraria, porque a ausência de aviso se parece com "ainda não
 * aprovaram".
 */
export async function temPermissao(
  permissao: string,
  paginaId: string,
  token: string,
  versao = "v21.0",
): Promise<boolean | null> {
  const url = sondaDe(permissao, paginaId, versao);
  if (!url) return null;
  try {
    const r = await fetch(`${url}${url.includes("?") ? "&" : "?"}access_token=${encodeURIComponent(token)}`, {
      cache: "no-store",
    });
    const j = (await r.json().catch(() => null)) as { error?: { code?: number; message?: string } } | null;
    if (r.ok) return true;
    const code = j?.error?.code;
    // 10 e 200 são "falta permissão"; 190 é token inválido, que não diz nada
    // sobre a permissão. Qualquer outro código é desconhecido — e desconhecido
    // vira `null`, nunca `false`.
    if (code === 10 || code === 200) return false;
    return null;
  } catch {
    return null;
  }
}

/** A chamada de LEITURA que cada permissão libera. */
function sondaDe(permissao: string, paginaId: string, versao: string): string | null {
  const base = `https://graph.facebook.com/${versao}`;
  switch (permissao) {
    // Listar os apps assinados no webhook da página exige a mesma permissão
    // que ASSINAR — e listar não muda nada.
    case "pages_manage_metadata":
      return `${base}/${paginaId}/subscribed_apps`;
    default:
      return null;
  }
}
