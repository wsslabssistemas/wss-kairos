import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getActiveTenant } from "@/lib/auth";
import { statusDoCanal } from "@/lib/credenciais";
import { gastoDeMensagensNoMes } from "@/lib/custo_mensagem-db";
import { reais } from "@/lib/custo_mensagem";
import { janelaDeAtendimento } from "@/lib/whatsapp-webhook";
import { rotaDaResposta } from "@/lib/roteamento";
import { credencialDoCanal } from "@/lib/credenciais";
import { lerTudo } from "@/lib/paginado";
import { Responder } from "./Responder";

export const metadata = { title: "Canal oficial" };

// A resposta pelo canal chama a Meta, e chamada de rede precisa de tempo
// declarado: o padrão da Vercel mata a função no meio e devolve silêncio —
// o botão gira para sempre, sem erro. É a PÁGINA que governa a duração das
// ações invocadas a partir dela.
// ⚠ 60, e nao 30: esta tela agora GERA resposta com IA. O padrao da Vercel
// mata a funcao no meio da geracao e nao devolve nada — o botao gira para
// sempre, sem erro. Tela que chama IA declara a duracao.
export const maxDuration = 60;

/**
 * O CANAL OFICIAL — o que saiu, o que chegou e o que FALHOU.
 *
 * ⚠ POR QUE ESTA TELA EXISTE, e por que ela começa pelas falhas.
 *
 * A Meta manda `sent`, `delivered`, `read` e `failed` a cada mensagem que sai.
 * O webhook interpretava os quatro desde que nasceu e **jogava fora**: só as
 * mensagens recebidas eram gravadas. Enquanto o envio era humano pelo `wa.me`
 * isso era irrelevante — não havia o que reportar sobre mensagem que saiu do
 * celular do vendedor.
 *
 * Com o canal oficial no ar e uma campanha paga pela frente, `failed` vira o
 * dado mais importante que existe: **mensagem cobrada que não chegou, e
 * ninguém tem como desconfiar de uma conversa que não aconteceu.** É a mesma
 * forma de erro que já custou caro aqui — o defeito que se apresenta como
 * silêncio.
 *
 * ⚠ O QUE ESTA TELA **NÃO** É: um aplicativo de conversa. Ela não substitui o
 * WhatsApp nem a ficha do contato, onde o histórico já mora. Ela responde três
 * perguntas que hoje não têm resposta em lugar nenhum: *saiu? chegou? quanto
 * custou?* Fazer um chat aqui duplicaria a ficha e criaria a expectativa de
 * que a equipe atende por dentro do sistema, que não é a operação real.
 */
export default async function ConversasPage({
  searchParams,
}: {
  searchParams: Promise<{ filtro?: string; contato?: string; busca?: string }>;
}) {
  const { filtro, contato, busca } = await searchParams;
  const membership = await getActiveTenant();
  const tenant = membership?.tenant;
  if (!tenant) {
    return (
      <main>
        <h1>Canal oficial</h1>
        <p className="text-dim">Sem empresa vinculada.</p>
      </main>
    );
  }

  const supabase = await createClient();
  const canal = await statusDoCanal(tenant.id);

  if (!canal.configurado) {
    return (
      <main style={{ maxWidth: 640 }}>
        <h1>Canal oficial</h1>
        <div className="card mt-16">
          <p style={{ marginTop: 0 }}>
            Esta empresa ainda não tem o canal oficial da Meta configurado — então não
            há envio nem recebimento por número do sistema para mostrar aqui.
          </p>
          <p className="text-dim" style={{ marginBottom: 0, fontSize: 14 }}>
            As conversas da equipe continuam acontecendo pelo WhatsApp de cada pessoa,
            e o histórico de cada uma fica na ficha do contato. Para ligar o canal:{" "}
            <Link href="/painel/automacao">Automação → Canal oficial</Link>.
          </p>
        </div>
      </main>
    );
  }

  const inicioDoMes = new Date();
  inicioDoMes.setDate(1);
  inicioDoMes.setHours(0, 0, 0, 0);
  const desde = inicioDoMes.toISOString();

  /**
   * ⚠ CONTAGEM NO SERVIDOR, com `head: true`.
   *
   * O PostgREST corta em 1.000 linhas sem avisar, e uma campanha de reativação
   * passa disso em dias. Trazer as linhas para contar no cliente daria, a
   * partir da milésima, um número MENOR que o real — plausível, silencioso, e
   * exatamente do lado errado numa tela que serve para detectar falha.
   *
   * paginacao-ok: nenhuma linha é lida; só o cabeçalho de contagem.
   */
  const contar = async (aplicar: (q: ReturnType<typeof montar>) => ReturnType<typeof montar>) => {
    const { count, error } = await aplicar(montar());
    // Erro NÃO vira zero. Zero se lê como "não houve falha nenhuma", que é a
    // leitura errada mais cara possível nesta tela específica.
    if (error) throw new Error(`Não consegui contar as mensagens: ${error.message}`);
    return count ?? 0;
  };
  // ⚠ O MESMO CLIENTE DO USUÁRIO QUE MONTA AS LISTAS, de propósito.
  //
  // Contar com `service_role` e listar com o cliente do usuário funcionaria
  // hoje — a RLS de `interactions` isola por EMPRESA, não por carteira, então
  // os dois veriam a mesma coisa. Mas o dia em que alguém estreitar a policy
  // (para o vendedor ver só a carteira dele, por exemplo), o placar diria 40 e
  // a lista mostraria 12, sem nada explicando a diferença. Número e lista que
  // discordam sem motivo visível é como se aprende a não confiar na tela.
  function montar() {
    return supabase
      .from("interactions")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenant!.id)
      .gte("occurred_at", desde);
  }

  const [enviadas, entregues, lidas, falhas, recebidas, gasto] = await Promise.all([
    contar((q) => q.not("delivery_status", "is", null)),
    contar((q) => q.in("delivery_status", ["delivered", "read"])),
    contar((q) => q.eq("delivery_status", "read")),
    contar((q) => q.eq("delivery_status", "failed")),
    contar((q) => q.eq("direction", "inbound").not("external_id", "is", null)),
    gastoDeMensagensNoMes(tenant.id),
  ]);

  // As falhas primeiro, porque são o que alguém precisa FAZER alguma coisa a
  // respeito. `.limit(50)` é decisão de produto — "as 50 mais recentes" —, não
  // leitura de tabela que cresce: com mais de 50 falhas num mês o problema não
  // é a lista, é o canal, e o número acima já grita isso.
  const { data: listaFalhas } = await supabase
    .from("interactions")
    .select("id, occurred_at, delivery_error, delivery_at, content, contact_id, contacts(name)")
    .eq("tenant_id", tenant.id)
    .eq("delivery_status", "failed")
    .order("delivery_at", { ascending: false })
    .limit(50);

  const soFalhas = filtro === "falhas";

  // A atividade recente: as 40 últimas que passaram pelo canal, nos dois
  // sentidos. Mesma justificativa do limite acima.
  const { data: recentes } = await supabase
    .from("interactions")
    .select("id, occurred_at, direction, content, delivery_status, delivery_error, contact_id, contacts(name)")
    .eq("tenant_id", tenant.id)
    .not("external_id", "is", null)
    .order("occurred_at", { ascending: false })
    .limit(40);

  // ---------------------------------------------------------------- AS CONVERSAS
  //
  // ⚠ A LISTA É DE **ENTRADAS**, não de mensagens quaisquer, e a diferença
  // decide se o número está certo. É a última mensagem DELE pelo canal que
  // abre a janela de 24h — a nossa não abre nada. Montar a lista a partir de
  // "últimas mensagens" faria uma conversa em que só nós falamos aparecer com
  // janela aberta, e a resposta seria recusada pela Meta com um erro que se lê
  // como credencial errada.
  //
  // `.limit(40)` é decisão de produto ("as 40 conversas mais recentes"), não
  // leitura de tabela que cresce: quem passa disso não precisa de lista, e o
  // placar acima já diz o tamanho.
  // ⚠ `contacts!inner` COM `deleted_at is null`: contato apagado continuava
  // aparecendo na lista, porque a consulta parte de `interactions` e a
  // exclusão mora no contato. O contato de teste do fundador ficou dias como
  // "aguardando resposta" por causa disso.
  const { data: entradas } = await supabase
    .from("interactions")
    .select("id, occurred_at, content, contact_id, contacts!inner(name, deleted_at, atendimento_encerrado_em)")
    .is("contacts.deleted_at", null)
    .eq("tenant_id", tenant.id)
    .eq("direction", "inbound")
    .not("external_id", "is", null)
    .order("occurred_at", { ascending: false })
    .limit(40);

  // O FIO da conversa selecionada. Aqui entra tudo — inclusive o que foi
  // registrado à mão —, porque quem vai responder precisa do contexto inteiro,
  // não só do que passou pela Meta.
  const { data: fio } = contato
    ? await supabase
        .from("interactions")
        .select("id, occurred_at, direction, input_kind, content, delivery_status, delivery_error")
        .eq("tenant_id", tenant.id)
        .eq("contact_id", contato)
        .order("occurred_at", { ascending: false })
        .limit(30)
    : { data: null };

  type Fio = {
    id: string; occurred_at: string; direction: string; input_kind: string;
    content: string; delivery_status?: string | null; delivery_error?: string | null;
  };

  type Linha = {
    id: string; occurred_at: string; direction?: string; content: string;
    delivery_status?: string | null; delivery_error?: string | null; delivery_at?: string | null;
    contact_id: string;
    contacts:
      | { name: string; atendimento_encerrado_em?: string | null }
      | { name: string; atendimento_encerrado_em?: string | null }[]
      | null;
  };

  const nomeDe = (l: Linha) =>
    (Array.isArray(l.contacts) ? l.contacts[0]?.name : l.contacts?.name) ?? "(sem nome)";

  const quando = (iso: string | null | undefined) =>
    iso
      ? new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })
      : "—";

  const ROTULO_STATUS: Record<string, { txt: string; cls: string }> = {
    sent: { txt: "enviada", cls: "badge" },
    delivered: { txt: "entregue", cls: "badge badge-brand" },
    read: { txt: "lida", cls: "badge badge-success" },
    failed: { txt: "FALHOU", cls: "badge badge-danger" },
  };

  // UMA LINHA POR PESSOA, a entrada mais recente dela. Sem isso, quem mandou
  // cinco mensagens seguidas ocuparia a lista inteira — e é justamente quem
  // está esperando resposta.
  const porContato = new Map<string, Linha>();
  for (const e of ((entradas as Linha[] | null) ?? [])) {
    if (!porContato.has(e.contact_id)) porContato.set(e.contact_id, e);
  }
  /**
   * ⚠ QUEM ESTÁ ESPERANDO RESPOSTA — a informação que faltava, e a única que
   * decide o que fazer agora.
   *
   * A lista mostrava as conversas por recência, e recência não é urgência:
   * quem escreveu há dez minutos e já foi respondido aparecia acima de quem
   * escreveu há três horas e está esperando. Com duas conversas ninguém nota;
   * com trinta, a pessoa que espera some no meio — e a perda medida deste
   * produto é silêncio, não objeção.
   *
   * A regra é simples e não depende de ninguém marcar nada: **se a última
   * mensagem da conversa é DELE, ninguém respondeu ainda.**
   *
   * ⚠ E ELA É PAGINADA, apesar de parecer pequena. São no máximo 40 pessoas,
   * mas **cada uma pode ter centenas de saídas** — o José Ricardo tem conversa
   * de meses. Quarenta contatos velhos passam de 1.000 linhas com folga, e o
   * PostgREST cortaria em silêncio: as saídas que faltassem virariam "ninguém
   * respondeu", e a tela mandaria responder de novo quem já foi respondido.
   *
   * O recorte por data reduz de verdade o volume — só interessa o que saiu
   * depois da entrada mais antiga da lista, porque nada anterior a isso pode
   * ser resposta a ela.
   */
  const idsDaLista = [...porContato.keys()];
  const ultimaSaida = new Map<string, string>();
  if (idsDaLista.length) {
    const maisAntiga = [...porContato.values()]
      .map((e) => e.occurred_at)
      .sort()[0];

    const saidas = await lerTudo<{ contact_id: string; occurred_at: string }>(
      (de, ate) =>
        supabase
          .from("interactions")
          .select("contact_id, occurred_at")
          .eq("tenant_id", tenant!.id)
          .eq("direction", "outbound")
          .in("contact_id", idsDaLista)
          .gte("occurred_at", maisAntiga)
          .order("occurred_at", { ascending: false })
          .order("id")
          .range(de, ate),
      { rotulo: "saidas das conversas do canal" },
    );
    for (const o of saidas) {
      if (!ultimaSaida.has(o.contact_id)) ultimaSaida.set(o.contact_id, o.occurred_at);
    }
  }

  const HORA = 3_600_000;
  /** Quando alguém declarou que aquela conversa não pedia mais resposta. */
  const encerradoEm = (c: Linha) => {
    const ct = Array.isArray(c.contacts) ? c.contacts[0] : c.contacts;
    return ct?.atendimento_encerrado_em ?? null;
  };

  /**
   * ⚠ ESPERANDO = ele falou por último **e** ninguém encerrou DEPOIS disso.
   *
   * A comparação é com a DATA, nunca com um interruptor: se a pessoa escrever
   * de novo depois de encerrado, ela volta para a lista na hora. Encerrar é
   * sobre o que já foi dito — arquivo que engole mensagem nova é a caixa de
   * entrada que perde cliente.
   */
  const esperando = (c: Linha) => {
    const nossa = ultimaSaida.get(c.contact_id);
    if (nossa && nossa >= c.occurred_at) return false;
    const fim = encerradoEm(c);
    if (fim && fim >= c.occurred_at) return false;
    return true;
  };
  const horasDeEspera = (c: Linha) =>
    Math.floor((Date.now() - Date.parse(c.occurred_at)) / HORA);

  const termo = (busca ?? "").trim().toLowerCase();

  const conversas = [...porContato.values()]
    // A BUSCA é por nome ou pelo texto da mensagem: quem procura "Jacque"
    // lembra do nome, quem procura "semana free" lembra do que foi dito.
    .filter((c) => {
      if (!termo) return true;
      return (
        nomeDe(c).toLowerCase().includes(termo) ||
        (c.content ?? "").toLowerCase().includes(termo)
      );
    })
    // ⚠ QUEM ESPERA VEM PRIMEIRO, e entre eles o que espera HÁ MAIS TEMPO. É o
    // oposto da ordem natural de um chat, e é de propósito: esta tela não
    // existe para ler conversa, existe para não deixar ninguém sem resposta.
    .sort((a, b) => {
      const ea = esperando(a), eb = esperando(b);
      if (ea !== eb) return ea ? -1 : 1;
      if (ea) return a.occurred_at.localeCompare(b.occurred_at);
      return b.occurred_at.localeCompare(a.occurred_at);
    });

  const aguardando = conversas.filter(esperando).length;

  // O estado da conversa selecionada: a janela vem da última ENTRADA dela.
  const selecionada = contato ? porContato.get(contato) ?? null : null;
  const janelaSel = selecionada ? janelaDeAtendimento(selecionada.occurred_at) : null;
  const rotaSel = contato
    ? rotaDaResposta({
        temCredencial: !!(await credencialDoCanal(tenant.id)),
        conversaNoCanalOficial: !!selecionada,
        janelaAberta: janelaSel?.aberta ?? false,
      })
    : null;

  const fs = (listaFalhas as Linha[] | null) ?? [];
  const rs = (recentes as Linha[] | null) ?? [];

  return (
    <main>
      <div className="between">
        <h1>Canal oficial</h1>
        <Link href="/painel/automacao" className="btn btn-sm btn-ghost">Configurar →</Link>
      </div>
      <p className="text-dim" style={{ marginTop: 4 }}>
        O que saiu e o que chegou pelo número do sistema neste mês. As conversas que a
        equipe tem pelo WhatsApp de cada um não passam por aqui — e o histórico completo
        de cada pessoa continua na ficha dela.
      </p>

      {/* ⚠ AS CONVERSAS VÊM PRIMEIRO, e isto foi reordenado em 24/ago a pedido
          do fundador: *"faz uma ação no topo da tela, depois desce lá para
          baixo e faz outra, depois sobe"*.

          O placar e o log de entrega estavam ANTES da lista, e eles são
          leitura de gestão — olhados uma vez por dia. A lista é TRABALHO,
          aberta o dia inteiro. Quem trabalha não pode rolar por cima de
          números para chegar no que faz. */}
      {/* ---------------------------------------------------- AS CONVERSAS
          ⚠ ESTA É A METADE QUE FALTAVA DO CANAL.

          O produto sabia MANDAR pelo número da empresa e não sabia RESPONDER
          por ele: quem escrevesse para o número do sistema só podia ser
          atendido pelo WhatsApp pessoal de um vendedor — outro número, e do
          lado do cliente outra pessoa. O caso que expõe isso é o cliente que
          pede para falar com um humano: ele pede socorro e o socorro chega de
          um desconhecido.

          O relógio da janela aparece em cada linha porque passadas 24h a Meta
          não entrega texto livre, e quem vai responder precisa saber disso
          ANTES de escrever. */}
      <div className="card mt-16">
        <div className="between" style={{ alignItems: "baseline" }}>
          <strong>Conversas no número do sistema</strong>
          <span className="text-faint" style={{ fontSize: 12 }}>
            {conversas.length === 0 ? "nenhuma ainda" : `${conversas.length} pessoa(s)`}
          </span>
        </div>

        {/* ⚠ O CONTADOR DE QUEM ESPERA, ANTES DA LISTA. Ele responde a única
            pergunta que alguém faz ao abrir esta tela — "tem alguém sem
            resposta?" — sem precisar ler trinta linhas para descobrir. */}
        <div className="row wrap" style={{ gap: 10, alignItems: "center", marginTop: 10 }}>
          {aguardando > 0 ? (
            <span className="badge badge-warn">{aguardando} aguardando resposta</span>
          ) : (
            conversas.length > 0 && <span className="badge badge-success">ninguém sem resposta</span>
          )}
          <form method="get" className="row" style={{ gap: 6, alignItems: "center" }}>
            {contato && <input type="hidden" name="contato" value={contato} />}
            <input
              type="search"
              name="busca"
              defaultValue={busca ?? ""}
              placeholder="procurar por nome ou pelo que foi dito"
              style={{ fontSize: 13, minWidth: 240 }}
            />
            <button type="submit" className="btn btn-sm btn-ghost">buscar</button>
            {termo && (
              <Link href="/painel/conversas" className="btn btn-sm btn-ghost">limpar</Link>
            )}
          </form>
        </div>

        {conversas.length === 0 ? (
          <p className="text-dim" style={{ fontSize: 14, marginBottom: 0 }}>
            Ninguém escreveu para o número do sistema ainda. Quando a primeira pessoa
            escrever, ela aparece aqui e dá para responder por este mesmo número.
          </p>
        ) : (
          <ul style={{ listStyle: "none", padding: 0, margin: "12px 0 0" }}>
            {conversas.map((c) => {
              const j = janelaDeAtendimento(c.occurred_at);
              const aberto = contato === c.contact_id;
              return (
                <li key={c.contact_id} style={{ padding: "10px 0", borderTop: "1px solid var(--border)" }}>
                  <div className="row wrap" style={{ gap: 8, alignItems: "center" }}>
                    <Link
                      href={aberto ? "/painel/conversas" : `/painel/conversas?contato=${c.contact_id}`}
                      className="grow"
                      style={{ fontSize: 14, minWidth: 130, fontWeight: aberto ? 600 : undefined }}
                    >
                      {aberto ? "▾ " : "▸ "}{nomeDe(c)}
                    </Link>
                    {/* ⚠ "AGUARDANDO" VEM ANTES DO RELÓGIO DA JANELA, porque
                        são coisas diferentes: a janela diz se DÁ para
                        responder, esta etiqueta diz se PRECISA. */}
                    {esperando(c) ? (
                      <span className="badge badge-warn">
                        aguardando
                        {horasDeEspera(c) >= 1 ? ` há ${horasDeEspera(c)}h` : ""}
                      </span>
                    ) : encerradoEm(c) ? (
                      <span className="badge">encerrada</span>
                    ) : null}
                    <span className="text-faint" style={{ fontSize: 12 }}>{quando(c.occurred_at)}</span>
                    {j.aberta ? (
                      <span className={j.minutosRestantes !== null && j.minutosRestantes <= 120 ? "badge badge-warn" : "badge badge-success"}>
                        {j.minutosRestantes !== null && j.minutosRestantes < 60
                          ? `${j.minutosRestantes} min`
                          : `${Math.floor((j.minutosRestantes ?? 0) / 60)}h`}
                      </span>
                    ) : (
                      <span className="badge">janela fechada</span>
                    )}
                  </div>
                  <p className="text-dim" style={{ fontSize: 13, margin: "4px 0 0" }}>
                    {c.content.length > 120 ? `${c.content.slice(0, 120)}…` : c.content}
                  </p>

                  {/* O FIO E A RESPOSTA, abertos na própria linha. Navegar para
                      outra tela para responder faria perder o contexto de quem
                      está atendendo cinco conversas. */}
                  {aberto && (
                    <div style={{ marginTop: 12 }}>
                      <ul style={{ listStyle: "none", padding: 0, margin: "0 0 12px" }}>
                        {[...(((fio as Fio[] | null) ?? []))].reverse().map((m) => (
                          <li
                            key={m.id}
                            style={{
                              padding: "6px 10px",
                              margin: "4px 0",
                              borderRadius: 8,
                              background: m.direction === "inbound" ? "var(--bg-elev)" : "transparent",
                              borderLeft: m.direction === "inbound" ? "3px solid var(--border-brand)" : "3px solid var(--border)",
                            }}
                          >
                            <div className="row wrap" style={{ gap: 6, alignItems: "baseline" }}>
                              <span className="text-faint" style={{ fontSize: 11 }}>
                                {m.direction === "inbound" ? "ele" : "nós"} · {quando(m.occurred_at)}
                              </span>
                              {m.delivery_status && (
                                <span className={ROTULO_STATUS[m.delivery_status]?.cls ?? "badge"} style={{ fontSize: 10 }}>
                                  {ROTULO_STATUS[m.delivery_status]?.txt ?? m.delivery_status}
                                </span>
                              )}
                            </div>
                            <p style={{ fontSize: 13, margin: "2px 0 0", whiteSpace: "pre-wrap" }}>{m.content}</p>
                            {m.delivery_error && (
                              <p className="badge badge-danger" style={{ marginTop: 4, whiteSpace: "normal" }}>
                                {m.delivery_error}
                              </p>
                            )}
                          </li>
                        ))}
                      </ul>

                      <Responder
                        contactId={c.contact_id}
                        podeResponder={rotaSel?.via === "cloud_api_texto"}
                        motivoDoBloqueio={rotaSel && rotaSel.via !== "cloud_api_texto" ? rotaSel.porque : null}
                        aviso={janelaSel?.aviso ?? null}
                      />

                      <p className="text-faint" style={{ fontSize: 11, marginTop: 8 }}>
                        <Link href={`/painel/contatos/${c.contact_id}`}>Abrir a ficha completa →</Link>
                      </p>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* ---------------------------------------------------- O PLACAR */}
      <div
        className="mt-24"
        style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12 }}
      >
        {[
          { rotulo: "Saíram", valor: enviadas, hint: "pelo número do sistema" },
          { rotulo: "Chegaram ao aparelho", valor: entregues, hint: "entregues ou lidas" },
          { rotulo: "Lidas", valor: lidas, hint: "confirmação de leitura" },
          { rotulo: "Recebidas", valor: recebidas, hint: "mensagens dos clientes" },
        ].map((k) => (
          <div key={k.rotulo} className="card" style={{ padding: 14 }}>
            <p className="text-faint" style={{ fontSize: 12, margin: 0 }}>{k.rotulo}</p>
            <p style={{ fontSize: 26, fontWeight: 600, margin: "2px 0 0" }}>{k.valor}</p>
            <p className="text-faint" style={{ fontSize: 11, margin: 0 }}>{k.hint}</p>
          </div>
        ))}
        <div
          className="card"
          style={{ padding: 14, borderColor: falhas > 0 ? "var(--danger)" : undefined }}
        >
          <p className="text-faint" style={{ fontSize: 12, margin: 0 }}>Falharam</p>
          <p style={{ fontSize: 26, fontWeight: 600, margin: "2px 0 0", color: falhas > 0 ? "var(--danger)" : undefined }}>
            {falhas}
          </p>
          <p className="text-faint" style={{ fontSize: 11, margin: 0 }}>não chegaram</p>
        </div>
      </div>

      <p className="text-faint mt-8" style={{ fontSize: 12 }}>
        Custo estimado do mês: <strong>{reais(gasto.gastoCents)}</strong> em{" "}
        {gasto.totalMensagens} mensagem(ns). A tarifa em reais ainda é conversão do
        dólar, não o rate card da conta — ver <Link href="/painel/admin/cotas">Cota de IA</Link>.
      </p>

      {/* ---------------------------------------------------- AS FALHAS
          ⚠ PRIMEIRO NA TELA E COM MOTIVO JUNTO. A Meta devolve um texto que
          diz POR QUE não chegou, e cada motivo tem conserto diferente: número
          que não tem WhatsApp, modelo não aprovado, limite da pessoa. Trocar
          isso por "falha no envio" economizaria uma linha e custaria a única
          informação que resolve o problema. */}
      {falhas > 0 && (
        <div className="card mt-24" style={{ borderColor: "var(--danger)" }}>
          <div className="between" style={{ alignItems: "baseline" }}>
            <strong>Não chegaram — e cada uma custou</strong>
            <span className="text-faint" style={{ fontSize: 12 }}>
              {fs.length >= 50 ? "as 50 mais recentes" : `${fs.length} no mês`}
            </span>
          </div>
          <ul style={{ listStyle: "none", padding: 0, margin: "12px 0 0" }}>
            {fs.map((f) => (
              <li key={f.id} style={{ padding: "10px 0", borderTop: "1px solid var(--border)" }}>
                <div className="row wrap" style={{ gap: 8, alignItems: "baseline" }}>
                  <Link href={`/painel/contatos/${f.contact_id}`} style={{ fontSize: 14 }}>
                    {nomeDe(f)}
                  </Link>
                  <span className="text-faint" style={{ fontSize: 12 }}>{quando(f.delivery_at)}</span>
                </div>
                <p className="text-dim" style={{ fontSize: 13, margin: "4px 0 0" }}>
                  {f.delivery_error ?? "A Meta não disse o motivo."}
                </p>
              </li>
            ))}
          </ul>
        </div>
      )}


      {/* ---------------------------------------------------- A ATIVIDADE */}
      <div className="card mt-24">
        <div className="between" style={{ alignItems: "baseline" }}>
          <strong>Últimas pelo canal</strong>
          <Link
            href={soFalhas ? "/painel/conversas" : "/painel/conversas?filtro=falhas"}
            className="btn btn-sm btn-ghost"
          >
            {soFalhas ? "Ver todas" : "Só as que falharam"}
          </Link>
        </div>

        {rs.length === 0 ? (
          <p className="text-dim" style={{ fontSize: 14, marginBottom: 0 }}>
            Nada passou pelo canal oficial ainda. Quando a primeira mensagem sair — ou o
            primeiro cliente escrever para o número do sistema — ela aparece aqui.
          </p>
        ) : (
          <ul style={{ listStyle: "none", padding: 0, margin: "12px 0 0" }}>
            {rs
              .filter((l) => (soFalhas ? l.delivery_status === "failed" : true))
              .map((l) => {
                const st = l.delivery_status ? ROTULO_STATUS[l.delivery_status] : null;
                return (
                  <li key={l.id} style={{ padding: "10px 0", borderTop: "1px solid var(--border)" }}>
                    <div className="row wrap" style={{ gap: 8, alignItems: "center" }}>
                      <span className="text-faint" style={{ fontSize: 12, minWidth: 74 }}>
                        {quando(l.occurred_at)}
                      </span>
                      <span className="badge" style={{ minWidth: 60, justifyContent: "center" }}>
                        {l.direction === "inbound" ? "recebida" : "enviada"}
                      </span>
                      <Link href={`/painel/contatos/${l.contact_id}`} className="grow" style={{ fontSize: 14, minWidth: 120 }}>
                        {nomeDe(l)}
                      </Link>
                      {st && <span className={st.cls}>{st.txt}</span>}
                      {/* Saída sem status é normal e vale dizer: pode ser toque
                          registrado à mão, que nunca passou pela Meta. */}
                      {!st && l.direction === "outbound" && (
                        <span className="text-faint" style={{ fontSize: 11 }}>sem confirmação</span>
                      )}
                    </div>
                    <p className="text-dim" style={{ fontSize: 13, margin: "4px 0 0 82px" }}>
                      {l.content.length > 140 ? `${l.content.slice(0, 140)}…` : l.content}
                    </p>
                    {l.delivery_status === "failed" && l.delivery_error && (
                      <p className="badge badge-danger" style={{ margin: "6px 0 0 82px", whiteSpace: "normal" }}>
                        {l.delivery_error}
                      </p>
                    )}
                  </li>
                );
              })}
          </ul>
        )}
      </div>

      {/* ---------------------------------------------------- O QUE ESTA TELA NÃO SABE
          Escrito porque um painel que cala sobre o próprio limite ensina a
          confiar no número errado. */}
      <div className="card mt-16">
        <p className="eyebrow" style={{ marginBottom: 8 }}>O que esta tela não enxerga</p>
        <ul className="text-dim" style={{ fontSize: 13, margin: 0, paddingLeft: 18 }}>
          <li>
            <strong>As conversas pelo WhatsApp da equipe.</strong> Elas não passam pela
            Meta e não têm status — o registro delas é o toque marcado na fila.
          </li>
          <li>
            <strong>Áudio, imagem e figurinha que o cliente manda.</strong> Chegam e não
            viram interação ainda; ficam contados no log do webhook.
          </li>
          <li>
            <strong>Instagram e Facebook.</strong> São outras APIs da Meta e não existem
            no sistema hoje.
          </li>
        </ul>
      </div>
    </main>
  );
}
