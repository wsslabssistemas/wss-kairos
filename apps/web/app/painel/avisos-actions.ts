"use server";

import { createClient } from "@/lib/supabase/server";
import { getActiveTenant } from "@/lib/auth";

/**
 * A ÚLTIMA MENSAGEM QUE CHEGOU PELO CANAL — a consulta mais barata possível.
 *
 * ⚠ ELA É CHAMADA A CADA 30 SEGUNDOS, EM TODA TELA DO PAINEL. Por isso lê UMA
 * linha, endereçada por índice, sem juntar nada além do nome. Qualquer coisa
 * mais pesada aqui vira custo permanente de banco multiplicado por cada pessoa
 * com o sistema aberto o dia inteiro.
 *
 * ⚠ E ELA SÓ OLHA O QUE PASSOU PELA META (`external_id`). Mensagem registrada
 * à mão pela equipe não é "chegou agora": é alguém digitando o que aconteceu
 * no WhatsApp pessoal dele. Avisar sobre isso faria o aviso tocar o dia
 * inteiro sem nada novo — e aviso que toca à toa é aviso que se desliga.
 */
export async function ultimaEntradaDoCanal(): Promise<{
  ok: true;
  quando: string | null;
  nome: string;
  contactId: string | null;
} | { ok: false }> {
  const membership = await getActiveTenant();
  const tenant = membership?.tenant;
  if (!tenant) return { ok: false };

  const supabase = await createClient();
  // paginacao-ok: UMA linha, a mais recente, endereçada por índice.
  const { data } = await supabase
    .from("interactions")
    .select("occurred_at, contact_id, contacts(name)")
    .eq("tenant_id", tenant.id)
    .eq("direction", "inbound")
    .not("external_id", "is", null)
    .order("occurred_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const linha = data as {
    occurred_at: string;
    contact_id: string | null;
    contacts: { name: string } | { name: string }[] | null;
  } | null;

  if (!linha) return { ok: true, quando: null, nome: "", contactId: null };

  const nome =
    (Array.isArray(linha.contacts) ? linha.contacts[0]?.name : linha.contacts?.name) ??
    "alguém";

  return { ok: true, quando: linha.occurred_at, nome, contactId: linha.contact_id };
}
