"use server";

import { getActiveTenant } from "@/lib/auth";
import { credencialDoCanal } from "@/lib/credenciais";
import {
  lerPerfil, gravarPerfil, idDoApp, subirImagem, estadoDoNumero,
  tamanhoEmBytes, LIMITES,
  type PerfilDoCanal, type EstadoDoNumero,
} from "@/lib/perfil-canal";
import { revalidatePath } from "next/cache";

/**
 * O PERFIL DO NÚMERO — ler e gravar.
 *
 * ⚠ O NOME DE EXIBIÇÃO NÃO PASSA POR AQUI: ele não tem API e só muda na tela
 * da Meta, com revisão. O que dá para resolver por código é o resto do perfil,
 * e é o resto que estava vazio: **o número não tinha foto nenhuma.**
 */

export type PerfilResult =
  | { ok: true; perfil: PerfilDoCanal; estado?: EstadoDoNumero }
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

  // As duas leituras juntas: o perfil (o que o cliente vê ao tocar no nome) e
  // o estado (qualidade e degrau — o que decide se a campanha continua).
  const [r, e] = await Promise.all([lerPerfil(cred), estadoDoNumero(cred)]);
  if (!r.ok) return { ok: false, erro: r.motivo };
  return { ok: true, perfil: r.perfil, estado: e.ok ? e.estado : undefined };
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

  // ⚠ O TAMANHO É CONFERIDO AQUI, EM BYTES, ANTES DE GASTAR A VIAGEM.
  //
  // A Meta recusa com "must be at most 512 characters long" — e a palavra
  // "characters" é o que engana: a régua dela é BYTE. Em português cada acento
  // vale 2, então 492 letras podem ser 520 bytes. Devolver o erro dela seria
  // repetir a mentira; aqui a mensagem diz quantos CARACTERES tirar.
  const excesso = (
    [
      ["Descrição", texto("description"), LIMITES.description],
      ["Recado do perfil", texto("about"), LIMITES.about],
      ["Endereço", texto("address"), LIMITES.address],
      ["E-mail", texto("email"), LIMITES.email],
      ["Site", site, LIMITES.website],
    ] as const
  ).find(([, v, max]) => tamanhoEmBytes(v) > max);

  if (excesso) {
    const [rotulo, valor, max] = excesso;
    const bytes = tamanhoEmBytes(valor);
    return {
      ok: false,
      erro:
        `${rotulo} está com ${bytes} de ${max} — e a conta da Meta é em BYTES, não em letras. ` +
        `Cada acento vale 2 (é, ç, ã), então o texto tem ${valor.length} letras e ocupa ${bytes}. ` +
        `Tire cerca de ${Math.ceil((bytes - max) / 2)} palavras e tente de novo.`,
    };
  }

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
  const [depois, est] = await Promise.all([lerPerfil(cred), estadoDoNumero(cred)]);
  return depois.ok
    ? { ok: true, perfil: depois.perfil, estado: est.ok ? est.estado : undefined }
    : { ok: false, erro: `Gravou, mas não consegui reler para confirmar: ${depois.motivo}` };
}
