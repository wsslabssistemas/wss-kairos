"use server";

import { generateText } from "ai";
import { aiModel, hasAIKey } from "@/lib/ai";
import { getActiveTenant } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getSkillFormConfig } from "@/lib/skill";
import {
  esquemaParaPedido,
  validarProposta,
  type Proposta,
  type SecaoDoManifesto,
} from "@/lib/dna-extrator";

/**
 * LÊ UM TEXTO SOLTO E PROPÕE O DNA.
 *
 * ⚠ PROPÕE. NÃO SALVA. Quem confirma é gente, campo por campo, na tela de
 * sempre. É a trava anti-invenção aplicada ao cadastro: dado que entra sem
 * alguém olhar vira afirmação de preço que ninguém autorizou — dita depois a um
 * cliente com a confiança do fato conferido.
 *
 * ⚠ E O ESQUEMA VEM DO MANIFESTO DO SEGMENTO, nunca de código aqui. É o que
 * faz o extrator servir academia, oficina e clínica sem uma linha nova — e o
 * que impede vocabulário de mercado de entrar no núcleo (Lei 1).
 */
export async function extrairDna(
  texto: string,
): Promise<{ ok: true; proposta: Proposta } | { ok: false; erro: string }> {
  const membership = await getActiveTenant();
  const tenant = membership?.tenant;
  if (!tenant) return { ok: false, erro: "Sem empresa vinculada." };
  if (!["owner", "admin", "manager"].includes(membership!.role))
    return { ok: false, erro: "Só dono, administrador ou gestor pode preencher o DNA." };
  if (!hasAIKey()) return { ok: false, erro: "A chave de IA não está configurada." };

  const limpo = (texto ?? "").trim();
  if (limpo.length < 40)
    return { ok: false, erro: "Escreva um pouco mais — com menos que isso não dá para separar nada." };
  // ⚠ TETO DE TAMANHO. Um PDF inteiro colado viraria um pedido caro e uma
  // resposta pior: o modelo se perde e passa a inventar para preencher. O
  // corte é explícito para a pessoa saber que houve corte.
  const cortado = limpo.slice(0, 24_000);

  const supabase = await createClient();
  const { data: skill } = await supabase
    .from("skills")
    .select("manifest")
    .eq("key", tenant.skill_key)
    .maybeSingle();
  const secoes = ((skill?.manifest as { dna_sections?: SecaoDoManifesto[] } | null)?.dna_sections ?? []);
  if (!secoes.length) return { ok: false, erro: "O segmento desta empresa não declara seções de DNA." };

  const { contract } = await getSkillFormConfig(tenant.skill_key);
  const ramo = (contract as { label?: string } | null)?.label ?? tenant.skill_key;

  const system = [
    "Você separa informações de um negócio nos campos de um cadastro.",
    "",
    "REGRAS, e a primeira é a mais importante:",
    "1. NÃO INVENTE. Só preencha um campo se a informação estiver LITERALMENTE no texto.",
    "   Não deduza preço a partir de outro preço, não complete horário, não suponha",
    "   forma de pagamento. Campo sem resposta no texto simplesmente NÃO aparece.",
    "2. NÃO PREENCHA COM EDUCAÇÃO. Nada de 'não informado', 'a combinar', 'n/a'.",
    "   Se não está no texto, omita a chave inteira.",
    "3. USE SÓ AS CHAVES do esquema abaixo. Chave que não está lá é descartada.",
    "4. Copie os números como estão escritos (R$ 169,00 continua R$ 169,00).",
    "",
    "Devolva SOMENTE um objeto JSON, sem cercas de código e sem comentário.",
    "O formato é { secao: { campo: valor } }. Campo de tipo 'table' recebe uma",
    "lista de objetos com as colunas indicadas; 'list' recebe lista de textos.",
  ].join("\n");

  const prompt = [
    `Ramo do negócio: ${ramo}.`,
    "",
    "ESQUEMA — as únicas chaves aceitas:",
    esquemaParaPedido(secoes),
    "",
    "TEXTO SOBRE O NEGÓCIO:",
    cortado,
  ].join("\n");

  try {
    const r = await generateText({ model: aiModel, system, prompt });
    // ⚠ O MODELO ÀS VEZES ENVOLVE EM CERCA DE CÓDIGO mesmo mandado não fazer.
    // Tratar isso como resposta inválida devolveria erro para a pessoa por um
    // detalhe de formatação que não é culpa dela.
    const cru = r.text.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
    let bruto: unknown;
    try {
      bruto = JSON.parse(cru);
    } catch {
      const i = cru.indexOf("{");
      const j = cru.lastIndexOf("}");
      if (i < 0 || j <= i) return { ok: false, erro: "A IA não devolveu um cadastro legível. Tente de novo." };
      bruto = JSON.parse(cru.slice(i, j + 1));
    }
    return { ok: true, proposta: validarProposta(bruto, secoes) };
  } catch (e) {
    const erro = e instanceof Error ? e.message : String(e);
    console.error(`[dna-extrator] falhou: ${erro}`);
    return { ok: false, erro };
  }
}
