"use server";

import { createClient } from "@/lib/supabase/server";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

export async function login(formData: FormData) {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });

  /**
   * ⚠ SENHA FRACA NÃO É LOGIN RECUSADO — e tratar como se fosse TRANCA A
   * EQUIPE DO CLIENTE PARA FORA.
   *
   * Quando a política de senha do projeto fica mais exigente (por exemplo,
   * subir o mínimo de 6 para 8 caracteres), o Supabase passa a devolver
   * `AuthWeakPasswordError` para quem já tinha uma senha curta — **no campo
   * `error`, embora a sessão TENHA sido criada**. O código daqui olhava só
   * `error` e mandava a pessoa de volta para o login, com uma mensagem em
   * inglês sobre senha fraca. Ela nunca mais entraria, e nada estaria
   * quebrado: a política teria funcionado exatamente como configurada.
   *
   * Achado em 02/set/2026 pelo fundador, ANTES de mexer na configuração: ele
   * perguntou se subir o mínimo não quebraria quem já tinha senha de 6. A
   * resposta era sim — não pela regra da Supabase, mas por esta linha.
   *
   * ⚠ E A CONDIÇÃO OLHA A SESSÃO, não o nome do erro. Se a sessão existe, a
   * pessoa ENTROU: é isso que decide, e não a classificação que o provedor deu
   * ao aviso. Depender do nome do erro seria confiar num rótulo que muda de
   * versão para versão.
   */
  if (error && data?.session) {
    // Entrou, mas a senha não atende mais à política. Vai direto trocar —
    // com o motivo escrito, porque campo que aparece sem explicação é campo
    // que a pessoa acha que é defeito.
    redirect("/definir-senha?fraca=1");
  }

  if (error) {
    redirect(`/login?erro=${encodeURIComponent(error.message)}`);
  }
  redirect("/painel");
}

export async function signInWithGoogle() {
  const supabase = await createClient();
  const h = await headers();
  const origin = h.get("origin") ?? `https://${h.get("host")}`;

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: `${origin}/auth/callback` },
  });

  if (error) redirect(`/login?erro=${encodeURIComponent(error.message)}`);
  if (data.url) redirect(data.url);
}
