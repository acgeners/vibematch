import { Badge } from "@/components/ui/badge"
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
}

export function PublicationStatusBadge({ statusId, status, compact, iconOnly, className }: PublicationStatusBadgeProps) {
  const info = resolvePublicationInfo(statusId, status)
  const name = info?.status ?? "Unknown"
  const display = compact ? (info?.short || name) : name
  return (
    <Badge
      variant="outline"
      className={cn("gap-1", iconOnly && "px-1.5", PUB_STATUS_CLASSES[name] ?? PUB_STATUS_CLASSES.Unknown, className)}
      title={iconOnly ? name : undefined}
    >
      <span aria-hidden>{info?.symbol || "?"}</span>
      {!iconOnly && display}
    </Badge>
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
