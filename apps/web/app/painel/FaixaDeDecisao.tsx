import Link from "next/link";
import { decisoesPendentes } from "@/lib/fase2-db";

/**
 * QUEM ESTÁ ESPERANDO RESPOSTA — em TODA tela do painel.
 *
 * ⚠ POR QUE SAIU DA AUTOMAÇÃO E VEIO PARA CÁ. O painel de decisão pendente
 * nasceu dentro da Automação, e o fundador pegou o defeito na hora:
 * *"preciso que esse aviso apareça em qualquer tela, assim os vendedores podem
 * responder"*.
 *
 * Ele está certo, e por dois motivos que se somam. **Automação é tela de dono**
 * — quem atende cliente vive em Conversas e na Fila, e um aviso que só existe
 * numa aba de configuração é um aviso que a pessoa certa nunca vê. E a fase 2
 * responde de madrugada e no fim de semana: quando a IA se recusa a escrever,
 * a conversa fica parada até alguém ABRIR a tela onde o aviso mora.
 *
 * É a mesma lição do aviso de mensagem nova (`AvisoDeMensagem`), que veio do
 * mesmo lugar: *"sendo em qualquer tela, o funcionário já é notificado"*. O que
 * depende de alguém lembrar de olhar não acontece à noite nem no sábado.
 *
 * ⚠ E ELE NÃO ATRAPALHA. É uma faixa no topo do conteúdo, não um pop-up e não
 * uma navegação automática: quem decide se vai é a pessoa. A regra que o
 * fundador ditou sobre o outro aviso vale igual aqui.
 *
 * ⚠ SILENCIOSO QUANDO NÃO HÁ NADA. Uma faixa que aparece sempre, mesmo vazia,
 * vira parte do cenário em três dias — e aí ela não avisa mais nada.
 */
export async function FaixaDeDecisao({ tenantId }: { tenantId: string }) {
  // Três é o bastante para a faixa: ela existe para CHAMAR, não para listar. A
  // lista inteira mora na Automação, e o link leva até lá.
  const pendentes = await decisoesPendentes(tenantId, 3);
  if (pendentes.length === 0) return null;

  return (
    <div
      className="card"
      style={{
        borderColor: "var(--danger)",
        marginBottom: 16,
        padding: "12px 16px",
      }}
    >
      <p className="eyebrow" style={{ margin: 0, marginBottom: 6 }}>
        {pendentes.length === 1
          ? "Alguém está esperando resposta"
          : `${pendentes.length}+ pessoas esperando resposta`}
      </p>
      <p className="text-dim" style={{ fontSize: 13, margin: "0 0 8px" }}>
        A IA gerou e <strong>não enviou</strong> — quase sempre porque falta um fato para
        responder sem inventar. Quem responde tem que ser gente.
      </p>
      <ul className="stack" style={{ gap: 6, listStyle: "none", padding: 0, margin: 0 }}>
        {pendentes.map((p) => (
          <li key={p.id} style={{ fontSize: 13 }}>
            <Link href={`/painel/conversas?contato=${p.contactId}`}>
              <strong>{p.nome}</strong>
            </Link>
            <span className="text-faint"> — {p.porque}</span>
          </li>
        ))}
      </ul>
      <p style={{ margin: "8px 0 0", fontSize: 12 }}>
        <Link href="/painel/automacao">Ver todas em Automação</Link>
      </p>
    </div>
  );
}
