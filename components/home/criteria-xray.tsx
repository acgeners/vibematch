import Link from "next/link"
import { titleToSlug } from "@/lib/utils"
import { CoverImage } from "@/components/ui/cover-image"
import { CRITERIA_INFO } from "@/lib/constants/criteria"
import type { SpotlightWork } from "@/server/queries/public-showcase"

/**
 * O raio-X: uma obra real com as nove notas à vista.
 *
 * É a peça que faz a home pública demonstrar o produto em vez de prometê-lo. Os concorrentes
 * do nicho abrem com uma frase ("descubra, acompanhe, receba recomendações") que qualquer um
 * poderia escrever; aqui o visitante vê a leitura acontecendo numa obra que ele pode
 * reconhecer, com números que não existem em nenhum outro catálogo.
 *
 * Tudo aqui é fato da obra (`category_scores` + `platform_avg`), então vale para quem não tem
 * sessão — nenhuma nota depende de gosto.
 */
export function CriteriaXray({ work }: { work: SpotlightWork }) {
  return (
    <figure className="m-0 flex gap-4 rounded-2xl border border-border/70 bg-card p-4 shadow-lg sm:gap-5 sm:p-5">
      <div className="w-[112px] shrink-0 sm:w-[132px]">
        <Link href={`/titles/${titleToSlug(work.title)}`}>
          <CoverImage
            url={work.coverUrl}
            alt={work.title}
            className="aspect-[3/4] w-full rounded-lg object-cover shadow-sm"
          />
        </Link>
        {work.totalChapters != null && (
          <p className="mt-2 font-mono text-[10px] tabular-nums text-muted-foreground">
            {work.totalChapters} capítulos
          </p>
        )}
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <figcaption className="flex flex-col gap-0.5">
          <Link
            href={`/titles/${titleToSlug(work.title)}`}
            className="truncate text-[15px] font-bold tracking-tight hover:underline"
          >
            {work.title}
          </Link>
          {work.platformAvg != null && (
            <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
              ★ {work.platformAvg.toFixed(1)} nas plataformas ·{" "}
              {work.totalVotes.toLocaleString("pt-BR")} votos
            </span>
          )}
        </figcaption>

        <ul className="flex flex-col gap-[3px]">
          {work.scores.map(({ slug, score }) => {
            const info = CRITERIA_INFO[slug]
            return (
              <li
                key={slug}
                className="grid grid-cols-[1rem_minmax(0,1fr)_2rem] items-center gap-2 text-[11px] text-muted-foreground sm:grid-cols-[1rem_8.5rem_minmax(0,1fr)_2rem]"
                title={info?.name ?? slug}
              >
                <span aria-hidden>{info?.emoji ?? "•"}</span>
                <span className="hidden truncate sm:block">{info?.name ?? slug}</span>
                <span
                  className="h-[5px] overflow-hidden rounded-full bg-muted"
                  role="img"
                  aria-label={`${info?.name ?? slug}: ${score.toFixed(1)} de 10`}
                >
                  <span
                    className="block h-full rounded-full bg-primary"
                    style={{ width: `${Math.max(2, Math.min(100, score * 10))}%` }}
                  />
                </span>
                <span className="text-right font-mono tabular-nums text-foreground">
                  {score.toFixed(1)}
                </span>
              </li>
            )
          })}
        </ul>

        <p className="mt-0.5 border-t border-border/60 pt-2 text-[11px] leading-relaxed text-muted-foreground">
          Leitura da IA sobre sinopse, tags e reviews de várias fontes. Drama e tragédia contam
          como <em>peso</em>, não como defeito — quem gosta procura, quem não gosta filtra.
        </p>
      </div>
    </figure>
  )
}
