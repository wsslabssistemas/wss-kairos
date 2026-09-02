"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getActiveTenant } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { origemDoSite } from "@/lib/site";
import { lerTudo } from "@/lib/paginado";
import { RACAO_MAXIMA } from "@/lib/racao";

async function requireAdmin() {
  const m = await getActiveTenant();
  if (!m?.tenant || (m.role !== "owner" && m.role !== "admin")) {
    redirect("/painel/equipe");
  }
  return m;
}

const ROLES = ["owner", "admin", "manager", "agent"];

export async function inviteMember(formData: FormData) {
  const m = await requireAdmin();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const nome = String(formData.get("nome") ?? "").trim();
  const role = ROLES.includes(String(formData.get("role"))) ? String(formData.get("role")) : "agent";
  if (!email) redirect("/painel/equipe/adicionar?erro=Informe+o+e-mail");
  if (!nome) redirect("/painel/equipe/adicionar?erro=" + encodeURIComponent("Diga o nome da pessoa — é como ela vai aparecer para a equipe."));

  /**
   * ⚠ DUAS ENTREGAS, UM TOKEN CADA — e por isso é uma escolha, não os dois.
   *
   * O link do convite é de USO ÚNICO, e gerar um novo invalida o anterior.
   * Mandar por e-mail E mostrar na tela deixaria dois links por aí, um deles
   * morto, sem nada dizendo qual — e a pessoa clicaria no errado.
   *
   * Por e-mail (o padrão desde 02/set, quando o SMTP próprio entrou no ar): a
   * pessoa recebe sozinha, em português, e ninguém precisa estar por perto.
   * Pelo link: resolve na hora, sem depender de caixa de entrada — foi o que
   * destravou a equipe da Be Fitness no dia em que o e-mail nativo travou, e
   * continua sendo a saída quando alguém está esperando do outro lado.
   */
  const porEmail = String(formData.get("por_email") ?? "") === "1";

  const admin = createAdminClient();
  let userId: string | null = null;
  let link: string | null = null;
  let enviado = false;

  // Convida: cria a conta (se nova) e gera o link para a pessoa definir a senha.
  //
  // `redirectTo` COM `type=invite` é o que leva a pessoa para a tela de criar
  // senha. Sem ele o link caía no destino padrão do Supabase, o callback
  // mandava para o painel, e a pessoa usava o sistema **sem nunca ter definido
  // senha** — no dia seguinte não entrava mais, porque o link do convite é de
  // uso único. Do lado dela, o sistema parava de funcionar sem explicação.
  // A origem tem que ser ABSOLUTA. Vazia, o Supabase recusa o `redirectTo` e
  // o convite inteiro falha — ver `lib/site.ts`, que hoje é a cascata única.
  const site = await origemDoSite();
  // O LINK É MONTADO POR NÓS, com o `hashed_token` — e NÃO é o `action_link`
  // que o Supabase devolve.
  //
  // O `action_link` aponta para o `/auth/v1/verify` deles, que devolve a
  // sessão no FRAGMENTO da URL (`#access_token=…`). Fragmento não chega ao
  // servidor, e o nosso callback é uma rota de servidor: todo convite e toda
  // recuperação morriam ali, mandando a pessoa para o login com "não consegui
  // completar o acesso". Medido com `curl`: o `Location` vem com `#`, sem
  // `code`.
  //
  // Com `token_hash`, `/auth/confirmar` troca o token por sessão no servidor,
  // gravando os cookies pelo caminho normal.
  // ⚠ `inviteUserByEmail` ENVIA; `generateLink` só GERA. A diferença é o
  // motivo de este ramo existir: até 02/set o convite nunca mandava e-mail
  // nenhum, e o fundador tinha que entregar o link à mão, sempre.
  const convite = porEmail
    ? await admin.auth.admin.inviteUserByEmail(email, { redirectTo: `${site}/auth/confirmar` })
    : await admin.auth.admin.generateLink({
        type: "invite",
        email,
        options: { redirectTo: `${site}/auth/confirmar` },
      });
  const { data, error } = convite as {
    data: { user?: { id: string } | null; properties?: { hashed_token?: string } } | null;
    error: { message?: string } | null;
  };

  const montar = (hash: string | undefined, tipo: string) =>
    hash ? `${site}/auth/confirmar?token_hash=${hash}&type=${tipo}` : null;

  if (!error && data?.user) {
    userId = data.user.id;
    if (porEmail) enviado = true;
    else link = montar(data.properties?.hashed_token, "invite");
  } else {
    // JÁ TEM CONTA — e aqui estava o defeito que o fundador viu.
    //
    // `generateLink({type:"invite"})` só funciona para e-mail que ainda não
    // existe. Na segunda tentativa com a mesma pessoa ele falha, o código
    // vinculava a membership e seguia SEM LINK NENHUM: a tela dizia que deu
    // certo e não havia nada para mandar. Como a primeira tentativa já cria a
    // conta, bastava convidar alguém duas vezes para cair aqui para sempre.
    //
    // A saída é gerar um link de RECUPERAÇÃO: ele leva à mesma tela de criar
    // senha e serve tanto para quem nunca definiu uma quanto para quem
    // esqueceu. Do lado de quem recebe, é o mesmo convite.
    const { data: uid } = await admin.rpc("get_user_id_by_email", { p_email: email });
    userId = (uid as string | null) ?? null;

    if (userId) {
      if (porEmail) {
        // ⚠ QUEM JÁ TEM CONTA NÃO RECEBE CONVITE, RECEBE RECUPERAÇÃO — e pelo
        // cliente normal, não pelo admin: `resetPasswordForEmail` é o único
        // caminho que DISPARA o e-mail. Do lado de quem recebe, é o mesmo
        // convite: leva à mesma tela de criar senha.
        const publico = await createClient();
        const { error: eRec } = await publico.auth.resetPasswordForEmail(email, {
          redirectTo: `${site}/auth/confirmar`,
        });
        if (eRec) {
          // ⚠ FALHOU O ENVIO? CAI PARA O LINK, não para o vazio. O teto de
          // e-mails por hora existe e é atingível — e a pessoa do outro lado
          // não pode ficar sem nada por causa dele.
          console.warn(`[equipe] nao enviei o e-mail para ${email}: ${eRec.message}`);
          const { data: rec } = await admin.auth.admin.generateLink({
            type: "recovery", email, options: { redirectTo: `${site}/auth/confirmar` },
          });
          link = montar(rec?.properties?.hashed_token, "recovery");
        } else {
          enviado = true;
        }
      } else {
        const { data: rec } = await admin.auth.admin.generateLink({
          type: "recovery",
          email,
          options: { redirectTo: `${site}/auth/confirmar` },
        });
        link = montar(rec?.properties?.hashed_token, "recovery");
      }
    }
  }

  if (!userId) {
    redirect(
      `/painel/equipe/adicionar?erro=${encodeURIComponent(error?.message ?? "Falha ao convidar")}`,
    );
  }

  // O NOME ENTRA AQUI, vindo de quem convidou. Sem ele o perfil nascia sem
  // nome e a tela de Equipe listava o e-mail — três das cinco pessoas da Be
  // Fitness ficaram assim, e o dono não sabia quem era quem na própria equipe.
  //
  // MAS O NOME DA PRÓPRIA PESSOA VENCE. Ela também pode escrevê-lo ao criar a
  // senha, e ali é ela dizendo como se chama — "Luciana Bard Machado" não pode
  // ser rebaixado para "Luciana" só porque alguém reenviou o convite. Por isso
  // este upsert só preenche quando o perfil ainda NÃO tem nome.
  const { data: perfil } = await admin
    .from("profiles").select("full_name").eq("id", userId).maybeSingle();
  const jaTemNome = typeof perfil?.full_name === "string" && perfil.full_name.trim() !== ""
    && perfil.full_name !== email;

  await admin.from("profiles").upsert(
    { id: userId, email, ...(jaTemNome ? {} : { full_name: nome }) },
    { onConflict: "id" },
  );
  await admin.from("memberships").upsert(
    { user_id: userId, tenant_id: m.tenant!.id, role, status: "active" },
    { onConflict: "user_id,tenant_id" },
  );

  revalidatePath("/painel/equipe");
  if (link) redirect(`/painel/equipe?convite=${encodeURIComponent(link)}`);
  // ⚠ "ENVIADO" É DIFERENTE DE "OK", e a tela precisa dizer qual foi. Sem
  // isso, quem escolheu e-mail fica sem saber se deve mandar alguma coisa —
  // e no caso de o envio ter caído para o link, o link aparece.
  if (enviado) redirect(`/painel/equipe?enviado=${encodeURIComponent(email)}`);
  redirect("/painel/equipe?ok=1");
}

/**
 * GERA UM LINK DE ACESSO NOVO para quem JÁ está na equipe.
 *
 * ⚠ ISTO EXISTE PARA QUE NINGUÉM MAIS FIQUE PARADO ESPERANDO E-MAIL.
 *
 * Em 10/ago/2026 a equipe da Be Fitness travou por horas, e a causa foi o
 * e-mail nativo do Supabase — lento e limitado. Quem ainda não tinha entrado
 * foi destravado por um link que EU gerei na mão. O convite já tem esse
 * caminho pronto na tela; quem já é membro e esqueceu a senha, não tinha:
 * sobrava "Esqueci minha senha", que sai pelo mesmo e-mail que estava
 * falhando. A única saída da pessoa dependia do canal quebrado.
 *
 * SMTP próprio continua valendo — ele resolve quem chega de fora, que não tem
 * ninguém para pedir link. O que ele NÃO pode continuar sendo é o único
 * caminho para destravar alguém de dentro: a regra escrita é **destrave a
 * pessoa primeiro e conserte a causa depois**, e um procedimento que só o
 * fabricante sabe executar não é destravar — é virar gargalo.
 *
 * O link é de RECUPERAÇÃO, o mesmo do convite reenviado: leva à tela de criar
 * senha e serve tanto para quem nunca definiu uma quanto para quem esqueceu.
 *
 * O ESCOPO É CONFERIDO PELO CLIENTE DO USUÁRIO, de propósito. A membership é
 * lida com RLS antes de o `service_role` tocar em qualquer coisa: sem isso,
 * um id de membership de OUTRA empresa geraria um link de acesso válido para
 * a conta de outra pessoa. `service_role` não filtra nada sozinho.
 */
export async function gerarLinkDeAcesso(membershipId: string) {
  const m = await requireAdmin();
  const supabase = await createClient();

  const { data: alvo } = await supabase
    .from("memberships")
    .select("user_id, user:profiles(email)")
    .eq("id", membershipId)
    .eq("tenant_id", m.tenant!.id)
    .eq("status", "active")
    .maybeSingle();

  const email = (alvo as { user?: { email: string | null } | null } | null)?.user?.email;
  if (!email) {
    redirect(
      `/painel/equipe?erro=${encodeURIComponent("Não achei o e-mail dessa pessoa. Adicione-a de novo pelo botão Adicionar.")}`,
    );
  }

  const site = await origemDoSite();
  const admin = createAdminClient();
  const { data, error } = await admin.auth.admin.generateLink({
    type: "recovery",
    email,
    options: { redirectTo: `${site}/auth/confirmar` },
  });

  // O `hashed_token` é o que importa, não o `action_link` — o `action_link`
  // passa pelo `/auth/v1/verify` do Supabase, que devolve a sessão no
  // fragmento da URL e nunca chega ao nosso servidor. É o mesmo motivo
  // documentado em `/auth/confirmar`.
  const hash = data?.properties?.hashed_token;
  if (error || !hash) {
    redirect(
      `/painel/equipe?erro=${encodeURIComponent(error?.message ?? "Não consegui gerar o link.")}`,
    );
  }

  redirect(
    `/painel/equipe?convite=${encodeURIComponent(`${site}/auth/confirmar?token_hash=${hash}&type=recovery`)}`,
  );
}

export async function changeRole(membershipId: string, formData: FormData) {
  const m = await requireAdmin();
  const role = ROLES.includes(String(formData.get("role"))) ? String(formData.get("role")) : "agent";
  const supabase = await createClient();
  await supabase
    .from("memberships")
    .update({ role })
    .eq("id", membershipId)
    .eq("tenant_id", m.tenant!.id);
  revalidatePath("/painel/equipe");
  redirect("/painel/equipe");
}

/**
 * Divide uma carteira entre vários responsáveis, em fatias iguais.
 *
 * POR QUE NÃO BASTA "PASSAR TUDO PARA UM": em academia o rodízio de recepção é
 * alto, e quem sai costuma levar a maior carteira da casa. Despejar trezentos
 * alunos num vendedor só não transfere a carteira — transfere o problema, e o
 * resultado é ninguém sendo acompanhado por ninguém.
 *
 * A divisão é por RODÍZIO sobre a lista já ordenada, não aleatória: rodar duas
 * vezes com a mesma entrada dá o mesmo resultado, e dá para conferir.
 */
function fatiar<T>(itens: T[], destinos: string[]): Map<string, T[]> {
  const out = new Map<string, T[]>(destinos.map((d) => [d, []]));
  itens.forEach((item, i) => out.get(destinos[i % destinos.length])!.push(item));
  return out;
}

export async function removeMember(membershipId: string, formData: FormData) {
  const m = await requireAdmin();
  const modo = String(formData.get("modo") ?? "um");
  const newOwner = String(formData.get("new_owner") ?? "").trim() || null;
  const supabase = await createClient();

  if (modo === "dividir") {
    // Entre TODOS os outros ativos. Quem fica com a carteira é quem continua
    // na casa — e cada um recebe a mesma quantidade.
    const { data: ativos } = await supabase
      .from("memberships")
      .select("id")
      .eq("tenant_id", m.tenant!.id)
      .eq("status", "active")
      .neq("id", membershipId)
      .order("id");
    const destinos = ((ativos as { id: string }[] | null) ?? []).map((x) => x.id);

    // ⚠ PAGINADO, e o corte aqui deixava CARTEIRA ÓRFÃ.
    //
    // Esta lista é quem vai ser redistribuído entre a equipe quando alguém
    // sai. Cortada em 1.000, os contatos além disso continuavam apontando
    // para um vínculo já desativado: some da carteira de todo mundo e não
    // aparece em lista nenhuma — exatamente a dor que este fluxo existe para
    // evitar, e na forma silenciosa dela, porque a remoção "deu certo".
    //
    // Com 9 mil cadastros divididos entre três recepcionistas, o primeiro
    // desligamento já passaria do teto.
    const doSaindo = await lerTudo<{ id: string }>(
      (de, ate) => supabase
        .from("contacts")
        .select("id")
        .eq("tenant_id", m.tenant!.id)
        .eq("owner_id", membershipId)
        .is("deleted_at", null)
        .order("id")
        .range(de, ate),
      { rotulo: "carteira de quem sai" },
    );
    const ids = doSaindo.map((x) => x.id);

    if (destinos.length && ids.length) {
      for (const [destino, fatia] of fatiar(ids, destinos)) {
        // Em lotes: `in()` com milhares de ids estoura o tamanho da URL.
        for (let i = 0; i < fatia.length; i += 200) {
          await supabase
            .from("contacts")
            .update({ owner_id: destino })
            .eq("tenant_id", m.tenant!.id)
            .in("id", fatia.slice(i, i + 200));
        }
      }
    }
  } else {
    // SEM DESTINO, NÃO REMOVE. Gravar `owner_id = null` deixaria a carteira
    // órfã — que é exatamente a dor que este fluxo existe para evitar, e a
    // pior forma dela: silenciosa, porque a remoção "deu certo".
    if (!newOwner) {
      const { count } = await supabase
        .from("contacts")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", m.tenant!.id)
        .eq("owner_id", membershipId)
        .is("deleted_at", null);
      if ((count ?? 0) > 0) {
        redirect(`/painel/equipe/${membershipId}/remover?erro=${encodeURIComponent("Escolha quem recebe os contatos, ou marque para dividir entre a equipe.")}`);
      }
    }
    // Transfere os contatos para não deixar ninguém sem supervisão.
    await supabase
      .from("contacts")
      .update({ owner_id: newOwner })
      .eq("tenant_id", m.tenant!.id)
      .eq("owner_id", membershipId);
  }

  // Desativa o vínculo (reversível, preserva histórico). is_member_of exige 'active'.
  await supabase
    .from("memberships")
    .update({ status: "disabled" })
    .eq("id", membershipId)
    .eq("tenant_id", m.tenant!.id);

  revalidatePath("/painel/equipe");
  revalidatePath("/painel/contatos");
  redirect("/painel/equipe");
}

/**
 * A RAÇÃO DO DIA — quantas pessoas o sistema pede por vendedor, por dia.
 *
 * Mora em `tenants.settings` como a aparência e o token do calendário, e é
 * regulada aqui porque é uma decisão sobre o TIME, não sobre a fila: quem
 * define o ritmo é quem responde pelo resultado dele.
 *
 * O motivo de ela existir, e por que o número não pode ser livre, está em
 * `lib/racao.ts` — resumo: lista grande faz a pessoa parar de executar, e
 * rajada de mensagem queima o número da empresa, que é o ativo.
 */
export async function salvarRacao(formData: FormData) {
  const m = await getActiveTenant();
  if (!m?.tenant || (m.role !== "owner" && m.role !== "admin")) redirect("/painel/equipe");

  const bruto = Number(String(formData.get("racao_dia") ?? "").replace(",", "."));
  if (!Number.isFinite(bruto) || bruto < 1) {
    redirect(`/painel/equipe?erro=${encodeURIComponent("Informe um número de 1 a " + RACAO_MAXIMA + ".")}`);
  }
  const valor = Math.min(Math.floor(bruto), RACAO_MAXIMA);

  const supabase = await createClient();
  const { data: atual } = await supabase
    .from("tenants").select("settings").eq("id", m.tenant.id).maybeSingle();
  const settings = (atual?.settings as Record<string, unknown> | null) ?? {};

  await supabase
    .from("tenants")
    .update({ settings: { ...settings, racao_dia: valor } })
    .eq("id", m.tenant.id);

  revalidatePath("/painel/equipe");
  revalidatePath("/painel/fila");
  redirect(`/painel/equipe?ok=racao`);
}
