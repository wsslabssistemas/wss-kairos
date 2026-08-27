"use server";

import { createClient } from "@/lib/supabase/server";
import { getActiveTenant } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

// Vincula o atendimento ao cliente: grava a mensagem recebida (inbound) e, se
// houver, a resposta enviada (outbound). É a base do histórico — o mesmo que o
// Base44 usa para "não repetir abordagem" e que o motor de IA lerá no futuro.
export async function logInteraction(formData: FormData) {
  const membership = await getActiveTenant();
  const tenant = membership?.tenant;
  if (!tenant) redirect("/painel");

  const contactId = String(formData.get("contact_id") ?? "").trim();
  const inbound = String(formData.get("inbound") ?? "").trim();
  const outbound = String(formData.get("outbound") ?? "").trim();
  if (!contactId || (!inbound && !outbound)) {
    redirect(`/painel/responder${contactId ? `?customer=${contactId}` : ""}`);
  }

  const supabase = await createClient();
  const base = {
    tenant_id: tenant.id,
    contact_id: contactId,
    created_by: membership!.membershipId,
    channel: "whatsapp",
  };

  const rows: Record<string, unknown>[] = [];
  // ⚠ `agent_note`: digitado pela equipe, não dito pela cliente. Ver `0068` —
  // gravar briefing como fala do cliente fazia o tempo de resposta parecer
  // melhor do que é, porque a pessoa respondia a si mesma em segundos.
  if (inbound)
    rows.push({ ...base, direction: "inbound", input_kind: "agent_note", content: inbound });
  if (outbound)
    rows.push({ ...base, direction: "outbound", input_kind: "agent_briefing", content: outbound });

  if (rows.length) await supabase.from("interactions").insert(rows);

  revalidatePath(`/painel/responder`);
  revalidatePath(`/painel/contatos/${contactId}`);
  redirect(`/painel/responder?customer=${contactId}&salvo=1`);
}
