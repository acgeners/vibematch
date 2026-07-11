import { CoverImage } from "@/components/ui/cover-image"
import { ScoreBadge } from "@/components/ui/score-badge"
import { PublicationStatusBadge, PersonalStatusBadge } from "@/components/ui/status-badge"
import { getAuthHeroWorks, getSiteStats } from "@/server/queries/auth-hero"
import type { HeroWork, SiteStats } from "@/server/queries/auth-hero"
import { Wordmark } from "./wordmark"

// Amostra do perfil real (valores representativos) — a IA monta o completo pra
// cada usuário. Rotulado "prévia" no card.
const CRITERIA = [
  { icon: "👑", name: "Fantasia/Nobreza", min: 7.5, max: 9.5, weight: 90 },
  { icon: "💑", name: "Dinâmica do Casal", min: 7.0, max: 9.5, weight: 88 },
  { icon: "💕", name: "Romance", min: 7.0, max: 9.5, weight: 85 },
]
const LOVED = { shown: ["Regressão", "Fantasia", "Contract Marriage", "Protagonista OP"], total: 25 }
const AVOIDED = { shown: ["Harém", "Tragédia"], total: 10 }

function fmt(n: number): string {
  return new Intl.NumberFormat("pt-BR", { notation: "compact", maximumFractionDigits: 1 }).format(n)
}

function CoverCard({ work }: { work: HeroWork }) {
  return (
    <div className="authhero-cover bg-muted">
      <CoverImage url={work.coverUrl} alt={work.title} className="h-full w-full object-cover" />
      {work.nota != null ? (
        <div className="absolute right-1 top-1">
          <ScoreBadge score={work.nota} size="sm" />
        </div>
      ) : null}
      <div className="absolute inset-x-0 bottom-0 flex items-end gap-1 bg-gradient-to-t from-black/75 via-black/25 to-transparent p-1">
        <PublicationStatusBadge statusId={work.publicationStatusId} compact />
        <PersonalStatusBadge statusId={work.personalStatusId} iconOnly />
      </div>
    </div>
  )
}

function CriterionRow({ icon, name, min, max, weight }: (typeof CRITERIA)[number]) {
  const left = (min / 10) * 100
  const width = ((max - min) / 10) * 100
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-[12px] font-medium">
          <span aria-hidden="true">{icon}</span>
          {name}
        </span>
        <span className="font-mono text-[10.5px] tabular-nums text-muted-foreground">
          {min.toFixed(1)}–{max.toFixed(1)} · {weight}%
        </span>
      </div>
      <div className="relative h-1.5 rounded-full bg-muted-foreground/15">
        <div
          className="absolute inset-y-0 rounded-full bg-primary"
          style={{ left: `${left}%`, width: `${width}%` }}
        />
      </div>
    </div>
  )
}

function TasteCard() {
  return (
    <div className="flex w-full flex-col gap-3.5 rounded-2xl border border-border bg-card/70 p-4 shadow-[0_24px_50px_-26px_rgba(6,12,24,0.6)] backdrop-blur-md backdrop-saturate-150">
      <div className="flex items-center justify-between gap-2.5">
        <div className="flex flex-col">
          <span className="text-[13.5px] font-bold tracking-tight">Seu perfil de gosto</span>
          <span className="text-[10.5px] text-muted-foreground">faixa ideal e peso por critério</span>
        </div>
        <span className="rounded-full border border-border bg-muted px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">
          prévia
        </span>
      </div>

      <div className="flex flex-col gap-2.5">
        {CRITERIA.map((c) => (
          <CriterionRow key={c.name} {...c} />
        ))}
      </div>

      <div className="flex flex-col gap-2 border-t border-border pt-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-0.5 text-[10.5px] font-bold uppercase tracking-[0.06em] text-primary">
            ♥ Amadas ({LOVED.total})
          </span>
          {LOVED.shown.map((t) => (
            <span
              key={t}
              className="rounded-md border border-primary/30 bg-primary/15 px-2 py-0.5 text-[11px] font-medium text-accent-foreground dark:text-foreground"
            >
              {t}
            </span>
          ))}
          <span className="text-[11px] text-muted-foreground">+{LOVED.total - LOVED.shown.length}</span>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-0.5 text-[10.5px] font-bold uppercase tracking-[0.06em] text-muted-foreground">
            ✕ Evitadas ({AVOIDED.total})
          </span>
          {AVOIDED.shown.map((t) => (
            <span
              key={t}
              className="rounded-md border border-border bg-muted-foreground/10 px-2 py-0.5 text-[11px] font-medium text-muted-foreground line-through opacity-80"
            >
              {t}
            </span>
          ))}
          <span className="text-[11px] text-muted-foreground">+{AVOIDED.total - AVOIDED.shown.length}</span>
        </div>
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
  ].filter((i) => i.n > 0)

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

  const cols: HeroWork[][] = [[], [], [], []]
  works.forEach((w, i) => cols[i % 4].push(w))

  return (
    <section className="relative hidden overflow-hidden border-r border-border bg-muted md:block">
      {works.length > 0 ? (
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
        <Wordmark />
        <div className="flex w-full flex-col gap-6 md:w-[54%]">
          <h1 className="text-[30px] font-extrabold leading-[1.15] tracking-[-0.02em] text-balance">
            Seu catálogo de manhwas com uma IA que <span className="text-primary">aprende o seu gosto</span>.
          </h1>
          <StatsRow stats={stats} />
          <TasteCard />
        </div>
      </div>
    </section>
  )
}
