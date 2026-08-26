import { Hono } from "hono";
import { handle } from "hono/vercel";
import { createAdminClient } from "@/lib/supabase/admin";
import { variantesArmazenadas } from "@/lib/phone";
import { escolherResponsavel } from "@/lib/carteira";
import { empresaDoNumero } from "@/lib/credenciais";
import { pediuParaSair } from "@/lib/optout";
import { tipoDeFecho } from "@/lib/fecho";
import { rodarTodasAsEmpresas } from "@/lib/motor-rota";
import { timingSafeEqual } from "node:crypto";
import {
  assinaturaConfere,
  respostaDoDesafio,
  desmontarPacote,
  phoneNumberIdDoPacote,
  type MensagemRecebida,
  type StatusDeEnvio,
} from "@/lib/whatsapp-webhook";

// Rota catch-all única: a Vercel limita o número de funções, então toda a API
// vive aqui dentro (decisão de stack). O núcleo não sabe por qual canal a
// mensagem chegou — recebe contexto, devolve decisão.
export const runtime = "nodejs";

/**
 * ⚠ O TEMPO PRECISA SER DECLARADO, e não estava.
 *
 * Esta rota é a que o agendador do motor chama, e o motor manda mensagem por
 * mensagem, em série. Sem `maxDuration` vale o padrão da plataforma — e um
 * padrão curto mata a função NO MEIO DO LAÇO: parte do lote sai, o resto não,
 * e não há erro em lugar nenhum, porque cada envio já foi registrado antes de
 * a função morrer. Metade da campanha some em silêncio.
 *
 * Com a pausa entre envios (ver `lib/motor-db.ts`) um lote de 10 leva ~1
 * minuto e meio. O teto abaixo dá folga de sobra para isso e para o dia em que
 * o teto diário subir.
 *
 * Isto é um LIMITE, não um custo: o webhook da Meta continua respondendo em
 * milissegundos. Ninguém paga por tempo que não usa.
 */
export const maxDuration = 300;

const app = new Hono().basePath("/api");

/**
 * O GATILHO DO MOTOR PROATIVO.
 *
 * ⚠ ESTE ENDEREÇO MANDA MENSAGEM EM NOME DE CLIENTE PAGANTE. É o mais
 * perigoso do produto depois do webhook, e por um motivo diferente: o webhook
 * ESCREVE no histórico; este aqui FALA com pessoas reais, cobrando da conta da
 * empresa. Quem descobrir a URL e conseguir chamá-la dispara a campanha
 * inteira de alguém.
 *
 * A defesa é um segredo em `MOTOR_CRON_SECRET`, comparado com
 * `timingSafeEqual` — comparar com `===` vaza, pelo TEMPO da resposta, quantos
 * caracteres iniciais estavam certos. É a mesma regra da assinatura da Meta,
 * pelo mesmo motivo: é um ataque lento e chato, e por isso ninguém percebe.
 *
 * ⚠ SEM SEGREDO CONFIGURADO, RECUSA — nunca libera. "Ainda não configurei" não
 * pode ser o estado em que o endereço fica aberto: seria a falha que se parece
 * com trabalho pendente e deixa a porta destrancada.
 *
 * `?simular=1` roda sem enviar nada. É o que o agendador pode usar para provar
 * que o caminho inteiro funciona antes de a primeira mensagem sair.
 */
app.post("/motor/rodar", async (c) => {
  const segredo = process.env.MOTOR_CRON_SECRET;
  if (!segredo) {
    console.error("[motor] MOTOR_CRON_SECRET nao configurado — chamada recusada");
    return c.json({ erro: "Gatilho do motor não configurado." }, 503);
  }

  const oferecido = (c.req.header("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const a = Buffer.from(oferecido, "utf8");
  const b = Buffer.from(segredo, "utf8");
  const confere = a.length === b.length && timingSafeEqual(a, b);
  if (!confere) {
    console.warn("[motor] chamada recusada: segredo invalido");
    return c.json({ erro: "não autorizado" }, 401);
  }

  const simular = new URL(c.req.url).searchParams.get("simular") === "1";
  try {
    const r = await rodarTodasAsEmpresas(simular);
    // O relatório volta INTEIRO no corpo. O agendador guarda a resposta, e é
    // dela que sai o "por que nada saiu hoje" sem ninguém abrir o painel.
    console.info(`[motor] rodada: ${r.empresas} empresa(s), ${r.enviadas} enviada(s), ${r.falhas} falha(s)`);
    return c.json(r, 200);
  } catch (e) {
    const erro = e instanceof Error ? e.message : String(e);
    console.error(`[motor] rodada FALHOU: ${erro}`);
    // 500 de propósito, ao contrário do webhook: aqui não há ninguém
    // reenviando, e um agendador que recebe 200 numa falha nunca avisa.
    return c.json({ erro }, 500);
  }
});

app.get("/health", (c) =>
  c.json({ ok: true, service: "cos", ts: new Date().toISOString() }),
);

// =====================================================================
// WEBHOOK DO WHATSAPP
//
// É o único endereço do produto que qualquer um na internet pode chamar. Tudo
// aqui parte do princípio de que quem chamou pode não ser a Meta.
//
// A regra que governa as respostas: **200 quase sempre.** A Meta reenvia o que
// falha e desativa a assinatura depois de muitas falhas seguidas. Então erro
// nosso ao gravar não pode virar 500 — vira 200 com o problema registrado no
// log. A ÚNICA coisa que recebe 403 é assinatura inválida, porque aí não é
// falha: é alguém que não deveria estar ali.
// =====================================================================

/**
 * Verificação de posse do endereço — a Meta chama uma vez, no cadastro.
 *
 * ⚠ O TOKEN É DE CADA EMPRESA, e tem que ser.
 *
 * O endereço do webhook é UM só para o produto inteiro, mas cada cliente tem o
 * app dele na Meta, verificado no CNPJ dele, com o token de verificação que ELE
 * escolheu. Um token de ambiente só serviria para a primeira empresa — a
 * segunda não conseguiria concluir o cadastro na Meta, e o sintoma seria um 403
 * sem explicação numa tela da Meta, longe daqui.
 *
 * Então o desafio é aceito se o token bater com o de QUALQUER empresa. Não é
 * afrouxamento: quem acerta um token que só existe no nosso banco e no Business
 * Manager daquele cliente já provou a posse que esta chamada verifica. Quem
 * decide o que fazer com as MENSAGENS continua sendo a assinatura do pacote,
 * abaixo — essa sim, por app.
 */
app.get("/whatsapp/webhook", async (c) => {
  const params = new URL(c.req.url).searchParams;
  const oferecido = params.get("hub.verify_token");
  const admin = createAdminClient();
  // paginacao-ok: procura exata pelo token oferecido — no máximo uma linha.
  const { data: dono } = oferecido
    ? await admin
        .from("tenant_secrets")
        .select("tenant_id")
        .eq("whatsapp_verify_token", oferecido)
        .maybeSingle()
    : { data: null };

  // ⚠ A RECUSA PRECISA DIZER QUAL DOS DOIS CASOS É, e a primeira versão dizia
  // sempre "nenhum token cadastrado". Com um token OFERECIDO que não bate,
  // essa frase manda a pessoa cadastrar o que ela acabou de cadastrar — e ela
  // está na tela da Meta, sem acesso ao servidor, sem como distinguir.
  //
  // São duas causas com conserto oposto: não salvou ainda × salvou diferente
  // (espaço no fim, letra trocada, colou o token errado).
  const esperado = dono ? oferecido : process.env.WHATSAPP_VERIFY_TOKEN;
  const r = respostaDoDesafio(params, esperado);
  if (!r.ok) {
    const motivo = !esperado && oferecido
      ? `O token "${oferecido}" não confere com nenhum cadastrado. Confira se é exatamente o mesmo salvo em Automação → Canal oficial, no Kairós — sem espaço sobrando no começo ou no fim.`
      : r.motivo;
    console.warn(`[whatsapp] verificacao recusada: ${motivo}`);
    return c.text(motivo, 403);
  }
  // Texto puro, não JSON: a Meta compara o corpo com o desafio que mandou.
  return c.text(r.desafio, 200);
});

app.post("/whatsapp/webhook", async (c) => {
  // CORPO CRU, antes de qualquer parse — a assinatura é sobre os bytes que
  // chegaram. Reserializar mudaria o hash e faria a verificação recusar
  // pacote legítimo.
  const cru = await c.req.text();

  // ⚠ O SEGREDO É POR EMPRESA, ENTÃO O CORPO É LIDO ANTES DE SER CONFERIDO —
  // e a distinção que torna isso seguro cabe numa frase: **ler para escolher a
  // chave é diferente de confiar no conteúdo.**
  //
  // Cada cliente tem o próprio app na Meta, com o próprio segredo. Qual usar
  // depende de saber de quem é o pacote, e a única pista está dentro dele
  // (`phone_number_id`). Um atacante pode mentir esse campo à vontade: no
  // máximo ele escolhe contra QUAL segredo vai ser conferido, e aí a
  // assinatura dele não vai bater com nenhum. Nada do corpo é usado para
  // decidir coisa alguma antes da linha de verificação abaixo.
  //
  // Enquanto isso era `process.env.WHATSAPP_APP_SECRET`, o efeito era total e
  // silencioso: sem variável configurada, `assinaturaConfere` recusa — a regra
  // certa — e **todo pacote da Meta voltava 403**. Confirmação de entrega,
  // status e, mais tarde, a mensagem do cliente. Na tela da Meta isso apareceu
  // como *"não foi possível entregar a mensagem, confira seus webhooks"*.
  const dono = await empresaDoNumero(phoneNumberIdDoPacote(cru) ?? "");

  const assin = assinaturaConfere(
    cru,
    c.req.header("x-hub-signature-256"),
    dono?.appSecret ?? process.env.WHATSAPP_APP_SECRET,
  );
  if (!assin.ok) {
    console.warn(
      `[whatsapp] pacote recusado: ${assin.motivo}` +
      (dono ? "" : " (nenhuma empresa tem esse numero cadastrado em Automacao → Canal oficial)"),
    );
    return c.text("assinatura invalida", 403);
  }

  let corpo: unknown;
  try {
    corpo = JSON.parse(cru);
  } catch {
    return c.text("ok", 200); // não é nosso problema resolver, e reenviar não conserta
  }

  const pacote = desmontarPacote(corpo);
  if (pacote.ignorados.length) {
    // Áudio e imagem caem aqui. Fica no log para "o cliente respondeu e
    // ninguém viu" ser um número, e não um silêncio.
    console.info(`[whatsapp] ignorados: ${pacote.ignorados.join(", ")}`);
  }

  try {
    await registrar(pacote.mensagens);
  } catch (e) {
    // 200 mesmo assim, de propósito: ver a nota no topo do bloco.
    console.error(`[whatsapp] falha ao gravar: ${e instanceof Error ? e.message : String(e)}`);
  }

  try {
    await registrarStatus(pacote.status);
  } catch (e) {
    console.error(`[whatsapp] falha ao gravar status: ${e instanceof Error ? e.message : String(e)}`);
  }

  return c.text("ok", 200);
});

/**
 * Grava o status de entrega nas mensagens que JÁ saíram por nós.
 *
 * ⚠ ISTO CHEGAVA E ERA JOGADO FORA. `desmontarPacote` interpreta `sent`,
 * `delivered`, `read` e `failed` desde que o webhook nasceu, e a rota só
 * chamava `registrar(pacote.mensagens)`. Enquanto o envio era humano pelo
 * `wa.me` isso era irrelevante — a Meta não tinha o que reportar sobre uma
 * mensagem que saiu do celular do vendedor. Com o canal oficial no ar,
 * `failed` passa a ser o dado mais importante que existe: dinheiro gasto sem
 * conversa, invisível.
 *
 * ⚠ `update`, NUNCA `upsert`. A chave é `(tenant_id, external_id)`, cujo
 * índice é PARCIAL (0052). O Postgres não infere índice parcial sem repetir o
 * predicado e o PostgREST não sabe expressar isso — foi assim que toda
 * gravação da mensagem do cliente falhou em silêncio em ago/2026.
 *
 * ⚠ E LINHA NÃO ENCONTRADA NÃO É ERRO. A Meta reporta status de mensagens que
 * podem não ter registro nosso: enviadas antes de existir `external_id`, ou de
 * outra ferramenta na mesma conta. O certo é CONTAR e seguir — mas contar, e
 * não ignorar, porque "nenhum status pousou" e "nenhum status chegou" são
 * problemas diferentes e se parecem exatamente igual no silêncio.
 */
async function registrarStatus(status: StatusDeEnvio[]) {
  if (!status.length) return;
  const admin = createAdminClient();

  // O tenant vem do `phone_number_id`, como nas mensagens: nada do corpo
  // decide de quem é a linha. Cache por número dentro do lote.
  const donoPorNumero = new Map<string, string | null>();
  let gravados = 0;
  let semDono = 0;
  let semLinha = 0;

  for (const s of status) {
    if (!donoPorNumero.has(s.phoneNumberId)) {
      const dono = await empresaDoNumero(s.phoneNumberId);
      donoPorNumero.set(s.phoneNumberId, dono?.tenantId ?? null);
    }
    const tenantId = donoPorNumero.get(s.phoneNumberId) ?? null;
    if (!tenantId) { semDono++; continue; }

    // `.select("id")` é o que torna a escrita CONFERÍVEL: sem ele o PostgREST
    // não devolve linha e não há como distinguir "atualizei" de "não achei".
    // paginacao-ok: no máximo uma linha, endereçada por chave única.
    const { data, error } = await admin
      .from("interactions")
      .update({
        delivery_status: s.status,
        delivery_error: s.erro,
        delivery_at: s.quando.toISOString(),
      })
      .eq("tenant_id", tenantId)
      .eq("external_id", s.wamid)
      .select("id");

    if (error) {
      console.error(`[whatsapp] status ${s.status} de ${s.wamid} recusado: ${error.message}`);
      continue;
    }
    if (!data || data.length === 0) { semLinha++; continue; }
    gravados++;
  }

  if (semDono || semLinha) {
    console.info(
      `[whatsapp] status: ${gravados} gravado(s), ${semLinha} sem mensagem nossa, ${semDono} sem empresa dona do numero`,
    );
  }
}

/**
 * Grava as mensagens recebidas como `interactions` inbound.
 *
 * Roda com `service_role` porque webhook não tem sessão de usuário — não há
 * `auth.uid()` para a RLS avaliar. É o uso legítimo do papel: entrada de
 * sistema, com o `tenant_id` decidido aqui e não pelo pacote.
 */
async function registrar(mensagens: MensagemRecebida[]) {
  if (!mensagens.length) return;
  const admin = createAdminClient();

  /**
   * Quem recebe um lead que chegou sozinho pelo canal.
   *
   * Cache por empresa dentro do lote: um pacote da Meta pode trazer várias
   * mensagens, e consultar a equipe inteira por mensagem seria caro à toa. O
   * desequilíbrio dentro de um lote é de poucas unidades e a próxima chamada
   * já corrige, porque a escolha é sempre a MENOR carteira.
   */
  const carteirasPorTenant = new Map<string, string | null>();
  async function donoParaContatoNovo(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    cliente: any,
    tenantId: string,
  ): Promise<string | null> {
    if (carteirasPorTenant.has(tenantId)) return carteirasPorTenant.get(tenantId)!;

    const { data: mems } = await cliente
      .from("memberships")
      .select("id, role")
      .eq("tenant_id", tenantId)
      .eq("status", "active")
      .order("id");
    const ativos = ((mems as { id: string; role: string }[] | null) ?? []);
    // Agente é quem atende. Sem nenhum, o dono da empresa recebe — melhor com
    // quem responde pela empresa do que com ninguém.
    const alvos = ativos.filter((m) => m.role === "agent");
    const agentes = alvos.length ? alvos : ativos;

    // paginacao-ok: só o TAMANHO de cada carteira, sem trazer linha nenhuma —
    // é o `count` do PostgREST, que não sofre o corte de 1.000.
    const carga: Record<string, number> = {};
    for (const a of agentes) {
      const { count } = await cliente
        .from("contacts")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", tenantId)
        .eq("owner_id", a.id)
        .is("deleted_at", null);
      carga[a.id] = count ?? 0;
    }

    const escolhido = escolherResponsavel(agentes, carga);
    carteirasPorTenant.set(tenantId, escolhido);
    return escolhido;
  }

  // O `phone_number_id` diz de qual EMPRESA é o número que recebeu. Ele vem
  // do pacote, mas não é o pacote que decide o tenant: procuramos o número
  // no nosso cadastro, e o que não estiver cadastrado é descartado. Sem isso,
  // um pacote forjado escolheria em qual empresa escrever.
  //
  // ⚠ ESTA BUSCA LIA `tenants.settings` E O NÚMERO PASSOU A MORAR EM
  // `tenant_secrets` (0056) — eu movi a fonte e deixei este leitor para trás.
  //
  // O efeito foi o silêncio mais bem disfarçado da série: a Meta ENTREGOU, a
  // assinatura foi conferida e passou, o endpoint respondeu **200**, e a
  // mensagem foi descartada aqui dentro. Do lado da Meta, sucesso. No banco,
  // nada. Só apareceu no log da Vercel — *"numero 1202699839603007 nao
  // pertence a nenhuma empresa"* — porque essa linha existia.
  //
  // A lição que fica, e ela vale para toda mudança de lugar: **mover a fonte
  // de verdade é fácil; achar todos os leitores é o trabalho.** A assinatura
  // já usava `tenant_secrets`; esta busca, dois blocos abaixo, ainda usava o
  // lugar antigo. Agora as duas leem a mesma coluna.
  const ids = [...new Set(mensagens.map((m) => m.phoneNumberId).filter(Boolean))];
  if (!ids.length) return;

  // paginacao-ok: busca exata por uma lista de ids de número — no máximo uma
  // linha por número, e são poucos por pacote.
  const { data: donos } = await admin
    .from("tenant_secrets")
    .select("tenant_id, whatsapp_phone_id")
    .in("whatsapp_phone_id", ids);

  const porNumero = new Map<string, string>();
  for (const d of (donos as { tenant_id: string; whatsapp_phone_id: string }[] | null) ?? []) {
    if (d.whatsapp_phone_id) porNumero.set(d.whatsapp_phone_id, d.tenant_id);
  }

  for (const msg of mensagens) {
    const tenantId = porNumero.get(msg.phoneNumberId);
    if (!tenantId) {
      console.warn(`[whatsapp] numero ${msg.phoneNumberId} nao pertence a nenhuma empresa`);
      continue;
    }

    // Acha o contato em qualquer um dos formatos em que o telefone pode estar
    // gravado. Ver `variantesArmazenadas`: procurar só pelo E.164 acharia 56%
    // da base e duplicaria o resto.
    const { data: achados } = await admin
      .from("contacts")
      .select("id")
      .eq("tenant_id", tenantId)
      .in("phone", variantesArmazenadas(msg.de))
      .limit(1);

    let contactId = (achados as { id: string }[] | null)?.[0]?.id ?? null;

    if (!contactId) {
      // Quem escreve e não está cadastrado É UM LEAD. Descartar seria perder
      // exatamente o contato que o produto existe para não perder.
      //
      // ⚠ E ELE PRECISA NASCER COM DONO. Este insert não tinha `owner_id`, e
      // desde que a Fila passou a abrir na carteira de quem está logado, um
      // contato órfão não aparece para NINGUÉM. O lead que acabou de escrever
      // é o mais quente que existe — sumir justo ele é o pior caso.
      //
      // Não dá erro, não dá aviso: a pessoa simplesmente não está em lista
      // nenhuma. Ver `lib/carteira.ts`.
      const responsavel = await donoParaContatoNovo(admin, tenantId);
      const { data: novo, error: erroNovo } = await admin
        .from("contacts")
        .insert({
          tenant_id: tenantId,
          name: msg.nome ?? msg.de,
          phone: msg.de,
          source: "whatsapp",
          owner_id: responsavel,
        })
        .select("id")
        .maybeSingle();
      // O erro era engolido junto com o resto: sem contato, a mensagem do
      // cliente era descartada em silêncio pelo `continue` abaixo.
      if (erroNovo) console.error(`[webhook] falha ao criar lead de ${msg.de}: ${erroNovo.message}`);
      contactId = (novo as { id: string } | null)?.id ?? null;
      if (!contactId) continue;
    }

    // `external_id` é a chave contra duplicata: a Meta REENVIA o mesmo pacote
    // quando não recebe 200 a tempo, e sem isso a mesma frase do cliente
    // apareceria duas vezes no histórico — e contaria duas vezes na métrica.
    //
    // ⚠ ERA UM `upsert` COM `onConflict`, E ELE NUNCA FUNCIONOU.
    //
    // O índice único é PARCIAL (`... WHERE external_id IS NOT NULL`, no 0052)
    // e o `ON CONFLICT` do Postgres não infere índice parcial sem repetir o
    // predicado — coisa que o PostgREST não sabe expressar. Toda gravação
    // falhava com "no unique or exclusion constraint matching".
    //
    // E o erro era ENGOLIDO: o resultado do `upsert` não era conferido. O
    // efeito foi o pior desta série — a primeira mensagem real de um cliente
    // criou o contato, com nome e dono certos, e **a frase dele sumiu**. Do
    // lado de fora, sucesso total: 200 para a Meta, contato novo na tela, e
    // zero interações. Ninguém procuraria por uma mensagem que não sabe que
    // existiu.
    //
    // Agora é INSERT com o erro lido. Duplicata (23505) é o caso esperado do
    // reenvio da Meta e passa em silêncio; qualquer outro erro vai para o log,
    // porque a alternativa é perder mensagem de cliente sem rastro.
    const { error: erroMsg } = await admin.from("interactions").insert({
      tenant_id: tenantId,
      contact_id: contactId,
      direction: "inbound",
      // PAPEL, não meio. Mensagem que o cliente escreveu é
      // `customer_message` — e não é rótulo à toa: a Gestão calcula tempo de
      // resposta filtrando exatamente por este valor. Inventar um
      // `input_kind: "whatsapp"` faria as mensagens do canal novo sumirem
      // silenciosamente da métrica que mede o produto.
      // ⚠ REAGIR NÃO É ESCREVER. A Taiane reagiu com emoji a uma despedida e a
      // conversa, já resolvida, voltou para a lista como "aguardando
      // resposta". Reagir é o equivalente a acenar com a cabeça — cobrar
      // resposta de um aceno cria pendência fantasma, e o pior seria alguém
      // gerar resposta comercial paga para um 👍 de quem acabou de dizer não.
      //
      // A reação NÃO some: fica no histórico como sinal (reagir bem a uma
      // despedida é diferente de silêncio). Só não conta como pergunta.
      // ⚠ E UM "👍" MANDADO COMO TEXTO É A MESMA COISA QUE UMA REAÇÃO. A Meta
      // separa os dois — quem toca na mensagem gera `reaction`, quem digita o
      // emoji gera `text` — mas para quem atende não há diferença nenhuma:
      // nos dois casos a pessoa acenou com a cabeça e não perguntou nada.
      //
      // `tipoDeFecho` só classifica assim texto SEM UMA ÚNICA LETRA. "ok" e
      // "obrigada" são palavras e continuam sendo mensagem: fechar por engano
      // deixa alguém esperando para sempre, e esse é o erro caro.
      input_kind:
        msg.tipo === "reaction" || tipoDeFecho(msg.texto) === "sem_conteudo"
          ? "customer_reaction"
          : "customer_message",
      channel: "whatsapp",
      content: msg.texto,
      occurred_at: msg.quando.toISOString(),
      external_id: msg.wamid,
    });

    if (erroMsg && erroMsg.code !== "23505") {
      console.error(`[whatsapp] MENSAGEM PERDIDA de ${msg.de} (${msg.wamid}): ${erroMsg.message}`);
    }

    // ⚠ PEDIDO DE DESCADASTRO E HONRADO AQUI, NO INSTANTE EM QUE CHEGA.
    //
    // Deixar para um humano marcar depois significa que, entre o pedido e a
    // marcacao, o motor continua mandando — e o motor manda de madrugada, no
    // fim de semana, sem ninguem lendo. Essa janela e justamente onde a
    // denuncia acontece.
    //
    // Honrar isso e exigencia da LGPD e da politica do WhatsApp. E o custo de
    // errar tem lado: parar de falar com quem nao pediu custa um lead; seguir
    // falando com quem pediu custa a QUALIDADE DO NUMERO, que derruba a
    // entrega de tudo — inclusive a renovacao de quem paga em dia.
    //
    // A marcacao e reversivel e guarda o motivo: a ficha mostra a frase que a
    // pessoa escreveu, com data. Ver `lib/optout.ts`.
    const pedido = pediuParaSair(msg.texto);
    if (pedido) {
      // `.select()` porque escrita sem erro conferido e escrita que voce ACHA
      // que fez — e esta em particular tem valor juridico.
      const { data: marcados, error: erroOptout } = await admin
        .from("contacts")
        .update({
          do_not_contact: true,
          do_not_contact_reason: `Pediu pelo WhatsApp: "${msg.texto.slice(0, 180)}"`,
        })
        .eq("id", contactId)
        .eq("tenant_id", tenantId)
        .select("id");

      if (erroOptout) {
        console.error(`[whatsapp] PEDIDO DE DESCADASTRO NAO GRAVADO de ${msg.de}: ${erroOptout.message}`);
      } else if (!marcados || marcados.length === 0) {
        console.error(`[whatsapp] PEDIDO DE DESCADASTRO sem linha alcancada de ${msg.de}`);
      } else {
        console.info(`[whatsapp] descadastro honrado para ${msg.de} — frase: "${pedido}"`);
      }
    }
  }
}

export const GET = handle(app);
export const POST = handle(app);
