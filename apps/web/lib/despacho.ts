import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ROTULO, type MotivoDaFila } from "@/lib/fila";
import { credencialDoCanal } from "@/lib/credenciais";
import { lerRoteamento, lerModelos, rotaDoToque } from "@/lib/roteamento";
import { janelaDeAtendimento } from "@/lib/whatsapp-webhook";
import { enviarPelaCloudAPI, enviarModeloPelaCloudAPI } from "@/lib/envio";
import { primeiroNome, higienizarParametro } from "@/lib/modelo";
import { paraE164BR } from "@/lib/phone";
import { registrarEnvio, gastoDeMensagensNoMes } from "@/lib/custo_mensagem-db";
import { avaliarTetoDeMensagens, lerTetoDeMensagens } from "@/lib/custo_mensagem";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ClienteSupabase = SupabaseClient<any, any, any>;

// ⚠ POR QUE ESTE ARQUIVO EXISTE, e por que ele recebe o CLIENTE por parâmetro.
//
// O envio pelo número da empresa nasceu dentro da ação da fila, amarrado a
// `getActiveTenant()` — ou seja, a uma sessão de usuário. O motor proativo não
// tem sessão: ele roda num job, sem ninguém logado. Copiar a função para o
// motor criaria dois caminhos de envio com as mesmas seis travas escritas duas
// vezes, e elas divergiriam na primeira correção feita só de um lado. É o
// defeito de `phases` × `cadence` outra vez, agora no lugar mais caro: o que
// manda mensagem em nome do cliente pagante.
//
// Então o núcleo é um só, e quem chama traz o CLIENTE que tem:
//   • a tela passa o cliente do usuário, com RLS ligada;
//   • o motor passa o admin, porque não há `auth.uid()` para a RLS avaliar.
// O `tenant_id` é explícito em toda consulta nos dois casos — a RLS é a defesa,
// nunca a única.

// =====================================================================
// ENVIO PELO NÚMERO DO SISTEMA — o que fecha o ciclo.
//
// Até aqui a fila preparava o texto e uma PESSOA clicava no `wa.me`. Esta ação
// é o outro caminho: o toque sai pelo número oficial da empresa, pela Cloud
// API, e volta com o identificador da Meta.
//
// ⚠ ELA NÃO SUBSTITUI O CAMINHO HUMANO, E NÃO PODE. O roteamento
// (`lib/roteamento.ts`) decide por motivo, e o padrão manda quase tudo pelo
// link — porque a operação corrente já tem uma conversa aberta com uma PESSOA,
// e trocar o número no meio dela é o defeito que o fundador nomeou em 16/ago.
//
// A ORDEM DAS TRAVAS aqui não é estética; cada uma nasceu de um defeito desta
// casa:
//   1. rota → nunca enviar pelo número errado por engano;
//   2. telefone → `paraE164BR` deriva e nunca grava;
//   3. variáveis do modelo → a Meta recusa quebra de linha e caixa alta veio
//      da planilha da academia;
//   4. envio;
//   5. **registro da interação** — sem ele a cadência não quita e a pessoa
//      volta amanhã, que é o defeito do `combinado` de novo;
//   6. **registro do custo** — o segundo bolso, que o teto de IA não vê.
//
// O passo 5 acontece mesmo que o 6 falhe: medição é best-effort, entrega não.
// =====================================================================

export type EnvioResult =
  | { ok: true; id: string; modelo: string | null }
  | { ok: false; motivo: string; limitePorUsuario?: boolean };

export async function despacharToque(entrada: {
  /** O cliente do Supabase. A tela passa o do USUÁRIO (RLS); o motor, o admin. */
  supabase: ClienteSupabase;
  tenantId: string;
  tenantNome: string;
  /** Quem fica como autor. `null` quando quem despacha é o motor. */
  membershipId: string | null;
  contactId: string;
  motivo: MotivoDaFila;
  /** O texto gerado. Só é usado DENTRO da janela de 24h. */
  texto: string;
}): Promise<EnvioResult> {
  const { supabase, tenantId, tenantNome, membershipId, contactId, motivo, texto } = entrada;
  if (!contactId) return { ok: false, motivo: "Contato não informado." };

  const [{ data: c }, { data: settingsRow }, credencial] = await Promise.all([
    supabase.from("contacts").select("name, phone, next_action_at, contract_end")
      .eq("id", contactId).eq("tenant_id", tenantId).maybeSingle(),
    supabase.from("tenants").select("settings, name").eq("id", tenantId).maybeSingle(),
    credencialDoCanal(tenantId),
  ]);

  const contact = c as {
    name: string; phone: string | null;
    next_action_at: string | null; contract_end: string | null;
  } | null;
  if (!contact) return { ok: false, motivo: "Contato não encontrado." };

  // A ÚLTIMA MENSAGEM DELE decide a janela de 24h, e só ela: `direction`
  // inbound. Usar a última interação de qualquer direção faria a nossa própria
  // mensagem reabrir a janela — e a Meta recusaria o texto livre seguinte com
  // um erro que se lê como "credencial errada".
  //
  // ⚠ E SÓ O QUE CHEGOU PELA META ABRE A JANELA DELA — `external_id` não nulo.
  // A janela de 24h é um conceito da Meta: quem a abre é uma mensagem que
  // passou pelo canal oficial. Duas coisas eram contadas aqui e não deveriam:
  // o briefing que a equipe digita na aba Responder ("faça uma proposta de
  // retorno para a aluna"), e a conversa que o vendedor teve no WhatsApp
  // pessoal dele e registrou à mão. Nenhuma das duas abre nada no número do
  // sistema — mas as duas faziam este código concluir que a janela estava
  // aberta, mandar TEXTO LIVRE, e a Meta recusar.
  //
  // ⚠ E A RECUSA SE LÊ COMO "CREDENCIAL ERRADA", como diz a nota acima. Ou
  // seja: uma anotação interna podia derrubar um envio e mandar quem fosse
  // investigar olhar o token. Errar para o lado de "janela fechada" é seguro —
  // manda modelo aprovado, que sempre passa.
  const { data: ultimaEntrada } = await supabase
    .from("interactions").select("occurred_at")
    .eq("tenant_id", tenantId).eq("contact_id", contactId).eq("direction", "inbound")
    .not("external_id", "is", null)
    .order("occurred_at", { ascending: false }).limit(1).maybeSingle();

  const janela = janelaDeAtendimento((ultimaEntrada as { occurred_at: string } | null)?.occurred_at);
  const settings = (settingsRow as { settings: unknown; name: string } | null)?.settings;

  const rota = rotaDoToque({
    motivo,
    roteamento: lerRoteamento(settings),
    temCredencial: !!credencial,
    janelaAberta: janela.aberta,
    modelos: lerModelos(settings),
  });

  if (rota.via === "link_humano") return { ok: false, motivo: rota.porque };
  if (rota.via === "bloqueado") return { ok: false, motivo: rota.porque };

  // ---------------------------------------------- O FREIO DE CUSTO
  //
  // ⚠ VERIFICAR ANTES DA CHAMADA, NUNCA DEPOIS — a mesma regra da cota de IA.
  // Verificar depois é medir o prejuízo: a mensagem já saiu e a conta já
  // existe.
  //
  // E este teto só freia o que ELE governa: o disparo pelo número do sistema.
  // Bloqueado, a fila continua funcionando pelo `wa.me`, que não passa pela
  // Meta e não custa nada. Bloqueio não é erro — é a mesma regra 1 da cota.
  //
  // ⚠ Ele NÃO se soma ao teto de IA de propósito. Lá o freio é parar de gerar,
  // e isso só é um degrau seguro porque o manual custa zero. Se os dois
  // dividissem o mesmo número, estourar por causa de mensagem desligaria a IA
  // — e as mensagens continuariam saindo, que é o freio errado puxado com
  // força. Ver `lib/custo_mensagem.ts`.
  const teto = lerTetoDeMensagens(settings);
  if (teto !== null) {
    const gasto = await gastoDeMensagensNoMes(tenantId);
    const veredito = avaliarTetoDeMensagens(gasto.gastoCents, teto);
    if (!veredito.ok) return { ok: false, motivo: veredito.motivo };
  }

  const num = paraE164BR(contact.phone);
  if (!num.ok) return { ok: false, motivo: num.motivo };

  let resultado: { ok: true; id: string } | { ok: false; motivo: string; limitePorUsuario?: boolean };
  let modeloUsado: string | null = null;

  if (rota.via === "cloud_api_texto") {
    if (!texto.trim()) return { ok: false, motivo: "Sem texto para enviar." };
    resultado = await enviarPelaCloudAPI(num.digitos, texto, credencial!);
  } else {
    modeloUsado = rota.modelo;
    const nome = primeiroNome(contact.name);
    if (!nome.ok) return { ok: false, motivo: nome.motivo };

    const empresa = higienizarParametro(tenantNome);
    if (!empresa.ok) return { ok: false, motivo: "Empresa sem nome — o modelo abre com ele." };

    const parametros = [nome.valor, empresa.valor];

    // ⚠ A TRAVA ANTI-INVENÇÃO APLICADA AO CANAL. Dois modelos afirmam uma
    // DATA, e não existe valor padrão aceitável para ela: sem o fato, a
    // mensagem não sai. É a mesma regra do motor — falta fato exigido, não
    // redige — só que aqui a consequência de inventar sairia no nome da
    // empresa, para um cliente pagante.
    const dataExigida: Partial<Record<MotivoDaFila, string | null>> = {
      combinado: contact.next_action_at,
      renovacao: contact.contract_end,
    };
    if (motivo in dataExigida) {
      const iso = dataExigida[motivo];
      if (!iso) {
        return {
          ok: false,
          motivo:
            `O modelo de "${ROTULO[motivo]}" afirma uma data, e este contato não tem essa data ` +
            `registrada. Não dá para enviar sem inventar — preencha a ficha ou envie à mão.`,
        };
      }
      parametros.push(porExtenso(iso));
    }

    resultado = await enviarModeloPelaCloudAPI(num.digitos, rota.modelo, parametros, credencial!);
  }

  if (!resultado.ok) {
    return { ok: false, motivo: resultado.motivo, limitePorUsuario: resultado.limitePorUsuario };
  }

  // ---------------------------------------------- 5. A INTERAÇÃO
  // A mensagem JÁ SAIU. Falhar aqui não desfaz o envio, então o erro sobe para
  // a tela em vez de sumir: sem registro a cadência não quita, a pessoa volta
  // amanhã e o vendedor conclui que a fila não funciona.
  const { error: e1 } = await supabase.from("interactions").insert({
    tenant_id: tenantId,
    contact_id: contactId,
    direction: "outbound",
    input_kind: "system_initiated",
    channel: "whatsapp",
    external_id: resultado.id,
    content: modeloUsado ? `(modelo "${modeloUsado}")` : texto,
    occurred_at: new Date().toISOString(),
    created_by: membershipId,
  });
  if (e1) {
    console.error(`[fila] mensagem ${resultado.id} SAIU mas não registrou: ${e1.message}`);
    return {
      ok: false,
      motivo:
        `A mensagem foi enviada, mas eu não consegui registrar isso: ${e1.message}. ` +
        `Anote o contato — ele vai reaparecer na fila amanhã.`,
    };
  }

  // ---------------------------------------------- 6. O CUSTO
  // Best-effort, e é a diferença certa: medição que falha custa um número no
  // painel; entrega que falha custa a conversa.
  await registrarEnvio(tenantId, { temModelo: !!modeloUsado });

  // ⚠ NADA DE `revalidatePath` AQUI. Ele é API de Next e o motor proativo
  // roda fora de qualquer requisição — chamá-lo lá quebraria o job. Quem tem
  // tela invalida a tela; o núcleo só devolve o que aconteceu.
  return { ok: true, id: resultado.id, modelo: modeloUsado };
}

/** "2026-08-24" → "24 de agosto". O modelo afirma a data; ela sai legível. */
function porExtenso(iso: string): string {
  const MES = [
    "janeiro", "fevereiro", "março", "abril", "maio", "junho",
    "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
  ];
  // Fatiar a string em vez de `new Date(iso)`: data pura interpretada como UTC
  // e exibida em fuso local vira o dia anterior — armadilha conhecida aqui.
  const [a, m, d] = iso.slice(0, 10).split("-").map(Number);
  if (!a || !m || !d) return iso.slice(0, 10);
  return `${d} de ${MES[m - 1]}`;
}
