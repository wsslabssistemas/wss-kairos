"use client";

import { useState } from "react";
import { carregarPerfil, salvarPerfil, type PerfilResult } from "./perfil-actions";
import { lerQualidade } from "@/lib/saude-canal";

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
  /**
   * ⚠ O CONTADOR É EM BYTES, e a diferença não é detalhe técnico.
   *
   * A tela da própria Meta conta LETRAS: mostrou 492/512 e recusou a gravação,
   * porque a régua dela é o byte. Em português cada acento ocupa 2 — "é", "ç",
   * "ã" — então uma descrição de 492 letras passa de 520 bytes.
   *
   * Contador que diz "está dentro" e servidor que recusa é a pior combinação
   * possível: a pessoa apaga texto no escuro sem nunca saber quanto falta.
   */
  const bytes = (t: string) => new TextEncoder().encode(t).length;
  const [tamAbout, setTamAbout] = useState(0);
  const [tamDesc, setTamDesc] = useState(0);

  const perfil = r?.ok ? r.perfil : null;
  const estado = r?.ok ? r.estado : null;

  /**
   * ⚠ A QUALIDADE TRADUZIDA, e com o QUE FAZER junto.
   *
   * "GREEN" não diz nada para quem opera uma academia, e "qualidade média"
   * sozinho também não: a pessoa precisa saber se manda o próximo lote hoje ou
   * não. O número que governa a decisão mais cara da operação tem que vir com
   * a decisão escrita ao lado.
   */
  // A tradução mora em `lib/saude-canal.ts`: o Canal oficial usa a mesma.
  const q = lerQualidade(estado?.quality_rating);

  const abrir = async () => {
    setCarregando(true);
    try {
      const carregado = await carregarPerfil();
      setR(carregado);
      if (carregado.ok) {
        setTamAbout(bytes(carregado.perfil.about ?? ""));
        setTamDesc(bytes(carregado.perfil.description ?? ""));
      }
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

      {/* ⚠ O ESTADO DO NÚMERO VEM ANTES DO FORMULÁRIO. É o que decide se o
          próximo lote sai — e estava atrás de uma tela da Meta que respondeu
          "You don't have access" para o dono do próprio número. */}
      {estado && (
        <div
          className="mt-16"
          style={{ padding: "12px 14px", borderRadius: 8, background: "var(--bg-elev)" }}
        >
          <div className="row wrap" style={{ gap: 10, alignItems: "baseline" }}>
            <span className={q.cls}>Qualidade: {q.txt}</span>
            {estado.messaging_limit_tier && (
              <span className="badge">
                Degrau: {estado.messaging_limit_tier.replace("TIER_", "").replace("_", " ")}
              </span>
            )}
            {estado.display_phone_number && (
              <span className="text-faint" style={{ fontSize: 13 }}>{estado.display_phone_number}</span>
            )}
          </div>
          <p className="text-dim" style={{ fontSize: 13, margin: "8px 0 0" }}>{q.oque}</p>

          {/* O nome que a pessoa lê antes de decidir se abre. Ver na tela do
              produto o que o cliente vê é diferente de acreditar que está certo. */}
          {estado.verified_name && (
            <p className="text-dim" style={{ fontSize: 13, margin: "8px 0 0" }}>
              Aparece para quem recebe como <strong>&ldquo;{estado.verified_name}&rdquo;</strong>
              {estado.name_status && estado.name_status !== "APPROVED" && (
                <> — situação do nome: <strong>{estado.name_status}</strong></>
              )}
              .
            </p>
          )}
        </div>
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

          {/* ⚠ OS LIMITES DA META SÃO IMPOSTOS AQUI, com o contador à vista.
              Na tela da própria Meta o fundador ficou preso em "Não foi
              possível salvar as mudanças" com a descrição em 512/512 — o
              limite exato. Campo cheio até a borda falha na gravação, e a
              mensagem de erro não diz qual campo é.
              Cortar antes é melhor que descobrir depois. */}
          <div>
            <label className="label" htmlFor="about">Recado do perfil</label>
            <input id="about" name="about" defaultValue={perfil.about ?? ""} disabled={salvando}
              onChange={(e) => setTamAbout(bytes(e.target.value))}
              placeholder="a frase curta embaixo do nome" />
            <p className={tamAbout > 139 ? "badge badge-danger" : "text-faint"}
               style={{ fontSize: 11, marginTop: 4, marginBottom: 0, whiteSpace: "normal", textAlign: "left" }}>
              {tamAbout}/139
            </p>
          </div>

          <div>
            <label className="label" htmlFor="description">Descrição</label>
            <textarea id="description" name="description" defaultValue={perfil.description ?? ""}
              disabled={salvando} rows={5}
              onChange={(e) => setTamDesc(bytes(e.target.value))}
              style={{ width: "100%" }}
              placeholder="o que a empresa é, em poucas linhas" />
            <p className={tamDesc > 512 ? "badge badge-danger" : tamDesc > 480 ? "badge badge-warn" : "text-faint"}
               style={{ fontSize: 11, marginTop: 4, marginBottom: 0, whiteSpace: "normal", textAlign: "left" }}>
              {tamDesc}/512 <strong>bytes</strong>
              {tamDesc > 512
                ? " — passou. A Meta conta BYTES, e cada acento vale 2: o contador dela mostra menos que isso e recusa a gravação assim mesmo."
                : tamDesc > 480
                  ? " — perto do limite. A conta é em bytes: cada acento vale 2."
                  : ""}
            </p>
          </div>

          <div className="row wrap" style={{ gap: 12 }}>
            <div style={{ flex: "1 1 240px" }}>
              <label className="label" htmlFor="address">Endereço</label>
              <input id="address" name="address" defaultValue={perfil.address ?? ""} disabled={salvando} maxLength={256} />
            </div>
            <div style={{ flex: "1 1 180px" }}>
              <label className="label" htmlFor="email">E-mail</label>
              <input id="email" name="email" type="email" defaultValue={perfil.email ?? ""} disabled={salvando} maxLength={128} />
            </div>
            <div style={{ flex: "1 1 180px" }}>
              <label className="label" htmlFor="site">Site</label>
              <input id="site" name="site" defaultValue={perfil.websites?.[0] ?? ""} disabled={salvando}
                maxLength={256} placeholder="https://" />
            </div>
          </div>

          <button type="submit" className="btn btn-primary"
            disabled={salvando || tamDesc > 512 || tamAbout > 139}
            style={{ alignSelf: "flex-start" }}>
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
