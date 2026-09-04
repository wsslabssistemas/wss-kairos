"use server";

import { createClient } from "@/lib/supabase/server";
import { getActiveTenant } from "@/lib/auth";
import { readAutomation, type AutomationSettings } from "@/lib/automation";
import { MOTIVOS } from "@/lib/roteamento";
import { parseMoneyToCents } from "@/lib/money";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

export async function saveAutomation(formData: FormData) {
  const membership = await getActiveTenant();
  const tenant = membership?.tenant;
  if (!tenant) redirect("/painel");
  // Só owner/admin muda a política da empresa (a RLS de tenants exige isso também).
  if (!["owner", "admin"].includes(membership!.role)) {
    redirect("/painel/automacao?erro=Sem+permissao");
  }

  const supabase = await createClient();
  const { data: cur } = await supabase
    .from("tenants")
    .select("settings")
    .eq("id", tenant.id)
    .maybeSingle();

  const num = (k: string) => Number(formData.get(k));
  const incoming: AutomationSettings = readAutomation({
    automation: {
      mode: String(formData.get("mode") ?? "off"),
      max_per_day: num("max_per_day"),
      min_hours_between: num("min_hours_between"),
      max_no_reply: num("max_no_reply"),
      cooldown_hours: num("cooldown_hours"),
      window_start: num("window_start"),
      window_end: num("window_end"),
      stop_after_days: num("stop_after_days"),
      reativacao_max_dias: num("reativacao_max_dias"),
      max_por_rodada: num("max_por_rodada"),
      pausa_entre_envios_seg: num("pausa_entre_envios_seg"),
      min_minutos_entre_rodadas: num("min_minutos_entre_rodadas"),
      monthly_budget_credits: num("monthly_budget_credits"),
    },
  });

  // ⚠ A CHAVE DA FASE 2 NÃO PASSA POR `readAutomation`, e é de propósito: ele
  // normaliza números e modo, e um booleano que some no meio disso vira "a
  // resposta automática desligou sozinha ao salvar outro campo" — que é
  // exatamente o defeito que o `teto_mensagens_mes_cents` já pagou logo abaixo.
  const respostaAutomatica = formData.get("resposta_automatica") === "on";

  const settingsAtuais = (cur?.settings as Record<string, unknown> | null) ?? {};

  // ⚠ MESCLAR, NUNCA SUBSTITUIR — e a versão anterior substituía.
  //
  // `readAutomation` devolve só os campos que ele conhece. Gravar o
  // resultado dele por cima de `automation` apaga tudo o que mora ali e não
  // está neste formulário — hoje `canal_por_motivo` e `modelos`, amanhã o que
  // vier. E apaga em silêncio: a tela diz "salvo", o roteamento volta ao
  // padrão, e a empresa descobre quando a reativação sair pelo número errado.
  //
  // É a irmã da regra do formulário que regrava valor velho por cima do novo:
  // lá o problema era o campo reenviar o que já existe, aqui é o gravador
  // esquecer o que existe. Nos dois o sintoma é o mesmo — perda silenciosa
  // numa tela que reportou sucesso.
  const automacaoAtual = (settingsAtuais.automation as Record<string, unknown> | null) ?? {};
  const settings = {
    ...settingsAtuais,
    automation: { ...automacaoAtual, ...incoming, resposta_automatica: respostaAutomatica },
  };

  const { error } = await supabase
    .from("tenants")
    .update({ settings })
    .eq("id", tenant.id);

  if (error) redirect(`/painel/automacao?erro=${encodeURIComponent(error.message)}`);
  revalidatePath("/painel/automacao");
  redirect("/painel/automacao?salvo=1");
}

/**
 * POR ONDE CADA MOTIVO SAI, e qual modelo aprovado ele usa.
 *
 * Ação separada da política de automação de propósito: são decisões de níveis
 * diferentes e com consequências diferentes. Mudar `max_per_day` altera o
 * ritmo; mudar o roteamento altera **o número que o cliente final vê** e
 * liga o relógio do custo por mensagem. Juntar as duas num formulário só faria
 * um salvamento de rotina carregar a decisão cara junto.
 */
/**
 * Teto de campos de modelo lidos do formulário.
 *
 * ⚠ Ele existe só para o laço não depender do que veio no `FormData` — régua
 * curada com mais passos que isto é lacuna de manifesto, não de tela, e nenhum
 * segmento declara perto disso. Ver `MAX_TOQUES_SEM_CADENCIA`.
 */
const LIMITE_DE_TOQUES = 12;

export async function salvarRoteamento(formData: FormData) {
  const membership = await getActiveTenant();
  const tenant = membership?.tenant;
  if (!tenant) redirect("/painel");
  if (!["owner", "admin"].includes(membership!.role)) {
    redirect("/painel/automacao?erro=Sem+permissao");
  }

  const supabase = await createClient();
  const { data: cur } = await supabase
    .from("tenants")
    .select("settings")
    .eq("id", tenant.id)
    .maybeSingle();

  const canal: Record<string, boolean> = {};
  const modelos: Record<string, string[]> = {};
  for (const m of MOTIVOS) {
    canal[m] = formData.get(`canal_${m}`) === "on";
    // ⚠ UM CAMPO POR TOQUE, e a POSIÇÃO é o número do toque. O campo vazio do
    // meio é guardado vazio de propósito: compactar promoveria o modelo do 3º
    // toque para o 2º — texto errado, no momento errado, com cara de acerto.
    const lista: string[] = [];
    for (let i = 0; i < LIMITE_DE_TOQUES; i++) {
      const bruto = formData.get(`modelo_${m}_${i}`);
      if (bruto === null) break;
      lista.push(String(bruto).trim());
    }
    while (lista.length > 0 && !lista[lista.length - 1]) lista.pop();
    if (lista.some((x) => x)) modelos[m] = lista;
  }

  // Campo em REAIS na tela, centavos no banco — a regra de `lib/money.ts`.
  // Vazio ou zero significa SEM TETO, que e o padrao declarado.
  const tetoBruto = String(formData.get('teto_mensagens') ?? '').trim();
  const tetoCents = tetoBruto ? parseMoneyToCents(tetoBruto) ?? 0 : 0;

  const settingsAtuais = (cur?.settings as Record<string, unknown> | null) ?? {};
  const automacaoAtual = (settingsAtuais.automation as Record<string, unknown> | null) ?? {};

  const { error } = await supabase
    .from("tenants")
    .update({
      settings: {
        ...settingsAtuais,
        automation: {
          ...automacaoAtual,
          canal_por_motivo: canal,
          modelos,
          // Guardado aqui e NAO em `readAutomation`: se estivesse la, salvar
          // as regras anti-bloqueio zeraria o teto em silencio. Ver a nota em
          // `lerTetoDeMensagens`.
          teto_mensagens_mes_cents: tetoCents,
        },
      },
    })
    .eq("id", tenant.id);

  if (error) redirect(`/painel/automacao?erro=${encodeURIComponent(error.message)}`);
  revalidatePath("/painel/automacao");
  revalidatePath("/painel/fila");
  redirect("/painel/automacao?salvo=1");
}
