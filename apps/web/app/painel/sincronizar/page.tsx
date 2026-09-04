import Link from "next/link";
import { getActiveTenant } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Sincronizador } from "./Sincronizador";

export const metadata = { title: "Sincronizar com o sistema da academia" };

/**
 * ⚠ ESTA TELA GRAVA MILHARES DE LINHAS NUMA CHAMADA SÓ.
 *
 * O arquivo real da Be Fitness tem 1.548 pagantes, e cada um é um UPDATE
 * endereçado por id — não dá para juntar num comando só porque o conteúdo de
 * `custom` é diferente em cada linha. Com o padrão da Vercel a função é
 * interrompida no meio, e função interrompida no meio **grava parte e some**:
 * o pior desfecho possível para uma sincronização, porque ela fica sem dizer
 * até onde chegou.
 *
 * A folga vem de dois lados — `mapLimit` em `actions.ts` reduz o tempo total,
 * e este número dá o teto para o caso da base crescer.
 */
export const maxDuration = 60;

export default async function SincronizarPage() {
  const m = await getActiveTenant();
  const podeVer = m?.tenant && (m.role === "owner" || m.role === "admin");

  if (!podeVer) {
    return (
      <main>
        <h1>Sincronizar</h1>
        <p className="text-dim">Só o dono ou um administrador pode sincronizar os dados da empresa.</p>
      </main>
    );
  }

  // O link publicado desta empresa, para o campo já vir preenchido — a graça é
  // não colar de novo toda vez que a planilha mudar.
  const supabase = await createClient();
  // paginacao-ok: uma linha, chave primária.
  const { data: t } = await supabase
    .from("tenants")
    .select("settings")
    .eq("id", m!.tenant!.id)
    .maybeSingle();
  const linkSalvo = String(
    ((t as { settings: Record<string, unknown> | null } | null)?.settings ?? {}).planilha_url ?? "",
  );

  return (
    <main>
      <div className="between">
        <h1>Sincronizar</h1>
        <Link href="/painel/contatos" className="btn btn-sm btn-ghost">Contatos →</Link>
      </div>
      <p className="text-dim" style={{ marginTop: 4 }}>
        Suba os relatórios do sistema da academia. O Kairós compara com o que já sabe,
        <strong> mostra o que mudou</strong>, e só grava depois que você confirmar.
      </p>

      {/* ⚠ ESTE BLOCO EXPLICA A DECISÃO DE PRODUTO, e ela veio de uma pergunta
          do fundador: "toda vez que eu atualizar a planilha, quem virou
          ex-cliente vai ser apagado, e o sistema perde o histórico."

          A saída não foi o sistema manter uma planilha própria — seria um
          segundo dono do mesmo dado, sobrescrito toda semana. Foi ele COMPARAR:
          a planilha é a foto de hoje, o histórico é do banco, e a diferença
          entre as duas é o fato. */}
      <div className="card mt-24" style={{ borderColor: "var(--border-brand)", background: "var(--brand-gradient-soft)" }}>
        <p className="eyebrow" style={{ marginBottom: 6 }}>Como funciona</p>
        <p style={{ fontSize: 14, margin: 0 }}>
          Você não precisa manter histórico nenhum. <strong>A planilha é a foto de hoje</strong> —
          quem sai, sai dela. O sistema percebe a ausência (porque lembra do que havia antes)
          e registra a data de saída sozinho. Se a pessoa voltar meses depois, ele reconhece
          que ela <em>já foi cliente</em> em vez de tratar como gente nova.
        </p>
        <p className="text-dim" style={{ fontSize: 13, marginTop: 10, marginBottom: 0 }}>
          Vigência que anda para frente um ciclo inteiro é <strong>renovação</strong>; se anda
          poucos dias é <strong>ajuste de data</strong> e a pessoa continua na régua de vencimento —
          a diferença evita mandar &ldquo;obrigado por renovar&rdquo; para quem só teve a
          cobrança remarcada.
        </p>
      </div>

      <div className="mt-24">
        <Sincronizador linkSalvo={linkSalvo} />
      </div>

      <p className="text-faint" style={{ marginTop: 24, fontSize: 12 }}>
        Se muita gente sumir de uma vez, o sistema <strong>bloqueia e mostra o que teria feito</strong>,
        em vez de dar baixa. Planilha exportada com filtro aplicado produz exatamente esse
        resultado, e uma baixa em massa não se desfaz com um clique.
      </p>
    </main>
  );
}
