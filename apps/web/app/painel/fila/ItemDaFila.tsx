"use client";

import { useState } from "react";
import { AvisoDeCota } from "@/app/painel/AvisoDeCota";
import { linkDeEnvio, ROTULO, type MotivoDaFila } from "@/lib/fila";
import { prepararToque, marcarEnviado, enviarPeloSistema } from "./actions";

/**
 * UMA LINHA DA FILA — preparar, enviar, marcar.
 *
 * A GERAÇÃO É SOB DEMANDA, uma por clique, e isso é decisão de custo, não de
 * preguiça: gerar a fila inteira de uma vez transformaria uma tela aberta por
 * engano em dezenas de reais. Com a cota de IA no ar, o teto age de qualquer
 * jeito — mas gastar só no que a pessoa vai realmente enviar é melhor que
 * gastar e bloquear.
 *
 * O ENVIO CONTINUA HUMANO. O `wa.me` abre o WhatsApp com o texto escrito; a
 * pessoa lê, ajusta e envia. Não é limitação temporária: é o que dispensa
 * template aprovado pela Meta e o que protege o número do cliente pagante de
 * ser banido por padrão de disparo.
 */
export function ItemDaFila({
  contactId,
  nome,
  numero,
  ajusteNoNumero,
  motivo,
  intencao,
  observacao,
  atraso,
  saiPeloSistema = false,
}: {
  contactId: string;
  nome: string;
  numero: string | null;
  /**
   * Preenchido quando o telefone guardado precisou ser INTERPRETADO para
   * virar E.164 — hoje, na prática, o celular antigo que ganhou o nono
   * dígito. Na base da Be Fitness isso é 39% dos contatos, e é justamente
   * por ser tanta gente que o aviso não pode ficar só no log: quem clica
   * precisa ver o que foi deduzido ANTES de a mensagem sair.
   */
  ajusteNoNumero?: string | null;
  motivo: MotivoDaFila;
  intencao: string;
  /**
   * O que alguém anotou na ficha — contexto para quem vai escrever, **nunca o
   * pretexto**. Aparece em cinza e entre aspas de propósito: é citação, não
   * instrução. Ver a regra do pretexto em `lib/fila.ts`.
   */
  observacao?: string;
  atraso: number;
  /**
   * Este motivo sai pelo número da EMPRESA (Cloud API), decidido em Automação.
   *
   * ⚠ Quando é `true`, o botão do número oficial aparece **ao lado** do link
   * humano, nunca no lugar dele. Substituir tiraria de quem está na tela a
   * escolha de mandar do próprio WhatsApp — que continua sendo gratuita e, na
   * maior parte da operação, a certa. Ver `lib/roteamento.ts`.
   */
  saiPeloSistema?: boolean;
}) {
  const [texto, setTexto] = useState<string | null>(null);
  /**
   * O que o MOTOR escreveu, intocado.
   *
   * ⚠ Existe separado de `texto` para o par "sugerido × enviado" sobreviver
   * à edição. Um segundo depois de a pessoa ajustar, só a versão dela
   * continuaria existindo — e essa comparação é o único sinal rápido de
   * qualidade que o produto tem. Ver `lib/correcoes.ts`.
   */
  const [sugerido, setSugerido] = useState("");
  /**
   * ⚠ A PESSOA JÁ ABRIU O WHATSAPP — e é aqui que o registro se perde.
   *
   * O funcionário relatou não conseguir "salvar a mensagem editada". O
   * mecanismo funciona: o texto ajustado vai no formulário e a correção é
   * guardada. O que não funciona é a SEQUÊNCIA — ele edita, clica no botão
   * VERDE (que abre outra aba e é o único chamativo da tela), manda a mensagem
   * lá e nunca volta para marcar. Do lado de cá não aconteceu nada: nem o
   * toque, nem a lição.
   *
   * O botão de registrar é cinza e mora depois de um campo de anotação. Ele
   * compete com um botão verde do WhatsApp e perde — como perderia para
   * qualquer um. Depois do clique, ele passa a ser o assunto da tela.
   */
  const [abriuWhatsapp, setAbriuWhatsapp] = useState(false);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [limite, setLimite] = useState<string | null>(null);
  const [escalar, setEscalar] = useState(false);
  const [faltam, setFaltam] = useState<string[]>([]);
  const [recusa, setRecusa] = useState<"dna" | "assunto" | null>(null);
  const [enviado, setEnviado] = useState(false);
  const [combinado, setCombinado] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [erroEnvio, setErroEnvio] = useState<string | null>(null);
  const [limiteDaPessoa, setLimiteDaPessoa] = useState(false);

  /**
   * ⚠ SUCESSO AQUI MARCA `enviado` SOZINHO — e é obrigatório que marque.
   *
   * `enviarPeloSistema` já grava a interação no servidor. Se a tela continuasse
   * pedindo "Marquei como enviado", a pessoa clicaria e o toque contaria duas
   * vezes: dois registros para uma mensagem, cadência quitada por engano no
   * lugar errado e placar inflado. Registro em dois caminhos precisa de um
   * dono só.
   *
   * E o erro fica NA LINHA, não num alerta que some. `131049` não é falha de
   * configuração — é o limite de marketing daquela PESSOA, e quem está na tela
   * precisa entender que não adianta tentar de novo hoje.
   */
  const enviarPelaEmpresa = async () => {
    setEnviando(true);
    setErroEnvio(null);
    setLimiteDaPessoa(false);
    try {
      const r = await enviarPeloSistema(contactId, motivo, texto ?? "");
      if (r.ok) setEnviado(true);
      else {
        setErroEnvio(r.motivo);
        setLimiteDaPessoa(!!r.limitePorUsuario);
      }
    } catch (e) {
      setErroEnvio(e instanceof Error ? e.message : String(e));
    } finally {
      setEnviando(false);
    }
  };

  const preparar = async () => {
    setCarregando(true);
    setErro(null);
    setLimite(null);
    try {
      const r = await prepararToque(contactId, motivo, intencao, observacao);
      if (r.ok) {
        setTexto(r.texto);
        setSugerido(r.texto);
        setEscalar(r.escalar);
        setFaltam(r.faltam);
        setRecusa(r.recusa);
      } else if ("limite" in r) setLimite(r.mensagem);
      else setErro(r.error);
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    } finally {
      setCarregando(false);
    }
  };

  // Dois links, e a diferença é o que este arquivo errou por uma entrega
  // inteira: um leva o texto que o motor escreveu, o outro só abre a conversa
  // para quem vai escrever à mão. O segundo existe sempre que há telefone.
  const linkComTexto = texto && !escalar ? linkDeEnvio(numero, texto) : null;
  const linkSimples = linkDeEnvio(numero);

  return (
    <li style={{ padding: "12px 0", borderBottom: "1px solid var(--border)" }}>
      <div className="row wrap" style={{ gap: 10, alignItems: "center" }}>
        <span
          className={atraso > 3 ? "badge badge-danger" : atraso > 0 ? "badge badge-warn" : "badge badge-brand"}
          style={{ minWidth: 58, justifyContent: "center" }}
        >
          {atraso > 0 ? `+${atraso}d` : "hoje"}
        </span>
        <a href={`/painel/contatos/${contactId}`} className="grow" style={{ minWidth: 130, fontSize: 14 }}>
          {nome}
        </a>
        <span className="text-faint" style={{ fontSize: 12 }}>{ROTULO[motivo]}</span>
        {texto === null && !enviado && (
          <button type="button" className="btn btn-sm" onClick={preparar} disabled={carregando}>
            {carregando ? "preparando…" : "✨ Preparar mensagem"}
          </button>
        )}
        {enviado && <span className="badge badge-success">enviado</span>}
      </div>

      <p className="text-faint" style={{ fontSize: 12, margin: "6px 0 0" }}>{intencao}</p>
      {observacao && (
        <p className="text-faint" style={{ fontSize: 12, margin: "4px 0 0", fontStyle: "italic", opacity: 0.75 }}>
          {observacao} — anotação antiga, pode não valer mais. Confira antes de usar.
        </p>
      )}

      {limite && <AvisoDeCota mensagem={limite} />}
      {erro && <p className="badge badge-danger" style={{ marginTop: 8 }}>{erro}</p>}

      {/* ⚠ `texto !== null`, NUNCA `texto &&` — e a diferença é o defeito que a
          Luciana reportou como "o botão de preparar mensagem não funciona".

          Quando a trava anti-invenção dispara, o motor devolve `escalar: true`
          e a mensagem VAZIA — que é o comportamento certo dele. Só que `""` é
          falso em JavaScript, então `{texto && ...}` não renderizava nada: nem
          a mensagem (que não existe), nem o aviso explicando por quê. A pessoa
          clicava, o botão girava, e a tela ficava exatamente igual.

          Do lado de fora isso não parece uma trava funcionando. Parece um
          botão quebrado — e é a terceira vez nesta casa que um comportamento
          CORRETO do motor chega ao usuário como defeito, porque a tela não
          soube mostrar a recusa. */}
      {texto !== null && !enviado && (
        <div className="card" style={{ marginTop: 10, background: "var(--bg-elev)" }}>
          {escalar ? (
            <>
              {/* ⚠ A RECUSA TEM QUE MANDAR PARA O LUGAR CERTO.
                  Esta tela dizia "falta fato no DNA" nos dois casos, e a
                  Luciana foi procurar no DNA um fato que era do ALUNO. Recusa
                  que aponta o lugar errado gasta o tempo de quem está
                  trabalhando e ensina a desconfiar do aviso. */}
              <span className="badge badge-warn">
                {recusa === "dna"
                  ? "Escalar — falta fato no DNA"
                  : "Escrever à mão — o sistema não tem assunto para esta pessoa"}
              </span>
              <p className="text-dim" style={{ fontSize: 13, marginTop: 8, marginBottom: 0 }}>
                {recusa === "dna" ? (
                  <>
                    O motor não escreveu porque a biblioteca exige um fato que{" "}
                    <strong>a empresa</strong> não cadastrou — e ele não inventa. O
                    conserto é preencher no <a href="/painel/dna">DNA</a>.
                  </>
                ) : (
                  <>
                    O DNA está completo. O que falta é <strong>desta pessoa</strong> — algo
                    que ela disse e ninguém registrou. O motor prefere não escrever a
                    inventar um assunto. Abra a conversa e escreva você: é rápido, e o que
                    você anotar embaixo faz o sistema saber o assunto da próxima vez.
                  </>
                )}
              </p>
              {faltam.length > 0 && (
                <ul className="text-dim" style={{ fontSize: 13, margin: "6px 0 0", paddingLeft: 18 }}>
                  {faltam.map((f) => <li key={f}>{f}</li>)}
                </ul>
              )}
            </>
          ) : (
            <>
              {/* ⚠ EDITÁVEL, e isto é o que torna o aprendizado possível.
                  Enquanto o texto era só leitura, a pessoa copiava, colava no
                  WhatsApp e ajustava LÁ — e a correção morria fora do sistema.
                  O fundador fez exatamente isso hoje nas duas mensagens que
                  testou, e as duas adaptações se perderam.
                  Editar aqui não é conveniência: é o que faz o par
                  "sugerido × enviado" existir. */}
              <textarea
                value={texto ?? ""}
                onChange={(e) => setTexto(e.target.value)}
                rows={5}
                style={{ width: "100%", fontSize: 14, lineHeight: 1.5 }}
                aria-label="Mensagem — pode ajustar antes de enviar"
              />
              {texto !== sugerido && (
                <p className="text-faint" style={{ fontSize: 11, margin: "4px 0 0" }}>
                  Você ajustou o texto. O sistema guarda o antes e o depois para
                  aprender o jeito da casa.
                </p>
              )}
              {linkComTexto && ajusteNoNumero && (
                <p className="badge badge-warn" style={{ marginTop: 10, whiteSpace: "normal", textAlign: "left" }}>
                  {ajusteNoNumero}
                </p>
              )}
              <div className="row wrap" style={{ gap: 8, marginTop: 12, alignItems: "center" }}>
                {linkComTexto ? (
                  <a
                    href={linkComTexto}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn btn-sm"
                    style={{ background: "#25D366", color: "#0b2e13", border: "none" }}
                    onClick={() => setAbriuWhatsapp(true)}
                  >
                    Abrir no WhatsApp
                  </a>
                ) : (
                  <span className="text-faint" style={{ fontSize: 12 }}>
                    Sem telefone válido — copie e envie por onde falar com ele.
                  </span>
                )}
                <button type="button" className="btn btn-sm btn-ghost" onClick={preparar} disabled={carregando}>
                  Gerar outra
                </button>
              </div>

              {/* O NÚMERO DA EMPRESA — ao lado do link, nunca no lugar dele. */}
              {saiPeloSistema && (
                <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid var(--border)" }}>
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={enviarPelaEmpresa}
                    disabled={enviando}
                  >
                    {enviando ? "enviando…" : "Enviar pelo número da empresa"}
                  </button>
                  <p className="text-faint" style={{ fontSize: 11, marginTop: 6, marginBottom: 0 }}>
                    Sai do número do sistema e é cobrado pela Meta. O botão verde acima
                    sai do seu WhatsApp e não custa nada.
                  </p>
                  {erroEnvio && (
                    <p
                      className={limiteDaPessoa ? "badge badge-warn" : "badge badge-danger"}
                      style={{ marginTop: 8, whiteSpace: "normal", textAlign: "left" }}
                    >
                      {erroEnvio}
                    </p>
                  )}
                </div>
              )}

              <p className="text-faint" style={{ fontSize: 11, marginTop: 10, marginBottom: 0 }}>
                Leia antes de enviar. O sistema escreve; quem manda é você.
              </p>
            </>
          )}
        </div>
      )}

      {/* ⚠ REGISTRAR NÃO PODE DEPENDER DE A MÁQUINA TER ESCRITO.
          ESTE FORMULÁRIO ERA FILHO DO TEXTO GERADO, e o defeito chegou pela
          Luciana em 17/ago: ela mandava mensagem para gente da fila e as
          pessoas continuavam lá. Catarina Wey e Carolina Souza Lourenço,
          nominalmente.

          A causa é a pior espécie — uma trava CERTA com uma saída faltando.
          As duas caíram no alarme de silêncio, cujo assunto é o `goal`
          genérico da etapa, e o motor fez o que lhe mandam fazer: escalou, em
          vez de escrever mensagem simpática sem assunto. Só que o ramo
          `escalar` da tela mostrava o aviso e MAIS NADA — sem link, sem
          botão. A recepcionista abria o WhatsApp dela, escrevia à mão (ela
          sabe o que dizer, é o trabalho dela) e voltava para uma tela que não
          tinha onde registrar. A pessoa ficava na fila para sempre.

          Do lado de fora isso não parece defeito: parece que a fila não
          funciona. E foi assim que apareceu — por alguém usando, não por
          revisão de código, como todo o resto desta classe.

          O erro de modelagem, escrito para não voltar: **a fila é uma lista de
          CONVERSAS DEVIDAS, não uma lista de mensagens geradas por IA.** A IA
          é um acelerador opcional no meio do caminho. Amarrar o registro a ela
          fez o produto parar de funcionar exatamente onde ele foi mais
          honesto. Por isso o formulário vive fora, e aparece sempre. */}
      {!enviado && (
        <form
          action={marcarEnviado}
          onSubmit={() => setEnviado(true)}
          className="stack"
          style={{ gap: 8, marginTop: 12, paddingTop: 12, borderTop: "1px solid var(--border)" }}
        >
          {/* ⚠ O REGISTRO PRECISA SE ANUNCIAR. O fundador procurou "um botão de
              registrar, como tem na automação" e concluiu que não existia — e
              ele existe: é o botão lá embaixo, chamado "Marquei como enviado",
              depois de um campo opcional e de uma rolagem.
              Função que existe e não se apresenta é função que não existe para
              quem usa. E o custo aqui é o de sempre: sem o registro, o toque
              não conta, a pessoa fica na fila, e o ajuste do texto — que é a
              lição mais valiosa que temos — se perde. */}
          <p className="eyebrow" style={{ margin: 0 }}>Registrar o que aconteceu</p>
          <input type="hidden" name="contact_id" value={contactId} />
          {/* Sem texto gerado, vai vazio — e `marcarEnviado` grava "(toque da
              fila, sem texto registrado)". O toque conta igual; o que não
              existe é a cópia do que foi dito. */}
          <input type="hidden" name="texto" value={escalar ? "" : texto ?? ""} />
          {/* O par que ensina: o que o motor escreveu e a situação em que
              escreveu. Sem a situação, "tirou o horário" é lição errada —
              certa quando o cliente não pediu horário, errada quando pediu. */}
          <input type="hidden" name="sugerido" value={sugerido} />
          <input type="hidden" name="contexto" value={`${ROTULO[motivo]} — ${intencao}`} />

          {/* A saída de quem vai escrever à mão. Só aparece quando não há
              texto para levar — com mensagem pronta, o botão verde acima já
              é o caminho, e dois links verdes lado a lado só criam dúvida. */}
          {!linkComTexto && linkSimples && (
            <div className="row wrap" style={{ gap: 8, alignItems: "center" }}>
              <a
                href={linkSimples}
                target="_blank"
                rel="noopener noreferrer"
                className="btn btn-sm btn-ghost"
              >
                Abrir a conversa no WhatsApp
              </a>
              {ajusteNoNumero && (
                <span className="text-faint" style={{ fontSize: 11 }}>{ajusteNoNumero}</span>
              )}
            </div>
          )}

          {/* ⚠ A PERGUNTA VAI AQUI, no momento em que a resposta é sabida.
              `next_action_note` existia desde sempre e só dava para preencher
              três telas adiante, na edição do contato — e o resultado está
              medido: 257 contatos com data e ZERO com nota. Campo que exige
              desvio é campo que ninguém preenche.

              O prazo é uma lista pronta, não um campo de data: data em pt-BR
              já é armadilha conhecida aqui (`03/08` vira 8 de março no
              JavaScript), e escolher é mais fácil que digitar — o mesmo
              princípio da régua de descoberta do manifesto. */}
          <label className="text-dim" style={{ fontSize: 12 }}>
            Ficou combinado alguma coisa?{" "}
            <span className="text-faint">(opcional, mas é o que faz o sistema saber o assunto da próxima vez)</span>
            <input
              type="text"
              name="combinado"
              value={combinado}
              onChange={(e) => setCombinado(e.target.value)}
              placeholder="ex.: vai passar sábado de manhã para conhecer"
              style={{ marginTop: 4 }}
            />
          </label>
          {combinado.trim() && (
            <label className="text-dim" style={{ fontSize: 12 }}>
              Voltar a falar com ele
              <select name="em_dias" defaultValue="7" style={{ marginTop: 4, width: "auto" }}>
                <option value="2">em 2 dias</option>
                <option value="7">em 1 semana</option>
                <option value="15">em 15 dias</option>
                <option value="30">em 1 mês</option>
              </select>
            </label>
          )}
          {/* O RÓTULO DIZ O QUE DE FATO ACONTECEU. Com texto preparado, ela
              acabou de enviar o que está na tela. Sem texto, ela falou com a
              pessoa por fora — e "Já falei com ele" é o que ela faria mesmo
              sem o sistema existir. Rótulo que promete a mesma coisa nos dois
              casos ensina a desconfiar do registro. */}
          {/* ⚠ DEPOIS DE ABRIR O WHATSAPP, ESTE VIRA O ASSUNTO DA TELA.
              Sem isto a pessoa manda a mensagem na outra aba e fecha — e do
              lado de cá não existiu nem o toque nem a correção. O aviso diz o
              que se perde, não só o que fazer: "marque" é ordem, "senão o
              sistema não aprende" é motivo. */}
          {abriuWhatsapp && (
            <p className="badge badge-warn" style={{ whiteSpace: "normal", textAlign: "left", marginBottom: 0 }}>
              <strong>Enviou? Marque abaixo.</strong> É o que registra o toque
              {texto !== sugerido && sugerido ? " e guarda o seu ajuste para o motor aprender" : ""} —
              sem isso, para o sistema esta conversa não aconteceu.
            </p>
          )}
          <button
            type="submit"
            className={abriuWhatsapp ? "btn btn-sm btn-primary" : linkComTexto ? "btn btn-sm" : "btn btn-sm btn-ghost"}
            style={{ alignSelf: "flex-start" }}
          >
            {linkComTexto
              ? combinado.trim() ? "Enviei e anotei o combinado" : "Marquei como enviado"
              : combinado.trim() ? "Já falei com ele e anotei o combinado" : "Já falei com ele"}
          </button>
        </form>
      )}
    </li>
  );
}
