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

// Tailwind class palettes keyed by canonical status. DB stores hex colors,
// which don't map cleanly to Tailwind utility classes — so we keep the
// aesthetic palette here and rely on the DB only for the canonical name
// and symbol.
const PUB_STATUS_CLASSES: Record<string, string> = {
  Completed: "bg-blue-100 text-blue-800 border-blue-200",
  Hiatus: "bg-amber-100 text-amber-800 border-amber-200",
  Ongoing: "bg-green-100 text-green-800 border-green-200",
  Cancelled: "bg-red-100 text-red-800 border-red-200",
  Unknown: "bg-gray-100 text-gray-600 border-gray-200",
}

const PERSONAL_STATUS_CLASSES: Record<string, string> = {
  Completed: "bg-blue-100 text-blue-800",
  Reading: "bg-green-100 text-green-800",
  "To read": "bg-gray-100 text-gray-700",
  Paused: "bg-yellow-100 text-yellow-800",
  Stalled: "bg-orange-100 text-orange-800",
  Dropped: "bg-red-100 text-red-800",
  Started: "bg-purple-100 text-purple-800",
  Hiatus: "bg-cyan-100 text-cyan-800",
  "On-hold": "bg-slate-100 text-slate-700",
}

interface PublicationStatusBadgeProps {
  /** Preferido após Fase 3.2; cai no `status` legado quando nulo. */
  statusId?: number | null
  status?: string | null
  /** Quando true, mostra o código curto (`short` no DB) em vez do nome canônico. */
  compact?: boolean
  className?: string
}

export function PublicationStatusBadge({ statusId, status, compact, className }: PublicationStatusBadgeProps) {
  const info = resolvePublicationInfo(statusId, status)
  const name = info?.status ?? "Unknown"
  const display = compact ? (info?.short || name) : name
  return (
    <Badge
      variant="outline"
      className={cn("gap-1", PUB_STATUS_CLASSES[name] ?? PUB_STATUS_CLASSES.Unknown, className)}
    >
      <span aria-hidden>{info?.symbol || "?"}</span>
      {display}
    </Badge>
  )
}

interface PersonalStatusBadgeProps {
  statusId?: number | null
  status?: string | null
  className?: string
}

export function PersonalStatusBadge({ statusId, status, className }: PersonalStatusBadgeProps) {
  const info = resolvePersonalInfo(statusId, status)
  const name = info?.status ?? "To read"
  return (
    <Badge
      variant="secondary"
      className={cn("gap-1", PERSONAL_STATUS_CLASSES[name] ?? "bg-gray-100 text-gray-700", className)}
    >
      <span aria-hidden>{info?.symbol || "•"}</span>
      {name}
    </Badge>
  )
}

interface AiStatusBadgeProps {
  status: string
  className?: string
}

const AI_STATUS_COLORS: Record<string, string> = {
  pending: "bg-amber-100 text-amber-800 border-amber-200",
  done: "bg-emerald-100 text-emerald-800 border-emerald-200",
  skipped: "bg-gray-100 text-gray-600 border-gray-200",
}

const AI_STATUS_LABELS: Record<string, string> = {
  pending: "Pendente IA",
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
