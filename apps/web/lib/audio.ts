import "server-only";
import type { CredencialCanal } from "@/lib/credenciais";

// O ÁUDIO QUE O CLIENTE MANDA — baixar da Meta e transformar em texto.
//
// ⚠ POR QUE ISTO EXISTE. Até 01/set/2026 o webhook registrava áudio como
// `"(áudio recebido — ouça no WhatsApp)"` e contava em `ignorados`. O texto
// existia só para não sumir em silêncio — mas para a IA que redige a resposta,
// ele é indistinguível de uma mensagem vazia: ela responde sem saber o que a
// pessoa disse. E áudio é o formato natural de metade da clientela.
//
// ⚠ CLAUDE NÃO TRANSCREVE ÁUDIO, e por isso isto é a primeira dependência de
// um segundo provedor de IA no produto. O contrato é o formato de transcrição
// da OpenAI, que Groq e outros também falam — trocar de fornecedor é trocar
// `AUDIO_API_URL` e a chave, não reescrever este arquivo.
//
// ⚠ E SEM CHAVE ELE NÃO QUEBRA NADA. Sem `AUDIO_API_KEY` a transcrição
// simplesmente não acontece e o webhook grava a descrição de antes. Ligar é
// acrescentar uma variável e reimplantar; desligar é apagá-la.

/** Quanto tempo esperar pela transcrição antes de desistir. */
const LIMITE_MS = 15_000;

/** Áudio maior que isto não vai para transcrição. Ver a nota em `transcrever`. */
const TETO_BYTES = 12 * 1024 * 1024;

/**
 * Baixa o arquivo de uma mídia da Meta.
 *
 * São DUAS chamadas, e é assim mesmo: a primeira troca o id por uma URL
 * temporária, a segunda baixa o conteúdo — e a segunda também exige o token,
 * embora a URL pareça pública.
 */
export async function baixarMidia(
  mediaId: string,
  cred: CredencialCanal,
): Promise<{ ok: true; bytes: ArrayBuffer; mime: string } | { ok: false; motivo: string }> {
  try {
    const meta = await fetch(`https://graph.facebook.com/${cred.versao}/${mediaId}`, {
      headers: { Authorization: `Bearer ${cred.token}` },
      cache: "no-store",
    });
    const j = (await meta.json()) as { url?: string; mime_type?: string; error?: { message?: string } };
    if (!meta.ok || !j.url) return { ok: false, motivo: j?.error?.message ?? `A Meta respondeu ${meta.status}.` };

    const arq = await fetch(j.url, {
      headers: { Authorization: `Bearer ${cred.token}` },
      cache: "no-store",
    });
    if (!arq.ok) return { ok: false, motivo: `Download respondeu ${arq.status}.` };

    const bytes = await arq.arrayBuffer();
    if (bytes.byteLength > TETO_BYTES) {
      return { ok: false, motivo: `Áudio de ${Math.round(bytes.byteLength / 1024 / 1024)} MB — acima do teto.` };
    }
    return { ok: true, bytes, mime: j.mime_type ?? "audio/ogg" };
  } catch (e) {
    return { ok: false, motivo: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Transcreve. Devolve `null` quando não há chave configurada — que NÃO é erro:
 * é o produto rodando sem o recurso ligado.
 *
 * ⚠ O RELÓGIO É OBRIGATÓRIO. O webhook responde à Meta, e a Meta reenvia o
 * pacote se a resposta demorar — depois desativa a assinatura. Transcrição
 * lenta não pode virar mensagem duplicada nem canal desligado. Estourou o
 * tempo, segue sem o texto.
 */
export async function transcrever(
  bytes: ArrayBuffer,
  mime: string,
): Promise<{ ok: true; texto: string } | { ok: false; motivo: string } | null> {
  const chave = process.env.AUDIO_API_KEY;
  if (!chave) return null;

  const url = process.env.AUDIO_API_URL ?? "https://api.openai.com/v1/audio/transcriptions";
  const modelo = process.env.AUDIO_MODEL ?? "whisper-1";

  const controlador = new AbortController();
  const relogio = setTimeout(() => controlador.abort(), LIMITE_MS);
  try {
    const form = new FormData();
    // A extensão importa para o provedor escolher o decodificador. O WhatsApp
    // manda `audio/ogg; codecs=opus`, e o `;` no meio quebra o palpite.
    const ext = mime.includes("mp4") ? "mp4" : mime.includes("mpeg") ? "mp3" : "ogg";
    form.append("file", new Blob([bytes], { type: mime.split(";")[0] }), `audio.${ext}`);
    form.append("model", modelo);
    // ⚠ IDIOMA DECLARADO. Sem isto o modelo às vezes "reconhece" português de
    // Porto Alegre como espanhol e devolve uma tradução — que é pior que não
    // transcrever, porque parece certo.
    form.append("language", "pt");

    const r = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${chave}` },
      body: form,
      signal: controlador.signal,
    });
    const j = (await r.json()) as { text?: string; error?: { message?: string } };
    if (!r.ok) return { ok: false, motivo: j?.error?.message ?? `Transcrição respondeu ${r.status}.` };
    const texto = (j.text ?? "").trim();
    if (!texto) return { ok: false, motivo: "A transcrição voltou vazia." };
    return { ok: true, texto };
  } catch (e) {
    const erro = e instanceof Error ? e.message : String(e);
    return { ok: false, motivo: controlador.signal.aborted ? `Passou de ${LIMITE_MS / 1000}s.` : erro };
  } finally {
    clearTimeout(relogio);
  }
}

/**
 * Como o áudio transcrito aparece no histórico.
 *
 * ⚠ A MARCA FICA. Quem lê a conversa — pessoa ou IA — precisa saber que aquilo
 * foi FALADO, não escrito: transcrição erra nome próprio e valor, e uma frase
 * transcrita apresentada como se tivesse sido digitada convida a confiar nela
 * como se fosse texto. É a mesma regra do modelo aprovado: o histórico
 * registra o que aconteceu, com o que aconteceu.
 */
export function comoAudio(texto: string): string {
  return `(áudio) ${texto}`;
}
