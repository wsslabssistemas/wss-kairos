"use server";

import { createClient } from "@/lib/supabase/server";
import { getActiveTenant } from "@/lib/auth";
import { gerarResposta } from "../responder/ai-actions";
import { revalidatePath } from "next/cache";

/**
 * O BANCO DE PROVAS — a medição que decide se o automático pode existir.
 *
 * ⚠ UMA MENSAGEM POR VEZ, e isso não é preguiça de interface.
 *
 * Gerar 30 sugestões numa tacada estoura o tempo da função (30 × ~3s) e a
 * Vercel mata a chamada no meio, devolvendo silêncio — a mesma classe do
 * `maxDuration` que já mordeu aqui. Uma por vez também deixa parar quando
 * cansar, e o placar continua valendo: 12 julgamentos são 12 julgamentos.
 *
 * ⚠ E ELA NUNCA ENVIA NADA. Este arquivo não importa `despacho`. A sugestão é
 * gerada, mostrada e jogada fora se ninguém julgar — é o ponto inteiro de
 * medir contra mensagem real sem arriscar pessoa real.
 */

export type Prova = {
  interactionId: string;
  contactId: string;
  nome: string;
  quando: string;
  mensagem: string;
  sugestao: string;
  escalou: boolean;
  faltamFatos: string[];
};

export type ProximaResult =
  | { ok: true; prova: Prova }
  | { ok: false; acabou: true; mensagem: string }
  | { ok: false; acabou?: false; erro: string };

/**
 * Pega a próxima mensagem real ainda não julgada e roda o motor nela.
 *
 * ⚠ UMA POR CONTATO, das mais recentes para as mais antigas. Sem isso, uma
 * conversa longa de uma pessoa só ocuparia as 30 provas e o placar mediria o
 * desempenho da IA **com um cliente**, não com a operação.
 */
export async function proximaProva(): Promise<ProximaResult> {
  const membership = await getActiveTenant();
  const tenant = membership?.tenant;
  if (!tenant) return { ok: false, erro: "Sem empresa vinculada." };
  if (!["owner", "admin"].includes(membership!.role)) {
    return { ok: false, erro: "Só quem é dono ou admin pode julgar as provas." };
  }

  const supabase = await createClient();

  // O que já foi julgado sai da fila. `lerTudo` não entra aqui de propósito:
  // são os julgamentos DESTE tenant, e o teto de 1.000 é maior que qualquer
  // banco de provas que uma pessoa consiga julgar à mão.
  // paginacao-ok: uma pessoa julga dezenas, não milhares — e o dia em que
  // passar de 1.000 provas é o dia em que a medição já respondeu de sobra.
  const { data: feitas } = await supabase
    .from("provas")
    .select("interaction_id")
    .eq("tenant_id", tenant.id)
    .limit(1000);

  const julgadas = new Set(
    ((feitas as { interaction_id: string | null }[] | null) ?? [])
      .map((p) => p.interaction_id)
      .filter(Boolean) as string[],
  );

  // As entradas mais recentes com texto de verdade. O corte de 12 caracteres
  // tira "ok", "obg" e figurinha: não há o que responder ali, e uma prova sem
  // pergunta mede o julgamento de quem lê, não a IA.
  // paginacao-ok: 300 linhas por chamada, e só a primeira útil é usada.
  const { data: ix } = await supabase
    .from("interactions")
    .select("id, contact_id, content, occurred_at")
    .eq("tenant_id", tenant.id)
    .eq("direction", "inbound")
    .order("occurred_at", { ascending: false })
    .limit(300);

  const linhas = (ix as { id: string; contact_id: string | null; content: string | null; occurred_at: string }[] | null) ?? [];

  const vistos = new Set<string>();
  const alvo = linhas.find((l) => {
    if (!l.contact_id || julgadas.has(l.id)) return false;
    if ((l.content ?? "").trim().length < 12) return false;
    if (vistos.has(l.contact_id)) return false;
    vistos.add(l.contact_id);
    return true;
  });

  if (!alvo) {
    return {
      ok: false,
      acabou: true,
      mensagem:
        "Acabaram as mensagens novas para julgar — uma por pessoa, das 300 entradas mais recentes. " +
        "O placar abaixo é o resultado.",
    };
  }

  const { data: c } = await supabase
    .from("contacts")
    .select("name")
    .eq("id", alvo.contact_id!)
    .eq("tenant_id", tenant.id)
    .maybeSingle();

  // O MESMO motor da tela de responder, com o MESMO contato — se aqui rodasse
  // uma versão simplificada, a medição não diria nada sobre o que a operação
  // usa. É a regra da casa: um caminho só.
  const r = await gerarResposta({ contactId: alvo.contact_id!, message: alvo.content! });
  if (!r.ok) return { ok: false, erro: "limite" in r ? r.mensagem : r.error };

  return {
    ok: true,
    prova: {
      interactionId: alvo.id,
      contactId: alvo.contact_id!,
      nome: (c as { name: string } | null)?.name ?? "(contato sem nome)",
      quando: alvo.occurred_at,
      mensagem: alvo.content!,
      sugestao: r.data.resposta_sugerida ?? "",
      escalou: !!r.data.escalar,
      faltamFatos: r.data.faltam_fatos ?? [],
    },
  };
}

export type Veredito = "enviaria" | "ajustaria" | "erro_grave";

export async function julgar(entrada: {
  prova: Prova;
  veredito: Veredito;
  nota?: string;
}): Promise<{ ok: true } | { ok: false; erro: string }> {
  const membership = await getActiveTenant();
  const tenant = membership?.tenant;
  if (!tenant) return { ok: false, erro: "Sem empresa vinculada." };

  const { prova, veredito } = entrada;
  const supabase = await createClient();

  // `.select()` porque escrita sem erro conferido é escrita que você ACHA que
  // fez — e esta é a única linha que vira o número da decisão.
  const { data, error } = await supabase
    .from("provas")
    .insert({
      tenant_id: tenant.id,
      contact_id: prova.contactId,
      interaction_id: prova.interactionId,
      mensagem: prova.mensagem,
      sugestao: prova.sugestao,
      escalou: prova.escalou,
      faltam_fatos: prova.faltamFatos.length ? prova.faltamFatos : null,
      veredito,
      nota: entrada.nota?.trim() || null,
      julgado_por: membership!.membershipId,
    })
    .select("id");

  if (error) return { ok: false, erro: error.message };
  if (!data || data.length === 0) return { ok: false, erro: "O julgamento não foi gravado." };

  revalidatePath("/painel/provas");
  return { ok: true };
}
