// A RENOVAÇÃO — quem está perto de vencer, e o que dizer em cada janela.
//
// Sem banco e sem imports, para ser testável em Node puro.
//
// O PEDIDO DO FUNDADOR, e ele já trouxe a parte difícil junto: *"tentar
// interagir com o cliente no mês ou x tempo antes de vencer, para não fazer o
// contato apenas quando está por vencer."* É exatamente a diferença entre
// renovar e cobrar.
//
// POR QUE TRÊS JANELAS E NÃO UM ALERTA. Contato único no vencimento chega no
// pior momento possível: a pessoa já decidiu, e a conversa vira negociação de
// preço sob pressão de prazo — o terreno onde o cliente ganha e a margem
// perde. Três toques com ÂNGULOS DIFERENTES é a mesma estrutura de cadência
// que o produto já usa em todo lugar (Blount), aplicada ao fim do contrato.
//
// A REGRA QUE MAIS IMPORTA, e que quase todo sistema erra: **o primeiro toque
// não fala de renovação.** Ele fala do RESULTADO. Renovação vendida em cima de
// um ganho que o cliente acabou de reconhecer é outra conversa — e quem só
// aparece para cobrar assinatura ensina o cliente a lembrar do produto como
// despesa.
//
// O QUE ESTA PEÇA NÃO FAZ: prever se ele vai renovar. Não existe conversão
// observada de renovação no banco — zero contratos com vencimento registrado
// até hoje. Um score aqui sairia inventado, e a casa já decidiu que número
// inventado com cara de número é pior que campo vazio.

/**
 * ⚠ O TEXTO DE CADA JANELA VEM DO MANIFESTO. Isto aqui é o PISO.
 *
 * Estas frases nasceram com a academia e ficaram sendo lidas por todo mundo:
 * *"pergunte o que ele já conseguiu que não conseguia"* é excelente para um
 * aluno e é constrangedor num contrato de fornecimento de feltro. Prosa de
 * venda escrita no núcleo é a Lei 1 vazando — e vazando no lugar mais caro,
 * porque é o texto que a IA recebe como instrução.
 *
 * Hoje cada segmento com `contract.enabled` declara `contract.renewal` no
 * manifesto, e `renovacao_check.mjs` exige isso. O que sobra aqui é o padrão
 * NEUTRO: ele não fala de plano, aluno nem resultado pessoal — fala de
 * contrato, que é vocabulário do núcleo. Se um segmento novo esquecer de
 * declarar, o motor continua funcionando e dizendo algo verdadeiro, em vez de
 * dizer algo de outro ramo.
 *
 * A ESTRUTURA continua sendo do núcleo, e é ela que carrega a técnica: três
 * janelas com ângulos diferentes (Blount), e **o primeiro toque não fala de
 * renovação** — fala do resultado. Isso não é opinião de segmento, é o que
 * separa renovar de cobrar.
 */
export const JANELAS = [
  {
    key: "resultado",
    diasAntes: 60,
    titulo: "Falar do resultado",
    intencao:
      "NÃO mencione renovação. Pergunte o que o contrato já entregou na prática — e registre a resposta. É esse texto que vai sustentar a conversa daqui a um mês.",
  },
  {
    key: "continuidade",
    diasAntes: 30,
    titulo: "Abrir a continuidade",
    intencao:
      "Retome o ganho que ele mesmo disse e projete o próximo ciclo. Aqui a renovação entra como continuação, não como cobrança.",
    /**
     * ⚠ O CAMINHO PARA QUANDO O GANHO NÃO EXISTE — e ele é a regra, não a
     * exceção.
     *
     * A intenção de cima manda "retomar o ganho que ele mesmo disse". Isso
     * depende do toque de 60 dias ter acontecido E da resposta ter sido
     * registrada. Nenhum dos dois é verdade numa base nova: a Be Fitness tem
     * ZERO notas preenchidas em 257 contatos com data marcada.
     *
     * Sem esta linha, a trava anti-invenção fazia a coisa certa e o efeito era
     * péssimo: o motor se recusava a escrever **para todo mundo**, e a Luciana
     * via "Escalar — falta fato no DNA" em cada pessoa da fila. Ela foi
     * procurar no DNA um fato que nunca vai estar lá, porque não é fato da
     * EMPRESA — é do aluno.
     *
     * A saída não é afrouxar a trava nem inventar o ganho. É **fazer agora a
     * pergunta que o toque de 60 dias faria**: quem não tem a resposta,
     * pergunta. Genérico e honesto ganha de específico e falso — a mesma regra
     * do alarme de silêncio da cadência.
     */
    intencaoSemHistorico:
      "Ninguém registrou o que este contrato já entregou para ele, então NÃO afirme ganho nenhum e não invente resultado. Faça agora a pergunta que ficou para trás: o que ele já consegue fazer hoje e não conseguia quando começou. Registre a resposta — e só então fale de continuidade, na conversa seguinte.",
  },
  {
    key: "condicao",
    diasAntes: 7,
    titulo: "Fechar com condição concreta",
    intencao:
      "Data, valor e forma de pagamento, com o que existir de verdade no DNA. Sem condição concreta, o vencimento passa e vira cancelamento por inércia.",
  },
] as const;

export type Janela = (typeof JANELAS)[number]["key"];

/**
 * O que o SEGMENTO diz em cada janela — declarado em `contract.renewal`.
 *
 * `dias_antes` também é do segmento: academia renova mês a mês e 60 dias é
 * cedo demais; contrato de fornecimento tem aviso prévio e 60 dias é em cima
 * da hora. O núcleo decide QUANDO comparar; o manifesto decide o quê e a que
 * distância.
 */
export type RenewalConfig = {
  vencido?: { titulo?: string; intencao?: string };
  janelas?: {
    key: Janela;
    dias_antes?: number;
    titulo?: string;
    intencao?: string;
    /** Usada quando a janela depende de algo que o cliente disse e ninguém registrou. */
    intencao_sem_historico?: string;
  }[];
};

export type ContatoComContrato = {
  id: string;
  name: string;
  phone: string | null;
  journey_stage: string;
  /**
   * Quando o contrato COMEÇOU (ISO). Opcional: base antiga não tem.
   *
   * ⚠ Sem ela a régua não sabe quanto do contrato já passou — e é isso que faz
   * um plano MENSAL abrir a janela de renovação no dia da matrícula.
   */
  contract_start?: string | null;
  contract_end: string | null;
  /**
   * Quando a vigência foi CONFERIDA na fonte pela última vez (ISO, só data).
   *
   * ⚠ ESTE CAMPO EXISTE POR CAUSA DA MARIA ISABEL FERREIRA GARCIA.
   *
   * O contrato dela era 11/fev → 10/ago, semestral. Em 13/ago a fila dizia
   * "Venceu sem contato" — e ela já tinha renovado. A fila não errou: ela
   * reportou fielmente o que o banco dizia. O banco é que estava afirmando
   * uma FOTOGRAFIA com a confiança de um fato vivo.
   *
   * O sistema da academia não tem API; a vigência entra por planilha, e cada
   * renovação cria uma LINHA NOVA lá. Entre uma importação e a próxima, todo
   * `contract_end` envelhece em silêncio — e envelhecer em silêncio é
   * exatamente o defeito que o `0029` corrigiu no DNA: *"dado de um ano atrás
   * passava como PRONTO e era afirmado com a confiança do dado de ontem —
   * mentir sem nunca ter inventado."*
   *
   * A regra derivada: um vencimento só pode ser AFIRMADO se a fonte foi
   * conferida DEPOIS da data de fim. Antes disso o sistema não sabe se
   * venceu ou se renovou, e dizer que venceu é inventar.
   */
  contrato_conferido_em?: string | null;
  /**
   * O que alguém anotou sobre o que o cliente disse (`next_action_note`).
   *
   * ⚠ É o que decide se a janela de continuidade pode "retomar o ganho que
   * ele mesmo contou" ou se precisa PERGUNTAR primeiro. Vazio é o estado
   * normal de uma base nova — 257 contatos da Be Fitness com data marcada e
   * ZERO com nota.
   */
  next_action_note?: string | null;
};

export type Renovacao = {
  contactId: string;
  name: string;
  phone: string | null;
  /** Dias até vencer. Negativo = já venceu. */
  diasParaVencer: number;
  janela: Janela;
  titulo: string;
  intencao: string;
  /** Já passou da data. É o caso mais caro e por isso vem primeiro. */
  vencido: boolean;
  /**
   * ⚠ QUANDO ESTA JANELA ABRIU (ISO) — é o que permite QUITAR o toque.
   *
   * Sem isto a renovação era o único dos quatro motivos da fila que **nunca
   * quitava**: ela é calculada só a partir de `contract_end`, então a pessoa
   * ficava na lista todo dia até o contrato mudar, mesmo tendo sido contatada.
   *
   * Foi assim que a Luciana viu a Bruna Cristina de volta na fila depois de
   * ter mandado a mensagem (15/ago). O padrão da casa outra vez: nada quebrou,
   * a lista só não encolheu — e lista que não encolhe parece trabalho
   * acumulado, não defeito. É exatamente o que já tinha acontecido com o
   * `combinado`, e o comentário de `lib/fila.ts` afirmava que "as outras três
   * origens já quitavam sozinhas" sem reparar que a renovação não é uma delas.
   *
   * A régua: **um toque por janela.** Falou depois que a janela abriu, está
   * feito — e volta a aparecer quando a janela seguinte abrir (60 → 30 → 7 →
   * vencido), que é uma conversa nova, com outro texto.
   */
  janelaAbriuEm: string;
  /**
   * A fonte foi conferida DEPOIS do vencimento?
   *
   * `false` significa "não sei se venceu ou renovou" — e a diferença entre os
   * dois textos é a diferença entre cobrar quem já pagou e perguntar.
   */
  vencimentoConfirmado?: boolean;
};

const diaISO = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Quem precisa de um toque de renovação hoje.
 *
 * `foraDeJogo` são as etapas de perda e as finais: quem já saiu não recebe
 * conversa de renovação. Vencido entra na lista mesmo assim — e no topo —
 * porque contrato que venceu sem ninguém falar é a perda mais barata de
 * evitar e a mais constrangedora de descobrir depois.
 */
export function computeRenovacoes(
  contatos: ContatoComContrato[],
  foraDeJogo: Set<string>,
  hoje: Date = new Date(),
  renewal?: RenewalConfig | null,
): Renovacao[] {
  const hojeStr = diaISO(hoje);
  const out: Renovacao[] = [];

  // O manifesto sobrepõe janela a janela, campo a campo. Sobreposição parcial
  // é de propósito: um segmento pode querer só mudar o texto do vencido e
  // manter o resto, e obrigá-lo a redeclarar tudo é o caminho para redeclarar
  // errado.
  const doSeg = new Map((renewal?.janelas ?? []).map((j) => [j.key, j]));
  const JAN = JANELAS.map((j) => {
    const o = doSeg.get(j.key);
    return {
      key: j.key,
      diasAntes: o?.dias_antes ?? j.diasAntes,
      titulo: o?.titulo ?? j.titulo,
      intencao: o?.intencao ?? j.intencao,
      intencaoSemHistorico:
        o?.intencao_sem_historico ??
        ((j as { intencaoSemHistorico?: string }).intencaoSemHistorico ?? null),
    };
  // ⚠ ORDEM CRESCENTE, e o `.find` abaixo depende disso.
  //
  // A constante `JANELAS` é escrita em ordem DECRESCENTE (60, 30, 7) porque é
  // a ordem em que a conversa acontece, e a busca original compensava com um
  // `.reverse()`. Quando o manifesto passou a poder mudar `dias_antes`, a
  // ordem escrita deixou de valer: um segmento pode declarar 90, 45 e 10 em
  // qualquer ordem no YAML. Ordenar aqui é o que mantém "a janela mais
  // apertada que ainda cabe" sendo verdade.
  //
  // Errei isto na primeira versão — ordenei crescente e mantive o `.reverse()`
  // herdado, o que fazia TODO contrato cair na janela mais larga e receber a
  // conversa de resultado a 5 dias do vencimento. `renovacao_test.mjs` pegou
  // nos quatro casos, imediatamente.
  }).sort((a, b) => a.diasAntes - b.diasAntes);

  for (const c of contatos) {
    if (!c.contract_end) continue;
    if (foraDeJogo.has(c.journey_stage)) continue;

    const dias = Math.round((Date.parse(c.contract_end) - Date.parse(hojeStr)) / 86400000);

    // Vencido: uma janela só, e sem número de dias na intenção — "venceu há 40
    // dias" dito ao cliente é constrangimento, não argumento.
    if (dias < 0) {
      // ⚠ SÓ AFIRMA O VENCIMENTO SE A FONTE FOI CONFERIDA DEPOIS DELE.
      //
      // Sem conferência posterior, "venceu" é dedução sobre dado velho. E o
      // erro é assimétrico: dizer "venceu" para quem renovou é constrangedor
      // e faz o cliente duvidar do sistema inteiro; perguntar para quem
      // realmente venceu custa uma frase. Na dúvida, perguntar.
      const conferido = c.contrato_conferido_em ?? null;
      const confirmado = !!conferido && conferido.slice(0, 10) > c.contract_end.slice(0, 10);
      out.push({
        contactId: c.id, name: c.name, phone: c.phone,
        diasParaVencer: dias, janela: "condicao",
        titulo: confirmado
          ? (renewal?.vencido?.titulo ?? "Venceu sem contato")
          : "Vencimento não confirmado",
        intencao: confirmado
          ? (renewal?.vencido?.intencao ??
            "Retome sem cobrar o atraso. Pergunte se ele quer seguir e ofereça a condição concreta — quem venceu sem conversa quase sempre só não foi lembrado.")
          : `A vigência registrada terminou${conferido ? ` e a fonte não é conferida desde ${conferido.slice(0, 10).split("-").reverse().join("/")}` : " e nunca foi conferida na fonte"}. O sistema NÃO sabe se ele renovou. Confirme antes de falar — e não escreva nada que afirme que o contrato venceu.`,
        vencido: true,
        vencimentoConfirmado: confirmado,
        // A janela do vencido abre no próprio dia do vencimento.
        janelaAbriuEm: c.contract_end.slice(0, 10),
      });
      continue;
    }

    // A janela mais APERTADA que ainda cabe. Sem isto, um contrato a 25 dias
    // cairia na janela de 60 e receberia a conversa errada — a de resultado,
    // quando já é hora da condição.
    const janela = JAN.find((j) => dias <= j.diasAntes);
    if (!janela) continue;

    /**
     * ⚠ CONTRATO QUE ACABOU DE COMEÇAR NÃO ESTÁ A VENCER.
     *
     * O DEFEITO DO PLANO MENSAL, apontado pelo fundador em 29/ago: as janelas
     * abrem 60 e 30 dias antes do vencimento, e um plano de 30 dias tem
     * `diasParaVencer = 30` **no dia da matrícula**. Quem assinava hoje
     * aparecia na fila hoje, com o assunto "seu plano está a vencer", para um
     * vendedor perguntar de renovação a quem acabou de pagar.
     *
     * ⚠ E O ESTRAGO NÃO É SÓ A MENSAGEM ESTRANHA. `renovacao` tem peso 1 na
     * fila — quase o topo. Cada mensal novo entrava na frente de gente com
     * conversa de verdade devida, empurrando o trabalho útil para baixo.
     *
     * A regra: a janela não abre antes de **metade do contrato** ter passado.
     * Mensal de 30 dias abre no dia 15; anual de 365 abre no dia 182, mas os
     * 60 dias de antecedência mandam bem depois disso — então para plano longo
     * nada muda. É uma trava que só morde onde o defeito existe.
     *
     * ⚠ SEM `contract_start` A REGRA NÃO OPINA. Base antiga não tem a data, e
     * barrar por ausência de dado tiraria renovação legítima da fila em
     * silêncio — o mesmo princípio do recorte e do `paraE164BR`.
     */
    if (c.contract_start) {
      const inicio = Date.parse(c.contract_start);
      const fim = Date.parse(c.contract_end);
      if (Number.isFinite(inicio) && Number.isFinite(fim) && fim > inicio) {
        const metade = inicio + (fim - inicio) / 2;
        if (hoje.getTime() < metade) continue;
      }
    }

    out.push({
      contactId: c.id, name: c.name, phone: c.phone,
      diasParaVencer: dias, janela: janela.key,
      titulo: janela.titulo,
      // ⚠ SEM O GANHO REGISTRADO, A INTENÇÃO MUDA — não a trava.
      //
      // A janela de 30 dias manda "retomar o ganho que ele mesmo disse". Isso
      // depende do toque de 60 dias ter sido dado E anotado, e numa base nova
      // nenhum dos dois aconteceu. O motor então se recusava a escrever para
      // TODO MUNDO, com um aviso que mandava procurar no DNA um fato que é do
      // aluno, não da empresa.
      //
      // Aqui a intenção passa a ser "faça agora a pergunta que ficou para
      // trás". Não afrouxa nada: continua proibido afirmar ganho. Só para de
      // pedir ao motor uma coisa que ninguém deu a ele.
      intencao:
        (!c.next_action_note?.trim() && janela.intencaoSemHistorico)
          ? janela.intencaoSemHistorico
          : janela.intencao,
      vencido: false,
      // A janela abre `diasAntes` antes do vencimento — e é a partir daqui que
      // uma conversa quita este toque. `diasAntes` sai do manifesto quando o
      // segmento sobrescreve, então a data é derivada dele, nunca fixa.
      janelaAbriuEm: diaISO(new Date(Date.parse(c.contract_end) - janela.diasAntes * 86400000)),
    });
  }

  // Vencido primeiro, depois o mais próximo de vencer.
  return out.sort((a, b) => Number(b.vencido) - Number(a.vencido) || a.diasParaVencer - b.diasParaVencer);
}
