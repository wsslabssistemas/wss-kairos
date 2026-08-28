"use server";

import { createClient } from "@/lib/supabase/server";
import { tipoDaLinha, type RegrasDePlano } from "@/lib/planos";
import { getActiveTenant } from "@/lib/auth";
import { getSkillFormConfig } from "@/lib/skill";
import { lerTudo } from "@/lib/paginado";
import { mapLimit } from "@/lib/concorrencia";
import type { Leitura, LeituraRecebimentos, Pagante } from "@/lib/planilha";
import { comparar, type EstadoConhecido, type LinhaDaFonte } from "@/lib/sincronizacao";
import { revalidatePath } from "next/cache";

/**
 * SINCRONIZAR COM O SISTEMA DA ACADEMIA — prever e aplicar, nessa ordem.
 *
 * ⚠ SÃO DUAS AÇÕES SEPARADAS DE PROPÓSITO, e a separação é a segurança.
 *
 * `prever` não escreve NADA. Ela compara o que veio da planilha com o banco e
 * devolve o que ACONTECERIA. Só depois de a pessoa ver a lista é que `aplicar`
 * grava.
 *
 * Sem isso, uma exportação com filtro aplicado daria baixa em massa em gente
 * que continua pagando — e o histórico do repositório mostra que essa classe
 * de defeito não aparece como erro: o `seed-curso.mjs` derrubou oito módulos
 * ao lado **saindo com três ✓ verdes**. *Relatório que só mostra o que a
 * operação escreveu não enxerga o que ela derrubou.*
 *
 * ⚠ QUEM LÊ O ARQUIVO É O NAVEGADOR — e isso mudou em 14/ago/2026, depois de
 * o fundador confirmar o sintoma: o arquivo de matrículas (86 KB) importava e
 * o de recebimentos (4,2 MB) não.
 *
 * A versão anterior mandava o TEXTO INTEIRO do arquivo para cá. O corpo de uma
 * requisição para função serverless na Vercel tem teto de plataforma (~4,5 MB)
 * que **o `serverActions.bodySizeLimit` do Next não move** — ele é o limite de
 * cima, não o de baixo. Subir aquele número para 12 MB não resolveu nada, e
 * não resolveria: quem recusava era a camada abaixo, e recusava sem chegar
 * mensagem nenhuma à tela. A classe de sempre: falha que se apresenta como
 * silêncio.
 *
 * A correção não é um número maior, é **não mandar o arquivo**. O leitor
 * (`lib/planilha.ts`) não tem rede nem banco de propósito, então roda igual no
 * navegador; o que sobe é o RESULTADO da leitura, que para os 1.548 pagantes
 * da Be Fitness dá algo em torno de 200 KB em vez de 4,2 MB. Some o teto, some
 * o parse duplicado (`aplicar` refaz a previsão) e some a possibilidade de o
 * mesmo defeito voltar quando a base dobrar.
 *
 * ⚠ E O QUE NÃO MUDOU, QUE É O QUE IMPORTA: **a trava continua no servidor.**
 * `aplicar` refaz a comparação contra o banco e recusa se houver bloqueio. O
 * que o navegador manda é a leitura de um arquivo que o próprio administrador
 * escolheu — ele já podia editar o arquivo antes de subir, então não ganhou
 * poder nenhum aqui. O que ele nunca decide é o que o BANCO diz, e é o
 * confronto entre os dois que autoriza a gravação.
 */

/** O que o navegador leu e mandou. Só o necessário — a lista de linhas
 *  ignoradas fica lá, porque aqui só o NÚMERO dela é usado. */
export type DadosLidos = {
  matriculas: {
    linhas: LinhaDaFonte[];
    entendeu: Leitura["entendeu"];
    ignoradas: number;
  } | null;
  recebimentos: {
    pagantes: Pagante[];
    entendeu: LeituraRecebimentos["entendeu"];
    descartadas: string[];
    ignoradas: number;
  } | null;
};

export type Previsao = {
  ok: boolean;
  erro?: string;
  bloqueio?: string | null;
  /**
   * O bloqueio veio de uma fonte SEM NENHUMA LINHA.
   *
   * ⚠ Este caso não tem saída, e é de propósito: nenhuma confirmação torna
   * razoável dar baixa em todo mundo a partir de um arquivo vazio. Isso é
   * sempre exportação quebrada, nunca a realidade. A tela usa isto para NÃO
   * oferecer a caixa de "conferi a exportação".
   */
  fonteVazia?: boolean;
  entendeu?: { matriculas?: string; recebimentos?: string };
  resumo?: { entraram: number; renovaram: number; ajustaram: number; encerraram: number; reapareceram: number; recuaram: number };
  eventos?: { chave: string; tipo: string; descricao: string }[];
  pagantes?: { total: number; comHabito: number; descartadas: string[] };
  /**
   * O que a aplicação vai fazer ALÉM de gravar campo — hoje, mover de etapa.
   *
   * A tela de dois passos existe para ninguém ser surpreendido pelo que a
   * gravação faz. Mudar a etapa de dezenas de pessoas é a mudança mais visível
   * que esta operação provoca (some da carteira em aberto, entra na régua de
   * reativação), então ela precisa estar escrita ANTES do botão.
   */
  aviso?: string;
};

async function contexto() {
  const m = await getActiveTenant();
  if (!m?.tenant || (m.role !== "owner" && m.role !== "admin")) return null;
  return m;
}

/**
 * O payload vem do navegador, então ele é conferido antes de virar decisão.
 *
 * Não é desconfiança do administrador — é que dado malformado aqui vira
 * `undefined` no meio da comparação, e a comparação decide quem leva baixa.
 * Recusar cedo, com o motivo escrito, é melhor que gravar sobre um `NaN`.
 */
function dadosInvalidos(d: DadosLidos | null | undefined): string | null {
  if (!d || typeof d !== "object") return "Não recebi a leitura dos arquivos. Escolha os arquivos e tente de novo.";
  if (d.matriculas && !Array.isArray(d.matriculas.linhas)) return "A leitura das matrículas veio malformada.";
  if (d.recebimentos && !Array.isArray(d.recebimentos.pagantes)) return "A leitura dos recebimentos veio malformada.";
  if (!d.matriculas && !d.recebimentos) return "Nenhum arquivo foi lido.";
  return null;
}

/** O que o banco sabe hoje, na forma que a comparação espera. */
async function estadoConhecido(tenantId: string): Promise<EstadoConhecido[]> {
  const supabase = await createClient();
  // PAGINADO: o PostgREST corta em 1.000 linhas sem avisar, e aqui o corte
  // seria catastrófico — quem ficasse de fora apareceria como "sumiu da
  // fonte" e levaria baixa. Silêncio que vira gravação é o pior caso.
  //
  // ⚠ `journey_stage` vem junto desde 28/ago: sem ele a trava contava ex-aluno
  // como contrato ativo e uma planilha CORRETA disparava "80% sumiram".
  const linhas = await lerTudo<{ name: string; custom: Record<string, unknown> | null; contract_end: string | null; journey_stage: string | null }>(
    (de, ate) =>
      supabase
        .from("contacts")
        .select("name, custom, contract_end, journey_stage")
        .eq("tenant_id", tenantId)
        .is("deleted_at", null)
        .order("id")
        .range(de, ate),
    { rotulo: "contatos para sincronizar" },
  );
  return linhas
    .filter((c) => c.custom?.["codigo_sistema"])
    .map((c) => ({
      chave: String(c.custom!["codigo_sistema"]),
      nome: c.name,
      vigencia_ate: c.contract_end ? String(c.contract_end).slice(0, 10) : null,
      encerrado: c.custom?.["contrato_encerrado_em"] ? true : false,
      etapa: c.journey_stage,
    }));
}

export async function prever(
  d: DadosLidos,
  /**
   * A pessoa conferiu a exportação e assume a baixa em massa.
   *
   * ⚠ Ela vem do CLIENTE, e por isso `aplicar` refaz tudo no servidor: a
   * confirmação autoriza passar do limite, nunca dispensa a comparação. É a
   * mesma razão de a previsão ser recalculada — a trava tem que valer no
   * servidor, não no browser.
   */
  confirmado = false,
): Promise<Previsao> {
  const m = await contexto();
  if (!m) return { ok: false, erro: "Só dono ou administrador pode sincronizar." };

  const invalido = dadosInvalidos(d);
  if (invalido) return { ok: false, erro: invalido };

  const entendeu: { matriculas?: string; recebimentos?: string } = {};
  let resumo: Previsao["resumo"];
  let eventos: Previsao["eventos"] = [];
  let bloqueio: string | null = null;
  let fonteVazia = false;

  if (d.matriculas) {
    const mat = d.matriculas;
    entendeu.matriculas =
      `chave "${mat.entendeu.chave}", vencimento "${mat.entendeu.vigencia}" · ` +
      `${mat.entendeu.lidas} linhas → ${mat.linhas.length} pessoas` +
      (mat.ignoradas ? ` (${mat.ignoradas} linhas colapsadas ou ignoradas)` : "");

    // ⚠ A CLASSIFICAÇÃO ACONTECE AQUI, e não no leitor da planilha.
    //
    // `lib/planilha.ts` roda no NAVEGADOR (é o que evita mandar 4,2 MB para o
    // servidor) e não pode conhecer o manifesto do segmento. E o núcleo não
    // pode conhecer "Treino Avulso" — isso é vocabulário de academia, Lei 1.
    //
    // Então o leitor traz o NOME cru do plano e quem interpreta é este ponto,
    // com a lista que o segmento declara. Um segmento novo classifica sozinho
    // ao declarar `contract.planos`, sem tocar em código.
    const cfg = await getSkillFormConfig(m.tenant!.skill_key);
    const regrasDePlano = (cfg.contract as { planos?: RegrasDePlano } | null)?.planos ?? null;
    const linhasClassificadas = mat.linhas.map((l) => ({
      ...l,
      tipo: tipoDaLinha(l.plano, regrasDePlano),
    }));

    // ⚠ A ETAPA ATIVA VEM DO MANIFESTO, e é ela que faz a trava medir "contrato
    // de pé" em vez de "tem cadastro". Sem ela, ex-aluno importado há meses
    // entrava no denominador e uma planilha correta disparava "80% sumiram".
    const etapaAtiva = (cfg.contract as { active_stage?: string } | null)?.active_stage ?? null;
    const cmp = comparar(
      linhasClassificadas,
      await estadoConhecido(m.tenant!.id),
      undefined,
      confirmado,
      etapaAtiva,
    );
    bloqueio = cmp.bloqueio;
    fonteVazia = mat.linhas.length === 0;
    resumo = {
      entraram: cmp.resumo.entraram, renovaram: cmp.resumo.renovaram,
      ajustaram: cmp.resumo.ajustaram, encerraram: cmp.resumo.encerraram,
      reapareceram: cmp.resumo.reapareceram,
      recuaram: cmp.eventos.filter((e) => e.tipo === "vigencia_recuou").length,
    };
    // "sem_mudanca" fica de fora da lista: são centenas de linhas que não
    // dizem nada e afogariam as poucas que dizem.
    eventos = cmp.eventos.filter((e) => e.tipo !== "sem_mudanca").map((e) => ({ chave: e.chave, tipo: e.tipo, descricao: e.descricao }));
  }

  let pagantes: Previsao["pagantes"];
  if (d.recebimentos) {
    const rec = d.recebimentos;
    entendeu.recebimentos =
      `chave "${rec.entendeu.chave}", pagamento "${rec.entendeu.pagamento}" · ` +
      `${rec.entendeu.lidas} linhas → ${rec.pagantes.length} pagantes` +
      (rec.ignoradas ? ` (${rec.ignoradas} linhas ignoradas)` : "");
    pagantes = {
      total: rec.pagantes.length,
      comHabito: rec.pagantes.filter((p) => p.atrasoHabitualDias !== null).length,
      descartadas: rec.descartadas,
    };
  }

  // O aviso do que muda além dos campos. Sai do manifesto: o núcleo não sabe
  // como este ramo chama a etapa de quem saiu.
  let aviso: string | undefined;
  const encerraram = resumo?.encerraram ?? 0;
  if (encerraram > 0) {
    const { stages, contract } = await getSkillFormConfig(m.tenant!.skill_key);
    const saida = contract?.ended_stage
      ? stages.find((s) => s.key === contract.ended_stage)
      : undefined;
    aviso = saida
      ? `${encerraram} ${encerraram === 1 ? "pessoa vai sair" : "pessoas vão sair"} da etapa atual e ${encerraram === 1 ? "passar" : "passar"} para "${saida.label}". Elas saem da carteira em aberto e entram na régua de reativação — a conversa muda de renovação para retorno.`
      : `${encerraram} ${encerraram === 1 ? "pessoa será marcada" : "pessoas serão marcadas"} como encerradas. A etapa delas NÃO muda: este ramo não declara para onde vai quem sai.`;
  }

  return { ok: true, bloqueio, fonteVazia, entendeu, resumo, eventos, pagantes, aviso };
}

/** Quantas gravações vão em paralelo. Ver `lib/concorrencia.ts`. */
const EM_PARALELO = 8;

/** O contato do lado do banco, na forma mínima que a aplicação precisa. */
type Alvo = { id: string; custom: Record<string, unknown> | null; journey_stage: string };

export async function aplicar(
  d: DadosLidos,
  /** A pessoa marcou "conferi a exportação" na tela. */
  confirmado = false,
): Promise<{ ok: boolean; erro?: string; gravados?: number; falhas?: number }> {
  const m = await contexto();
  if (!m) return { ok: false, erro: "Só dono ou administrador pode sincronizar." };

  // ⚠ A PREVISÃO É REFEITA AQUI, e não é desperdício.
  //
  // O cliente poderia mandar "aplicar" com uma leitura diferente da que foi
  // previsto — por troca de aba, por clique duplo, ou por má-fé. Confiar na
  // previsão que o browser diz ter visto seria confiar no browser para decidir
  // uma gravação em massa. A trava tem que valer no servidor.
  const p = await prever(d, confirmado);
  if (!p.ok) return { ok: false, erro: p.erro };
  if (p.bloqueio) return { ok: false, erro: p.bloqueio };

  const supabase = await createClient();
  const hoje = new Date().toISOString().slice(0, 10);

  // ⚠ CONTA PESSOAS DISTINTAS, NUNCA EVENTOS. Quem aparece nos dois arquivos
  // levava dois UPDATEs e era contado duas vezes — a tela diria "1.800
  // contatos atualizados" numa base de 1.548. É a mesma lei que o `CLAUDE.md`
  // fixa para as métricas do produto, e ela vale para o recibo de uma
  // gravação também.
  const tocados = new Set<string>();
  const falhas: string[] = [];

  /** Um UPDATE endereçado por id, com o erro guardado em vez de engolido. */
  const gravar = async (id: string, patch: Record<string, unknown>) => {
    // paginacao-ok: UPDATE de uma linha, endereçado por id.
    const { error } = await supabase
      .from("contacts")
      .update(patch)
      .eq("id", id)
      .eq("tenant_id", m.tenant!.id);
    if (error) falhas.push(error.message);
    else tocados.add(id);
  };

  // A etapa de quem saiu vem do manifesto do ramo, nunca do núcleo (Lei 1).
  const { contract } = await getSkillFormConfig(m.tenant!.skill_key);
  const ended_stage = contract?.ended_stage ?? null;
  const active_stage = contract?.active_stage ?? null;

  /** Contatos desta empresa indexados pelo código do sistema da academia. */
  const porCodigo = async () => {
    // ⚠ PAGINADO. Esta leitura decide quem recebe UPDATE. Cortada em 1.000
    // linhas arbitrárias, parte da base ficaria sem sincronizar — e o que não
    // foi atualizado não aparece em lugar nenhum para alguém desconfiar.
    const atuais = await lerTudo<Alvo>(
      (de, ate) => supabase
        .from("contacts").select("id, custom, journey_stage")
        .eq("tenant_id", m.tenant!.id).is("deleted_at", null).order("id").range(de, ate),
      { rotulo: "contatos para atualizar" },
    );
    return new Map(
      atuais
        .filter((c) => c.custom?.["codigo_sistema"])
        .map((c) => [String(c.custom!["codigo_sistema"]), c]),
    );
  };

  // Uma leitura só serve aos dois arquivos — eram duas varreduras completas da
  // mesma tabela quando os dois vinham juntos.
  const indice = await porCodigo();

  if (d.matriculas) {
    const alvos = d.matriculas.linhas
      .map((l) => ({ l, alvo: indice.get(l.chave) }))
      .filter((x): x is { l: LinhaDaFonte; alvo: Alvo } => !!x.alvo);
    // criar contato novo é outro fluxo (importador) — por isso o filtro acima.

    await mapLimit(alvos, EM_PARALELO, async ({ l, alvo }) => {
      const custom = { ...(alvo.custom ?? {}), contrato_conferido_em: hoje };
      // Quem voltou perde a marca de encerrado — senão ficaria fora da fila
      // para sempre, que é o oposto do que a marca existe para fazer.
      delete (custom as Record<string, unknown>)["contrato_encerrado_em"];
      // ⚠ LINHA SEM DATA LEGÍVEL NÃO APAGA A DATA QUE EXISTE. A pessoa está
      // presente na planilha — quem sai de verdade some dela e vira
      // "encerrou". Data em branco numa linha presente é quase sempre formato
      // que o leitor não entendeu, e gravar `null` por causa disso destruiria
      // a vigência real em silêncio. Mesma regra do `paraE164BR`: falhar não
      // pode virar corromper.
      const patch: Record<string, unknown> = { custom };
      if (l.vigencia_ate) patch.contract_end = l.vigencia_ate;
      await gravar(alvo.id, patch);
    });

    // O ENCERRAMENTO É O QUE A PLANILHA NÃO SABE CONTAR — ver `sincronizacao.ts`.
    //
    // ⚠ E ELE AGORA MOVE A PESSOA DE ETAPA, o que antes não acontecia.
    //
    // A marca `contrato_encerrado_em` existia e **nada a lia**: o comentário ao
    // lado dela dizia que ela servia para tirar a pessoa da fila, e não havia
    // uma linha de código fazendo isso. O efeito é o defeito medido na Be
    // Fitness — 312 pessoas em "Matriculado", das quais boa parte já saiu,
    // porque `convertido` nunca era revogado. **Etapa que só avança mente com
    // o tempo**, e ninguém procura erro numa etapa que já foi verdade.
    //
    // A chave da etapa vem do MANIFESTO (`contract.ended_stage`), nunca daqui:
    // "ex_aluno" é vocabulário de academia. Sem ela declarada, o encerramento
    // continua sendo carimbado e a etapa fica como está — o comportamento
    // seguro, porque mover gente de etapa por engano é pior que não mover.
    const etapaDeSaida = ended_stage;
    const encerrados = (p.eventos ?? [])
      .filter((x) => x.tipo === "encerrou")
      .map((e) => indice.get(e.chave))
      .filter((a): a is Alvo => !!a);

    await mapLimit(encerrados, EM_PARALELO, async (alvo) => {
      const patch: Record<string, unknown> = {
        custom: { ...(alvo.custom ?? {}), contrato_encerrado_em: hoje, contrato_conferido_em: hoje },
      };
      // Só mexe na etapa se o manifesto disser qual é, e só se a pessoa ainda
      // não estiver lá — remover e reinserir na mesma etapa reiniciaria a
      // régua de reativação dela do zero a cada importação semanal.
      //
      // ⚠ E SÓ SAI DA ETAPA QUEM ESTÁ NELA. Ausência da planilha de matrículas
      // diz que o contrato acabou — não diz nada sobre quem já estava fora.
      // Sem esta condição, 131 pessoas em `perdido`, `recusou` e
      // `experimentacao` virariam `ex_aluno` **com a data de hoje**, entrando
      // na régua de reativação como saída recente, que é a faixa de maior
      // resposta e a mais cara de queimar.
      //
      // ⚠ E TRÊS DELAS TINHAM DITO NÃO. Transformar `recusou` em candidato a
      // reativação contraria a regra de que a decisão é do cliente: depois do
      // não, pergunta-se o motivo, não se recomeça a oferta.
      //
      // `active_stage` ausente mantém o comportamento antigo — manifesto que
      // não declara não pode afrouxar a regra por omissão.
      const naEtapaAtiva = !active_stage || alvo.journey_stage === active_stage;
      if (etapaDeSaida && naEtapaAtiva && alvo.journey_stage !== etapaDeSaida) {
        patch.journey_stage = etapaDeSaida;
        patch.stage_entered_at = new Date().toISOString();
      }
      await gravar(alvo.id, patch);

      // O histórico da jornada é append-only e é o que permite responder
      // "quando ele saiu?" depois. Falha aqui não derruba a sincronização: o
      // fato principal já foi gravado.
      if (patch.journey_stage) {
        const { error } = await supabase.from("contact_stage_history").insert({
          tenant_id: m.tenant!.id,
          contact_id: alvo.id,
          from_stage: alvo.journey_stage,
          to_stage: etapaDeSaida,
          reason: "Sumiu da planilha de matrículas — contrato encerrado.",
          triggered_by: "system",
        });
        if (error) console.error(`[sincronizar] historico de etapa de ${alvo.id}: ${error.message}`);
      }
    });
  }

  if (d.recebimentos) {
    const pagantes = d.recebimentos.pagantes
      .map((pg) => ({ pg, alvo: indice.get(pg.chave) }))
      .filter((x): x is { pg: Pagante; alvo: Alvo } => !!x.alvo);

    await mapLimit(pagantes, EM_PARALELO, ({ pg, alvo }) =>
      gravar(alvo.id, {
        custom: {
          ...(alvo.custom ?? {}),
          // CPF e endereço NÃO estão aqui, e é decisão: ver `DESCARTADAS`.
          pagamentos: pg.pagamentos,
          total_pago_cents: pg.totalCents,
          ultimo_pagamento: pg.ultimoPagamento,
          atraso_habitual_dias: pg.atrasoHabitualDias,
          recebimentos_conferidos_em: hoje,
        },
      }),
    );
  }

  revalidatePath("/painel");
  revalidatePath("/painel/fila");

  const gravados = tocados.size;

  // ⚠ GRAVAR ZERO NÃO É SUCESSO. A versão anterior devolvia `ok: true` com
  // `gravados: 0` e a tela dizia "0 contatos atualizados" — indistinguível de
  // sucesso para quem lê rápido, e foi assim que "não está salvando" ficou sem
  // explicação. Se nada casou, o motivo quase sempre é a chave: o código da
  // planilha não bate com `custom.codigo_sistema` de ninguém.
  if (gravados === 0) {
    return {
      ok: false,
      falhas: falhas.length,
      erro: falhas.length
        ? `Nenhum contato foi atualizado e o banco recusou ${falhas.length} gravação(ões). Primeiro motivo: ${falhas[0]}`
        : "Li os arquivos e comparei, mas NENHUM contato foi atualizado. " +
          "Isso quase sempre significa que o código da planilha não casa com o " +
          "código guardado nos contatos (`codigo_sistema`) — a sincronização só " +
          "atualiza quem já existe aqui. Confira um código da planilha na ficha " +
          "de um contato antes de tentar de novo.",
    };
  }

  // ⚠ FALHA PARCIAL TAMBÉM PRECISA APARECER. A versão anterior contava só o
  // que deu certo (`if (!error) gravados++`) e o erro sumia: 1.500 gravados
  // com 48 recusados era relatado como 1.500 gravados, e ninguém procura o que
  // o sistema não disse que perdeu.
  return { ok: true, gravados, falhas: falhas.length };
}
