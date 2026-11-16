"use client"

import { useLayoutEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { cn, titleToSlug } from "@/lib/utils"
import { CoverImage } from "@/components/ui/cover-image"
import { WorkContentChip } from "@/components/ui/work-content-chip"
import { ForceMeters } from "@/components/ranking/force-meters"
import { BussolaMap } from "@/components/ranking/bussola-map"
import { computeWorkForces, classifyArchetype, type ForceArchetype } from "@/lib/calculations/forces"
import { ARCHETYPE_LABEL, ARCHETYPE_MEANING, ARCHETYPE_ORDER } from "@/lib/ranking/tier-composition"
import { ARCHETYPE_STYLE, CORNER_ARCHETYPE } from "@/lib/ranking/archetype-style"
import type { BussolaDatum } from "@/lib/ranking/bussola-map"
import { getScoreTextColor } from "@/components/ui/score-badge"
import type { ScoreColorThresholds } from "@/components/ui/score-badge"

export type { BussolaDatum } from "@/lib/ranking/bussola-map"

/**
 * Bússola 2D. Dois contextos, controlados por `mode`:
 *   - "percentile" (/ranking): o MAPA DE CAPAS (`bussola-map.tsx`, redesenho de 16/11/2026) —
 *     capa no lugar do ponto, três pares de eixos, ligações ao clicar, tela inteira.
 *   - "absolute" (comparação de 2–10 obras, `WorkCompareDrawer`): posição = magnitude real, com o
 *     limiar de cada eixo ancorado no centro, tamanho = a 3ª força. Este arquivo.
 */

type ForceKey = "chance" | "avaliacao" | "alcance"
type PositionMode = "percentile" | "absolute"

const AXIS_LABEL: Record<ForceKey, string> = {
  chance: "Chance de você gostar",
  avaliacao: "Avaliação da crítica",
  alcance: "Alcance",
}
const FORCE_SHORT: Record<ForceKey, string> = { chance: "Chance", avaliacao: "Avaliação", alcance: "Alcance" }
const FORCE_DESC: Record<ForceKey, string> = {
  chance: "prob. calibrada de você gostar",
  avaliacao: "média da crítica externa",
  alcance: "popularidade (volume de votos)",
}
const FORCE_LEVEL: Record<ForceKey, { hi: string; lo: string }> = {
  chance: { hi: "muita chance", lo: "pouca chance" },
  avaliacao: { hi: "muito boa", lo: "fraca" },
  alcance: { hi: "popular", lo: "nichada" },
}
const FORCE_TEXT: Record<ForceKey, string> = {
  chance: "text-violet-600 dark:text-violet-400",
  avaliacao: "text-amber-600 dark:text-amber-400",
  alcance: "text-slate-500 dark:text-slate-400",
}
const FORCE_BORDER: Record<ForceKey, string> = {
  chance: "border-violet-500",
  avaliacao: "border-amber-500",
  alcance: "border-slate-400",
}

interface Preset {
  key: string
  label: string
  x: ForceKey
  y: ForceKey
  size: ForceKey
  tag: string
  lede: string
  note: string
  quad: { tr: string; br: string; tl: string; bl: string }
}

/**
 * ⚠️ Usado SÓ no modo "absolute" (WorkCompareDrawer). O /ranking desenha uma face
 * só — a primeira — e não mostra seletor. Os nomes de canto das faces 2 e 3
 * ("Joia escondida", "Consagrada"…) são vocabulário exclusivo da comparação; o
 * vocabulário do arquétipo vem de `tier-composition.ts`.
 */
const PRESETS: Preset[] = [
  {
    key: "ca", label: "Chance × Avaliação", x: "chance", y: "avaliacao", size: "alcance",
    tag: "Mapa principal",
    lede: "O quanto você deve gostar × o quanto a crítica gostou.",
    note: "Comece por aqui. Os quatro cantos são os tipos de aposta — e são eles que dão a cor de todos os pontos, em qualquer face.",
    quad: { tr: "Aposta segura", br: "Teu nicho", tl: "Alto potencial", bl: "Provável pular" },
  },
  {
    key: "cp", label: "Chance × Alcance", x: "chance", y: "alcance", size: "avaliacao",
    tag: "Descoberta",
    lede: "Teu gosto × o quão conhecida a obra é.",
    note: "Acha joias escondidas (você curte, pouca gente conhece) embaixo à direita, e o mainstream do teu tipo no canto superior direito.",
    quad: { tr: "Mainstream do teu tipo", br: "Joia escondida", tl: "Hype fora do perfil", bl: "Fundo de catálogo" },
  },
  {
    key: "ap", label: "Avaliação × Alcance", x: "avaliacao", y: "alcance", size: "chance",
    tag: "Panorama externo",
    lede: "Crítica × popularidade — sem o teu gosto na conta.",
    note: "Separa as consagradas (aclamadas e populares) das cults subvalorizadas (aclamadas, mas ainda pouco conhecidas).",
    quad: { tr: "Consagrada", br: "Cult / subvalorizada", tl: "Popular e divisiva", bl: "Fundo de catálogo" },
  },
]

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

/**
 * Diâmetro do ponto, a partir de um valor JÁ normalizado em [0,1].
 *
 * Interpola a ÁREA, não o diâmetro: "maior" é lido pela área do disco, e
 * interpolar diâmetro linearmente comprime justamente o meio da escala.
 *
 * ⚠️ Quem normaliza é o chamador, e essa é a parte que importa — ver `dots`. A
 * escala anterior era `10 + (v/100) * 18` com `v` ABSOLUTO, e o tamanho ficava
 * praticamente constante: Alcance é log de votos, então metade do acervo cabe
 * entre 74 e 87 pontos, o que dava 2,4 px de diferença de diâmetro (medido nas
 * 42 obras do topo do ranking, 2026-08-06). A 3ª força existia sem informar nada.
 */
const DOT_MIN_PX = 9
const DOT_MAX_PX = 34
const dotSizePx = (unit: number) =>
  Math.sqrt(DOT_MIN_PX ** 2 + clamp(unit, 0, 1) * (DOT_MAX_PX ** 2 - DOT_MIN_PX ** 2))

/**
 * 🔴 **Empate exato = mesmo pixel, e empate exato aqui é COMUM, não raro.**
 * `computeWorkForces` ARREDONDA as duas forças pra inteiro (chance =
 * `round(chance_score)`, avaliação = `round(platform_avg × 10)`) antes de virar
 * percentil — então valores diferentes viram a MESMA coordenada. Medido em
 * 2026-08-08 sobre as 40 obras do topo: dois pares caem no mesmo ponto (ex.:
 * chance 56,04 e 56,32 → 56, com nota 8,1061 e 8,0987 → 81).
 *
 * Empilhados, os dois desenham um ANEL — a mesma imagem do ponto aceso, que foi
 * lida como estado e não como colisão — e o menor pode sumir inteiro atrás do
 * maior, invisível e sem hover, aparecendo só na lista ao lado.
 *
 * Aqui os empatados se afastam num círculo em volta do ponto real. Duas amarras:
 * o raio é no máximo 40% de UM passo de percentil (`100/n`), então o empate se
 * resolve DENTRO da célula dele; e nunca atravessa a mediana, senão a cor (que
 * vem do quadrante) discordaria da posição — plausível e errado, a família de
 * bug que este arquivo inteiro tenta evitar.
 *
 * Quem garante que ninguém some é a ORDEM DE DESENHO (ver `byDrawOrder`); este
 * aqui é o que faz duas obras parecerem duas.
 */
const TIE_SPREAD_MAX_PCT = 1.2

/** Mantém o ponto do lado da mediana em que o percentil dele o colocou. */
const keepSideOfMedian = (original: number, moved: number) =>
  clamp(original >= 50 ? Math.max(50, moved) : Math.min(50, moved), 0, 100)

function spreadTies<T extends { xPct: number; yPct: number }>(list: T[]): T[] {
  const groups = new Map<string, T[]>()
  for (const d of list) {
    const key = `${d.xPct}|${d.yPct}`
    const g = groups.get(key)
    if (g) g.push(d)
    else groups.set(key, [d])
  }
  // Sem empate nenhum, o caminho fica byte a byte o de antes.
  if (groups.size === list.length) return list

  const radius = Math.min(TIE_SPREAD_MAX_PCT, (100 / Math.max(list.length, 1)) * 0.4)
  const moved = new Map<T, { xPct: number; yPct: number }>()
  for (const group of groups.values()) {
    if (group.length < 2) continue
    group.forEach((d, i) => {
      // Começa na diagonal: um par empatado se separa nos DOIS eixos por igual,
      // em vez de fingir diferença só na chance (ou só na nota).
      const angle = (2 * Math.PI * i) / group.length + Math.PI / 4
      moved.set(d, {
        xPct: keepSideOfMedian(d.xPct, d.xPct + radius * Math.cos(angle)),
        yPct: keepSideOfMedian(d.yPct, d.yPct + radius * Math.sin(angle)),
      })
    })
  }
  return list.map((d) => {
    const m = moved.get(d)
    return m ? { ...d, ...m } : d
  })
}

/** Limiar absoluto (0–100) de cada força — a linha do meio no modo "absolute". */
const FORCE_THRESHOLD: Record<ForceKey, number> = { chance: 50, avaliacao: 65, alcance: 50 }

/**
 * Mapeia a magnitude crua (0–100) pra posição no plano ancorando o limiar da
 * força em 50% (piecewise).
 */
const absPos = (v: number | null, thr: number) => {
  if (v == null) return 50
  const c = clamp(v, 0, 100)
  return c <= thr ? (c / thr) * 50 : 50 + ((c - thr) / (100 - thr)) * 50
}

/** Legenda de canto do modo absoluto — fora do plano, pra nunca cobrir um ponto. */
function QuadCap({ arch, name, hint, align }: { arch: ForceArchetype; name: string; hint: string; align: "left" | "right" }) {
  const style = ARCHETYPE_STYLE[arch]
  return (
    <div className={cn("inline-flex items-start gap-2", align === "right" && "flex-row-reverse text-right")}>
      <span
        className={cn("mt-0.5 size-2.5 flex-none rounded-full", style.dot)}
        style={{ boxShadow: `0 0 0 3px ${style.glow.replace(/0\.\d+\)/, "0.16)")}` }}
      />
      <div className={cn("flex flex-col leading-tight", align === "right" && "items-end")}>
        <span className="text-[13px] font-bold tracking-tight text-foreground">{name}</span>
        <span className="mt-0.5 font-mono text-[10px] text-muted-foreground">{hint}</span>
      </div>
    </div>
  )
}

export function BussolaPlane({
  entries,
  mode = "percentile",
  grouped = false,
  thresholds,
}: {
  entries: BussolaDatum[]
  mode?: PositionMode
  /** "Agrupar" da barra (só no /ranking): divide a lista do painel em prateleiras. */
  grouped?: boolean
  /**
   * Faixas de cor da Nota Prevista (`scoreThresholds.expected`), pra ela sair com a MESMA cor da
   * badge no resto do app. Omitido → cutoffs fixos do `ScoreBadge`, que é o fallback dele.
   */
  thresholds?: ScoreColorThresholds | null
}) {
  if (mode === "percentile") return <BussolaMap entries={entries} grouped={grouped} thresholds={thresholds} />
  return <AbsolutePlane entries={entries} thresholds={thresholds} />
}

/** Modo de comparação: as três faces, legendas fora do plano, sem lista lateral. */
function AbsolutePlane({ entries, thresholds }: { entries: BussolaDatum[]; thresholds?: ScoreColorThresholds | null }) {
  const [presetKey, setPresetKey] = useState("ca")
  const [hovered, setHovered] = useState<string | null>(null)
  const preset = PRESETS.find((p) => p.key === presetKey)!

  const planeRef = useRef<HTMLDivElement>(null)
  const plotRef = useRef<HTMLDivElement>(null)
  const tipRef = useRef<HTMLDivElement>(null)
  const [tipPos, setTipPos] = useState<{ left: number; top: number } | null>(null)

  const dots = useMemo(
    () =>
      spreadTies(
        entries
          .map((e) => ({
            e,
            forces: computeWorkForces({ chanceScore: e.chanceScore, platformAvg: e.platformAvg, totalVotes: e.totalVotes }),
          }))
          .filter((d) => d.forces[preset.x] != null && d.forces[preset.y] != null)
          .map((d) => ({
            ...d,
            xPct: absPos(d.forces[preset.x], FORCE_THRESHOLD[preset.x]),
            yPct: absPos(d.forces[preset.y], FORCE_THRESHOLD[preset.y]),
            size: dotSizePx((d.forces[preset.size] ?? 0) / 100),
            arch: classifyArchetype(d.forces.chance, d.forces.avaliacao),
          })),
      ),
    [entries, preset.x, preset.y, preset.size],
  )

  const hoveredDot = hovered ? dots.find((d) => d.e.workId === hovered) : null

  /** Posiciona o card acima do ponto, com flip/clamp nas bordas. */
  useLayoutEffect(() => {
    if (!hoveredDot || !planeRef.current || !plotRef.current || !tipRef.current) {
      setTipPos(null)
      return
    }
    const pr = planeRef.current.getBoundingClientRect()
    const ar = plotRef.current.getBoundingClientRect()
    const tw = tipRef.current.offsetWidth
    const th = tipRef.current.offsetHeight
    const dotSize = hoveredDot.size
    const cx = (ar.width * hoveredDot.xPct) / 100
    const cyTop = ar.top - pr.top + ar.height * (1 - hoveredDot.yPct / 100)
    const left = clamp(cx - tw / 2, 8, Math.max(8, pr.width - tw - 8))
    let top = cyTop - th - dotSize / 2 - 10
    if (top < 8) top = cyTop + dotSize / 2 + 10 // flip pra baixo perto do topo
    setTipPos({ left, top })
  }, [hovered, hoveredDot, preset.size])

  const counts = useMemo(() => {
    const c: Record<ForceArchetype, number> = { safe: 0, niche: 0, upside: 0, skip: 0 }
    for (const d of dots) c[d.arch]++
    return c
  }, [dots])

  const lvl = (k: ForceKey, hi: boolean) => FORCE_LEVEL[k][hi ? "hi" : "lo"]
  const cornerHint = (xHi: boolean, yHi: boolean) => `${lvl(preset.x, xHi)} · ${lvl(preset.y, yHi)}`

  const quadName = (d: (typeof dots)[number]) => {
    const right = d.xPct >= 50
    const top = d.yPct >= 50
    return top ? (right ? preset.quad.tr : preset.quad.tl) : right ? preset.quad.br : preset.quad.bl
  }
  const quadArrow = (d: (typeof dots)[number]) => {
    const right = d.xPct >= 50
    const top = d.yPct >= 50
    return top ? (right ? "↗" : "↖") : right ? "↘" : "↙"
  }

  // ---------------------------------------------------------------- modo absoluto
  // (WorkCompareDrawer) — as três faces, legendas fora do plano, sem lista lateral.
  return (
    <div className="flex flex-col gap-3">
      <div className="overflow-hidden rounded-2xl border border-border bg-card/60 shadow-sm">
        <div className="border-b border-border bg-muted/30 p-4">
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-2">
              <span className="font-mono text-[10.5px] font-bold uppercase tracking-[0.08em] text-muted-foreground">Eixos</span>
              <div className="flex flex-wrap gap-1 border-b border-border">
                {PRESETS.map((p) => {
                  const on = presetKey === p.key
                  return (
                    <button
                      key={p.key}
                      type="button"
                      onClick={() => setPresetKey(p.key)}
                      aria-pressed={on}
                      className={cn(
                        "-mb-px cursor-pointer rounded-t-lg px-3 py-2 text-sm font-semibold transition-colors",
                        on
                          ? "bg-card text-foreground shadow-[inset_0_-2px_0_hsl(var(--primary))]"
                          : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                      )}
                    >
                      {p.label}
                    </button>
                  )
                })}
              </div>
            </div>

            <div className="flex flex-col gap-2.5">
              <div className="flex flex-wrap items-center gap-2.5">
                <span className="rounded-md bg-violet-500/10 px-1.5 py-1 font-mono text-[9px] font-bold uppercase tracking-[0.08em] text-violet-600 dark:text-violet-400">
                  {preset.tag}
                </span>
                <p className="text-[13px] text-muted-foreground">{preset.lede}</p>
              </div>
              <div className="flex flex-col gap-1.5">
                {([["→ horizontal", preset.x], ["↑ vertical", preset.y], ["● tamanho", preset.size]] as const).map(
                  ([role, key]) => (
                    <div
                      key={role}
                      className={cn(
                        "grid grid-cols-[96px_88px_minmax(0,1fr)] items-center gap-3 rounded-r-lg border-l-[2.5px] bg-muted/40 py-2 pl-3 pr-2",
                        FORCE_BORDER[key],
                      )}
                    >
                      <span className="font-mono text-[9px] uppercase tracking-wide text-muted-foreground">{role}</span>
                      <span className={cn("text-[13px] font-bold", FORCE_TEXT[key])}>{FORCE_SHORT[key]}</span>
                      <span className="text-[11px] leading-tight text-muted-foreground">{FORCE_DESC[key]}</span>
                    </div>
                  ),
                )}
              </div>
              <p className="text-[11px] leading-relaxed text-muted-foreground">{preset.note}</p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-[34px_minmax(0,1fr)] gap-1 px-5 pb-4 pt-4">
          <div className="flex items-center justify-center">
            <span
              className={cn(
                "whitespace-nowrap font-mono text-[10px] uppercase tracking-wider [writing-mode:vertical-rl]",
                FORCE_TEXT[preset.y],
              )}
              style={{ transform: "rotate(180deg)" }}
            >
              <span className="text-muted-foreground/70">baixo</span> {AXIS_LABEL[preset.y]} ↑
            </span>
          </div>

          <div className="min-w-0">
            <div className="mb-2.5 flex items-start justify-between gap-3">
              <QuadCap arch={CORNER_ARCHETYPE.tl} name={preset.quad.tl} hint={`↖ ${cornerHint(false, true)}`} align="left" />
              <span className="self-center whitespace-nowrap font-mono text-[9px] uppercase tracking-wider text-muted-foreground/70">
                ↓ limiar
              </span>
              <QuadCap arch={CORNER_ARCHETYPE.tr} name={preset.quad.tr} hint={`↗ ${cornerHint(true, true)}`} align="right" />
            </div>

            <div
              ref={planeRef}
              className="relative aspect-[4/3] w-full overflow-hidden rounded-xl border border-border bg-muted/30"
              style={{
                backgroundImage:
                  "linear-gradient(rgba(128,128,150,0.06) 1px, transparent 1px), linear-gradient(90deg, rgba(128,128,150,0.06) 1px, transparent 1px)",
                backgroundSize: "12.5% 12.5%",
              }}
            >
              <QuadrantTints />
              <div className="absolute left-1/2 top-0 h-full w-px bg-border" />
              <div className="absolute left-0 top-1/2 h-px w-full bg-border" />
              {/* Sem inset aqui: as legendas deste modo já vivem fora do plano. */}
              <div ref={plotRef} className="absolute inset-0">
                {byDrawOrder(dots).map((d) => (
                  <Dot key={d.e.workId} d={d} onHover={setHovered} lit={hovered === d.e.workId} />
                ))}
              </div>

              {hoveredDot && (
                <DotTooltip
                  ref={tipRef}
                  d={hoveredDot}
                  pos={tipPos}
                  thresholds={thresholds}
                  // O chip acima nomeia o ARQUÉTIPO (constante entre as faces);
                  // isto aqui nomeia o canto da face que está na tela, que na 2ª
                  // e 3ª é outra coisa ("Joia escondida", "Consagrada").
                  note={
                    <span className={cn("inline-flex items-center gap-1 text-[10.5px] font-medium", ARCHETYPE_STYLE[hoveredDot.arch].text)}>
                      {quadArrow(hoveredDot)} {quadName(hoveredDot)}
                    </span>
                  }
                />
              )}

              {dots.length === 0 && (
                <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
                  Nenhuma obra com dados suficientes pra posicionar.
                </div>
              )}
            </div>

            <div className="mt-2.5 flex items-start justify-between gap-3">
              <QuadCap arch={CORNER_ARCHETYPE.bl} name={preset.quad.bl} hint={`↙ ${cornerHint(false, false)}`} align="left" />
              <QuadCap arch={CORNER_ARCHETYPE.br} name={preset.quad.br} hint={`↘ ${cornerHint(true, false)}`} align="right" />
            </div>

            <div className={cn("mt-2.5 flex items-center justify-center gap-2 font-mono text-[10px] uppercase tracking-wider", FORCE_TEXT[preset.x])}>
              <span className="text-muted-foreground/70">baixo</span> {AXIS_LABEL[preset.x]} →
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-border p-4 text-xs">
          {ARCHETYPE_ORDER.map((a) => (
            <span key={a} className={cn("inline-flex items-center gap-1.5", ARCHETYPE_STYLE[a].text)}>
              <span className={cn("size-2.5 rounded-full", ARCHETYPE_STYLE[a].dot)} />
              <b className="font-semibold capitalize text-foreground">{ARCHETYPE_LABEL[a]}</b>
              <span className="text-muted-foreground">· {ARCHETYPE_MEANING[a]} · {counts[a]}</span>
            </span>
          ))}
          <span className="ml-auto font-mono text-[11px] text-muted-foreground">
            posição = magnitude (limiar no centro) · tamanho = {FORCE_SHORT[preset.size]} · {dots.length} obras
          </span>
        </div>
      </div>
    </div>
  )
}

type PlottedDot = {
  e: BussolaDatum
  forces: ReturnType<typeof computeWorkForces>
  xPct: number
  yPct: number
  size: number
  arch: ForceArchetype
}

/**
 * Ordem de PINTURA (não de leitura): do maior pro menor, porque quem chega
 * depois fica por cima. É o que garante que um ponto pequeno nunca desapareça
 * atrás de um grande — antes disso, um par empilhado escondia uma obra inteira,
 * invisível e fora do alcance do mouse, e só a lista ao lado denunciava.
 *
 * ⚠️ Copia antes de ordenar: `dots` é consumido em outra ordem por quem conta os
 * cantos.
 */
const byDrawOrder = (list: PlottedDot[]) => [...list].sort((a, b) => b.size - a.size)

/** Degradê dos 4 quadrantes, no plano inteiro. */
function QuadrantTints() {
  const quads = [
    { arch: CORNER_ARCHETYPE.tr, place: "right-0 top-0 bg-gradient-to-bl" },
    { arch: CORNER_ARCHETYPE.br, place: "bottom-0 right-0 bg-gradient-to-tl" },
    { arch: CORNER_ARCHETYPE.tl, place: "left-0 top-0 bg-gradient-to-br" },
    { arch: CORNER_ARCHETYPE.bl, place: "bottom-0 left-0 bg-gradient-to-tr" },
  ]
  return (
    <>
      {quads.map(({ arch, place }) => (
        <div
          key={arch}
          className={cn(
            "pointer-events-none absolute h-1/2 w-1/2 to-transparent transition-opacity",
            place,
            ARCHETYPE_STYLE[arch].tint,
          )}
        />
      ))}
    </>
  )
}

function Dot({ d, onHover, lit }: { d: PlottedDot; onHover: (id: string | null) => void; lit?: boolean }) {
  const style = ARCHETYPE_STYLE[d.arch]
  const enter = () => onHover(d.e.workId)
  return (
    <Link
      href={`/catalog/${titleToSlug(d.e.title)}`}
      aria-label={`${d.e.title}: chance ${d.forces.chance ?? "—"}, avaliação ${d.forces.avaliacao ?? "—"}, alcance ${d.forces.alcance ?? "—"}`}
      onMouseEnter={enter}
      onMouseLeave={() => onHover(null)}
      onFocus={enter}
      onBlur={() => onHover(null)}
      className={cn(
        // Sem `focus-visible:ring`: o boxShadow inline abaixo VENCE a classe do
        // Tailwind, então aquele anel nunca chegou a aparecer — era proteção de
        // mentira. Quem marca o foco é o mesmo estado aceso, porque `onFocus`
        // também acende o ponto.
        "absolute -translate-x-1/2 translate-y-1/2 rounded-full border-[1.5px] border-background transition-opacity hover:z-20 focus-visible:z-20 focus-visible:outline-none",
        style.dot,
        lit && "z-30",
      )}
      style={{
        left: `${d.xPct}%`,
        bottom: `${d.yPct}%`,
        width: d.size,
        height: d.size,
        boxShadow: lit
            ? // 🔴 Anel NEUTRO de propósito. Na cor do arquétipo ele era idêntico
              // ao desenho que dois pontos empilhados fazem sozinhos — aceso e
              // empatado viravam a mesma imagem, e foi assim que uma colisão foi
              // lida como estado. Vindo do `--foreground`, nenhuma sobreposição
              // de pontos consegue imitar.
              `0 0 0 2px hsl(var(--background)), 0 0 0 4px hsl(var(--foreground)), 0 0 20px ${style.glow}`
            : `0 0 14px ${style.glow}`,
      }}
    />
  )
}

function DotTooltip({
  ref, d, pos, thresholds, note,
}: {
  ref: React.Ref<HTMLDivElement>
  d: PlottedDot
  pos: { left: number; top: number } | null
  /** Faixas de cor da Nota Prevista (as de /preferences). Ausentes → cutoffs fixos. */
  thresholds?: ScoreColorThresholds | null
  /** Linha extra sob o chip — o canto da FACE atual, que só existe no modo absoluto. */
  note?: React.ReactNode
}) {
  const style = ARCHETYPE_STYLE[d.arch]
  return (
    <div
      ref={ref}
      /**
       * 320px, não 268: com a capa (52) + respiros, os 268 deixavam ~126px pro
       * título, e título de obra aqui é longo — "The Acting Empress Still Spends
       * the First Night" saía em QUATRO linhas. O card é transiente e
       * reposicionado por medição (`offsetWidth`), então crescer não custa nada;
       * o `max-w` cobre o plano estreito, que tem `overflow-hidden` e cortaria.
       */
      className="pointer-events-none absolute z-40 w-[320px] max-w-[calc(100%-16px)] overflow-hidden rounded-xl border border-border bg-card shadow-xl transition-opacity"
      style={{ left: pos?.left ?? 0, top: pos?.top ?? 0, opacity: pos ? 1 : 0 }}
    >
      <div className="flex gap-3 p-3">
        <CoverImage urls={d.e.coverUrls} alt="" className="h-[74px] w-[52px] flex-none rounded-md object-cover shadow" />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          {/* `overflow-hidden` = contém o float (senão ele vaza por cima da linha
              de ano/status quando o título tem uma linha só). */}
          <div className="overflow-hidden break-words text-pretty text-[13.5px] font-semibold leading-tight">
            {/* A Nota Prevista é o DESFECHO da leitura do ponto (as 3 forças são o
                caminho), então ela abre o card em vez de fechá-lo. A cor sai de
                `getScoreTextColor` — a mesma régua da badge do /ranking e da
                página da obra, com as faixas configuradas em /preferences.
                Inventar uma cor aqui seria uma 2ª régua pro mesmo número, que é
                como duas telas passam a discordar.
                ⚠️ FLOAT, não item de flex: ao lado, ela encolhia TODAS as linhas
                do título; flutuando, encolhe só as duas que ficam ao lado dela e
                o resto do título usa a largura inteira. */}
            <span className="float-right ml-2 flex flex-col items-end leading-none">
              <span className="font-mono text-[8.5px] uppercase tracking-wider text-muted-foreground/70">
                prevista
              </span>
              <span
                className={cn(
                  "mt-0.5 font-mono text-[16px] font-bold tabular-nums",
                  getScoreTextColor(d.e.expectedScore, thresholds),
                )}
              >
                {d.e.expectedScore != null ? d.e.expectedScore.toFixed(1).replace(".", ",") : "—"}
              </span>
            </span>
            {d.e.title}
          </div>
          <div className="flex flex-wrap items-center gap-1.5 font-mono text-[10.5px] text-muted-foreground">
            {d.e.year != null && <span>{d.e.year}</span>}
            {d.e.year != null && (d.e.publicationStatusShort ?? d.e.publicationStatus) && <span>·</span>}
            {(d.e.publicationStatusShort ?? d.e.publicationStatus) && (
              <span className="inline-flex items-center gap-1">
                <span
                  className="size-1.5 rounded-full"
                  style={{ background: d.e.publicationStatusColor ?? "currentColor" }}
                />
                {d.e.publicationStatusShort ?? d.e.publicationStatus}
              </span>
            )}
            <WorkContentChip isAdult={d.e.isAdult} isMixed={d.e.isMixed} className="px-1.5 py-0 text-[10px] font-sans" />
          </div>
          <span
            className={cn(
              "mt-0.5 inline-flex items-center gap-1.5 self-start rounded-full px-2 py-0.5 text-[11px] font-semibold capitalize",
              style.text,
            )}
            style={{ backgroundColor: style.glow.replace(/0\.\d+\)/, "0.14)") }}
          >
            <span className={cn("size-1.5 rounded-full", style.dot)} />
            {ARCHETYPE_LABEL[d.arch]}
          </span>
          {note}
        </div>
      </div>
      <div className="px-3 pb-3">
        <ForceMeters forces={d.forces} size="sm" />
      </div>
      {/* Rodapé = o CRU das duas forças externas. Os medidores mostram a versão
          normalizada (0–100), que é o que posiciona o ponto — mas "86" não é uma
          nota e "93" não é um número de votos, e é o cru que a pessoa compara
          com a plataforma de onde o dado veio. Exato de propósito: o tooltip é a
          lupa; a forma compacta ("23,9K") é das listas, onde falta espaço. */}
      <div className="flex items-center justify-between gap-2 border-t border-border bg-muted/40 px-3 py-2 font-mono text-[11px] text-muted-foreground">
        <span>
          Nota externa{" "}
          <b className="text-[12.5px] font-bold text-foreground">
            {d.e.platformAvg != null ? d.e.platformAvg.toFixed(1).replace(".", ",") : "—"}
          </b>
        </span>
        <span>
          {d.e.totalVotes > 0 ? (
            <>
              <b className="text-[12.5px] font-bold text-foreground">{d.e.totalVotes.toLocaleString("pt-BR")}</b> votos
            </>
          ) : (
            "sem votos"
          )}
        </span>
      </div>
    </div>
  )
}
