// O ALERTA ATIVO — a decisão de tocar, sem banco e sem rede.
//
// Arquivo puro e SEM IMPORTS, como `lib/optout.ts` e `lib/fase2.ts`: dá para
// testar em Node sem bundler. E aqui isso não é preferência — **alarme só se
// prova com relógio de mentira.** O defeito típico é o que nunca toca, e ele
// se parece exatamente com "está tudo bem".
//
// ⚠ POR QUE ISTO EXISTE, quando já havia registro de tudo.
//
// `motor_execucoes`, o vigia do canal, a validade do token, o alarme de
// silêncio da fila: tudo isso desenha na tela e espera alguém abrir. E a peça
// inteira roda quando ninguém está olhando — o motor bate de 15 em 15 minutos,
// a fase 2 responde às 2h da manhã, e o token vence num domingo.
//
// ⚠ E TEM UMA CEGUEIRA QUE NÃO DÁ PARA CONSERTAR AQUI: quem chama isto é o
// próprio agendador. Se ele morrer, o alerta de "agendador mudo" morre junto —
// é o vigia sendo vigiado por si mesmo. O que salva não é código, é
// infraestrutura: o **agendador reserva** (`pg_cron` no Supabase, instalado em
// 30/ago) bate na mesma rota, deslocado do GitHub. Então este alerta só fica
// cego quando os DOIS relógios caem no mesmo dia — que é o risco que a gente
// aceitou de olho aberto quando o reserva entrou.

export type Gravidade = "aviso" | "urgente";

export type Alerta = {
  /** Espécie do alerta. É o que a janela de silêncio agrupa. */
  tipo: string;
  /**
   * QUAL ocorrência, dentro do tipo.
   *
   * ⚠ É o que separa "o token vence em 7 dias" de "vence em 3 dias". Mesmo
   * tipo, avisos diferentes — e o segundo PRECISA furar o silêncio do
   * primeiro, porque a piora é a única novidade que importa num alarme.
   */
  chave: string;
  gravidade: Gravidade;
  titulo: string;
  /** O texto que a pessoa lê. Diz o fato e o que fazer, nesta ordem. */
  corpo: string;
};

/** Quanto tempo cada tipo fica calado depois de tocar, em horas. */
const SILENCIO_H: Record<string, number> = {
  // O agendador mudo é grave e some sozinho: se voltar, o alerta some junto.
  // Seis horas evita a metralhadora sem esconder um dia inteiro parado.
  agendador_mudo: 6,
  // ⚠ ESTE É CURTO DE PROPÓSITO: tem gente esperando resposta. Mas a `chave` é
  // o id da decisão, então cada conversa avisa uma vez — a janela só cobre o
  // caso de o mesmo id continuar pendente.
  decisao_pendente: 12,
  qualidade_do_numero: 12,
  token_vencendo: 24,
  // Mudança de estado de modelo não se repete: a chave já carrega o estado, e
  // a janela larga só evita repetir a mesma notícia se algo reprocessar.
  modelo_status: 72,
  // Liberação de permissão acontece uma vez. A janela larga é só rede de
  // segurança contra reprocessamento.
  permissao_liberada: 168,
};

const SILENCIO_PADRAO_H = 12;

/** Quantas horas este tipo fica calado depois de tocar. */
export function silencioDe(tipo: string): number {
  return SILENCIO_H[tipo] ?? SILENCIO_PADRAO_H;
}

export type EstadoParaAlerta = {
  /** Minutos desde a última batida do agendador. `null` = nunca bateu. */
  minutosSemBatida: number | null;
  /** Decisões da fase 2 esperando alguém, já filtradas por idade. */
  decisoesPendentes: { id: string; nome: string; porque: string }[];
  /** A nota da Meta sobre o número, como o vigia leu. */
  qualidade: string | null;
  /** Dias até o token do WhatsApp expirar. `null` = não expira ou não se sabe. */
  diasDoToken: number | null;
  /**
   * O estado de cada modelo na Meta, quando a última leitura aconteceu.
   *
   * ⚠ A NOTÍCIA QUE O DONO ESPERA. Ele submete um modelo e fica olhando o
   * painel da Meta — e a aprovação chega sem aviso nenhum, às vezes de
   * madrugada. Pior: a RECUSA também chega sem aviso, e recusa é invisível por
   * natureza (o modelo simplesmente nunca aparece, e nunca aparecer se parece
   * com ainda estar em análise).
   *
   * Vazio quando a batida não leu — a leitura acontece uma vez por hora.
   */
  modelos?: { nome: string; status: string }[];
  /**
   * As permissões da Meta que PASSARAM a funcionar — medidas pelo efeito.
   *
   * ⚠ Só entram aqui as que hoje faltam e que, quando chegarem, destravam
   * alguma coisa. E o alerta é de LIBERAÇÃO, nunca de falta: avisar todo dia
   * que uma permissão continua faltando é a metralhadora que desliga o alarme.
   */
  permissoesLiberadas?: { permissao: string; destrava: string }[];
};

/**
 * Os alertas que o estado de AGORA justifica — antes de considerar o que já
 * foi avisado.
 *
 * ⚠ CADA UM DIZ O FATO E A AÇÃO, nesta ordem, e nenhum deles CHUTA a causa.
 * A lição é de 28/ago: dois contatos barrados pelo mesmo sintoma tinham causas
 * opostas, e o aviso escolhia uma — *"corrija o cadastro"* era certo para uma
 * pessoa e absurdo para a outra. **Aviso que erra o diagnóstico é aviso que
 * ninguém lê na próxima vez.**
 */
export function alertasDoEstado(e: EstadoParaAlerta): Alerta[] {
  const out: Alerta[] = [];

  if (e.minutosSemBatida !== null && e.minutosSemBatida >= 60) {
    const h = Math.floor(e.minutosSemBatida / 60);
    out.push({
      tipo: "agendador_mudo",
      chave: `${h}h`,
      gravidade: "urgente",
      titulo: "O agendador está mudo",
      corpo:
        `A última batida do motor foi há ${e.minutosSemBatida} minutos, e ele deveria bater ` +
        `de 15 em 15. Enquanto isso a campanha não sai e a fila não anda.\n\n` +
        `Pode ser o cron do GitHub atrasando (ele descarta execução sob carga, sem avisar), ` +
        `o agendador reserva do Supabase parado, ou o deploy fora do ar. ` +
        `Em Automação → Últimas rodadas do motor dá para ver a última batida; ` +
        `o botão "Enviar agora" resolve o dia enquanto o relógio não volta.`,
    });
  }

  for (const d of e.decisoesPendentes) {
    out.push({
      tipo: "decisao_pendente",
      // O id da decisão: cada conversa avisa uma vez, e a próxima não fica
      // presa atrás da janela de silêncio da anterior.
      chave: d.id,
      gravidade: "urgente",
      titulo: `${d.nome} está esperando resposta`,
      corpo:
        `A IA gerou e NÃO enviou: ${d.porque}\n\n` +
        `Quase sempre é a trava anti-invenção agindo — falta um fato para responder sem ` +
        `inventar, e recusar é o produto funcionando. Só que do outro lado tem uma pessoa ` +
        `esperando, e essa resposta não vai sair sozinha.\n\n` +
        `A conversa está em Conversas, e o painel de decisões pendentes fica no topo da Automação.`,
    });
  }

  if (e.qualidade === "media" || e.qualidade === "baixa") {
    out.push({
      tipo: "qualidade_do_numero",
      // O nível é a chave: cair de média para baixa fura o silêncio da média.
      chave: e.qualidade,
      gravidade: e.qualidade === "baixa" ? "urgente" : "aviso",
      titulo: `A Meta baixou a nota do número para ${e.qualidade === "baixa" ? "BAIXA" : "MÉDIA"}`,
      corpo:
        e.qualidade === "baixa"
          ? `Nota baixa é o degrau antes da restrição. O motor já freou sozinho, mas o que ` +
            `recupera nota é PARAR de mandar por alguns dias — e responder bem quem escrever.\n\n` +
            `O que derruba nota é bloqueio e denúncia de quem recebe. Vale conferir o que saiu ` +
            `nas últimas rodadas antes de religar.`
          : `Nota média é aviso, não emergência: o motor já reduziu o volume sozinho. ` +
            `Não amplie a campanha enquanto ela não voltar para alta.`,
    });
  }

  if (e.diasDoToken !== null && e.diasDoToken <= 7) {
    out.push({
      tipo: "token_vencendo",
      // ⚠ A CHAVE É O NÚMERO DE DIAS. Sem ela, o aviso de "7 dias" calaria o
      // de "1 dia" pela janela de silêncio — e o último é o único que ainda
      // dá para agir a tempo.
      chave: String(e.diasDoToken),
      gravidade: e.diasDoToken <= 3 ? "urgente" : "aviso",
      titulo:
        e.diasDoToken <= 0
          ? "O token do WhatsApp VENCEU"
          : `O token do WhatsApp vence em ${e.diasDoToken} dia(s)`,
      corpo:
        `Quando ele vence, o canal para inteiro: a campanha não sai e as respostas não saem. ` +
        `E a Meta não avisa — o sintoma é tudo parecer normal com nada chegando.\n\n` +
        `O caminho é gerar um token novo no painel da Meta e salvar em Automação → Canal oficial.`,
    });
  }

  // ⚠ MODELO APROVADO E MODELO RECUSADO — as duas notícias, e a segunda é a
  // que ninguém descobre sozinho.
  //
  // A `chave` é `nome:status`, e é ela que faz isto tocar UMA vez por
  // mudança: enquanto o estado não mudar, a chave é a mesma e a janela de
  // silêncio cala. No dia em que ele virar, a chave é outra e o alerta sai.
  for (const m of e.modelos ?? []) {
    if (m.status === "APPROVED") {
      out.push({
        tipo: "modelo_status",
        chave: `${m.nome}:APPROVED`,
        gravidade: "aviso",
        titulo: `O modelo "${m.nome}" foi aprovado`,
        corpo:
          `A Meta aprovou o modelo "${m.nome}". Ele já pode ser usado nas mensagens que saem ` +
          `fora da janela de 24h.

` +
          `Falta ligar o nome dele no toque certo, em Automação → Por onde cada motivo sai.`,
      });
    }
    if (m.status === "REJECTED" || m.status === "PAUSED" || m.status === "DISABLED") {
      out.push({
        tipo: "modelo_status",
        chave: `${m.nome}:${m.status}`,
        gravidade: "urgente",
        titulo: `O modelo "${m.nome}" foi ${m.status === "REJECTED" ? "RECUSADO" : "suspenso"} pela Meta`,
        corpo:
          `A Meta marcou o modelo "${m.nome}" como ${m.status}. Ele não sai mais — e quem depende ` +
          `dele para de falar, sem erro em lugar nenhum.

` +
          `O motivo aparece no WhatsApp Manager → Modelos de mensagem, na linha dele. Recusa ` +
          `costuma ser categoria errada (marketing × utilidade) ou texto que promete algo.`,
      });
    }
  }

  // ⚠ PERMISSÃO LIBERADA — a notícia que o dono espera olhando o painel da
  // Meta, e que chega sem aviso nenhum, às vezes de madrugada.
  //
  // A chave é `<permissao>:liberada`, e ela toca UMA vez na vida: uma vez
  // concedida, a permissão não volta a ser novidade.
  for (const p of e.permissoesLiberadas ?? []) {
    out.push({
      tipo: "permissao_liberada",
      chave: `${p.permissao}:liberada`,
      gravidade: "aviso",
      titulo: `A Meta liberou "${p.permissao}"`,
      corpo: `Agora dá para ${p.destrava}`,
    });
  }

  return out;
}

/**
 * Tira os que já foram avisados dentro da janela de silêncio do tipo.
 *
 * ⚠ SEM ISTO O ALARME SE DESLIGA SOZINHO — não no código, na cabeça de quem
 * recebe. Um token vencendo em 7 dias renderia um e-mail a cada 15 minutos por
 * uma semana; na terceira hora a pessoa cria uma regra de caixa de entrada, e
 * a partir daí nenhum alerta desta casa chega em ninguém, para sempre.
 */
export function filtrarJaAvisados(
  alertas: Alerta[],
  jaEnviados: { tipo: string; chave: string; enviado_em: string }[],
  agora: Date = new Date(),
): Alerta[] {
  return alertas.filter((a) => {
    const anterior = jaEnviados.find((j) => j.tipo === a.tipo && j.chave === a.chave);
    if (!anterior) return true;
    const quando = Date.parse(anterior.enviado_em);
    // Data ilegível deixa PASSAR: perder um alerta é pior que repetir um.
    if (!Number.isFinite(quando)) return true;
    const horas = (agora.getTime() - quando) / 3_600_000;
    return horas >= silencioDe(a.tipo);
  });
}
