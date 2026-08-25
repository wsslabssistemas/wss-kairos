"use client";

import { useState } from "react";
import { carregarPerfil, salvarPerfil, type PerfilResult } from "./perfil-actions";

/**
 * ⚠ É O QUE A PESSOA VÊ ANTES DE DECIDIR SE RESPONDE.
 *
 * Quem recebe uma mensagem de um número que não tem salvo vê duas coisas: o
 * nome de exibição e a foto. Número sem foto, com nome errado, é o retrato de
 * golpe — e nenhuma qualidade de texto conserta uma mensagem que não foi
 * aberta.
 *
 * ⚠ O NOME DE EXIBIÇÃO NÃO ESTÁ AQUI PORQUE NÃO TEM API. Ele só muda na tela
 * da Meta e passa por revisão. O resto do perfil é editável por código, e é o
 * resto que estava vazio.
 */
export function PerfilDoNumero() {
  const [r, setR] = useState<PerfilResult | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [salvando, setSalvando] = useState(false);

  const perfil = r?.ok ? r.perfil : null;

  const abrir = async () => {
    setCarregando(true);
    try {
      setR(await carregarPerfil());
    } catch (e) {
      setR({ ok: false, erro: e instanceof Error ? e.message : String(e) });
    } finally {
      setCarregando(false);
    }
  };

  const salvar = async (form: FormData) => {
    setSalvando(true);
    try {
      setR(await salvarPerfil(form));
    } catch (e) {
      setR({ ok: false, erro: e instanceof Error ? e.message : String(e) });
    } finally {
      setSalvando(false);
    }
  };

  return (
    <div className="card mt-16">
      <p className="eyebrow" style={{ marginBottom: 8 }}>Perfil do número</p>
      <p className="text-dim" style={{ marginTop: 0, fontSize: 14 }}>
        A <strong>foto</strong> e os dados que aparecem quando alguém toca no nome do seu
        número. É o que a pessoa vê antes de decidir se responde — e é o único lugar da
        campanha que não depende do texto.
      </p>

      {!r && (
        <button type="button" className="btn" onClick={abrir} disabled={carregando}>
          {carregando ? "buscando na Meta…" : "Ver o perfil que está no ar"}
        </button>
      )}

      {r && !r.ok && (
        <p className="badge badge-danger" style={{ whiteSpace: "normal", textAlign: "left" }}>
          {r.erro}
        </p>
      )}

      {perfil && (
        <form action={salvar} className="stack" style={{ gap: 12, marginTop: 12 }}>
          <div className="row wrap" style={{ gap: 14, alignItems: "flex-start" }}>
            <div>
              <p className="label" style={{ marginBottom: 6 }}>Foto atual</p>
              {perfil.profile_picture_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={perfil.profile_picture_url}
                  alt="Foto do perfil do número"
                  width={72}
                  height={72}
                  style={{ borderRadius: "50%", objectFit: "cover", border: "1px solid var(--border)" }}
                />
              ) : (
                /* ⚠ "SEM FOTO" APARECE ESCRITO. Espaço vazio se lê como
                   "ainda não carregou", e foi assim que o número ficou sem
                   logo até alguém receber uma mensagem e reparar. */
                <p className="badge badge-warn" style={{ whiteSpace: "normal", textAlign: "left" }}>
                  Sem foto nenhuma
                </p>
              )}
            </div>
            <div style={{ flex: "1 1 240px" }}>
              <label className="label" htmlFor="foto">Trocar a foto (JPG ou PNG, quadrada)</label>
              <input id="foto" name="foto" type="file" accept="image/jpeg,image/png" disabled={salvando} />
              <p className="text-faint" style={{ fontSize: 11, marginTop: 4, marginBottom: 0 }}>
                Use a logo da empresa. Ela aparece pequena e redonda — logo com muito texto
                vira borrão nesse tamanho.
              </p>
            </div>
          </div>

          <div>
            <label className="label" htmlFor="about">Recado do perfil</label>
            <input id="about" name="about" defaultValue={perfil.about ?? ""} disabled={salvando}
              placeholder="a frase curta embaixo do nome" />
          </div>

          <div>
            <label className="label" htmlFor="description">Descrição</label>
            <input id="description" name="description" defaultValue={perfil.description ?? ""} disabled={salvando}
              placeholder="o que a empresa é, em uma linha" />
          </div>

          <div className="row wrap" style={{ gap: 12 }}>
            <div style={{ flex: "1 1 240px" }}>
              <label className="label" htmlFor="address">Endereço</label>
              <input id="address" name="address" defaultValue={perfil.address ?? ""} disabled={salvando} />
            </div>
            <div style={{ flex: "1 1 180px" }}>
              <label className="label" htmlFor="email">E-mail</label>
              <input id="email" name="email" type="email" defaultValue={perfil.email ?? ""} disabled={salvando} />
            </div>
            <div style={{ flex: "1 1 180px" }}>
              <label className="label" htmlFor="site">Site</label>
              <input id="site" name="site" defaultValue={perfil.websites?.[0] ?? ""} disabled={salvando}
                placeholder="https://" />
            </div>
          </div>

          <button type="submit" className="btn btn-primary" disabled={salvando} style={{ alignSelf: "flex-start" }}>
            {salvando ? "salvando na Meta…" : "Salvar o perfil"}
          </button>

          {/* ⚠ CAMPO VAZIO NÃO APAGA. Mandar string vazia REMOVERIA o dado na
              Meta, e alguém que limpasse um campo sem querer apagaria o
              endereço da empresa sem perceber. */}
          <p className="text-faint" style={{ fontSize: 11, margin: 0 }}>
            Campo deixado em branco é ignorado — não apaga o que já está lá. O{" "}
            <strong>nome de exibição</strong> não muda por aqui: ele só muda na tela da
            Meta e passa por revisão deles.
          </p>
        </form>
      )}
    </div>
  );
}
