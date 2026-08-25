import Link from "next/link";

/**
 * O PASSO A PASSO DA META — dentro do produto, não num chat.
 *
 * ⚠ POR QUE ISTO É TELA E NÃO MENSAGEM. O fundador pediu o roteiro para ligar
 * o canal da Be Fitness. A mesma sequência vale para o segundo cliente, o
 * terceiro, e para o dia em que ele não lembrar por que o número da recepção
 * não serve. Roteiro que mora numa conversa some com a conversa.
 *
 * Os endereços apontam para a RAIZ de cada ferramenta (o painel de apps, as
 * configurações do negócio) e o caminho de dentro está escrito em texto. É de
 * propósito: a Meta reorganiza as telas com frequência, e link fundo que quebra
 * é pior que instrução que exige um clique a mais — link quebrado faz a pessoa
 * achar que o passo não existe mais.
 */
export function Guia() {
  const passos: { titulo: string; corpo: React.ReactNode }[] = [
    {
      titulo: "1. Separe um número novo — não use o da recepção",
      corpo: (
        <>
          Um número registrado na plataforma <strong>sai do aplicativo do WhatsApp</strong>. Ele
          continua recebendo ligação e SMS, mas some do WhatsApp Messenger — e um número que
          já está no WhatsApp só entra se for apagado de lá antes. Se você registrar o número
          da recepção, a equipe perde o aplicativo que usa hoje.
          <br />
          <span className="text-faint">
            Um chip novo resolve. Guarde o aparelho: a Meta manda um código de verificação por
            SMS ou ligação.
          </span>
        </>
      ),
    },
    {
      titulo: "2. Crie o app",
      corpo: (
        <>
          Vá em <a href="https://developers.facebook.com/apps" target="_blank" rel="noopener noreferrer">developers.facebook.com/apps</a>{" "}
          e clique em <strong>Criar app</strong>. No caso de uso, escolha{" "}
          <strong>&ldquo;Conectar-se a clientes pelo WhatsApp&rdquo;</strong>. Dê um nome
          (o cliente nunca vê) e vincule ao portfólio de negócios da empresa.
        </>
      ),
    },
    {
      titulo: "3. Pegue o ID do número e o token de teste",
      corpo: (
        <>
          No app, menu da esquerda: <strong>WhatsApp → Configuração da API</strong>.
          Nessa página aparecem, um embaixo do outro:
          <ul style={{ margin: "8px 0 0", paddingLeft: 18 }}>
            <li><strong>Token de acesso temporário</strong> — vale 24 horas, serve para testar hoje.</li>
            <li><strong>Identificação do número de telefone</strong> — é o &ldquo;ID do número&rdquo; que você cola aqui embaixo.</li>
          </ul>
          <span className="text-faint">
            A Meta já cria um <strong>número de teste</strong> nessa tela. Use ele primeiro: dá
            para provar a ligação inteira sem tocar em nenhum número real da empresa.
          </span>
        </>
      ),
    },
    {
      titulo: "4. Ligue o webhook",
      corpo: (
        <>
          Ainda no app, <strong>WhatsApp → Configuração</strong> (Configuration), campo{" "}
          <strong>Webhook</strong>. Cole o endereço que aparece na caixa abaixo desta lista e,
          no campo <strong>Token de verificação</strong>, o mesmo texto que você salvou aqui no
          Kairós — <em>você inventa esse texto</em>, ele não vem da Meta.
          <br />
          Depois clique em <strong>Gerenciar</strong> e assine o campo <strong>messages</strong>.
          Sem essa assinatura o sistema nunca recebe o que o cliente escreve.
        </>
      ),
    },
    {
      titulo: "5. Cadastre quem PODE receber (senão o teste falha)",
      corpo: (
        <>
          Enquanto o app não estiver publicado, o número de teste da Meta só fala com números
          que você cadastrar antes — <strong>até 5</strong>. Em{" "}
          <strong>WhatsApp → Configuração da API</strong>, no campo <strong>Para</strong>,
          clique em <strong>Gerenciar lista de números de telefone</strong> e adicione o seu.
          Chega um código por WhatsApp para confirmar.
          <br />
          <span className="text-faint">
            Sem isso o envio é recusado <em>mesmo com o token certo</em> — e o erro fala de
            &ldquo;recipient&rdquo;, não de credencial, o que manda você procurar defeito no
            lugar errado.
          </span>
        </>
      ),
    },
    {
      titulo: "6. Não mexa em “Permissões e recursos” agora",
      corpo: (
        <>
          Se a página de permissões mostrar{" "}
          <code>whatsapp_business_messaging</code> e <code>whatsapp_business_management</code>{" "}
          como <strong>&ldquo;Pronto para teste&rdquo;</strong>, é o suficiente: esse é o acesso de
          desenvolvimento, e ele já envia e recebe.
          <br />
          <span className="text-faint">
            O botão &ldquo;Adicionar à análise do app&rdquo; serve para o acesso avançado, que
            só faz falta ao publicar o app para clientes reais — e para o dia em que a WSS Labs
            virar provedora e conectar empresas sozinha. Pedir análise agora só adiciona espera.
          </span>
        </>
      ),
    },
    {
      titulo: "7. Pegue a Chave Secreta do Aplicativo",
      corpo: (
        <>
          <strong>Não é o token</strong>, e não fica junto dele — é o que valida que o pacote
          veio mesmo da Meta. Sem ela o sistema <strong>recusa tudo</strong> que a Meta manda,
          e a Meta mostra &ldquo;não foi possível entregar a mensagem, confira seus
          webhooks&rdquo;.
          <br />
          No menu da esquerda, bem embaixo (ícone de engrenagem):{" "}
          <strong>Configurações do app → Básico</strong>. O campo{" "}
          <strong>Chave Secreta do Aplicativo</strong> vem escondido — clique em{" "}
          <strong>Mostrar</strong>, confirme a senha do Facebook, e copie.
        </>
      ),
    },
    {
      titulo: "8. Só depois, troque pelo token permanente",
      corpo: (
        <>
          O token do passo 3 morre em 24 horas. O definitivo sai em{" "}
          <a href="https://business.facebook.com/settings" target="_blank" rel="noopener noreferrer">business.facebook.com/settings</a>{" "}
          → <strong>Usuários do sistema</strong> → <strong>Adicionar</strong>. Dê controle total
          sobre o app e sobre a conta do WhatsApp, clique em <strong>Gerar token</strong> e marque
          as três permissões: <code>whatsapp_business_messaging</code>,{" "}
          <code>whatsapp_business_management</code> e <code>business_management</code>.
          <br />
          <span className="text-faint">
            Ele aparece UMA vez. Copie e cole aqui na hora — se perder, é só gerar outro.
          </span>
        </>
      ),
    },
    {
      titulo: "9. Verifique o negócio (CNPJ)",
      corpo: (
        <>
          Em <a href="https://business.facebook.com/settings" target="_blank" rel="noopener noreferrer">business.facebook.com/settings</a>{" "}
          → <strong>Central de Segurança</strong> → <strong>Iniciar verificação</strong>.
          Vai o CNPJ da empresa, com um comprovante em que o nome e o endereço batam
          exatamente com o cadastro.
          <br />
          <span className="text-faint">
            Dá para testar antes da verificação sair. Ela é o que destrava volume e o limite de
            números.
          </span>
        </>
      ),
    },
    {
      titulo: "10. Troque o nome que aparece para quem recebe",
      corpo: (
        <>
          Em <a href="https://business.facebook.com/wa/manage/" target="_blank" rel="noopener noreferrer">business.facebook.com/wa/manage</a>{" "}
          → <strong>Números de telefone</strong> → o seu número →{" "}
          <strong>Configurações</strong> → <strong>Perfil</strong> →{" "}
          <strong>Nome de exibição</strong> → <strong>Editar</strong>. Escreva o nome da
          empresa exatamente como ela se chama e envie. A Meta revisa — costuma sair em
          minutos, pode levar até dois dias — e o número continua enviando e recebendo
          normalmente durante a revisão.
          <br />
          <span className="text-faint">
            ⚠ <strong>É a única coisa que a pessoa lê antes de decidir se abre ou bloqueia.</strong>{" "}
            Quem não tem o número salvo vê só esse nome. Um nome com número no fim
            (&ldquo;Academia2&rdquo;) parece golpe numa mensagem que já começa fria — e uma
            campanha de retorno é exatamente isso. Ajuste ANTES de disparar o primeiro lote.
            O nome precisa ter a ver com o negócio verificado, senão a revisão recusa.
          </span>
          <br />
          <span className="text-faint">
            ⚠ <strong>SE O NOME FOR RECUSADO, o erro não explica.</strong> A Be Fitness levou{" "}
            <em>Rejeitado</em> e, ao tentar de novo, a Meta respondeu{" "}
            <em>&ldquo;Operação não autorizada&rdquo;</em> (erro 1675034) — que parece falta de
            permissão e não é: é a fila de revisão de nome travada depois de uma recusa. As
            duas causas de recusa, em ordem: <strong>número solto no fim do nome</strong>{" "}
            (padrão de conta duplicada, recusa automática) e <strong>nome diferente do
            negócio verificado</strong> — a Meta compara com o CNPJ. Peça exatamente a razão
            social ou o nome fantasia que apareça no site e no Instagram. Se continuar
            recusando, é caso de suporte: <em>business.facebook.com/business/help</em>, com o
            código do erro e o identificador entre parênteses, que é como eles acham o caso.
          </span>
          <br />
          <span className="text-faint">
            ⚠ <strong>E na MESMA tela, preencha o perfil inteiro com a cara da EMPRESA:</strong>{" "}
            foto (a logo dela, não a do sistema), descrição, endereço, e-mail e site. É o que a
            pessoa vê ao tocar no nome para decidir se aquilo é confiável — e o perfil vazio,
            com foto cinza, é o retrato de número descartável. Nada aqui é do fornecedor de
            software: quem manda a mensagem é a empresa.
          </span>
        </>
      ),
    },
    {
      titulo: "11. Publique o app",
      corpo: (
        <>
          Em <a href="https://developers.facebook.com/apps" target="_blank" rel="noopener noreferrer">developers.facebook.com/apps</a>{" "}
          → seu app → <strong>Publicar</strong>, no menu da esquerda (ele mostra{" "}
          <strong>&ldquo;Não publicado&rdquo;</strong> enquanto falta algo). Essa tela lista o
          que ainda impede e libera o botão quando os requisitos estiverem atendidos — é ela
          que manda, não o painel inicial, que mistura requisito obrigatório com sugestão.
          <br />
          O que costuma faltar está em{" "}
          <strong>Configurações do app → Básico</strong>: <strong>URL da Política de
          Privacidade</strong>, <strong>Instruções de exclusão de dados</strong>,{" "}
          <strong>ícone</strong> (1024×1024, sem transparência) e <strong>categoria</strong>.
          <br />
          ⚠ <strong>Os dois campos de URL não aceitam âncora</strong> (endereço com{" "}
          <code>#</code>) — cada um precisa de uma página inteira. As deste sistema são{" "}
          <code>/privacidade</code> e <code>/exclusao-de-dados</code>.
          <br />
          <span className="text-faint">
            O ícone e a política aqui são do SISTEMA, não da empresa cliente — quem os vê é o
            revisor da Meta e mais ninguém. O que o cliente final vê é o perfil do passo 10.
          </span>
          <br />
          <span className="text-faint">
            ⚠ <strong>A seção &ldquo;Login do Facebook para Empresas&rdquo; não precisa de
            nada.</strong> Ela é o fluxo em que OUTRA empresa autoriza o seu app a usar o
            WhatsApp dela — este sistema entra por e-mail e senha, e cada empresa traz a conta
            dela. Deixe <strong>URIs de redirecionamento vazios</strong> e não desligue{" "}
            <em>Forçar HTTPS</em> nem o <em>modo estrito</em>: são eles que tornam inofensivas
            as chaves que já vêm em &ldquo;Sim&rdquo;. O único campo dali que vale é a{" "}
            <strong>URL de solicitação de exclusão de dados</strong> — e a tela não salva
            sozinha, tem botão no rodapé.
          </span>
          <br />
          <span className="text-faint">
            ⚠ <strong>Enquanto o app não está publicado, a Meta pode entregar mensagem só
            para quem tem papel no app</strong> (administrador, desenvolvedor, testador). O
            teste com o seu próprio número passa — e a campanha para os clientes falha. Antes
            de disparar um lote, mande UMA mensagem para um número que não tenha papel nenhum
            e confira em <strong>Canal oficial</strong> se ela aparece como entregue ou como
            falha: isso decide a questão em cinco minutos, sem depender de documentação.
          </span>
        </>
      ),
    },
  ];

  return (
    <div className="card mt-24">
      <p className="eyebrow" style={{ marginBottom: 6 }}>Como conseguir a credencial na Meta</p>
      <p className="text-dim" style={{ fontSize: 13, marginTop: 0 }}>
        Onze passos, na ordem. O 1 é o único que não dá para desfazer depois — leia antes de
        escolher o número. Os passos 10 e 11 não são de instalação: são o que separa
        &ldquo;funciona no meu teste&rdquo; de &ldquo;pode sair no nome da empresa&rdquo;.
      </p>

      <ol style={{ listStyle: "none", padding: 0, margin: "16px 0 0" }}>
        {passos.map((p, i) => (
          <li key={i} style={{ padding: "12px 0", borderTop: i ? "1px solid var(--border)" : "none" }}>
            <p style={{ margin: "0 0 6px", fontSize: 14, fontWeight: 600 }}>{p.titulo}</p>
            <div className="text-dim" style={{ fontSize: 13 }}>{p.corpo}</div>
          </li>
        ))}
      </ol>

      {/* ⚠ O LIMITE QUE DECIDE O RITMO, e ele conversa com a ração do dia. */}
      <div className="card mt-16" style={{ background: "var(--bg-elev)" }}>
        <p className="eyebrow" style={{ marginBottom: 6 }}>O que esperar do começo</p>
        <p className="text-dim" style={{ fontSize: 13, margin: 0 }}>
          Número novo começa em <strong>250 mensagens entregues</strong>. Sobe para 1.000 e
          depois 2.000 conforme a empresa entrega mensagem com qualidade boa ao longo de 30
          dias. Com a ração em 10 por vendedor, três pessoas dão ~900 por mês — cabe no
          primeiro degrau. <strong>Uma lista de mil ex-alunos não cabe</strong>, e é por isso
          que a reativação é o último motivo da fila.
        </p>
        <p className="text-dim" style={{ fontSize: 13, marginTop: 8, marginBottom: 0 }}>
          E fora da janela de 24 horas só sai <strong>modelo aprovado</strong> pela Meta.
          Responder quem escreveu é texto livre; começar conversa exige cadastrar o texto e
          esperar aprovação — trabalho de cadastro, não de código.{" "}
          <Link href="/painel/fila">A fila continua funcionando pelo link</Link> enquanto isso.
        </p>
      </div>
    </div>
  );
}
