import { getActiveTenant } from "@/lib/auth";
import { inviteMember } from "../actions";

const field: React.CSSProperties = {
  display: "block",
  width: "100%",
  padding: "9px 11px",
  marginTop: 5,
  border: "1px solid rgba(128,128,128,0.4)",
  borderRadius: 8,
  background: "var(--bg-elev)",
  color: "var(--text)",
  font: "inherit",
};

export default async function AdicionarMembroPage({
  searchParams,
}: {
  searchParams: Promise<{ erro?: string }>;
}) {
  const { erro } = await searchParams;
  const membership = await getActiveTenant();

  if (!membership?.tenant) {
    return (
      <main>
        <h1 style={{ fontSize: 24, marginTop: 0 }}>Adicionar</h1>
        <p style={{ opacity: 0.85 }}>Sem empresa vinculada.</p>
      </main>
    );
  }
  if (membership.role !== "owner" && membership.role !== "admin") {
    return (
      <main>
        <h1 style={{ fontSize: 24, marginTop: 0 }}>Adicionar</h1>
        <p style={{ opacity: 0.85 }}>Só um administrador pode adicionar membros.</p>
      </main>
    );
  }

  return (
    <main style={{ maxWidth: 420 }}>
      <h1 style={{ fontSize: 24, marginTop: 0 }}>Adicionar vendedor</h1>
      <p style={{ opacity: 0.6, fontSize: 13, marginTop: 4 }}>
        A pessoa recebe um link para definir a própria senha e entrar.
      </p>

      <form action={inviteMember} style={{ display: "grid", gap: 14, marginTop: 20 }}>
        {/* O NOME VEM PRIMEIRO, e quem preenche e QUEM CONVIDA.
            Antes so se pedia o e-mail, e o nome dependia de a pessoa
            convidada preencher depois — o que quase ninguem faz. O resultado
            era a tela de Equipe listando "lulmbrd@gmail.com" em vez de
            "Luciana", e o dono da empresa sem saber quem e quem na propria
            equipe. Quem sabe o nome e quem esta convidando; perguntar ao
            convidado e perguntar a pessoa errada, na hora errada. */}
        <label style={{ fontSize: 13, opacity: 0.85 }}>
          Nome da pessoa
          <input name="nome" type="text" required style={field} placeholder="Ex.: Luciana Bard" />
        </label>
        <label style={{ fontSize: 13, opacity: 0.85 }}>
          E-mail
          <input name="email" type="email" required style={field} />
        </label>
        <label style={{ fontSize: 13, opacity: 0.85 }}>
          Papel
          <select name="role" defaultValue="agent" style={field}>
            <option value="agent">Vendedor (agent)</option>
            <option value="manager">Gerente (manager)</option>
            <option value="admin">Administrador (admin)</option>
          </select>
        </label>
        {/* ⚠ DUAS ENTREGAS, UMA ESCOLHA — nunca as duas. O link do convite é
            de uso único, e gerar outro invalida o anterior: mandar por e-mail
            E mostrar na tela deixaria dois links por aí, um morto, sem nada
            dizendo qual. */}
        <label className="row" style={{ gap: 8, alignItems: "flex-start", fontSize: 13, marginTop: 4 }}>
          <input type="checkbox" name="por_email" value="1" defaultChecked style={{ marginTop: 3 }} />
          <span>
            <strong>Enviar o convite por e-mail</strong>
            <span style={{ display: "block", opacity: 0.75, fontSize: 12, marginTop: 2 }}>
              A pessoa recebe sozinha e cria a senha. Desmarque para receber um link
              na tela e mandar você mesmo — resolve na hora, sem depender de caixa
              de entrada.
            </span>
          </span>
        </label>
        <button
          type="submit"
          style={{
            marginTop: 6,
            padding: "10px 12px",
            borderRadius: 8,
            border: "none",
            background: "var(--brand-blue)",
            color: "#fff",
            font: "inherit",
            cursor: "pointer",
          }}
        >
          Adicionar à equipe
        </button>
        {erro && <p style={{ color: "var(--danger)", fontSize: 13 }}>{erro}</p>}
      </form>
    </main>
  );
}
