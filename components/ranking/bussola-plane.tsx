"use client"

import { useLayoutEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { Compass } from "lucide-react"
import { cn, titleToSlug } from "@/lib/utils"
import { CoverImage } from "@/components/ui/cover-image"
import { ForceMeters } from "@/components/ranking/force-meters"
import { computeWorkForces, classifyArchetype, classifyArchetypeByPercentile, type ForceArchetype } from "@/lib/calculations/forces"

/**
 * Bússola 2D — o plano de decisão da feature (ver PLANO-BUSSOLA-3-FORCAS.md).
 * Cada obra é um ponto: posição = 2 das 3 forças (face escolhida), tamanho = a
 * 3ª, cor = arquétipo (Chance × Avaliação, estável entre as faces).
 *
 * Serve dois contextos, controlados por `mode`:
 *   - "percentile" (/ranking): posição = percentil no acervo exibido (centenas
 *     de obras) — espalha o catálogo comprimido; mediana no centro.
 *   - "absolute" (comparação de 2–10 obras): posição = magnitude real, com o
 *     limiar de cada eixo ancorado no centro — fiel, sem exagerar diferenças
 *     mínimas num punhado de obras.
 *
 * Redesign 2026-07-08: legendas de canto FORA do plano (nunca cobrem/são
 * cobertas por um ponto), card explicativo ao lado dos seletores e tooltip
 * rico com capa (CoverImage) + as 3 forças (ForceMeters).
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
  publicationStatus?: string | null
  publicationStatusShort?: string | null
  publicationStatusColor?: string | null
  chanceScore: number | null
  platformAvg: number | null
  totalVotes: number
  expectedScore: number | null
}

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
  /** Rótulo de propósito + explicação (card ao lado dos seletores). */
  tag: string
  lede: string
  note: string
  quad: { tr: string; br: string; tl: string; bl: string }
}

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

const ARCH: Record<ForceArchetype, { dot: string; glow: string; text: string; label: string; desc: string }> = {
  safe: { dot: "bg-emerald-500", glow: "rgba(16,185,129,0.5)", text: "text-emerald-600 dark:text-emerald-400", label: "Aposta segura", desc: "gosta + crítica confirma" },
  niche: { dot: "bg-violet-500", glow: "rgba(139,92,246,0.5)", text: "text-violet-600 dark:text-violet-400", label: "Teu nicho", desc: "você curte, crítica não" },
  upside: { dot: "bg-rose-500", glow: "rgba(244,63,94,0.5)", text: "text-rose-600 dark:text-rose-400", label: "Alto potencial", desc: "aclamada, mas arriscada" },
  skip: { dot: "bg-slate-400 dark:bg-slate-500", glow: "rgba(100,116,139,0.4)", text: "text-slate-500", label: "Provável pular", desc: "pouca chance e aclamação" },
}

/** Canto → arquétipo (posição no plano). Estável entre as faces; casa com os tints. */
const CORNER_ARCH: Record<"tr" | "tl" | "br" | "bl", ForceArchetype> = { tr: "safe", tl: "upside", br: "niche", bl: "skip" }

type RiskMode = "all" | "segura" | "potencial"

/** Opções do filtro "Foco" (por arquétipo de risco) + explicação do selecionado. */
const RISK_OPTIONS: { v: RiskMode; label: string; swatch?: string }[] = [
  { v: "all", label: "Tudo" },
  { v: "segura", label: "Aposta segura", swatch: "bg-emerald-500" },
  { v: "potencial", label: "Alto potencial", swatch: "bg-rose-500" },
]
const RISK_DESC: Record<RiskMode, string> = {
  all: "Mostra todas as obras do ranking, sem filtrar por tipo de aposta.",
  segura: "Só o que você tende a gostar e a crítica confirma.",
  potencial: "Só apostas arriscadas: aclamadas, mas incertas pro teu perfil.",
}

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

/** Limiar absoluto (0–100) de cada força — a linha do meio no modo "absolute". */
const FORCE_THRESHOLD: Record<ForceKey, number> = { chance: 50, avaliacao: 65, alcance: 50 }

/**
 * Mapeia a magnitude crua (0–100) pra posição no plano ancorando o limiar da
 * força em 50% (piecewise). Mantém a cruz/tints/cantos idênticos ao modo
 * percentil, mudando só onde os pontos caem — e preservando a fidelidade
 * (diferença mínima entre obras → distância mínima).
 */
const absPos = (v: number | null, thr: number) => {
  if (v == null) return 50
  const c = clamp(v, 0, 100)
  return c <= thr ? (c / thr) * 50 : 50 + ((c - thr) / (100 - thr)) * 50
}

/** Legenda de canto — fora do plano, pra nunca cobrir (nem ser coberta por) um ponto. */
function QuadCap({ arch, name, hint, align }: { arch: ForceArchetype; name: string; hint: string; align: "left" | "right" }) {
  return (
    <div className={cn("inline-flex items-start gap-2", align === "right" && "flex-row-reverse text-right")}>
      <span
        className={cn("mt-0.5 size-2.5 flex-none rounded-full", ARCH[arch].dot)}
        style={{ boxShadow: `0 0 0 3px ${ARCH[arch].glow.replace(/0\.\d+\)/, "0.16)")}` }}
      />
      <div className={cn("flex flex-col leading-tight", align === "right" && "items-end")}>
        <span className="text-[13px] font-bold tracking-tight text-foreground">{name}</span>
        <span className="mt-0.5 font-mono text-[10px] text-muted-foreground">{hint}</span>
      </div>
    </div>
  )
}

export function BussolaPlane({ entries, mode = "percentile" }: { entries: BussolaDatum[]; mode?: PositionMode }) {
  const [presetKey, setPresetKey] = useState("ca")
  const [risk, setRisk] = useState<RiskMode>("all")
  const [hovered, setHovered] = useState<string | null>(null)
  const preset = PRESETS.find((p) => p.key === presetKey)!

  const planeRef = useRef<HTMLDivElement>(null)
  const tipRef = useRef<HTMLDivElement>(null)
  const [tipPos, setTipPos] = useState<{ left: number; top: number } | null>(null)

  const dots = useMemo(() => {
    const base = entries
      .map((e) => ({
        e,
        forces: computeWorkForces({ chanceScore: e.chanceScore, platformAvg: e.platformAvg, totalVotes: e.totalVotes }),
      }))
      .filter((d) => d.forces[preset.x] != null && d.forces[preset.y] != null)

    // Modo absoluto (comparação de poucas obras): posição = magnitude real, com
    // o limiar de cada eixo ancorado no centro. Fiel — diferença mínima entre
    // obras vira distância mínima; percentil (relativo a 2–3 obras) exageraria
    // os cantos. Arquétipo por limiar FIXO (chance≥50, crítica≥6,5) — a cruz
    // vira o mesmo limiar em qualquer conjunto comparado.
    if (mode === "absolute") {
      return base.map((d) => ({
        ...d,
        xPct: absPos(d.forces[preset.x], FORCE_THRESHOLD[preset.x]),
        yPct: absPos(d.forces[preset.y], FORCE_THRESHOLD[preset.y]),
        // Tamanho ABSOLUTO aqui, pela mesma razão da posição: com 2–3 obras o
        // percentil vira "uma é grande, a outra é pequena" mesmo quando elas têm
        // quase os mesmos votos. Neste modo os dois eixos e o tamanho falam
        // magnitude real.
        size: dotSizePx((d.forces[preset.size] ?? 0) / 100),
        arch: classifyArchetype(d.forces.chance, d.forces.avaliacao),
      }))
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
    const pctChance = percentileFn("chance")
    const pctAval = percentileFn("avaliacao")

    return base.map((d) => ({
      ...d,
      xPct: pctX(d.forces[preset.x]),
      yPct: pctY(d.forces[preset.y]),
      // TAMANHO = percentil também, pelo mesmo motivo da posição: a 3ª força é
      // tão comprimida quanto os eixos, e num acervo homogêneo a escala absoluta
      // colapsa a diferença a ~2 px. Assim a obra mais popular DO QUE ESTÁ NA
      // TELA é sempre a maior, em qualquer filtro. O número cru continua no
      // tooltip e no aria-label — o tamanho ordena, não mede.
      size: dotSizePx(pctSize(d.forces[preset.size]) / 100),
      // Arquétipo por percentil de Chance × Avaliação (median-split) — alinha os
      // quadrantes visuais (linha do meio = mediana) com a cor.
      arch: classifyArchetypeByPercentile(pctChance(d.forces.chance), pctAval(d.forces.avaliacao)),
    }))
  }, [entries, preset.x, preset.y, preset.size, mode])

  const isActive = (arch: ForceArchetype) =>
    risk === "all" || (risk === "segura" && arch === "safe") || (risk === "potencial" && arch === "upside")

  const hoveredDot = hovered ? dots.find((d) => d.e.workId === hovered) : null

  // Posiciona o card acima do ponto, com flip/clamp nas bordas — medido no
  // client (o card é largo demais pra centralizar só com CSS). useLayoutEffect
  // roda antes do paint, então não há flash de posição.
  useLayoutEffect(() => {
    if (!hoveredDot || !planeRef.current || !tipRef.current) {
      setTipPos(null)
      return
    }
    const pr = planeRef.current.getBoundingClientRect()
    const tw = tipRef.current.offsetWidth
    const th = tipRef.current.offsetHeight
    const dotSize = hoveredDot.size
    const cx = (pr.width * hoveredDot.xPct) / 100
    const cyTop = pr.height * (1 - hoveredDot.yPct / 100)
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

  return (
    <div className="flex flex-col gap-3">
      {/* painel — como ler, controles e plano num card só */}
      <div className="overflow-hidden rounded-2xl border border-border bg-card/60 shadow-sm">
        {/* como ler + chave de codificação */}
        <div className="flex flex-wrap items-stretch gap-4 border-b border-border bg-muted/30 p-4">
          <div className="flex max-w-[460px] flex-none gap-3">
            <span className="flex size-[30px] flex-none items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Compass className="size-[17px]" />
            </span>
            <div>
              <p className="mb-1 font-mono text-[9.5px] font-bold uppercase tracking-[0.12em] text-muted-foreground">Como ler o mapa</p>
              <p className="max-w-[44ch] text-[13px] leading-normal text-muted-foreground">
                Cada obra é um ponto. A <b className="font-semibold text-foreground">posição</b> cruza duas das três forças,
                o <b className="font-semibold text-foreground">tamanho</b> mostra a terceira e a{" "}
                <b className="font-semibold text-foreground">cor</b> diz o tipo de aposta pra você. Passe o mouse num ponto pra ver a capa.
              </p>
            </div>
          </div>
          <div className="grid flex-1 grid-cols-3 items-center border-l border-border pl-4 font-mono">
            <div className="flex flex-col gap-1 px-4">
              <div className="flex items-center gap-2">
                <span className="grid w-6 place-items-center">
                  <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                    <path d="M9 1.5v15M1.5 9h15" className="stroke-muted-foreground" strokeWidth="1.3" />
                    <circle cx="9" cy="9" r="2.4" className="fill-foreground" />
                  </svg>
                </span>
                <span className="text-[12px] font-bold uppercase tracking-wide text-foreground">Posição</span>
              </div>
              <span className="text-[11px] text-muted-foreground">Cruza <b className="font-bold">2 forças</b></span>
            </div>
            <div className="flex flex-col gap-1 border-l border-border px-4">
              <div className="flex items-center gap-2">
                <span className="grid w-6 place-items-center">
                  {/* Os raios espelham a razão REAL da escala (⌀ 9 → 34 px): uma
                      legenda 2× ao lado de pontos 3,8× ensina a ler errado. */}
                  <svg width="24" height="14" viewBox="0 0 24 14" className={cn("fill-current", FORCE_TEXT[preset.size])}>
                    <circle cx="4" cy="7" r="1.6" />
                    <circle cx="16" cy="7" r="6" />
                  </svg>
                </span>
                <span className="text-[12px] font-bold uppercase tracking-wide text-foreground">Tamanho</span>
              </div>
              <span className="text-[11px] text-muted-foreground">A 3ª força · <b className={cn("font-bold", FORCE_TEXT[preset.size])}>{FORCE_SHORT[preset.size]}</b></span>
            </div>
            <div className="flex flex-col gap-1 border-l border-border px-4">
              <div className="flex items-center gap-2">
                <span className="grid w-6 place-items-center">
                  <svg width="22" height="14" viewBox="0 0 22 14">
                    <circle cx="4" cy="7" r="3" className="fill-emerald-500" />
                    <circle cx="12" cy="7" r="3" className="fill-violet-500" />
                    <circle cx="20" cy="7" r="3" className="fill-rose-500" />
                  </svg>
                </span>
                <span className="text-[12px] font-bold uppercase tracking-wide text-foreground">Cor</span>
              </div>
              <span className="text-[11px] text-muted-foreground">O <b className="font-bold">tipo de aposta</b></span>
            </div>
          </div>
        </div>

        {/* eixos (abas) + mapa + foco */}
        <div className="border-b border-border bg-muted/30 p-4">
          <div className="flex flex-wrap gap-[18px]">
            <div className="flex min-w-[300px] flex-1 flex-col gap-3">
              {/* Eixos → abas */}
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

              {/* Mapa: propósito + subtítulo, forças em linhas, nota */}
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

            {/* Foco: coluna à direita do conteúdo dos eixos */}
            <div className="flex w-[172px] flex-none flex-col gap-2 border-l border-border pl-[18px]">
              <span className="font-mono text-[10.5px] font-bold uppercase tracking-[0.08em] text-muted-foreground">Foco</span>
              <div className="flex flex-col gap-0.5">
                {RISK_OPTIONS.map((o) => {
                  const on = risk === o.v
                  return (
                    <button
                      key={o.v}
                      type="button"
                      onClick={() => setRisk(o.v)}
                      aria-pressed={on}
                      className={cn(
                        "flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-[12.5px] transition-colors",
                        on ? "font-semibold text-foreground" : "font-medium text-muted-foreground hover:bg-muted/50 hover:text-foreground",
                      )}
                    >
                      <span
                        className={cn(
                          "grid size-[15px] flex-none place-items-center rounded-full ring-[1.5px] ring-inset",
                          on ? "ring-primary" : "ring-muted-foreground/50",
                        )}
                      >
                        {on && <span className="size-[7px] rounded-full bg-primary" />}
                      </span>
                      {o.label}
                      {o.swatch && <span className={cn("ml-auto size-2 flex-none rounded-full", o.swatch)} />}
                    </button>
                  )
                })}
              </div>
              <p className="mt-1 border-t border-border pt-2 text-[11px] leading-relaxed text-muted-foreground">
                {RISK_DESC[risk]}
              </p>
            </div>
          </div>
        </div>

        {/* região do plot */}
        <div className="grid grid-cols-[34px_minmax(0,1fr)] gap-1 px-5 pb-4 pt-4">
          {/* eixo Y */}
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
            {/* legendas de topo (fora do plano) */}
            <div className="mb-2.5 flex items-start justify-between gap-3">
              <QuadCap arch={CORNER_ARCH.tl} name={preset.quad.tl} hint={`↖ ${cornerHint(false, true)}`} align="left" />
              <span className="self-center whitespace-nowrap font-mono text-[9px] uppercase tracking-wider text-muted-foreground/70">
                {mode === "absolute" ? "↓ limiar" : "↓ mediana do acervo"}
              </span>
              <QuadCap arch={CORNER_ARCH.tr} name={preset.quad.tr} hint={`↗ ${cornerHint(true, true)}`} align="right" />
            </div>

            {/* plano */}
            <div
              ref={planeRef}
              className="relative aspect-[4/3] w-full overflow-hidden rounded-xl border border-border bg-muted/30"
              style={{
                backgroundImage:
                  "linear-gradient(rgba(128,128,150,0.06) 1px, transparent 1px), linear-gradient(90deg, rgba(128,128,150,0.06) 1px, transparent 1px)",
                backgroundSize: "12.5% 12.5%",
              }}
            >
              {/* tints dos cantos (arquétipo) */}
              <div className="pointer-events-none absolute right-0 top-0 h-1/2 w-1/2 bg-gradient-to-bl from-emerald-500/10 to-transparent" />
              <div className="pointer-events-none absolute bottom-0 right-0 h-1/2 w-1/2 bg-gradient-to-tl from-violet-500/10 to-transparent" />
              <div className="pointer-events-none absolute left-0 top-0 h-1/2 w-1/2 bg-gradient-to-br from-rose-500/10 to-transparent" />
              <div className="pointer-events-none absolute bottom-0 left-0 h-1/2 w-1/2 bg-gradient-to-tr from-slate-500/10 to-transparent" />
              {/* linhas da mediana */}
              <div className="absolute left-1/2 top-0 h-full w-px bg-border" />
              <div className="absolute left-0 top-1/2 h-px w-full bg-border" />

              {/* pontos */}
              {dots.map((d) => {
                const s = d.size
                const active = isActive(d.arch)
                return (
                  <Link
                    key={d.e.workId}
                    href={`/titles/${titleToSlug(d.e.title)}`}
                    aria-label={`${d.e.title}: chance ${d.forces.chance ?? "—"}, avaliação ${d.forces.avaliacao ?? "—"}, alcance ${d.forces.alcance ?? "—"}`}
                    onMouseEnter={() => setHovered(d.e.workId)}
                    onMouseLeave={() => setHovered((h) => (h === d.e.workId ? null : h))}
                    onFocus={() => setHovered(d.e.workId)}
                    onBlur={() => setHovered((h) => (h === d.e.workId ? null : h))}
                    className={cn(
                      "absolute -translate-x-1/2 translate-y-1/2 rounded-full border-[1.5px] border-background transition-opacity hover:z-20 focus-visible:z-20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      ARCH[d.arch].dot,
                      active ? "opacity-100" : "opacity-[0.13]",
                    )}
                    style={{
                      left: `${d.xPct}%`,
                      bottom: `${d.yPct}%`,
                      width: s,
                      height: s,
                      boxShadow: active ? `0 0 14px ${ARCH[d.arch].glow}` : undefined,
                    }}
                  />
                )
              })}

              {/* tooltip rico */}
              {hoveredDot && (
                <div
                  ref={tipRef}
                  className="pointer-events-none absolute z-30 w-[268px] overflow-hidden rounded-xl border border-border bg-card shadow-xl transition-opacity"
                  style={{ left: tipPos?.left ?? 0, top: tipPos?.top ?? 0, opacity: tipPos ? 1 : 0 }}
                >
                  <div className="flex gap-3 p-3">
                    <CoverImage
                      url={hoveredDot.e.coverUrl}
                      alt=""
                      className="h-[74px] w-[52px] flex-none rounded-md object-cover shadow"
                    />
                    <div className="flex min-w-0 flex-col gap-1">
                      <div className="text-[13.5px] font-semibold leading-tight">{hoveredDot.e.title}</div>
                      <div className="flex flex-wrap items-center gap-1.5 font-mono text-[10.5px] text-muted-foreground">
                        {hoveredDot.e.year != null && <span>{hoveredDot.e.year}</span>}
                        {hoveredDot.e.year != null &&
                          (hoveredDot.e.publicationStatusShort ?? hoveredDot.e.publicationStatus) && <span>·</span>}
                        {(hoveredDot.e.publicationStatusShort ?? hoveredDot.e.publicationStatus) && (
                          <span className="inline-flex items-center gap-1">
                            <span
                              className="size-1.5 rounded-full"
                              style={{ background: hoveredDot.e.publicationStatusColor ?? "currentColor" }}
                            />
                            {hoveredDot.e.publicationStatusShort ?? hoveredDot.e.publicationStatus}
                          </span>
                        )}
                      </div>
                      <span
                        className={cn(
                          "mt-0.5 inline-flex items-center gap-1.5 self-start rounded-full px-2 py-0.5 text-[11px] font-semibold",
                          ARCH[hoveredDot.arch].text,
                        )}
                        style={{ backgroundColor: ARCH[hoveredDot.arch].glow.replace(/0\.\d+\)/, "0.14)") }}
                      >
                        <span className={cn("size-1.5 rounded-full", ARCH[hoveredDot.arch].dot)} />
                        {ARCH[hoveredDot.arch].label}
                      </span>
                    </div>
                  </div>
                  <div className="px-3 pb-3">
                    <ForceMeters forces={hoveredDot.forces} size="sm" />
                  </div>
                  <div className="flex items-center justify-between border-t border-border bg-muted/40 px-3 py-2 text-[11px] text-muted-foreground">
                    <span>
                      Nota Prevista{" "}
                      <b className="font-mono text-[13px] font-bold text-foreground">
                        {hoveredDot.e.expectedScore != null ? hoveredDot.e.expectedScore.toFixed(1) : "—"}
                      </b>
                    </span>
                    <span className={cn("inline-flex items-center gap-1 font-medium", ARCH[hoveredDot.arch].text)}>
                      {quadArrow(hoveredDot)} {quadName(hoveredDot)}
                    </span>
                  </div>
                </div>
              )}

              {dots.length === 0 && (
                <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
                  Nenhuma obra com dados suficientes pra posicionar.
                </div>
              )}
            </div>

            {/* legendas de baixo (fora do plano) */}
            <div className="mt-2.5 flex items-start justify-between gap-3">
              <QuadCap arch={CORNER_ARCH.bl} name={preset.quad.bl} hint={`↙ ${cornerHint(false, false)}`} align="left" />
              <QuadCap arch={CORNER_ARCH.br} name={preset.quad.br} hint={`↘ ${cornerHint(true, false)}`} align="right" />
            </div>

            {/* eixo X */}
            <div className={cn("mt-2.5 flex items-center justify-center gap-2 font-mono text-[10px] uppercase tracking-wider", FORCE_TEXT[preset.x])}>
              <span className="text-muted-foreground/70">baixo</span> {AXIS_LABEL[preset.x]} →
            </div>
          </div>
        </div>

        {/* rodapé: legenda + como ler */}
        <div className="flex flex-col gap-3.5 border-t border-border p-4">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs">
            {(Object.keys(ARCH) as ForceArchetype[]).map((a) => (
              <span key={a} className={cn("inline-flex items-center gap-1.5", ARCH[a].text)}>
                <span className={cn("size-2.5 rounded-full", ARCH[a].dot)} />
                <b className="font-semibold text-foreground">{ARCH[a].label}</b>
                <span className="text-muted-foreground">· {ARCH[a].desc} · {counts[a]}</span>
              </span>
            ))}
            <span className="ml-auto font-mono text-[11px] text-muted-foreground">
              posição = {mode === "absolute" ? "magnitude (limiar no centro)" : "percentil no acervo"} · tamanho = {FORCE_SHORT[preset.size]} ({mode === "absolute" ? "magnitude" : "percentil"}) · {dots.length} obras
            </span>
          </div>

          <details className="rounded-xl border border-border bg-muted/30">
            <summary className="flex cursor-pointer list-none items-center gap-2 p-3 text-[13px] font-semibold [&::-webkit-details-marker]:hidden">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-muted-foreground">
                <circle cx="12" cy="12" r="9" />
                <path d="M12 16v-4M12 8h.01" />
              </svg>
              Como ler a Bússola
            </summary>
            <div className="grid grid-cols-1 gap-4 px-3.5 pb-4 sm:grid-cols-3">
              <div>
                <h4 className="mb-1.5 mt-2 text-xs font-semibold">As 3 forças</h4>
                {(["chance", "avaliacao", "alcance"] as ForceKey[]).map((k) => (
                  <div key={k} className="mb-2 flex items-start gap-2">
                    <span className={cn("mt-1 size-2.5 flex-none rounded-full", k === "chance" ? "bg-violet-500" : k === "avaliacao" ? "bg-amber-500" : "bg-slate-400")} />
                    <span className="text-xs">
                      <strong className="font-semibold">{FORCE_SHORT[k]}</strong>
                      <span className="block text-muted-foreground">{FORCE_DESC[k]}</span>
                    </span>
                  </div>
                ))}
              </div>
              <div className="text-xs text-muted-foreground">
                <h4 className="mb-1.5 mt-2 text-xs font-semibold text-foreground">Como posicionamos</h4>
                {mode === "absolute" ? (
                  <p>
                    A posição usa a <span className="font-medium text-foreground">magnitude real de cada força</span> (0–100), com o limiar de cada eixo ancorado no centro. Diferenças pequenas entre as obras aparecem pequenas — ideal pra comparar poucas obras. A cruz central marca os <span className="font-medium text-foreground">limiares</span> (chance 50%, crítica boa).
                  </p>
                ) : (
                  <p>
                    A posição usa o <span className="font-medium text-foreground">percentil dentro do acervo exibido</span>, não a nota crua — assim as obras se espalham em vez de empilhar numa faixa. A cruz central é a <span className="font-medium text-foreground">mediana</span>: metade das obras de cada lado.
                  </p>
                )}
                <h4 className="mb-1.5 mt-3 text-xs font-semibold text-foreground">Por que a cor é fixa</h4>
                <p>
                  A cor é sempre o arquétipo <span className="font-medium text-foreground">Chance × Avaliação</span> — ela viaja com a obra mesmo quando você troca os eixos, pra reconhecer a mesma aposta em qualquer face.
                </p>
              </div>
              <div className="text-xs text-muted-foreground">
                <h4 className="mb-1.5 mt-2 text-xs font-semibold text-foreground">Os 4 cantos</h4>
                <p><span className="font-medium text-emerald-600 dark:text-emerald-400">Aposta segura</span> — você provavelmente gosta e a crítica confirma.</p>
                <p className="mt-1.5"><span className="font-medium text-rose-600 dark:text-rose-400">Alto potencial</span> — aclamada, mas fora do teu padrão: risco que pode valer.</p>
                <p className="mt-1.5"><span className="font-medium text-violet-600 dark:text-violet-400">Teu nicho</span> — você curte, a crítica nem tanto.</p>
                <p className="mt-1.5"><span className="font-medium text-slate-500">Provável pular</span> — pouca chance e pouca aclamação.</p>
              </div>
            </div>
          </details>
        </div>
      </div>
    </div>
  )
}
