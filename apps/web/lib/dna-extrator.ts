/**
 * O DNA A PARTIR DE TEXTO SOLTO — a pessoa cola o que sabe, o sistema
 * distribui nos campos, e ELA confere.
 *
 * ⚠ POR QUE ISTO EXISTE. O gargalo do produto não é o motor: é o primeiro dia.
 * Empresa sem DNA preenchido recebe recusa em tudo — a trava anti-invenção faz
 * o certo e o dono conclui que o produto não funciona. É por isso que Darvil e
 * Feltros estão cadastradas e paradas há semanas.
 *
 * Preencher trinta campos do zero é uma tarde que ninguém tem. **Corrigir dez
 * campos preenchidos leva minutos** — e a diferença entre as duas é a diferença
 * entre uma empresa que opera e uma que desiste.
 *
 * ⚠ E O SISTEMA NÃO SALVA NADA SOZINHO. Ele PROPÕE; quem confirma é gente. É a
 * trava anti-invenção aplicada ao cadastro: dado que entra sem alguém olhar
 * vira afirmação de preço que ninguém autorizou, dita com a confiança do fato
 * conferido. O extrator acelera a digitação, nunca a decisão.
 *
 * ⚠ E O QUE ELE **NÃO** ACHOU É TÃO IMPORTANTE QUANTO O QUE ACHOU. Campo vazio
 * no DNA vira escalada no atendimento, e a pessoa não faz essa ligação sozinha.
 * Por isso a proposta devolve as duas listas.
 *
 * Este arquivo é PURO: monta o pedido e valida a resposta. Não fala com a IA
 * nem com o banco — é o que permite testar a validação sem gastar token.
 */

/** Um campo, como o manifesto do segmento declara. */
export type CampoDoManifesto = {
  key: string;
  label?: string;
  help?: string;
  type?: string;
  columns?: string[];
  options?: string[];
  required?: boolean;
};

export type SecaoDoManifesto = {
  key: string;
  label?: string;
  required?: boolean;
  fields?: CampoDoManifesto[];
};

export type Proposta = {
  /** Só o que o manifesto declara, e só o que veio com conteúdo. */
  valores: Record<string, Record<string, unknown>>;
  /** Campos declarados que o texto não respondeu — o que vai escalar depois. */
  faltando: { secao: string; campo: string; label: string }[];
  /** O que a IA devolveu e foi DESCARTADO, com o motivo. Nunca em silêncio. */
  descartado: { caminho: string; motivo: string }[];
};

/**
 * O ESQUEMA QUE VAI NO PEDIDO — derivado do manifesto, nunca escrito à mão.
 *
 * ⚠ O NÚCLEO NÃO PODE CONHECER "plano semestral" nem "grade de aulas" (Lei 1).
 * Descrever os campos aqui em código faria o extrator funcionar para academia e
 * calar para oficina — e seria vocabulário de mercado dentro do núcleo.
 */
export function esquemaParaPedido(secoes: SecaoDoManifesto[]): string {
  return secoes
    .map((s) => {
      const campos = (s.fields ?? [])
        .map((f) => {
          const partes = [`  - ${f.key} (${f.type ?? "text"})`];
          if (f.label) partes.push(`rotulo: ${f.label}`);
          if (f.help) partes.push(`ajuda: ${f.help}`);
          if (f.columns?.length) partes.push(`colunas: ${f.columns.join(", ")}`);
          if (f.options?.length) partes.push(`opcoes: ${f.options.join(" | ")}`);
          return partes.join(" · ");
        })
        .join("\n");
      // Seção sem campos guarda um valor único (texto livre).
      return `${s.key}${s.label ? ` — ${s.label}` : ""}\n${campos || "  (texto livre, valor único)"}`;
    })
    .join("\n\n");
}

/**
 * VALIDA O QUE A IA DEVOLVEU CONTRA O MANIFESTO.
 *
 * ⚠ CHAVE QUE O MANIFESTO NÃO DECLARA É DESCARTADA. Um modelo prestativo
 * inventa `pricing.desconto_aniversario` porque o texto mencionou aniversário —
 * e aquele campo não existe em tela nenhuma, então ninguém nunca vai conferir
 * nem corrigir. Dado que entra e não pode ser visto é pior que dado ausente.
 *
 * ⚠ E O DESCARTE APARECE. Sumir com o que foi ignorado faria a pessoa achar
 * que o texto dela foi todo aproveitado.
 */
export function validarProposta(
  bruto: unknown,
  secoes: SecaoDoManifesto[],
): Proposta {
  const valores: Proposta["valores"] = {};
  const descartado: Proposta["descartado"] = [];
  const porSecao = new Map(secoes.map((s) => [s.key, s]));

  const obj = (bruto ?? {}) as Record<string, unknown>;
  for (const [chaveSecao, conteudo] of Object.entries(obj)) {
    const secao = porSecao.get(chaveSecao);
    if (!secao) {
      descartado.push({ caminho: chaveSecao, motivo: "seção não existe no manifesto deste segmento" });
      continue;
    }
    if (conteudo === null || conteudo === undefined) continue;

    // Seção sem campos declarados guarda valor único.
    if (!secao.fields?.length) {
      if (temConteudo(conteudo)) valores[chaveSecao] = { __valor: conteudo };
      continue;
    }

    const permitidos = new Set(secao.fields.map((f) => f.key));
    const dentro = (conteudo ?? {}) as Record<string, unknown>;
    if (typeof dentro !== "object" || Array.isArray(dentro)) {
      descartado.push({ caminho: chaveSecao, motivo: "esperava um objeto com os campos da seção" });
      continue;
    }
    for (const [chaveCampo, valor] of Object.entries(dentro)) {
      if (!permitidos.has(chaveCampo)) {
        descartado.push({ caminho: `${chaveSecao}.${chaveCampo}`, motivo: "campo não existe no manifesto" });
        continue;
      }
      // ⚠ VAZIO NÃO É RESPOSTA. String em branco, lista vazia e "não informado"
      // preencheriam o campo e fariam a trava anti-invenção achar que tem fato.
      if (!temConteudo(valor)) continue;
      (valores[chaveSecao] ??= {})[chaveCampo] = valor;
    }
  }

  const faltando: Proposta["faltando"] = [];
  for (const s of secoes) {
    for (const f of s.fields ?? []) {
      if (valores[s.key]?.[f.key] === undefined) {
        faltando.push({ secao: s.key, campo: f.key, label: f.label ?? f.key });
      }
    }
  }

  return { valores, faltando, descartado };
}

/** Conteúdo de verdade — não string vazia, lista vazia nem "não informado". */
function temConteudo(v: unknown): boolean {
  if (v === null || v === undefined) return false;
  if (typeof v === "string") {
    const t = v.trim().toLowerCase();
    if (!t) return false;
    // ⚠ O MODELO GOSTA DE PREENCHER COM EDUCAÇÃO. "não informado" num campo de
    // preço faria o motor tratar como fato declarado e afirmar isso a um
    // cliente. Estas frases valem exatamente o mesmo que campo vazio.
    return !["não informado", "nao informado", "n/a", "na", "-", "não sei", "nao sei",
             "não mencionado", "nao mencionado", "desconhecido", "null"].includes(t);
  }
  if (Array.isArray(v)) return v.length > 0 && v.some(temConteudo);
  if (typeof v === "object") return Object.values(v as Record<string, unknown>).some(temConteudo);
  return true;
}
