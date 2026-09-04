import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { credencialDoCanal, credencialDoDirect } from "@/lib/credenciais";
import { enviarPelaCloudAPI, enviarPeloDirect } from "@/lib/envio";
import { janelaDeAtendimento } from "@/lib/whatsapp-webhook";
import { paraE164BR } from "@/lib/phone";
import { registrarEnvio, gastoDeMensagensNoMes } from "@/lib/custo_mensagem-db";
import { avaliarTetoDeMensagens, lerTetoDeMensagens } from "@/lib/custo_mensagem";
import { gerarResposta } from "@/app/painel/responder/ai-actions";
import { decidirResposta, aindaEhAVez, lerRespostaAutomatica } from "@/lib/fase2";
import { fechaAConversa } from "@/lib/fecho";
import { marcarCompromisso } from "@/app/painel/agenda/horarios-actions";
import { registrarCombinado } from "@/app/painel/conversas/actions";
import { ajustarRetorno } from "@/lib/retorno";

// A FASE 2 EXECUTADA — a IA responde sozinha quem escreveu.
//
// ⚠ ONDE ISTO RODA, E POR QUE NÃO NO CRON.
//
// O agendador bate de 15 em 15 minutos, e responder 15 minutos depois não é
// responder: quem escreve às 2h da manhã está no momento de intenção, e a
// automação existe justamente para pegar essa janela. Então isto roda a partir
// do WEBHOOK, com `after()` — a Meta recebe o 200 na hora (ela DESATIVA a
// assinatura de quem demora) e o trabalho continua depois da resposta.
//
// ⚠ E A PAUSA DE 20–40s ACONTECE DENTRO DESSA CONTINUAÇÃO. É de propósito, e
// é o desenho mais simples que funciona: fila com estado precisaria de tabela,
// worker e um segundo relógio — três peças novas para segurar trinta segundos.
// O custo é tempo de função, que nesse volume é irrelevante.
//
// ⚠ O QUE ESTA PEÇA NUNCA FAZ: ela não INICIA conversa. Só responde quem
// acabou de escrever, dentro da janela de 24h. Por isso não tem janela de
// horário — a regra de 9h–19h existe em `lib/motor.ts` e governa quem começa
// conversa, nunca quem responde.

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Responde sozinho a UMA mensagem que acabou de chegar.
 *
 * Nunca estoura: toda saída vira linha em `respostas_automaticas`, inclusive a
 * falha. Peça que roda sozinha e falha em silêncio é a assinatura de defeito
 * mais cara desta casa — e aqui o silêncio tem uma pessoa do outro lado
 * esperando resposta.
 */
export async function responderSozinho(entrada: {
  tenantId: string;
  contactId: string;
  /** `occurred_at` da mensagem que disparou — o desempate da pausa. */
  mensagemISO: string;
  /** O texto que chegou. */
  texto: string;
  /** `customer_message` ou `customer_reaction`. */
  tipoDaMensagem: string;
  /**
   * POR ONDE a conversa chegou — e por onde a resposta tem que sair.
   *
   * ⚠ Instagram e Messenger valem MAIS aqui que o WhatsApp, e o fundador
   * nomeou por quê: *"normalmente recebemos mensagens através desses canais em
   * horários que a academia já está fechada"*. São os canais da madrugada e do
   * domingo — as horas em que não há ninguém para responder.
   */
  canal: "whatsapp" | "instagram" | "facebook";
  /** Injetável no teste. Em produção fica o sorteio de verdade. */
  sorteio?: number;
}): Promise<void> {
  const admin = createAdminClient();
  const { tenantId, contactId } = entrada;

  const registrar = async (
    decisao: "respondeu" | "escalou" | "agendar" | "desistiu" | "recusou" | "falhou",
    porque: string,
    extra: { esperouMs?: number; interactionId?: string } = {},
  ) => {
    const { error } = await admin.from("respostas_automaticas").insert({
      tenant_id: tenantId,
      contact_id: contactId,
      decisao,
      porque,
      esperou_ms: extra.esperouMs ?? null,
      interaction_id: extra.interactionId ?? null,
    });
    // ⚠ O REGISTRO QUE FALHA VAI PARA O LOG, e não sobe. A mensagem pode já
    // ter saído; derrubar aqui não a desfaz, só apagaria o rastro dela.
    if (error) {
      console.error(`[fase2] registro nao gravado (${decisao}) para ${contactId}: ${error.message}`);
    }
  };

  try {
    const [{ data: t }, { data: c }] = await Promise.all([
      admin.from("tenants").select("settings, skill_key").eq("id", tenantId).maybeSingle(),
      // paginacao-ok: uma linha, endereçada pela chave primária do contato.
      admin
        .from("contacts")
        // As três chaves da mesma pessoa: telefone, IGSID e PSID. Ela tem um id
        // diferente em cada plataforma, e responder pelo id do outro canal
        // manda a mensagem para outra pessoa.
        .select("phone, instagram_id, facebook_id, do_not_contact, atendimento_encerrado_em")
        .eq("id", contactId)
        .eq("tenant_id", tenantId)
        .maybeSingle(),
    ]);

    const tenant = t as { settings: unknown; skill_key: string } | null;
    const contato = c as {
      phone: string | null;
      instagram_id: string | null;
      facebook_id: string | null;
      do_not_contact: boolean;
      atendimento_encerrado_em: string | null;
    } | null;

    if (!tenant || !contato) {
      await registrar("falhou", "Empresa ou contato não encontrado ao responder sozinho.");
      return;
    }

    // ⚠ A JANELA VEM DA MENSAGEM QUE DISPAROU, não de uma consulta nova. Ela
    // acabou de chegar: perguntar de novo ao banco só abriria espaço para a
    // resposta de uma corrida entre o insert do webhook e esta leitura.
    const janela = janelaDeAtendimento(entrada.mensagemISO);

    // ⚠ A NOSSA ÚLTIMA MENSAGEM ANTES DESTA — é ela que decide se um "ok" é
    // despedida ou é um SIM. Ver `fechaAConversa`: se nós perguntamos algo, a
    // resposta curta é aceitação, e fechar ali perderia o momento inteiro.
    //
    // paginacao-ok: uma linha, a mais recente, endereçada por índice.
    // paginacao-ok: uma linha, a mais recente, endereçada por índice.
    const { data: nossaUltima } = await admin
      .from("interactions")
      .select("content")
      .eq("tenant_id", tenantId)
      .eq("contact_id", contactId)
      .eq("direction", "outbound")
      .lt("occurred_at", entrada.mensagemISO)
      .order("occurred_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const fim = fechaAConversa({
      texto: entrada.texto,
      nossaUltimaMensagem: (nossaUltima as { content: string | null } | null)?.content ?? null,
    });

    const decisao = decidirResposta({
      ligado: lerRespostaAutomatica(tenant.settings),
      tipoDaMensagem: entrada.tipoDaMensagem,
      texto: entrada.texto,
      descadastrado: !!contato.do_not_contact,
      janelaAberta: janela.aberta,
      // Encerrado ANTES desta mensagem não vale: quem escreve de novo reabre a
      // conversa na hora. A comparação é com a data, nunca com um interruptor.
      encerrada:
        !!contato.atendimento_encerrado_em &&
        Date.parse(contato.atendimento_encerrado_em) > Date.parse(entrada.mensagemISO),
      despedida: fim.fecha,
      sorteio: entrada.sorteio,
    });

    if (!decisao.responder) {
      // ⚠ "DESLIGADO" NÃO VIRA LINHA. Com a fase 2 desligada, TODA mensagem
      // que chega geraria um registro de recusa — a tabela de decisões
      // pendentes viraria um log de nada, e a fila que importa (`escalou`)
      // ficaria enterrada. Silêncio aqui é o estado normal do produto.
      if (decisao.porque.startsWith("A resposta automática está desligada")) return;

      // ⚠ DESPEDIDA NÃO É SÓ "NÃO RESPONDER": É ENCERRAR O ATENDIMENTO.
      //
      // Sem isto, a conversa fica para sempre em "aguardando resposta" — a
      // pessoa se despediu e a lista de quem espera nunca encolhe, que é o
      // defeito do `combinado` de novo, agora na tela que mede o atendimento.
      //
      // ⚠ E É REVERSÍVEL SOZINHO: a comparação em toda a casa é com a DATA, não
      // com um interruptor. Se ela escrever de novo amanhã, a conversa reabre
      // na hora, porque a mensagem nova é posterior ao encerramento.
      if (fim.fecha) {
        // paginacao-ok: UPDATE de UMA linha, endereçada por chave primária.
        const { error: erroFecho } = await admin
          .from("contacts")
          .update({ atendimento_encerrado_em: new Date().toISOString() })
          .eq("id", contactId)
          .eq("tenant_id", tenantId)
          .select("id");
        if (erroFecho) {
          console.error(`[fase2] nao consegui encerrar o atendimento de ${contactId}: ${erroFecho.message}`);
        }
      }

      await registrar(decisao.decisao, decisao.porque);
      return;
    }

    // ---------------------------------------------- A PAUSA
    await esperar(decisao.esperarMs);

    // ⚠ E DEPOIS DELA, CONFERIR DE NOVO. Trinta segundos é tempo de a recepção
    // responder e de a pessoa mandar mais duas mensagens. Ver `aindaEhAVez`.
    const [{ data: ultEntrada }, { data: ultSaida }] = await Promise.all([
      admin
        .from("interactions")
        .select("occurred_at")
        .eq("tenant_id", tenantId)
        .eq("contact_id", contactId)
        .eq("direction", "inbound")
        .order("occurred_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      admin
        .from("interactions")
        .select("occurred_at")
        .eq("tenant_id", tenantId)
        .eq("contact_id", contactId)
        .eq("direction", "outbound")
        .order("occurred_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

    const vez = aindaEhAVez({
      mensagemDaRodadaISO: entrada.mensagemISO,
      ultimaEntradaISO: (ultEntrada as { occurred_at: string } | null)?.occurred_at ?? null,
      ultimaSaidaISO: (ultSaida as { occurred_at: string } | null)?.occurred_at ?? null,
    });
    if (!vez.segue) {
      await registrar("desistiu", vez.porque, { esperouMs: decisao.esperarMs });
      return;
    }

    // ---------------------------------------------- O FREIO DE CUSTO
    // Antes da chamada, nunca depois: verificar depois é medir o prejuízo. E
    // este teto governa o dinheiro que sai pela Meta, que é bolso diferente do
    // teto de IA (lá o freio é parar de gerar, e o manual custa zero).
    //
    // ⚠ SÓ VALE PARA O WHATSAPP. A Meta não cobra direct — freá-lo por um teto
    // de dinheiro que ele não gasta seria calar o canal da madrugada por causa
    // da conta de outro canal.
    const teto = entrada.canal === "whatsapp" ? lerTetoDeMensagens(tenant.settings) : null;
    if (teto !== null) {
      const gasto = await gastoDeMensagensNoMes(tenantId);
      const veredito = avaliarTetoDeMensagens(gasto.gastoCents, teto);
      if (!veredito.ok) {
        // ⚠ ESCALA, NÃO RECUSA. Estourar o teto não é "não havia o que
        // responder": é uma pessoa esperando e o produto sem poder falar. Tem
        // que aparecer na fila de decisão pendente, como qualquer conversa
        // parada — senão o freio de custo vira um jeito silencioso de perder
        // cliente.
        await registrar("escalou", veredito.motivo, { esperouMs: decisao.esperarMs });
        return;
      }
    }

    // ---------------------------------------------- A GERAÇÃO
    const r = await gerarResposta({
      contactId,
      message: entrada.texto,
      // Sem sessão: quem lê é o admin. Ver a nota em `gerarResposta`.
      semSessao: { tenantId, skillKey: tenant.skill_key },
    });

    if (!r.ok) {
      const motivo = "limite" in r ? r.mensagem : r.error;
      await registrar("escalou", `Não consegui gerar a resposta: ${motivo}`, {
        esperouMs: decisao.esperarMs,
      });
      return;
    }

    const texto = (r.data.resposta_sugerida ?? "").trim();
    const faltam = r.data.faltam_fatos ?? [];
    // ⚠ O HORÁRIO QUE ELA ACEITOU — e ele NÃO vai sozinho para a agenda.
    // Quem confirma compromisso é gente: gravar a partir da leitura do modelo
    // criaria compromisso que ninguém combinou. Mas ignorar também não dá — a
    // IA acabou de escrever "quinta às 10h está certo". Ver a migration 0081.
    const horarioAceito = (r.data.horario_escolhido ?? "").trim();
    // ⚠ A DATA EM QUE ELA DISSE QUE VOLTA — e ela vale tanto quanto o horário.
    // *"Retorno em outubro"* sem registro faz a pessoa sumir da fila e voltar
    // pela régua genérica, sem o pretexto que ela mesma deu. Foi a Nanci, em
    // ago/2026: avisou que voltava em setembro e nada ficou gravado.
    const retornoEm = /^\d{4}-\d{2}-\d{2}$/.test(r.data.retorno_em ?? "")
      ? ajustarRetorno(r.data.retorno_em, !!r.data.retorno_vago)
      : "";

    // ⚠ A TRAVA ANTI-INVENÇÃO MANDA CHAMAR GENTE, e é o caso mais importante
    // desta função. Ela devolve texto VAZIO junto de `escalar: true` — testar
    // a verdade da string aqui repetiria o defeito de 20/ago, em que a tela
    // ficava idêntica depois do clique.
    //
    // ⚠ E RECUSAR É O PRODUTO FUNCIONANDO. Do lado do cliente, porém, é uma
    // pessoa esperando resposta que não vem. Quando é o fundador quem clica,
    // ele vê a recusa na tela; sozinha, ela precisa CHAMAR alguém — e é para
    // isso que existe `decisao = 'escalou'` com `visto_em` nulo.
    if (r.data.escalar || !texto) {
      const oQueFalta = faltam.length > 0 ? ` Faltam: ${faltam.join(", ")}.` : "";
      await registrar(
        "escalou",
        `A trava anti-invenção recusou escrever sozinha.${oQueFalta} Alguém precisa responder esta conversa.`,
        { esperouMs: decisao.esperarMs },
      );
      return;
    }

    // ---------------------------------------------- O ENVIO
    //
    // ⚠ A RESPOSTA SAI POR ONDE A CONVERSA ESTÁ, como na tela. Derivar E.164
    // de uma ficha do Instagram — que não tem telefone — devolvia "telefone
    // inválido" para quem escreveu pelo direct: recusa certa pelo motivo
    // errado, e erro de diagnóstico é o que ensina a ignorar o aviso.
    let envio: { ok: true; id: string } | { ok: false; motivo: string };
    if (entrada.canal === "instagram" || entrada.canal === "facebook") {
      const direct = await credencialDoDirect(tenantId, entrada.canal);
      if (!direct) {
        await registrar(
          "falhou",
          `O canal do ${entrada.canal === "instagram" ? "Instagram" : "Facebook"} não está configurado nesta empresa.`,
          { esperouMs: decisao.esperarMs },
        );
        return;
      }
      const destinatario =
        entrada.canal === "instagram" ? contato.instagram_id : contato.facebook_id;
      envio = await enviarPeloDirect(entrada.canal, destinatario ?? "", texto, direct);
    } else {
      const num = paraE164BR(contato.phone);
      if (!num.ok) {
        await registrar("escalou", `Não consegui usar o telefone da ficha: ${num.motivo}`, {
          esperouMs: decisao.esperarMs,
        });
        return;
      }
      const credencial = await credencialDoCanal(tenantId);
      if (!credencial) {
        await registrar("falhou", "O canal oficial desta empresa não está configurado.", {
          esperouMs: decisao.esperarMs,
        });
        return;
      }
      envio = await enviarPelaCloudAPI(num.digitos, texto, credencial);
    }

    if (!envio.ok) {
      await registrar("falhou", `A Meta recusou o envio: ${envio.motivo}`, {
        esperouMs: decisao.esperarMs,
      });
      return;
    }

    const { data: gravada, error: erroGravar } = await admin
      .from("interactions")
      .insert({
        tenant_id: tenantId,
        contact_id: contactId,
        direction: "outbound",
        // É RESPOSTA A UMA PESSOA, não iniciativa do sistema — o mesmo
        // `input_kind` que a equipe grava ao responder à mão. É o que separa
        // tempo de resposta de toque proativo na Gestão, e é o que mantém o
        // teto diário da campanha fora disto.
        input_kind: "agent_briefing",
        // O canal REAL, nunca "whatsapp" fixo: a janela de 24h da resposta
        // seguinte é calculada em cima dele.
        channel: entrada.canal,
        external_id: envio.id,
        content: texto,
        occurred_at: new Date().toISOString(),
        // Sem autor: não pertence a vendedor nenhum, como o toque do motor.
        created_by: null,
        // ⚠ VALOR PRÓPRIO, NUNCA `aceita`. Foi `origem_ia` que autorizou a
        // fase 2 (69 casos, 82,6% aceitas sem edição); gravar isto como
        // "aceita" faria o número subir sozinho até 100%, porque ninguém edita
        // o que ninguém lê. O indicador viraria consequência da decisão que
        // ele justificou. Ver a migration `0079`.
        origem_ia: "automatica",
      })
      .select("id")
      .maybeSingle();

    if (erroGravar) {
      console.error(`[fase2] mensagem ${envio.id} SAIU mas nao registrou: ${erroGravar.message}`);
    }

    // ⚠ SÓ O WHATSAPP ENTRA NA CONTA. A Meta não cobra direct, e somar os três
    // faria o teto de mensagens frear a campanha por causa de conversa que não
    // custou nada — freio certo, motivo inventado.
    if (entrada.canal === "whatsapp") await registrarEnvio(tenantId, { temModelo: false });

    // ⚠ RESPONDEU E SOBROU TRABALHO DE GENTE. A pessoa foi atendida na hora —
    // que é o ponto inteiro de responder às 2h da manhã — e a tarefa fica
    // visível para alguém confirmar na agenda de manhã. Sem isto, a IA
    // confirmaria um horário e ninguém saberia até a pessoa aparecer na
    // recepção (ou não aparecer), que é exatamente o erro que este produto
    // existe para impedir.
    if (horarioAceito) {
      // ⚠ A AGENDA PASSOU A SER MARCADA SOZINHA — decisão do fundador em
      // 4/set, e ela reabre uma regra antiga desta casa ("quem confirma é
      // gente"). O argumento dele fecha: *"o sistema precisa marcar na agenda
      // sozinho"*, porque um sistema que conversa até o sim e não registra o
      // sim está quebrado de um jeito pior — foi assim que duas pessoas
      // fizeram a experimental e ninguém soube por dez dias.
      //
      // ⚠ O QUE PRESERVA A PREOCUPAÇÃO ORIGINAL: a marcação só acontece a
      // partir de uma aceitação EXPLÍCITA dela (o modelo devolve
      // `horario_escolhido` apenas quando ela escolhe um horário concreto), o
      // compromisso nasce com `origem: "cliente"` — então dá para separar
      // depois o que a máquina marcou do que uma pessoa marcou —, e a falha em
      // marcar NÃO some: vira tarefa na faixa vermelha.
      const marcado = await marcarCompromisso({
        contactId,
        quandoISO: horarioAceito,
        origem: "cliente",
        semSessao: { tenantId, skillKey: tenant.skill_key },
      });

      if (marcado.ok) {
        await registrar(
          "respondeu",
          `Respondi, ela aceitou ${horarioAceito} e eu marquei na agenda.`,
          { esperouMs: decisao.esperarMs, interactionId: (gravada as { id: string } | null)?.id },
        );
      } else {
        // ⚠ FALHA EM MARCAR É TAREFA DE GENTE, NUNCA SILÊNCIO. O horário mais
        // comum de falhar é o que acabou de ser ocupado por outra pessoa — e
        // aí existe alguém com um "está confirmado" na mão e sem vaga.
        await registrar(
          "agendar",
          `Respondi e ela aceitou ${horarioAceito}, mas eu NÃO consegui marcar na agenda: ` +
            `${marcado.error ?? "erro desconhecido"}. Marque à mão, ou combine outro horário com ela.`,
          { esperouMs: decisao.esperarMs, interactionId: (gravada as { id: string } | null)?.id },
        );
      }
      return;
    }

    // ⚠ O COMBINADO TAMBÉM É REGISTRADO SOZINHO. Ele decide QUANDO a pessoa
    // volta para a fila, com o assunto que ela mesma deu — e furar uma data
    // que a PESSOA marcou é o erro mais caro que existe aqui.
    //
    // ⚠ E `registrarCombinado` ENCERRA o atendimento junto, de propósito: quem
    // marcou a data fez o que a conversa pedia, e deixá-la em "aguardando"
    // faria alguém procurar todo dia o que já está resolvido. É a mesma peça
    // que a régua agora respeita — ela volta na data, não em cinco dias.
    if (retornoEm) {
      const combinado = await registrarCombinado({
        contactId,
        data: retornoEm,
        nota: entrada.texto.slice(0, 300),
        semSessao: { tenantId },
      });
      await registrar(
        combinado.ok ? "respondeu" : "agendar",
        combinado.ok
          ? `Respondi e registrei o combinado: ela volta a ser chamada em ${retornoEm}.`
          : `Respondi, ela falou em voltar em ${retornoEm} e eu NÃO consegui registrar: ` +
            `${combinado.motivo}. Anote à mão, senão ela não volta para a fila nessa data.`,
        { esperouMs: decisao.esperarMs, interactionId: (gravada as { id: string } | null)?.id },
      );
      return;
    }

    await registrar("respondeu", "A IA respondeu sozinha, dentro da janela de 24h.", {
      esperouMs: decisao.esperarMs,
      interactionId: (gravada as { id: string } | null)?.id,
    });
  } catch (e) {
    await registrar("falhou", e instanceof Error ? e.message : String(e));
  }
}

/**
 * As decisões esperando um humano — a fila que a tela mostra e o alerta lê.
 *
 * ⚠ SÓ `escalou` SEM `visto_em`. As outras quatro decisões são registro
 * histórico; esta é a única em que existe **uma pessoa esperando resposta que
 * não vai chegar sozinha**.
 */
export async function decisoesPendentes(
  tenantId: string,
  limite = 20,
): Promise<{ id: string; contactId: string; nome: string; quando: string; porque: string }[]> {
  const admin = createAdminClient();
  // paginacao-ok: recorte de tela, `limite` explícito e ordenado.
  const { data } = await admin
    .from("respostas_automaticas")
    .select("id, contact_id, occurred_at, porque, contacts(name)")
    .eq("tenant_id", tenantId)
    // ⚠ OS DOIS ESTADOS TÊM GENTE ESPERANDO, e por coisas diferentes:
    // `escalou` é "a IA não conseguiu responder"; `agendar` é "ela respondeu
    // bem e sobrou marcar na agenda". A tela mostra os dois, e o texto de cada
    // um diz qual é.
    .in("decisao", ["escalou", "agendar"])
    .is("visto_em", null)
    .order("occurred_at", { ascending: false })
    .limit(limite);

  return ((data as unknown[] | null) ?? []).map((r) => {
    const l = r as {
      id: string;
      contact_id: string;
      occurred_at: string;
      porque: string;
      contacts?: { name?: string } | { name?: string }[] | null;
    };
    const c = Array.isArray(l.contacts) ? l.contacts[0] : l.contacts;
    return {
      id: l.id,
      contactId: l.contact_id,
      nome: c?.name ?? "(contato sem nome)",
      quando: l.occurred_at,
      porque: l.porque,
    };
  });
}
