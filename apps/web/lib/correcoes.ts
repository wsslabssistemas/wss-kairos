import "server-only";
import { mesmaMensagem, origemDaMensagem } from "@/lib/origem-ia";
export { mesmaMensagem, origemDaMensagem };
import { createAdminClient } from "@/lib/supabase/admin";

// AS CORREÇÕES DO VENDEDOR — capturar, e devolver para o motor.
//
// ⚠ POR QUE ISTO É A RESPOSTA PARA "COMO DEIXAR A IA MAIS INTELIGENTE".
//
// O fundador testou o motor ao vivo e descreveu o que viu: *"às vezes ela
// entrega uma resposta 100% bem, outras vezes precisa de uma adaptação"*. E
// fez a pergunta certa: **como melhorar?**
//
// A tentação é mexer no prompt. O `CLAUDE.md` já proíbe essa reação como
// primeira escolha — *"prefira a correção estrutural à correção de prompt"* —
// e aqui ela seria pior que inútil: quem escreve o prompt está adivinhando o
// que a academia faria, quando a academia está corrigindo o texto na tela,
// todo dia, na frente da gente.
//
// **O sinal já existe e estava sendo jogado fora.** Cada adaptação é um
// vendedor experiente reescrevendo o modelo, no contexto exato, de graça.
//
// ⚠ E POR QUE ELE VALE MAIS QUE O DESFECHO, HOJE.
//
// `lib/aprendizado.ts` mede qual escola converte, e está certo em ficar em
// silêncio: são 14 fechamentos na base inteira. Além disso, desfecho demora
// semanas — e a pergunta do fundador é sobre a mensagem de hoje.
//
// Vinte mensagens adaptadas geram vinte lições em uma tarde. Vinte matrículas
// levam dois meses. Este caminho não substitui o desfecho: ele existe para o
// produto sair do zero enquanto o desfecho amadurece.
//
// ⚠ O QUE ISTO **NÃO** É: treinamento de modelo. Nada aqui altera pesos. O que
// acontece é mais simples e mais honesto — as correções voltam para o prompt
// como EXEMPLOS DAQUELA EMPRESA, e o modelo passa a escrever no jeito da casa
// em vez de no jeito genérico. É a mesma ideia da biblioteca curada, com uma
// diferença que importa: a biblioteca é o que NÓS sabemos de venda; isto é o
// que ESTE cliente sabe do negócio dele.

export type Correcao = {
  contexto: string;
  sugerido: string;
  enviado: string;
};

/**
 * Guarda o par sugerido × enviado.
 *
 * ⚠ SÓ GRAVA SE HOUVE MUDANÇA DE VERDADE. Mensagem enviada igualzinha não é
 * lição — é confirmação, e encheria a tabela de ruído até o sinal sumir dentro
 * dela. A comparação ignora espaço e caixa: trocar um espaço não é correção.
 *
 * Best-effort, como toda medição: falhar em registrar o aprendizado não pode
 * impedir a mensagem de sair. Mas vai para o log, porque medição que some em
 * silêncio é a que faz o painel mentir depois.
 */
export async function guardarCorrecao(entrada: {
  tenantId: string;
  contactId: string | null;
  membershipId: string | null;
  contexto: string;
  sugerido: string;
  enviado: string;
}): Promise<void> {
  const { tenantId, contactId, membershipId, contexto, sugerido, enviado } = entrada;

  if (!sugerido.trim() || !enviado.trim() || mesmaMensagem(sugerido, enviado)) return;

  try {
    const admin = createAdminClient();
    const { error } = await admin.from("ai_edits").insert({
      tenant_id: tenantId,
      contact_id: contactId,
      created_by: membershipId,
      contexto: contexto.slice(0, 2000),
      sugerido: sugerido.slice(0, 4000),
      enviado: enviado.slice(0, 4000),
    });
    if (error) console.error(`[correcoes] nao gravou: ${error.message}`);
  } catch (e) {
    console.error(`[correcoes] falha: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/**
 * As últimas correções desta empresa, prontas para entrar no prompt.
 *
 * ⚠ SÃO POUCAS DE PROPÓSITO — seis, não sessenta.
 *
 * Exemplo demais dilui: o modelo passa a imitar o formato médio em vez de
 * aprender a regra. E as mais RECENTES valem mais que as melhores: quando a
 * academia muda o preço, cria um brinde ou troca a forma de agendar, a
 * correção nova contradiz a velha — e ficar com as duas ensina o modelo a
 * hesitar entre o certo e o obsoleto.
 *
 * paginacao-ok: `.limit(6)` é decisão de produto, e as mais recentes por
 * `ORDER BY` explícito — sem ele o PostgREST devolveria seis arbitrárias.
 */
export async function correcoesRecentes(tenantId: string, quantas = 6): Promise<Correcao[]> {
  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("ai_edits")
      .select("contexto, sugerido, enviado")
      .eq("tenant_id", tenantId)
      .order("occurred_at", { ascending: false })
      .limit(quantas);
    if (error) {
      console.error(`[correcoes] nao leu: ${error.message}`);
      return [];
    }
    return (data as Correcao[] | null) ?? [];
  } catch {
    return [];
  }
}

/** O que faltou numa sugestão, escrito por quem julgou no banco de provas. */
export type Reparo = {
  mensagem: string;
  sugestao: string;
  nota: string;
};

/**
 * O QUE O BANCO DE PROVAS ENSINOU — e por que ele entra aqui, no mesmo lugar.
 *
 * ⚠ ELE EXISTE PORQUE A PREMISSA DO `ai_edits` PODE NÃO SE REALIZAR. Aquela
 * tabela captura a correção de quem edita antes de ENVIAR, e o fundador disse
 * que não confia na equipe para isso. Em duas horas de banco de provas ele
 * escreveu **30 notas** dizendo o que faltava em cada resposta; `ai_edits`
 * continuava com zero linhas. O sinal existia e estava numa tabela que o
 * prompt não lia.
 *
 * ⚠ E A NOTA É DIFERENTE DO PAR SUGERIDO×ENVIADO, de um jeito que ajuda: ela
 * não é o texto final, é **o motivo**. "Faltou oferecer a semana experimental
 * com o brinde" ensina a regra; um texto reescrito ensina uma frase. Por isso
 * o rótulo abaixo diz REPARO e não "resposta certa".
 *
 * paginacao-ok: `.limit(6)` é decisão de produto, com ORDER BY explícito.
 */
export async function reparosRecentes(tenantId: string, quantas = 6): Promise<Reparo[]> {
  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("provas")
      .select("mensagem, sugestao, nota")
      .eq("tenant_id", tenantId)
      .eq("veredito", "ajustaria")
      .not("nota", "is", null)
      .order("created_at", { ascending: false })
      .limit(quantas);
    if (error) {
      console.error(`[reparos] nao leu: ${error.message}`);
      return [];
    }
    return (data as Reparo[] | null) ?? [];
  } catch {
    return [];
  }
}

/**
 * O bloco dos reparos, para o prompt.
 *
 * ⚠ Vem com a MENSAGEM DO CLIENTE junto, e isso não é enfeite: "faltou o
 * brinde" é regra certa quando alguém pergunta preço e ruído quando alguém
 * está cancelando. Sem a situação, o exemplo ensina a regra errada — que é
 * pior que não ensinar. Mesma lição do `contexto` obrigatório do `ai_edits`.
 */
export function blocoDeReparos(rs: Reparo[]): string {
  if (!rs.length) return "";
  const linhas = rs
    .map(
      (r, i) =>
        `${i + 1}. O CLIENTE DISSE: ${r.mensagem.slice(0, 300)}\n` +
        `   Você respondeu: ${r.sugestao.slice(0, 400)}\n` +
        `   O DONO DA EMPRESA APONTOU O QUE FALTOU: ${r.nota}`,
    )
    .join("\n\n");

  return `O QUE O DONO DESTA EMPRESA JÁ APONTOU COMO FALTANDO NAS SUAS RESPOSTAS (ele leu mensagens reais e disse o que você deixou de dizer — aplique o MESMO padrão quando a situação for parecida, sem copiar a frase):

${linhas}`;
}

/**
 * O bloco de texto que entra no prompt.
 *
 * ⚠ O RÓTULO IMPORTA. "Correções que ESTA empresa fez" diz ao modelo que
 * aquilo tem mais autoridade que a técnica genérica — é o dono do negócio
 * reescrevendo. Chamar de "exemplos" faria virar mais um dado entre outros.
 *
 * Vazio quando não há correção nenhuma, e é o certo: um bloco com "(nenhuma)"
 * ocupa espaço no prompt e não diz nada.
 */
export function blocoDeCorrecoes(cs: Correcao[]): string {
  if (!cs.length) return "";
  const linhas = cs
    .map(
      (c, i) =>
        `${i + 1}. SITUAÇÃO: ${c.contexto}\n   O motor escreveu: ${c.sugerido}\n   O vendedor MANDOU: ${c.enviado}`,
    )
    .join("\n\n");

  return `CORREÇÕES QUE ESTA EMPRESA JÁ FEZ NAS SUAS MENSAGENS (o vendedor reescreveu antes de enviar — aprenda o padrão e escreva já no jeito da casa; onde a versão dele difere da sua, ele está certo):

${linhas}`;
}
