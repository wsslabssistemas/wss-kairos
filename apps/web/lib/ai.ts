import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";

// Provedor por ambiente: "anthropic" (padrão) ou "openai".
// A chave vai sempre em AI_API_KEY — troca-se só o AI_PROVIDER.
const PROVIDER = (process.env.AI_PROVIDER ?? "anthropic").toLowerCase();
const IS_OPENAI = PROVIDER === "openai";

// Modelo configurável; padrão sensato por provedor.
export const AI_MODEL =
  process.env.AI_MODEL ?? (IS_OPENAI ? "gpt-4o-mini" : "claude-sonnet-5");

export function hasAIKey(): boolean {
  return !!process.env.AI_API_KEY;
}

// Diagnóstico mascarado: mostra só o prefixo (público) e o tamanho da chave,
// para descobrir valor torto (linha inteira colada, chave cortada, provedor errado).
export function keyHint(): string {
  const k = (process.env.AI_API_KEY ?? "").trim();
  if (!k) return "AI_API_KEY vazia";
  return `prefixo="${k.slice(0, 7)}…", ${k.length} caracteres, provider=${PROVIDER}`;
}

const apiKey = (process.env.AI_API_KEY ?? "").trim(); // trim: evita espaço/quebra colada
export const aiModel = IS_OPENAI
  ? createOpenAI({ apiKey })(AI_MODEL)
  : createAnthropic({ apiKey })(AI_MODEL);

// Estimativa de custo em CENTAVOS de R$ (o painel do fabricante mostra em R$).
//
// ⚠ A CONTA MORA EM `lib/preco-ia.ts`, pura e testada. Ela estava aqui com
// US$ 3/15 fixos e cobrava **1,5 vez a mais**: o Sonnet 5 está em promoção de
// lançamento (US$ 2/10) até 31/08/2026. O fundador descobriu quando o teto de
// R$ 100 bateu com US$ 13,41 gastos de verdade.
export { estimarCentavos as estimateCostCents } from "@/lib/preco-ia";

// Normaliza o objeto de uso entre versões do SDK.
export function tokensOf(usage: unknown): { in: number; out: number } {
  const u = (usage ?? {}) as Record<string, number | undefined>;
  return {
    in: u.inputTokens ?? u.promptTokens ?? 0,
    out: u.outputTokens ?? u.completionTokens ?? 0,
  };
}
