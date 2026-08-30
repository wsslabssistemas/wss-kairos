/**
 * O QUE A META QUER DIZER QUANDO A MENSAGEM NÃO CHEGA.
 *
 * ⚠ O PROBLEMA, visto no print de 29/ago: a tela mostrava 14 falhas com o
 * texto CRU da Meta, em inglês, para uma recepcionista brasileira — *"Message
 * undeliverable"*, *"User's number is part of an experiment"*, *"This message
 * was not delivered to maintain healthy ecosystem engagement."*
 *
 * As três parecem a mesma coisa e são três problemas diferentes, com três
 * ações diferentes. A terceira é um ALERTA: significa que a Meta segurou o
 * envio por qualidade, e ela costuma ser o primeiro sinal antes de o número
 * ser restringido. Ler isso como "falhou" perde a única informação que
 * importa.
 *
 * ⚠ O TEXTO ORIGINAL NUNCA SOME. Tradução que esconde a mensagem da
 * plataforma cria um segundo problema: quando alguém for pesquisar o erro ou
 * abrir chamado na Meta, precisa do texto exato. Traduzir é ACRESCENTAR, não
 * substituir.
 *
 * ⚠ E O DESCONHECIDO É HONESTO. Erro que este arquivo não conhece aparece como
 * "A Meta não explicou" com o texto cru ao lado — inventar uma explicação
 * plausível para um código novo é a mesma classe da IA afirmar preço que não
 * tem. Ver a trava anti-invenção.
 */

export type TipoDeFalha = "sem_whatsapp" | "experimento" | "qualidade" | "limite" | "modelo" | "desconhecida";

export type LeituraDaFalha = {
  tipo: TipoDeFalha;
  /** Uma linha, para quem opera — não para quem programou. */
  resumo: string;
  /** O que fazer. Vazio quando não há o que fazer. */
  acao: string;
  /** Merece atenção da gestão, não só do atendimento. */
  grave: boolean;
};

const REGRAS: { casa: RegExp; leitura: Omit<LeituraDaFalha, "tipo"> & { tipo: TipoDeFalha } }[] = [
  {
    // ⚠ O MAIS GRAVE DOS TRÊS, e o que mais parece banal. A Meta segurou a
    // mensagem por qualidade do engajamento — é o aviso que costuma vir ANTES
    // da restrição do número. Tratado como "não chegou", ninguém reage.
    casa: /healthy ecosystem engagement/i,
    leitura: {
      tipo: "qualidade",
      resumo: "A Meta segurou esta mensagem por qualidade do engajamento.",
      acao: "É o aviso que costuma vir antes de restringir o número. Reduza o volume e confira a qualidade em Automação → Canal oficial.",
      grave: true,
    },
  },
  {
    casa: /part of an experiment/i,
    leitura: {
      tipo: "experimento",
      resumo: "A Meta está testando algo com este número e bloqueou a entrega.",
      acao: "Não é problema do cadastro nem do texto. Pode tentar de novo mais adiante.",
      grave: false,
    },
  },
  {
    casa: /undeliverable|not a valid whatsapp|no whatsapp account/i,
    leitura: {
      tipo: "sem_whatsapp",
      resumo: "Este número provavelmente não tem WhatsApp.",
      acao: "Confira o telefone na ficha da pessoa. Se estiver certo, ela não usa WhatsApp — fale por outro canal.",
      grave: false,
    },
  },
  {
    casa: /rate limit|too many|limit reached|throttl/i,
    leitura: {
      tipo: "limite",
      resumo: "Bateu no limite de envios da conta.",
      acao: "Espere a virada da janela. Se repetir, baixe o teto diário em Automação → Regras.",
      grave: true,
    },
  },
  {
    casa: /template|not approved|does not exist/i,
    leitura: {
      tipo: "modelo",
      resumo: "O modelo usado não está aprovado ou não existe com esse nome.",
      acao: "Confira o nome em Automação → Por onde cada motivo sai, e o estado dele no painel da Meta.",
      grave: true,
    },
  },
];

export function lerFalha(erroDaMeta: string | null | undefined): LeituraDaFalha {
  const t = (erroDaMeta ?? "").trim();
  if (!t) {
    return {
      tipo: "desconhecida",
      resumo: "A Meta não disse o motivo.",
      acao: "",
      grave: false,
    };
  }
  for (const r of REGRAS) if (r.casa.test(t)) return r.leitura;
  // ⚠ SEM CHUTE. Código que não conhecemos vira "não explicou", com o texto
  // cru ao lado — inventar explicação plausível para erro novo é a mesma
  // classe da IA afirmar preço que não tem.
  return {
    tipo: "desconhecida",
    resumo: "A Meta não explicou este caso.",
    acao: "",
    grave: false,
  };
}

/** Agrupa as falhas por tipo, para a tela dizer "8 sem WhatsApp" em vez de 14 linhas iguais. */
export function agruparFalhas(erros: (string | null | undefined)[]): { leitura: LeituraDaFalha; quantas: number }[] {
  const por = new Map<TipoDeFalha, { leitura: LeituraDaFalha; quantas: number }>();
  for (const e of erros) {
    const l = lerFalha(e);
    const ja = por.get(l.tipo);
    if (ja) ja.quantas++;
    else por.set(l.tipo, { leitura: l, quantas: 1 });
  }
  // Grave primeiro: quem abre a tela precisa ver o que exige reação antes do
  // que é só cadastro errado.
  return [...por.values()].sort((a, b) => Number(b.leitura.grave) - Number(a.leitura.grave) || b.quantas - a.quantas);
}
