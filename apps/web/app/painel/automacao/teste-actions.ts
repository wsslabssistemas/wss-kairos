"use server";

import { createClient } from "@/lib/supabase/server";
import { getActiveTenant } from "@/lib/auth";
import { despacharToque } from "@/lib/despacho";
import { paraE164BR, variantesArmazenadas, normalizePhone } from "@/lib/phone";
import { revalidatePath } from "next/cache";

/**
 * O DISPARO DE TESTE — mandar o modelo para UM número escolhido.
 *
 * ⚠ POR QUE ISTO PRECISOU EXISTIR, e a falta dele é reveladora.
 *
 * O caminho de envio deste produto nunca foi exercitado: são **1.262 saídas
 * registradas e ZERO com identificador da Meta**. Tudo o que saiu até hoje foi
 * pelo `wa.me` ou registrado à mão. A primeira mensagem que o sistema mandar
 * de verdade seria, sem isto, uma mensagem para um ex-aluno real.
 *
 * E não havia como escolher o destinatário: o motor manda para quem a FILA
 * selecionou, e a fila é derivada de regra, não de escolha. Ou seja — não
 * existia forma de testar o encanamento sem gastar uma pessoa de verdade.
 *
 * ⚠ ELE USA O MESMO `despacharToque` DA CAMPANHA, de propósito. Um caminho de
 * teste próprio provaria que o caminho de teste funciona, que é exatamente o
 * que não interessa: as seis travas (rota, telefone, variáveis do modelo,
 * envio, registro da interação, registro do custo) precisam ser as mesmas.
 *
 * ⚠ E ELE MANDA MENSAGEM DE VERDADE, que custa e chega. Não é simulação. Por
 * isso é de dono/admin e por isso a tela diz isso antes do clique.
 */

export type TesteResult =
  | { ok: true; id: string; modelo: string | null; contatoNovo: boolean; nome: string }
  | { ok: false; erro: string };

export async function dispararTeste(entrada: {
  nome: string;
  telefone: string;
}): Promise<TesteResult> {
  const membership = await getActiveTenant();
  const tenant = membership?.tenant;
  if (!tenant) return { ok: false, erro: "Sem empresa vinculada." };
  if (!["owner", "admin"].includes(membership!.role)) {
    return { ok: false, erro: "Só quem é dono ou admin pode disparar o teste." };
  }

  const nome = entrada.nome.trim();
  if (!nome) return { ok: false, erro: "Diga o nome de quem vai receber — ele vai no texto do modelo." };

  // A MESMA derivação do envio real. Se o número não fecha aqui, ele não
  // fecharia na campanha — e é melhor descobrir agora.
  const num = paraE164BR(entrada.telefone);
  if (!num.ok) return { ok: false, erro: num.motivo };

  const supabase = await createClient();

  // ⚠ PROCURA POR TODAS AS FORMAS EM QUE O MESMO TELEFONE PODE ESTAR GRAVADO.
  // A base tem quatro formatos (13, 12, 11 e 10 dígitos), e procurar só pelo
  // E.164 acharia 56% dos contatos — o resto ganharia um cadastro duplicado, e
  // duplicata parte o histórico em dois. Ver `variantesArmazenadas`.
  //
  // paginacao-ok: busca por lista fechada de variantes de UM telefone.
  const { data: achados } = await supabase
    .from("contacts")
    .select("id, name")
    .eq("tenant_id", tenant.id)
    .is("deleted_at", null)
    .in("phone", variantesArmazenadas(num.digitos));

  let contactId = (achados as { id: string; name: string }[] | null)?.[0]?.id ?? null;
  let contatoNovo = false;

  if (!contactId) {
    // ⚠ NASCE COM "NÃO CONTATAR" LIGADO. Um contato de teste que entra na fila
    // vira mensagem de verdade para alguém que nunca foi cliente — o caso
    // Gympass, com a diferença de que este fomos nós que criamos. O disparo de
    // teste não olha essa marca (ele é manual e explícito); o motor olha.
    const { data: novo, error } = await supabase
      .from("contacts")
      .insert({
        tenant_id: tenant.id,
        name: nome,
        phone: normalizePhone(entrada.telefone),
        journey_stage: "contato",
        source: "teste",
        owner_id: membership!.membershipId,
        do_not_contact: true,
        do_not_contact_reason: "Contato criado para testar o envio pelo canal oficial.",
        custom: { teste: true },
      })
      .select("id")
      .single();

    if (error) return { ok: false, erro: `Não consegui criar o contato: ${error.message}` };
    contactId = (novo as { id: string }).id;
    contatoNovo = true;
  }

  // O MESMO caminho da campanha. `reativacao` porque é o motivo que a Be
  // Fitness tem modelo aprovado e roteamento ligado — testar por outro motivo
  // provaria um caminho que não vai ser usado.
  const r = await despacharToque({
    supabase,
    tenantId: tenant.id,
    tenantNome: tenant.name,
    membershipId: membership!.membershipId,
    contactId,
    motivo: "reativacao",
    texto: "",
  });

  revalidatePath("/painel/automacao");
  revalidatePath("/painel/conversas");

  // ⚠ O ERRO SOBE INTEIRO, com o texto da Meta. Este é o único momento em que
  // dá para ler a recusa dela sem custo de reputação — resumir aqui seria
  // jogar fora a informação pela qual o teste existe.
  if (!r.ok) return { ok: false, erro: r.motivo };

  return { ok: true, id: r.id, modelo: r.modelo, contatoNovo, nome };
}
