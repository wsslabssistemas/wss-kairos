import Image from "next/image";
import Link from "next/link";
import { requireUser, getActiveTenant, listMemberships } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { isPlatformAdmin } from "@/lib/platform";
import { loadEntitlements, MODULES } from "@/lib/entitlements";
import { BRAND_NAME, MAKER } from "@/lib/brand";
import { carregarAparencia } from "@/lib/aparencia-db";
import { estadoDoTeste } from "@/lib/teste";
import { variaveisDaMarca } from "@/lib/aparencia";
import PainelNav from "./PainelNav";
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
  const nav = !membership?.tenant
    ? [{ href: "/painel/nova-empresa", label: "Criar minha empresa" }]
    : [
    { href: "/painel", label: "Início" },
    { href: "/painel/responder", label: "Responder" },
    { href: "/painel/contatos", label: "Contatos" },
    // A FILA vem antes do Follow-up: ela junta os quatro motivos numa lista
    // só e já traz a mensagem pronta. O Follow-up continua, porque é a visão
    // por cadência — quem quer entender a régua vai lá.
    { href: "/painel/fila", label: "Fila de envio" },
    { href: "/painel/followup", label: "Follow-up" },
    { href: "/painel/funil", label: "Funil" },
    { href: "/painel/agenda", label: "Agenda" },
    ...moduleNav,
    ...(temCatalogo ? [{ href: "/painel/catalogo", label: "Catálogo" }] : []),
    ...(showManager ? [{ href: "/painel/gestao", label: "Gestão" }] : []),
    { href: "/painel/equipe", label: "Equipe" },
    { href: "/painel/dna", label: "DNA" },
    { href: "/painel/automacao", label: "Automação" },
    // COLADA na Automação de propósito: é ali que o canal é ligado, e é aqui
    // que se vê se ele está entregando. Configurar e conferir o resultado são
    // a mesma tarefa em dois momentos.
    { href: "/painel/conversas", label: "Canal oficial" },
    // Colada no Canal oficial: as duas respondem "o sistema está indo bem?",
    // uma pela entrega e a outra pela qualidade do texto.
    ...(showManager ? [{ href: "/painel/correcoes", label: "O que a IA aprendeu" }] : []),
    // ⚠ COLADA NAS DUAS ACIMA, e ela responde a pergunta que as outras nao
    // respondem: "a IA pode responder SOZINHA?". "O que a IA aprendeu" depende
    // de alguem corrigir; o banco de provas nao depende de ninguem alem de
    // quem julga — e foi feito justamente porque a correcao do vendedor pode
    // nunca chegar.
    ...(showManager ? [{ href: "/painel/provas", label: "Banco de provas" }] : []),
    { href: "/painel/tutorial", label: "Tutorial" },
    ...(showManager ? [{ href: "/painel/sincronizar", label: "Sincronizar" }] : []),
    // Fica COLADA na Sincronizar de propósito: é ali que as contradições
    // nascem e é ali que o gestor está quando pensa em dado de origem.
    ...(showManager ? [{ href: "/painel/contradicoes", label: "Conferir" }] : []),
    ...(showManager ? [{ href: "/painel/aparencia", label: "Aparência" }] : []),
    ...(showAdmin ? [{ href: "/painel/admin", label: "Fabricante" }] : []),
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
        <PainelNav items={nav} />
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
      <div className="container" style={{ padding: "28px 1.25rem 64px" }}>
        {children}
      </div>

      {/* O RODAPÉ NÃO É PERSONALIZÁVEL, e é decisão. Marca branca completa
          esconderia o fabricante — e o fabricante é quem responde pela LGPD,
          por quem vê o dado e por quem conserta quando quebra. Esconder isso
          não é personalização: é confundir o cliente do cliente sobre com quem
          ele está falando. */}
      <footer className="container" style={{ padding: "0 1.25rem 32px", fontSize: 12, opacity: 0.5 }}>
        {BRAND_NAME} — feito por <Link href="/painel/sobre">{MAKER}</Link>
      </footer>
    </div>
  );
}
