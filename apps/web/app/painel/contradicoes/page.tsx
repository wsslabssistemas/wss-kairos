import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getActiveTenant } from "@/lib/auth";
import { getSkillFormConfig } from "@/lib/skill";
import { lerTudo } from "@/lib/paginado";
import { acharContradicoes, ROTULO_CONTRADICAO, type ContatoParaConferir } from "@/lib/contradicoes";
import { paresDeGemeos } from "@/lib/gemeo";
import { paraE164BR } from "@/lib/phone";
import { moverParaSaida, marcarConferido } from "./actions";

export const metadata = { title: "Conferir" };

/**
 * O QUE O SISTEMA AFIRMA E A FONTE NÃO CONFIRMA.
 *
 * ⚠ ELA EXISTE PORQUE CONSERTAR OS CASOS DE HOJE NÃO RESOLVE O PROBLEMA.
 *
 * O fundador viu pessoas marcadas como matriculadas que não são alunas e
 * suspeitou da importação de recebíveis. A importação estava inocente — ela
 * nunca toca a etapa. A causa é permanente: **`convertido` nunca é revogado**,
 * então uma vez cliente, cliente para sempre, mesmo tendo saído há um ano.
 * Corrigir os 16 de agora traria os próximos na semana seguinte.
 *
 * A tela é do GESTOR, não do vendedor: aqui a pergunta é "o que o sistema está
 * afirmando sem base?", e a resposta muda dado de cliente. Cada linha tem o
 * motivo escrito e duas saídas explícitas — nada se corrige sozinho, porque
 * mover gente de etapa por dedução é justamente a operação que a trava da
 * planilha parcial existe para impedir.
 */
export default async function ContradicoesPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; erro?: string }>;
}) {
  const { ok, erro } = await searchParams;
  const m = await getActiveTenant();
  const tenant = m?.tenant;
  if (!tenant) {
    return (<main><h1>Conferir</h1><p className="text-dim">Sem empresa vinculada.</p></main>);
  }
  const ehGestor = m.role === "owner" || m.role === "admin";
  if (!ehGestor) {
    return (
      <main>
        <h1>Conferir</h1>
        <p className="text-dim">
          Esta tela mostra contradições entre o sistema e a fonte de dados, e as decisões
          dela mudam o cadastro. Só o dono ou um administrador vê.
        </p>
      </main>
    );
  }

  const { stages, contract } = await getSkillFormConfig(tenant.skill_key);
  const supabase = await createClient();

  // PAGINADO: com 1.700 contatos, uma leitura cortada em 1.000 esconderia
  // contradição — e contradição escondida é o estado anterior a esta tela.
  const contatos = await lerTudo<ContatoParaConferir>(
    (de, ate) => supabase
      .from("contacts")
      .select("id, name, journey_stage, contract_end, phone, custom")
      .eq("tenant_id", tenant.id)
      .is("deleted_at", null)
      .order("id")
      .range(de, ate),
    { rotulo: "contatos para conferir" },
  );

  const hojeISO = new Date().toISOString();

  // ⚠ AS FICHAS DOBRADAS, com a MESMA varredura que já esconde o cadastro
  // velho da fila. Ela sabia disso desde agosto e nunca contou para ninguém:
  // esconder impede a mensagem errada e deixa o cadastro torto para sempre.
  //
  // O telefone é normalizado por `paraE164BR`, que DERIVA e nunca grava — o
  // caso da Lilian era exatamente um dígito a menos digitado na segunda ficha.
  const gemeos = paresDeGemeos(
    contatos.map((c) => {
      const n = paraE164BR(c.phone);
      return { id: c.id, digitos: n.ok ? n.digitos : null, contract_end: c.contract_end };
    }),
    hojeISO,
  );

  const achados = acharContradicoes({
    contatos,
    etapasGanhas: new Set(stages.filter((s) => s.won).map((s) => s.key)),
    usaContrato: !!contract?.enabled,
    hojeISO,
    gemeos,
  });

  const temSaida = !!contract?.ended_stage;
  const labelSaida = stages.find((s) => s.key === contract?.ended_stage)?.label ?? "etapa de saída";
  const porTipo = (t: string) => achados.filter((a) => a.tipo === t).length;

  return (
    <main>
      <div className="between">
        <h1>Conferir</h1>
        <Link href="/painel/gestao" className="btn btn-sm btn-ghost">Gestão →</Link>
      </div>
      <p className="text-dim" style={{ marginTop: 4 }}>
        O que o sistema <strong>afirma</strong> e a fonte não confirma. Cada linha muda o
        que o motor vai dizer ao cliente — por isso nada aqui se corrige sozinho.
      </p>

      {ok === "movido" && <p className="badge badge-success mt-16">Movido para {labelSaida}.</p>}
      {ok === "conferido" && <p className="badge badge-success mt-16">Marcado como conferido — sai da lista.</p>}
      {erro && <p className="badge badge-danger mt-16" style={{ whiteSpace: "normal" }}>{erro}</p>}

      {achados.length === 0 ? (
        <div className="card mt-24">
          <p className="text-dim" style={{ margin: 0 }}>
            Nada para conferir. O que o sistema mostra bate com o que a fonte diz. 🎯
          </p>
        </div>
      ) : (
        <>
          <div className="row wrap mt-16" style={{ gap: 8 }}>
            {(Object.keys(ROTULO_CONTRADICAO) as (keyof typeof ROTULO_CONTRADICAO)[]).map((t) =>
              porTipo(t) > 0
                ? <span key={t} className="badge badge-warn">{ROTULO_CONTRADICAO[t]}: <strong>{porTipo(t)}</strong></span>
                : null,
            )}
          </div>

          <ul style={{ listStyle: "none", padding: 0, marginTop: 8 }}>
            {achados.slice(0, 100).map((a) => (
              <li key={`${a.contactId}-${a.tipo}`}
                  style={{ padding: "14px 0", borderBottom: "1px solid var(--border)" }}>
                <div className="row wrap" style={{ gap: 10, alignItems: "center" }}>
                  <span className="badge badge-warn" style={{ minWidth: 150, justifyContent: "center" }}>
                    {ROTULO_CONTRADICAO[a.tipo]}
                  </span>
                  <Link href={`/painel/contatos/${a.contactId}`} className="grow" style={{ minWidth: 160, fontSize: 14 }}>
                    {a.nome}
                  </Link>
                </div>
                <p className="text-dim" style={{ fontSize: 13, margin: "8px 0 0" }}>{a.descricao}</p>
                <p className="text-faint" style={{ fontSize: 12, margin: "4px 0 0" }}>{a.sugestao}</p>
                <div className="row wrap" style={{ gap: 8, marginTop: 10 }}>
                  {temSaida && (
                    <form action={moverParaSaida}>
                      <input type="hidden" name="contact_id" value={a.contactId} />
                      <button type="submit" className="btn btn-sm">Mover para {labelSaida}</button>
                    </form>
                  )}
                  <form action={marcarConferido}>
                    <input type="hidden" name="contact_id" value={a.contactId} />
                    <button type="submit" className="btn btn-sm btn-ghost">Conferi, está certo</button>
                  </form>
                </div>
              </li>
            ))}
          </ul>
          {achados.length > 100 && (
            <p className="text-faint" style={{ fontSize: 13, textAlign: "center" }}>
              Mostrando 100 de {achados.length}. Resolva estes e a lista recarrega.
            </p>
          )}
        </>
      )}
    </main>
  );
}
