"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getActiveTenant } from "@/lib/auth";
import { getSkillFormConfig } from "@/lib/skill";
import {
  calcularVagas, escolherOpcoes, descreverVaga,
  type RegraJornada, type Bloqueio, type Compromisso, type Vaga,
} from "@/lib/scheduling";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

/**
 * Vagas livres da empresa (ou de um profissional). É o que permite o motor
 * oferecer horário concreto em vez de escalar para um humano.
 */
export async function buscarVagas(input: {
  membershipId?: string | null;
  duracaoMin?: number;
  dias?: number;
  limite?: number;
}): Promise<Vaga[]> {
  const membership = await getActiveTenant();
  const tenant = membership?.tenant;
  if (!tenant) return [];

  const { scheduling } = await getSkillFormConfig(tenant.skill_key);
  if (!scheduling?.enabled) return [];

  const supabase = await createClient();
  const agora = new Date();
  const fim = new Date(agora.getTime() + (input.dias ?? 14) * 24 * 3600 * 1000);

  const [{ data: regras }, { data: blocos }, { data: compromissos }] = await Promise.all([
    supabase.from("availability_rules").select("membership_id, weekday, starts_at, ends_at").eq("tenant_id", tenant.id).eq("active", true),
    supabase.from("availability_blocks").select("membership_id, starts_at, ends_at").eq("tenant_id", tenant.id).lt("starts_at", fim.toISOString()).gt("ends_at", agora.toISOString()),
    supabase.from("appointments").select("membership_id, starts_at, duration_min").eq("tenant_id", tenant.id).in("status", ["agendado", "confirmado"]).gte("starts_at", agora.toISOString()).lt("starts_at", fim.toISOString()),
  ]);

  return calcularVagas({
    regras: (regras as RegraJornada[] | null) ?? [],
    bloqueios: (blocos as Bloqueio[] | null) ?? [],
    compromissos: (compromissos as Compromisso[] | null) ?? [],
    duracaoMin: input.duracaoMin ?? scheduling.default_duration_min ?? 30,
    cfg: scheduling,
    dias: input.dias ?? 14,
    membershipId: input.membershipId ?? null,
    limite: input.limite ?? 60,
  });
}

/**
 * As 2 ou 3 melhores opções, já em texto — para o motor oferecer.
 *
 * Quem decide se sai hora ou turno é o MANIFESTO, não esta função: é dado do
 * ramo, e o núcleo não pode saber que academia é acesso livre e barbearia
 * não. Por isso a config é lida aqui e repassada às duas funções puras.
 */
export async function opcoesDeHorario(quantas = 3, membershipId?: string | null): Promise<string[]> {
  const membership = await getActiveTenant();
  if (!membership?.tenant) return [];
  const { scheduling } = await getSkillFormConfig(membership.tenant.skill_key);
  const porTurno = scheduling?.offer_by_turno === true;

  const vagas = await buscarVagas({ membershipId, limite: 40 });
  return escolherOpcoes(vagas, quantas, porTurno).map((v) => descreverVaga(v, porTurno));
}

/** Marca o compromisso, recusando se o horário já tiver sido tomado. */
export async function marcarCompromisso(input: {
  contactId: string;
  quandoISO: string;
  duracaoMin?: number;
  membershipId?: string | null;
  servico?: string;
  origem?: "manual" | "motor" | "cliente";
  /**
   * A empresa, quando quem marca é a MÁQUINA e não há sessão.
   *
   * ⚠ MESMO CAMINHO, CLIENTE DIFERENTE — a regra de `lib/despacho.ts`. Copiar
   * a checagem de conflito para um arquivo novo criaria duas agendas
   * divergindo em silêncio, e a que erra seria a que ninguém está olhando.
   */
  semSessao?: { tenantId: string; skillKey: string };
}): Promise<{ ok: boolean; error?: string }> {
  const membership = input.semSessao ? null : await getActiveTenant();
  const tenant = input.semSessao
    ? { id: input.semSessao.tenantId, skill_key: input.semSessao.skillKey }
    : membership?.tenant;
  if (!tenant) return { ok: false, error: "Sem empresa vinculada." };

  const { scheduling } = await getSkillFormConfig(
    tenant.skill_key,
    input.semSessao ? createAdminClient() : undefined,
  );
  const duracao = input.duracaoMin ?? scheduling?.default_duration_min ?? 30;
  const inicio = new Date(input.quandoISO);
  if (Number.isNaN(inicio.getTime())) return { ok: false, error: "Horário inválido." };
  const fim = new Date(inicio.getTime() + duracao * 60000);

  const supabase = input.semSessao ? createAdminClient() : await createClient();
  // Sem profissional informado, o compromisso vai para o responsável pelo
  // contato — é a agenda dele que foi consultada para oferecer o horário.
  let executor = input.membershipId ?? null;
  if (!executor && input.contactId) {
    const { data: dono } = await supabase
      .from("contacts").select("owner_id").eq("id", input.contactId).eq("tenant_id", tenant.id).maybeSingle();
    executor = (dono as { owner_id: string | null } | null)?.owner_id ?? null;
  }

  // Confere se ainda está livre — dois atendentes podem marcar ao mesmo tempo.
  const { data: existentes } = await supabase
    .from("appointments")
    .select("starts_at, duration_min, membership_id")
    .eq("tenant_id", tenant.id)
    .in("status", ["agendado", "confirmado"])
    .gte("starts_at", new Date(inicio.getTime() - 4 * 3600000).toISOString())
    .lte("starts_at", fim.toISOString());

  const conflito = ((existentes as { starts_at: string; duration_min: number; membership_id: string | null }[] | null) ?? [])
    .filter((a) => !executor || !a.membership_id || a.membership_id === executor)
    .some((a) => {
      const aIni = new Date(a.starts_at);
      const aFim = new Date(aIni.getTime() + (a.duration_min || 30) * 60000);
      return inicio < aFim && aIni < fim;
    });

  if (conflito) return { ok: false, error: "Esse horário acabou de ser ocupado. Escolha outro." };

  const { error } = await supabase.from("appointments").insert({
    tenant_id: tenant.id,
    contact_id: input.contactId || null,
    membership_id: executor,
    service: input.servico ?? null,
    starts_at: inicio.toISOString(),
    duration_min: duracao,
    origem: input.origem ?? "manual",
    // Sem autor quando quem marcou foi a máquina: creditar a um vendedor um
    // compromisso que ele não marcou estragaria o placar que a equipe lê.
    created_by: membership?.membershipId ?? null,
  });
  if (error) return { ok: false, error: error.message };

  // ⚠ MARCOU, COMEÇOU — a etapa que o manifesto declara em `starts_stage`.
  //
  // Sem isto, a régua dos oito primeiros dias nunca começava: ela conta a
  // partir da entrada na etapa, e nada colocava ninguém lá. O sistema
  // conversava até o "pode ser quinta", marcava, e a pessoa seguia como lead.
  //
  // ⚠ SÓ AVANÇA QUEM AINDA NÃO CHEGOU. Quem já é cliente, já está na etapa ou
  // já saiu não volta para trás por ter marcado um horário — regredir a etapa
  // de um matriculado faria a régua dele recomeçar do zero, e o funil contaria
  // a mesma pessoa duas vezes.
  //
  // Best-effort: falhar aqui não desfaz o compromisso, e compromisso marcado
  // vale mais que rótulo certo.
  const etapaDoAgendamento = scheduling?.starts_stage;
  if (etapaDoAgendamento && input.contactId) {
    const { stages } = await getSkillFormConfig(
      tenant.skill_key,
      input.semSessao ? createAdminClient() : undefined,
    );
    const ordem = stages.map((e) => e.key);
    const destino = ordem.indexOf(etapaDoAgendamento);
    // paginacao-ok: uma linha, endereçada pela chave primária do contato.
    const { data: atual } = await supabase
      .from("contacts")
      .select("journey_stage")
      .eq("id", input.contactId)
      .eq("tenant_id", tenant.id)
      .maybeSingle();
    const agora = (atual as { journey_stage: string } | null)?.journey_stage ?? "";
    const posicao = ordem.indexOf(agora);
    if (destino >= 0 && posicao >= 0 && posicao < destino) {
      // paginacao-ok: UPDATE de UMA linha, endereçada por chave primária.
      const { error: erroEtapa } = await supabase
        .from("contacts")
        .update({ journey_stage: etapaDoAgendamento, stage_entered_at: new Date().toISOString() })
        .eq("id", input.contactId)
        .eq("tenant_id", tenant.id)
        .select("id");
      if (erroEtapa) {
        console.warn(`[agenda] marquei mas nao avancei a etapa de ${input.contactId}: ${erroEtapa.message}`);
      }
    }
  }

  // ⚠ `revalidatePath` É API DE REQUISIÇÃO. A resposta automática roda em
  // `after()`, fora de qualquer render — chamá-lo lá quebraria o trabalho já
  // feito. É a mesma nota de `lib/despacho.ts`: quem tem tela invalida a tela.
  if (!input.semSessao) {
    revalidatePath("/painel/agenda");
    revalidatePath(`/painel/contatos/${input.contactId}`);
  }
  return { ok: true };
}

/**
 * Define a jornada de trabalho (substitui a anterior).
 *
 * `profissional` vazio = jornada da empresa (vale para quem não tem a própria).
 * Preenchido = jornada daquele profissional, que passa a ter prioridade sobre
 * a da empresa. É assim que uma barbearia com 5 barbeiros funciona: cada um
 * com seus dias e horários.
 */
export async function salvarJornada(formData: FormData) {
  const membership = await getActiveTenant();
  const tenant = membership?.tenant;
  if (!tenant) redirect("/painel");

  const alvo = String(formData.get("profissional") ?? "").trim() || null;
  const ehAdmin = membership!.role === "owner" || membership!.role === "admin";
  // Cada um pode editar a própria agenda; só o administrador mexe na dos outros
  // e na da empresa.
  if (!ehAdmin && alvo !== membership!.membershipId) {
    redirect("/painel/agenda?erro=Sem+permissao");
  }

  const supabase = await createClient();
  const del = supabase.from("availability_rules").delete().eq("tenant_id", tenant.id);
  await (alvo ? del.eq("membership_id", alvo) : del.is("membership_id", null));

  const linhas: Record<string, unknown>[] = [];
  for (let d = 0; d <= 6; d++) {
    if (formData.get(`ativo_${d}`) !== "on") continue;
    const inicio = String(formData.get(`inicio_${d}`) ?? "").trim();
    const fim = String(formData.get(`fim_${d}`) ?? "").trim();
    if (!inicio || !fim || fim <= inicio) continue;
    linhas.push({ tenant_id: tenant.id, membership_id: alvo, weekday: d, starts_at: inicio, ends_at: fim, active: true });
  }

  if (linhas.length) await supabase.from("availability_rules").insert(linhas);

  revalidatePath("/painel/agenda");
  redirect(`/painel/agenda?ok=jornada${alvo ? `&prof=${alvo}` : ""}`);
}

/** Folga, almoço, feriado — tira o período da agenda de quem for indicado. */
export async function bloquearHorario(formData: FormData) {
  const membership = await getActiveTenant();
  const tenant = membership?.tenant;
  if (!tenant) redirect("/painel");

  const alvo = String(formData.get("profissional") ?? "").trim() || null;
  const ehAdmin = membership!.role === "owner" || membership!.role === "admin";
  if (!ehAdmin && alvo !== membership!.membershipId) {
    redirect("/painel/agenda?erro=Sem+permissao");
  }

  const dia = String(formData.get("dia") ?? "").trim();
  const de = String(formData.get("de") ?? "").trim();
  const ate = String(formData.get("ate") ?? "").trim();
  const motivo = String(formData.get("motivo") ?? "").trim() || null;
  if (!dia || !de || !ate || ate <= de) {
    redirect("/painel/agenda?erro=Periodo+invalido");
  }

  const supabase = await createClient();
  await supabase.from("availability_blocks").insert({
    tenant_id: tenant.id,
    membership_id: alvo,
    starts_at: new Date(`${dia}T${de}`).toISOString(),
    ends_at: new Date(`${dia}T${ate}`).toISOString(),
    reason: motivo,
  });

  revalidatePath("/painel/agenda");
  redirect("/painel/agenda?ok=bloqueio");
}

export async function removerBloqueio(formData: FormData) {
  const membership = await getActiveTenant();
  const tenant = membership?.tenant;
  if (!tenant) redirect("/painel");
  const id = String(formData.get("id") ?? "");
  if (id) {
    const supabase = await createClient();
    await supabase.from("availability_blocks").delete().eq("id", id).eq("tenant_id", tenant.id);
  }
  revalidatePath("/painel/agenda");
  redirect("/painel/agenda");
}

export async function cancelarCompromisso(formData: FormData) {
  const membership = await getActiveTenant();
  const tenant = membership?.tenant;
  if (!tenant) redirect("/painel");
  const id = String(formData.get("id") ?? "");
  const voltar = String(formData.get("back") ?? "/painel/agenda");
  if (id) {
    const supabase = await createClient();
    await supabase.from("appointments").update({ status: "cancelado", updated_at: new Date().toISOString() }).eq("id", id).eq("tenant_id", tenant.id);
  }
  revalidatePath(voltar);
  redirect(voltar);
}
