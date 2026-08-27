// COMO MARCAR UMA SAÍDA: a IA acertou sozinha, foi corrigida, ou nem opinou?
//
// ⚠ MÓDULO PURO, E ISSO É O PONTO. Estas duas funções moravam em
// `lib/correcoes.ts`, que é `server-only` — e `server-only` não resolve fora do
// Next, então a regra não tinha como ser testada. Regra sem trava é regra que
// volta a divergir: era exatamente o que estava acontecendo, com o Canal
// oficial e a aba Responder carregando cada um a sua cópia da comparação.

/**
 * A MESMA COMPARAÇÃO QUE DECIDE SE HOUVE LIÇÃO, exposta para quem grava.
 *
 * ⚠ ELA EXISTE PORQUE A REGRA ESTAVA DUPLICADA. O Canal oficial classificava
 * `origem_ia` com uma cópia desta comparação; quando a aba Responder passou a
 * gravar também (27/ago), a cópia virou duas — e regra copiada diverge na
 * primeira mudança. É o mesmo motivo pelo qual diagnóstico importa a lib em
 * vez de reimplementar o algoritmo.
 *
 * Ignora espaço e caixa: trocar um espaço não é correção.
 */
export function mesmaMensagem(a: string, b: string): boolean {
  return a.replace(/\s+/g, " ").trim().toLowerCase() === b.replace(/\s+/g, " ").trim().toLowerCase();
}

/**
 * Como esta saída deve ser marcada em `interactions.origem_ia`.
 *
 * ⚠ É O NÚMERO QUE AUTORIZA O AUTOMÁTICO. Sem esta coluna, "aceitei a sugestão
 * sem mexer" e "escrevi do zero" viram a mesma linha `outbound` — e é
 * exatamente essa diferença que decide se dá para tirar a pessoa do meio.
 *
 * ⚠ `null` QUANDO NÃO HOUVE SUGESTÃO, nunca "editada". Mensagem escrita à mão,
 * sem a IA ter proposto nada, não é a IA errando: contá-la como edição faria a
 * taxa de acerto despencar por um motivo que não existe, e a decisão de ligar o
 * automático seria adiada por um número inventado.
 */
export function origemDaMensagem(sugerido: string | null | undefined, enviado: string): "aceita" | "editada" | null {
  if (!sugerido?.trim() || !enviado.trim()) return null;
  return mesmaMensagem(sugerido, enviado) ? "aceita" : "editada";
}
