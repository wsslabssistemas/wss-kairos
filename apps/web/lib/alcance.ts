import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { lerTudo } from "@/lib/paginado";

/**
 * QUANTAS PESSOAS AINDA CABEM NO RECORTE — e quantas o próximo recorte abriria.
 *
 * ⚠ POR QUE ISTO EXISTE. Em 28/ago o fundador clicou em "Enviar agora" e saíram
 * **10** mensagens, com teto de 15 e 914 pessoas avaliadas. A tela não explicou,
 * e a frase dele foi: *"não sei se vai enviar à tarde mais... essa parte ainda
 * não está boa justamente porque não sei o que fazer"*.
 *
 * A causa não era defeito: dentro do recorte de 180 dias existiam exatamente
 * 10 pessoas com telefone e sem contato. **A faixa tinha acabado.** O sistema
 * sabia disso e guardou para si.
 *
 * ⚠ "SAÍRAM 10" É INDISTINGUÍVEL DE TRÊS COISAS DIFERENTES para quem lê: teto
 * atingido, defeito no envio, ou fim da fila. As três pedem ações opostas —
 * esperar, chamar suporte, ou aumentar o recorte. Número sem o porquê ao lado
 * transfere para a pessoa um trabalho de investigação que o banco responde em
 * uma consulta.
 *
 * ⚠ E NÃO É ESTATÍSTICA, É A PRÓXIMA AÇÃO. A pergunta que isto responde é
 * "o que eu faço agora?", não "como está minha base". Por isso devolve o
 * próximo recorte útil com o número que ele destrava, e não uma tabela.
 */

export type Alcance = {
  /** Ainda dá para falar com quantas pessoas, com o recorte de hoje. */
  dentro: number;
  /** O recorte atual, em dias. 0 = sem recorte. */
  recorte: number;
  /** O próximo degrau que vale a pena, se houver. */
  proximo: { dias: number; destrava: number } | null;
};

/** Os degraus da campanha, na ordem em que o plano os usa. */
const DEGRAUS = [180, 365, 730, 0];

export async function alcanceDaReativacao(
  tenantId: string,
  recorte: number,
  etapaDeSaida: string | null,
): Promise<Alcance | null> {
  // ⚠ SEM A ETAPA DECLARADA NO MANIFESTO NÃO HÁ O QUE CONTAR. "ex_aluno" é
  // vocabulário de academia e não pode morar aqui (Lei 1). Ausência devolve
  // `null`, e a tela simplesmente não mostra a linha — melhor calar que chutar.
  if (!etapaDeSaida) return null;

  const admin = createAdminClient();

  const contatos = await lerTudo<{ id: string; stage_entered_at: string | null; phone: string | null; do_not_contact: boolean | null }>(
    (de, ate) => admin
      .from("contacts")
      .select("id, stage_entered_at, phone, do_not_contact")
      .eq("tenant_id", tenantId)
      .is("deleted_at", null)
      .eq("journey_stage", etapaDeSaida)
      .order("id")
      .range(de, ate),
    { rotulo: "ex-clientes para o alcance" },
  );

  // Quem já recebeu pelo canal oficial sai da conta: o recorte serve para
  // escolher QUEM AINDA NÃO FOI, não para recontar quem já foi.
  const jaFalados = new Set(
    (await lerTudo<{ contact_id: string | null }>(
      (de, ate) => admin
        .from("interactions")
        .select("contact_id")
        .eq("tenant_id", tenantId)
        .eq("direction", "outbound")
        .not("external_id", "is", null)
        .order("id")
        .range(de, ate),
      { rotulo: "saidas do canal para o alcance" },
    )).map((i) => i.contact_id),
  );

  const agora = Date.now();
  const alcancaveis = contatos.filter(
    (c) => !!c.phone?.trim() && !c.do_not_contact && !jaFalados.has(c.id),
  );
  const diasFora = (c: { stage_entered_at: string | null }) => {
    if (!c.stage_entered_at) return null;
    const d = Math.floor((agora - Date.parse(c.stage_entered_at)) / 86_400_000);
    return Number.isFinite(d) ? d : null;
  };

  // ⚠ RECORTE 0 É "SEM RECORTE", não "nenhum". A convenção vem de
  // `lib/automation.ts` e inverter aqui faria a tela dizer que não há ninguém
  // justamente quando o acervo inteiro está liberado.
  const cabe = (c: { stage_entered_at: string | null }, r: number) => {
    if (r <= 0) return true;
    const d = diasFora(c);
    return d !== null && d <= r;
  };

  const dentro = alcancaveis.filter((c) => cabe(c, recorte)).length;

  // O próximo degrau é o primeiro MAIOR que o de hoje e que destrava alguém.
  // Degrau que não destrava ninguém não é sugestão, é ruído.
  let proximo: Alcance["proximo"] = null;
  if (recorte > 0) {
    for (const d of DEGRAUS) {
      const maior = d === 0 || d > recorte;
      if (!maior) continue;
      const destrava = alcancaveis.filter((c) => cabe(c, d)).length - dentro;
      if (destrava > 0) { proximo = { dias: d, destrava }; break; }
    }
  }

  return { dentro, recorte, proximo };
}
