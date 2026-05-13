import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import {
  PUBLICATION_STATUS_LABELS,
  PERSONAL_STATUS_LABELS,
} from "@/lib/constants/criteria"

interface PublicationStatusBadgeProps {
  status: string
  className?: string
}

const PUB_STATUS_COLORS: Record<string, string> = {
  Completed: "bg-blue-100 text-blue-800 border-blue-200",
  Hiatus: "bg-amber-100 text-amber-800 border-amber-200",
  Ongoing: "bg-green-100 text-green-800 border-green-200",
  Cancelled: "bg-red-100 text-red-800 border-red-200",
  Unknown: "bg-gray-100 text-gray-600 border-gray-200",
}

export function PublicationStatusBadge({
  status,
  className,
}: PublicationStatusBadgeProps) {
  return (
    <Badge
      variant="outline"
      className={cn(PUB_STATUS_COLORS[status] ?? PUB_STATUS_COLORS.Unknown, className)}
    >
      {PUBLICATION_STATUS_LABELS[status] ?? status}
    </Badge>
  )
}

const PERSONAL_STATUS_COLORS: Record<string, string> = {
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

interface PersonalStatusBadgeProps {
  status: string
  className?: string
}

export function PersonalStatusBadge({ status, className }: PersonalStatusBadgeProps) {
  return (
    <Badge
      variant="secondary"
      className={cn(
        PERSONAL_STATUS_COLORS[status] ?? "bg-gray-100 text-gray-700",
        className
      )}
    >
      {PERSONAL_STATUS_LABELS[status] ?? status}
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
