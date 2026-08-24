import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getActiveTenant } from "@/lib/auth";

export const metadata = { title: "O que a IA aprendeu" };

/**
 * O QUE A IA APRENDEU COM VOCÊ.
 *
 * ⚠ POR QUE ESTA TELA EXISTE, e ela responde uma pergunta do fundador.
 *
 * Ele perguntou *"como deixaremos a IA ainda mais inteligente?"*, e a resposta
 * foi capturar o par "o motor escreveu X / o vendedor mandou Y" — que já
 * acontecia todo dia e era jogado fora.
 *
 * Mas capturar em silêncio não basta. Aprendizado que a pessoa não ENXERGA é
 * indistinguível de aprendizado que não acontece — e este projeto já tem
 * quatro casos de comportamento correto lido como defeito por falta de tela.
 *
 * Aqui ele vê o antes e o depois lado a lado. Duas coisas saem disso, e a
 * segunda vale mais:
 *
 *   1. A confiança de que o sistema está aprendendo de verdade.
 *   2. **O padrão das próprias correções.** Quando as seis últimas mostram a
 *      mesma coisa sendo cortada, isso não é ajuste de texto — é uma regra do
 *      negócio que ninguém escreveu ainda, e o lugar dela é o DNA ou a
 *      biblioteca, não a memória do vendedor.
 */
export default async function CorrecoesPage() {
  const membership = await getActiveTenant();
  const tenant = membership?.tenant;
  if (!tenant) {
    return (<main><h1>O que a IA aprendeu</h1><p className="text-dim">Sem empresa vinculada.</p></main>);
  }

  const supabase = await createClient();

  // paginacao-ok: `.limit(50)` é decisão de produto — "as 50 correções mais
  // recentes". Com `ORDER BY` explícito, senão o PostgREST devolveria 50
  // arbitrárias e a tela mostraria um recorte que ninguém pediu.
  const { data } = await supabase
    .from("ai_edits")
    .select("id, contexto, sugerido, enviado, occurred_at")
    .eq("tenant_id", tenant.id)
    .order("occurred_at", { ascending: false })
    .limit(50);

  const linhas = (data as {
    id: string; contexto: string; sugerido: string; enviado: string; occurred_at: string;
  }[] | null) ?? [];

  // ⚠ O BANCO DE PROVAS TAMBEM ENSINA, E ESTAVA INVISIVEL AQUI.
  //
  // O fundador julgou 73 mensagens em duas horas, abriu esta tela e viu
  // "nenhuma correção ainda" — e perguntou se o trabalho dele tinha se
  // perdido. Não tinha: ele estava em `provas`, e esta tela só lia `ai_edits`.
  //
  // Duas tabelas alimentando o MESMO prompt, com a tela chamada "o que a IA
  // aprendeu" mostrando só metade. Trabalho que não aparece é indistinguível
  // de trabalho perdido — a mesma regra do campo que some.
  //
  // paginacao-ok: `.limit(50)` com ORDER BY explícito, mesmo motivo do de cima.
  const { data: dadosProvas } = await supabase
    .from("provas")
    .select("id, mensagem, sugestao, nota, veredito, created_at")
    .eq("tenant_id", tenant.id)
    .neq("veredito", "descartada")
    .order("created_at", { ascending: false })
    .limit(50);

  const provas = (dadosProvas as {
    id: string; mensagem: string; sugestao: string; nota: string | null;
    veredito: string; created_at: string;
  }[] | null) ?? [];

  const placar = {
    enviaria: provas.filter((p) => p.veredito === "enviaria").length,
    ajustaria: provas.filter((p) => p.veredito === "ajustaria").length,
    erro_grave: provas.filter((p) => p.veredito === "erro_grave").length,
  };
  const julgadas = placar.enviaria + placar.ajustaria + placar.erro_grave;
  const comNota = provas.filter((p) => p.nota?.trim());

  const quando = (iso: string) =>
    new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

  return (
    <main>
      <div className="between">
        <h1>O que a IA aprendeu</h1>
        <Link href="/painel/fila" className="btn btn-sm btn-ghost">Fila de envio →</Link>
      </div>
      <p className="text-dim" style={{ marginTop: 4 }}>
        Toda vez que alguém ajusta a mensagem antes de enviar, o sistema guarda as duas
        versões. As <strong>seis mais recentes</strong> voltam para dentro do motor como
        exemplo — ele passa a escrever no jeito da casa em vez do jeito genérico.
      </p>

      {/* O RESULTADO DO BANCO DE PROVAS — porque é aqui que a pessoa vem
          procurar o que a IA aprendeu, e era aqui que ele não estava. */}
      {julgadas > 0 && (
        <div className="card mt-24" style={{ borderColor: "var(--border-brand)" }}>
          <div className="between">
            <p className="eyebrow" style={{ margin: 0 }}>Do banco de provas</p>
            <Link href="/painel/provas" className="btn btn-sm btn-ghost">Julgar mais →</Link>
          </div>
          <div className="row wrap mt-16" style={{ gap: 10, alignItems: "baseline" }}>
            <span className="badge badge-success">{placar.enviaria} enviaria</span>
            <span className="badge badge-warn">{placar.ajustaria} ajustaria</span>
            <span className={placar.erro_grave ? "badge badge-danger" : "badge"}>
              {placar.erro_grave} erro grave
            </span>
            <span className="text-faint" style={{ fontSize: 13 }}>
              de {julgadas} mensagens reais julgadas
            </span>
          </div>
          <p className="text-dim" style={{ fontSize: 13, marginTop: 10, marginBottom: 0 }}>
            As <strong>seis notas mais recentes</strong> entram no motor junto com as
            correções — é o dono da empresa dizendo o que faltou, e vale como regra.
          </p>

          {comNota.length > 0 && (
            <ul style={{ listStyle: "none", padding: 0, margin: "16px 0 0" }}>
              {comNota.slice(0, 12).map((p, i) => (
                <li key={p.id} style={{ padding: "10px 0", borderTop: i ? "1px solid var(--border)" : "none" }}>
                  <p className="text-faint" style={{ fontSize: 12, margin: 0 }}>
                    {quando(p.created_at)} · o cliente disse: &ldquo;{p.mensagem.slice(0, 90)}
                    {p.mensagem.length > 90 ? "…" : ""}&rdquo;
                  </p>
                  <p style={{ fontSize: 14, margin: "4px 0 0" }}>{p.nota}</p>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {linhas.length === 0 ? (
        <div className="card mt-24">
          <p style={{ marginTop: 0 }}>
            <strong>Nenhuma correção ainda.</strong>
          </p>
          <p className="text-dim" style={{ fontSize: 14 }}>
            Isso é o esperado hoje. Abra a <Link href="/painel/fila">Fila de envio</Link>,
            gere uma mensagem e ajuste o texto antes de enviar — o antes e o depois
            aparecem aqui, e o motor passa a aprender com eles.
          </p>
          {/* ⚠ Lista vazia precisa dizer se é "ainda não aconteceu" ou "está
              quebrado". Sem esta frase, as duas se parecem — e é a quinta vez
              que isso apareceria neste produto. */}
          <p className="text-faint" style={{ fontSize: 12, marginBottom: 0 }}>
            Enviar a mensagem sem mudar nada não gera correção: mensagem igual não é
            lição, e encheria esta lista de ruído até o que importa sumir dentro dela.
          </p>
        </div>
      ) : (
        <>
          <div className="card mt-16 row" style={{ gap: 12, alignItems: "baseline" }}>
            <span className="badge badge-brand">{linhas.length} correção(ões)</span>
            <span className="text-dim" style={{ fontSize: 14 }}>
              As <strong>{Math.min(6, linhas.length)}</strong> mais recentes estão dentro do
              prompt agora.
            </span>
          </div>

          {/* ⚠ ANTES E DEPOIS LADO A LADO, sempre — e nunca só o "depois".
              O valor está na DIFERENÇA: é ela que mostra a regra do negócio que
              ninguém escreveu. Mostrar só o texto final transformaria isto num
              histórico de mensagens, que já existe na ficha do contato. */}
          <ul style={{ listStyle: "none", padding: 0, marginTop: 16 }}>
            {linhas.map((l, i) => (
              <li key={l.id} className="card" style={{ marginTop: 12 }}>
                <div className="row wrap" style={{ gap: 8, alignItems: "baseline" }}>
                  {i < 6 && <span className="badge badge-success">no prompt</span>}
                  <span className="text-faint" style={{ fontSize: 12 }}>{quando(l.occurred_at)}</span>
                  <span className="text-dim grow" style={{ fontSize: 13 }}>{l.contexto}</span>
                </div>

                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
                    gap: 12,
                    marginTop: 12,
                  }}
                >
                  <div>
                    <p className="text-faint" style={{ fontSize: 11, margin: 0 }}>O motor escreveu</p>
                    <p style={{ fontSize: 13, margin: "4px 0 0", whiteSpace: "pre-wrap", opacity: 0.7 }}>
                      {l.sugerido}
                    </p>
                  </div>
                  <div style={{ borderLeft: "3px solid var(--success)", paddingLeft: 12 }}>
                    <p className="text-faint" style={{ fontSize: 11, margin: 0 }}>
                      <strong>O vendedor mandou</strong>
                    </p>
                    <p style={{ fontSize: 13, margin: "4px 0 0", whiteSpace: "pre-wrap" }}>
                      {l.enviado}
                    </p>
                  </div>
                </div>
              </li>
            ))}
          </ul>

          <div className="card mt-24">
            <p className="eyebrow" style={{ marginBottom: 8 }}>O que fazer com isto</p>
            <p className="text-dim" style={{ fontSize: 14, marginBottom: 0 }}>
              Se a mesma correção aparecer três ou quatro vezes, ela deixou de ser ajuste
              de texto e virou <strong>regra do negócio</strong>. O lugar dela é o{" "}
              <Link href="/painel/dna">DNA</Link> — assim o motor acerta de primeira, em
              vez de acertar por imitação.
            </p>
          </div>
        </>
      )}
    </main>
  );
}
