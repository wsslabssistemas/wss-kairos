import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getActiveTenant } from "@/lib/auth";
import { lerAparencia } from "@/lib/aparencia";
import { BRAND_NAME } from "@/lib/brand";
import { salvarAparencia } from "./actions";
import { Tema } from "./Tema";

export const metadata = { title: "Aparência" };

export default async function AparenciaPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; erro?: string }>;
}) {
  const { ok, erro } = await searchParams;
  const membership = await getActiveTenant();
  const tenant = membership?.tenant;
  if (!tenant) return (<main><h1>Aparência</h1><p className="text-dim">Sem empresa vinculada.</p></main>);

  const isAdmin = membership!.role === "owner" || membership!.role === "admin";
  const supabase = await createClient();
  const { data } = await supabase.from("tenants").select("settings").eq("id", tenant.id).maybeSingle();
  const a = lerAparencia((data?.settings as Record<string, unknown> | null) ?? null);

  return (
    <main style={{ maxWidth: 560 }}>
      <h1>Aparência</h1>
      <p className="text-dim" style={{ marginTop: 4 }}>
        A cor e a logo da sua empresa no painel. Quem trabalha aqui todo dia vê a
        marca da casa, não a do fornecedor.
      </p>

      <div className="mt-24"><Tema /></div>

      {ok && <p className="badge badge-success mt-16">Aparência salva.</p>}
      {erro && <p className="badge badge-danger mt-16">{erro}</p>}

      {isAdmin ? (
        <form action={salvarAparencia} encType="multipart/form-data" className="card mt-16 stack" style={{ gap: 16 }}>
          <label className="text-dim" style={{ fontSize: 13 }}>
            <span style={{ display: "block", marginBottom: 6 }}>Cor da marca</span>
            <div className="row" style={{ gap: 10, alignItems: "center" }}>
              <input type="color" name="cor" defaultValue={a.cor ?? "#2e8df2"} style={{ width: 54, height: 36, padding: 2 }} />
              <span className="text-faint" style={{ fontSize: 12 }}>
                Muda o destaque e os realces. As cores de aviso e de erro não mudam —
                alerta que não parece alerta não é alerta.
              </span>
            </div>
          </label>

          <label className="text-dim" style={{ fontSize: 13 }}>
            <span style={{ display: "block", marginBottom: 6 }}>Logo</span>
            <input type="file" name="logo_arquivo" accept="image/png,image/jpeg,image/webp" />
            <span className="text-faint" style={{ display: "block", fontSize: 12, marginTop: 6 }}>
              Escolha o arquivo no seu computador ou celular. PNG, JPG ou WEBP, até 512 KB.
              Fundo transparente (PNG) fica melhor no cabeçalho.
              {a.logoUrl && " Enviar um arquivo novo substitui o atual."}
            </span>
          </label>

          {a.logoUrl && (
            <div className="row" style={{ gap: 10, alignItems: "center" }}>
              <span className="text-faint" style={{ fontSize: 12 }}>Hoje:</span>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={a.logoUrl} alt="Logo atual" style={{ height: 32, width: "auto", maxWidth: 140, objectFit: "contain" }} />
              <label className="text-faint row" style={{ fontSize: 12, gap: 5, alignItems: "center" }}>
                <input type="checkbox" name="remover" value="1" />
                remover a logo
              </label>
            </div>
          )}

          <details>
            <summary className="text-faint" style={{ fontSize: 12, cursor: "pointer" }}>
              Já tenho a logo publicada num site
            </summary>
            <div style={{ marginTop: 8 }}>
              <input name="logo_url" defaultValue="" placeholder="https://suaempresa.com.br/logo.png" />
              <span className="text-faint" style={{ display: "block", fontSize: 12, marginTop: 6 }}>
                Precisa apontar direto para o arquivo, terminando em <code>.png</code> ou{" "}
                <code>.jpg</code>. Link de Instagram, Google Drive ou Canva devolve uma
                página, não a imagem — com eles use o envio de arquivo acima. Se você
                enviar um arquivo, ele tem preferência sobre este campo.
              </span>
            </div>
          </details>

          <button type="submit" className="btn btn-primary" style={{ justifySelf: "start" }}>Salvar</button>
        </form>
      ) : (
        <p className="text-faint mt-16" style={{ fontSize: 13 }}>Só o dono e o administrador mudam a aparência.</p>
      )}

      <div className="card mt-16">
        <p className="eyebrow" style={{ marginBottom: 8 }}>O que não muda</p>
        <p className="text-dim" style={{ marginTop: 0, marginBottom: 0, fontSize: 14 }}>
          O rodapé continua dizendo que o {BRAND_NAME} é feito pela WSS Labs, e a
          página <Link href="/painel/sobre">Sobre</Link> continua no lugar. Esconder o
          fabricante não seria personalização: quem responde pelos seus dados e conserta
          quando quebra precisa estar escrito em algum lugar.
        </p>
      </div>
    </main>
  );
}
