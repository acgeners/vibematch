import Link from "next/link"
import { ChevronRight, Wrench } from "lucide-react"
import { ACCENT_STYLES } from "@/components/console/console-registry"
import type { ConsoleAccent } from "@/components/console/console-registry"
import { formatUsd } from "@/lib/format/money"
import { SETTINGS_GROUPS, findSection, groupIdOfSection } from "@/app/settings/sections"
import { getCuradoriaBadgeUnreadCount } from "@/server/queries/ai-eval-read"
import { getSettingsItemUnread } from "@/server/queries/settings-read"
import { getAiUsageTotals, getAnthropicBalanceStatus } from "@/server/queries/ai-usage"
import { countOpenCurationRequests } from "@/server/queries/curation-requests"
import { getRecalcPendingState } from "@/server/recalc/queue"
import { getComixStatus } from "@/lib/external/comix-gate"
import { balanceTone } from "@/lib/ai-usage/balance"
import { DECISION_QUEUES } from "@/lib/curadoria/decision-queues"
import type { DecisionQueueKey } from "@/lib/curadoria/decision-queues"
import { cn } from "@/lib/utils"

export const metadata = { title: "Curadoria do catálogo — SatorIA" }

/**
 * A raiz da console — o estado do catálogo COMPARTILHADO.
 *
 * Nada aqui é per-usuário, de propósito: é o que separa esta página do `/painel`
 * (a sua biblioteca) e da home (o que você lê agora). A pergunta que ela responde é
 * "o que precisa da minha decisão como dono do catálogo, e quanto isso está custando".
 *
 * ⚠️ Toda contagem sai de leituras que o app já faz — `getSettingsItemUnread` é a
 * MESMA dos badges da sidebar, então o número aqui e o da esquerda nunca discordam.
 * Não inventar contagem nova aqui: `getSettingsItemPending` puxa LINHAS (não
 * `count: exact`) e é uma das leituras mais caras do app (§Egress do CLAUDE.md).
 *
 * 🔴 **Esta página tem que explicar o badge do gatilho de Curadoria, INTEIRO.** O
 * badge soma `curadoria + requests` (`curation-menu.tsx`), e por um tempo os Pedidos
 * não apareciam aqui: um "3" no botão podia ser 3 pedidos de leitor, e a página que
 * deveria dizer o que fazer não os mencionava. Ao somar parcela nova no badge, some
 * também em `buildDecisions` — senão o número vira um alarme sem destino.
 *
 * ⚠️ O saldo custa uma leitura paginada a mais de `ai_api_calls` (a janela desde o
 * último rebaseamento), sobreposta à que `getAiUsageTotals` já faz. É redundância
 * conhecida e limitada: a janela do saldo é subconjunto da all-time, e a página é
 * curador-only. Se um dia pesar, o corte é `getAiUsageTotals` devolver as linhas
 * cruas e o saldo agregar em cima — não é tirar o número daqui.
 */
export default async function CuradoriaPage() {
  const [curadoria, requests, unread, usage, balance, recalc] = await Promise.all([
    getCuradoriaBadgeUnreadCount().catch(() => 0),
    countOpenCurationRequests().catch(() => 0),
    getSettingsItemUnread().catch(() => ({}) as Record<string, number>),
    getAiUsageTotals().catch(() => null),
    getAnthropicBalanceStatus().catch(() => null),
    getRecalcPendingState().catch(() => ({ pending: false, lastEditAt: null })),
  ])
  const comixStatus = getComixStatus()
  const comix = comixStatus.state

  const settingsTotal = Object.values(unread).reduce((sum, n) => sum + n, 0)
  const decisions = buildDecisions({ curadoria, requests }, unread)
  const tone = balanceTone(balance?.remainingUsd)

  return (
    <div className="w-full max-w-5xl">
      <header className="mb-6 flex items-center gap-3.5">
        <span className="grid size-12 shrink-0 place-items-center rounded-xl bg-violet-500/15 text-violet-600 ring-1 ring-violet-500/25 dark:text-violet-300 [&_svg]:size-6">
          <Wrench />
        </span>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Curadoria do catálogo</h1>
          <p className="text-sm text-muted-foreground">
            O que precisa da sua decisão, e o que a IA está custando.
          </p>
        </div>
      </header>

      <div className="mb-7 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Tile
          label="Fila de atributos"
          value={String(curadoria)}
          note={curadoria === 1 ? "obra não-lida" : "obras não-lidas"}
          accent="violet"
          emphasis={curadoria > 0}
        />
        <Tile
          label="Pendências de config"
          value={String(settingsTotal)}
          note={pendingNote(unread)}
          accent="amber"
          emphasis={settingsTotal > 0}
        />
        {/* O VALOR é o saldo, não o gasto: este tile é onde aterrissa o ponto colorido
            do gatilho de Curadoria, e o alerta é sobre o que RESTA. O gasto de 30 dias
            continua aqui como nota — é o contexto que dá escala ao saldo ("US$ 4 restantes"
            significa coisas opostas se o mês custou US$ 2 ou US$ 40). A contagem de
            chamadas saiu; ela vive em /ai-usage, que é o destino do clique. */}
        <Tile
          label="Saldo Anthropic"
          value={balance?.remainingUsd != null ? formatUsd(balance.remainingUsd) : "—"}
          note={
            balance?.remainingUsd == null
              ? "nunca informado — defina em Uso da API IA"
              : `${usage ? formatUsd(usage.last30d.totalCostUsd) : "—"} gastos em 30 dias`
          }
          accent={tone === "negative" ? "rose" : tone === "low" ? "amber" : "emerald"}
          emphasis={tone === "negative" || tone === "low"}
        />
        <Tile
          label="Recálculo"
          value={recalc.pending ? "pendente" : "em dia"}
          note={
            recalc.pending
              ? "roda sozinho 1 h após a última edição"
              : "sem edições aguardando"
          }
          accent="slate"
          emphasis={recalc.pending}
        />
      </div>

      <section className="mb-7">
        <h2 className="mb-2.5 text-[11px] font-semibold uppercase tracking-[0.13em] text-muted-foreground">
          Precisa da sua decisão
        </h2>
        {decisions.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border/70 bg-card/40 px-4 py-5 text-sm text-muted-foreground">
            Nada pendente. As filas estão zeradas (ou já marcadas como lidas) e não há pedido
            de leitor em aberto.
          </p>
        ) : (
          <ul className="space-y-2">
            {decisions.map((d) => (
              <li key={d.href}>
                <DecisionRow {...d} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-2.5 text-[11px] font-semibold uppercase tracking-[0.13em] text-muted-foreground">
          Saúde
        </h2>
        <div className="grid gap-2.5 sm:grid-cols-2">
          <HealthCard
            tone={comix === "down" ? "bad" : comix === "degraded" ? "warn" : "ok"}
            title={COMIX_TITLE[comix]}
            // Sidecar barrado NÃO vira "warn": o FlareSolverr assume e as reviews
            // entram normalmente — alarmar aqui seria o alarme que sempre toca. Mas
            // some uma camada, e foi essa degradação muda que durou 13 dias sem
            // ninguém saber. Diferenciar, não destacar.
            detail={
              comix === "ok" && comixStatus.sidecarBlocked
                ? "reviews entrando pelo FlareSolverr — o sidecar está bloqueado na Comix"
                : COMIX_DETAIL[comix]
            }
            href="/settings?g=fontes"
          />
          <HealthCard
            tone={recalc.pending ? "warn" : "ok"}
            title={recalc.pending ? "Notas aguardando recálculo" : "Notas recalculadas"}
            detail={
              recalc.lastEditAt
                ? `última edição em ${new Date(recalc.lastEditAt).toLocaleString("pt-BR")}`
                : "nenhuma edição registrada"
            }
          />
        </div>
      </section>
    </div>
  )
}

// ── Decisões ────────────────────────────────────────────────────────────────

interface Decision {
  href: string
  title: string
  description: string
  count: number
  accent: ConsoleAccent
}

/**
 * As filas do badge (via `DECISION_QUEUES`) mais toda pendência NÃO-LIDA de
 * /settings, cada uma linkando direto pro tópico dona.
 *
 * 🔴 **Nenhuma das duas metades é enumerada aqui, e é isso que as mantém honestas.**
 * As filas saem de `DECISION_QUEUES` — a MESMA lista que o badge do gatilho soma, então
 * uma fila nova aparece nos dois lugares ou em nenhum. Os tópicos saem do
 * `SETTINGS_GROUPS`. Redigitar qualquer um dos dois criaria uma segunda verdade que sai
 * de sincronia no primeiro ajuste de rótulo — foi exatamente assim que os Pedidos
 * entraram no badge e nunca chegaram nesta página.
 */
function buildDecisions(
  counts: Record<DecisionQueueKey, number>,
  unread: Record<string, number>,
): Decision[] {
  const rows: Decision[] = []

  for (const queue of DECISION_QUEUES) {
    const count = counts[queue.key] ?? 0
    if (count <= 0) continue
    rows.push({
      href: queue.href,
      title: queue.title,
      description: queue.description,
      count,
      accent: queue.accent,
    })
  }

  for (const [sectionId, count] of Object.entries(unread)) {
    if (count <= 0) continue
    const section = findSection(sectionId)
    const groupId = groupIdOfSection(sectionId)
    if (!section || !groupId) continue
    const group = SETTINGS_GROUPS.find((g) => g.id === groupId)
    rows.push({
      // `?open=` só é honrado para seções colapsáveis (`normalizeOpenId`); nas demais
      // é ignorado sem erro, então mandar sempre é seguro e abre a ferramenta direto.
      href: `/settings?g=${groupId}&open=${sectionId}`,
      title: section.title,
      description: section.description,
      count,
      accent: group?.accent ?? "slate",
    })
  }

  return rows.sort((a, b) => b.count - a.count)
}

function DecisionRow({ href, title, description, count, accent }: Decision) {
  const s = ACCENT_STYLES[accent]
  return (
    <Link
      href={href}
      className={cn(
        "group flex items-center gap-3 rounded-xl border border-border bg-card px-3.5 py-3 transition-colors",
        s.cardHoverBorder,
      )}
    >
      <span
        className={cn(
          "grid size-8 shrink-0 place-items-center rounded-lg text-[13px] font-bold tabular-nums ring-1",
          s.iconBg,
          s.iconText,
          s.ring,
        )}
      >
        {count > 99 ? "99+" : count}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold">{title}</span>
        <span className="mt-0.5 block truncate text-xs text-muted-foreground">{description}</span>
      </span>
      <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
    </Link>
  )
}

// ── Blocos ──────────────────────────────────────────────────────────────────

function Tile({
  label,
  value,
  note,
  accent,
  emphasis = false,
}: {
  label: string
  value: string
  note: string
  accent: ConsoleAccent
  emphasis?: boolean
}) {
  const s = ACCENT_STYLES[accent]
  return (
    <div className="rounded-xl border border-border bg-card px-3.5 py-3">
      <p className="text-[10.5px] font-semibold uppercase tracking-[0.09em] text-muted-foreground">
        {label}
      </p>
      <p
        className={cn(
          "mt-0.5 text-[25px] font-bold leading-tight tracking-tight tabular-nums",
          emphasis && s.iconText,
        )}
      >
        {value}
      </p>
      <p className="text-[11.5px] text-muted-foreground">{note}</p>
    </div>
  )
}

const TONE_DOT = {
  ok: "bg-emerald-500 shadow-[0_0_0_3px] shadow-emerald-500/20",
  warn: "bg-amber-500 shadow-[0_0_0_3px] shadow-amber-500/20",
  bad: "bg-rose-500 shadow-[0_0_0_3px] shadow-rose-500/20",
} as const

function HealthCard({
  tone,
  title,
  detail,
  href,
}: {
  tone: keyof typeof TONE_DOT
  title: string
  detail: string
  href?: string
}) {
  const body = (
    <>
      <span aria-hidden className={cn("mt-1.5 size-2 shrink-0 rounded-full", TONE_DOT[tone])} />
      <span className="min-w-0">
        <span className="block text-[12.5px] font-semibold">{title}</span>
        <span className="block text-[11.5px] text-muted-foreground">{detail}</span>
      </span>
    </>
  )
  const className = "flex items-start gap-2.5 rounded-xl border border-border bg-card px-3.5 py-3"
  return href ? (
    <Link href={href} className={cn(className, "transition-colors hover:border-border/40 hover:bg-card/70")}>
      {body}
    </Link>
  ) : (
    <div className={className}>{body}</div>
  )
}

// ── Rótulos ─────────────────────────────────────────────────────────────────

const COMIX_TITLE: Record<string, string> = {
  ok: "Comix respondendo",
  degraded: "Comix instável",
  down: "Comix fora do ar",
  unknown: "Comix sem leitura",
}

const COMIX_DETAIL: Record<string, string> = {
  ok: "reviews da maior fonte estão entrando nas avaliações",
  degraded: "algumas reviews podem faltar nas avaliações",
  down: "avaliações vão rodar sem as reviews da Comix",
  unknown: "nenhuma chamada desde o último restart do servidor",
}

/** "em 3 dos 4 tópicos" — diz ONDE está a pendência, não só quantas são. */
function pendingNote(unread: Record<string, number>): string {
  const groupsHit = SETTINGS_GROUPS.filter((g) =>
    g.sections.some((s) => (unread[s.id] ?? 0) > 0),
  ).length
  if (groupsHit === 0) return "nenhuma pendência aberta"
  return `em ${groupsHit} ${groupsHit === 1 ? "tópico" : "tópicos"} de ${SETTINGS_GROUPS.length}`
}
