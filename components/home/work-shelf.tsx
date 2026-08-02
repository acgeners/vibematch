import Link from "next/link"
import { ArrowRight } from "lucide-react"
import { TopWorkCard } from "@/components/dashboard/top-work-card"
import { ShelfRail } from "@/components/home/shelf-rail"
import type { ScoreColorThresholds } from "@/components/ui/score-badge"
import type { TopWorkItem } from "@/server/queries/dashboard"

interface WorkShelfProps {
  title: string
  /** Por que estas obras estão aqui — a prateleira precisa se explicar. */
  why?: string
  works: TopWorkItem[]
  thresholds: ScoreColorThresholds | null
  moreHref?: string
  moreLabel?: string
  /** Numera as capas (1º, 2º…). Só faz sentido quando a ordem É a informação. */
  ranked?: boolean
}

/**
 * Uma prateleira da vitrine: título, motivo e um trilho de capas que rola na horizontal.
 *
 * Rola em vez de quebrar em grade porque a prateleira precisa sugerir que há mais coisa fora
 * da tela — uma grade de 5 parece a lista inteira. `TopWorkCard` é reaproveitado como está:
 * ele já traz capa 3/4, Nota Prevista, status pessoal e o selo 18+.
 */
export function WorkShelf({
  title,
  why,
  works,
  thresholds,
  moreHref,
  moreLabel = "Ver mais",
  ranked = false,
}: WorkShelfProps) {
  if (works.length === 0) return null

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="text-base font-bold tracking-tight">{title}</h2>
        {why && <p className="text-xs text-muted-foreground">{why}</p>}
        {moreHref && (
          <Link
            href={moreHref}
            className="ml-auto inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-primary hover:underline"
          >
            {moreLabel}
            <ArrowRight className="size-3" />
          </Link>
        )}
      </div>

      <ShelfRail ariaLabel={title}>
        {/* `items-stretch` + `h-full` no card: sem isso, um card com dois selos de status fica
            mais alto que um com um só, e a fileira desalinha na base. */}
        {/* Largura calibrada pelos SELOS, não pela capa: "Ongoing" + "On-hold" lado a lado
            pedem ~210px, e abaixo disso o par quebra em duas linhas — o que desalinhava a base
            dos cards e era o que fazia um parecer menor que o vizinho. Cards mais largos
            significam menos por tela; as setas resolvem o alcance. */}
        <ul className="grid auto-cols-[minmax(196px,1fr)] grid-flow-col items-stretch gap-3 md:auto-cols-[minmax(216px,1fr)]">
          {works.map((work, i) => (
            <li key={work.id} className="h-full" style={{ scrollSnapAlign: "start" }}>
              <TopWorkCard
                rank={ranked ? i + 1 : 0}
                work={work}
                scoreThresholds={thresholds}
                hideRank={!ranked}
              />
            </li>
          ))}
        </ul>
      </ShelfRail>
    </section>
  )
}
