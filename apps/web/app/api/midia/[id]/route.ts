import { NextResponse } from "next/server";
import { getActiveTenant } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { credencialDoCanal } from "@/lib/credenciais";
import { baixarMidia } from "@/lib/audio";

/**
 * BAIXA O ARQUIVO QUE O CLIENTE MANDOU.
 *
 * ⚠ POR QUE ISTO EXISTE (02/set/2026). O número do canal é da Cloud API e
 * **não aparece em nenhum WhatsApp instalado**. Quando a aluna Ana Clara
 * mandou o comprovante de um cancelamento que continuava sendo cobrado, do
 * lado de cá sobrou "(documento recebido — abra no WhatsApp)": uma instrução
 * impossível de seguir. O arquivo estava atrás da API da Meta e ninguém tinha
 * como alcançar.
 *
 * ⚠ E A JANELA É CURTA. A Meta apaga a mídia em poucos dias; esta rota busca
 * enquanto dá. O erro diz isso com todas as letras, porque "não consegui
 * baixar" faria a pessoa tentar de novo para sempre.
 *
 * ⚠ O ESCOPO É CONFERIDO ANTES DE QUALQUER BUSCA. A interação é lida com o
 * `tenant_id` de quem está logado: sem isso, um id de interação de OUTRA
 * empresa baixaria o arquivo de um cliente que não é seu. `service_role` não
 * filtra nada sozinho — mesma regra do `gerarLinkDeAcesso`.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const m = await getActiveTenant();
  if (!m?.tenant) return NextResponse.json({ erro: "Sem empresa." }, { status: 403 });

  const admin = createAdminClient();
  // paginacao-ok: uma linha, chave primária — filtrada pela empresa de quem pediu.
  const { data } = await admin
    .from("interactions")
    .select("media_id, media_tipo, media_url")
    .eq("id", id)
    .eq("tenant_id", m.tenant.id)
    .maybeSingle();

  const linha = data as { media_id: string | null; media_tipo: string | null; media_url: string | null } | null;

  /**
   * ⚠ DOIS CAMINHOS, PORQUE SÃO DUAS APIS. O WhatsApp manda um `media_id` e a
   * gente busca; o Instagram e o Messenger mandam o endereço direto. Supor
   * simetria entre as duas foi o defeito de 03/set, quando o primeiro anexo
   * real do direct chegou e não existia para ninguém.
   */
  if (linha?.media_url) {
    try {
      const r = await fetch(linha.media_url, { cache: "no-store" });
      if (!r.ok) {
        return NextResponse.json(
          { erro: `O endereço do anexo respondeu ${r.status}. Links do Instagram expiram em pouco tempo — peça para reenviar.` },
          { status: 410 },
        );
      }
      const bytes = await r.arrayBuffer();
      const mime = r.headers.get("content-type") ?? "application/octet-stream";
      return new NextResponse(bytes, {
        headers: {
          "Content-Type": mime.split(";")[0],
          "Content-Disposition": `inline; filename="anexo-${id.slice(0, 8)}"`,
          "Cache-Control": "private, no-store",
        },
      });
    } catch (e) {
      return NextResponse.json(
        { erro: `Não consegui buscar o anexo: ${e instanceof Error ? e.message : String(e)}` },
        { status: 502 },
      );
    }
  }

  if (!linha?.media_id) {
    return NextResponse.json(
      { erro: "Esta mensagem não tem arquivo guardado. As recebidas antes de 02/09 não guardavam a chave da mídia." },
      { status: 404 },
    );
  }

  const cred = await credencialDoCanal(m.tenant.id);
  if (!cred) return NextResponse.json({ erro: "Canal oficial não configurado." }, { status: 400 });

  const r = await baixarMidia(linha.media_id, cred);
  if (!r.ok) {
    return NextResponse.json(
      {
        erro:
          `Não consegui baixar da Meta: ${r.motivo}. A Meta guarda o arquivo por poucos ` +
          `dias — se a mensagem for antiga, ele já expirou e só quem mandou ainda tem. ` +
          `Peça para reenviar.`,
      },
      { status: 410 },
    );
  }

  const ext = r.mime.includes("pdf") ? "pdf"
    : r.mime.includes("jpeg") ? "jpg"
    : r.mime.includes("png") ? "png"
    : r.mime.includes("ogg") ? "ogg"
    : (linha.media_tipo ?? "bin");

  return new NextResponse(r.bytes, {
    headers: {
      "Content-Type": r.mime.split(";")[0],
      // `inline` para PDF e imagem abrirem na aba; o resto o navegador decide.
      "Content-Disposition": `inline; filename="arquivo-${id.slice(0, 8)}.${ext}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
