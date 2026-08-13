"use client"

import { useMemo, useState, useTransition, useEffect } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import Image from "next/image"
import { Radar, Plus, X, Search, Loader2 } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import { AdultBadge } from "@/components/ui/adult-badge"
import { ExplainPanel } from "@/components/discovery/explain-panel"
import { titleToSlug } from "@/lib/utils"
import { searchWorkSuggestions } from "@/server/actions/work-search"
import {
  blendCandidates,
  snapWeight,
  diversify,
  countNearDuplicates,
  NEAR_DUPLICATE_WARN_AT,
} from "@/lib/discovery/blend"
import {
  MAX_SEEDS,
  MAX_ANTI_SEEDS,
  MIN_SEEDS,
  DEFAULT_RESULT_LIMIT,
  EXPLAIN_COUNT,
} from "@/lib/discovery/limits"
import type { DiscoveryResult, DiscoveryWork, DiscoverySeedInfo } from "@/server/queries/seed-discovery"
import type { WorkSuggestion } from "@/server/queries/work-suggestions"
import type { BlendCandidate } from "@/lib/discovery/blend"

/**
 * A tela de "Mais como estas".
 *
 * 🔴 O slider reordena LOCALMENTE, sem ir ao servidor. Ele só pode fazer isso porque a
 * página recebe a UNIÃO dos tops de todas as paradas (`unionOfTops`) — trocar isso por um
 * `slice` do peso corrente faz aparecer obra sem título assim que alguém arrasta o controle.
 *
 * Mudar SEMENTE, filtro ou peso final navega (a URL é o estado durável); mudar só a posição
 * do slider não, senão cada pixel arrastado viraria um round-trip.
 */

interface Props {
  result: DiscoveryResult
  onlyUnread: boolean
}

export function DiscoveryView({ result, onlyUnread }: Props) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [weight, setWeight] = useState(result.weight)

  // O servidor é a fonte do peso: quando a URL muda por fora (voltar do browser, preset),
  // o estado local adota o valor novo em vez de brigar com ele.
  const [lastFromServer, setLastFromServer] = useState(result.weight)
  if (lastFromServer !== result.weight) {
    setLastFromServer(result.weight)
    setWeight(result.weight)
  }

  const seedIds = result.seeds.map((s) => s.id)
  const antiIds = result.antiSeeds.map((s) => s.id)

  function navigate(next: {
    seeds?: string[]
    anti?: string[]
    w?: number
    lidas?: boolean
  }) {
    const params = new URLSearchParams()
    const s = next.seeds ?? seedIds
    const a = next.anti ?? antiIds
    if (s.length) params.set("seeds", s.join(","))
    if (a.length) params.set("anti", a.join(","))
    params.set("w", String(Math.round((next.w ?? weight) * 100)))
    if (next.lidas ?? !onlyUnread) params.set("lidas", "1")
    startTransition(() => router.push(`/descobrir?${params}`, { scroll: false }))
  }

  // Reordenação local: os dois eixos já vêm resolvidos por obra.
  const ordered = useMemo(() => {
    const candidates: BlendCandidate[] = result.works.map((w) => ({
      workId: w.id,
      // `simPos` já está normalizado em percentil pelo servidor; reusar o percentil aqui
      // mantém a régua idêntica à do servidor em vez de recalcular sobre um subconjunto.
      simPos: w.simPercentile,
      simNeg: 0,
      fitPercentile: w.fitPercentile,
    }))
    const byId = new Map(result.works.map((w) => [w.id, w]))
    const posById = new Map(result.works.map((w, i) => [w.id, i]))

    // 🔴 Diversificar ANTES de cortar em 24, nunca depois: aplicado sobre a lista já cortada,
    // o MMR só embaralharia as mesmas 24 obras — quem entra no lugar da quase-duplicata está
    // na 25ª posição, fora do corte. Medido: 2,4 de 10 obras do top-10 tinham uma
    // quase-duplicata, com posição mediana 4.
    const ordenados = blendCandidates(candidates, weight)
    const rows = diversify(ordenados, result.simMatrix, DEFAULT_RESULT_LIMIT)
      .map((b) => ({ work: byId.get(b.workId)!, score: b.score }))
      .filter((r) => r.work != null)

    // "puxada por X" só aparece quando DISCRIMINA. Medido no catálogo: no top-40 uma única
    // semente responde por 29 das obras (ela é a mais típica do eixo), então imprimir o
    // rótulo em toda linha é repetir a mesma palavra 29 vezes e enterrar as 11 que dizem
    // algo. Mesma régua do painel "Estado da obra": o que é maioria vira número, só o raro
    // vira rótulo.
    const freq = new Map<string, number>()
    for (const r of rows) {
      const id = r.work.nearestSeedId
      if (id) freq.set(id, (freq.get(id) ?? 0) + 1)
    }
    let dominante: string | null = null
    for (const [id, n] of freq) {
      if (n > rows.length / 2) dominante = id
    }

    const duplicadas = countNearDuplicates(
      rows.map((r) => ({ index: posById.get(r.work.id) ?? -1 })),
      result.simMatrix,
    )

    return {
      rows: rows.map((r) => ({
        ...r,
        showSeed: r.work.nearestSeedId != null && r.work.nearestSeedId !== dominante,
      })),
      duplicadas,
    }
  }, [result.works, result.simMatrix, weight])

  const hasSeeds = result.seeds.length >= MIN_SEEDS

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 p-4 md:p-6">
      <header className="flex flex-col gap-2">
        <div className="flex items-center gap-2 text-muted-foreground">
          <Radar className="h-4 w-4" />
          <span className="text-xs font-semibold uppercase tracking-wider">Recomendações</span>
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">Mais como estas</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Aponte de {MIN_SEEDS} a {MAX_SEEDS} obras. O catálogo é varrido por parecença com{" "}
          <em>elas</em> e por alinhamento com <em>você</em> — dois eixos independentes, então
          cada ponta do controle devolve uma lista diferente.
        </p>
      </header>

      <SeedsCard
        seeds={result.seeds}
        antiSeeds={result.antiSeeds}
        cohesion={result.cohesion}
        cohesionLevel={result.cohesionLevel}
        seedsIgnored={result.seedsIgnored}
        disabled={pending}
        onChange={(seeds, anti) => navigate({ seeds, anti })}
      />

      {!hasSeeds && (
        <Card>
          <CardContent className="py-8 text-center">
            <p className="text-sm text-muted-foreground">
              {result.seeds.length === 0
                ? "Escolha ao menos duas obras para começar."
                : "Falta mais uma obra — o cruzamento precisa de pelo menos duas para ter um eixo."}
            </p>
          </CardContent>
        </Card>
      )}

      {hasSeeds && (
        <>
          <MixCard
            weight={weight}
            fitAvailable={result.fitAvailable}
            divergence={result.extremesDivergence}
            onChange={setWeight}
            onCommit={(w) => navigate({ w })}
          />

          <Card>
            <CardHeader className="flex flex-row flex-wrap items-baseline justify-between gap-3">
              <CardTitle className="text-base">O que apareceu</CardTitle>
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                <span className="tabular-nums">
                  {result.candidateCount} candidatas · top {ordered.rows.length}
                </span>
                {/* Só quando SOBRA repetição depois de diversificar. O limiar sai da
                    distribuição medida (mediana 2, p90 4) — ver NEAR_DUPLICATE_WARN_AT. */}
                {ordered.duplicadas > NEAR_DUPLICATE_WARN_AT && (
                  <span className="text-amber-600 dark:text-amber-400">
                    algumas obras aqui são muito parecidas entre si
                  </span>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  disabled={pending}
                  onClick={() => navigate({ lidas: onlyUnread })}
                >
                  {onlyUnread ? "Só não lidas" : "Todas"}
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {ordered.rows.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  Nenhuma obra sobrou com estes filtros.{" "}
                  {onlyUnread && "Tente incluir as já lidas."}
                </p>
              ) : (
                <div className="flex flex-col gap-4">
                  <ol className="flex flex-col gap-1">
                    {ordered.rows.map(({ work, score, showSeed }, i) => (
                      <ResultRow
                        key={work.id}
                        rank={i + 1}
                        work={work}
                        score={score}
                        showSeed={showSeed}
                      />
                    ))}
                  </ol>

                  {/* Só as EXIBIDAS no topo vão ao modelo: mandar as 24 multiplicaria o
                      custo por uma prosa que ninguém vai ler até o fim. */}
                  <div className="border-t pt-4">
                    <ExplainPanel
                      seedIds={seedIds}
                      antiIds={antiIds}
                      works={ordered.rows
                        .slice(0, EXPLAIN_COUNT)
                        .map((r) => ({ id: r.work.id, title: r.work.title }))}
                      weight={weight}
                    />
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────────────────

function SeedsCard({
  seeds,
  antiSeeds,
  cohesion,
  cohesionLevel,
  seedsIgnored,
  disabled,
  onChange,
}: {
  seeds: DiscoverySeedInfo[]
  antiSeeds: DiscoverySeedInfo[]
  cohesion: number | null
  cohesionLevel: DiscoveryResult["cohesionLevel"]
  seedsIgnored: number
  disabled: boolean
  onChange: (seeds: string[], anti: string[]) => void
}) {
  const seedIds = seeds.map((s) => s.id)
  const antiIds = antiSeeds.map((s) => s.id)

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-baseline justify-between gap-3">
        <CardTitle className="text-base">Suas sementes</CardTitle>
        <span className="text-xs text-muted-foreground">
          {seeds.length} de {MAX_SEEDS} · mínimo {MIN_SEEDS}
        </span>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div>
          <Label>Mais como estas</Label>
          <div className="flex flex-wrap gap-2">
            {seeds.map((s) => (
              <SeedChip
                key={s.id}
                seed={s}
                tone="positive"
                disabled={disabled}
                onRemove={() => onChange(seedIds.filter((id) => id !== s.id), antiIds)}
              />
            ))}
            {seeds.length < MAX_SEEDS && (
              <WorkPicker
                label="Adicionar obra"
                exclude={[...seedIds, ...antiIds]}
                disabled={disabled}
                onPick={(id) => onChange([...seedIds, id], antiIds)}
              />
            )}
          </div>
        </div>

        <div className="border-t border-dashed pt-4">
          <Label>
            Menos como esta{" "}
            <span className="font-normal normal-case tracking-normal">— opcional</span>
          </Label>
          <div className="flex flex-wrap gap-2">
            {antiSeeds.map((s) => (
              <SeedChip
                key={s.id}
                seed={s}
                tone="negative"
                disabled={disabled}
                onRemove={() => onChange(seedIds, antiIds.filter((id) => id !== s.id))}
              />
            ))}
            {antiSeeds.length < MAX_ANTI_SEEDS && (
              <WorkPicker
                label="Evitar uma obra"
                exclude={[...seedIds, ...antiIds]}
                disabled={disabled}
                onPick={(id) => onChange(seedIds, [...antiIds, id])}
              />
            )}
          </div>
        </div>

        {seeds.length >= MIN_SEEDS && (
          <CohesionMeter cohesion={cohesion} level={cohesionLevel} />
        )}

        {seedsIgnored > 0 && (
          <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
            {seedsIgnored === 1
              ? "Uma das obras escolhidas ainda não tem vetor e foi ignorada na busca."
              : `${seedsIgnored} das obras escolhidas ainda não têm vetor e foram ignoradas na busca.`}
          </p>
        )}
      </CardContent>
    </Card>
  )
}

/**
 * A coesão responde "dá pra confiar nesta busca?" ANTES da lista.
 *
 * ⚠️ O texto do "acaso = 0" não é didatismo: no espaço centralizado a similaridade média
 * entre duas obras quaisquer é zero por construção, e é isso que torna o número legível sem
 * escala de referência.
 */
function CohesionMeter({
  cohesion,
  level,
}: {
  cohesion: number | null
  level: DiscoveryResult["cohesionLevel"]
}) {
  if (cohesion == null) return null

  const weak = level === "weak"
  const pct = Math.max(0, Math.min(100, (cohesion / 0.5) * 100))

  return (
    <div className="flex flex-col gap-2 rounded-lg bg-muted/50 p-3">
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex flex-col">
          <span
            className={`text-xl font-semibold tabular-nums ${
              weak ? "text-amber-600 dark:text-amber-400" : "text-emerald-600 dark:text-emerald-400"
            }`}
          >
            {cohesion.toFixed(3).replace(".", ",")}
          </span>
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            coesão
          </span>
        </div>
        <div className="min-w-[140px] flex-1">
          <div className="h-1.5 overflow-hidden rounded-full bg-border">
            <div
              className={`h-full rounded-full ${weak ? "bg-amber-500" : "bg-emerald-500"}`}
              style={{ width: `${pct}%` }}
            />
          </div>
          <div className="mt-1 flex justify-between font-mono text-[10px] text-muted-foreground">
            <span>0,00 acaso</span>
            <span>0,15 fraca</span>
            <span>0,50</span>
          </div>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        {weak ? (
          <>
            <strong className="text-amber-600 dark:text-amber-400">
              Estas obras não têm um eixo em comum.
            </strong>{" "}
            O resultado tende ao genérico — vale trocar uma delas ou fazer duas buscas
            separadas.
          </>
        ) : (
          <>
            As sementes compartilham um eixo. Como a média do catálogo é subtraída antes de
            comparar, <strong>0,00 é o acaso</strong> — e elas estão acima dele.
          </>
        )}
      </p>
    </div>
  )
}

function MixCard({
  weight,
  fitAvailable,
  divergence,
  onChange,
  onCommit,
}: {
  weight: number
  fitAvailable: boolean
  divergence: number
  onChange: (w: number) => void
  onCommit: (w: number) => void
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-baseline justify-between gap-3">
        <CardTitle className="text-base">O que deve pesar mais</CardTitle>
        <span className="text-xs text-muted-foreground">
          {divergence > 0
            ? `${divergence} das 10 trocam entre as pontas`
            : "os dois eixos concordam nesta busca"}
        </span>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex justify-between text-xs font-semibold">
          <span className="text-indigo-600 dark:text-indigo-400">◄ Parecidas com as sementes</span>
          <span className="text-emerald-600 dark:text-emerald-400">A minha cara ►</span>
        </div>
        <input
          type="range"
          min={0}
          max={100}
          step={10}
          value={Math.round(weight * 100)}
          aria-label="Peso entre parecença com as sementes e alinhamento com o seu perfil"
          className="w-full accent-indigo-600 dark:accent-indigo-400"
          onChange={(e) => onChange(snapWeight(Number(e.target.value) / 100))}
          // A URL só é atualizada ao SOLTAR: durante o arrasto a lista já reordenou
          // localmente, e navegar a cada passo seria um round-trip por pixel.
          onPointerUp={() => onCommit(weight)}
          onKeyUp={() => onCommit(weight)}
        />
        <div className="flex flex-wrap gap-2">
          {[
            { w: 0.9, label: "Muito parecidas" },
            { w: 0.5, label: "Equilibrado" },
            { w: 0.1, label: "A minha cara" },
          ].map((p) => (
            <Button
              key={p.w}
              variant={Math.abs(weight - p.w) < 0.001 ? "default" : "outline"}
              size="sm"
              onClick={() => {
                onChange(p.w)
                onCommit(p.w)
              }}
            >
              {p.label}
            </Button>
          ))}
        </div>

        {!fitAvailable && (
          <p className="rounded-md border border-sky-500/40 bg-sky-500/10 px-3 py-2 text-xs text-sky-700 dark:text-sky-300">
            Você ainda não tem <strong>perfil de gosto</strong>, então só a parecença pesa aqui
            — mover o controle não muda a lista. O perfil nasce depois de você avaliar algumas
            obras.
          </p>
        )}
      </CardContent>
    </Card>
  )
}

function ResultRow({
  rank,
  work,
  score,
  showSeed,
}: {
  rank: number
  work: DiscoveryWork
  score: number
  showSeed: boolean
}) {
  return (
    <li className="flex items-center gap-3 rounded-lg border border-transparent p-2 hover:border-border hover:bg-muted/50">
      <span className="w-5 shrink-0 text-right font-mono text-xs tabular-nums text-muted-foreground">
        {rank}
      </span>
      {work.coverUrl ? (
        <Image
          src={work.coverUrl}
          alt=""
          width={32}
          height={44}
          className="h-11 w-8 shrink-0 rounded object-cover"
          unoptimized
        />
      ) : (
        <div className="h-11 w-8 shrink-0 rounded border bg-muted" />
      )}

      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <Link
          href={`/titles/${titleToSlug(work.title)}`}
          className="truncate text-sm font-medium hover:underline"
        >
          {work.title}
        </Link>
        <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
          {work.isAdult && <AdultBadge />}
          <span className="tabular-nums">{work.year ?? "—"}</span>
          <span>·</span>
          <span className="tabular-nums">{work.totalChapters ?? "?"} cap.</span>
          {showSeed && work.nearestSeedTitle && (
            <>
              <span>·</span>
              <span className="truncate">puxada por {work.nearestSeedTitle}</span>
            </>
          )}
        </div>
      </div>

      <div className="hidden w-28 shrink-0 flex-col gap-1 sm:flex">
        <Bar label="sim" value={work.simPercentile} tone="sim" />
        <Bar label="vc" value={work.fitPercentile} tone="fit" />
      </div>

      {/* Colunas informativas — NUNCA entram no score (ver lib/discovery/blend.ts). */}
      <div className="hidden w-20 shrink-0 flex-col items-end gap-0.5 font-mono text-[10px] tabular-nums text-muted-foreground lg:flex">
        <span>Prev. {work.expectedScore == null ? "—" : work.expectedScore.toFixed(1).replace(".", ",")}</span>
        <span className={work.alignmentScore == null ? "opacity-50" : "text-violet-600 dark:text-violet-400"}>
          Ver. {work.alignmentScore == null ? "—" : Math.round(work.alignmentScore)}
        </span>
      </div>

      <span className="w-10 shrink-0 text-right font-mono text-base font-semibold tabular-nums">
        {Math.round(score)}
      </span>
    </li>
  )
}

function Bar({
  label,
  value,
  tone,
}: {
  label: string
  value: number | null
  tone: "sim" | "fit"
}) {
  const pct = value == null ? 0 : Math.max(0, Math.min(100, value))
  return (
    <div className="flex items-center gap-1.5 font-mono text-[10px] tabular-nums">
      <span
        className={`w-4 font-semibold ${
          tone === "sim"
            ? "text-indigo-600 dark:text-indigo-400"
            : "text-emerald-600 dark:text-emerald-400"
        }`}
      >
        {label}
      </span>
      {/* `block` é obrigatório: span inline ignora height e a barra sai vazia. */}
      <span className="block h-1 flex-1 overflow-hidden rounded-full bg-border">
        <span
          className={`block h-full rounded-full ${
            tone === "sim" ? "bg-indigo-500" : "bg-emerald-500"
          }`}
          style={{ width: `${pct}%` }}
        />
      </span>
      <span className="w-5 text-right">{value == null ? "—" : Math.round(value)}</span>
    </div>
  )
}

function SeedChip({
  seed,
  tone,
  disabled,
  onRemove,
}: {
  seed: DiscoverySeedInfo
  tone: "positive" | "negative"
  disabled: boolean
  onRemove: () => void
}) {
  return (
    <div
      className={`flex max-w-[260px] items-center gap-2 rounded-lg border p-1.5 pr-2 ${
        tone === "positive"
          ? "border-indigo-500/40 bg-indigo-500/10"
          : "border-amber-500/40 bg-amber-500/10"
      }`}
    >
      {seed.coverUrl ? (
        <Image
          src={seed.coverUrl}
          alt=""
          width={30}
          height={42}
          className="h-10 w-7 shrink-0 rounded object-cover"
          unoptimized
        />
      ) : (
        <div className="h-10 w-7 shrink-0 rounded bg-muted" />
      )}
      <div className="flex min-w-0 flex-col">
        <span className="line-clamp-2 text-xs font-medium leading-tight">{seed.title}</span>
        <span className="text-[10px] text-muted-foreground tabular-nums">
          {seed.year ?? "—"}
          {!seed.hasEmbedding && " · sem vetor"}
        </span>
      </div>
      <button
        type="button"
        disabled={disabled}
        onClick={onRemove}
        aria-label={`Remover ${seed.title}`}
        className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-50"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}

/** Busca de obra reusando `searchWorkSuggestions` — a mesma fonte do ⌘K. */
function WorkPicker({
  label,
  exclude,
  disabled,
  onPick,
}: {
  label: string
  exclude: string[]
  disabled: boolean
  onPick: (id: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [term, setTerm] = useState("")
  const [fetched, setFetched] = useState<{ term: string; items: WorkSuggestion[] }>({
    term: "",
    items: [],
  })

  // ⚠️ Nenhum `setState` SÍNCRONO aqui dentro: o lint (`react-hooks`) barra, porque isso
  // dispara uma cascata de renders. Os dois estados derivados saem no render (`visible`,
  // `loading`), e o que sobra no effect é só o resultado da busca, já dentro do timer.
  useEffect(() => {
    const q = term.trim()
    if (q.length < 2) return

    let cancelled = false
    const timer = setTimeout(() => {
      searchWorkSuggestions(q)
        .then((r) => {
          if (!cancelled) setFetched({ term: q, items: r })
        })
        .catch(() => {
          if (!cancelled) setFetched({ term: q, items: [] })
        })
    }, 200)

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [term])

  const q = term.trim()
  // "carregando" é DERIVADO: o que já foi buscado não corresponde ao que está digitado.
  const loading = q.length >= 2 && fetched.term !== q
  const visible =
    q.length < 2 ? [] : fetched.items.filter((i) => !exclude.includes(i.id))

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          className="flex min-w-[140px] items-center justify-center gap-1.5 rounded-lg border border-dashed px-3 py-2 text-xs font-medium text-muted-foreground hover:border-indigo-500 hover:text-indigo-600 disabled:opacity-50 dark:hover:text-indigo-400"
        >
          <Plus className="h-3.5 w-3.5" />
          {label}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[320px] p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput placeholder="Buscar obra…" value={term} onValueChange={setTerm} />
          <CommandList>
            {loading && (
              <div className="flex items-center gap-2 p-3 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> buscando…
              </div>
            )}
            {!loading && term.trim().length < 2 && (
              <div className="flex items-center gap-2 p-3 text-xs text-muted-foreground">
                <Search className="h-3.5 w-3.5" /> digite ao menos 2 letras
              </div>
            )}
            {!loading && term.trim().length >= 2 && visible.length === 0 && (
              <CommandEmpty>Nenhuma obra encontrada.</CommandEmpty>
            )}
            {visible.length > 0 && (
              <CommandGroup>
                {visible.map((w) => (
                  <CommandItem
                    key={w.id}
                    value={w.id}
                    // ⚠️ `onSelect`, não `onClick`: o CommandItem do cmdk descarta onClick.
                    onSelect={() => {
                      onPick(w.id)
                      setOpen(false)
                      setTerm("")
                    }}
                    className="flex items-center gap-2"
                  >
                    <span className="truncate text-xs">{w.title}</span>
                    <span className="ml-auto shrink-0 font-mono text-[10px] text-muted-foreground">
                      {w.year ?? ""}
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <span className="mb-2 block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
      {children}
    </span>
  )
}
