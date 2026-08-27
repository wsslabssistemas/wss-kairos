import { ROTULO, type MotivoDaFila } from "@/lib/fila";
import { MOTIVOS, type RoteamentoPorMotivo, type ModelosPorMotivo } from "@/lib/roteamento";
import { salvarRoteamento } from "./actions";

/**
 * POR QUAL NÚMERO CADA MOTIVO SAI.
 *
 * ⚠ A TELA PRECISA DIZER O QUE MUDA PARA O CLIENTE FINAL, não só o que muda no
 * sistema. Ligar um motivo aqui faz uma pessoa real receber mensagem de um
 * número diferente do que ela conhece — e a mesma conversa passa a ter dois
 * remetentes se ela responder para a recepção. Foi o defeito que o fundador
 * nomeou em 16/ago, e uma caixinha de marcar sem explicação o reintroduz.
 *
 * Por isso cada linha diz o efeito, e o padrão vem quase todo desligado.
 */
export function Roteamento({
  roteamento,
  modelos,
  temCredencial,
  tetoCents,
}: {
  roteamento: RoteamentoPorMotivo;
  modelos: ModelosPorMotivo;
  temCredencial: boolean;
  /** Teto de gasto do mês, em centavos. `null` = sem teto. */
  tetoCents: number | null;
}) {
  const efeito: Record<MotivoDaFila, string> = {
    combinado: "Conversa já aberta com quem atendeu. Trocar o número aqui costuma atrapalhar.",
    renovacao: "Aluno atual, que fala com a recepção pelo número de sempre.",
    followup: "Lead em conversa com um vendedor. É a relação dele, não a da empresa.",
    recompra: "Cliente da casa. Mesmo caso da renovação.",
    lembrete: "Data sem motivo anotado — não existe modelo aprovado possível para isto.",
    reativacao: "Ex-alunos, que não falam com ninguém há meses. É o caso que o número oficial resolve.",
  };

  return (
    <div className="card mt-16">
      <p className="eyebrow" style={{ marginBottom: 8 }}>Por onde cada motivo sai</p>

      <p className="text-dim" style={{ marginTop: 0, fontSize: 14 }}>
        <strong>Desmarcado, a mensagem sai do WhatsApp de quem está na tela</strong> — pelo
        número que o cliente já conhece, e sem custo nenhum: não passa pela Meta.
        Marcado, ela sai pelo número do sistema, e aí a Meta cobra por mensagem.
      </p>
      <p className="text-dim" style={{ fontSize: 14 }}>
        A regra que vale a pena guardar: <strong>separe por público, não por
        ferramenta.</strong> Quem já conversa com um vendedor deve continuar recebendo
        dele. O número do sistema existe para falar com quem não tem essa conversa —
        e para aguentar volume que um celular pessoal não aguenta.
      </p>

      {!temCredencial && (
        <p className="badge badge-warn" style={{ whiteSpace: "normal", textAlign: "left" }}>
          O canal oficial ainda não está configurado nesta empresa. Enquanto não estiver,
          tudo sai pelo link humano, mesmo o que estiver marcado aqui.
        </p>
      )}

      <form action={salvarRoteamento} className="stack" style={{ gap: 0, marginTop: 12 }}>
        {MOTIVOS.map((m) => (
          <div
            key={m}
            style={{ padding: "12px 0", borderTop: "1px solid var(--border)" }}
          >
            <label className="row" style={{ gap: 8, alignItems: "center", fontSize: 14 }}>
              <input type="checkbox" name={`canal_${m}`} defaultChecked={roteamento[m]} />
              <strong>{ROTULO[m]}</strong>
            </label>
            <p className="text-faint" style={{ fontSize: 12, margin: "4px 0 0 24px" }}>
              {efeito[m]}
            </p>

            {/* O NOME DO MODELO USA O NOME DA META, palavra por palavra — é o
                que a pessoa COPIA da outra tela. Rótulo inventado vira
                problema de tradução no meio de uma tarefa difícil. */}
            <div style={{ margin: "8px 0 0 24px" }}>
              <label className="label" htmlFor={`modelo_${m}`} style={{ fontSize: 12 }}>
                Nome do modelo aprovado
              </label>
              <input
                id={`modelo_${m}`}
                name={`modelo_${m}`}
                type="text"
                defaultValue={modelos[m] ?? ""}
                placeholder={m === "lembrete" ? "não se aplica" : `ex.: ${sugestao(m)}`}
                disabled={m === "lembrete"}
                style={{ maxWidth: 320 }}
              />
              <p className="text-faint" style={{ fontSize: 11, marginTop: 4 }}>
                {m === "lembrete"
                  ? "Sem motivo anotado não há assunto — e modelo é texto fixo, então ele só poderia inventar um."
                  : "Só é usado quando faz mais de 24h que a pessoa escreveu. Dentro da janela, o texto sai livre."}
              </p>
            </div>
          </div>
        ))}

        <p className="text-faint" style={{ fontSize: 12, marginTop: 12 }}>
          Marcado e sem modelo cadastrado, a fila <strong>não</strong> envia sozinha fora
          da janela de 24h — ela avisa o que falta e deixa o envio manual do lado. Cair
          no número pessoal em silêncio seria despejar a fila inteira no celular de
          alguém.
        </p>

        {/* O TETO DE GASTO, junto das decisões que o gastam.
            Ele NÃO se soma ao teto de IA: lá o freio é parar de gerar, e isso
            só é seguro porque o manual custa zero. Se os dois dividissem o
            mesmo número, estourar por mensagem desligaria a IA — e as
            mensagens continuariam saindo. */}
        <div style={{ marginTop: 16, paddingTop: 16, borderTop: "1px solid var(--border)" }}>
          <label className="label" htmlFor="teto_mensagens">Teto de gasto com mensagens por mês</label>
          <input
            id="teto_mensagens"
            name="teto_mensagens"
            type="text"
            inputMode="decimal"
            defaultValue={tetoCents ? (tetoCents / 100).toFixed(2).replace(".", ",") : ""}
            placeholder="deixe vazio para não ter teto"
            style={{ maxWidth: 200 }}
          />
          <p className="text-faint" style={{ fontSize: 11, marginTop: 4 }}>
            Atingido o teto, o envio pelo número do sistema para até virar o mês — e a
            fila volta a sair pelo WhatsApp de quem atende, que não custa nada. Vazio
            significa sem teto.
          </p>
        </div>

        <button type="submit" className="btn btn-primary mt-16" style={{ alignSelf: "flex-start" }}>
          Salvar roteamento
        </button>
      </form>
    </div>
  );
}

/**
 * As sugestões batem com os textos de `docs/blueprint/MODELOS_WHATSAPP.md`.
 *
 * ⚠ SEM VOCABULÁRIO DE SEGMENTO. `reativacao` sugeria `reativacao_ex_aluno`
 * para TODO ramo — um dono de barbearia lia "ex_aluno" num campo que ele vai
 * copiar para o painel da Meta. É a Lei 1 vazando pela tela: o núcleo não
 * conhece aluno, matrícula nem corte, e o nome sugerido aqui é núcleo.
 */
function sugestao(m: MotivoDaFila): string {
  const nomes: Partial<Record<MotivoDaFila, string>> = {
    combinado: "combinado_retorno",
    renovacao: "renovacao_vencimento",
    followup: "followup_retomada",
    recompra: "recompra_retorno",
    reativacao: "reativacao_cliente",
  };
  return nomes[m] ?? "";
}
