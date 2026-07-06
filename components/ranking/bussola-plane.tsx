"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { cn, titleToSlug } from "@/lib/utils"
import { computeWorkForces, classifyArchetypeByPercentile, type ForceArchetype } from "@/lib/calculations/forces"
import type { RankingEntry } from "@/server/queries/ranking"

/**
 * Bússola 2D — o plano de decisão da feature (ver PLANO-BUSSOLA-3-FORCAS.md).
 * Cada obra é um ponto: posição = 2 das 3 forças (face escolhida), tamanho = a
 * 3ª, cor = arquétipo (Chance × Avaliação, estável entre as faces). Reusa os
 * mesmos RankingEntry do ranking (filtros/sort já aplicados a montante).
 */

type ForceKey = "chance" | "avaliacao" | "alcance"

const FORCE_LABEL: Record<ForceKey, string> = {
  chance: "Chance de você gostar",
  avaliacao: "Avaliação da crítica",
  alcance: "Alcance / popularidade",
}
const FORCE_SHORT: Record<ForceKey, string> = { chance: "Chance", avaliacao: "Avaliação", alcance: "Alcance" }

interface Preset {
  key: string
  label: string
  x: ForceKey
  y: ForceKey
  size: ForceKey
  quad: { tr: string; br: string; tl: string; bl: string }
}

const PRESETS: Preset[] = [
  { key: "ca", label: "Chance × Avaliação", x: "chance", y: "avaliacao", size: "alcance",
    quad: { tr: "Aposta segura", br: "Teu nicho", tl: "Alto potencial", bl: "Provável pular" } },
  { key: "cp", label: "Chance × Alcance", x: "chance", y: "alcance", size: "avaliacao",
    quad: { tr: "Mainstream do teu tipo", br: "Joia escondida", tl: "Hype fora do perfil", bl: "Fundo de catálogo" } },
  { key: "ap", label: "Avaliação × Alcance", x: "avaliacao", y: "alcance", size: "chance",
    quad: { tr: "Consagrada", br: "Cult / subvalorizada", tl: "Popular e divisiva", bl: "Fundo de catálogo" } },
]

const ARCH: Record<ForceArchetype, { dot: string; sw: string; text: string; label: string }> = {
  safe: { dot: "bg-emerald-500", sw: "bg-emerald-500", text: "text-emerald-600 dark:text-emerald-400", label: "Aposta segura" },
  niche: { dot: "bg-violet-500", sw: "bg-violet-500", text: "text-violet-600 dark:text-violet-400", label: "Teu nicho" },
  upside: { dot: "bg-rose-500", sw: "bg-rose-500", text: "text-rose-600 dark:text-rose-400", label: "Alto potencial" },
  skip: { dot: "bg-slate-400 dark:bg-slate-500", sw: "bg-slate-400", text: "text-slate-500", label: "Pular" },
}

type RiskMode = "all" | "segura" | "potencial"

function Seg<T extends string>({
  value, onChange, options,
}: { value: T; onChange: (v: T) => void; options: { v: T; label: string }[] }) {
  return (
    <div className="inline-flex rounded-lg border border-border bg-muted/40 p-0.5">
      {options.map((o) => (
        <button
          key={o.v}
          type="button"
          onClick={() => onChange(o.v)}
          aria-pressed={value === o.v}
          className={cn(
            "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
            value === o.v ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

const sizePx = (v: number | null) => 8 + ((v ?? 0) / 100) * 16

export function BussolaPlane({ entries }: { entries: RankingEntry[] }) {
  const [presetKey, setPresetKey] = useState("ca")
  const [risk, setRisk] = useState<RiskMode>("all")
  const [hovered, setHovered] = useState<string | null>(null)
  const preset = PRESETS.find((p) => p.key === presetKey)!

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

  return (
    <div className="flex flex-col gap-4">
      {/* controles */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[11px] uppercase tracking-wide text-muted-foreground">Eixos</span>
          <Seg value={presetKey} onChange={setPresetKey} options={PRESETS.map((p) => ({ v: p.key, label: p.label }))} />
        </div>
        <div className="flex items-center gap-2">
          <span className="font-mono text-[11px] uppercase tracking-wide text-muted-foreground">Risco</span>
          <Seg
            value={risk}
            onChange={setRisk}
            options={[{ v: "all", label: "Tudo" }, { v: "segura", label: "Segura" }, { v: "potencial", label: "Potencial" }]}
          />
        </div>
      </div>

      {/* plano */}
      <div className="flex gap-2">
        <div className="flex items-center">
          <span className="rotate-180 whitespace-nowrap font-mono text-[10px] uppercase tracking-wider text-amber-600 [writing-mode:vertical-rl] dark:text-amber-400">
            {FORCE_LABEL[preset.y]} ↑
          </span>
        </div>
        <div className="min-w-0 flex-1">
          <div className="relative aspect-[4/3] w-full overflow-hidden rounded-xl border border-border bg-muted/30">
            {/* linhas centrais */}
            <div className="absolute left-1/2 top-0 h-full w-px bg-border" />
            <div className="absolute left-0 top-1/2 h-px w-full bg-border" />
            {/* tints dos cantos */}
            <div className="absolute right-0 top-0 h-1/2 w-1/2 bg-gradient-to-bl from-emerald-500/10 to-transparent" />
            <div className="absolute bottom-0 right-0 h-1/2 w-1/2 bg-gradient-to-tl from-violet-500/10 to-transparent" />
            <div className="absolute left-0 top-0 h-1/2 w-1/2 bg-gradient-to-br from-rose-500/10 to-transparent" />
            <div className="absolute bottom-0 left-0 h-1/2 w-1/2 bg-gradient-to-tr from-slate-500/10 to-transparent" />
            {/* rótulos de quadrante */}
            <span className="absolute right-2.5 top-2 font-mono text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/90">{preset.quad.tr} ↗</span>
            <span className="absolute bottom-2 right-2.5 font-mono text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/90">{preset.quad.br} ↘</span>
            <span className="absolute left-2.5 top-2 font-mono text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/90">↖ {preset.quad.tl}</span>
            <span className="absolute bottom-2 left-2.5 font-mono text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/90">↙ {preset.quad.bl}</span>

            {/* pontos */}
            {dots.map((d) => {
              const x = d.xPct
              const y = d.yPct
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
                    "absolute -translate-x-1/2 translate-y-1/2 rounded-full border-[1.5px] border-background shadow transition-opacity hover:z-20 focus-visible:z-20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    ARCH[d.arch].dot,
                    active ? "opacity-100" : "opacity-[0.15]",
                  )}
                  style={{ left: `${x}%`, bottom: `${y}%`, width: s, height: s }}
                />
              )
            })}

            {/* tooltip */}
            {hoveredDot && (
              <div
                className="pointer-events-none absolute z-30 -translate-x-1/2 whitespace-nowrap rounded-md bg-foreground px-2 py-1 text-[11px] font-semibold text-background shadow-lg"
                style={{
                  left: `${hoveredDot.xPct}%`,
                  bottom: `calc(${hoveredDot.yPct}% + ${sizePx(hoveredDot.forces[preset.size]) / 2 + 8}px)`,
                }}
              >
                {hoveredDot.e.title}
                <span className="ml-1.5 font-mono font-normal opacity-70">
                  {hoveredDot.forces.chance ?? "—"}% · {hoveredDot.forces.avaliacao ?? "—"} · {hoveredDot.forces.alcance ?? "—"}
                </span>
              </div>
            )}

            {dots.length === 0 && (
              <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
                Nenhuma obra com dados suficientes pra posicionar.
              </div>
            )}
          </div>
          <div className="mt-1 text-center font-mono text-[10px] uppercase tracking-wider text-violet-600 dark:text-violet-400">
            {FORCE_LABEL[preset.x]} →
          </div>
        </div>
      </div>

      {/* legenda */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
        {(Object.keys(ARCH) as ForceArchetype[]).map((a) => (
          <span key={a} className="inline-flex items-center gap-1.5">
            <span className={cn("size-2 rounded-full", ARCH[a].sw)} />
            {ARCH[a].label}
          </span>
        ))}
        <span className="ml-auto font-mono text-[11px]">
          posição = percentil no acervo · tamanho = {FORCE_SHORT[preset.size]} · {dots.length} obras
        </span>
      </div>
    </div>
  )
}
