"use server";

import { getActiveTenant } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { rodarMotor } from "@/lib/motor-db";
import { revalidatePath } from "next/cache";

/**
 * RODAR O MOTOR AGORA — o mesmo que a agenda faz às 9h e às 17h.
 *
 * ⚠ ELE NÃO FORÇA NADA. Chama `rodarMotor` com `simular: false`, e quem decide
 * se sai mensagem é o MODO SALVO da empresa. Em `simulation` o motor calcula e
 * devolve `enviadas: 0` por conta própria — é a trava fazendo o trabalho dela,
 * não uma condição escrita aqui de novo.
 *
 * ⚠ E É O MESMO CAMINHO DO JOB, de propósito. Um "rodar agora" com lógica
 * própria provaria que o botão funciona, e o que interessa é provar que a
 * campanha funciona.
 */

export type RodadaResult =
  | {
      ok: true;
      enviadas: number;
      falhas: { nome: string; motivo: string }[];
      avaliados: number;
      escolhidos: number;
      porque: string;
      simulado: boolean;
      /** Parou por tempo, com gente escolhida ainda sem mensagem. */
      interrompido: boolean;
    }
  | { ok: false; erro: string };

export async function rodarAgora(): Promise<RodadaResult> {
  const membership = await getActiveTenant();
  const tenant = membership?.tenant;
  if (!tenant) return { ok: false, erro: "Sem empresa vinculada." };
  if (!["owner", "admin"].includes(membership!.role)) {
    return { ok: false, erro: "Só quem é dono ou admin pode rodar o motor." };
  }

  try {
    const r = await rodarMotor({
      tenantId: tenant.id,
      skillKey: tenant.skill_key,
      tenantNome: tenant.name,
      simular: false,
      // ⚠ 240s contra os 300 declarados na PÁGINA. A folga de um minuto é para
      // o motor terminar de contar e a resposta voltar — parar exatamente no
      // limite é ser morto no último passo, que é o mesmo defeito com outro
      // nome.
      limiteMs: 240_000,
    });

    // Os nomes de quem falhou. Sem eles a lista de falhas é uma lista de
    // identificadores, e ninguém liga para um identificador para pedir
    // desculpa nem para corrigir o telefone.
    const nomes = new Map<string, string>();
    if (r.falhas.length) {
      const supabase = await createClient();
      // paginacao-ok: busca por lista fechada de ids, limitada pelo teto do dia.
      const { data } = await supabase
        .from("contacts")
        .select("id, name")
        .eq("tenant_id", tenant.id)
        .in("id", r.falhas.map((f) => f.contactId));
      for (const c of ((data as { id: string; name: string }[] | null) ?? [])) {
        nomes.set(c.id, c.name);
      }
    }

    revalidatePath("/painel/automacao");
    revalidatePath("/painel/conversas");

    return {
      ok: true,
      enviadas: r.enviadas,
      falhas: r.falhas.map((f) => ({
        nome: nomes.get(f.contactId) ?? "(contato sem nome)",
        motivo: f.motivo,
      })),
      avaliados: r.plano.vereditos.length,
      escolhidos: r.plano.enviar.length,
      porque: r.plano.porque,
      simulado: r.plano.simulado,
      interrompido: r.interrompido,
    };
  } catch (e) {
    // O erro sobe INTEIRO. Um "rodar agora" que falha em silêncio é pior que
    // não ter botão: quem aperta conclui que não havia ninguém para falar.
    return { ok: false, erro: e instanceof Error ? e.message : String(e) };
  }
}
