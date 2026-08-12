import { ScoreBadge } from "@/components/ui/score-badge"
import type { HiatusKind } from "@/lib/external/hiatus-kind"
import type { ScoreColorThresholds } from "@/components/ui/score-badge"
import { PublicationStatusBadge, PersonalStatusBadge } from "@/components/ui/status-badge"
import { AdultBadge } from "@/components/ui/adult-badge"
import { CoverImage } from "@/components/ui/cover-image"
import { QualityHearts } from "@/components/ui/quality-hearts"
import { WorkTitleLink } from "@/components/titles/work-title-link"

interface TopWorkCardProps {
  rank: number
  work: {
    id: string
    title: string
    coverUrl: string | null
    expectedScore: number | null
    publicationStatusId: number | null
    personalStatusId: number | null
    isAdult: boolean
    totalChapters?: number | null
    /** Interesse declarado (♥…♥♥♥♥). Ausente = ainda não avaliou a sinopse. */
    synopsisQuality?: string | null
    /**
     * Qualifica o hiato (migration 183). Opcionais porque este card é usado por duas
     * prateleiras e a prova do badge só existe onde a query trouxe a coluna.
     */
    hiatusKind?: HiatusKind | null
    hiatusKindConfidence?: "high" | "low" | null
    publicationStatusNote?: string | null
  }
  scoreThresholds: ScoreColorThresholds | null
  /**
   * Esconde o selo de posição. Nas prateleiras da home a ordem é só um critério de seleção
   * ("as maiores previstas"), não um pódio — numerar ali sugere uma disputa que não existe.
   */
  hideRank?: boolean
}

const RANK_STYLES = [
  "bg-gradient-to-br from-amber-400 to-amber-600 text-white shadow-amber-500/30",
  "bg-gradient-to-br from-slate-300 to-slate-500 text-white shadow-slate-500/25",
  "bg-gradient-to-br from-orange-400 to-orange-700 text-white shadow-orange-500/30",
  "bg-muted text-muted-foreground",
  "bg-muted text-muted-foreground",
]

export function TopWorkCard({ rank, work, scoreThresholds, hideRank = false }: TopWorkCardProps) {
  return (
    <div className="group relative flex h-full flex-col gap-2.5 rounded-lg border border-border/65 bg-background/40 p-3 transition-all hover:-translate-y-0.5 hover:border-primary/35 hover:bg-card hover:shadow-md hover:shadow-primary/10">
      <div className="relative overflow-hidden rounded-md">
        <CoverImage
          url={work.coverUrl}
          alt={work.title}
          className="aspect-[3/4] w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
        />
        {!hideRank && (
          <span
            className={`absolute left-1.5 top-1.5 inline-grid size-7 place-items-center rounded-full text-xs font-bold tabular-nums shadow-sm ${RANK_STYLES[rank - 1] ?? RANK_STYLES[4]}`}
            aria-label={`Posição ${rank}`}
          >
            {rank}
          </span>
        )}
        <span className="absolute right-1.5 top-1.5">
          <ScoreBadge score={work.expectedScore} size="sm" thresholds={scoreThresholds} />
        </span>
      </div>
      <WorkTitleLink
        title={work.title}
        workId={work.id}
        className="line-clamp-2 text-sm font-semibold leading-snug hover:underline"
      />

      {/* Capítulos + interesse: as duas perguntas que vêm logo depois de "gostei da capa" —
          o tamanho da empreitada e o que EU já achei dela. Some quando não há dado, em vez de
          reservar espaço vazio (o card já iguala altura pelo `h-full` do contêiner). */}
      {(work.totalChapters != null || work.synopsisQuality) && (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
          {work.totalChapters != null && (
            <span className="font-mono tabular-nums">{work.totalChapters} cap</span>
          )}
          {work.synopsisQuality && (
            <QualityHearts
              quality={work.synopsisQuality}
              showEmpty={false}
              className="text-[11px]"
            />
          )}
        </div>
      )}

      <div className="mt-auto flex flex-wrap gap-1 pt-1">
        {work.isAdult && <AdultBadge className="px-1.5 py-0" />}
        <PublicationStatusBadge statusId={work.publicationStatusId} hiatusKind={work.hiatusKind ?? null} hiatusKindConfidence={work.hiatusKindConfidence ?? null} publicationStatusNote={work.publicationStatusNote ?? null} />
        <PersonalStatusBadge statusId={work.personalStatusId} />
      </div>
    </div>
  )
}
