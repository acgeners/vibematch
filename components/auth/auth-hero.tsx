import { CoverImage } from "@/components/ui/cover-image"
import { ScoreBadge } from "@/components/ui/score-badge"
import { PublicationStatusBadge } from "@/components/ui/status-badge"
import { getAuthHeroWorks, getSiteStats } from "@/server/queries/auth-hero"
import type { HeroWork, SiteStats } from "@/server/queries/auth-hero"
import { Wordmark } from "./wordmark"
import { TastePreview } from "./taste-preview"

function fmt(n: number): string {
  return new Intl.NumberFormat("pt-BR", { notation: "compact", maximumFractionDigits: 1 }).format(n)
}

function CoverCard({ work }: { work: HeroWork }) {
  return (
    <div className="authhero-cover bg-muted">
      <CoverImage urls={work.coverUrls} alt={work.title} className="h-full w-full object-cover" />
      {work.nota != null ? (
        <div className="absolute right-1 top-1">
          <ScoreBadge score={work.nota} size="sm" />
        </div>
      ) : null}
      <div className="absolute inset-x-0 bottom-0 flex items-end gap-1 bg-gradient-to-t from-black/75 via-black/25 to-transparent p-1">
        <PublicationStatusBadge statusId={work.publicationStatusId} compact hiatusKind={work.hiatusKind} hiatusKindConfidence={work.hiatusKindConfidence} publicationStatusNote={work.publicationStatusNote} />
      </div>
    </div>
  )
}

function StatsRow({ stats }: { stats: SiteStats }) {
  const items = [
    { n: stats.works, label: "obras no catálogo" },
    { n: stats.criteria, label: "critérios avaliados" },
    { n: stats.reviews, label: "reviews analisadas" },
    { n: stats.sources, label: "fontes externas" },
    // `n` agora é `number | null`: `null` é contagem que FALHOU e `0` é acervo vazio de
    // verdade. Este painel é decorativo (fica atrás do formulário de login), então os dois
    // somem — mas a guarda é explícita, e não `i.n > 0`, que trataria null por coincidência.
    // O predicado de tipo é obrigatório: sem ele o `.filter` não estreita e o `fmt(i.n)`
    // abaixo deixa de compilar (foi o `tsc` que apontou, não a leitura).
  ].filter((i): i is { n: number; label: string } => typeof i.n === "number" && i.n > 0)

  if (items.length === 0) return null

  return (
    <div className="flex flex-wrap gap-x-6 gap-y-2">
      {items.map((i) => (
        <div key={i.label} className="flex flex-col">
          <span className="text-[21px] font-bold leading-none tabular-nums">{fmt(i.n)}</span>
          <span className="mt-1 text-[11.5px] text-muted-foreground">{i.label}</span>
        </div>
      ))}
    </div>
  )
}

/** Painel esquerdo do login/signup. Escondido no mobile (form ocupa a tela). */
export async function AuthHero() {
  const [works, stats] = await Promise.all([getAuthHeroWorks(24), getSiteStats()])

  // `null` = a consulta falhou; `[]` = respondeu e não há obra com capa. A parede é
  // `aria-hidden` e decorativa, então os dois desfecham no mesmo desenho (sem parede) — o que
  // muda é que a falha agora está REGISTRADA no log, em vez de virar lista vazia calada.
  // Anunciar na tela que o fundo não carregou seria ruído sobre quem está tentando entrar.
  const parede = works ?? []
  const cols: HeroWork[][] = [[], [], [], []]
  parede.forEach((w, i) => cols[i % 4].push(w))

  return (
    <section className="relative hidden overflow-hidden border-r border-border bg-muted md:block">
      {parede.length > 0 ? (
        <div className="authhero-wall" aria-hidden="true">
          {cols.map((list, ci) => (
            <div className="authhero-col" key={ci}>
              <div className="authhero-track">
                {[...list, ...list].map((work, i) => (
                  <CoverCard key={i} work={work} />
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : null}

      <div className="authhero-veil" aria-hidden="true" />

      <div className="relative z-[2] flex h-full flex-col justify-between gap-6 p-[46px]">
        <Wordmark size="lg" />
        <div className="flex w-full flex-col gap-6 md:w-[64%]">
          <h1 className="text-[30px] font-extrabold leading-[1.15] tracking-[-0.02em] text-balance">
            Uma curadoria que conhece o seu gosto <span className="text-primary">tão bem quanto você</span>.
          </h1>
          <StatsRow stats={stats} />
          <TastePreview />
        </div>
      </div>
    </section>
  )
}
