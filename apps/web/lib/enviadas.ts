import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { lerTudo } from "@/lib/paginado";

// O QUE SAIU NUM DIA — a conferência que faltava.
//
// ⚠ POR QUE UM DIA, E NÃO "O GERAL". O fundador pediu assim: *"sinto falta de
// um lugar para conferir quais mensagens foram enviadas hoje; tem um painel
// que mostra, mas mostra no geral, queria saber por dia"*.
//
// A diferença não é de conveniência. Número acumulado responde "o produto
// funciona?"; o dia responde **"o que a máquina fez no meu nome hoje?"** — que
// é a pergunta de quem acabou de ligar a resposta automática e vai dormir com
// ela ligada. Com o total, uma rodada que mandou a mensagem errada para vinte
// pessoas fica escondida atrás de trezentas certas.
//
// ⚠ E A SEPARAÇÃO QUE IMPORTA É PROATIVA × RESPOSTA. São dois bolsos com
// riscos opostos: campanha fala com quem não pediu nada (gasta, e arrisca o
// número); resposta fala com quem perguntou. O teto do dia governa só o
// primeiro — foi o defeito de 3/set, quando as respostas da equipe comeram a
// cota da campanha. Uma tela que soma os dois reintroduz a confusão que a
// correção desfez.

export type MensagemEnviada = {
  id: string;
  quando: string;
  contactId: string | null;
  nome: string;
  canal: string;
  /** `true` = toque proativo (campanha ou fila). `false` = resposta. */
  proativa: boolean;
  /** Quem mandou: `null` significa que foi a máquina, sem autor. */
  autor: string | null;
  /** `aceita` | `editada` | `automatica` | `null` (escrita à mão). */
  origemIa: string | null;
  status: string | null;
  texto: string;
};

/**
 * A linha crua da consulta.
 *
 * ⚠ SEPARADA DA CHAMADA de propósito: com o tipo inline, as dez linhas da
 * anotação empurravam o `.from("interactions")` para fora da janela que o
 * `paginacao_check` usa para reconhecer o `lerTudo` — e a trava acusava uma
 * consulta paginada de não estar paginada. Trava que discorda do código é
 * trava que alguém desliga.
 */
type LinhaCrua = {
  id: string;
  contact_id: string | null;
  occurred_at: string;
  input_kind: string | null;
  channel: string | null;
  created_by: string | null;
  origem_ia: string | null;
  delivery_status: string | null;
  content: string | null;
};

export type ResumoDoDia = {
  dia: string;
  proativas: number;
  respostas: number;
  automaticas: number;
  falhas: number;
  mensagens: MensagemEnviada[];
};

/**
 * O que saiu pelo canal oficial num dia, no fuso da EMPRESA.
 *
 * ⚠ O DIA É O DA EMPRESA, não o do servidor. Com `toISOString()` o dia vira às
 * 21h de Brasília — e a tela mostraria as mensagens da noite no dia seguinte,
 * exatamente quando alguém está conferindo o que acabou de sair. É a mesma
 * correção que o teto diário já tinha precisado.
 */
export async function enviadasNoDia(
  tenantId: string,
  diaISO: string,
  fuso = "America/Sao_Paulo",
): Promise<ResumoDoDia> {
  const admin = createAdminClient();

  // O intervalo do dia local, convertido para instantes. Duas datas cruas
  // seriam comparadas em UTC e cortariam três horas do dia de trabalho.
  const inicio = new Date(`${diaISO}T00:00:00`);
  const desloc = deslocamentoHoras(inicio, fuso);
  const de = new Date(Date.parse(`${diaISO}T00:00:00Z`) + desloc * 3_600_000);
  const ate = new Date(de.getTime() + 24 * 3_600_000);

  // ⚠ `lerTudo` mesmo sendo um dia só: `interactions` é a tabela que mais
  // cresce, e um dia de campanha grande passa de 1.000 linhas sem aviso — o
  // PostgREST corta em silêncio, e a tela diria "saíram 1.000" com 1.400
  // enviadas. É a regra dos 1.000 exatamente onde ela mais engana.
  const linhas = await lerTudo<LinhaCrua>(
    (ini, fim) => admin
        .from("interactions")
        .select("id, contact_id, occurred_at, input_kind, channel, created_by, origem_ia, delivery_status, content")
        .eq("tenant_id", tenantId)
        .eq("direction", "outbound")
        .not("external_id", "is", null)
        .gte("occurred_at", de.toISOString())
        .lt("occurred_at", ate.toISOString())
        .order("occurred_at", { ascending: false })
        .range(ini, fim),
    { rotulo: "mensagens enviadas no dia" },
  );

  const ids = [...new Set(linhas.map((l) => l.contact_id).filter(Boolean))] as string[];
  const nomes = new Map<string, string>();
  // Em lotes de 500, como o resto da casa: `in` com mil ids estoura a URL.
  for (let i = 0; i < ids.length; i += 500) {
    // paginacao-ok: lote fechado de 500 ids, tirado da lista já paginada acima.
    const { data } = await admin
      .from("contacts")
      .select("id, name")
      .in("id", ids.slice(i, i + 500));
    for (const c of ((data as { id: string; name: string }[] | null) ?? [])) nomes.set(c.id, c.name);
  }

  const mensagens: MensagemEnviada[] = linhas.map((l) => ({
    id: l.id,
    quando: l.occurred_at,
    contactId: l.contact_id,
    nome: (l.contact_id && nomes.get(l.contact_id)) || "(contato sem nome)",
    canal: l.channel ?? "whatsapp",
    proativa: l.input_kind === "system_initiated",
    autor: l.created_by,
    origemIa: l.origem_ia,
    status: l.delivery_status,
    texto: (l.content ?? "").slice(0, 300),
  }));

  return {
    dia: diaISO,
    proativas: mensagens.filter((m) => m.proativa).length,
    respostas: mensagens.filter((m) => !m.proativa).length,
    // ⚠ QUANTAS A MÁQUINA ESCREVEU SOZINHA. É o número que se olha no dia
    // seguinte a ligar a fase 2 — e ele é separado das outras duas origens de
    // propósito: `aceita` e `editada` medem o que uma PESSOA julgou.
    automaticas: mensagens.filter((m) => m.origemIa === "automatica").length,
    falhas: mensagens.filter((m) => m.status === "failed").length,
    mensagens,
  };
}

/** O "hoje" da empresa, em `AAAA-MM-DD`. */
export function hojeLocal(fuso = "America/Sao_Paulo", agora = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: fuso,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(agora);
}

/**
 * Quantas horas o fuso está do UTC naquele instante.
 *
 * Calculado, nunca fixo em -3: o Brasil já teve horário de verão e pode ter de
 * novo, e uma constante erraria uma hora em silêncio durante meses.
 */
function deslocamentoHoras(quando: Date, fuso: string): number {
  const local = new Date(quando.toLocaleString("en-US", { timeZone: fuso }));
  const utc = new Date(quando.toLocaleString("en-US", { timeZone: "UTC" }));
  return Math.round((utc.getTime() - local.getTime()) / 3_600_000);
}
