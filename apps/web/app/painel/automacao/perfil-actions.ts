"use server";

import { getActiveTenant } from "@/lib/auth";
import { credencialDoCanal } from "@/lib/credenciais";
import { lerPerfil, gravarPerfil, idDoApp, subirImagem, type PerfilDoCanal } from "@/lib/perfil-canal";
import { revalidatePath } from "next/cache";

/**
 * O PERFIL DO NÚMERO — ler e gravar.
 *
 * ⚠ O NOME DE EXIBIÇÃO NÃO PASSA POR AQUI: ele não tem API e só muda na tela
 * da Meta, com revisão. O que dá para resolver por código é o resto do perfil,
 * e é o resto que estava vazio: **o número não tinha foto nenhuma.**
 */

export type PerfilResult =
  | { ok: true; perfil: PerfilDoCanal }
  | { ok: false; erro: string };

export async function carregarPerfil(): Promise<PerfilResult> {
  const membership = await getActiveTenant();
  const tenant = membership?.tenant;
  if (!tenant) return { ok: false, erro: "Sem empresa vinculada." };
  if (!["owner", "admin"].includes(membership!.role)) {
    return { ok: false, erro: "Só quem é dono ou admin pode ver o perfil do canal." };
  }

  const cred = await credencialDoCanal(tenant.id);
  if (!cred) return { ok: false, erro: "Esta empresa ainda não tem canal oficial configurado." };

  const r = await lerPerfil(cred);
  return r.ok ? { ok: true, perfil: r.perfil } : { ok: false, erro: r.motivo };
}

export async function salvarPerfil(form: FormData): Promise<PerfilResult> {
  const membership = await getActiveTenant();
  const tenant = membership?.tenant;
  if (!tenant) return { ok: false, erro: "Sem empresa vinculada." };
  if (!["owner", "admin"].includes(membership!.role)) {
    return { ok: false, erro: "Só quem é dono ou admin pode mexer no perfil do canal." };
  }

  const cred = await credencialDoCanal(tenant.id);
  if (!cred) return { ok: false, erro: "Esta empresa ainda não tem canal oficial configurado." };

  const texto = (k: string) => String(form.get(k) ?? "").trim();
  const site = texto("site");

  const campos: Partial<PerfilDoCanal> & { profile_picture_handle?: string } = {
    about: texto("about"),
    description: texto("description"),
    address: texto("address"),
    email: texto("email"),
    websites: site ? [site] : undefined,
  };

  // ------------------------------------------------------------------ A FOTO
  const foto = form.get("foto");
  if (foto instanceof File && foto.size > 0) {
    // ⚠ O LIMITE É CONFERIDO AQUI, antes de gastar a viagem. A Meta recusa
    // imagem grande com um erro que não diz "grande demais" — e erro que não
    // explica manda a pessoa tentar de novo com o mesmo arquivo.
    if (foto.size > 5 * 1024 * 1024) {
      return { ok: false, erro: "A imagem tem mais de 5 MB. Use uma menor." };
    }
    if (!["image/jpeg", "image/png"].includes(foto.type)) {
      return { ok: false, erro: `A Meta aceita JPG ou PNG. Este arquivo é ${foto.type || "de tipo desconhecido"}.` };
    }

    const appId = await idDoApp(cred);
    if (!appId) {
      return {
        ok: false,
        erro:
          "Não consegui descobrir o id do app a partir do token — sem ele a Meta não aceita upload de imagem. " +
          "Os campos de texto podem ser salvos normalmente; para a foto, me avise.",
      };
    }

    const up = await subirImagem(cred, appId, {
      bytes: await foto.arrayBuffer(),
      tipo: foto.type,
    });
    if (!up.ok) return { ok: false, erro: `A imagem não subiu: ${up.motivo}` };
    campos.profile_picture_handle = up.handle;
  }

  const r = await gravarPerfil(cred, campos);
  if (!r.ok) return { ok: false, erro: r.motivo };

  revalidatePath("/painel/automacao");

  // ⚠ RELÊ DEPOIS DE GRAVAR, e não devolve o que foi mandado. Escrita sem
  // erro conferido é escrita que você ACHA que fez — e aqui o que confirma é a
  // própria Meta, não o nosso otimismo.
  const depois = await lerPerfil(cred);
  return depois.ok
    ? { ok: true, perfil: depois.perfil }
    : { ok: false, erro: `Gravou, mas não consegui reler para confirmar: ${depois.motivo}` };
}
