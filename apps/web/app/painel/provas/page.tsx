import { createClient } from "@/lib/supabase/server";
import { getActiveTenant } from "@/lib/auth";
import { Provas } from "./Provas";

// Tela que chama IA declara a duração. O padrão da Vercel mata a função no
// meio da geração e não devolve nada — o botão gira para sempre, sem erro.
export const maxDuration = 60;

/**
 * O BANCO DE PROVAS — a tela que produz o número da decisão.
 *
 * ⚠ POR QUE ELA EXISTE, com as palavras do fundador: *"deixar na mão dos
 * outros a validação das mensagens da IA é terceirizar um serviço sem
 * qualidade"*. Ele tem razão, e a consequência é maior que a frase — se a
 * equipe não corrige, a `0060` (aprendizado por correção) não capta nada, e a
 * decisão de ligar o automático continua sendo intuição contra intuição.
 *
 * A alternativa que ele propôs — mandar para dez conhecidos e pedir que
 * perguntassem — mede a coisa errada: amigo pergunta o que IMAGINA que um lead
 * pergunta, e não reconhece o erro caro, que é o plausível e errado. Aqui a
 * entrada é mensagem REAL que já está no banco, e o juiz é uma pessoa só.
 */
export default async function ProvasPage() {
  const membership = await getActiveTenant();
  const tenant = membership?.tenant;

  if (!tenant) {
    return (
      <main>
        <h1>Banco de provas</h1>
        <p className="text-dim">Sem empresa vinculada.</p>
      </main>
    );
  }

  if (!["owner", "admin"].includes(membership!.role)) {
    return (
      <main>
        <h1>Banco de provas</h1>
        {/* Campo ausente é indistinguível de campo que não foi feito: a tela
            diz por que está vazia em vez de sumir do menu. */}
        <p className="text-dim">
          Esta tela é de quem responde pela empresa. O julgamento aqui decide se a resposta
          automática pode existir — por isso ele não é distribuído.
        </p>
      </main>
    );
  }

  const supabase = await createClient();
  // paginacao-ok: julgamentos desta empresa, feitos à mão por uma pessoa. O
  // teto de 1.000 é maior que qualquer banco de provas que alguém consiga
  // julgar — e passar dele significa que a medição já respondeu de sobra.
  const { data } = await supabase
    .from("provas")
    .select("veredito, escalou")
    .eq("tenant_id", tenant.id)
    .limit(1000);

  const linhas = (data as { veredito: string; escalou: boolean }[] | null) ?? [];
  const placar = {
    enviaria: linhas.filter((l) => l.veredito === "enviaria").length,
    ajustaria: linhas.filter((l) => l.veredito === "ajustaria").length,
    erro_grave: linhas.filter((l) => l.veredito === "erro_grave").length,
    // ⚠ Descartadas ficam FORA do placar de propósito: são entradas que nunca
    // foram pergunta de cliente. Contá-las mediria a IA contra uma anotação da
    // equipe — e diluiria justamente o número que autoriza o automático.
    escalou: linhas.filter((l) => l.escalou && l.veredito !== "descartada").length,
    descartadas: linhas.filter((l) => l.veredito === "descartada").length,
  };

  return (
    <main style={{ maxWidth: 760 }}>
      <h1>Banco de provas</h1>
      <p className="text-dim" style={{ marginTop: 0 }}>
        Pega uma <strong>mensagem real</strong> que um cliente já mandou, roda o motor nela{" "}
        <strong>sem enviar nada</strong>, e pede seu veredito. Serve para uma pergunta só:{" "}
        <strong>a IA pode responder sozinha?</strong> — e para respondê-la com um número em
        vez de com opinião.
      </p>

      <Provas placar={placar} />
    </main>
  );
}
