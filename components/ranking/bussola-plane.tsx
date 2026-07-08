"use client"

import { useLayoutEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { cn, titleToSlug } from "@/lib/utils"
import { CoverImage } from "@/components/ui/cover-image"
import { ForceMeters } from "@/components/ranking/force-meters"
import { computeWorkForces, classifyArchetypeByPercentile, type ForceArchetype } from "@/lib/calculations/forces"
import type { RankingEntry } from "@/server/queries/ranking"

/**
 * Bússola 2D — o plano de decisão da feature (ver PLANO-BUSSOLA-3-FORCAS.md).
 * Cada obra é um ponto: posição = 2 das 3 forças (face escolhida), tamanho = a
 * 3ª, cor = arquétipo (Chance × Avaliação, estável entre as faces). Reusa os
 * mesmos RankingEntry do ranking (filtros/sort já aplicados a montante).
 *
 * Redesign 2026-07-08: legendas de canto FORA do plano (nunca cobrem/são
 * cobertas por um ponto), card explicativo ao lado dos seletores e tooltip
 * rico com capa (CoverImage) + as 3 forças (ForceMeters).
 */

type ForceKey = "chance" | "avaliacao" | "alcance"

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

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))
const sizePx = (v: number | null) => 10 + ((v ?? 0) / 100) * 18

function Seg<T extends string>({
  value, onChange, options,
}: { value: T; onChange: (v: T) => void; options: { v: T; label: string; swatch?: string }[] }) {
  return (
    <div className="inline-flex rounded-lg border border-border bg-muted/40 p-0.5">
      {options.map((o) => (
        <button
          key={o.v}
          type="button"
          onClick={() => onChange(o.v)}
          aria-pressed={value === o.v}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
            value === o.v ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {o.swatch && <span className={cn("size-2 rounded-full", o.swatch)} />}
          {o.label}
        </button>
      ))}
    </div>
  )
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

export function BussolaPlane({ entries }: { entries: RankingEntry[] }) {
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
    const pctChance = percentileFn("chance")
    const pctAval = percentileFn("avaliacao")

    return base.map((d) => ({
      ...d,
      xPct: pctX(d.forces[preset.x]),
      yPct: pctY(d.forces[preset.y]),
      // Arquétipo por percentil de Chance × Avaliação (median-split) — alinha os
      // quadrantes visuais (linha do meio = mediana) com a cor.
      arch: classifyArchetypeByPercentile(pctChance(d.forces.chance), pctAval(d.forces.avaliacao)),
    }))
  }, [entries, preset.x, preset.y])

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
    const dotSize = sizePx(hoveredDot.forces[preset.size])
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
      {/* lede + codificação */}
      <div className="flex flex-col gap-2">
        <p className="max-w-[64ch] text-sm text-muted-foreground">
          Cada obra é um ponto. A <span className="font-medium text-foreground">posição</span> cruza duas das três forças,
          o <span className="font-medium text-foreground">tamanho</span> mostra a terceira e a{" "}
          <span className="font-medium text-foreground">cor</span> diz que tipo de aposta ela é pra você. Passe o mouse pra ver a capa.
        </p>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 font-mono text-[11px] text-muted-foreground">
          <span>posição = 2 forças</span>
          <span>
            tamanho = <span className={cn("font-semibold", FORCE_TEXT[preset.size])}>{FORCE_SHORT[preset.size]}</span>
          </span>
          <span>cor = tipo de aposta</span>
        </div>
      </div>

      {/* painel */}
      <div className="overflow-hidden rounded-2xl border border-border bg-card/60 shadow-sm">
        {/* cabeçalho: controles empilhados + card explicativo */}
        <div className="flex flex-wrap items-stretch gap-x-5 gap-y-3 border-b border-border bg-muted/30 p-4">
          <div className="flex flex-col justify-center gap-2.5">
            <div className="flex items-center gap-2.5">
              <span className="w-11 shrink-0 font-mono text-[10.5px] uppercase tracking-wide text-muted-foreground">Eixos</span>
              <Seg value={presetKey} onChange={setPresetKey} options={PRESETS.map((p) => ({ v: p.key, label: p.label }))} />
            </div>
            <div className="flex items-center gap-2.5">
              <span className="w-11 shrink-0 font-mono text-[10.5px] uppercase tracking-wide text-muted-foreground">Foco</span>
              <Seg
                value={risk}
                onChange={setRisk}
                options={[
                  { v: "all", label: "Tudo" },
                  { v: "segura", label: "Aposta segura", swatch: "bg-emerald-500" },
                  { v: "potencial", label: "Alto potencial", swatch: "bg-rose-500" },
                ]}
              />
            </div>
          </div>

          {/* explicação do preset selecionado */}
          <div className="flex min-w-[300px] flex-1 flex-col gap-2 rounded-xl border border-border bg-card p-3.5 shadow-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-md bg-violet-500/10 px-1.5 py-0.5 font-mono text-[9.5px] uppercase tracking-wide text-violet-600 dark:text-violet-400">
                {preset.tag}
              </span>
              <span className="text-sm font-bold tracking-tight">{preset.label}</span>
            </div>
            <p className="text-xs text-muted-foreground">{preset.lede}</p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              {([["→ horizontal", preset.x], ["↑ vertical", preset.y], ["● tamanho", preset.size]] as const).map(
                ([role, key]) => (
                  <div key={role} className={cn("border-l-[2.5px] pl-2.5", FORCE_BORDER[key])}>
                    <span className="block font-mono text-[8.5px] uppercase tracking-wide text-muted-foreground">{role}</span>
                    <span className={cn("block text-xs font-semibold", FORCE_TEXT[key])}>{FORCE_SHORT[key]}</span>
                    <span className="block text-[11px] leading-tight text-muted-foreground">{FORCE_DESC[key]}</span>
                  </div>
                ),
              )}
            </div>
            <p className="mt-0.5 border-t border-border pt-2 text-[11.5px] leading-relaxed text-muted-foreground">{preset.note}</p>
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
                ↓ mediana do acervo
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
                const s = sizePx(d.forces[preset.size])
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
                        {hoveredDot.e.year != null && <span>·</span>}
                        <span className="inline-flex items-center gap-1">
                          <span
                            className="size-1.5 rounded-full"
                            style={{ background: hoveredDot.e.publicationStatusColor ?? "currentColor" }}
                          />
                          {hoveredDot.e.publicationStatusShort ?? hoveredDot.e.publicationStatus}
                        </span>
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
              posição = percentil no acervo · tamanho = {FORCE_SHORT[preset.size]} · {dots.length} obras
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
                <p>
                  A posição usa o <span className="font-medium text-foreground">percentil dentro do acervo exibido</span>, não a nota crua — assim as obras se espalham em vez de empilhar numa faixa. A cruz central é a <span className="font-medium text-foreground">mediana</span>: metade das obras de cada lado.
                </p>
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
