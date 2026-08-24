/**
 * Normaliza telefone para só dígitos — o controle de duplicidade.
 * Colapsa variações de formatação: "(51) 98251-2270" e "51 98251 2270"
 * viram o mesmo valor, e o índice único (tenant_id, phone) do banco pega o dup.
 *
 * ESTE É O VALOR GUARDADO, e ele continua sendo só dígitos de propósito. Ver a
 * nota grande em `paraE164BR` sobre por que o E.164 é DERIVADO na hora de
 * enviar e nunca gravado por cima.
 */
export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  return digits.length ? digits : null;
}

/** Exibição simples: agrupa para leitura sem prometer formato oficial. */
export function displayPhone(phone: string | null | undefined): string {
  if (!phone) return "—";
  return phone;
}

// =====================================================================
// E.164 BRASILEIRO
//
// POR QUE ISTO EXISTE AGORA E NÃO ANTES
// A auditoria marcava "telefone não está em E.164" como P1 adiado, com o
// motivo escrito: E.164 de verdade precisa de biblioteca de telefonia, e
// normalizar no chute CORROMPE número de cliente — número corrompido não se
// recupera. O gatilho combinado era "fazer quando houver envio por WhatsApp,
// que exige o formato". O envio chegou.
//
// O QUE MUDOU PARA ISTO DEIXAR DE SER CHUTE
// O escopo é UM país. Sem biblioteca de telefonia mundial, mas com as regras
// da Anatel, que são fechadas e verificáveis:
//   - celular  = DDD (2) + 9 dígitos, sempre começando em 9
//   - fixo     = DDD (2) + 8 dígitos, começando em 2 a 5
//   - DDD      = lista finita e conhecida
// Com isso o COMPRIMENTO desambigua sozinho, sem adivinhação.
//
// A REGRA DE SEGURANÇA QUE MANTÉM O MOTIVO DO ADIAMENTO VÁLIDO
// Esta função DERIVA e nunca grava. O que está em `contacts.phone` continua
// sendo o que a pessoa digitou, só sem pontuação. Se a derivação estiver
// errada, o pior que acontece é uma mensagem não sair — e não um cadastro
// destruído. É a diferença entre falhar e corromper.
//
// O BUG QUE ISTO CORRIGE, e que é a prova de que a heurística antiga não dava
// PRA DEIXAR PASSAR: `oportunidades` decidia por `d.startsWith("55")`.
// **DDD 55 é Santa Maria, no Rio Grande do Sul.** O celular 55 98765-4321
// começa com "55", era lido como "já tem código de país", e virava um número
// de 11 dígitos que o WhatsApp interpreta truncado. Silenciosamente, e no
// estado onde fica a primeira empresa real do produto.
// =====================================================================

/**
 * Os DDDs que existem. Lista fechada — o que não está aqui é digitação
 * errada, e vale mais recusar do que mandar mensagem para estranho.
 */
const DDDS_BR = new Set([
  11, 12, 13, 14, 15, 16, 17, 18, 19,
  21, 22, 24, 27, 28,
  31, 32, 33, 34, 35, 37, 38,
  41, 42, 43, 44, 45, 46, 47, 48, 49,
  51, 53, 54, 55,
  61, 62, 63, 64, 65, 66, 67, 68, 69,
  71, 73, 74, 75, 77, 79,
  81, 82, 83, 84, 85, 86, 87, 88, 89,
  91, 92, 93, 94, 95, 96, 97, 98, 99,
]);

export type E164Resultado =
  | {
      ok: true;
      /** Só dígitos, com o 55 na frente — o formato que o `wa.me` e a Cloud API querem. */
      digitos: string;
      /** `+5551982512270`, para mostrar e para o corpo do JSON da API oficial. */
      e164: string;
      /**
       * Preenchido quando foi preciso INTERPRETAR algo além de acrescentar o
       * código do país. Existe para a tela poder mostrar "confira este número"
       * em vez de mandar calado.
       */
      ajuste?: string;
    }
  | { ok: false; motivo: string };

/**
 * Deriva o E.164 brasileiro de um telefone guardado.
 *
 * Recusa em vez de adivinhar. Uma mensagem que não sai é um problema visível
 * que alguém conserta; uma mensagem que sai para o número errado é um
 * problema invisível que vira reclamação do cliente do cliente.
 */
export function paraE164BR(raw: string | null | undefined): E164Resultado {
  const d = normalizePhone(raw);
  if (!d) return { ok: false, motivo: "Sem telefone cadastrado." };

  // Formas internacionais escritas à mão: "+55 51 ..." e "0055 51 ..."
  let n = d;
  if (n.startsWith("00")) n = n.slice(2);

  // ------------------------------------------------------------------
  // COM código de país. 13 dígitos = 55 + DDD + celular(9);
  // 12 = 55 + DDD + fixo(8). Nenhum outro comprimento fecha no Brasil.
  // ------------------------------------------------------------------
  if ((n.length === 13 || n.length === 12) && n.startsWith("55")) {
    const resto = n.slice(2);
    return montar(resto, "55");
  }

  // ------------------------------------------------------------------
  // SEM código de país. 11 = DDD + celular; 10 = DDD + fixo.
  //
  // Este ramo é o que corrige o bug do DDD 55: aqui o "55" da frente é lido
  // como DDD, porque o COMPRIMENTO já disse que não há código de país.
  // ------------------------------------------------------------------
  if (n.length === 11 || n.length === 10) return montar(n, "55");

  if (n.length < 10) return { ok: false, motivo: `Número curto demais (${n.length} dígitos).` };
  return { ok: false, motivo: `Número com ${n.length} dígitos não é um telefone brasileiro válido.` };
}

/** `resto` = DDD + assinante, já sem código de país. */
function montar(resto: string, pais: string): E164Resultado {
  const ddd = Number(resto.slice(0, 2));
  if (!DDDS_BR.has(ddd)) return { ok: false, motivo: `DDD ${resto.slice(0, 2)} não existe.` };

  const assinante = resto.slice(2);
  const primeiro = assinante[0];

  // Celular atual: 9 dígitos começando em 9.
  if (assinante.length === 9) {
    if (primeiro !== "9") {
      return { ok: false, motivo: `Celular com 9 dígitos precisa começar em 9 (veio ${primeiro}).` };
    }
    return { ok: true, digitos: pais + resto, e164: `+${pais}${resto}` };
  }

  if (assinante.length === 8) {
    // Fixo: começa em 2 a 5. Segue como está.
    if (primeiro >= "2" && primeiro <= "5") {
      return { ok: true, digitos: pais + resto, e164: `+${pais}${resto}` };
    }

    // CELULAR ANTIGO, sem o nono dígito. A Anatel tornou o 9 obrigatório em
    // todo o país em 2016, então um assinante de 8 dígitos começando em 6-9 é
    // cadastro velho, não número curto. Acrescentar o 9 é aplicar a REGRA, não
    // chutar — e por isso vem com `ajuste` preenchido: quem envia vê o que foi
    // interpretado antes de a mensagem sair.
    if (primeiro >= "6" && primeiro <= "9") {
      const corrigido = `${resto.slice(0, 2)}9${assinante}`;
      return {
        ok: true,
        digitos: pais + corrigido,
        e164: `+${pais}${corrigido}`,
        ajuste: "Cadastro sem o nono dígito; foi acrescentado. Confira antes de enviar.",
      };
    }

    return { ok: false, motivo: `Número de 8 dígitos começando em ${primeiro} não é fixo nem celular.` };
  }

  return { ok: false, motivo: `Assinante com ${assinante.length} dígitos — esperado 8 ou 9.` };
}

/**
 * Número no formato que o `wa.me` espera, ou `null`.
 *
 * Mantida com o nome antigo porque seis telas já chamam assim. O que mudou é
 * o miolo: era heurística de comprimento com um `startsWith("55")` solto em
 * outra tela; agora é a mesma regra para todo mundo, num lugar só.
 */
export function whatsappNumber(phone: string | null | undefined): string | null {
  const r = paraE164BR(phone);
  return r.ok ? r.digitos : null;
}

/**
 * O CAMINHO DE VOLTA: da Meta para o cadastro.
 *
 * Quando uma mensagem chega, a Meta diz quem mandou em E.164 completo
 * (`5551982512270`). O cadastro, porém, guarda o que a recepção digitou — e na
 * base real da Be Fitness isso aparece em QUATRO formatos: 13 dígitos, 11, 12
 * (celular antigo com país) e 10 (celular antigo sem país).
 *
 * Procurar só pelo E.164 acharia 56% dos contatos. Os outros 44% ganhariam um
 * contato DUPLICADO a cada mensagem recebida — e duplicata em CRM não é
 * incômodo: ela parte o histórico em dois, então a pessoa aparece na fila como
 * se nunca tivesse conversado, e o vendedor manda a primeira mensagem para
 * quem já é aluno.
 *
 * Esta função devolve todas as formas em que o MESMO telefone pode estar
 * gravado, para a busca ser um `in (...)` só.
 */
export function variantesArmazenadas(e164digits: string): string[] {
  const d = (e164digits ?? "").replace(/\D/g, "");
  if (!d.startsWith("55") || (d.length !== 13 && d.length !== 12)) return d ? [d] : [];

  const resto = d.slice(2);              // DDD + assinante
  const ddd = resto.slice(0, 2);
  const assinante = resto.slice(2);
  const fora = new Set<string>([d, resto]);

  // Celular atual (9 dígitos começando em 9) também pode estar gravado no
  // formato antigo, sem o nono dígito — é como está 39% da base.
  if (assinante.length === 9 && assinante.startsWith("9")) {
    const antigo = assinante.slice(1);
    fora.add(`55${ddd}${antigo}`);
    fora.add(`${ddd}${antigo}`);
  }

  // ⚠ E O CAMINHO CONTRÁRIO, QUE FALTAVA — descoberto ao vivo em 24/ago.
  //
  // **A META DEVOLVE O REMETENTE BRASILEIRO SEM O NONO DÍGITO.** O modelo saiu
  // para `5551993742002` (13 dígitos, com o 9 que `paraE164BR` acrescenta), a
  // pessoa respondeu, e o `wa_id` que voltou foi `555193742002` — 12 dígitos.
  //
  // Esta função sabia converter "tenho o 9, procure também sem" e não sabia o
  // inverso. Resultado: o cadastro estava gravado COM o 9, a busca procurou só
  // SEM, não achou, e o webhook criou um contato novo. A conversa foi parar
  // num segundo cadastro e a caixa de resposta do primeiro apareceu cinza,
  // com a janela de 24h "fechada" — porque naquele contato ninguém havia
  // escrito mesmo.
  //
  // ⚠ É A MESMA CLASSE DA LILIAN, com a direção trocada: lá o cadastro estava
  // sem o 9 e a mensagem chegava com; aqui o cadastro tem e a mensagem chega
  // sem. Consertar uma direção e não a outra é o que faz o defeito voltar com
  // outra cara — e este voltaria em TODA resposta da campanha.
  if (assinante.length === 8 && assinante[0] >= "6" && assinante[0] <= "9") {
    const novo = `9${assinante}`;
    fora.add(`55${ddd}${novo}`);
    fora.add(`${ddd}${novo}`);
  }

  return [...fora];
}
