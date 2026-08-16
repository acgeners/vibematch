"use client"

/**
 * 🔴 O `"use client"` acima NÃO é decoração — sem ele o badge com tooltip QUEBRA A HIDRATAÇÃO,
 * e o sintoma não aponta para cá.
 *
 * Medido no app rodando (2026-08-12): enquanto este arquivo era compartilhado, os consumidores
 * SERVER (vitrine `/`, hero do `/login`) emitiam a árvore do Radix **só no payload RSC** e
 * **zero** no HTML do SSR — `/` 0 × 2, `/login` 0 × 12. Na hidratação o cliente montava o
 * `<span>` gatilho que o servidor não tinha, todos os irmãos deslizavam uma posição, e o React
 * acabava comparando o gatilho do tooltip com o badge de status PESSOAL do mesmo card: o diff
 * saía incompreensível (`data-variant` secondary × outline, ⭐️ fora de lugar) apontando um
 * `<span aria-hidden>` inocente. Com a diretiva: HTML 2 e 12, payload 0.
 *
 * ⚠️ Consumidor CLIENT nunca teve o problema (`/catalog`: 88 gatilhos no HTML) — é por isso que
 * o defeito sobreviveu. Ele só existe nas telas onde o badge é renderizado pelo SERVIDOR, que
 * são justamente as que ninguém associa a "componente interativo".
 *
 * ⚠️ Custo ≈ zero: 9+ componentes `"use client"` já importavam este arquivo, então
 * `lib/constants/criteria` (20 KB) já estava no bundle do cliente de qualquer forma.
 */

import { Badge } from "@/components/ui/badge"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { hasHiatusSince, hiatusDisplay, hiatusSinceLabel, hiatusTooltip } from "@/lib/works/hiatus-display"
import type { HiatusKind } from "@/lib/external/hiatus-kind"
import { cn } from "@/lib/utils"
import {
  PUBLICATION_STATUS_LABELS,
  PERSONAL_STATUS_LABELS,
  PUBLICATION_STATUSES_BY_ID,
  PERSONAL_STATUSES_BY_ID,
  type PublicationStatusInfo,
  type PersonalStatusInfo,
} from "@/lib/constants/criteria"
import { DEFAULT_PERSONAL_STATUS } from "@/lib/constants/criteria"

const PUBLICATION_STATUSES_BY_NAME: Record<string, PublicationStatusInfo> = Object.fromEntries(
  Object.values(PUBLICATION_STATUSES_BY_ID).map((info) => [info.status, info])
)

const PERSONAL_STATUSES_BY_NAME: Record<string, PersonalStatusInfo> = Object.fromEntries(
  Object.values(PERSONAL_STATUSES_BY_ID).map((info) => [info.status, info])
)

function resolvePublicationInfo(
  statusId?: number | null,
  status?: string | null
): PublicationStatusInfo | null {
  if (statusId != null && PUBLICATION_STATUSES_BY_ID[statusId]) {
    return PUBLICATION_STATUSES_BY_ID[statusId]
  }
  if (!status) return null
  const canonical = PUBLICATION_STATUS_LABELS[status] ?? status
  return PUBLICATION_STATUSES_BY_NAME[canonical] ?? null
}

function resolvePersonalInfo(
  statusId?: number | null,
  status?: string | null
): PersonalStatusInfo | null {
  if (statusId != null && PERSONAL_STATUSES_BY_ID[statusId]) {
    return PERSONAL_STATUSES_BY_ID[statusId]
  }
  if (!status) return null
  const canonical = PERSONAL_STATUS_LABELS[status] ?? status
  return PERSONAL_STATUSES_BY_NAME[canonical] ?? null
}

// Publication badges still use a hand-tuned Tailwind palette (the DB hex
// colors don't map cleanly to utility classes). Personal badges, in contrast,
// derive their colors directly from the DB hex via `hexToRgba` below.
const PUB_STATUS_CLASSES: Record<string, string> = {
  Completed: "bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-400/12 dark:text-blue-200 dark:border-blue-400/25",
  Hiatus: "bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-400/12 dark:text-amber-200 dark:border-amber-400/25",
  Ongoing: "bg-green-100 text-green-800 border-green-200 dark:bg-emerald-400/12 dark:text-emerald-200 dark:border-emerald-400/25",
  Cancelled: "bg-red-100 text-red-800 border-red-200 dark:bg-red-400/12 dark:text-red-200 dark:border-red-400/25",
  Unknown: "bg-gray-100 text-gray-600 border-gray-200 dark:bg-slate-400/10 dark:text-slate-300 dark:border-slate-400/20",
}

// Converts a `#RRGGBB` hex (as stored in the DB `color` column) to an rgba
// string so we can use the same status color for the text and a low-opacity
// background tint.
function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace("#", "")
  const r = parseInt(h.slice(0, 2), 16)
  const g = parseInt(h.slice(2, 4), 16)
  const b = parseInt(h.slice(4, 6), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

interface PublicationStatusBadgeProps {
  /** Preferido após Fase 3.2; cai no `status` legado quando nulo. */
  statusId?: number | null
  status?: string | null
  /** Quando true, mostra o código curto (`short` no DB) em vez do nome canônico. */
  compact?: boolean
  /** Quando true, mostra só o símbolo (sem texto). */
  iconOnly?: boolean
  className?: string
  /**
   * `works.hiatus_kind` / `hiatus_kind_confidence` / `publication_status_note` (migration 183).
   *
   * ⚠️ Os três são OPCIONAIS, e é isso que mantém o badge utilizável nas ~20 telas que ainda
   * não os plumbaram: sem eles o componente renderiza exatamente como antes. Um default que
   * inventasse tipo faria a tela afirmar sobre dado que ela não carregou.
   */
  hiatusKind?: HiatusKind | null
  hiatusKindConfidence?: "high" | "low" | null
  /** Texto cru do MangaUpdates — vai no tooltip como a prova por trás do rótulo. */
  publicationStatusNote?: string | null
}

/**
 * "Parada desde agosto de 2022 · há 4 anos" — e o único ponto do badge que lê o relógio.
 *
 * 🔴 Mora aqui, e não no corpo do badge, porque o `TooltipContent` do Radix só MONTA quando o
 * tooltip abre (sem `forceMount`, o `Portal` desmonta fechado): o `new Date()` roda no browser,
 * depois da hidratação, e este texto nunca chega ao HTML do SSR — então não há o que divergir.
 * No corpo do badge ele rodaria em TODO render, nas ~20 telas que usam o componente.
 */
function HiatusSinceLine({ note }: { note: string }) {
  const label = hiatusSinceLabel(note, new Date())
  if (!label) return null
  return <p className="mt-1 font-medium text-background/90">{label}</p>
}

export function PublicationStatusBadge({
  statusId,
  status,
  compact,
  iconOnly,
  className,
  hiatusKind,
  hiatusKindConfidence,
  publicationStatusNote,
}: PublicationStatusBadgeProps) {
  const info = resolvePublicationInfo(statusId, status)
  const name = info?.status ?? "Unknown"
  const display = compact ? (info?.short || name) : name

  // Só qualifica o que É hiato. O trigger `trg_clear_hiatus_kind` já zera a coluna fora dele,
  // mas a tela não pode depender disso: ela também renderiza dado em voo, antes de gravar.
  const isHiatus = name === "Hiatus"
  const mark = isHiatus ? hiatusDisplay(hiatusKind, hiatusKindConfidence) : null
  const tip = isHiatus ? hiatusTooltip(hiatusKind, hiatusKindConfidence) : null
  // "Parada desde agosto de 2022 · há 4 anos". Só dentro do hiato, e derivada da nota — a
  // classe sozinha engana: 13 das 85 obras em hiato estão paradas há 2+ anos, e boa parte
  // delas classifica como "entre temporadas", que é estruturalmente certo e soa transitório.
  //
  // 🔴 Aqui vai só a PERGUNTA ("há data?"), que é pura. O rótulo lê o relógio dentro do
  // tooltip (`HiatusSinceLine`) — no corpo do badge, o `new Date()` decidiria a FORMA da
  // árvore a cada render, que é o que o docblock de `hiatusSinceLabel` proíbe.
  const temDesde = isHiatus && hasHiatusSince(publicationStatusNote)

  const badge = (
    <Badge
      variant="outline"
      className={cn("gap-1", iconOnly && "px-1.5", PUB_STATUS_CLASSES[name] ?? PUB_STATUS_CLASSES.Unknown, className)}
      title={iconOnly && !tip ? name : undefined}
    >
      <span aria-hidden>{info?.symbol || "?"}</span>
      {!iconOnly && display}
      {mark && (
        <span aria-hidden className="font-mono text-[0.9em] font-bold leading-none">
          {mark.glyph}
        </span>
      )}
      {/* O texto só entra onde há largura; o glifo acima é o que sobrevive ao resto. */}
      {mark && !compact && !iconOnly && <span className="font-medium">{mark.label}</span>}
      {/* O glifo é `aria-hidden` (é forma, não conteúdo), então o leitor de tela precisa da
          palavra em algum lugar — senão a distinção existe só para quem enxerga. */}
      {mark && (compact || iconOnly) && <span className="sr-only">{mark.label}</span>}
    </Badge>
  )

  // ⚠️ A data sozinha JÁ justifica o tooltip. Exigir `tip` esconderia "parada desde 2022" nas
  // obras cujo texto não decide o tipo — exatamente aquelas em que a idade é o único sinal
  // que sobra.
  if (!tip && !temDesde) return badge

  // 🔴 O `TooltipProvider` mora AQUI porque este app não tem um no layout raiz, e a falta dele
  // não degrada o tooltip: o Radix LANÇA no render e derrruba a árvore inteira que o contém.
  // Este badge aparece em ~20 telas — uma delas sem provider seria uma página branca.
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex cursor-help">{badge}</span>
        </TooltipTrigger>
        <TooltipContent className="max-w-[320px]">
          {tip ? (
            <>
              <p className="font-semibold">{tip.title}</p>
              {/* ⚠️ `TooltipContent` é invertido (bg-foreground). Tom secundário sai de
                  `text-background/70`; `text-muted-foreground` cai para ~3:1 no tema CLARO. */}
              <p className="text-background/70">{tip.description}</p>
            </>
          ) : (
            <p className="font-semibold">Em hiato</p>
          )}
          {temDesde && publicationStatusNote && <HiatusSinceLine note={publicationStatusNote} />}
          {publicationStatusNote && (
            <pre className="mt-2 max-h-40 overflow-y-auto whitespace-pre-wrap rounded bg-background/15 p-1.5 font-mono text-[10px] leading-relaxed text-background/80">
              {publicationStatusNote}
            </pre>
          )}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

interface PersonalStatusBadgeProps {
  statusId?: number | null
  status?: string | null
  className?: string
  /** Quando true, mostra só o símbolo (sem o texto do status). */
  iconOnly?: boolean
}

export function PersonalStatusBadge({ statusId, status, className, iconOnly }: PersonalStatusBadgeProps) {
  const info = resolvePersonalInfo(statusId, status)
  const name = info?.status ?? DEFAULT_PERSONAL_STATUS
  // Text color comes straight from the DB `color` hex; the background reuses
  // the same color at low opacity so it stays subtle. Inline styles override
  // the secondary variant's bg/text utilities.
  const style = info ? { color: info.color, backgroundColor: hexToRgba(info.color, 0.12) } : undefined
  return (
    <Badge
      variant="secondary"
      className={cn(
        "gap-1",
        iconOnly && "px-1.5",
        !info && "bg-gray-100 text-gray-700 dark:bg-slate-400/10 dark:text-slate-300",
        className
      )}
      style={style}
      title={iconOnly ? name : undefined}
    >
      <span aria-hidden>{info?.symbol || "•"}</span>
      {!iconOnly && name}
    </Badge>
  )
}

interface AiStatusBadgeProps {
  status: string
  className?: string
}

const AI_STATUS_COLORS: Record<string, string> = {
  pending: "bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-400/12 dark:text-amber-200 dark:border-amber-400/25",
  review_pending: "bg-sky-100 text-sky-800 border-sky-200 dark:bg-sky-400/12 dark:text-sky-200 dark:border-sky-400/25",
  done: "bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-400/12 dark:text-emerald-200 dark:border-emerald-400/25",
  skipped: "bg-gray-100 text-gray-600 border-gray-200 dark:bg-slate-400/10 dark:text-slate-300 dark:border-slate-400/20",
}

const AI_STATUS_LABELS: Record<string, string> = {
  pending: "Sem avaliação IA",
  review_pending: "Aguardando revisão",
  done: "Avaliado",
  skipped: "Pulado",
}

export function AiStatusBadge({ status, className }: AiStatusBadgeProps) {
  return (
    <Badge
      variant="outline"
      className={cn(AI_STATUS_COLORS[status] ?? AI_STATUS_COLORS.pending, className)}
    >
      {AI_STATUS_LABELS[status] ?? status}
    </Badge>
  )
}
