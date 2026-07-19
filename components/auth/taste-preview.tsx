"use client"

import { useState } from "react"
import { ChevronLeft, ChevronRight, Check, Crown, Sparkles } from "lucide-react"
import { CoverImage } from "@/components/ui/cover-image"
import { cn } from "@/lib/utils"

// Prévia do login (visitante) — dados de AMOSTRA que espelham o output real do app:
// a "Recomendação Principal" (prosa + porquês) e o "Resumo do perfil de gosto".
// Logado, essas telas puxam o dado real (taste_profile / recomendação). A obra-âncora
// do card A é real e de votos altos (Raeliana, ~51,7 mil) só pra dar credibilidade à capa.
type Stance = "love" | "avoid" | ""

const ANCHOR = {
  title: "The Reason Why Raeliana Ended up at the Duke's Mansion",
  coverUrl: "https://media.kitsu.app/manga/poster_images/54519/original.jpg",
  sub: "Transmigração · Nobreza · 51,7 mil votos",
  match: 92,
  expected: "9,1",
  reasons: [
    "Transmigração + heroína que usa o enredo a seu favor (Smart FL)",
    "Nobreza + política — fantasy_nobility 9,1 no seu ideal",
    "Contrato falso que vira amor genuíno (o ML frio cai primeiro)",
  ],
  // stance: verde = você ama · vermelho = você evita · neutro = sem relação
  tags: [
    { name: "Contract Marriage", stance: "love" },
    { name: "Nobility", stance: "love" },
    { name: "Transmigration", stance: "love" },
    { name: "Smart Female Lead", stance: "love" },
    { name: "European Ambience", stance: "love" },
    { name: "Male Lead Falls First", stance: "love" },
    { name: "Fake Couple Becomes Genuine", stance: "love" },
    { name: "Politics", stance: "" },
    { name: "Reverse Harem", stance: "avoid" },
    { name: "Love Triangle", stance: "avoid" },
  ] as { name: string; stance: Stance }[],
}

const PROFILE = {
  worksLearned: "178 obras",
  criteria: [
    { icon: "👑", name: "Fantasia/Nobreza", min: 7.5, max: 9.5, weight: 90 },
    { icon: "💑", name: "Dinâmica do Casal", min: 7.0, max: 9.5, weight: 88 },
    { icon: "💕", name: "Romance", min: 7.0, max: 9.5, weight: 85 },
  ],
  loved: ["Reincarnated FL", "Nobility", "Contract Marriage", "Regressed FL"],
  lovedMore: 24,
  avoided: ["Modern Era", "Netorare", "Slice-of-life"],
  avoidedMore: 3,
  kpis: [
    { n: "5/9", l: "critérios IA", tone: "" },
    { n: "28", l: "tags amadas", tone: "text-emerald-400" },
    { n: "6", l: "tags evitadas", tone: "text-rose-400" },
    { n: "10", l: "temas", tone: "" },
  ],
}

// h-full + flex-col: cada card preenche a célula do carrossel (altura = a do card
// mais alto), então os dois ficam com a MESMA altura ao alternar.
const CARD_SHELL =
  "flex h-full flex-col rounded-2xl border border-border bg-card/75 p-4 shadow-[0_24px_50px_-26px_rgba(6,12,24,0.6)] backdrop-blur-md backdrop-saturate-150"
const CHIP_BASE = "rounded-md px-2 py-0.5 text-[11px] font-medium ring-1"

function tagClass(stance: Stance): string {
  if (stance === "love") return "bg-emerald-500/12 text-emerald-300 ring-emerald-500/30"
  if (stance === "avoid") return "bg-rose-500/10 text-rose-300 ring-rose-500/30"
  return "bg-muted/40 text-foreground/80 ring-border"
}

/** Faixa ideal (0–10) de um atributo, compacta pra caber 2 lado a lado. */
function CriterionRange({ icon, name, min, max, weight }: (typeof PROFILE.criteria)[number]) {
  const left = (min / 10) * 100
  const width = ((max - min) / 10) * 100
  return (
    <div>
      <div className="flex items-center gap-1.5 text-[11.5px] font-medium">
        <span aria-hidden="true">{icon}</span>
        <span className="truncate">{name}</span>
      </div>
      <div className="mt-1 font-mono text-[10px] tabular-nums text-muted-foreground">
        {min.toFixed(1)}–{max.toFixed(1)} · {weight}%
      </div>
      <div className="relative mt-1.5 h-1.5 rounded-full bg-muted-foreground/15">
        <div
          className="absolute inset-y-0 rounded-full bg-primary"
          style={{ left: `${left}%`, width: `${width}%` }}
        />
      </div>
    </div>
  )
}

function RecommendationCard() {
  return (
    <div className={CARD_SHELL}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-[9.5px] font-bold uppercase tracking-[0.11em] text-amber-400">
          <Crown className="size-3" /> Recomendação principal
        </span>
        <span className="rounded-full bg-emerald-500/14 px-2 py-[3px] text-[9.5px] font-bold uppercase tracking-[0.06em] text-emerald-400 ring-1 ring-emerald-500/40">
          Match forte
        </span>
      </div>

      <div className="flex items-start gap-3">
        <div className="relative shrink-0">
          <CoverImage
            url={ANCHOR.coverUrl}
            alt={ANCHOR.title}
            loading="eager"
            className="h-[92px] w-[66px] rounded-lg object-cover shadow-lg shadow-black/40 ring-1 ring-white/10"
          />
          <span className="absolute left-1 top-1 rounded-[5px] bg-amber-400 px-1.5 py-px text-[8.5px] font-extrabold text-[hsl(222_40%_12%)]">
            #1
          </span>
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-extrabold leading-tight tracking-[-0.01em]">{ANCHOR.title}</p>
          <p className="mt-1 text-[11px] text-muted-foreground">{ANCHOR.sub}</p>
          <div className="mt-2 flex items-baseline gap-2 text-emerald-400">
            <span className="font-mono text-[26px] font-black leading-none tabular-nums">
              <span className="opacity-50">{"{"}</span>
              {ANCHOR.match}
              <span className="opacity-50">{"}"}</span>
            </span>
            <span className="text-[9px] font-bold uppercase tracking-[0.1em] text-muted-foreground">
              match · nota prevista {ANCHOR.expected}
            </span>
          </div>
        </div>
      </div>

      <p className="mt-3 border-l-2 border-amber-400/50! pl-3 text-[12px] italic leading-relaxed text-foreground/90">
        Match fortíssimo com o <span className="not-italic font-semibold text-foreground">núcleo do seu perfil</span>:
        transmigrada num romance de nobreza, ela usa o que sabe do enredo pra escapar de um destino trágico — contrato
        com o duque frio que vira sentimento real, e política de corte bem desenvolvida.
      </p>

      <div className="mt-3">
        <p className="mb-2 text-[9.5px] font-bold uppercase tracking-[0.07em] text-muted-foreground">
          Por que essa obra ganhou
        </p>
        <ul className="flex flex-col gap-2">
          {ANCHOR.reasons.map((r) => (
            <li key={r} className="flex items-start gap-2 text-[12px] leading-snug">
              <Check className="mt-px size-3.5 shrink-0 text-emerald-400" />
              <span>{r}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="mt-3 border-t border-border pt-3">
        <div className="mb-2 flex items-center justify-between gap-2">
          <p className="text-[9px] font-bold uppercase tracking-[0.08em] text-muted-foreground">Tags da obra</p>
          <span className="flex items-center gap-2 text-[9px] text-muted-foreground">
            <span className="flex items-center gap-1">
              <span className="size-1.5 rounded-full bg-emerald-400" /> você ama
            </span>
            <span className="flex items-center gap-1">
              <span className="size-1.5 rounded-full bg-rose-400" /> você evita
            </span>
          </span>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {ANCHOR.tags.map((t) => (
            <span key={t.name} className={cn(CHIP_BASE, tagClass(t.stance))}>
              {t.name}
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}

function ProfileCard() {
  return (
    <div className={CARD_SHELL}>
      <div className="mb-2.5 flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-[9.5px] font-bold uppercase tracking-[0.11em] text-primary">
          <Sparkles className="size-3" /> Seu perfil de gosto
        </span>
        <span className="rounded-full bg-primary/14 px-2 py-[3px] text-[9.5px] font-bold uppercase tracking-[0.06em] text-primary ring-1 ring-primary/40">
          Perfil v3
        </span>
      </div>

      <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <span className="size-1.5 rounded-full bg-emerald-400" />
        aprendido de <b className="font-semibold text-foreground">{PROFILE.worksLearned}</b> que você avaliou ·{" "}
        <b className="font-semibold text-foreground">Saudável</b>
      </p>

      <p className="mt-3 border-l-2 border-primary/50! pl-3 text-[12px] italic leading-relaxed text-foreground/90">
        Você prefere <span className="not-italic font-semibold text-foreground">fantasia de nobreza</span> com heroínas
        reencarnadas que usam inteligência pra reescrever destinos trágicos — casamento de conveniência que vira amor
        genuíno, ML nobre e frio que se apaixona primeiro, com política e vingança ao fundo.
      </p>

      <div className="mt-3.5">
        <p className="mb-2.5 text-[9px] font-bold uppercase tracking-[0.08em] text-muted-foreground">
          Principais atributos e faixa ideal
        </p>
        <div className="grid grid-cols-2 gap-x-4">
          {PROFILE.criteria.slice(0, 2).map((c) => (
            <CriterionRange key={c.name} {...c} />
          ))}
        </div>
      </div>

      <div className="mt-3.5 grid grid-cols-4 gap-2">
        {PROFILE.kpis.map((k) => (
          <div key={k.l} className="rounded-[10px] border border-border bg-card/50 px-2 py-2">
            <div className={cn("text-[18px] font-black leading-none tabular-nums", k.tone)}>{k.n}</div>
            <div className="mt-1.5 text-[8px] font-semibold uppercase tracking-[0.05em] leading-tight text-muted-foreground">
              {k.l}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-3 border-t border-border pt-3">
        <p className="mb-2 text-[9px] font-bold uppercase tracking-[0.08em] text-muted-foreground">
          Você ama · você evita
        </p>
        <div className="flex flex-wrap items-center gap-1.5">
          {PROFILE.loved.map((t) => (
            <span key={t} className={cn(CHIP_BASE, "bg-emerald-500/12 text-emerald-300 ring-emerald-500/30")}>
              {t}
            </span>
          ))}
          <span className="text-[10.5px] text-muted-foreground">+{PROFILE.lovedMore}</span>
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          {PROFILE.avoided.map((t) => (
            <span
              key={t}
              className={cn(CHIP_BASE, "bg-rose-500/10 text-rose-300 line-through opacity-85 ring-rose-500/25")}
            >
              {t}
            </span>
          ))}
          <span className="text-[10.5px] text-muted-foreground">+{PROFILE.avoidedMore}</span>
        </div>
      </div>

      <p className="mt-3 border-t border-border pt-3 text-[11.5px] leading-relaxed text-muted-foreground">
        <span className="font-semibold text-foreground">Você busca:</span> heroínas que voltam ao passado pra reescrever
        o destino — vingança fria e romance que amadurece devagar.
      </p>
    </div>
  )
}

const CARDS = [
  { key: "rec", node: <RecommendationCard />, label: "Recomendação" },
  { key: "profile", node: <ProfileCard />, label: "Perfil de gosto" },
]

/** Carrossel da prévia do login: alterna entre a Recomendação e o Perfil de gosto. */
export function TastePreview() {
  const [i, setI] = useState(0)
  const go = (dir: number) => setI((prev) => (prev + dir + CARDS.length) % CARDS.length)

  return (
    <div className="w-full">
      {/* Os dois cards ocupam a MESMA célula do grid → a altura é a do mais alto e
          não pula ao alternar; o inativo fica transparente e sem interação. */}
      <div className="grid">
        {CARDS.map((c, idx) => (
          <div
            key={c.key}
            aria-hidden={idx !== i}
            className={cn(
              "col-start-1 row-start-1 transition-opacity duration-200",
              idx === i ? "opacity-100" : "pointer-events-none opacity-0",
            )}
          >
            {c.node}
          </div>
        ))}
      </div>

      <div className="mt-3 flex items-center justify-center gap-3">
        <button
          type="button"
          onClick={() => go(-1)}
          aria-label="Anterior"
          className="grid size-7 place-items-center rounded-full border border-border bg-card/60 text-muted-foreground transition-colors hover:text-foreground"
        >
          <ChevronLeft className="size-4" />
        </button>

        <div className="flex items-center gap-1.5">
          {CARDS.map((c, idx) => (
            <button
              key={c.key}
              type="button"
              onClick={() => setI(idx)}
              aria-label={c.label}
              aria-current={idx === i}
              className={cn(
                "h-1.5 rounded-full transition-all",
                idx === i ? "w-5 bg-primary" : "w-1.5 bg-muted-foreground/40 hover:bg-muted-foreground/70",
              )}
            />
          ))}
        </div>

        <button
          type="button"
          onClick={() => go(1)}
          aria-label="Próximo"
          className="grid size-7 place-items-center rounded-full border border-border bg-card/60 text-muted-foreground transition-colors hover:text-foreground"
        >
          <ChevronRight className="size-4" />
        </button>

        <span className="ml-1 text-[10px] text-muted-foreground">prévia</span>
      </div>
    </div>
  )
}
