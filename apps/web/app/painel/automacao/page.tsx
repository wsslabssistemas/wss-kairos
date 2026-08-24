import { createClient } from "@/lib/supabase/server";
import { getActiveTenant } from "@/lib/auth";
import { readAutomation, MODE_LABEL, MODE_HINT, type AutomationMode } from "@/lib/automation";
import { saveAutomation } from "./actions";
import { statusDoCanal } from "@/lib/credenciais";
import { origemDoSite } from "@/lib/site";
import { Canal } from "./Canal";
import { Guia } from "./Guia";
import { Roteamento } from "./Roteamento";
import { Simulacao } from "./Simulacao";
import { DisparoDeTeste } from "./DisparoDeTeste";
import { lerRoteamento, lerModelos } from "@/lib/roteamento";
import { lerTetoDeMensagens } from "@/lib/custo_mensagem";

// Chamada de rede para a Meta no teste de conexao. Ver a nota em
// `fila/page.tsx`: tela que fala com servico externo declara o tempo.
export const maxDuration = 60;

const FIELDS: { key: keyof ReturnType<typeof readAutomation>; label: string; hint: string; min: number; max: number }[] = [
  { key: "max_per_day", label: "Máx. de mensagens por dia", hint: "Limite total gerado pela automação em 24h", min: 0, max: 1000 },
  { key: "min_hours_between", label: "Horas mín. entre contatos", hint: "Espera mínima desde o último contato (sem resposta)", min: 0, max: 720 },
  { key: "max_no_reply", label: "Máx. de não-respostas", hint: "Após N mensagens sem resposta, para de incomodar", min: 0, max: 50 },
  { key: "cooldown_hours", label: "Cooldown após resposta (h)", hint: "Espera após o cliente responder/engajar", min: 0, max: 720 },
  { key: "window_start", label: "Início da janela (h)", hint: "Horário a partir do qual a automação opera", min: 0, max: 23 },
  { key: "window_end", label: "Fim da janela (h)", hint: "Horário em que a automação para", min: 0, max: 23 },
  { key: "stop_after_days", label: "Parar de incomodar (dias)", hint: "Sem engajamento por N dias → bloqueia", min: 0, max: 365 },
  // ⚠ O RECORTE DA CAMPANHA. Ele é o único campo aqui que escolhe QUEM, e não
  // quanto nem quando: o `máx. por dia` fatia o acervo em semanas, mas manda
  // para todo mundo do mesmo jeito. Ver `lib/automation.ts`.
  { key: "reativacao_max_dias", label: "Reativação: só quem saiu nos últimos (dias)", hint: "Recorte da campanha de retorno. 0 = a base inteira, do mais antigo ao mais novo", min: 0, max: 3650 },
  { key: "monthly_budget_credits", label: "Orçamento mensal (créditos)", hint: "0 = sem limite. Ao atingir, suspende até a virada do mês", min: 0, max: 100000000 },
];

export default async function AutomacaoPage({
  searchParams,
}: {
  searchParams: Promise<{ salvo?: string; erro?: string; canal?: string }>;
}) {
  const { salvo, erro, canal } = await searchParams;
  const membership = await getActiveTenant();
  const tenant = membership?.tenant;
  if (!tenant) {
    return (
      <main>
        <h1>Automação</h1>
        <p className="text-dim">Sem empresa vinculada.</p>
      </main>
    );
  }

  const supabase = await createClient();
  const { data } = await supabase.from("tenants").select("settings").eq("id", tenant.id).maybeSingle();
  const a = readAutomation(data?.settings);
  const canEdit = ["owner", "admin"].includes(membership!.role);
  const status = await statusDoCanal(tenant.id);

  const banner: Record<AutomationMode, { cls: string; txt: string }> = {
    off: { cls: "badge", txt: "A automação está desligada — nenhuma mensagem é gerada ou enviada." },
    simulation: { cls: "badge badge-warn", txt: "Modo simulação — mensagens são geradas e contadas, mas não enviadas." },
    auto: { cls: "badge badge-success", txt: "Modo automático — mensagens geradas e enviadas dentro das regras." },
  };

  return (
    <main style={{ maxWidth: 820 }}>
      <h1>Automação</h1>
      <p className="text-dim" style={{ marginTop: 4 }}>
        Controle da versão automática: modo de operação, regras anti-bloqueio e teto
        de orçamento. O manual continua disponível o tempo todo.
      </p>

      <div className="card mt-16 row" style={{ gap: 12 }}>
        <span className={banner[a.mode].cls}>Modo atual: {MODE_LABEL[a.mode]}</span>
        <span className="text-dim" style={{ fontSize: 14 }}>{banner[a.mode].txt}</span>
      </div>

      {salvo && <p className="badge badge-success mt-16">Regras salvas.</p>}
      {canal === "salvo" && <p className="badge badge-success mt-16">Credencial do canal salva. Teste antes de usar com cliente.</p>}
      {canal === "desligado" && <p className="badge mt-16">Canal desligado — o envio voltou para o link humano.</p>}
      {erro && <p className="badge badge-danger mt-16">{erro}</p>}

      <form action={saveAutomation} className="card mt-24">
        <p className="eyebrow">Modo de operação</p>
        <div className="seg mt-8" role="radiogroup" aria-label="Modo de operação">
          {(["off", "simulation", "auto"] as AutomationMode[]).map((m) => (
            <label key={m}>
              <input type="radio" name="mode" value={m} defaultChecked={a.mode === m} disabled={!canEdit} />
              {MODE_LABEL[m]}
            </label>
          ))}
        </div>
        <p className="text-faint mt-8" style={{ fontSize: 13 }}>{MODE_HINT[a.mode]}</p>

        <hr className="divider" />
        <p className="eyebrow" style={{ marginBottom: 14 }}>Regras anti-bloqueio</p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 16 }}>
          {FIELDS.map((f) => (
            <div key={f.key}>
              <label className="label" htmlFor={f.key}>{f.label}</label>
              <input
                id={f.key}
                name={f.key}
                type="number"
                min={f.min}
                max={f.max}
                defaultValue={a[f.key]}
                disabled={!canEdit}
              />
              <p className="text-faint" style={{ fontSize: 12, marginTop: 4 }}>{f.hint}</p>
            </div>
          ))}
        </div>

        {canEdit ? (
          <button type="submit" className="btn btn-primary mt-24">Salvar regras</button>
        ) : (
          <p className="text-faint mt-16" style={{ fontSize: 13 }}>
            Só quem é dono ou admin da empresa pode alterar estas regras.
          </p>
        )}
      </form>

      {/* O QUE FALTA PARA LIGAR, EM PORTUGUÊS.
          Antes esta tela dizia só "quando estiver ligado" — e não dizia o que
          é preciso para ligar, quem faz cada parte, nem quanto custa. Painel
          que promete um botão sem dizer o caminho até ele vira promessa. */}
      <div className="card mt-24" style={{ borderColor: "var(--border-brand)" }}>
        <p className="eyebrow" style={{ marginBottom: 8 }}>Como funciona HOJE, sem automação</p>
        <p style={{ marginTop: 0, fontSize: 14 }}>
          O sistema já decide <strong>quem</strong> procurar e escreve <strong>o que</strong>{" "}
          dizer — é a <a href="/painel/fila">Fila de envio</a>. O que ele não faz é
          apertar o botão: você lê, ajusta e envia pelo WhatsApp com um clique.
        </p>
        <p className="text-dim" style={{ marginBottom: 0, fontSize: 14 }}>
          <strong>Isso não é uma limitação temporária.</strong> Envio automático exige a
          API oficial da Meta; qualquer atalho por provedor não oficial arrisca{" "}
          <strong>banir o número da sua empresa</strong>, e o número é o ativo. Por isso
          a fila existe: entrega quase tudo da automação sem esse risco.
        </p>
      </div>

      <div className="card mt-16">
        <p className="eyebrow" style={{ marginBottom: 8 }}>O que é preciso para ligar o envio automático</p>
        <ol className="text-dim" style={{ margin: 0, paddingLeft: 20, fontSize: 14, lineHeight: 1.9 }}>
          <li>
            <strong>Conta Meta Business</strong> (business.facebook.com). Não precisa de
            página do Facebook com conteúdo, mas precisa do portfólio de negócios. Se você
            já tem Instagram profissional, provavelmente ele já existe.
          </li>
          <li>
            <strong>Verificação da empresa</strong> na Meta — CNPJ, comprovante de endereço
            e, às vezes, telefone fixo. É a etapa mais demorada: costuma levar dias.
          </li>
          <li>
            <strong>Um número dedicado</strong> ao WhatsApp Business API. Ele{" "}
            <strong>não pode</strong> estar em uso no WhatsApp comum — e migrar um número
            que já tem conversas é caminho sem volta.
          </li>
          <li>
            <strong>Modelos de mensagem aprovados</strong> pela Meta para falar com quem
            não escreveu nas últimas 24 horas. Cada modelo passa por revisão.
          </li>
          <li>
            <strong>Credenciais</strong>: ID da conta WhatsApp Business, ID do número e um
            token permanente. É isso que a WSS Labs cadastra para a sua empresa.
          </li>
        </ol>
        <p className="text-faint" style={{ fontSize: 13, marginTop: 12, marginBottom: 0 }}>
          <strong>As credenciais não são digitadas aqui, e isso é decisão de segurança.</strong>{" "}
          Token da Meta em campo de tela fica salvo no banco e visível para quem tem acesso
          ao painel; o lugar certo dele é o cofre de variáveis do servidor. Quando você tiver
          os três dados acima, mande para a WSS Labs — o cadastro é feito uma vez e não
          aparece em tela nenhuma.
        </p>
      </div>

      <div className="card mt-16">
        <p className="eyebrow" style={{ marginBottom: 8 }}>Custo, para decidir com número</p>
        <p className="text-dim" style={{ marginTop: 0, marginBottom: 0, fontSize: 14 }}>
          A Meta cobra <strong>por conversa iniciada</strong> pela empresa, não por mensagem,
          e o valor muda por país e por categoria (utilidade, marketing, serviço). Conversa
          iniciada pelo cliente costuma ser gratuita numa janela de 24 horas. Some isso ao
          custo de IA por resposta, que o seu painel já mede em{" "}
          <a href="/painel/admin/cotas">Cota de IA</a> — o teto de gasto continua valendo
          igual com a automação ligada.
        </p>
      </div>

      {canEdit && (
        <Canal
          configurado={status.configurado}
          phoneId={status.phoneId}
          temVerifyToken={status.temVerifyToken}
          temAppSecret={status.temAppSecret}
          atualizadoEm={status.atualizadoEm}
          urlDoWebhook={`${await origemDoSite()}/api/whatsapp/webhook`}
        />
      )}

      {canEdit && (
        <Roteamento
          roteamento={lerRoteamento(data?.settings)}
          modelos={lerModelos(data?.settings)}
          temCredencial={status.configurado}
          tetoCents={lerTetoDeMensagens(data?.settings)}
        />
      )}

      {canEdit && <Simulacao modo={a.mode} />}

      {/* COLADO NA SIMULAÇÃO de propósito: uma mostra quem sairia sem mandar
          nada, o outro manda de verdade para um número escolhido. As duas
          perguntas que alguém faz antes de virar a chave, na ordem em que as
          faz. */}
      {canEdit && <DisparoDeTeste />}

      <div className="card mt-16">
        <p className="eyebrow" style={{ marginBottom: 8 }}>Histórico de execuções</p>
        <p className="text-dim" style={{ margin: 0, fontSize: 14 }}>
          Cada execução (mensagens geradas, bloqueadas, tokens e créditos) aparece aqui
          quando o envio automático estiver ligado. Enquanto não estiver, o modo fica em{" "}
          <strong>Desligado</strong> — e as regras acima já ficam guardadas e valem no dia
          em que ligar.
        </p>
      </div>

    </main>
  );
}
