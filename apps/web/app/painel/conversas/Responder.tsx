"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  responderPeloCanal, gerarSugestaoDaConversa, registrarCombinado, encerrarAtendimento,
  registrarMotivoDeSaida,
} from "./actions";
import { marcarCompromisso } from "../agenda/horarios-actions";
import { FUSO_PADRAO } from "@/lib/fuso";

/**
 * A CAIXA DE RESPOSTA — e o relógio da janela ao lado dela.
 *
 * ⚠ O RELÓGIO NÃO É ENFEITE. Passadas 24h desde a última mensagem do cliente,
 * a Meta simplesmente não entrega texto livre. Quem está escrevendo precisa
 * saber disso ANTES de escrever, não depois de perder a mensagem — o aviso de
 * "menos de 2h" existe porque esse é o intervalo em que a pessoa monta a
 * resposta, sai para o café e volta com a janela fechada.
 *
 * E o campo não guarda rascunho entre recargas de propósito: rascunho salvo é
 * o começo da aba antiga que regrava valor velho por cima do novo.
 */
export function Responder({
  contactId,
  podeResponder,
  motivoDoBloqueio,
  aviso,
  motivos,
  motivoAtual,
}: {
  contactId: string;
  podeResponder: boolean;
  motivoDoBloqueio: string | null;
  aviso: string | null;
  /** Os motivos de saída deste ramo, do manifesto. Vazio = o bloco não aparece. */
  motivos: { key: string; label: string }[];
  /** O que já está registrado, se já perguntaram. */
  motivoAtual: string | null;
}) {
  const [texto, setTexto] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [enviado, setEnviado] = useState(false);
  const [gerando, setGerando] = useState(false);
  /**
   * O que a IA sugeriu, guardado separado do que está na caixa.
   *
   * ⚠ SÃO DUAS COISAS DIFERENTES e a diferença É a lição: se no fim o texto
   * enviado não for igual a este, alguém corrigiu o motor — e a correção vai
   * junto no envio, sem depender de ninguém lembrar de registrar depois.
   */
  const [sugerido, setSugerido] = useState<string | null>(null);
  const [recusa, setRecusa] = useState<string | null>(null);
  /**
   * O COMBINADO — a data em que ELE disse que volta.
   *
   * ⚠ Fica separado da caixa de resposta de propósito: responder e registrar
   * são duas decisões. A Nanci foi respondida e nada ficou marcado; em
   * setembro ninguém lembraria. Aqui a IA sugere a data lendo a frase dela, e
   * quem confirma é quem leu a conversa.
   */
  const [combinado, setCombinado] = useState<{ data: string; nota: string } | null>(null);
  const [salvandoCombinado, setSalvandoCombinado] = useState(false);
  const [combinadoOk, setCombinadoOk] = useState(false);
  const [encerrando, setEncerrando] = useState(false);
  const [motivo, setMotivo] = useState(motivoAtual ?? "");
  const [motivoTexto, setMotivoTexto] = useState("");
  const [salvandoMotivo, setSalvandoMotivo] = useState(false);
  const [motivoOk, setMotivoOk] = useState(false);
  /**
   * ⚠ O HORÁRIO QUE ELE ACEITOU — e que não chegava na agenda.
   *
   * A IA já lia "pode ser terça de manhã" e escrevia a confirmação; a agenda
   * ficava vazia. É a mesma falha que o fundador pegou com a equipe (duas
   * experimentais sem cadastro, dez dias de silêncio), só que cometida pelo
   * sistema — que existe justamente para não deixar isso acontecer.
   */
  const [horario, setHorario] = useState("");
  const [marcando, setMarcando] = useState(false);
  const [horarioOk, setHorarioOk] = useState(false);
  const router = useRouter();

  /**
   * ⚠ O FREIO DE MÃO DO RELÓGIO. Enquanto esta caixa gera ou envia, o aviso
   * de mensagem nova não pode recarregar a página por baixo — recarregar no
   * meio de uma geração joga fora o texto que a pessoa está prestes a mandar.
   * Ver `AvisoDeMensagem`.
   */
  useEffect(() => {
    const trabalhando = gerando || enviando;
    if (trabalhando) document.body.dataset.ocupado = "1";
    else delete document.body.dataset.ocupado;
    return () => { delete document.body.dataset.ocupado; };
  }, [gerando, enviando]);

  const gerar = async () => {
    setGerando(true);
    setErro(null);
    setRecusa(null);
    try {
      const r = await gerarSugestaoDaConversa(contactId);
      if (!r.ok) { setErro(r.motivo); return; }
      // ⚠ `escalar` COM TEXTO VAZIO É O CASO QUE JÁ QUEBROU ESTA TELA UMA VEZ.
      // A trava anti-invenção devolve mensagem vazia junto com o pedido de
      // escalar; testar a verdade da string deixaria a tela IDÊNTICA depois do
      // clique, e botão que não muda nada é indistinguível de botão quebrado.
      if (r.escalar || !r.texto.trim()) {
        setRecusa(
          "O motor se recusou a redigir" +
            (r.faltam.length ? ` — falta no DNA: ${r.faltam.join(", ")}` : "") +
            ". Escreva você mesmo: ele preferiu não inventar.",
        );
      }
      if (r.texto.trim()) {
        setTexto(r.texto);
        setSugerido(r.texto);
        setEnviado(false);
      }
      if (r.retornoEm) {
        setCombinado({ data: r.retornoEm, nota: "" });
        setCombinadoOk(false);
      }
      if (r.horarioEscolhido) {
        setHorario(r.horarioEscolhido);
        setHorarioOk(false);
      }
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    } finally {
      setGerando(false);
    }
  };


  const enviar = async () => {
    setEnviando(true);
    setErro(null);
    try {
      const r = await responderPeloCanal(contactId, texto, sugerido ?? undefined);
      if (r.ok) {
        setEnviado(true);
        setTexto("");
        setSugerido(null);
        setRecusa(null);
        // ⚠ SEM ISTO A TELA FICA VELHA DEPOIS DE RESPONDER. O fundador
        // respondeu a Jacqueline e a lista continuou dizendo "1 aguardando
        // resposta" — o dado estava certo no banco, a página é que não voltou
        // a buscá-lo. `revalidatePath` no servidor não redesenha componente de
        // cliente já montado. É a terceira vez que isto morde aqui.
        router.refresh();
      } else setErro(r.motivo);
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    } finally {
      setEnviando(false);
    }
  };

  return (
    <div className="card" style={{ background: "var(--bg-elev)" }}>
      {/* ⚠ A CAIXA APARECE SEMPRE, MESMO BLOQUEADA — e isso não é enfeite.
          O fundador abriu esta aba e disse "não consigo escrever, só serve
          para olhar". O campo existia; ele nunca apareceu porque a única
          conversa do sistema era o teste dele de três dias antes, com a janela
          de 24h fechada. O componente trocava a caixa por um aviso, e campo
          AUSENTE é indistinguível de campo que NÃO FOI FEITO.
          É a quarta vez que um comportamento correto chega como defeito por
          causa disso. A regra vale para telas também: **campo cinza com o
          motivo escrito ganha de campo que some.** */}
      {!podeResponder && (
        <p className="badge badge-warn" style={{ whiteSpace: "normal", textAlign: "left" }}>
          {motivoDoBloqueio ?? "Não dá para responder por aqui agora."}
        </p>
      )}
      {aviso && (
        <p className="badge badge-warn" style={{ whiteSpace: "normal", textAlign: "left" }}>
          {aviso}
        </p>
      )}
      <textarea
        value={texto}
        onChange={(e) => { setTexto(e.target.value); setEnviado(false); }}
        placeholder={
          podeResponder
            ? "Escreva a resposta — ela sai pelo mesmo número em que ele escreveu."
            : "A janela de 24h fechou. O campo volta a funcionar assim que ele escrever de novo."
        }
        rows={3}
        style={{ width: "100%", marginTop: 8, opacity: podeResponder ? 1 : 0.55 }}
        disabled={enviando || !podeResponder}
      />
      {recusa && (
        <p className="badge badge-warn" style={{ marginTop: 8, whiteSpace: "normal", textAlign: "left" }}>
          {recusa}
        </p>
      )}

      {sugerido && texto.trim() !== sugerido.trim() && (
        <p className="text-faint" style={{ fontSize: 11, marginTop: 8, marginBottom: 0 }}>
          Você mudou o texto da IA — a diferença vira lição para o motor quando enviar.
        </p>
      )}

      {/* ⚠ O AGENDAMENTO — a peça que faltava para o sistema fazer "tudo o que
          o humano faria". Aparece só quando a pessoa aceitou um horário. */}
      {horario && !horarioOk && (
        <div
          className="mt-16"
          style={{ padding: "12px 14px", borderRadius: 8, border: "1px solid var(--border-brand)" }}
        >
          <p style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>
            📅 Ela aceitou um horário — marcar na agenda?
          </p>
          <p className="text-dim" style={{ margin: "4px 0 10px", fontSize: 13 }}>
            {/* ⚠ COM `timeZone`: sem ele, quem abrisse o painel de outro fuso
                veria um horário diferente do que foi combinado com a lead —
                num campo cuja única função é confirmar a hora marcada. */}
            {new Date(horario).toLocaleString("pt-BR", {
              timeZone: FUSO_PADRAO,
              weekday: "long", day: "2-digit", month: "2-digit",
              hour: "2-digit", minute: "2-digit",
            })}
          </p>
          <button
            type="button"
            className="btn btn-sm btn-primary"
            disabled={marcando}
            onClick={async () => {
              setMarcando(true);
              setErro(null);
              try {
                const r = await marcarCompromisso({
                  contactId,
                  quandoISO: horario,
                  origem: "cliente",
                });
                if (r.ok) { setHorarioOk(true); router.refresh(); }
                else setErro(r.error ?? "Não consegui marcar.");
              } finally {
                setMarcando(false);
              }
            }}
          >
            {marcando ? "marcando…" : "Marcar na agenda"}
          </button>
        </div>
      )}

      {horarioOk && (
        <p className="badge badge-success mt-16" style={{ whiteSpace: "normal", textAlign: "left" }}>
          Marcado na agenda — e agora existe registro, mesmo que ninguém lembre.
        </p>
      )}

      {/* ⚠ O COMBINADO, LOGO ABAIXO DA RESPOSTA. Ele aparece só quando a
          pessoa disse quando volta — e some depois de registrado. Campo que
          fica sempre na tela vira campo que ninguém preenche. */}
      {combinado && !combinadoOk && (
        <div
          className="mt-16"
          style={{ padding: "12px 14px", borderRadius: 8, border: "1px solid var(--border-brand)" }}
        >
          <p style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>
            📌 Ela disse quando volta — registrar?
          </p>
          <p className="text-dim" style={{ margin: "4px 0 10px", fontSize: 13 }}>
            Fica marcado na ficha e ela volta para a fila nesse dia, com o motivo{" "}
            <strong>&ldquo;Você combinou de voltar&rdquo;</strong> — que é o primeiro da lista.
          </p>
          <div className="row wrap" style={{ gap: 10 }}>
            <div>
              <label className="label" htmlFor="combinado-data">Volta em</label>
              <input
                id="combinado-data"
                type="date"
                value={combinado.data}
                onChange={(e) => setCombinado({ ...combinado, data: e.target.value })}
                disabled={salvandoCombinado}
              />
            </div>
            <div style={{ flex: "1 1 240px" }}>
              <label className="label" htmlFor="combinado-nota">O que ela disse</label>
              <input
                id="combinado-nota"
                value={combinado.nota}
                onChange={(e) => setCombinado({ ...combinado, nota: e.target.value })}
                placeholder='ex.: "retorno em setembro, vem com a amiga"'
                disabled={salvandoCombinado}
              />
            </div>
          </div>
          <button
            type="button"
            className="btn btn-sm btn-primary mt-16"
            disabled={salvandoCombinado || !combinado.nota.trim()}
            onClick={async () => {
              setSalvandoCombinado(true);
              setErro(null);
              try {
                const r = await registrarCombinado({ contactId, ...combinado });
                if (r.ok) { setCombinadoOk(true); router.refresh(); }
                else setErro(r.motivo);
              } finally {
                setSalvandoCombinado(false);
              }
            }}
          >
            {salvandoCombinado ? "salvando…" : "Registrar o combinado"}
          </button>
          <p className="text-faint" style={{ fontSize: 11, marginTop: 8, marginBottom: 0 }}>
            A frase é obrigatória: sem ela a conversa de setembro não tem assunto, e o
            sistema manda um lembrete genérico em vez de retomar o que ela disse.
          </p>
        </div>
      )}

      {combinadoOk && (
        <p className="badge badge-success mt-16" style={{ whiteSpace: "normal", textAlign: "left" }}>
          Combinado registrado — ela volta para a fila no dia marcado, e a conversa sai da
          lista de quem espera resposta.
        </p>
      )}

      {/* ⚠ POR QUE ELA PAROU — perguntado onde a resposta acabou de ser dita.
          Duas pessoas disseram não no primeiro dia de campanha e nenhuma disse
          por quê; o motivo sumiu junto com a conversa. É ele que separa
          campanha de 3% de campanha de 15%, porque quem mudou de bairro não
          volta com desconto e quem parou por preço não volta com saudade.
          Fica aqui, e não na ficha três telas adiante: campo que exige desvio
          é campo que ninguém preenche — a lição dos 257 contatos com data
          marcada e ZERO com nota. */}
      {motivos.length > 0 && (
        <div className="mt-16" style={{ paddingTop: 12, borderTop: "1px solid var(--border)" }}>
          <label className="label" htmlFor="motivo-saida">
            Ela disse por que parou?
          </label>
          <div className="row wrap" style={{ gap: 8, alignItems: "flex-start" }}>
            <select
              id="motivo-saida"
              value={motivo}
              onChange={(e) => { setMotivo(e.target.value); setMotivoOk(false); }}
              disabled={salvandoMotivo}
              style={{ width: "auto", minWidth: 220 }}
            >
              <option value="">— ainda não sei —</option>
              {motivos.map((m) => (
                <option key={m.key} value={m.key}>{m.label}</option>
              ))}
            </select>
            <input
              value={motivoTexto}
              onChange={(e) => setMotivoTexto(e.target.value)}
              placeholder="com as palavras dela (opcional, mas é o que abre a próxima conversa)"
              disabled={salvandoMotivo || !motivo}
              style={{ flex: "1 1 260px" }}
            />
            <button
              type="button"
              className="btn btn-sm"
              disabled={salvandoMotivo || !motivo}
              onClick={async () => {
                setSalvandoMotivo(true);
                setErro(null);
                try {
                  const r = await registrarMotivoDeSaida({ contactId, motivo, texto: motivoTexto });
                  if (r.ok) { setMotivoOk(true); router.refresh(); }
                  else setErro(r.motivo);
                } finally {
                  setSalvandoMotivo(false);
                }
              }}
            >
              {salvandoMotivo ? "salvando…" : "Registrar"}
            </button>
          </div>
          {motivoOk ? (
            <p className="badge badge-success" style={{ marginTop: 8, whiteSpace: "normal", textAlign: "left" }}>
              Motivo registrado — é ele que decide como a próxima campanha fala com ela.
            </p>
          ) : (
            /* ⚠ A PERGUNTA CERTA VAI ESCRITA AQUI. "Por que você saiu?" soa
               como cobrança e a resposta vira "falta de tempo" — o que se diz
               para encerrar o assunto. Alternativas concretas custam menos que
               confessar, e por isso coletam a verdade. */
            <p className="text-faint" style={{ fontSize: 11, marginTop: 6, marginBottom: 0 }}>
              Se ela não disse, pergunte assim: <em>&ldquo;só pra eu entender e não te
              incomodar à toa: é mais questão de horário, de estar treinando em outro lugar,
              ou é outra coisa?&rdquo;</em> — nunca &ldquo;por que você saiu?&rdquo;, e nunca
              com uma oferta na mesma mensagem.
            </p>
          )}
        </div>
      )}

      {/* ⚠ "NÃO PRECISA RESPONDER" — o botão que faltava, e o motivo dele.
          A Daniela fechou com "Combinado" depois de já ter sido respondida:
          para a tela a última mensagem é dela e ela está esperando; para quem
          leu, a conversa acabou. O sistema não tem como saber sozinho, e pedir
          para a IA classificar erraria para o lado caro — fechar por engano
          SOME com alguém que esperava.
          Ele fica discreto e longe do "enviar" de propósito: encerrar por
          engano é pior que encerrar de menos. */}
      <div className="row wrap" style={{ gap: 8, alignItems: "center", marginTop: 10 }}>
        <button
          type="button"
          className="btn btn-sm btn-ghost"
          disabled={encerrando || enviando || gerando}
          onClick={async () => {
            setEncerrando(true);
            setErro(null);
            try {
              const r = await encerrarAtendimento(contactId);
              if (r.ok) router.refresh();
              else setErro(r.motivo);
            } finally {
              setEncerrando(false);
            }
          }}
        >
          {encerrando ? "encerrando…" : "✓ Não precisa responder"}
        </button>
        <span className="text-faint" style={{ fontSize: 11 }}>
          Tira da lista de quem espera. Se ela escrever de novo, volta na hora.
        </span>
      </div>


      <div className="row wrap" style={{ gap: 8, alignItems: "center", marginTop: 8 }}>
        {/* ⚠ GERAR E ENVIAR SÃO BOTÕES SEPARADOS, sempre. Um botão só que
            gerasse e mandasse tiraria da pessoa o único momento em que ela
            pode discordar — e é justamente esse momento que autoriza o
            automático mais tarde. */}
        <button
          type="button"
          className="btn btn-sm"
          onClick={gerar}
          disabled={gerando || enviando || !podeResponder}
        >
          {gerando ? "gerando…" : "✨ Gerar resposta com IA"}
        </button>
        <button
          type="button"
          className="btn btn-sm btn-primary"
          onClick={enviar}
          disabled={enviando || !texto.trim() || !podeResponder}
        >
          {enviando ? "enviando…" : "Responder pelo número da empresa"}
        </button>
        {enviado && <span className="badge badge-success">enviada</span>}
      </div>
      {erro && (
        <p className="badge badge-danger" style={{ marginTop: 8, whiteSpace: "normal", textAlign: "left" }}>
          {erro}
        </p>
      )}
      <p className="text-faint" style={{ fontSize: 11, marginTop: 8, marginBottom: 0 }}>
        Sai do número do sistema, no mesmo fio da conversa. Dentro da janela de 24h é
        texto livre e hoje não custa nada.
      </p>
    </div>
  );
}
