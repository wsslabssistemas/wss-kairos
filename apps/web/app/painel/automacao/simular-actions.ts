"use server";

import { getActiveTenant } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { rodarMotor } from "@/lib/motor-db";
import { ROTULO } from "@/lib/fila";
import { lerModelos, modeloDoToque } from "@/lib/roteamento";
import { primeiroNome } from "@/lib/modelo";
import { paraE164BR } from "@/lib/phone";
import { revalidatePath } from "next/cache";

export type LinhaDaSimulacao = {
  contactId: string;
  nome: string;
  motivo: string;
  sai: boolean;
  /** Por que NÃO sai. Vazio quando sai. */
  motivoDaRecusa: string;
  /**
   * Barrado pelo RECORTE de data da campanha, não por comportamento dele.
   *
   * ⚠ A tela agrupa estes numa linha só, com a contagem. São centenas de
   * pessoas com o MESMO motivo — listar uma a uma enterra os poucos vereditos
   * que alguém precisa ler de verdade. Continua aparecendo: o que a casa proíbe
   * é sumir, não é resumir.
   */
  recorte: boolean;
  /**
   * O que foi INTERPRETADO no telefone desta pessoa, se foi.
   *
   * ⚠ ELE EXISTE PORQUE O AVISO SE PERDIA. `paraE164BR` devolve `ajuste`
   * quando precisa acrescentar o nono dígito a um cadastro antigo — e esse
   * aviso foi feito para uma tela em que alguém confere antes de mandar. No
   * caminho automático não há esse alguém: o motor deriva, envia e ninguém
   * nunca vê o que foi interpretado. São **221 contatos da Be Fitness (13% da
   * base)** nessa situação.
   *
   * Aqui é o último lugar onde uma pessoa olha antes do lote sair. Se o aviso
   * não aparecer nesta linha, ele não aparece em lugar nenhum.
   */
  telefoneAjustado: string;
  /** Por que o telefone NÃO serve. Vazio quando serve. */
  telefoneInvalido: string;
  /**
   * O que a Meta vai preencher nas variáveis DESTA pessoa.
   *
   * ⚠ O corpo do modelo NÃO aparece aqui de propósito. Ele é fixo, mora na
   * Meta e foi aprovado por ela — copiá-lo para cá criaria uma segunda fonte
   * do mesmo texto, e as duas divergiriam no dia em que alguém editasse o
   * modelo lá. O que varia, e o que de fato pode sair errado, são as
   * variáveis: é isso que se confere antes de disparar.
   */
  variaveis: string[];
  /** Qual toque esta pessoa receberia: 1 = o primeiro desta etapa. */
  toque: number;
  modelo: string;
};

export type SimulacaoResult =
  | {
      ok: true;
      /** `false` quando nada sairia agora — e `porque` diz o motivo. */
      ativo: boolean;
      porque: string;
      linhas: LinhaDaSimulacao[];
      sairiam: number;
      avaliados: number;
      /** A lista foi montada fora do horário de operação — é o lote da próxima abertura. */
      foraDaJanela: boolean;
    }
  | { ok: false; erro: string };

/**
 * A SIMULAÇÃO — "quem sairia agora, e por que cada um foi barrado".
 *
 * ⚠ POR QUE ESTA TELA EXISTE, e ela nasceu de um erro meu.
 *
 * O fundador configurou 10 mensagens/dia, escolheu "Simulação" e foi procurar
 * o botão de rodar. **Não havia nenhum** — o modo era gravado e nada o lia. Eu
 * descrevi um fluxo que não tinha construído, e ele passou um tempo procurando
 * uma coisa que não existe.
 *
 * ⚠ E ELA MOSTRA OS BARRADOS, NÃO SÓ OS ESCOLHIDOS. Uma lista só com "vão sair
 * 7" não permite conferir nada: quem lê não sabe se os outros 30 foram
 * poupados pela regra certa ou sumiram por um defeito. É a mesma exigência da
 * fila — sumir da lista sem explicação é como um erro vira "trabalho em dia".
 *
 * NUNCA ENVIA. `simular: true` força o modo simulação mesmo com a empresa em
 * automático, então apertar aqui é seguro por construção, não por disciplina.
 */
export async function simularMotor(): Promise<SimulacaoResult> {
  const membership = await getActiveTenant();
  const tenant = membership?.tenant;
  if (!tenant) return { ok: false, erro: "Sem empresa vinculada." };
  if (!["owner", "admin"].includes(membership!.role)) {
    return { ok: false, erro: "Só quem é dono ou admin pode simular." };
  }

  try {
    const r = await rodarMotor({
      tenantId: tenant.id,
      skillKey: tenant.skill_key,
      tenantNome: tenant.name,
      simular: true,
    });

    // OS NOMES — só de quem a tela mostra NOMINALMENTE.
    //
    // ⚠ Quem o recorte barrou fica fora desta busca de propósito: a tela os
    // agrupa numa linha com a contagem, e buscar 1.014 nomes para não escrever
    // nenhum seria pagar a consulta mais cara da tela por nada.
    //
    // ⚠ E ANTES ISTO TINHA UM `.slice(0, 200)` — que não era limite de produto,
    // era o teto do PostgREST escrito à mão. Com o acervo inteiro na fila, a
    // pessoa de número 201 aparecia como "(contato sem nome)" numa tela cujo
    // trabalho é justamente conferir NOME por NOME antes de disparar.
    const ids = r.plano.vereditos
      .filter((v) => v.enviar || !v.recorte)
      .map((v) => v.contactId);
    const nomes = new Map<string, string>();
    const telefones = new Map<string, string | null>();
    if (ids.length) {
      const supabase = await createClient();
      for (let i = 0; i < ids.length; i += 500) {
        // paginacao-ok: o lote é de 500 ids e a resposta traz no máximo 500
        // linhas — metade do teto do PostgREST. É a paginação feita pela lista
        // de ids, como no aprendizado de `responder/ai-actions.ts`.
        const { data } = await supabase
          .from("contacts")
          .select("id, name, phone")
          .eq("tenant_id", tenant.id)
          .in("id", ids.slice(i, i + 500));
        for (const c of ((data as { id: string; name: string; phone: string | null }[] | null) ?? [])) {
          nomes.set(c.id, c.name);
          telefones.set(c.id, c.phone);
        }
      }
    }

    // ⚠ O motivo da FILA vem do executor, não do veredito. O veredito também
    // tem um campo `motivo`, mas ele é o TEXTO da recusa — mesmo nome, camada
    // diferente. Ler o errado aqui mostraria "Fica para amanhã" onde deveria
    // aparecer "Ex-aluno — trazer de volta".
    const modelos = lerModelos(r.settings);

    const linhas: LinhaDaSimulacao[] = r.plano.vereditos.map((v) => {
      const nome = nomes.get(v.contactId) ?? "(contato sem nome)";
      const m = r.motivoPorContato[v.contactId];
      const pn = primeiroNome(nome);
      const toque = r.toquePorContato[v.contactId] ?? 1;
      const tel = paraE164BR(telefones.get(v.contactId));
      return {
        contactId: v.contactId,
        nome,
        motivo: ROTULO[m] ?? "",
        sai: v.enviar,
        motivoDaRecusa: v.enviar ? "" : v.motivo,
        recorte: v.enviar ? false : v.recorte === true,
        telefoneAjustado: tel.ok ? (tel.ajuste ?? "") : "",
        telefoneInvalido: tel.ok ? "" : tel.motivo,
        variaveis: [pn.ok ? pn.valor : "(sem nome — não sai)", tenant.name],
        // ⚠ O MODELO É DO TOQUE, não do motivo. Mostrar "o modelo da
        // reativação" numa linha de 2º toque foi exatamente o que escondeu a
        // repetição por uma semana: a tela concordava com o envio, e os dois
        // estavam errados juntos.
        toque,
        modelo:
          modeloDoToque(modelos, m, toque) ??
          `(nenhum modelo cadastrado para o ${toque}º toque — ele não sai)`,
      };
    });

    return {
      ok: true,
      ativo: r.plano.ativo,
      porque: r.plano.porque,
      linhas,
      sairiam: r.plano.enviar.length,
      avaliados: r.plano.vereditos.length,
      foraDaJanela: r.plano.foraDaJanela,
    };
  } catch (e) {
    // O erro sobe INTEIRO. Simulação que falha em silêncio é pior que não ter
    // simulação: quem aperta conclui que não há ninguém para falar.
    return { ok: false, erro: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * TIRA UMA PESSOA DE TODAS AS LISTAS DE CONTATO PROATIVO.
 *
 * ⚠ NASCEU DA PRIMEIRA SIMULAÇÃO REAL. O fundador leu os nove nomes e três
 * não eram ex-alunos: **Gympass** e **Total Pass** são convênios, e a
 * **Cinara** aluga uma sala. Os três estão na base porque PAGAM a academia —
 * e mandar "você já treinou com a gente e acabou parando" para o financeiro de
 * um convênio é erro que não quebra tela nenhuma: chega em quem paga, no nome
 * da academia.
 *
 * O motivo é OBRIGATÓRIO e não é burocracia: marcação sem justificativa é a
 * que ninguém tem coragem de desfazer seis meses depois, quando já não lembra
 * por que aquela pessoa está de fora.
 *
 * Vale para a fila do vendedor E para o motor, porque os dois leem a MESMA
 * carga (`lib/fila-db.ts`). Se o filtro morasse só na tela, o motor seguiria
 * mandando — e é justamente quando ninguém está olhando.
 */
export async function naoContatar(
  contactId: string,
  motivo: string,
): Promise<{ ok: true } | { ok: false; erro: string }> {
  const membership = await getActiveTenant();
  const tenant = membership?.tenant;
  if (!tenant) return { ok: false, erro: "Sem empresa vinculada." };
  if (!contactId) return { ok: false, erro: "Contato não informado." };

  const razao = motivo.trim();
  if (!razao) return { ok: false, erro: "Diga por que ele não deve receber." };

  const supabase = await createClient();
  // `.select()` porque escrita sem erro conferido é escrita que você ACHA que
  // fez — e esta decide se alguém recebe mensagem ou não.
  //
  // paginacao-ok: UPDATE de UMA linha, endereçada por chave primária. O
  // `.select("id")` devolve no máximo um registro — existe para conferir que a
  // gravação alcançou alguém, não para listar. (A trava sinalizou aqui porque
  // `update().select()` de fato devolve linhas; o motivo de ele ser seguro é
  // o `.eq("id", …)`, e por isso está escrito.)
  const { data, error } = await supabase
    .from("contacts")
    .update({ do_not_contact: true, do_not_contact_reason: razao })
    .eq("id", contactId)
    .eq("tenant_id", tenant.id)
    .select("id");

  if (error) return { ok: false, erro: error.message };
  if (!data || data.length === 0) return { ok: false, erro: "Contato não encontrado nesta empresa." };

  revalidatePath("/painel/automacao");
  revalidatePath("/painel/fila");
  revalidatePath(`/painel/contatos/${contactId}`);
  return { ok: true };
}
