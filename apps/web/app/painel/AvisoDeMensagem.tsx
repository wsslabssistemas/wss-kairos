"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { ultimaEntradaDoCanal } from "./avisos-actions";

/**
 * O AVISO DE MENSAGEM NOVA — em qualquer tela, sem atrapalhar.
 *
 * ⚠ POR QUE ELE EXISTE. O fundador respondeu a primeira conversa real e
 * perguntou: *"podia aparecer um pop-up de mensagem nova, assim, sendo em
 * qualquer tela, o funcionário já é notificado"*. Ele está certo, e o motivo é
 * medido: o estudo do MIT mede 21x de queda entre responder em 5 e em 30
 * minutos. Hoje a única forma de saber que alguém escreveu é lembrar de abrir
 * a aba — e o que depende de alguém lembrar não acontece à noite nem no
 * sábado.
 *
 * ⚠ A REGRA QUE ELE MESMO DITOU: **não pode atrapalhar quem está mexendo.**
 * Por isso, e isto é o desenho inteiro:
 *
 *   1. O aviso NUNCA navega sozinho. Ele aparece num canto, com um link. Quem
 *      decide se vai é a pessoa.
 *   2. A página só se atualiza sozinha **no Canal oficial** — a única tela em
 *      que dado velho engana — e mesmo lá, só quando ninguém está digitando.
 *   3. `document.body.dataset.ocupado` é o freio de mão: quem está gerando ou
 *      enviando marca o corpo da página, e o relógio não encosta.
 *
 * Recarregar uma tela enquanto alguém preenche um cadastro apaga o trabalho
 * dela — e seria a segunda vez que este produto faz alguém perder o que
 * escreveu. Uma bastou.
 */
export function AvisoDeMensagem() {
  const [nova, setNova] = useState<{ nome: string; contactId: string | null } | null>(null);
  const visto = useRef<string | null>(null);
  const iniciado = useRef(false);
  const router = useRouter();
  const pathname = usePathname();
  const noCanal = pathname?.startsWith("/painel/conversas") ?? false;

  useEffect(() => {
    let vivo = true;

    const olhar = async () => {
      try {
        const r = await ultimaEntradaDoCanal();
        if (!vivo || !r.ok || !r.quando) return;

        // ⚠ A PRIMEIRA LEITURA SÓ MARCA O PONTO DE PARTIDA. Sem isto, abrir o
        // sistema de manhã dispararia o aviso da mensagem de ontem — e aviso
        // que grita sobre coisa velha é o que ensina a ignorar o aviso.
        if (!iniciado.current) {
          iniciado.current = true;
          visto.current = r.quando;
          return;
        }

        if (visto.current && r.quando > visto.current) {
          visto.current = r.quando;
          setNova({ nome: r.nome, contactId: r.contactId });

          // A tela do canal se atualiza sozinha — mas só se ninguém estiver
          // escrevendo nem gerando nada.
          const escrevendo = ["INPUT", "TEXTAREA", "SELECT"].includes(
            document.activeElement?.tagName ?? "",
          );
          const ocupado = document.body.dataset.ocupado === "1";
          if (noCanal && !escrevendo && !ocupado) router.refresh();
        }
      } catch {
        // Silêncio de propósito: um aviso que falha não pode virar erro na
        // tela de quem está no meio de outra coisa.
      }
    };

    olhar();
    const t = setInterval(olhar, 30_000);
    return () => {
      vivo = false;
      clearInterval(t);
    };
  }, [noCanal, router]);

  if (!nova) return null;

  return (
    <div
      role="status"
      style={{
        position: "fixed",
        right: 16,
        bottom: 16,
        zIndex: 50,
        maxWidth: 320,
        padding: "12px 14px",
        borderRadius: 10,
        border: "1px solid var(--border-brand)",
        background: "var(--bg-elev)",
        boxShadow: "0 10px 30px rgba(0,0,0,0.25)",
      }}
    >
      <p style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>
        💬 {nova.nome} respondeu
      </p>
      <p className="text-dim" style={{ margin: "4px 0 10px", fontSize: 13 }}>
        Chegou agora pelo número da empresa.
      </p>
      <div className="row" style={{ gap: 8 }}>
        <a
          className="btn btn-sm btn-primary"
          href={nova.contactId ? `/painel/conversas?contato=${nova.contactId}` : "/painel/conversas"}
        >
          Abrir a conversa
        </a>
        <button type="button" className="btn btn-sm btn-ghost" onClick={() => setNova(null)}>
          depois
        </button>
      </div>
    </div>
  );
}
