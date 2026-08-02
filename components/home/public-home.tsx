import Link from "next/link"
import { ArrowRight, Star } from "lucide-react"
import { CoverImage } from "@/components/ui/cover-image"
import { PublicationStatusBadge } from "@/components/ui/status-badge"
import { Button } from "@/components/ui/button"
import type { PublicShowcaseWork, SpotlightWork } from "@/server/queries/public-showcase"
import { CriteriaXray } from "@/components/home/criteria-xray"
import type { SiteStats } from "@/server/queries/auth-hero"

/**
 * A home de quem NÃO tem sessão.
 *
 * O catálogo é público por decisão de produto, então esta página existe para mostrá-lo — mas
 * ela não pode mostrar nada pessoal, e não por pudor: sem sessão, os leitores per-usuário
 * devolvem vazio (esse é o comportamento correto desde o fix do eixo público), e o que
 * existia antes no lugar eram os dados do dono do catálogo.
 *
 * Por isso não há "Continue lendo" nem "Pra você hoje" aqui: as duas dependem de estado e de
 * modelo. O que sobra é o que é FATO da obra — média das plataformas, contagem de votos,
 * capítulos, status de publicação — mais o convite para criar conta, que é onde a Nota
 * Prevista passa a existir.
 */
export function PublicHome({
  works,
  stats,
  spotlight,
}: {
  works: PublicShowcaseWork[]
  stats: SiteStats
  /** Obra do raio-X. `null` quando nenhuma das melhores tem os 9 critérios + capa. */
  spotlight: SpotlightWork | null
}) {
  return (
    <div className="flex flex-col gap-10">
      {/* ── hero: o argumento à esquerda, a PROVA dele à direita ── */}
      <section className="grid items-center gap-6 pt-2 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)] lg:gap-10">
      <div className="flex flex-col gap-4">
        <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-primary">
          {stats.works.toLocaleString("pt-BR")} obras lidas por critério
        </p>
        <h1 className="max-w-[22ch] text-balance text-3xl font-bold leading-[1.1] tracking-tight sm:text-4xl xl:text-5xl">
          Toda obra do catálogo passa por uma leitura de nove critérios.
        </h1>
        <p className="max-w-prose text-base text-muted-foreground">
          Não é média de nota nem contagem de curtida: cada obra recebe uma leitura de romance,
          protagonista, drama, tragédia e mais cinco eixos. É isso que permite ordenar o catálogo
          pelo <em>seu</em> gosto — e não pelo gosto médio da internet.
        </p>

        <div className="mt-1 flex flex-wrap items-center gap-3">
          <Button asChild size="lg">
            <Link href="/signup">Criar conta grátis</Link>
          </Button>
          <Button asChild variant="outline" size="lg">
            <Link href="/titles">Explorar o catálogo</Link>
          </Button>
          <Link
            href="/sobre#como"
            className="text-sm font-semibold text-primary hover:underline"
          >
            Como funciona →
          </Link>
        </div>

        {/* Números reais do acervo — os mesmos do painel de login. */}
        <dl className="mt-2 flex flex-wrap gap-x-8 gap-y-3">
          <Stat value={stats.criteria} label="notas por critério" />
          <Stat value={stats.reviews} label="reviews lidas" />
          <Stat value={stats.sources} label="fontes cruzadas" />
        </dl>
      </div>

        {spotlight && <CriteriaXray work={spotlight} />}
      </section>

      {/* ── prateleira pública ─────────────────────────────────── */}
      {works.length > 0 && (
        <section className="flex flex-col gap-3">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h2 className="text-base font-bold tracking-tight">Mais bem avaliadas nas plataformas</h2>
            <p className="text-xs text-muted-foreground">
              média de MangaUpdates, AniList, MyAnimeList e outras — com o número de votos à vista
            </p>
            <Link
              href="/titles"
              className="ml-auto inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-primary hover:underline"
            >
              Ver catálogo
              <ArrowRight className="size-3" />
            </Link>
          </div>

          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {works.map((w) => (
              <li key={w.id}>
                <Link
                  href={`/titles/${w.id}`}
                  className="group flex h-full flex-col gap-2 rounded-lg border border-border/65 bg-background/40 p-3 transition-all hover:-translate-y-0.5 hover:border-primary/35 hover:bg-card hover:shadow-md"
                >
                  <div className="relative overflow-hidden rounded-md">
                    <CoverImage
                      url={w.coverUrl}
                      alt={w.title}
                      className="aspect-[3/4] w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
                    />
                    {w.platformAvg != null && (
                      <span className="absolute right-1.5 top-1.5 inline-flex items-center gap-1 rounded-md bg-background/85 px-1.5 py-0.5 text-[11px] font-bold tabular-nums shadow-sm backdrop-blur">
                        <Star className="size-3 text-amber-500" />
                        {w.platformAvg.toFixed(1)}
                      </span>
                    )}
                  </div>
                  <span className="line-clamp-2 text-sm font-semibold leading-snug">{w.title}</span>
                  <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
                    {w.totalVotes.toLocaleString("pt-BR")} votos
                    {w.totalChapters != null && ` · ${w.totalChapters} cap`}
                  </span>
                  <span className="mt-auto flex flex-wrap gap-1 pt-1">
                    <PublicationStatusBadge statusId={w.publicationStatusId} />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ── fechamento ─────────────────────────────────────────── */}
      <section className="flex flex-wrap items-center justify-between gap-x-8 gap-y-4 rounded-2xl border border-border/70 bg-gradient-to-br from-primary/10 to-emerald-500/5 p-6">
        <div className="min-w-0">
          <h2 className="text-xl font-bold tracking-tight">O catálogo é público. A ordem é sua.</h2>
          <p className="mt-1 max-w-prose text-sm text-muted-foreground">
            Criar conta é grátis: importe sua lista, dê nota no que já leu e o acervo inteiro se
            reordena pela previsão do seu gosto.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild size="lg">
            <Link href="/signup">Criar conta grátis</Link>
          </Button>
          <Button asChild variant="outline" size="lg">
            <Link href="/login">Entrar</Link>
          </Button>
        </div>
      </section>

      {/* Sem menu de usuário para quem não tem conta, /sobre e /guia ficariam inalcançáveis. */}
      <nav
        aria-label="Rodapé"
        className="flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-border pt-5 text-sm"
      >
        <Link href="/sobre" className="font-semibold text-muted-foreground hover:text-foreground">
          Sobre a SatorIA
        </Link>
        <Link href="/guia" className="font-semibold text-muted-foreground hover:text-foreground">
          Guia
        </Link>
        <span className="ml-auto text-xs text-muted-foreground">
          Nota Prevista não aparece sem conta — ela só existe em relação a um gosto.
        </span>
      </nav>
    </div>
  )
}

function Stat({ value, label }: { value: number; label: string }) {
  if (!value) return null
  return (
    <div className="flex flex-col">
      <dt className="sr-only">{label}</dt>
      <dd className="font-mono text-xl font-bold tabular-nums tracking-tight">
        {value.toLocaleString("pt-BR")}
      </dd>
      <span className="text-xs text-muted-foreground">{label}</span>
    </div>
  )
}
