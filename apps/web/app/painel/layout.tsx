import Image from "next/image";
import { AvisoDeMensagem } from "./AvisoDeMensagem";
import Link from "next/link";
import { requireUser, getActiveTenant, listMemberships } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { isPlatformAdmin } from "@/lib/platform";
import { loadEntitlements, MODULES } from "@/lib/entitlements";
import { BRAND_NAME, MAKER } from "@/lib/brand";
import { carregarAparencia } from "@/lib/aparencia-db";
import { estadoDoTeste } from "@/lib/teste";
import { variaveisDaMarca } from "@/lib/aparencia";
import PainelNav, { type Grupo } from "./PainelNav";
import TenantSwitcher from "./TenantSwitcher";
import { signOut } from "./actions";

export default async function PainelLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireUser();
  const [membership, empresas] = await Promise.all([getActiveTenant(), listMemberships()]);
  const showAdmin = isPlatformAdmin(user.email);
  const showManager = ["owner", "admin", "manager"].includes(membership?.role ?? "");

  // Módulos liberados por empresa/segmento (add-ons). Só aparecem se aplicáveis
  // ao segmento e (em teste OU comprados) — evita painel poluído.
  const ent = membership?.tenant
    ? await loadEntitlements(membership.tenant.id, membership.tenant.skill_key)
    : null;

  // APARÊNCIA DA EMPRESA. Num produto multi-empresa, o vendedor ver a marca da
  // PRÓPRIA casa muda a percepção de "sistema de terceiro que me obrigaram a
  // usar" para "nosso sistema" — e adoção em PME morre por essa distância, não
  // por falta de recurso.
  const aparencia = membership?.tenant ? await carregarAparencia(membership.tenant.id) : { cor: null, logoUrl: null };
  const marca = variaveisDaMarca(aparencia) as React.CSSProperties;
  // O estado do teste vem da data crua, nao do booleano `trialActive`: e a
  // data que diz se falta uma semana, um dia, ou se ja acabou.
  const teste = estadoDoTeste(ent?.trialEndsAt ?? null);
  const moduleNav = (ent?.unlocked ?? []).map((m) => ({ href: MODULES[m].href, label: MODULES[m].label }));

  /**
   * ⚠ O CATÁLOGO SÓ APARECE PARA QUEM USA CATÁLOGO.
   *
   * Pedido do fundador: *"a Be Fitness não precisa dela, então retira — já tem
   * muitas abas."* Ele está certo, e a regra generaliza: uma academia vende
   * plano, não produto com preço e estoque. Distribuidora e oficina vendem.
   *
   * A condição é a mais honesta possível — **tem item cadastrado?** Aba que
   * responde uma tela vazia é pior que aba ausente: ela ocupa espaço na
   * navegação, ensina que o produto tem coisas que não servem, e some da
   * atenção junto com as que servem.
   *
   * E ela se acende sozinha: no dia em que a empresa importar um catálogo, a
   * aba volta. O caminho para o primeiro item continua existindo em
   * `/painel/catalogo`, e é para lá que o Responder manda quem esbarra na
   * trava de preço — o motor recusa falar de valor que não está no catálogo, e
   * a mensagem de recusa diz onde cadastrar.
   *
   * `head: true` não traz linha nenhuma: é uma contagem, no caminho mais
   * quente do sistema (toda página do painel passa por aqui).
   */
  let temCatalogo = false;
  if (membership?.tenant) {
    const supabase = await createClient();
    // paginacao-ok: só o número, sem trazer linha — e o teto de 1.000 do
    // PostgREST não alcança `count`.
    const { count } = await supabase
      .from("catalog_items")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", membership.tenant.id);
    temCatalogo = (count ?? 0) > 0;
  }

  // SEM EMPRESA, A NAVEGACAO E UMA SO. Mostrar Responder, Contatos, Funil e
  // Agenda para quem ainda nao criou empresa oferece dez portas que respondem
  // todas "sem empresa vinculada" — e faz a pessoa procurar o defeito em vez
  // de fazer a unica coisa que falta.
  /**
   * ⚠ AGRUPADO POR TRABALHO, NÃO POR TELA. Eram vinte itens numa linha
   * horizontal que rolava para o lado — a pessoa procurava "Sincronizar" numa
   * lista que não cabia. A pesquisa é clara: barra superior serve para 3 a 6
   * áreas; a partir de dez, lateral agrupada, com 20–30% menos tempo para
   * achar (rastreamento ocular).
   *
   * ⚠ E A ORDEM DOS GRUPOS É A DO DIA DE TRABALHO. O fundador disse que os
   * vendedores usam **estritamente a Fila de envio** — ela é o segundo item da
   * tela inteira, e nada de gestão aparece antes. Agrupar por semelhança
   * técnica devolveria a mesma lista de vinte, só que com títulos.
   */
  const grupos: Grupo[] = !membership?.tenant
    ? [{ titulo: null, itens: [{ href: "/painel/nova-empresa", label: "Criar minha empresa" }] }]
    : [
        { titulo: null, itens: [{ href: "/painel", label: "Início" }] },
        {
          titulo: "Atender",
          itens: [
            { href: "/painel/fila", label: "Fila de envio" },
            { href: "/painel/responder", label: "Responder" },
            { href: "/painel/conversas", label: "Canal oficial" },
            { href: "/painel/agenda", label: "Agenda" },
          ],
        },
        {
          titulo: "Clientes",
          itens: [
            { href: "/painel/contatos", label: "Contatos" },
            { href: "/painel/funil", label: "Funil" },
            { href: "/painel/followup", label: "Follow-up" },
            ...(temCatalogo ? [{ href: "/painel/catalogo", label: "Catálogo" }] : []),
            ...moduleNav,
          ],
        },
        ...(showManager
          ? [{
              titulo: "Inteligência",
              itens: [
                { href: "/painel/gestao", label: "Gestão" },
                { href: "/painel/correcoes", label: "O que a IA aprendeu" },
                { href: "/painel/provas", label: "Banco de provas" },
              ],
            }]
          : []),
        {
          titulo: "Configurar",
          itens: [
            { href: "/painel/dna", label: "DNA" },
            { href: "/painel/automacao", label: "Automação" },
            { href: "/painel/equipe", label: "Equipe" },
            ...(showManager ? [{ href: "/painel/sincronizar", label: "Sincronizar" }] : []),
            ...(showManager ? [{ href: "/painel/contradicoes", label: "Conferir" }] : []),
            ...(showManager ? [{ href: "/painel/aparencia", label: "Aparência" }] : []),
          ],
        },
        {
          titulo: "Aprender",
          itens: [
            { href: "/painel/curso", label: "Curso" },
            { href: "/painel/tutorial", label: "Tutorial" },
          ],
        },
        ...(showAdmin
          ? [{ titulo: "Fabricante", itens: [{ href: "/painel/admin", label: "Fabricante" }] }]
          : []),
      ];

  return (
    <div style={marca}>
      <header className="appbar">
        <Link href="/painel" className="brand-lockup">
          {aparencia.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={aparencia.logoUrl} alt="" height={30} style={{ height: 30, width: "auto", maxWidth: 120, objectFit: "contain" }} />
          ) : (
            <Image src="/icons/icon-192.png" alt="" width={30} height={30} priority />
          )}
          <span>{membership?.tenant?.name ?? BRAND_NAME}</span>
        </Link>
        <div className="row" style={{ marginLeft: "auto", gap: 14 }}>
          <TenantSwitcher
            empresas={empresas.map((m) => ({ id: m.tenant!.id, name: m.tenant!.name }))}
            atual={membership?.tenant?.id ?? ""}
          />
          <form action={signOut}>
            <button type="submit" className="linklike" style={{ fontSize: 13 }}>
              Sair
            </button>
          </form>
        </div>
      </header>
      {/* O AVISO DO TESTE. Antes ele so dizia "X dias restantes" e SUMIA quando
          o teste acabava — a pessoa perdia a IA sem nenhuma tela explicando, e
          quem nao entende que perdeu nao negocia: some. Agora ele tem tres
          estados, e o do fim e o mais importante dos tres. */}
      {teste.fase === "tranquilo" && (
        <div style={{ background: "var(--brand-gradient-soft)", borderBottom: "1px solid var(--border-brand)", textAlign: "center", fontSize: 13, padding: "7px 12px" }}>
          Teste grátis · <strong>{teste.diasRestantes} dia{teste.diasRestantes === 1 ? "" : "s"}</strong> restante{teste.diasRestantes === 1 ? "" : "s"} — todos os recursos liberados.
        </div>
      )}
      {teste.fase === "avisando" && (
        <div style={{
          background: teste.urgente ? "var(--danger-soft, rgba(220,60,60,.12))" : "var(--warn-soft, rgba(220,160,40,.12))",
          borderBottom: `1px solid ${teste.urgente ? "var(--danger)" : "var(--warn)"}`,
          textAlign: "center", fontSize: 13, padding: "8px 12px",
        }}>
          {teste.texto}{" "}
          <Link href="/painel/contratar" style={{ fontWeight: 600 }}>Ver planos →</Link>
        </div>
      )}
      {teste.fase === "encerrado" && (
        <div style={{
          background: "var(--danger-soft, rgba(220,60,60,.12))",
          borderBottom: "1px solid var(--danger)",
          textAlign: "center", fontSize: 13, padding: "8px 12px",
        }}>
          {teste.texto}{" "}
          <Link href="/painel/contratar" style={{ fontWeight: 600 }}>Contratar →</Link>
        </div>
      )}
      {/* ⚠ A LATERAL E O CONTEÚDO SÃO IRMÃOS, não pai e filho. A barra precisa
          grudar na altura da tela enquanto o conteúdo rola; aninhá-la dentro do
          container faria ela rolar junto e sumir na primeira tela longa — que é
          exatamente o que a lateral existe para evitar. */}
      <div className="painel-corpo">
        <PainelNav grupos={grupos} />
        <div className="container" style={{ padding: "28px 1.25rem 64px" }}>
          {children}
        </div>
      </div>

      {/* O RODAPÉ NÃO É PERSONALIZÁVEL, e é decisão. Marca branca completa
          esconderia o fabricante — e o fabricante é quem responde pela LGPD,
          por quem vê o dado e por quem conserta quando quebra. Esconder isso
          não é personalização: é confundir o cliente do cliente sobre com quem
          ele está falando. */}
      {/* ⚠ NO LAYOUT, e não numa tela: quem está no Funil também precisa saber
          que alguém respondeu. Ele nunca navega sozinho — só aparece num canto
          com um link, porque recarregar a tela de quem está preenchendo um
          cadastro apaga o trabalho dela. */}
      <AvisoDeMensagem />

      <footer className="container" style={{ padding: "0 1.25rem 32px", fontSize: 12, opacity: 0.5 }}>
        {BRAND_NAME} — feito por <Link href="/painel/sobre">{MAKER}</Link>
      </footer>
    </div>
  );
}
