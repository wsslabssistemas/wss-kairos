import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

/**
 * TROCA O TOKEN DO LINK POR SESSÃO — e só quando uma PESSOA clica.
 *
 * ⚠ ESTA PÁGINA JÁ CONSERTAVA UM DEFEITO E GANHOU OUTRO EM 02/set/2026.
 *
 * O defeito original: o `action_link` do Supabase devolve a sessão no
 * FRAGMENTO da URL (`#access_token=…`), e fragmento nunca chega ao servidor.
 * A rota procurava `?code=`, não achava, e mandava a pessoa para o login com
 * erro. A saída foi usar o `hashed_token` com `verifyOtp` aqui.
 *
 * ⚠ O DEFEITO NOVO: O LINK MORRIA ANTES DE A PESSOA CLICAR.
 *
 * O sócio do fundador recebeu o convite e viu "link expirado" — e depois
 * entrou normalmente pelo "esqueci a senha". O token é de USO ÚNICO, e quem o
 * gastou não foi ele:
 *
 *   • Colar o link num WhatsApp, num Slack ou num e-mail faz o aplicativo
 *     BUSCAR a URL para montar a prévia. Essa visita é um GET — e o GET daqui
 *     trocava o token por sessão. O robô da prévia entrava, queimava o token,
 *     e a pessoa recebia um link morto.
 *   • Antivírus e filtro de e-mail corporativo fazem o mesmo.
 *
 * ⚠ E O SINTOMA CULPAVA A PESSOA. "Link expirado" faz quem recebeu achar que
 * demorou demais. Ele não demorou: o link foi consumido no caminho, por uma
 * máquina, antes de chegar. É a assinatura desta casa na porta de entrada — o
 * único lugar onde alguém encontra o produto pela primeira vez.
 *
 * A CORREÇÃO: o GET não troca mais nada. Ele mostra um botão. A troca acontece
 * no POST, e robô de prévia não aperta botão.
 */
export default async function ConfirmarPage({
  searchParams,
}: {
  searchParams: Promise<{ token_hash?: string; type?: string }>;
}) {
  const sp = await searchParams;
  const tokenHash = sp.token_hash ?? "";
  const tipo = sp.type ?? "recovery";

  if (!tokenHash) {
    redirect(`/login?erro=${encodeURIComponent("Link incompleto. Peça um link novo.")}`);
  }

  /**
   * ⚠ A TROCA MORA NUMA AÇÃO, não no carregamento da página. É esta linha que
   * faz a prévia do WhatsApp deixar de queimar o convite.
   */
  async function confirmar(formData: FormData) {
    "use server";
    const hash = String(formData.get("token_hash") ?? "");
    const t = String(formData.get("type") ?? "recovery");
    if (!hash) redirect(`/login?erro=${encodeURIComponent("Link incompleto. Peça um link novo.")}`);

    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({
      token_hash: hash,
      type: t as "invite" | "recovery" | "signup" | "email",
    });

    if (error) {
      const m = error.message.toLowerCase();
      // ⚠ "USADO" E "EXPIROU" SÃO COISAS DIFERENTES e pedem ações diferentes —
      // quem clicou duas vezes precisa saber que a primeira valeu. O Supabase
      // devolve as duas como `expired`/`invalid`, então o texto descreve as
      // DUAS possibilidades sem escolher uma. Mesma regra do veredito do
      // motor: descreva o fato, não chute a causa.
      const aviso =
        m.includes("expired") || m.includes("invalid")
          ? "Este link não vale mais: ou já foi usado, ou passou da validade. " +
            "Se você já criou sua senha, é só entrar normalmente aqui. Se não criou, " +
            "peça um link novo para quem te adicionou."
          : error.message;
      redirect(`/login?erro=${encodeURIComponent(aviso)}`);
    }

    redirect(t === "signup" ? "/painel/nova-empresa" : "/definir-senha?primeiro=1");
  }

  return (
    <main style={{ maxWidth: 460, margin: "10vh auto", padding: "0 20px" }}>
      <div className="card">
        <h1 style={{ fontSize: 22, marginBottom: 8 }}>Confirmar seu acesso</h1>
        <p className="text-dim" style={{ fontSize: 14, lineHeight: 1.6, marginTop: 0 }}>
          Clique no botão abaixo para entrar e criar sua senha. Este link vale{" "}
          <strong>uma vez só</strong> — por isso ele só é usado quando você clica, e
          não quando o aplicativo mostra a prévia da mensagem.
        </p>
        <form action={confirmar}>
          <input type="hidden" name="token_hash" value={tokenHash} />
          <input type="hidden" name="type" value={tipo} />
          <button type="submit" className="btn btn-primary" style={{ width: "100%" }}>
            Confirmar e criar minha senha
          </button>
        </form>
      </div>
    </main>
  );
}
