"use client"

import { useLayoutEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { ChevronDown, HelpCircle } from "lucide-react"
import { cn, titleToSlug } from "@/lib/utils"
import { CoverImage } from "@/components/ui/cover-image"
import { AdultBadge } from "@/components/ui/adult-badge"
import { ForceMeters } from "@/components/ranking/force-meters"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Button } from "@/components/ui/button"
import { computeWorkForces, classifyArchetype, classifyArchetypeByPercentile, type ForceArchetype } from "@/lib/calculations/forces"
import { ARCHETYPE_LABEL, ARCHETYPE_MEANING, ARCHETYPE_ORDER } from "@/lib/ranking/tier-composition"
import { ARCHETYPE_STYLE, CORNER_ARCHETYPE } from "@/lib/ranking/archetype-style"
import { getScoreTextColor } from "@/components/ui/score-badge"
import type { ScoreColorThresholds } from "@/components/ui/score-badge"

/**
 * Bússola 2D — o plano de decisão da feature (ver PLANO-BUSSOLA-3-FORCAS.md).
 * Cada obra é um ponto: posição = Chance × Avaliação, tamanho = Alcance.
 *
 * Serve dois contextos, controlados por `mode`:
 *   - "percentile" (/ranking): posição = percentil no acervo exibido — espalha o
 *     catálogo comprimido; mediana no centro. UMA face só, e os quatro cantos são
 *     FILTROS clicáveis.
 *   - "absolute" (comparação de 2–10 obras): posição = magnitude real, com o
 *     limiar de cada eixo ancorado no centro. Mantém as TRÊS faces — com poucas
 *     obras, cruzar Alcance é leitura de verdade, não curiosidade.
 *
 * Redesenho 2026-08-06 (só o ramo percentile):
 *   - as abas de face somem; sobra Chance × Avaliação
 *   - os 4 cantos viram filtro e matam a coluna "Foco"
 *   - lista pareada ao lado: hover no ponto acende a linha e vice-versa
 *   - toda a instrução colapsa no "?"
 *   - teto de exibição (ver MAX_PLOT)
 */

type ForceKey = "chance" | "avaliacao" | "alcance"
type PositionMode = "percentile" | "absolute"

/**
 * Dado mínimo que a Bússola consome. `RankingEntry` (do /ranking) satisfaz esta
 * forma estruturalmente; o WorkCompareDrawer mapeia CompareWork pra cá.
 */
export interface BussolaDatum {
  workId: string
  title: string
  coverUrl: string | null
  year: number | null
  /**
   * Classificação da obra (`works.is_adult`). OBRIGATÓRIO de propósito: opcional,
   * um consumidor novo esqueceria de mapear e a Bússola dele ficaria sem o selo
   * **sem erro nenhum** — como já aconteceu com o `WorkCompareDrawer`, que só
   * ganhou o campo quando o `tsc` reprovou.
   */
  isAdult: boolean
  publicationStatus?: string | null
  publicationStatusShort?: string | null
  publicationStatusColor?: string | null
  chanceScore: number | null
  platformAvg: number | null
  totalVotes: number
  expectedScore: number | null
}

/**
 * 🔴 **Teto de pontos no plano — medido, não escolhido.** O plano fica legível
 * enquanto os pontos não se empilham, e a degradação NÃO é gradual (medido em
 * 2026-08-06 sobre o catálogo real, plano de 820×615):
 *
 *   40 obras (o `top_n` padrão) →  13 alturas distintas ·  10,0% dos pontos colidindo
 *   100 obras                   →  15 alturas          ·  12,0%
 *   965 obras (catálogo todo)   →  23 alturas          ·  52,6%  ← mancha listrada
 *
 * O eixo Y é `platform_avg × 10` arredondado num acervo curado: são só ~23 valores
 * distintos em todo o catálogo. Sem teto, afrouxar o filtro transforma a view numa
 * mancha SEM AVISO — e o sintoma (listras) não se parece com a causa (filtro largo).
 * Com teto, a barra diz quantas estão sendo desenhadas.
 */
const MAX_PLOT = 100

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
  /** "Agrupar" da barra: divide a LISTA LATERAL em prateleiras. O plano não muda. */
  grouped?: boolean
  /**
   * Faixas de cor da Nota Prevista (`scoreThresholds.expected`), pra ela sair no
   * tooltip com a MESMA cor da badge no resto do app. Omitido → cutoffs fixos do
   * `ScoreBadge`, que é o fallback documentado dele.
   */
  thresholds?: ScoreColorThresholds | null
}) {
  const [presetKey, setPresetKey] = useState("ca")
  const [hovered, setHovered] = useState<string | null>(null)
  const [focusArch, setFocusArch] = useState<ForceArchetype | null>(null)
  const preset = mode === "absolute" ? PRESETS.find((p) => p.key === presetKey)! : PRESETS[0]

  const planeRef = useRef<HTMLDivElement>(null)
  const plotRef = useRef<HTMLDivElement>(null)
  const tipRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const [tipPos, setTipPos] = useState<{ left: number; top: number } | null>(null)

  // Teto: no /ranking o plano desenha no máximo MAX_PLOT obras, na ordem que já
  // veio. Na comparação (2–10 obras) ele nunca é atingido.
  const capped = mode === "percentile" && entries.length > MAX_PLOT
  const plotted = capped ? entries.slice(0, MAX_PLOT) : entries

  const dots = useMemo(() => {
    const base = plotted
      .map((e) => ({
        e,
        forces: computeWorkForces({ chanceScore: e.chanceScore, platformAvg: e.platformAvg, totalVotes: e.totalVotes }),
      }))
      .filter((d) => d.forces[preset.x] != null && d.forces[preset.y] != null)

    if (mode === "absolute") {
      return spreadTies(
        base.map((d) => ({
          ...d,
          xPct: absPos(d.forces[preset.x], FORCE_THRESHOLD[preset.x]),
          yPct: absPos(d.forces[preset.y], FORCE_THRESHOLD[preset.y]),
          size: dotSizePx((d.forces[preset.size] ?? 0) / 100),
          arch: classifyArchetype(d.forces.chance, d.forces.avaliacao),
        })),
      )
    }

    // Posição = PERCENTIL dentro do acervo exibido. Sem isso, o catálogo
    // comprimido (Avaliação toda em 70–95) empilha tudo numa faixa e metade do
    // plano fica vazia. Percentil espalha (mediana no centro). midrank pra empates.
    const percentileFn = (key: ForceKey) => {
      const vals = base
        .map((d) => d.forces[key])
        .filter((v): v is number => v != null)
        .sort((a, b) => a - b)
      return (v: number | null) => {
        if (v == null || vals.length === 0) return 50
        let less = 0
        let eq = 0
        for (const x of vals) {
          if (x < v) less++
          else if (x === v) eq++
        }
        return ((less + eq / 2) / vals.length) * 100
      }
    }
    const pctX = percentileFn(preset.x)
    const pctY = percentileFn(preset.y)
    const pctSize = percentileFn(preset.size)

    return spreadTies(
      base.map((d) => ({
        ...d,
        xPct: pctX(d.forces[preset.x]),
        yPct: pctY(d.forces[preset.y]),
        // TAMANHO = percentil também: a 3ª força é tão comprimida quanto os eixos.
        // O número cru continua no tooltip e no aria-label — o tamanho ordena, não mede.
        size: dotSizePx(pctSize(d.forces[preset.size]) / 100),
        // Face principal: x = Chance e y = Avaliação, então o percentil do eixo JÁ É
        // o percentil da força. Reusar pctX/pctY evita recalcular a mesma coisa e
        // garante que a cor não possa divergir do quadrante. ⚠️ Sai do percentil
        // CRU, antes do desempate de posição — o afastamento é cosmético e não
        // pode mudar o quadrante de ninguém.
        arch: classifyArchetypeByPercentile(pctX(d.forces.chance), pctY(d.forces.avaliacao)),
      })),
    )
  }, [plotted, preset.x, preset.y, preset.size, mode])

  const hoveredDot = hovered ? dots.find((d) => d.e.workId === hovered) : null

  /**
   * Posiciona o card acima do ponto, com flip/clamp nas bordas.
   *
   * ⚠️ Mede a ÁREA DE PLOTAGEM, não o plano: elas têm alturas diferentes (a
   * plotagem é menor, ver `PLOT_INSET`). Usar o retângulo do plano deslocaria o
   * tooltip verticalmente em ~64px, e o erro cresceria com o zoom.
   */
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

  /** Rola só o container da lista até a linha — nunca a página. */
  const revealRow = (workId: string) => {
    const body = listRef.current
    if (!body) return
    const row = body.querySelector<HTMLElement>(`[data-work="${CSS.escape(workId)}"]`)
    if (!row) return
    const rb = row.getBoundingClientRect()
    const bb = body.getBoundingClientRect()
    const stickyPad = 28 // cabeçalho de prateleira
    if (rb.top < bb.top + stickyPad) body.scrollTop += rb.top - bb.top - stickyPad
    else if (rb.bottom > bb.bottom) body.scrollTop += rb.bottom - bb.bottom
  }

  const visible = focusArch ? dots.filter((d) => d.arch === focusArch) : dots

  if (mode === "percentile") {
    return (
      <PercentilePlane
        dots={dots}
        visible={visible}
        counts={counts}
        focusArch={focusArch}
        setFocusArch={setFocusArch}
        grouped={grouped}
        hovered={hovered}
        setHovered={setHovered}
        hoveredDot={hoveredDot}
        tipPos={tipPos}
        planeRef={planeRef}
        plotRef={plotRef}
        tipRef={tipRef}
        listRef={listRef}
        revealRow={revealRow}
        capped={capped}
        total={entries.length}
        thresholds={thresholds}
      />
    )
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
 * cantos e por quem lista.
 */
const byDrawOrder = (list: PlottedDot[]) => [...list].sort((a, b) => b.size - a.size)

/**
 * 🔴 **A faixa reservada existe para nenhum ponto ficar ATRÁS de um rótulo.**
 *
 * As legendas de canto viviam FORA do plano justamente por isso (redesenho de
 * 2026-07-08). Ao virarem filtro, elas voltaram para dentro — e a sobreposição
 * voltou junto. A saída é a área de plotagem ser menor que o plano:
 *
 *   76px = 9 (offset da borda) + 46 (rótulo de ATÉ 2 linhas) + 17 (raio do maior
 *          ponto, o ⌀ 34 do #322) + 4 de folga
 *
 * ⚠️ O `line-clamp-2` da frase do rótulo é o que sustenta essa conta: com três
 * linhas o rótulo cresce ~12px e volta a cobrir ponto. Verificado varrendo toda a
 * borda com o ponto de diâmetro máximo em três larguras: zero sobreposições.
 *
 * Comprimir o eixo não distorce nada — a posição é PERCENTIL, ou seja ordinal.
 */
const PLOT_INSET = 76

function PercentilePlane({
  dots, visible, counts, focusArch, setFocusArch, grouped,
  hovered, setHovered, hoveredDot, tipPos,
  planeRef, plotRef, tipRef, listRef, revealRow, capped, total, thresholds,
}: {
  dots: PlottedDot[]
  visible: PlottedDot[]
  counts: Record<ForceArchetype, number>
  focusArch: ForceArchetype | null
  setFocusArch: (a: ForceArchetype | null) => void
  grouped: boolean
  hovered: string | null
  setHovered: (id: string | null) => void
  hoveredDot: PlottedDot | null | undefined
  tipPos: { left: number; top: number } | null
  planeRef: React.RefObject<HTMLDivElement | null>
  plotRef: React.RefObject<HTMLDivElement | null>
  tipRef: React.RefObject<HTMLDivElement | null>
  listRef: React.RefObject<HTMLDivElement | null>
  revealRow: (workId: string) => void
  capped: boolean
  total: number
  thresholds?: ScoreColorThresholds | null
}) {
  const corners = [
    { pos: "tl" as const, arch: CORNER_ARCHETYPE.tl, place: "left-2 top-2" },
    { pos: "tr" as const, arch: CORNER_ARCHETYPE.tr, place: "right-2 top-2" },
    { pos: "bl" as const, arch: CORNER_ARCHETYPE.bl, place: "bottom-2 left-2" },
    { pos: "br" as const, arch: CORNER_ARCHETYPE.br, place: "bottom-2 right-2" },
  ]

  return (
    <div className="flex flex-col gap-3">
      <div className="overflow-hidden rounded-2xl border border-border bg-card/60 shadow-sm">
        <div className="flex flex-wrap items-center gap-2 border-b border-border bg-muted/30 px-4 py-2">
          <span className="font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
            Chance × Avaliação
          </span>
          <span className="text-[11.5px] text-muted-foreground">
            {capped ? (
              <>
                mostrando as <b className="font-semibold text-foreground">{dots.length}</b> primeiras de {total} —
                acima disso os pontos se empilham
              </>
            ) : (
              "clique num canto pra focar · passe o mouse pra ligar ponto e linha"
            )}
          </span>
          <div className="ml-auto flex items-center gap-2">
            {focusArch && (
              <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setFocusArch(null)}>
                Ver tudo
              </Button>
            )}
            <HowToRead />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 p-4 lg:grid-cols-[minmax(0,1fr)_300px]">
          {/* Coluna estreita à esquerda = régua do eixo Y, gêmea da do X que fica
              embaixo. Sem ela o plano só diz o que a HORIZONTAL significa, e a
              vertical — que é metade da decisão — vira decoração. */}
          <div className="grid min-w-0 grid-cols-[15px_minmax(0,1fr)] gap-x-1.5">
            <div
              className="flex items-center justify-between py-1 font-mono text-[9px] font-bold uppercase tracking-wider text-muted-foreground/70 [writing-mode:vertical-rl]"
              style={{ transform: "rotate(180deg)" }}
            >
              {/* Comparativo, nunca absoluto: o corte é a MEDIANA do que está na
                  tela, então "pior avaliada" quer dizer "pior que as outras 39". */}
              <span>← pior avaliada pela crítica</span>
              <span className="text-muted-foreground/60">mediana</span>
              <span>melhor avaliada →</span>
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
              {/* Tints e cruz no PLANO INTEIRO: o degradê tem que chegar à borda,
                  senão a faixa reservada fica lisa e a emenda vira uma linha
                  horizontal visível. Como a área de plotagem é centrada (mesmo
                  inset em cima e embaixo), o meio dela coincide com o meio do
                  plano — a cruz da mediana segue alinhada com os pontos. */}
              <QuadrantTints focusArch={focusArch} />
              <div className="absolute left-1/2 top-0 h-full w-px bg-border" />
              <div className="absolute left-0 top-1/2 h-px w-full bg-border" />

              {corners.map(({ pos, arch, place }) => {
                const style = ARCHETYPE_STYLE[arch]
                const on = focusArch === arch
                return (
                  <button
                    key={pos}
                    type="button"
                    aria-pressed={on}
                    onClick={() => setFocusArch(on ? null : arch)}
                    className={cn(
                      "absolute z-20 max-w-[46%] cursor-pointer rounded-lg border bg-card/85 px-2 py-1 text-left backdrop-blur transition-colors",
                      place,
                      on ? style.border : "border-border hover:border-muted-foreground",
                    )}
                  >
                    <span className="flex items-center gap-1.5">
                      <span className={cn("size-[7px] flex-none rounded-full", style.dot)} />
                      <span className={cn("text-[11.5px] font-bold leading-tight first-letter:uppercase", style.text)}>
                        {ARCHETYPE_LABEL[arch]}
                      </span>
                      <span className={cn("rounded px-1 py-px text-[9.5px] font-bold tabular-nums", style.chipBg)}>
                        {counts[arch]}
                      </span>
                    </span>
                    {/* line-clamp-2 NÃO é estética: PLOT_INSET foi dimensionado
                        para um rótulo de no máximo duas linhas. */}
                    <span className="mt-0.5 line-clamp-2 max-w-[186px] text-[9.5px] font-medium leading-tight text-muted-foreground">
                      {ARCHETYPE_MEANING[arch]}
                    </span>
                  </button>
                )
              })}

              <div
                ref={plotRef}
                className="absolute inset-x-0"
                style={{ top: PLOT_INSET, bottom: PLOT_INSET }}
              >
                {byDrawOrder(dots).map((d) => (
                  <Dot
                    key={d.e.workId}
                    d={d}
                    onHover={setHovered}
                    onHoverExtra={revealRow}
                    dimmed={focusArch != null && d.arch !== focusArch}
                    lit={hovered === d.e.workId}
                  />
                ))}
              </div>

              {/* Sem `note`: nesta face o canto É o arquétipo, e o chip do
                  cabeçalho já o nomeia — repetir no rodapé só ocuparia a linha
                  que agora mostra o número cru. */}
              {hoveredDot && <DotTooltip ref={tipRef} d={hoveredDot} pos={tipPos} thresholds={thresholds} />}

              {dots.length === 0 && (
                <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
                  Nenhuma obra com dados suficientes pra posicionar.
                </div>
              )}
            </div>

            {/* célula vazia sob a régua do Y — sem ela a do X escorrega pra
                coluna 1 e sai desalinhada do plano que ela descreve */}
            <div aria-hidden />
            <div className="mt-2 flex items-center justify-between gap-2 font-mono text-[9px] font-bold uppercase tracking-wider text-muted-foreground/70">
              <span>← menos chance de você gostar</span>
              <span className="text-muted-foreground/60">mediana das {dots.length} na tela</span>
              <span>mais chance →</span>
            </div>
          </div>

          <PairedList
            ref={listRef}
            dots={visible}
            grouped={grouped}
            focusArch={focusArch}
            hovered={hovered}
            setHovered={setHovered}
          />
        </div>
      </div>
    </div>
  )
}

/** Degradê dos 4 quadrantes. Ocupa o plano inteiro — ver o comentário em PercentilePlane. */
function QuadrantTints({ focusArch }: { focusArch?: ForceArchetype | null }) {
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
            focusArch != null && focusArch !== arch && "opacity-25",
          )}
        />
      ))}
    </>
  )
}

function Dot({
  d, onHover, onHoverExtra, dimmed, lit,
}: {
  d: PlottedDot
  onHover: (id: string | null) => void
  onHoverExtra?: (id: string) => void
  dimmed?: boolean
  lit?: boolean
}) {
  const style = ARCHETYPE_STYLE[d.arch]
  const enter = () => {
    onHover(d.e.workId)
    onHoverExtra?.(d.e.workId)
  }
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
        dimmed ? "pointer-events-none opacity-[0.12]" : "opacity-100",
        lit && "z-30",
      )}
      style={{
        left: `${d.xPct}%`,
        bottom: `${d.yPct}%`,
        width: d.size,
        height: d.size,
        boxShadow: dimmed
          ? undefined
          : lit
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
        <CoverImage url={d.e.coverUrl} alt="" className="h-[74px] w-[52px] flex-none rounded-md object-cover shadow" />
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
            {d.e.isAdult && <AdultBadge className="px-1.5 py-0 text-[10px] font-sans" />}
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

/**
 * Lista pareada com o plano: hover no ponto acende a linha (e rola até ela);
 * hover na linha acende o ponto. É o que resolve o "ponto anônimo" sem encher o
 * plano de rótulo — medido: 53% dos pontos ficam a menos de 9px de outro quando
 * o acervo inteiro entra, e mesmo em 40 obras o hover sozinho não identifica.
 */
function PairedList({
  ref, dots, grouped, focusArch, hovered, setHovered,
}: {
  ref: React.Ref<HTMLDivElement>
  dots: PlottedDot[]
  grouped: boolean
  focusArch: ForceArchetype | null
  hovered: string | null
  setHovered: (id: string | null) => void
}) {
  /**
   * A lista é a legenda do plano, e o plano se lê da direita pra esquerda —
   * então ela ordena pela MESMA grandeza do eixo X: maior chance primeiro. Na
   * ordem do ranking (Nota Prevista) a coluna de % descia e subia sem padrão, e
   * a lista parecia desordenada ao lado de um eixo que estava ordenado.
   *
   * Empate mantém a ordem do ranking (o sort do JS é estável). O `-Infinity` é
   * só rede: obra sem Chance nem chega aqui — ela é cortada antes, junto com
   * quem não tem Avaliação, porque sem as duas forças não há ponto no plano.
   */
  const ordered = useMemo(
    () => [...dots].sort((a, b) => (b.forces.chance ?? -Infinity) - (a.forces.chance ?? -Infinity)),
    [dots],
  )

  const groups = useMemo(() => {
    if (!grouped) return null
    const by = new Map<ForceArchetype, PlottedDot[]>()
    for (const d of ordered) {
      const list = by.get(d.arch) ?? []
      list.push(d)
      by.set(d.arch, list)
    }
    return ARCHETYPE_ORDER.filter((a) => by.has(a)).map((a) => ({ arch: a, items: by.get(a)! }))
  }, [ordered, grouped])

  return (
    <div className="flex max-h-[520px] min-h-[280px] flex-col overflow-hidden rounded-xl border border-border bg-card lg:max-h-none">
      <div className="border-b border-border bg-muted/40 px-3 py-2">
        <div className="text-[12.5px] font-semibold capitalize">
          {focusArch ? ARCHETYPE_LABEL[focusArch] : "Todas as obras"}
        </div>
        <div className="text-[10.5px] text-muted-foreground">
          {dots.length} obra{dots.length !== 1 ? "s" : ""} ·{" "}
          {focusArch
            ? ARCHETYPE_MEANING[focusArch]
            : grouped
              ? "em prateleiras, maior chance primeiro"
              : "maior chance primeiro"}
        </div>
      </div>
      <div ref={ref} className="min-h-0 flex-1 overflow-y-auto">
        {groups
          ? groups.map(({ arch, items }) => (
              <ShelfGroup key={arch} arch={arch} items={items} hovered={hovered} setHovered={setHovered} />
            ))
          : ordered.map((d) => <PairedRow key={d.e.workId} d={d} hovered={hovered} setHovered={setHovered} />)}
        {dots.length === 0 && (
          <p className="px-3 py-6 text-center text-[12px] text-muted-foreground">Nenhuma obra neste canto.</p>
        )}
      </div>
    </div>
  )
}

/** Prateleira colapsável da lista pareada. */
function ShelfGroup({
  arch, items, hovered, setHovered,
}: {
  arch: ForceArchetype
  items: PlottedDot[]
  hovered: string | null
  setHovered: (id: string | null) => void
}) {
  const [open, setOpen] = useState(true)
  const style = ARCHETYPE_STYLE[arch]
  // Fechada, a prateleira esconderia a linha que o hover no ponto quer acender —
  // então o próprio hover reabre.
  const hoveredHere = hovered != null && items.some((d) => d.e.workId === hovered)
  const expanded = open || hoveredHere

  return (
    <div className="border-b border-border last:border-b-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={expanded}
        className="sticky top-0 z-10 flex w-full cursor-pointer items-center gap-2 bg-muted/60 px-3 py-1.5 text-left backdrop-blur transition-colors hover:bg-muted"
      >
        <ChevronDown className={cn("size-3 flex-none transition-transform", style.text, !expanded && "-rotate-90")} />
        <span className={cn("text-[11.5px] font-bold capitalize", style.text)}>{ARCHETYPE_LABEL[arch]}</span>
        <span className={cn("rounded px-1 py-px text-[9.5px] font-bold tabular-nums", style.chipBg)}>{items.length}</span>
      </button>
      {expanded && items.map((d) => <PairedRow key={d.e.workId} d={d} hovered={hovered} setHovered={setHovered} indent />)}
    </div>
  )
}

function PairedRow({
  d, hovered, setHovered, indent,
}: {
  d: PlottedDot
  hovered: string | null
  setHovered: (id: string | null) => void
  indent?: boolean
}) {
  const lit = hovered === d.e.workId
  return (
    <Link
      href={`/catalog/${titleToSlug(d.e.title)}`}
      data-work={d.e.workId}
      onMouseEnter={() => setHovered(d.e.workId)}
      onMouseLeave={() => setHovered(null)}
      onFocus={() => setHovered(d.e.workId)}
      onBlur={() => setHovered(null)}
      className={cn(
        "flex items-center gap-2 border-b border-border/50 px-3 py-1.5 transition-colors last:border-b-0 hover:bg-muted/60",
        indent && "pl-5",
        lit && "bg-primary/10 shadow-[inset_2px_0_0_hsl(var(--primary))]",
      )}
    >
      <span className={cn("size-[7px] flex-none rounded-full", ARCHETYPE_STYLE[d.arch].dot)} />
      <span className="min-w-0 flex-1">
        {/* A lista pareada é a única leitura da Bússola que não exige passar o mouse ponto
            a ponto — sem o selo aqui, a classificação só existiria no hover. */}
        <span className="flex items-center gap-1.5 text-[11.5px] font-medium leading-tight">
          <span className="truncate">{d.e.title}</span>
          {d.e.isAdult && <AdultBadge className="shrink-0 px-1.5 py-0 text-[9.5px] leading-tight" />}
        </span>
        <span className="block truncate text-[9.5px] text-muted-foreground">
          {d.e.year ?? "—"}
          {d.forces.alcance != null && ` · alcance ${d.forces.alcance}`}
        </span>
      </span>
      <span className="flex-none font-mono text-[11px] font-bold tabular-nums text-violet-600 dark:text-violet-400">
        {d.forces.chance != null ? `${d.forces.chance}%` : "—"}
      </span>
    </Link>
  )
}

/** Toda a instrução da view mora aqui — era ~600px de tela antes do primeiro dado. */
function HowToRead() {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="icon" className="size-7" aria-label="Como ler o mapa">
          <HelpCircle className="size-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[420px] text-[12.5px] leading-relaxed">
        <p className="mb-1.5 font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
          Como ler o mapa
        </p>
        <p className="mb-2 text-muted-foreground">
          Cada obra é um ponto. A <b className="text-foreground">posição horizontal</b> é a chance de você
          gostar, a <b className="text-foreground">vertical</b> é a nota da crítica, e o{" "}
          <b className="text-foreground">tamanho</b> é quanta gente votou.
        </p>
        <p className="mb-2 text-muted-foreground">
          A cruz do meio é a <b className="text-foreground">mediana das obras que estão na tela</b> — metade
          de cada lado. Por isso os cantos falam em um sinal <em>contra o outro</em>, e nunca em &ldquo;boa&rdquo;
          ou &ldquo;ruim&rdquo;: um ponto à direita é o topo <em>do que você está vendo</em>.
        </p>
        <div className="flex flex-col gap-1">
          {ARCHETYPE_ORDER.map((a) => (
            <span key={a} className="flex items-start gap-2">
              <span className={cn("mt-1 size-2 flex-none rounded-full", ARCHETYPE_STYLE[a].dot)} />
              <span>
                <b className={cn("font-semibold capitalize", ARCHETYPE_STYLE[a].text)}>{ARCHETYPE_LABEL[a]}</b>
                <span className="text-muted-foreground"> — {ARCHETYPE_MEANING[a]}</span>
              </span>
            </span>
          ))}
        </div>
        <p className="mt-2 text-[11.5px] text-muted-foreground">
          Clique num canto para focar só naquele grupo. Passar o mouse num ponto acende a linha na lista ao
          lado, e vice-versa.
        </p>
      </PopoverContent>
    </Popover>
  )
}
