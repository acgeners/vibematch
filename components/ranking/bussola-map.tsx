"use client"

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react"
import { createPortal } from "react-dom"
import Link from "next/link"
import { ChevronDown, Maximize2, Minimize2, X } from "lucide-react"
import { cn, titleToSlug } from "@/lib/utils"
import { CoverImage } from "@/components/ui/cover-image"
import { WorkContentChip } from "@/components/ui/work-content-chip"
import { getScoreTextColor } from "@/components/ui/score-badge"
import type { ScoreColorThresholds } from "@/components/ui/score-badge"
import type { ForceArchetype } from "@/lib/calculations/forces"
import { ARCHETYPE_LABEL, ARCHETYPE_MEANING, ARCHETYPE_ORDER, archetypesOf } from "@/lib/ranking/tier-composition"
import {
  BUSSOLA_FACES,
  BUSSOLA_FACE_ORDER,
  BUSSOLA_INSET,
  BUSSOLA_MEASURES,
  archetypeName,
  coverSizeFor,
  isBussolaFaceKey,
  nearestOnFace,
  percentileFn,
  placeLabels,
  quantileOf,
  separateCovers,
  type BussolaDatum,
  type BussolaFaceKey,
  type BussolaMeasureKey,
  type LabelRequest,
} from "@/lib/ranking/bussola-map"
import {
  BUSSOLA_LINK_MODES,
  LINK_MODE_HINT,
  isBussolaLinkMode,
  linkRows,
  type BussolaLinkMode,
  type BussolaLinks,
  type LinkRow,
} from "@/lib/ranking/bussola-links"
import { getBussolaLinks } from "@/server/actions/bussola"

/**
 * Bússola do /ranking: o MAPA DE CAPAS (redesenho aprovado no mockup de 16/11/2026).
 *
 * A view Cards com Agrupar já separa as obras nos quatro tipos de aposta; o que só um mapa mostra
 * é onde cada obra está em relação às outras, em duas medidas. Por isso:
 *   - cada ponto é a CAPA (o centro dela, recortado em quadrado), do mesmo tamanho para todas;
 *   - sem cor por tipo de aposta: a posição e o nome dos cantos já dizem o tipo, e a cor só
 *     repetia. Ela marca o que muda: a obra clicada (branco) e as ligadas a ela (azul);
 *   - três pares de eixos (decidir, descobrir, catálogo sem o teu gosto), e as marcas dos eixos
 *     mostram o valor REAL na posição (a posição é a ordem entre as obras na tela);
 *   - clicar seleciona: o painel mostra a obra e as ligações dela (parecidas, mesmo perfil,
 *     mesmo grupo, vizinhas no mapa), e as que estão no mapa ganham linha.
 */

/**
 * 🔴 **Teto de pontos — medido, não escolhido.** Medido em 2026-08-06 sobre o catálogo real:
 * 40 obras → 10,0% dos pontos colidindo; 100 → 12,0%; 965 (catálogo todo) → 52,6%, uma mancha.
 * Sem teto, afrouxar o filtro vira mancha SEM AVISO; com teto, a barra diz quantas estão no mapa.
 */
export const MAX_PLOT = 100

/** Mapa antes de medir (e no jsdom): a altura do mapa normal e uma largura típica. */
const FALLBACK_BOX = { w: 900, h: 560 }
/** Quantas ligações o painel lista (o resto vira "+N"). */
const LINK_ROWS_SHOWN = 12
/** Anel claro em volta da capa: separa duas capas semi-sobrepostas. */
const RING = "hsl(219 16% 62%)"

// ------------------------------------------------------------------ preferências salvas

interface Prefs {
  face: BussolaFaceKey
  link: BussolaLinkMode
  names: boolean
  acc: { eixos: boolean; grupos: boolean; obras: boolean }
}
const DEFAULT_PREFS: Prefs = { face: "cc", link: "similar", names: false, acc: { eixos: true, grupos: true, obras: true } }
const PREFS_KEY = "bussola_map_prefs_v1"
const PREFS_EVENT = "bussola-map-prefs-change"

let prefsRaw: string | null | undefined
let prefsCache: Prefs = DEFAULT_PREFS
/** Sem localStorage (janela privada, bloqueio): a preferência vive só na memória da aba. */
let prefsMemoryOnly = false

function parsePrefs(raw: string | null): Prefs {
  if (!raw) return DEFAULT_PREFS
  try {
    const p = JSON.parse(raw) as Partial<Prefs>
    return {
      face: isBussolaFaceKey(p.face) ? p.face : DEFAULT_PREFS.face,
      link: isBussolaLinkMode(p.link) ? p.link : DEFAULT_PREFS.link,
      names: typeof p.names === "boolean" ? p.names : DEFAULT_PREFS.names,
      acc: { ...DEFAULT_PREFS.acc, ...(typeof p.acc === "object" && p.acc ? p.acc : {}) },
    }
  } catch {
    return DEFAULT_PREFS
  }
}

function readPrefs(): Prefs {
  if (prefsMemoryOnly || typeof window === "undefined") return prefsCache
  let raw: string | null = null
  try {
    raw = window.localStorage.getItem(PREFS_KEY)
  } catch {
    return prefsCache
  }
  if (raw !== prefsRaw) {
    prefsRaw = raw
    prefsCache = parsePrefs(raw)
  }
  return prefsCache
}

function writePrefs(patch: Partial<Prefs>) {
  const next = { ...readPrefs(), ...patch }
  const raw = JSON.stringify(next)
  prefsCache = next
  prefsRaw = raw
  try {
    window.localStorage.setItem(PREFS_KEY, raw)
  } catch {
    prefsMemoryOnly = true
  }
  window.dispatchEvent(new CustomEvent(PREFS_EVENT))
}

function subscribePrefs(onChange: () => void) {
  window.addEventListener(PREFS_EVENT, onChange)
  window.addEventListener("storage", onChange)
  return () => {
    window.removeEventListener(PREFS_EVENT, onChange)
    window.removeEventListener("storage", onChange)
  }
}

// ------------------------------------------------------------------ dados derivados

interface MapWork {
  e: BussolaDatum
  values: Record<BussolaMeasureKey, number>
  /** Percentil (0–100) de cada medida entre as obras do mapa. */
  pct: Record<BussolaMeasureKey, number>
  /** Tipo de aposta, sempre de Chance × Crítica — o mesmo `archetypesOf` da view Cards. */
  arch: ForceArchetype
}

type LinkState = "loading" | "error" | BussolaLinks

const fold = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()

const fmtScore = (n: number) => n.toFixed(1).replace(".", ",")

export function BussolaMap({
  entries,
  grouped = false,
  thresholds,
}: {
  entries: BussolaDatum[]
  /** "Agrupar" da barra: divide a LISTA do painel em prateleiras por tipo de aposta. */
  grouped?: boolean
  /** Faixas de cor da Nota Prevista (as de /preferences), pra ela sair na cor do resto do app. */
  thresholds?: ScoreColorThresholds | null
}) {
  const prefs = useSyncExternalStore(subscribePrefs, readPrefs, () => DEFAULT_PREFS)
  const face = BUSSOLA_FACES[prefs.face]
  const mx = BUSSOLA_MEASURES[face.x]
  const my = BUSSOLA_MEASURES[face.y]

  const [focus, setFocus] = useState<ForceArchetype | null>(null)
  const [query, setQuery] = useState("")
  const [selId, setSelId] = useState<string | null>(null)
  const [litId, setLitId] = useState<string | null>(null)
  const [maximized, setMaximized] = useState(false)
  const [box, setBox] = useState<{ w: number; h: number } | null>(null)
  const [links, setLinks] = useState<Record<string, LinkState>>({})
  const linksRef = useRef<Record<string, LinkState>>({})

  const plotRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const tipRef = useRef<HTMLDivElement>(null)

  // Teto: o mapa desenha no máximo MAX_PLOT obras, na ordem que já veio. Sem as duas medidas do
  // tipo de aposta (Chance e Crítica) a obra não entra: os três pares usam o MESMO conjunto, então
  // trocar de eixos não tira nem põe obra no mapa.
  const capped = entries.length > MAX_PLOT
  const works = useMemo<MapWork[]>(() => {
    const base = (capped ? entries.slice(0, MAX_PLOT) : entries).filter(
      (e) => BUSSOLA_MEASURES.chance.value(e) != null && BUSSOLA_MEASURES.crit.value(e) != null,
    )
    const arch = archetypesOf(base)
    const keys: BussolaMeasureKey[] = ["chance", "crit", "votes"]
    const vals = base.map((e) =>
      Object.fromEntries(keys.map((k) => [k, BUSSOLA_MEASURES[k].value(e) ?? 0])) as Record<BussolaMeasureKey, number>,
    )
    const pctFns = Object.fromEntries(keys.map((k) => [k, percentileFn(vals.map((v) => v[k]))])) as Record<
      BussolaMeasureKey,
      (v: number) => number
    >
    return base.map((e, i) => ({
      e,
      values: vals[i],
      pct: { chance: pctFns.chance(vals[i].chance), crit: pctFns.crit(vals[i].crit), votes: pctFns.votes(vals[i].votes) },
      arch: arch[i] ?? "skip",
    }))
  }, [entries, capped])

  const byId = useMemo(() => new Map(works.map((w) => [w.e.workId, w])), [works])
  const onMapIds = useMemo(() => new Set(works.map((w) => w.e.workId)), [works])

  const W = Math.max(200, (box?.w ?? FALLBACK_BOX.w) - BUSSOLA_INSET.left - BUSSOLA_INSET.right)
  const H = Math.max(200, (box?.h ?? FALLBACK_BOX.h) - BUSSOLA_INSET.top - BUSSOLA_INSET.bottom)
  const size = coverSizeFor(H, W)

  const positions = useMemo(
    () => new Map(works.map((w) => [w.e.workId, { x: w.pct[face.x], y: w.pct[face.y] }])),
    [works, face.x, face.y],
  )
  const layout = useMemo(
    () => separateCovers(works.map((w) => ({ id: w.e.workId, ...positions.get(w.e.workId)! })), W, H, size),
    [works, positions, W, H, size],
  )

  const archCounts = useMemo(() => {
    const c: Record<ForceArchetype, number> = { safe: 0, upside: 0, niche: 0, skip: 0 }
    for (const w of works) c[w.arch]++
    return c
  }, [works])

  const quadCounts = useMemo(() => {
    const c = { tr: 0, tl: 0, br: 0, bl: 0 }
    for (const p of positions.values()) c[`${p.y >= 50 ? "t" : "b"}${p.x >= 50 ? "r" : "l"}` as keyof typeof c]++
    return c
  }, [positions])

  const matches = useCallback(
    (w: MapWork) => (!focus || w.arch === focus) && (!query || fold(w.e.title).includes(fold(query))),
    [focus, query],
  )

  const sel = selId ? (byId.get(selId) ?? null) : null
  const linkMode = prefs.link
  const selLinks = sel ? links[sel.e.workId] : undefined

  const nearRows = useMemo<LinkRow[]>(() => {
    if (!sel) return []
    return nearestOnFace(sel.e.workId, positions).map((id) => {
      const o = byId.get(id)!
      return {
        id,
        title: o.e.title,
        isAdult: o.e.isAdult,
        isMixed: o.e.isMixed,
        why: `${mx.show(o.values[face.x])} · ${my.show(o.values[face.y])}`,
        strength: 0.6,
        onMap: true,
      }
    })
  }, [sel, positions, byId, mx, my, face.x, face.y])

  const rowsFor = useCallback(
    (mode: BussolaLinkMode): LinkRow[] | null | undefined => {
      if (mode === "near") return nearRows
      if (!selLinks || typeof selLinks === "string") return undefined
      return linkRows(selLinks, mode, onMapIds)
    },
    [nearRows, selLinks, onMapIds],
  )
  const activeRows = rowsFor(linkMode)
  const linked = useMemo(() => (activeRows ?? []).filter((r) => r.onMap), [activeRows])
  const linkedIds = useMemo(() => new Set(linked.map((r) => r.id)), [linked])

  const loadLinks = useCallback((id: string) => {
    const cur = linksRef.current[id]
    if (cur && cur !== "error") return
    const put = (v: LinkState) => {
      linksRef.current = { ...linksRef.current, [id]: v }
      setLinks(linksRef.current)
    }
    put("loading")
    getBussolaLinks(id).then(
      (r) => put(r ?? "error"),
      () => put("error"),
    )
  }, [])

  const selectWork = useCallback(
    (id: string | null) => {
      setSelId(id)
      if (id) loadLinks(id)
    },
    [loadLinks],
  )

  // Nomes: a obra clicada e as ligadas a ela sempre; as demais só com "Todos os nomes".
  const labels = useMemo(() => {
    const visible = works.filter(matches)
    const rank = (w: MapWork): 0 | 1 | 2 => (sel && w.e.workId === sel.e.workId ? 0 : linkedIds.has(w.e.workId) ? 1 : 2)
    const named = visible.filter((w) => prefs.names || rank(w) < 2)
    const requests: LabelRequest[] = named
      .sort((a, b) => rank(a) - rank(b) || b.values[face.x] - a.values[face.x])
      .map((w) => {
        const r = rank(w)
        return { id: w.e.workId, title: w.e.title, rank: r, size: size * (r === 0 ? 1.3 : r === 1 ? 1.1 : 1) }
      })
    const covers = visible.map((w) => ({ id: w.e.workId, x: layout.get(w.e.workId)!.x, y: layout.get(w.e.workId)!.y, size }))
    const placed = placeLabels(requests, covers, W, H)
    return { placed, asked: named.length }
  }, [works, matches, sel, linkedIds, prefs.names, face.x, size, layout, W, H])

  // Mede o mapa: o tamanho da capa e a separação dependem da área real.
  useLayoutEffect(() => {
    const el = plotRef.current
    if (!el || typeof ResizeObserver === "undefined") return
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect
      setBox((prev) => (prev && Math.abs(prev.w - width) < 1 && Math.abs(prev.h - height) < 1 ? prev : { w: width, h: height }))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [maximized])

  // Esc sai da tela inteira.
  useEffect(() => {
    if (!maximized) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMaximized(false)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [maximized])

  // Cartão do mouse: acima da capa, virando para baixo perto do topo e preso nas bordas do mapa.
  // Mexe no estilo direto (sem estado), porque depende da largura medida do próprio cartão.
  useLayoutEffect(() => {
    const tip = tipRef.current
    if (!tip || !litId) return
    const c = layout.get(litId)
    if (!c) return
    const half = (size * 1.3) / 2
    const tw = tip.offsetWidth
    const th = tip.offsetHeight
    const left = Math.max(-BUSSOLA_INSET.left + 6, Math.min(c.x - tw / 2, W + BUSSOLA_INSET.right - tw - 6))
    let top = c.y - half - th - 8
    if (top < -BUSSOLA_INSET.top + 4) top = c.y + half + 8
    tip.style.left = `${left}px`
    tip.style.top = `${top}px`
    tip.style.opacity = "1"
  }, [litId, layout, size, W])

  /** Rola só o container da lista até a linha — nunca a página. */
  const revealRow = (id: string) => {
    const body = listRef.current
    if (!body) return
    const row = body.querySelector<HTMLElement>(`[data-work="${CSS.escape(id)}"]`)
    if (!row) return
    const rb = row.getBoundingClientRect()
    const bb = body.getBoundingClientRect()
    const pad = grouped ? 28 : 0
    if (rb.top < bb.top + pad) body.scrollTop += rb.top - bb.top - pad
    else if (rb.bottom > bb.bottom) body.scrollTop += rb.bottom - bb.bottom
  }

  const litWork = litId ? byId.get(litId) : undefined
  const toPct = (v: number, of: number) => `${(v / of) * 100}%`
  const xs = works.map((w) => w.values[face.x])
  const ys = works.map((w) => w.values[face.y])
  const TICKS = [0, 25, 50, 75, 100]

  const listed = works.filter(matches).sort((a, b) => b.values[face.x] - a.values[face.x])

  // ------------------------------------------------------------------ o mapa

  const plot = (
    <div
      ref={plotRef}
      className={cn(
        "relative min-w-0 overflow-hidden rounded-xl border border-border bg-background",
        maximized ? "h-full" : "h-[460px] lg:h-[560px]",
      )}
    >
      {/* Faixa de cima: título do eixo vertical, os dois cantos de cima e o aviso dos nomes. */}
      <div className="absolute inset-x-3 top-3 flex items-baseline gap-4 text-[12px]">
        <span className={cn("shrink-0 font-bold", my.text)}>{my.axis} ↑</span>
        <Corner arrow="↖" name={face.quad.tl} n={quadCounts.tl} />
        <span className="min-w-0 flex-1 truncate text-center text-[11px] text-muted-foreground">
          {prefs.names && labels.placed.length < labels.asked
            ? `${labels.placed.length} de ${labels.asked} nomes cabem · passe o mouse nos outros`
            : ""}
        </span>
        <Corner arrow="↗" name={face.quad.tr} n={quadCounts.tr} after />
      </div>
      {/* Faixa de baixo: os dois cantos de baixo e o título do eixo horizontal no meio. */}
      <div
        className="absolute bottom-2.5 flex items-baseline gap-4 text-[12px]"
        style={{ left: BUSSOLA_INSET.left, right: 24 }}
      >
        <Corner arrow="↙" name={face.quad.bl} n={quadCounts.bl} />
        <span className={cn("min-w-0 flex-1 truncate text-center font-bold", mx.text)}>{mx.axis} →</span>
        <Corner arrow="↘" name={face.quad.br} n={quadCounts.br} after />
      </div>

      <div
        className="absolute"
        style={{ left: BUSSOLA_INSET.left, right: BUSSOLA_INSET.right, top: BUSSOLA_INSET.top, bottom: BUSSOLA_INSET.bottom }}
      >
        <div className="absolute inset-y-0 left-1/2 border-l border-dashed border-border" />
        <div className="absolute inset-x-0 top-1/2 border-t border-dashed border-border" />
        {works.length > 0 &&
          TICKS.map((t) => (
            <span
              key={`x${t}`}
              className={cn(
                "absolute whitespace-nowrap font-mono text-[11px]",
                t === 50 ? "font-bold text-muted-foreground" : "text-muted-foreground/70",
              )}
              style={{
                left: `${t}%`,
                bottom: -22,
                transform: t === 0 ? "none" : t === 100 ? "translateX(-100%)" : "translateX(-50%)",
              }}
            >
              {t === 50 ? "mediana " : ""}
              {mx.tick(quantileOf(xs, t)!)}
            </span>
          ))}
        {works.length > 0 &&
          TICKS.map((t) => (
            <span
              key={`y${t}`}
              className={cn(
                "absolute whitespace-nowrap font-mono text-[11px]",
                t === 50 ? "font-bold text-muted-foreground" : "text-muted-foreground/70",
              )}
              style={{ right: "calc(100% + 10px)", bottom: `${t}%`, transform: "translateY(50%)" }}
            >
              {my.tick(quantileOf(ys, t)!)}
            </span>
          ))}

        {sel && linked.length > 0 && (
          <svg className="pointer-events-none absolute inset-0 h-full w-full overflow-visible" aria-hidden>
            {linked.map((r) => {
              const a = layout.get(sel.e.workId)!
              const b = layout.get(r.id)
              if (!b) return null
              return (
                <line
                  key={r.id}
                  x1={toPct(a.x, W)}
                  y1={toPct(a.y, H)}
                  x2={toPct(b.x, W)}
                  y2={toPct(b.y, H)}
                  stroke="hsl(var(--primary))"
                  strokeWidth={1.5}
                  opacity={0.35 + 0.6 * r.strength}
                />
              )
            })}
          </svg>
        )}

        {[...works]
          .sort((a, b) => b.pct[face.y] - a.pct[face.y] || (a.e.workId < b.e.workId ? -1 : 1))
          .map((w) => {
            const id = w.e.workId
            const c = layout.get(id)!
            const isSel = sel?.e.workId === id
            const isLinked = linkedIds.has(id)
            const isLit = litId === id
            const dim = !matches(w)
            // Sem nenhuma ligada no mapa, nada esmaece: apagar as outras para destacar só a clicada
            // não mostra nada.
            const faded = sel != null && linked.length > 0 && !isSel && !isLinked && !dim
            const scale = isSel || isLit ? 1.3 : isLinked ? 1.1 : 1
            return (
              <button
                key={id}
                type="button"
                data-point={id}
                aria-pressed={isSel}
                aria-label={`${w.e.title}: ${mx.label} ${mx.show(w.values[face.x])}, ${my.label} ${my.show(w.values[face.y])}`}
                onMouseEnter={() => {
                  setLitId(id)
                  revealRow(id)
                }}
                onMouseLeave={() => setLitId(null)}
                onFocus={() => setLitId(id)}
                onBlur={() => setLitId(null)}
                onClick={() => selectWork(isSel ? null : id)}
                className={cn(
                  "absolute cursor-pointer overflow-hidden rounded-[7px] p-0 transition-[opacity,transform] duration-150 focus-visible:outline-none motion-reduce:transition-none",
                  dim && "pointer-events-none opacity-[0.13]",
                  faded && "opacity-55",
                )}
                style={{
                  left: toPct(c.x, W),
                  top: toPct(c.y, H),
                  width: size,
                  height: size,
                  transform: `translate(-50%, -50%) scale(${scale})`,
                  zIndex: isSel ? 7 : isLit ? 6 : isLinked ? 5 : undefined,
                  // Borda dupla: o anel escuro abre um vão entre a capa de cima e a de baixo, e o
                  // claro por fora marca onde a capa termina. Com capas semi-sobrepostas é o que
                  // mostra que são duas. Clicada = branco; ligada = azul.
                  boxShadow: isSel
                    ? "0 0 0 1.5px hsl(var(--background)), 0 0 0 3px hsl(var(--foreground)), 0 4px 12px hsl(0 0% 0% / .65)"
                    : isLinked
                      ? "0 0 0 1.5px hsl(var(--background)), 0 0 0 3px hsl(var(--primary)), 0 4px 12px hsl(0 0% 0% / .65)"
                      : `0 0 0 1.5px hsl(var(--background)), 0 0 0 2.5px ${RING}, 0 3px 10px hsl(0 0% 0% / .6)`,
                }}
              >
                <CoverImage urls={w.e.coverUrls} alt="" className="size-full object-cover object-center" />
              </button>
            )
          })}

        {labels.placed.map((l) => (
          <span
            key={l.id}
            aria-hidden
            className={cn(
              "pointer-events-none absolute whitespace-nowrap rounded-[3px] bg-background/80 px-[3px] text-[11px] font-semibold leading-[14px]",
              l.rank === 0 ? "z-[8] text-foreground" : l.rank === 1 ? "z-[8] text-primary" : "z-[4] text-muted-foreground",
            )}
            style={{ left: toPct(l.x, W), top: toPct(l.y, H) }}
          >
            {l.text}
          </span>
        ))}

        {litWork && (
          <div
            ref={tipRef}
            role="tooltip"
            className="pointer-events-none absolute z-20 max-w-[260px] rounded-[10px] border border-border bg-card px-2.5 py-2 text-[12px] opacity-0 shadow-xl"
          >
            <b className="mb-0.5 block text-[12.5px] leading-tight">{litWork.e.title}</b>
            <span className={cn("block font-mono text-[11.5px]", mx.text)}>
              {mx.label}: {mx.show(litWork.values[face.x])}
            </span>
            <span className={cn("block font-mono text-[11.5px]", my.text)}>
              {my.label}: {my.show(litWork.values[face.y])}
            </span>
          </div>
        )}

        {works.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
            Nenhuma obra com chance e nota da crítica para posicionar.
          </div>
        )}
      </div>
    </div>
  )

  // ------------------------------------------------------------------ painel: lista ou obra

  const listBody = (
    <>
      <div className="relative border-b border-border p-2.5">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Achar uma obra no mapa"
          aria-label="Achar uma obra no mapa"
          className="w-full rounded-lg border border-border bg-card py-1.5 pl-2.5 pr-8 text-[12.5px] placeholder:text-muted-foreground focus-visible:outline-2 focus-visible:outline-primary"
        />
        {query && (
          <button
            type="button"
            onClick={() => setQuery("")}
            aria-label="Limpar busca"
            className="absolute right-4 top-1/2 flex size-5 -translate-y-1/2 cursor-pointer items-center justify-center rounded text-muted-foreground hover:text-foreground"
          >
            <X className="size-4" aria-hidden />
          </button>
        )}
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)_52px_62px] items-end gap-2 border-b border-border px-3 py-2 text-[11px] text-muted-foreground">
        <span>
          {listed.length} obra{listed.length !== 1 ? "s" : ""} · maior {mx.col.toLowerCase()} primeiro
        </span>
        <span className="text-right">{mx.col}</span>
        <span className="text-right">{my.col}</span>
      </div>
      <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto">
        {grouped
          ? ARCHETYPE_ORDER.filter((a) => listed.some((w) => w.arch === a)).map((a) => (
              <Shelf
                key={a}
                arch={a}
                items={listed.filter((w) => w.arch === a)}
                litId={litId}
                render={(w) => (
                  <ListRow key={w.e.workId} w={w} fx={face.x} fy={face.y} lit={litId === w.e.workId} onLit={setLitId} onPick={selectWork} indent />
                )}
              />
            ))
          : listed.map((w) => (
              <ListRow key={w.e.workId} w={w} fx={face.x} fy={face.y} lit={litId === w.e.workId} onLit={setLitId} onPick={selectWork} />
            ))}
        {listed.length === 0 && (
          <p className="px-3 py-6 text-center text-[12px] text-muted-foreground">
            {query ? "Nenhuma obra com esse nome." : "Nenhuma obra neste tipo de aposta."}
          </p>
        )}
      </div>
    </>
  )

  const detailBody = sel ? (
    <SelectedWork
      w={sel}
      linkState={selLinks}
      linkMode={linkMode}
      rowsFor={rowsFor}
      linkedOnMap={linked.length}
      thresholds={thresholds}
      litId={litId}
      onLit={setLitId}
      onPick={selectWork}
      onBack={() => selectWork(null)}
      onRetry={() => loadLinks(sel.e.workId)}
      onMode={(m) => writePrefs({ link: m })}
    />
  ) : null

  const panelContent = detailBody ?? listBody

  const facesSeg = (
    <div role="group" aria-label="Eixos do mapa" className="inline-flex flex-wrap gap-0.5 rounded-[10px] border border-border bg-background p-[3px]">
      {BUSSOLA_FACE_ORDER.map((k) => {
        const f = BUSSOLA_FACES[k]
        const on = prefs.face === k
        return (
          <button
            key={k}
            type="button"
            aria-pressed={on}
            onClick={() => writePrefs({ face: k })}
            className={cn(
              "cursor-pointer rounded-[7px] px-2.5 py-1.5 text-left text-[12.5px] font-semibold transition-colors",
              on ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {f.label}
            <small className={cn("block text-[11px] font-medium", on ? "text-primary/80" : "text-muted-foreground/80")}>
              {f.sub}
            </small>
          </button>
        )
      })}
    </div>
  )

  const typeChips = (
    <div className="flex flex-wrap gap-1.5" role="group" aria-label="Tipo de aposta">
      <TypeChip on={focus == null} onClick={() => setFocus(null)} label="Todas" n={works.length} />
      {ARCHETYPE_ORDER.map((a) => (
        <TypeChip
          key={a}
          on={focus === a}
          onClick={() => setFocus(focus === a ? null : a)}
          label={archetypeName(ARCHETYPE_LABEL[a])}
          n={archCounts[a]}
          title={ARCHETYPE_MEANING[a]}
        />
      ))}
    </div>
  )

  const capNotice = capped ? (
    <p className="text-[12px] text-muted-foreground">
      Mostrando as <b className="font-semibold text-foreground">{works.length}</b> primeiras de {entries.length}: acima
      disso as capas se empilham.
    </p>
  ) : null

  if (maximized) {
    const acc = prefs.acc
    const toggleAcc = (k: keyof Prefs["acc"]) => writePrefs({ acc: { ...acc, [k]: !acc[k] } })
    const frame = (
      <section className="fixed inset-0 z-50 flex flex-col bg-background p-3 sm:p-4" aria-label="Bússola em tela inteira">
        <div className="grid min-h-0 flex-1 grid-rows-[minmax(0,3fr)_minmax(0,2fr)] gap-3 lg:grid-cols-[minmax(0,1fr)_360px] lg:grid-rows-[minmax(0,1fr)]">
          {plot}
          <div className="flex min-h-0 flex-col overflow-y-auto rounded-xl border border-border bg-background">
            <div className="flex flex-none items-center justify-between gap-2 border-b border-border py-2 pl-3 pr-2">
              <b className="text-[13.5px] font-bold">Bússola</b>
              <span className="flex gap-1.5">
                <NamesButton on={prefs.names} onClick={() => writePrefs({ names: !prefs.names })} short />
                <MaxButton maximized onClick={() => setMaximized(false)} />
              </span>
            </div>
            {capNotice && <div className="border-b border-border px-3 py-2">{capNotice}</div>}
            <AccSection title="Eixos" open={acc.eixos} onToggle={() => toggleAcc("eixos")} summary={face.label}>
              <div className="grid gap-0.5">
                {BUSSOLA_FACE_ORDER.map((k) => (
                  <SideOption
                    key={k}
                    on={prefs.face === k}
                    onClick={() => writePrefs({ face: k })}
                    label={BUSSOLA_FACES[k].label}
                    sub={BUSSOLA_FACES[k].sub}
                    radio
                  />
                ))}
              </div>
              <p className="mx-1 mt-2 text-[12px] leading-snug text-muted-foreground">{face.lede}</p>
            </AccSection>
            <AccSection
              title="Tipo de aposta"
              open={acc.grupos}
              onToggle={() => toggleAcc("grupos")}
              summary={focus ? archetypeName(ARCHETYPE_LABEL[focus]) : `Todas · ${works.length}`}
            >
              <div className="grid gap-0.5">
                <SideOption on={focus == null} onClick={() => setFocus(null)} label="Todas" n={works.length} />
                {ARCHETYPE_ORDER.map((a) => (
                  <SideOption
                    key={a}
                    on={focus === a}
                    onClick={() => setFocus(focus === a ? null : a)}
                    label={archetypeName(ARCHETYPE_LABEL[a])}
                    n={archCounts[a]}
                    sub={ARCHETYPE_MEANING[a]}
                  />
                ))}
              </div>
            </AccSection>
            <AccSection
              title={sel ? "Obra selecionada" : "Obras"}
              open={acc.obras}
              onToggle={() => toggleAcc("obras")}
              summary={sel ? sel.e.title : `${listed.length} obras`}
              grow
            >
              {panelContent}
            </AccSection>
          </div>
        </div>
      </section>
    )
    return typeof document === "undefined" ? frame : createPortal(frame, document.body)
  }

  return (
    <section className="flex min-w-0 flex-col gap-3 rounded-2xl border border-border bg-card/60 p-3.5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2.5">
        {facesSeg}
        <div className="flex flex-wrap items-center justify-end gap-2">
          {typeChips}
          <NamesButton on={prefs.names} onClick={() => writePrefs({ names: !prefs.names })} />
          <MaxButton maximized={false} onClick={() => setMaximized(true)} />
        </div>
      </div>
      <p className="-mt-0.5 text-[12.5px] text-muted-foreground">{face.lede}</p>
      {capNotice}
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_330px]">
        {plot}
        <div className="flex h-[420px] min-h-0 flex-col overflow-hidden rounded-xl border border-border bg-background lg:h-[560px]">
          {panelContent}
        </div>
      </div>
    </section>
  )
}

// ------------------------------------------------------------------ peças

function Corner({ arrow, name, n, after }: { arrow: string; name: string; n: number; after?: boolean }) {
  return (
    <span className="flex min-w-0 shrink items-baseline gap-1.5 whitespace-nowrap font-semibold text-muted-foreground">
      <span className="truncate">{after ? `${name} ${arrow}` : `${arrow} ${name}`}</span>
      <span className="font-mono text-[11px] font-semibold text-muted-foreground/70">{n}</span>
    </span>
  )
}

function TypeChip({ on, onClick, label, n, title }: { on: boolean; onClick: () => void; label: string; n: number; title?: string }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      title={title}
      className={cn(
        "inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px] font-semibold transition-colors",
        on ? "border-primary/60 bg-card text-foreground" : "border-border bg-background text-muted-foreground hover:border-muted-foreground",
      )}
    >
      {label} <span className="font-mono text-[11px] text-muted-foreground">{n}</span>
    </button>
  )
}

function NamesButton({ on, onClick, short }: { on: boolean; onClick: () => void; short?: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      title="Mostrar o nome ao lado de todas as capas (a obra clicada e as ligadas sempre mostram)"
      className={cn(
        "cursor-pointer rounded-[9px] border px-3 text-[12.5px] font-semibold transition-colors",
        short ? "h-[30px] px-2.5" : "h-[34px]",
        on ? "border-primary/50 bg-primary/10 text-primary" : "border-border bg-background text-muted-foreground hover:text-foreground",
      )}
    >
      {short ? "Nomes" : "Todos os nomes"}
    </button>
  )
}

function MaxButton({ maximized, onClick }: { maximized: boolean; onClick: () => void }) {
  const Icon = maximized ? Minimize2 : Maximize2
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={maximized ? "Sair da tela inteira" : "Ampliar o mapa"}
      title={maximized ? "Sair da tela inteira (Esc)" : "Ampliar o mapa (Esc volta)"}
      className={cn(
        "inline-grid cursor-pointer place-items-center rounded-[9px] border border-border bg-background text-muted-foreground transition-colors hover:border-muted-foreground hover:text-foreground",
        maximized ? "size-[30px]" : "size-[34px]",
      )}
    >
      <Icon className="size-4" aria-hidden />
    </button>
  )
}

function AccSection({
  title, open, onToggle, summary, grow, children,
}: {
  title: string
  open: boolean
  onToggle: () => void
  summary: string
  grow?: boolean
  children: React.ReactNode
}) {
  return (
    <section
      className={cn(
        "flex flex-col border-b border-border",
        grow && open ? "min-h-[240px] flex-auto border-b-0" : "flex-none",
      )}
    >
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        className="flex w-full cursor-pointer items-center gap-2 px-3 py-2.5 text-left text-[11px] font-bold uppercase tracking-[0.06em] text-muted-foreground hover:text-foreground"
      >
        <ChevronDown className={cn("size-3 flex-none transition-transform", !open && "-rotate-90")} aria-hidden />
        {title}
        {!open && (
          <span className="ml-auto max-w-[60%] truncate text-[11.5px] font-semibold normal-case tracking-normal text-muted-foreground">
            {summary}
          </span>
        )}
      </button>
      {open &&
        (grow ? (
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden border-t border-border">{children}</div>
        ) : (
          <div className="px-2.5 pb-2.5">{children}</div>
        ))}
    </section>
  )
}

function SideOption({
  on, onClick, label, sub, n, radio,
}: {
  on: boolean
  onClick: () => void
  label: string
  sub?: string
  n?: number
  radio?: boolean
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn(
        "grid w-full cursor-pointer grid-cols-[12px_minmax(0,1fr)_auto] items-center gap-x-2 gap-y-px rounded-lg border px-2 py-1.5 text-left",
        on ? "border-primary/60 bg-card" : "border-transparent hover:bg-card",
      )}
    >
      {radio ? (
        <span
          className={cn("size-2.5 rounded-full border-2", on ? "border-primary bg-primary/60" : "border-muted-foreground/60")}
          aria-hidden
        />
      ) : (
        <span aria-hidden />
      )}
      <span className="text-[12.5px] font-semibold text-foreground">{label}</span>
      <span className="font-mono text-[11px] text-muted-foreground">{n ?? ""}</span>
      {sub && <small className="col-span-2 col-start-2 text-[11px] leading-snug text-muted-foreground">{sub}</small>}
    </button>
  )
}

function Shelf({
  arch, items, litId, render,
}: {
  arch: ForceArchetype
  items: MapWork[]
  litId: string | null
  render: (w: MapWork) => React.ReactNode
}) {
  const [open, setOpen] = useState(true)
  // Fechada, a prateleira esconderia a linha que o mouse no mapa quer acender: o hover reabre.
  const expanded = open || (litId != null && items.some((w) => w.e.workId === litId))
  return (
    <div className="border-b border-border last:border-b-0">
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setOpen((v) => !v)}
        title={ARCHETYPE_MEANING[arch]}
        className="sticky top-0 z-10 flex w-full cursor-pointer items-center gap-2 bg-muted/80 px-3 py-1.5 text-left backdrop-blur hover:bg-muted"
      >
        <ChevronDown className={cn("size-3 flex-none text-muted-foreground transition-transform", !expanded && "-rotate-90")} aria-hidden />
        <span className="text-[11.5px] font-bold">{archetypeName(ARCHETYPE_LABEL[arch])}</span>
        <span className="font-mono text-[10.5px] text-muted-foreground">{items.length}</span>
      </button>
      {expanded && items.map(render)}
    </div>
  )
}

function ListRow({
  w, fx, fy, lit, onLit, onPick, indent,
}: {
  w: MapWork
  fx: BussolaMeasureKey
  fy: BussolaMeasureKey
  lit: boolean
  onLit: (id: string | null) => void
  onPick: (id: string) => void
  indent?: boolean
}) {
  const id = w.e.workId
  return (
    <button
      type="button"
      data-work={id}
      onMouseEnter={() => onLit(id)}
      onMouseLeave={() => onLit(null)}
      onFocus={() => onLit(id)}
      onBlur={() => onLit(null)}
      onClick={() => onPick(id)}
      className={cn(
        "grid w-full cursor-pointer grid-cols-[minmax(0,1fr)_52px_62px] items-center gap-2 border-b border-border/50 px-3 py-1.5 text-left transition-colors last:border-b-0 hover:bg-primary/5",
        indent && "pl-5",
        lit && "bg-primary/10 shadow-[inset_2px_0_0_hsl(var(--primary))]",
      )}
    >
      <span className="flex min-w-0 items-center gap-1.5 text-[12.5px] font-medium">
        <span className="truncate">{w.e.title}</span>
        <WorkContentChip isAdult={w.e.isAdult} isMixed={w.e.isMixed} className="shrink-0 px-1.5 py-0 text-[9.5px] leading-tight" />
      </span>
      <span className={cn("whitespace-nowrap text-right font-mono text-[12px]", BUSSOLA_MEASURES[fx].text)}>{BUSSOLA_MEASURES[fx].show(w.values[fx])}</span>
      <span className={cn("whitespace-nowrap text-right font-mono text-[12px]", BUSSOLA_MEASURES[fy].text)}>{BUSSOLA_MEASURES[fy].show(w.values[fy])}</span>
    </button>
  )
}

function ForceRow({ label, value, width, fill, text, note }: { label: string; value: string; width: number; fill: string; text: string; note: string }) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-2 gap-y-1 text-[12px] text-muted-foreground">
      <span>{label}</span>
      <b className={cn("font-mono text-[13px]", text)}>{value}</b>
      <div className="relative col-span-2 h-1.5 overflow-hidden rounded-full bg-muted">
        <span className={cn("absolute inset-y-0 left-0 rounded-full", fill)} style={{ width: `${Math.max(0, Math.min(100, width))}%` }} />
      </div>
      <small className="col-span-2 text-[11px] text-muted-foreground/80">{note}</small>
    </div>
  )
}

function SelectedWork({
  w, linkState, linkMode, rowsFor, linkedOnMap, thresholds, litId, onLit, onPick, onBack, onRetry, onMode,
}: {
  w: MapWork
  linkState: LinkState | undefined
  linkMode: BussolaLinkMode
  rowsFor: (mode: BussolaLinkMode) => LinkRow[] | null | undefined
  linkedOnMap: number
  thresholds?: ScoreColorThresholds | null
  litId: string | null
  onLit: (id: string | null) => void
  onPick: (id: string) => void
  onBack: () => void
  onRetry: () => void
  onMode: (m: BussolaLinkMode) => void
}) {
  const e = w.e
  const rank = (k: BussolaMeasureKey) => `acima de ${Math.round(w.pct[k])}% das obras na tela`
  const status = e.publicationStatusShort ?? e.publicationStatus
  const rows = rowsFor(linkMode)
  const loading = linkMode !== "near" && (linkState === undefined || linkState === "loading")
  const failed = linkMode !== "near" && linkState === "error"
  const total = (mode: BussolaLinkMode, list: LinkRow[]) =>
    mode === "profile" && linkState && typeof linkState !== "string" ? linkState.profileTotal : list.length

  let hint = LINK_MODE_HINT[linkMode]
  if (linkMode !== "near" && rows && rows.length > 0) {
    hint += linkedOnMap > 0 ? " As que estão no mapa ganham uma linha." : " Nenhuma está entre as obras do mapa (o filtro deixa as outras de fora)."
  }

  const empty =
    rows === null
      ? linkMode === "groups"
        ? "Entre na sua conta para ver as obras dos seus grupos de favoritos."
        : "Esta obra não tem as 9 notas de atributo, então não há perfil para comparar."
      : linkMode === "groups"
        ? "Nenhuma outra obra divide um grupo de favoritos seu com esta."
        : "Nenhuma obra ligada neste critério."

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <button
        type="button"
        onClick={onBack}
        className="flex-none cursor-pointer border-b border-border px-3 py-2 text-left text-[12px] font-semibold text-muted-foreground hover:text-foreground"
      >
        ← Voltar à lista
      </button>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="flex gap-3 border-b border-border p-3">
          <CoverImage urls={e.coverUrls} alt="" className="h-[90px] w-16 flex-none rounded-md object-cover" />
          <div className="min-w-0">
            <h3 className="text-balance text-[14.5px] font-semibold leading-tight">{e.title}</h3>
            <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11.5px] text-muted-foreground">
              <span>{e.year ?? "ano —"}</span>
              {status && <span>· {status}</span>}
              <WorkContentChip isAdult={e.isAdult} isMixed={e.isMixed} className="px-1.5 py-0 text-[10px]" />
            </div>
            <span
              className="mt-2 inline-flex items-center rounded-full border border-border px-2 py-0.5 text-[11.5px] font-semibold text-muted-foreground"
              title={`Tipo de aposta: ${ARCHETYPE_MEANING[w.arch]}`}
            >
              {archetypeName(ARCHETYPE_LABEL[w.arch])}
            </span>
          </div>
        </div>
        <div className="grid gap-2.5 border-b border-border p-3">
          <ForceRow
            label={BUSSOLA_MEASURES.chance.label}
            value={BUSSOLA_MEASURES.chance.show(w.values.chance)}
            width={w.values.chance}
            fill={BUSSOLA_MEASURES.chance.fill}
            text={BUSSOLA_MEASURES.chance.text}
            note={rank("chance")}
          />
          <ForceRow
            label={BUSSOLA_MEASURES.crit.label}
            value={`★ ${fmtScore(w.values.crit)}`}
            width={w.values.crit * 10}
            fill={BUSSOLA_MEASURES.crit.fill}
            text={BUSSOLA_MEASURES.crit.text}
            note={rank("crit")}
          />
          <ForceRow
            label={BUSSOLA_MEASURES.votes.label}
            value={e.totalVotes > 0 ? `${e.totalVotes.toLocaleString("pt-BR")} votos` : "sem votos"}
            width={w.pct.votes}
            fill={BUSSOLA_MEASURES.votes.fill}
            text={BUSSOLA_MEASURES.votes.text}
            note={rank("votes")}
          />
        </div>
        <div className="flex items-baseline justify-between border-b border-border px-3 py-2.5 text-[12px] text-muted-foreground">
          <span>Nota Prevista</span>
          <b className={cn("font-mono text-[18px]", getScoreTextColor(e.expectedScore, thresholds))}>
            {e.expectedScore != null ? fmtScore(e.expectedScore) : "—"}
          </b>
        </div>

        <div className="px-3 pb-0.5 pt-2.5 text-[11px] font-bold uppercase tracking-[0.06em] text-muted-foreground">
          Ligações <span className="font-medium normal-case tracking-normal">· no mapa / no total</span>
        </div>
        <div className="flex flex-wrap gap-1.5 px-3 pb-1 pt-2" role="group" aria-label="Critério das ligações">
          {BUSSOLA_LINK_MODES.map((m) => {
            const list = rowsFor(m.key)
            const n =
              m.key === "near"
                ? `${list?.length ?? 0}`
                : list
                  ? `${list.filter((r) => r.onMap).length}/${total(m.key, list)}`
                  : list === null
                    ? "—"
                    : "…"
            return (
              <button
                key={m.key}
                type="button"
                aria-pressed={linkMode === m.key}
                onClick={() => onMode(m.key)}
                title="no mapa / no total"
                className={cn(
                  "inline-flex cursor-pointer items-baseline gap-1.5 rounded-full border px-2.5 py-1 text-[11.5px] font-semibold transition-colors",
                  linkMode === m.key
                    ? "border-primary/60 bg-primary/10 text-primary"
                    : "border-border bg-card text-muted-foreground hover:border-muted-foreground",
                )}
              >
                {m.label} <span className="font-mono text-[10.5px] text-muted-foreground">{n}</span>
              </button>
            )
          })}
        </div>
        <p className="mx-3 mb-1.5 mt-0.5 text-[11.5px] leading-snug text-muted-foreground">{hint}</p>

        {loading ? (
          <p className="px-3 py-4 text-center text-[12px] text-muted-foreground">Carregando as ligações…</p>
        ) : failed ? (
          <p className="px-3 py-4 text-center text-[12px] text-muted-foreground">
            Não deu para carregar as ligações.{" "}
            <button type="button" onClick={onRetry} className="cursor-pointer font-semibold text-primary underline-offset-2 hover:underline">
              Tentar de novo
            </button>
          </p>
        ) : rows && rows.length > 0 ? (
          <>
            {rows.slice(0, LINK_ROWS_SHOWN).map((r) =>
              r.onMap ? (
                <button
                  key={r.id}
                  type="button"
                  data-link={r.id}
                  onMouseEnter={() => onLit(r.id)}
                  onMouseLeave={() => onLit(null)}
                  onFocus={() => onLit(r.id)}
                  onBlur={() => onLit(null)}
                  onClick={() => onPick(r.id)}
                  className={cn(
                    "grid w-full cursor-pointer grid-cols-[minmax(0,1fr)_auto] items-center gap-2 border-b border-border/50 px-3 py-1.5 text-left hover:bg-primary/5",
                    litId === r.id && "bg-primary/10 shadow-[inset_2px_0_0_hsl(var(--primary))]",
                  )}
                >
                  <LinkTitle r={r} />
                  <span className="whitespace-nowrap text-right text-[11.5px] text-muted-foreground">{r.why}</span>
                </button>
              ) : (
                <div
                  key={r.id}
                  data-link={r.id}
                  className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 border-b border-border/50 px-3 py-1.5"
                >
                  <LinkTitle r={r} muted />
                  <span className="whitespace-nowrap text-right text-[11.5px] text-muted-foreground">
                    {r.why}
                    <small className="block text-[10px] text-muted-foreground/70">fora do mapa</small>
                  </span>
                </div>
              ),
            )}
            {total(linkMode, rows) > LINK_ROWS_SHOWN && (
              <p className="px-3 py-1.5 text-[11.5px] text-muted-foreground">
                +{total(linkMode, rows) - LINK_ROWS_SHOWN} obras
              </p>
            )}
          </>
        ) : (
          <p className="px-3 py-4 text-center text-[12px] text-muted-foreground">{empty}</p>
        )}

        <Link
          href={`/catalog/${titleToSlug(e.title)}`}
          className="m-3 mt-2.5 block rounded-lg border border-border bg-card px-2 py-2 text-center text-[12.5px] font-semibold hover:border-muted-foreground"
        >
          Abrir a obra
        </Link>
      </div>
    </div>
  )
}

function LinkTitle({ r, muted }: { r: LinkRow; muted?: boolean }) {
  return (
    <span className={cn("flex min-w-0 items-center gap-1.5 text-[12.5px] font-medium", muted && "text-muted-foreground")}>
      <span className="truncate">{r.title}</span>
      <WorkContentChip isAdult={r.isAdult} isMixed={r.isMixed} className="shrink-0 px-1.5 py-0 text-[9.5px] leading-tight" />
    </span>
  )
}
