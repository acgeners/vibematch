import Link from "next/link"
import { ArrowRight, BookOpen, ExternalLink } from "lucide-react"
import { CoverImage } from "@/components/ui/cover-image"
import { AdultBadge } from "@/components/ui/adult-badge"
import { PublicationStatusBadge, PersonalStatusBadge } from "@/components/ui/status-badge"
import { ScoreBadge } from "@/components/ui/score-badge"
import type { ScoreColorThresholds } from "@/components/ui/score-badge"
import { WorkTitleLink } from "@/components/titles/work-title-link"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { classifyPace, lastActivityAt } from "@/lib/reading/pace-bands"
import { PUBLICATION_STATUSES_BY_ID } from "@/lib/constants/criteria"
import type { ContinueReadingItem } from "@/server/queries/dashboard"

function isPublicationHiatus(statusId: number | null): boolean {
  return statusId != null && PUBLICATION_STATUSES_BY_ID[statusId]?.status === "Hiatus"
}

function isOngoing(statusId: number | null): boolean {
  return statusId != null && PUBLICATION_STATUSES_BY_ID[statusId]?.status === "Ongoing"
}

/**
 * O rótulo da banda depende de a obra ainda estar saindo.
 *
 * A banda é a mesma (≥85% lido), mas o que 85% SIGNIFICA muda: numa obra concluída falta
 * pouco para acabar — "quase no fim"; numa que ainda publica, não há fim à vista, você está é
 * alcançando os lançamentos — "quase em dia". Dizer "quase no fim" de uma obra em publicação
 * é simplesmente falso, e o leitor percebe.
 */
function bandLabel(publicationStatusId: number | null): string {
  return isOngoing(publicationStatusId) ? "quase em dia" : "quase no fim"
}

/**
 * Separa "Também em leitura" entre o que ainda publica e o resto, na mesma divisão que a
 * /leitura usa ("Em andamento" × "Concluída & outras").
 *
 * O motivo é que "1 não lido" quer dizer coisas diferentes nos dois casos: numa obra em
 * publicação é o capítulo desta semana, e amanhã tem mais; numa concluída é o que falta para
 * acabar, e não vai crescer. Numa lista única as duas se confundem e a urgência some.
 *
 * Preserva a ordem de entrada dentro de cada grupo (já vem por atividade recente) e omite
 * grupo vazio, para não sobrar um cabeçalho solto.
 */
function groupByPublication(
  items: ContinueReadingItem[],
): Array<{ label: string; items: ContinueReadingItem[] }> {
  const ongoing = items.filter((i) => isOngoing(i.publicationStatusId))
  const others = items.filter((i) => !isOngoing(i.publicationStatusId))
  return [
    { label: "Em publicação", items: ongoing },
    { label: "Concluídas e outras", items: others },
  ].filter((g) => g.items.length > 0)
}

/**
 * Escolhe a obra em destaque e a ordem das demais.
 *
 * O destaque sai da banda **Acompanhando** da /leitura (≥85% lido e leitura recente) — não do
 * "li por último". Uma obra em que faltam 37 de 51 capítulos não é o que a pessoa está prestes
 * a terminar; ocupar o hero com ela desperdiça o espaço mais valioso da home. Entre as que se
 * qualificam, vence a de capítulo mais novo: é a que tem algo esperando agora.
 *
 * As demais são ordenadas pela ATIVIDADE mais recente (última leitura ou último lançamento, o
 * que for mais novo), porque capítulo que acabou de sair é tão relevante quanto leitura de
 * ontem — e o critério antigo, só `lastReadAt`, enterrava justamente as novidades.
 */
function pickHighlight(items: ContinueReadingItem[]): {
  main: ContinueReadingItem
  rest: ContinueReadingItem[]
  onPace: boolean
} {
  const onPace = items.filter(
    (i) =>
      classifyPace({
        chaptersRead: i.chaptersRead,
        totalChapters: i.totalChapters,
        pending: i.pending,
        lastReadAt: i.lastReadAt,
        publicationHiatus: isPublicationHiatus(i.publicationStatusId),
      }) === "onpace",
  )

  const pool = onPace.length > 0 ? onPace : items
  const main = [...pool].sort(
    (a, b) =>
      lastActivityAt(null, b.lastChapterReleasedAt) - lastActivityAt(null, a.lastChapterReleasedAt),
  )[0]

  const rest = items
    .filter((i) => i.id !== main.id)
    .sort(
      (a, b) =>
        lastActivityAt(b.lastReadAt, b.lastChapterReleasedAt) -
        lastActivityAt(a.lastReadAt, a.lastChapterReleasedAt),
    )

  return { main, rest, onPace: onPace.length > 0 }
}

/** "5 ago" — curto porque divide linha com o resto da meta. */
function shortDate(iso: string | null): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleDateString("pt-BR", { day: "numeric", month: "short" }).replace(".", "")
}

function pct(read: number | null, total: number | null): number | null {
  if (!read || !total || total <= 0) return null
  return Math.min(100, Math.round((read / total) * 100))
}

/**
 * O topo da vitrine: a obra que a pessoa está lendo agora, grande, com o caminho de volta pra
 * leitura em um clique — mais as outras em andamento ao lado.
 *
 * Mostra dois dados que nenhum dos sites de referência do nicho tem: quantos capítulos ela
 * ainda não leu (`pending`) e quando o próximo deve sair (`nextChapterPredictedAt`). São eles
 * que justificam a obra ocupar esse espaço, em vez de um banner de boas-vindas.
 */
export function ContinueHero({
  items,
  following,
  thresholds,
}: {
  items: ContinueReadingItem[]
  following: number
  thresholds: ScoreColorThresholds | null
}) {
  if (items.length === 0) {
    return (
      <section className="flex flex-col items-start gap-3 rounded-2xl border border-border/70 bg-card/60 p-6 shadow-sm">
        <p className="text-sm font-semibold">Você não está lendo nada no momento</p>
        <p className="max-w-prose text-sm text-muted-foreground">
          Marque uma obra como <strong>Lendo</strong> e ela aparece aqui, com os capítulos que
          faltam e a previsão do próximo.
        </p>
        <Button asChild size="sm">
          <Link href="/titles">
            Procurar no catálogo
            <ArrowRight className="size-3.5" />
          </Link>
        </Button>
      </section>
    )
  }

  const { main, rest, onPace } = pickHighlight(items)
  const progress = pct(main.chaptersRead, main.totalChapters)
  const hasPending = main.pending != null && main.pending > 0
  const nextAt = shortDate(main.nextChapterPredictedAt)
  const lastAt = shortDate(main.lastChapterReleasedAt)
  const nextChapter = (main.chaptersRead ?? 0) + 1

  return (
    // `items-start`: sem isso o grid estica os dois cards à altura do mais alto (a lista, que
    // cresce com o número de obras) e o destaque ganha um vão morto embaixo do botão.
    <section className="grid items-start gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
      {/* ── a obra em foco ─────────────────────────────────────────── */}
      <article className="relative flex gap-5 overflow-hidden rounded-2xl border border-border/70 bg-card p-5 shadow-md">
        <span
          aria-hidden
          className="absolute inset-y-0 left-0 w-[3px] bg-gradient-to-b from-primary to-emerald-400"
        />
        <div className="relative w-[148px] shrink-0 sm:w-[184px]">
          <CoverImage
            url={main.coverUrl}
            alt={main.title}
            className="aspect-[3/4] w-full rounded-lg object-cover shadow-sm"
          />
          <span className="absolute right-1.5 top-1.5">
            <ScoreBadge score={main.expectedScore} size="sm" thresholds={thresholds} />
          </span>
        </div>

        {/* `justify-start`: a coluna de texto começa na MESMA linha do topo da capa. Centrado
            (como estava), o título flutuava no meio e nada alinhava com a imagem. */}
        <div className="flex min-w-0 flex-1 flex-col justify-start gap-2">
          <p className="inline-flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <BookOpen className="size-3" />
              Continue lendo
            </span>
            {onPace && (
              <span
                className="rounded-full border border-emerald-500/30 bg-emerald-500/15 px-2 py-0.5 text-[9px] text-emerald-600 dark:text-emerald-400"
                title="Mesma regra da /leitura: 85–99% lido e leitura recente"
              >
                {bandLabel(main.publicationStatusId)}
              </span>
            )}
          </p>

          <WorkTitleLink
            title={main.title}
            workId={main.id}
            className="text-xl font-bold leading-tight tracking-tight hover:underline sm:text-2xl"
          />

          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span className="tabular-nums">
              {main.totalChapters
                ? `Capítulo ${main.chaptersRead ?? 0} de ${main.totalChapters}`
                : `Capítulo ${main.chaptersRead ?? 0}`}
            </span>
            {hasPending && (
              <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[11px] font-bold text-primary">
                {main.pending} não {main.pending === 1 ? "lido" : "lidos"}
              </span>
            )}
          </div>

          {/* Os selos que a obra já carrega no resto do app — a coluna de texto era mais curta
              que a capa e o que sobrava era vão, não respiro. */}
          <div className="flex flex-wrap items-center gap-1.5">
            {main.isAdult && <AdultBadge className="px-1.5 py-0" />}
            <PublicationStatusBadge statusId={main.publicationStatusId} />
            <PersonalStatusBadge statusId={main.personalStatusId} />
          </div>

          {progress != null && (
            <div
              className="h-1.5 w-full max-w-[320px] overflow-hidden rounded-full bg-primary/15"
              role="progressbar"
              aria-valuenow={progress}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={`${progress}% lido`}
            >
              <span className="block h-full rounded-full bg-primary" style={{ width: `${progress}%` }} />
            </div>
          )}

          {(lastAt || nextAt) && (
            <p className="text-xs text-muted-foreground">
              {lastAt && <>Último capítulo {lastAt}</>}
              {lastAt && nextAt && <span aria-hidden> · </span>}
              {nextAt && (
                <>
                  próximo previsto <strong className="text-foreground">{nextAt}</strong>
                </>
              )}
            </p>
          )}

          <div className="mt-1 flex flex-wrap gap-2">
            {main.comixUrl ? (
              <Button asChild size="sm">
                <a href={main.comixUrl} target="_blank" rel="noopener noreferrer">
                  Ler capítulo {nextChapter}
                  <ExternalLink className="size-3.5" />
                </a>
              </Button>
            ) : (
              <Button asChild size="sm">
                <Link href={`/titles/${main.id}`}>
                  Abrir obra
                  <ArrowRight className="size-3.5" />
                </Link>
              </Button>
            )}
          </div>
        </div>
      </article>

      {/* ── as outras em andamento ─────────────────────────────────── */}
      <aside className="flex min-w-0 flex-col gap-1 rounded-2xl border border-border/70 bg-card/60 p-4 shadow-sm">
        <div className="flex items-baseline justify-between gap-2 px-1 pb-1">
          <p className="text-xs font-bold">Também em leitura</p>
          <Link
            href="/leitura"
            className="font-mono text-[11px] text-muted-foreground transition-colors hover:text-foreground"
          >
            {following}
          </Link>
        </div>

        {rest.length === 0 ? (
          <p className="px-1 py-2 text-xs text-muted-foreground">
            Só esta por enquanto.
          </p>
        ) : (
          groupByPublication(rest.slice(0, 5)).map(({ label, items: group }) => (
            <div key={label} className="flex flex-col gap-1">
              {/* Rótulo do grupo: "capítulo novo" quer dizer coisas diferentes numa obra que
                  ainda sai e numa que acabou — misturar as duas numa lista só esconde isso. */}
              <p className="px-1 pt-1 font-mono text-[9px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/70">
                {label}
              </p>
              {group.map((item) => {
                const pending = item.pending != null && item.pending > 0
                return (
                  <Link
                    key={item.id}
                    href={`/titles/${item.id}`}
                    className="flex items-center gap-3 rounded-lg p-1.5 transition-colors hover:bg-muted/50"
                  >
                    <CoverImage
                      url={item.coverUrl}
                      alt={item.title}
                      className="h-11 w-8 shrink-0 rounded-md object-cover"
                    />
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-[13px] font-semibold">{item.title}</span>
                      <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
                        {item.totalChapters
                          ? `${item.chaptersRead ?? 0}/${item.totalChapters}`
                          : `${item.chaptersRead ?? 0}`}
                        {pending
                          ? ` · ${item.pending} não ${item.pending === 1 ? "lido" : "lidos"}`
                          : " · em dia"}
                      </span>
                    </span>
                    {pending && (
                      <span
                        className={cn(
                          "shrink-0 rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-bold text-primary",
                        )}
                      >
                        novo
                      </span>
                    )}
                  </Link>
                )
              })}
            </div>
          ))
        )}

        {items.length > 5 && (
          <Link
            href="/leitura"
            className="mt-auto inline-flex items-center gap-1 px-1 pt-2 text-xs font-semibold text-primary hover:underline"
          >
            Ver todas
            <ArrowRight className="size-3" />
          </Link>
        )}
      </aside>
    </section>
  )
}
