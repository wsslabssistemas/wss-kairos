"use client";

import { useState } from "react";
import { salvarCanal, testarCanal } from "./canal-actions";
import { dataHoraLocal } from "@/lib/fuso";

/**
 * LIGAR O CANAL OFICIAL — a credencial da empresa e o teste antes do primeiro
 * cliente real.
 *
 * ⚠ O TOKEN NUNCA VOLTA PARA A TELA, nem mascarado. Ele é guardado numa tabela
 * com RLS que nega a todos (`tenant_secrets`, 0056) e lido só no servidor; se
 * a tela o exibisse de volta, o segredo passaria pelo navegador de qualquer
 * administrador — que é exatamente o que a tabela separada existe para evitar.
 * O que a tela mostra é se ESTÁ configurado e os quatro últimos dígitos do ID
 * do número, que bastam para conferir se é a credencial certa.
 */
export function Canal({
  configurado,
  phoneId,
  temVerifyToken,
  temAppSecret,
  atualizadoEm,
  urlDoWebhook,
  contaInstagram,
  temTokenInstagram,
  urlDoWebhookInstagram,
  paginaFacebook,
  temTokenFacebook,
  urlDoWebhookFacebook,
}: {
  configurado: boolean;
  phoneId: string | null;
  temVerifyToken: boolean;
  temAppSecret: boolean;
  atualizadoEm: string | null;
  urlDoWebhook: string;
  contaInstagram: string | null;
  temTokenInstagram: boolean;
  urlDoWebhookInstagram: string;
  paginaFacebook: string | null;
  temTokenFacebook: boolean;
  urlDoWebhookFacebook: string;
}) {
  const [numero, setNumero] = useState("");
  const [testando, setTestando] = useState(false);
  const [resultado, setResultado] = useState<{ ok: boolean; mensagem: string } | null>(null);

  const testar = async () => {
    setTestando(true);
    setResultado(null);
    try {
      setResultado(await testarCanal(numero));
    } catch (e) {
      setResultado({ ok: false, mensagem: e instanceof Error ? e.message : String(e) });
    } finally {
      setTestando(false);
    }
  };

  return (
    <div className="card mt-24">
      <div className="row wrap" style={{ gap: 10, alignItems: "center" }}>
        <p className="eyebrow" style={{ margin: 0 }}>Canal oficial (WhatsApp Cloud API)</p>
        {configurado
          ? <span className="badge badge-success">configurado · número {phoneId}</span>
          : <span className="badge">não configurado — envio segue pelo link</span>}
      </div>

      <p className="text-dim" style={{ fontSize: 13, marginTop: 10 }}>
        A credencial é <strong>desta empresa</strong>: o número é verificado no CNPJ dela e as
        mensagens saem dele. Sem credencial, nada quebra — a fila continua gerando o texto e
        abrindo o WhatsApp para alguém enviar.
      </p>

      <form action={salvarCanal} autoComplete="off" className="stack" style={{ gap: 10, marginTop: 14 }}>
        {/* ⚠ OS RÓTULOS SÃO OS DA META, PALAVRA POR PALAVRA — e a primeira
            versão inventou os próprios ("Token permanente", "ID do número").
            O fundador travou por causa disso: *"tem que usar a mesma
            nomenclatura do Meta, senão complica"*. Ele tem razão. Quem
            configura está com duas telas abertas e copia de uma para a outra;
            nome diferente vira um problema de tradução no meio de uma tarefa
            que já é difícil. */}
        <label className="text-dim" style={{ fontSize: 13 }}>
          Token de acesso
          <span className="text-faint" style={{ display: "block", fontSize: 11 }}>
            Na Meta: WhatsApp → Configuração da API → botão <strong>Gerar token</strong>
          </span>
          <input type="password" name="token" autoComplete="new-password"
            placeholder={configurado ? "já configurado — preencha só para trocar" : "EAAG..."} />
        </label>
        <label className="text-dim" style={{ fontSize: 13 }}>
          Phone Number ID
          <span className="text-faint" style={{ display: "block", fontSize: 11 }}>
            {phoneId
              ? <>Salvo agora: <strong>{phoneId}</strong></>
              : <>Na Meta: WhatsApp → Configuração da API, ao lado do número</>}
          </span>
          {/* ⚠ ESTE CAMPO MOSTRA O VALOR SALVO, e os outros três não — porque
              ele NÃO é segredo: o Phone Number ID aparece na própria tela da
              Meta, aberto. Mantê-lo escondido só criava dúvida sobre se tinha
              salvo, e foi o que aconteceu.
              `inputMode` numérico e `new-password` no `autoComplete` existem
              porque o gerenciador de senhas do navegador via um campo de texto
              ao lado de um campo de senha e enfiava o E-MAIL do usuário aqui.
              O valor gravado estava certo; a tela é que mentia. */}
          {/* ⚠ SEM `defaultValue`, E A RAZÃO É UM ACIDENTE REAL (16/ago/2026).
              O campo vinha preenchido com o valor salvo, para a pessoa
              conferir. Mas uma aba aberta ANTES de o número mudar guarda o
              valor VELHO — e ao salvar qualquer outro campo, ela regrava o
              velho por cima do novo, em silêncio. Foi o que aconteceu: o
              fundador trocou o número, salvou o token numa aba antiga, e o
              sistema voltou a apontar para o número de teste.
              O valor salvo agora é TEXTO (não dá para reenviar sem querer) e o
              campo só serve para trocar. Formulário que reenvia o que já
              existe transforma "salvar uma coisa" em "regravar tudo". */}
          <input type="text" name="phone_id" autoComplete="new-password"
            inputMode="numeric"
            placeholder={phoneId ? "preencha só para TROCAR de número" : "1202699839603007"} />
        </label>
        <label className="text-dim" style={{ fontSize: 13 }}>
          Verificar token {temVerifyToken && <span className="badge badge-success">definido</span>}
          <span className="text-faint" style={{ display: "block", fontSize: 11 }}>
            Este VOCÊ inventa. É o mesmo texto que vai no campo <strong>Verificar token</strong> da Meta,
            em WhatsApp → Configuração → Webhook
          </span>
          <input type="text" name="verify_token" autoComplete="new-password"
            placeholder="ex.: befitness-kairos-2026" />
        </label>
        {/* ⚠ SEM ELE O WEBHOOK RECUSA TUDO — e recusar e o comportamento certo,
            porque liberar sem conferir a assinatura abriria o unico endereco
            publico do produto para qualquer um escrever no historico de um
            cliente. Enquanto isso era variavel de ambiente, a Meta dizia
            "nao foi possivel entregar a mensagem, confira seus webhooks". */}
        <label className="text-dim" style={{ fontSize: 13 }}>
          Chave Secreta do Aplicativo {temAppSecret && <span className="badge badge-success">definida</span>}
          <span className="text-faint" style={{ display: "block", fontSize: 11 }}>
            <strong>Não é o token.</strong> Fica noutro lugar: no menu da esquerda, lá embaixo,
            <strong> Configurações do app → Básico</strong>. O campo vem escondido — clique em{" "}
            <strong>Mostrar</strong> e confirme sua senha do Facebook.
          </span>
          <input type="password" name="app_secret" autoComplete="new-password"
            placeholder={temAppSecret ? "já configurada — preencha só para trocar" : "32 caracteres, letras e números"} />
        </label>
        <p className="text-faint" style={{ fontSize: 12, margin: 0 }}>
          Campo em branco <strong>não apaga</strong> o que já está salvo. Sem a chave
          secreta o sistema <strong>recusa tudo que a Meta manda</strong> — inclusive as
          respostas dos clientes.
        </p>
        {/* ⚠ O INSTAGRAM MORA NO MESMO FORMULÁRIO, e não numa tela nova. É o
            mesmo cofre (`tenant_secrets`) e a mesma decisão: por onde a
            empresa fala. Separar em duas telas faria alguém configurar metade
            e achar que terminou. */}
        <hr className="divider" />
        <p className="eyebrow" style={{ marginBottom: 4 }}>Instagram (opcional)</p>
        <p className="text-faint" style={{ fontSize: 12, margin: "0 0 10px" }}>
          Recebe os directs no mesmo lugar das conversas.{" "}
          <strong>No Instagram só dá para responder</strong> — não existe modelo
          aprovado nem campanha, e a janela é de 24h depois que a pessoa escreve.
        </p>
        <label className="text-dim" style={{ fontSize: 13 }}>
          ID da conta do Instagram {contaInstagram && <span className="badge badge-success">definido</span>}
          <span className="text-faint" style={{ display: "block", fontSize: 11 }}>
            É o número da CONTA (começa com 1784…), não o do app. No painel da Meta:
            caso de uso do Instagram → <strong>Gerar tokens de acesso</strong>.
          </span>
          <input type="text" name="instagram_account_id" autoComplete="new-password" inputMode="numeric"
            placeholder={contaInstagram ? `salvo: ${contaInstagram} — preencha só para trocar` : "17841401344986585"} />
        </label>
        <label className="text-dim" style={{ fontSize: 13 }}>
          Token do Instagram {temTokenInstagram && <span className="badge badge-success">definido</span>}
          <span className="text-faint" style={{ display: "block", fontSize: 11 }}>
            No mesmo lugar do ID, botão de gerar token. Começa com <code>IGAA…</code>.
            {" "}<strong>Ele vence</strong> — o sistema avisa quantos dias faltam, você não precisa anotar.
          </span>
          <input type="password" name="instagram_token" autoComplete="new-password"
            placeholder={temTokenInstagram ? "já configurado — preencha só para trocar" : "IGAA…"} />
        </label>

        <hr className="divider" />
        <p className="eyebrow" style={{ marginBottom: 4 }}>Facebook (opcional)</p>
        <p className="text-faint" style={{ fontSize: 12, margin: "0 0 10px" }}>
          As mensagens da página do Facebook, no mesmo lugar. Como no Instagram,
          <strong> aqui só dá para responder</strong> — janela de 24h, sem campanha.
        </p>
        <label className="text-dim" style={{ fontSize: 13 }}>
          ID da página {paginaFacebook && <span className="badge badge-success">definido</span>}
          <input type="text" name="facebook_page_id" autoComplete="new-password" inputMode="numeric"
            placeholder={paginaFacebook ? `salvo: ${paginaFacebook} — preencha só para trocar` : "o número da página, no painel da Meta"} />
        </label>
        <label className="text-dim" style={{ fontSize: 13 }}>
          Token da página {temTokenFacebook && <span className="badge badge-success">definido</span>}
          <span className="text-faint" style={{ display: "block", fontSize: 11 }}>
            É o <strong>token da PÁGINA</strong>, não o seu de usuário.
          </span>
          <input type="password" name="facebook_token" autoComplete="new-password"
            placeholder={temTokenFacebook ? "já configurado — preencha só para trocar" : "EAA…"} />
        </label>

        <button type="submit" className="btn btn-sm" style={{ alignSelf: "flex-start" }}>
          Salvar credencial
        </button>
      </form>

      <div className="card mt-16" style={{ background: "var(--bg-elev)" }}>
        <p className="eyebrow" style={{ marginBottom: 6 }}>Na Meta, aponte o webhook para</p>
        <code style={{ fontSize: 12, wordBreak: "break-all" }}>{urlDoWebhook}</code>
        <p className="text-faint" style={{ fontSize: 12, margin: "10px 0 4px" }}>
          E o do Instagram, que é <strong>outro endereço</strong>:
        </p>
        <code style={{ fontSize: 12, wordBreak: "break-all" }}>{urlDoWebhookInstagram}</code>
        <p className="text-faint" style={{ fontSize: 12, margin: "10px 0 4px" }}>
          E o da página do Facebook, que é um <strong>terceiro endereço</strong>:
        </p>
        <code style={{ fontSize: 12, wordBreak: "break-all" }}>{urlDoWebhookFacebook}</code>
      </div>

      {/* ⚠ O TESTE VEM ANTES DE QUALQUER CLIENTE REAL. O provedor foi escrito
          contra a documentação e nunca rodou contra a API — a primeira
          mensagem tem que ser para um número seu. */}
      <div className="mt-16">
        <p className="eyebrow" style={{ marginBottom: 6 }}>Testar antes de usar com cliente</p>
        <div className="row wrap" style={{ gap: 8, alignItems: "center" }}>
          <input
            type="text"
            value={numero}
            onChange={(e) => setNumero(e.target.value)}
            placeholder="seu número, com DDD"
            style={{ width: 200 }}
          />
          <button type="button" className="btn btn-sm" onClick={testar} disabled={testando || !numero.trim()}>
            {testando ? "enviando…" : "Mandar teste para mim"}
          </button>
        </div>
        <p className="text-faint" style={{ fontSize: 12, marginTop: 8, marginBottom: 0 }}>
          Vai o modelo <code>hello_world</code>, que toda conta nova da Meta já traz aprovado.
          Texto livre só funciona com quem escreveu para a empresa nas últimas 24 horas — então
          um teste com texto falharia mesmo com a credencial certa, e o erro seria lido como
          credencial errada.
        </p>
        {resultado && (
          <p className={`badge ${resultado.ok ? "badge-success" : "badge-danger"}`}
             style={{ whiteSpace: "normal", textAlign: "left", marginTop: 10 }}>
            {resultado.mensagem}
          </p>
        )}
      </div>

      {atualizadoEm && (
        <p className="text-faint" style={{ fontSize: 11, marginTop: 14, marginBottom: 0 }}>
          Credencial atualizada em {dataHoraLocal(atualizadoEm)}.
        </p>
      )}
    </div>
  );
}
