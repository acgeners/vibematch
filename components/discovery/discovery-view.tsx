"use client"

import { useMemo, useState, useTransition, useEffect } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import Image from "next/image"
import { Radar, Plus, X, Search, Loader2, Star, Info, TriangleAlert, Check } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import { AdultBadge } from "@/components/ui/adult-badge"
import { CoverImage } from "@/components/ui/cover-image"
import { ExplainPanel } from "@/components/discovery/explain-panel"
import { getCoverImageSrc } from "@/lib/image-proxy"
import { titleToSlug } from "@/lib/utils"
import { searchWorkSuggestions } from "@/server/actions/work-search"
import {
  blendCandidates,
  classifyCohesion,
  snapWeight,
  diversify,
  countNearDuplicates,
  NEAR_DUPLICATE_WARN_AT,
  WEIGHT_STEPS,
} from "@/lib/discovery/blend"
import {
  MAX_SEEDS,
  MAX_ANTI_SEEDS,
  MIN_SEEDS,
  DEFAULT_RESULT_LIMIT,
  EXPLAIN_COUNT,
  PRIMARY_SEED_WEIGHT,
} from "@/lib/discovery/limits"
import { suggestSeedReplacementsAction } from "@/server/actions/discovery"
import type {
  DiscoveryResult,
  DiscoveryWork,
  DiscoverySeedInfo,
  SeedSuggestion,
} from "@/server/queries/seed-discovery"
import type { WorkSuggestion } from "@/server/queries/work-suggestions"
import type { BlendCandidate, CohesionLevel, WeakestSeed } from "@/lib/discovery/blend"

/**
 * Os três degraus, na ordem. `satisfies` faz o `tsc` reprovar se um nível novo aparecer em
 * `CohesionLevel` e ninguém decidir onde ele entra — lista solta envelheceria calada.
 */
const DEGRAUS = ["weak", "fair", "strong"] as const satisfies readonly CohesionLevel[]

const NIVEL_TEXTO: Record<CohesionLevel, string> = {
  unknown: "sem medida",
  weak: "sem eixo em comum",
  fair: "eixo fraco",
  strong: "eixo claro",
}

function fmtCoesao(v: number): string {
  return v.toFixed(2).replace(".", ",")
}

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

/**
 * As colunas da lista, por breakpoint. Mesma escada do resto do app: as barras aparecem em
 * `sm`, as colunas informativas em `lg`. A contagem de colunas tem que casar com a de células
 * VISÍVEIS em cada faixa — ver o 🔴 do grid.
 *
 * ⚠️ As larguras foram medidas contra o CABEÇALHO, não contra os números. "veredito" (em
 * coluna de 58px) e "combinação" (74px) transbordavam e colavam um no outro na tela — os
 * VALORES caberiam. Rótulo em versalete com `tracking` é mais largo do que parece.
 */
const GRID_COLS =
  "grid-cols-[22px_40px_minmax(0,auto)_84px] " +
  "sm:grid-cols-[22px_44px_minmax(0,auto)_104px_104px_84px] " +
  "lg:grid-cols-[22px_44px_minmax(0,auto)_104px_104px_64px_64px_84px]"

/** O cliente sempre recebe percentis prontos do servidor — nunca similaridade crua. */
const PCT = { percentileInputs: true } as const

export type DiscoveryViewMode = "lista" | "cards"

interface Props {
  result: DiscoveryResult
  onlyUnread: boolean
  view: DiscoveryViewMode
}

export function DiscoveryView({ result, onlyUnread, view }: Props) {
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
    /** `null` tira a estrela; omitido mantém a atual. */
    principal?: string | null
    view?: DiscoveryViewMode
  }) {
    const params = new URLSearchParams()
    const s = next.seeds ?? seedIds
    const a = next.anti ?? antiIds
    if (s.length) params.set("seeds", s.join(","))
    if (a.length) params.set("anti", a.join(","))
    params.set("w", String(Math.round((next.w ?? weight) * 100)))
    if (next.lidas ?? !onlyUnread) params.set("lidas", "1")

    // ⚠️ A estrela SEGUE a semente: tirar a obra que era principal limpa o parâmetro em vez
    // de deixar um id órfão na URL. O servidor já degrada nesse caso, mas a URL é o que a
    // pessoa copia e salva — e um `principal=` apontando pra fora da busca é lixo que
    // sobrevive ao link.
    const p = next.principal === undefined ? result.primaryId : next.principal
    if (p && s.includes(p)) params.set("principal", p)

    const v = next.view ?? view
    if (v === "cards") params.set("view", "cards")

    startTransition(() => router.push(`/discover?${params}`, { scroll: false }))
  }

  // Reordenação local: os dois eixos já vêm resolvidos por obra.
  const ordered = useMemo(() => {
    const candidates: BlendCandidate[] = result.works.map((w) => ({
      workId: w.id,
      // `simPos` já É o percentil medido pelo servidor sobre TODAS as candidatas — por isso
      // o blend abaixo recebe `percentileInputs`. Sem essa flag ele repercentilava sobre o
      // pool exibível e a combinação deixava de bater com a barra ao lado (ver blend.ts).
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
    const ordenados = blendCandidates(candidates, weight, PCT)
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

    // 🔴 As marcas "só deste lado" saem das MESMAS pontas que `extremesDivergence` mede no
    // servidor, e agora os dois concordam em QUALQUER peso — não só nos extremos. Antes o
    // cliente repercentilava a similaridade sobre o pool e só as pontas coincidiam por
    // acidente aritmético (w=1 vira a ordem de `simPos`, w=0 a de `fitPercentile`).
    //
    // ⚠️ A mesma marca para a semente PRINCIPAL ficou de fora de propósito: ela exigiria o
    // top sem-principal, que sai de um pool que este componente não tem (`unionOfTops` é
    // construído sobre a similaridade JÁ ponderada). Uma marca aproximada ao lado de um número
    // exato é a receita para os dois se contradizerem na tela.
    const extremos = { sim: new Set<string>(), fit: new Set<string>() }
    if (result.fitAvailable) {
      const N = Math.min(DEFAULT_RESULT_LIMIT, 10)
      for (const b of blendCandidates(candidates, 1, PCT).slice(0, N)) extremos.sim.add(b.workId)
      for (const b of blendCandidates(candidates, 0, PCT).slice(0, N)) extremos.fit.add(b.workId)
    }

    return {
      rows: rows.map((r) => ({
        ...r,
        showSeed: r.work.nearestSeedId != null && r.work.nearestSeedId !== dominante,
        side:
          extremos.sim.has(r.work.id) && !extremos.fit.has(r.work.id)
            ? ("sim" as const)
            : extremos.fit.has(r.work.id) && !extremos.sim.has(r.work.id)
              ? ("fit" as const)
              : null,
      })),
      duplicadas,
    }
  }, [result.works, result.simMatrix, result.fitAvailable, weight])

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
          Aponte de {MIN_SEEDS} a {MAX_SEEDS} obras. O catálogo é varrido por similaridade com{" "}
          <em>elas</em> e por alinhamento com <em>você</em> — dois eixos independentes, então
          cada ponta do controle devolve uma lista diferente.
        </p>
      </header>

      <SeedsCard
        result={result}
        disabled={pending}
        onChange={(seeds, anti) => navigate({ seeds, anti })}
        onPrimary={(id) => navigate({ principal: id })}
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
                <ViewToggle view={view} disabled={pending} onChange={(v) => navigate({ view: v })} />
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
                  {view === "cards" ? (
                    <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
                      {ordered.rows.map(({ work, score, showSeed, side }, i) => (
                        <ResultCard
                          key={work.id}
                          rank={i + 1}
                          work={work}
                          score={score}
                          showSeed={showSeed}
                          side={side}
                        />
                      ))}
                    </div>
                  ) : (
                    /* 🔴 UM grid para a lista INTEIRA (as linhas usam `contents`), e não um
                       por linha. Com um grid por linha a coluna de conteúdo é `1fr` e estica
                       até a borda, empurrando os números para longe do texto — medido: 270px
                       de vão. Aqui a coluna é `auto`, mede a linha mais larga, as colunas
                       ALINHAM entre si (é o que dá sentido ao cabeçalho) e a régua encosta no
                       texto (14px, o próprio gap).

                       ⚠️ Toda linha emite o MESMO número de células que o template tem de
                       colunas, em cada breakpoint. Com `contents`, uma célula a menos não
                       deixa buraco: desloca todas as seguintes e a lista escorrega uma casa
                       por linha. */
                    <div
                      className={`grid items-center justify-center gap-x-3.5 ${GRID_COLS}`}
                    >
                      <ResultHeader />
                      {ordered.rows.map(({ work, score, showSeed, side }, i) => (
                        <ResultRow
                          key={work.id}
                          rank={i + 1}
                          work={work}
                          score={score}
                          showSeed={showSeed}
                          side={side}
                        />
                      ))}
                    </div>
                  )}

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
  result,
  disabled,
  onChange,
  onPrimary,
}: {
  result: DiscoveryResult
  disabled: boolean
  onChange: (seeds: string[], anti: string[]) => void
  onPrimary: (id: string | null) => void
}) {
  const { seeds, antiSeeds, seedsIgnored, primaryId } = result
  const seedIds = seeds.map((s) => s.id)
  const antiIds = antiSeeds.map((s) => s.id)

  // 🔴 DERIVADO de haver anti-semente, nunca um estado próprio que possa discordar dela.
  // Quem chega por um link com `anti=` precisa VER o filtro que está agindo; um recolhido
  // guardado à parte esconderia um corte que a pessoa não pediu e não consegue achar.
  const [antiAberto, setAntiAberto] = useState(false)
  const mostraAnti = antiAberto || antiSeeds.length > 0

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-baseline justify-between gap-3">
        <CardTitle className="text-base">Suas sementes</CardTitle>
        <div className="flex items-center gap-3">
          <span className="text-xs text-muted-foreground">
            {seeds.length} de {MAX_SEEDS} · mínimo {MIN_SEEDS}
          </span>
          {seeds.length + antiSeeds.length > 0 && (
            // Sem confirmação: o estado mora na URL, então o voltar do browser desfaz.
            <Button
              variant="ghost"
              size="sm"
              className="h-auto px-2 py-1 text-xs text-muted-foreground"
              disabled={disabled}
              onClick={() => onChange([], [])}
            >
              Limpar
            </Button>
          )}
        </div>
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
                isPrimary={primaryId === s.id}
                // A estrela só faz sentido havendo com quem comparar.
                onTogglePrimary={
                  seeds.length >= MIN_SEEDS
                    ? () => onPrimary(primaryId === s.id ? null : s.id)
                    : undefined
                }
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
          {!mostraAnti ? (
            <button
              type="button"
              onClick={() => setAntiAberto(true)}
              className="text-xs text-muted-foreground underline decoration-border underline-offset-4 hover:text-foreground"
            >
              Evitar alguma obra?
            </button>
          ) : (
            <>
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
            </>
          )}
        </div>

        {seeds.length >= MIN_SEEDS && (
          <AxisMeter result={result} disabled={disabled} onChange={onChange} />
        )}

        {seedsIgnored > 0 && (
          <p className="rounded-md bg-amber-500/10 px-3 py-2 text-xs text-amber-700 ring-1 ring-amber-500/40 dark:text-amber-300">
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
 * "Dá pra confiar nesta busca?", respondido ANTES da lista.
 *
 * 🔴 O VEREDITO vem primeiro e o número vai pro rodapé, atrás de um ℹ️. A versão anterior
 * abria com `0,093` em corpo grande e uma escala em fonte mono (`0,00 acaso · 0,15 fraca ·
 * 0,50`), que pede da pessoa calibrar uma unidade que não existe fora desta tela — enquanto
 * a frase que ela precisa ler ficava em terceiro lugar. Mesma régua do selo ✨: o dado
 * técnico mora no tooltip.
 *
 * 🔴 E o caso BOM ficou quieto. Antes ele desenhava o medidor inteiro mais dois parágrafos
 * explicando que a média do catálogo é subtraída — aula para quem não tem problema nenhum a
 * resolver. Hoje é uma linha; a explicação inteira migrou pro ℹ️.
 *
 * ⚠️ Sem chip de palavra em âmbar: `lib/ui/status-tone.ts` reserva esse formato para
 * "desatualizado". Aqui o aviso é prosa + medidor, e o contorno é `ring-*` porque
 * `border-<cor>` não pinta neste projeto.
 */
function AxisMeter({
  result,
  disabled,
  onChange,
}: {
  result: DiscoveryResult
  disabled: boolean
  onChange: (seeds: string[], anti: string[]) => void
}) {
  const { cohesion, anchoredCohesion, cohesionLevel, weakest, seeds, primaryId } = result
  // A leitura que descreve a busca corrente — a mesma que o servidor usou pra faixa.
  const efetiva = primaryId ? anchoredCohesion : cohesion
  if (efetiva == null) return null

  const weak = cohesionLevel === "weak"
  const ancora = primaryId ? seeds.find((s) => s.id === primaryId) : null

  return (
    <div
      className={`flex flex-col gap-3 rounded-lg p-3 ${
        weak ? "bg-amber-500/10 ring-1 ring-amber-500/35" : "bg-muted/50"
      }`}
    >
      <div className="flex items-start gap-2">
        {weak ? (
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
        ) : (
          <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
        )}
        <div className="min-w-0">
          {weak ? (
            <>
              <p className="text-sm font-semibold text-amber-700 dark:text-amber-300">
                {ancora
                  ? `As outras obras não reforçam "${ancora.title}"`
                  : seeds.length === 2
                    ? "Estas duas obras não apontam para o mesmo lugar"
                    : `Estas ${seeds.length} obras não apontam para o mesmo lugar`}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Sem um eixo em comum, “mais como estas” não tem para onde apontar — a lista
                tende a devolver o genérico do catálogo.
              </p>
            </>
          ) : (
            <p className="text-sm font-medium">
              {cohesionLevel === "strong"
                ? ancora
                  ? `As outras obras reforçam "${ancora.title}".`
                  : "Estas obras dividem um eixo claro."
                : "Estas obras dividem um eixo, ainda que fraco."}
            </p>
          )}
        </div>
      </div>

      {weak && (
        <WeakestSeedActions
          weakest={weakest}
          seeds={seeds}
          antiIds={result.antiSeeds.map((a) => a.id)}
          disabled={disabled}
          onChange={onChange}
        />
      )}

      {primaryId && (
        <PrimaryReadings
          cohesion={cohesion}
          anchoredCohesion={anchoredCohesion}
          effect={result.primaryEffect}
          weight={result.weight}
        />
      )}

      <Steps level={cohesionLevel} />

      <div className="flex flex-wrap items-center gap-1.5 text-[11px] tabular-nums text-muted-foreground">
        <span>
          {primaryId ? "eixo ancorado" : "coesão"} {fmtCoesao(efetiva)} · o acaso é 0,00
        </span>
        <InfoTip label="Como a coesão é medida">
          <p className="font-semibold">De onde sai este número</p>
          <p className="mt-1">
            Similaridade média entre os pares das suas sementes, depois de subtrair a média do
            catálogo de cada obra. Por isso <strong>0,00 é o acaso</strong> — não é uma nota de
            0 a 1, e valores negativos existem.
          </p>
          <p className="mt-2 text-background/65">
            Medido: sementes com eixo comum dão ~0,33 e uma lista com similaridade 0,266;
            sementes aleatórias dão ~0,00 e 0,169 — 36% mais fraca.
          </p>
        </InfoTip>
      </div>
    </div>
  )
}

/** Os três degraus, nomeados. A informação sempre foi ordinal; a barra 0–0,50 sugeria uma
 *  precisão que ela não tem, e pedia uma escala de referência que ninguém carrega na cabeça. */
function Steps({ level }: { level: CohesionLevel }) {
  return (
    <div className="flex gap-1">
      {DEGRAUS.map((d) => {
        const on = d === level
        const tom =
          d === "strong"
            ? "bg-emerald-500 text-emerald-700 dark:text-emerald-400"
            : "bg-amber-500 text-amber-700 dark:text-amber-400"
        return (
          <div key={d} className="flex min-w-0 flex-1 flex-col gap-1">
            <span className={`h-1 rounded-full ${on ? tom : "bg-border"}`} />
            <span
              className={`truncate text-[10px] ${
                on ? `font-semibold ${tom.split(" ").slice(1).join(" ")}` : "text-muted-foreground"
              }`}
            >
              {NIVEL_TEXTO[d]}
            </span>
          </div>
        )
      })}
    </div>
  )
}

/**
 * O conselho vira AÇÃO: nomeia a semente que está puxando pra fora e oferece o que fazer.
 *
 * 🔴 Só nomeia a culpada quando tirá-la MUDA A FAIXA. Um ganho que não muda o veredito não
 * dá conselho seguível ("tire esta" e continua sem eixo), e o critério de faixa não precisa
 * de um limiar inventado — este projeto já pagou caro por limiar escolhido a olho.
 */
function WeakestSeedActions({
  weakest,
  seeds,
  antiIds,
  disabled,
  onChange,
}: {
  weakest: WeakestSeed | null
  seeds: DiscoverySeedInfo[]
  antiIds: string[]
  disabled: boolean
  onChange: (seeds: string[], anti: string[]) => void
}) {
  const [sug, setSug] = useState<{ aberto: boolean; carregando: boolean; itens: SeedSuggestion[] }>(
    { aberto: false, carregando: false, itens: [] },
  )

  const vale =
    weakest != null && classifyCohesion(weakest.after) !== classifyCohesion(weakest.before)
  const culpada = vale && weakest ? seeds.find((s) => s.id === weakest.id) : null
  const ficam = seeds.filter((s) => s.id !== culpada?.id).map((s) => s.id)

  function abrirSugestoes() {
    if (sug.aberto) {
      setSug((s) => ({ ...s, aberto: false }))
      return
    }
    setSug({ aberto: true, carregando: true, itens: [] })
    suggestSeedReplacementsAction(ficam, [...seeds.map((s) => s.id), ...antiIds])
      .then((itens) => setSug({ aberto: true, carregando: false, itens }))
      .catch(() => setSug({ aberto: true, carregando: false, itens: [] }))
  }

  return (
    <div className="flex flex-col gap-2">
      {culpada && weakest ? (
        <p className="text-xs text-muted-foreground">
          Quem está puxando para fora:{" "}
          <strong className="font-semibold text-foreground">{culpada.title}</strong>{" "}
          <span className="tabular-nums text-emerald-600 dark:text-emerald-400">
            sem ela: {fmtCoesao(weakest.before)} → {fmtCoesao(weakest.after)}
          </span>
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">
          {seeds.length < 3
            ? "Com duas sementes não dá para dizer qual destoa — tirar uma deixa a busca abaixo do mínimo. O caminho é trocar uma das duas."
            : "Nenhuma semente sozinha explica a dispersão: tirar qualquer uma delas deixa o eixo na mesma faixa."}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {culpada && (
          <Button
            size="sm"
            disabled={disabled}
            onClick={() => onChange(ficam, antiIds)}
          >
            Tirar “{culpada.title}”
          </Button>
        )}
        <Button size="sm" variant="outline" onClick={abrirSugestoes}>
          {culpada ? "Trocar por outra" : "Ver obras que combinam"} {sug.aberto ? "▴" : "▾"}
        </Button>
      </div>

      {sug.aberto && (
        <div className="flex flex-col gap-2">
          {sug.carregando ? (
            <span className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> procurando…
            </span>
          ) : sug.itens.length === 0 ? (
            <span className="text-xs text-muted-foreground">
              Nenhuma obra do catálogo combina claramente com as que ficam.
            </span>
          ) : (
            <>
              <div className="flex flex-wrap gap-2">
                {sug.itens.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    disabled={disabled}
                    onClick={() => onChange([...ficam, s.id], antiIds)}
                    className="flex items-center gap-2 rounded-lg border px-2 py-1.5 text-xs hover:bg-muted disabled:opacity-50"
                  >
                    <span className="max-w-[180px] truncate">{s.title}</span>
                    {/* O número é a coesão RESULTANTE, não um ganho abstrato: assim dá para
                        ver quais trocas de fato resolvem e quais só melhoram um pouco. */}
                    <span
                      className={`tabular-nums ${
                        s.cohesionLevelIfPicked === "strong"
                          ? "text-emerald-600 dark:text-emerald-400"
                          : "text-amber-600 dark:text-amber-400"
                      }`}
                    >
                      → {fmtCoesao(s.cohesionIfPicked)}
                    </span>
                  </button>
                ))}
              </div>
              <span className="text-[11px] text-muted-foreground">
                O número é a coesão que a busca teria com essa obra no lugar.
              </span>
            </>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * As duas leituras de coesão, lado a lado, quando há semente principal.
 *
 * 🔴 Elas podem discordar sobre as MESMAS sementes, e é por isso que as duas aparecem. A
 * geral pesa todos os pares igual; a ancorada só os que tocam a principal — e o par entre
 * duas coadjuvantes deixa de decidir, porque nenhuma das duas está dirigindo a busca.
 * Mostrar só a ancorada esconderia que a dispersão existe; só a geral condenaria uma busca
 * bem dirigida. É o mesmo fato visto de dois ângulos, e os dois interessam.
 */
function PrimaryReadings({
  cohesion,
  anchoredCohesion,
  effect,
  weight,
}: {
  cohesion: number | null
  anchoredCohesion: number | null
  effect: DiscoveryResult["primaryEffect"]
  weight: number
}) {
  if (cohesion == null || anchoredCohesion == null) return null

  const nivelGeral = classifyCohesion(cohesion)
  const nivelAnc = classifyCohesion(anchoredCohesion)
  const discordam = nivelGeral !== nivelAnc

  const passo = WEIGHT_STEPS.indexOf(weight as (typeof WEIGHT_STEPS)[number])
  const ef = passo >= 0 ? effect[passo] : undefined

  return (
    <div className="flex flex-col gap-2 rounded-md bg-background/40 p-2.5 ring-1 ring-border">
      <div className="flex flex-wrap gap-2 text-[11px]">
        <span className="tabular-nums text-muted-foreground">
          todos os pares <strong className="text-foreground">{fmtCoesao(cohesion)}</strong> (
          {NIVEL_TEXTO[nivelGeral]})
        </span>
        <span className="text-muted-foreground">·</span>
        <span className="tabular-nums text-muted-foreground">
          ancorado <strong className="text-foreground">{fmtCoesao(anchoredCohesion)}</strong> (
          {NIVEL_TEXTO[nivelAnc]})
        </span>
      </div>

      {discordam && (
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          As duas leituras discordam: a geral mede também o par entre as coadjuvantes, que
          deixou de decidir quando você ancorou a busca. O veredito acima segue o{" "}
          <strong className="text-foreground">ancorado</strong>.
        </p>
      )}

      {ef && (
        <p className="text-[11px] tabular-nums text-muted-foreground">
          Peso {PRIMARY_SEED_WEIGHT}× no topo 10, neste peso do controle:{" "}
          <strong className="text-foreground">{ef.enters}</strong>{" "}
          {ef.enters === 1 ? "obra entra ou sai" : "obras entram ou saem"} ·{" "}
          <strong className="text-foreground">{ef.moves}</strong>{" "}
          {ef.moves === 1 ? "muda" : "mudam"} de posição.
        </p>
      )}
    </div>
  )
}

/** ℹ️ com o mesmo desenho invertido do resto do app. Provider próprio: Tooltip sem Provider
 *  derruba a página inteira, e cada componente daqui traz o seu. */
function InfoTip({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label={label}
            className="inline-flex h-4 w-4 items-center justify-center rounded-full text-muted-foreground hover:text-foreground"
          >
            <Info className="h-3.5 w-3.5" />
          </button>
        </TooltipTrigger>
        {/* Tom secundário é `text-background/<alfa>`: o content é invertido, e um token de
            página (`muted-foreground`) cai pra ~3:1 no tema claro. */}
        <TooltipContent className="max-w-[300px] text-xs leading-relaxed">
          {children}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
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
        <CardTitle className="flex items-center gap-1.5 text-base">
          O que deve pesar mais
          <InfoTip label="O que cada ponta significa">
            <p>
              <strong>Similaridade</strong> — obras cujo perfil de texto se
              aproxima das que você escolheu.
            </p>
            <p className="mt-2">
              <strong>A minha cara</strong> — obras que o seu perfil de gosto ranqueia alto,
              mesmo sendo de outro tipo.
            </p>
            <p className="mt-2 text-background/65">
              Os dois eixos são independentes (correlação ≈ 0, medido), por isso cada ponta
              devolve uma lista diferente.
            </p>
          </InfoTip>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex justify-between text-xs font-semibold">
          <span className="text-indigo-600 dark:text-indigo-400">◄ Similaridade</span>
          <span className="text-emerald-600 dark:text-emerald-400">A minha cara ►</span>
        </div>
        <input
          type="range"
          min={0}
          max={100}
          step={10}
          value={Math.round(weight * 100)}
          aria-label="Peso entre similaridade com as sementes e alinhamento com o seu perfil"
          // Trilho em degradê para a posição ser lida como MISTURA dos dois eixos, e não
          // como uma porcentagem de algo. As duas cores são as mesmas das pontas.
          className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-gradient-to-r from-indigo-500 via-slate-500 to-emerald-500 accent-indigo-600 dark:accent-indigo-400"
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

        {/* 🔴 A posição ATUAL passa a ter nome. O controle nomeava as duas pontas e não dizia
            onde a pessoa está — sobrava fazer aritmética mental sobre um número que nem
            aparecia. E a divergência, que era a informação mais útil da tela, estava escrita
            como estatística alinhada à direita, longe do slider que ela descreve. */}
        <div>
          <p className="text-sm">{fraseDoPeso(weight)}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {divergence > 0 ? (
              <>
                Este controle importa aqui:{" "}
                <strong className="font-semibold text-foreground">{divergence} das 10</strong>{" "}
                primeiras trocam entre uma ponta e a outra.
              </>
            ) : (
              "Tanto faz nesta busca: os dois lados devolvem quase a mesma lista."
            )}
          </p>
        </div>

        {!fitAvailable && (
          <p className="rounded-md border border-sky-500/40 bg-sky-500/10 px-3 py-2 text-xs text-sky-700 dark:text-sky-300">
            Você ainda não tem <strong>perfil de gosto</strong>, então só a similaridade pesa aqui
            — mover o controle não muda a lista. O perfil nasce depois de você avaliar algumas
            obras.
          </p>
        )}
      </CardContent>
    </Card>
  )
}

/**
 * O que a posição do controle significa, em palavras.
 *
 * ⚠️ Os cortes acompanham as paradas do slider (`WEIGHT_STEPS`, de 10 em 10), então nenhuma
 * parada cai numa fronteira ambígua.
 */
function fraseDoPeso(w: number): React.ReactNode {
  if (w <= 0.001)
    return (
      <>
        <strong className="font-semibold">Só o seu gosto.</strong> As sementes definem o que
        entra; a ordem é a do seu perfil.
      </>
    )
  if (w < 0.35)
    return (
      <>
        <strong className="font-semibold">Sobretudo o seu gosto</strong>, com um toque de
        similaridade.
      </>
    )
  if (w < 0.65)
    return <strong className="font-semibold">Metade similaridade, metade o seu gosto.</strong>
  if (w < 0.999)
    return (
      <>
        <strong className="font-semibold">Sobretudo similaridade</strong> com as sementes.
      </>
    )
  return (
    <>
      <strong className="font-semibold">Só similaridade.</strong> O seu perfil não entra na ordem.
    </>
  )
}

/** Alterna lista × cards. A escolha vive na URL — ver o comentário em `page.tsx`. */
function ViewToggle({
  view,
  disabled,
  onChange,
}: {
  view: DiscoveryViewMode
  disabled: boolean
  onChange: (v: DiscoveryViewMode) => void
}) {
  return (
    <div className="flex items-center gap-1">
      {(["lista", "cards"] as const).map((v) => (
        <Button
          key={v}
          variant={view === v ? "default" : "outline"}
          size="sm"
          disabled={disabled}
          aria-pressed={view === v}
          onClick={() => onChange(v)}
        >
          {v === "lista" ? "Lista" : "Cards"}
        </Button>
      ))}
    </div>
  )
}

/**
 * O cabeçalho nomeia os QUATRO sistemas de número da linha, uma vez só.
 *
 * 🔴 Sem ele a linha repetia `sim` e `vc` em cada obra — abreviações que não existem em
 * lugar nenhum da página — e deixava `Prev.`, `Ver.` e a combinação sem nome. E os quatro
 * têm escalas diferentes: dois são percentil 0–100, um é nota 0–10, outro é 0–100. As
 * palavras são as MESMAS do controle acima; duas palavras para o mesmo eixo é o defeito
 * que este cabeçalho existe para não ter.
 */
function ResultHeader() {
  return (
    <div className="contents">
      <span />
      <span />
      <span className="border-b pb-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        obra
      </span>
      <span className="hidden border-b pb-1.5 text-right text-[10px] font-semibold uppercase tracking-wide text-indigo-600 sm:block dark:text-indigo-400">
        similaridade
      </span>
      <span className="hidden border-b pb-1.5 text-right text-[10px] font-semibold uppercase tracking-wide text-emerald-600 sm:block dark:text-emerald-400">
        a minha cara
      </span>
      <span className="hidden border-b pb-1.5 text-right text-[10px] font-semibold uppercase tracking-wide text-muted-foreground lg:block">
        prevista
      </span>
      <span className="hidden border-b pb-1.5 text-right text-[10px] font-semibold uppercase tracking-wide text-violet-600 lg:block dark:text-violet-400">
        veredito
      </span>
      <span className="flex items-center justify-end gap-1 border-b pb-1.5 text-[10px] font-semibold uppercase tracking-wide">
        combinação
        <InfoTip label="Como a combinação é calculada">
          <p>
            <strong>peso × similaridade + (1−peso) × a minha cara</strong>, com os dois em
            percentil <strong>dentro desta busca</strong>.
          </p>
          <p className="mt-2 text-background/65">
            Não é “% de compatibilidade”: o 1º colocado dá ~100 por construção. Mova o controle
            e ela muda — é resultado do peso, não propriedade da obra.
          </p>
          <p className="mt-2 text-background/65">
            A coluna não desce sempre: a lista também espaça obras quase idênticas entre si,
            então uma combinação maior pode aparecer abaixo de uma menor.
          </p>
        </InfoTip>
      </span>
    </div>
  )
}

/** As células de UMA obra. `contents` para que elas entrem no grid da lista inteira. */
function ResultRow({
  rank,
  work,
  score,
  showSeed,
  side,
}: {
  rank: number
  work: DiscoveryWork
  score: number
  showSeed: boolean
  /** "sim"/"fit" quando a obra só existe no topo de UMA das pontas do controle. */
  side: "sim" | "fit" | null
}) {
  const cel = "py-2 group-hover:bg-muted/50"
  return (
    <div className="group contents">
      <span
        className={`${cel} text-right font-mono text-xs tabular-nums text-muted-foreground`}
      >
        {rank}
      </span>
      <span className={cel}>
        <Cover work={work} className="h-14 w-10 sm:h-[62px] sm:w-11" />
      </span>

      <span className={`${cel} block min-w-0`}>
        <Link
          href={`/catalog/${titleToSlug(work.title)}`}
          className="block truncate text-sm font-medium hover:underline"
        >
          {work.title}
        </Link>
        <WorkMeta work={work} showSeed={showSeed} side={side} />
      </span>

      <span className={`${cel} hidden sm:block`}>
        <Bar value={work.simPercentile} tone="sim" />
      </span>
      <span className={`${cel} hidden sm:block`}>
        <Bar value={work.fitPercentile} tone="fit" />
      </span>

      {/* Colunas informativas — NUNCA entram no score (ver lib/discovery/blend.ts). */}
      <span
        className={`${cel} hidden text-right font-mono text-xs tabular-nums text-muted-foreground lg:block`}
      >
        {work.expectedScore == null ? "—" : work.expectedScore.toFixed(1).replace(".", ",")}
      </span>
      <span
        className={`${cel} hidden text-right font-mono text-xs tabular-nums lg:block ${
          work.alignmentScore == null ? "text-muted-foreground opacity-50" : "text-violet-600 dark:text-violet-400"
        }`}
      >
        {work.alignmentScore == null ? "—" : Math.round(work.alignmentScore)}
      </span>

      <span className={`${cel} text-right font-mono text-lg font-semibold tabular-nums`}>
        {Math.round(score)}
      </span>
    </div>
  )
}

/** A mesma obra em card — a largura da tela vira mais ITENS por linha, não linhas maiores. */
function ResultCard({
  rank,
  work,
  score,
  showSeed,
  side,
}: {
  rank: number
  work: DiscoveryWork
  score: number
  showSeed: boolean
  side: "sim" | "fit" | null
}) {
  return (
    <div className="flex gap-3 rounded-lg border bg-muted/30 p-2.5 hover:bg-muted/60">
      <Cover work={work} className="h-[78px] w-14" />
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-baseline justify-between gap-2">
          <Link
            href={`/catalog/${titleToSlug(work.title)}`}
            className="line-clamp-2 text-[13px] font-medium leading-tight hover:underline"
          >
            {work.title}
          </Link>
          <span className="shrink-0 text-right">
            <span className="block font-mono text-lg font-semibold leading-none tabular-nums">
              {Math.round(score)}
            </span>
            <span className="block font-mono text-[9px] text-muted-foreground">#{rank}</span>
          </span>
        </div>
        <WorkMeta work={work} showSeed={showSeed} side={side} />
        <div className="mt-1.5 flex flex-col gap-1">
          <Bar value={work.simPercentile} tone="sim" />
          <Bar value={work.fitPercentile} tone="fit" />
        </div>
        <div className="mt-1 flex gap-3 font-mono text-[10px] tabular-nums text-muted-foreground">
          <span>
            prevista {work.expectedScore == null ? "—" : work.expectedScore.toFixed(1).replace(".", ",")}
          </span>
          <span className={work.alignmentScore == null ? "opacity-50" : "text-violet-600 dark:text-violet-400"}>
            veredito {work.alignmentScore == null ? "—" : Math.round(work.alignmentScore)}
          </span>
        </div>
      </div>
    </div>
  )
}

/**
 * ⚠️ URL quebrada cai no MESMO placeholder de "obra sem capa", em vez do ícone de imagem
 * partida do browser. Enquanto a lista nunca mostrava capa isto não existia; ao consertá-la,
 * as URLs mortas do catálogo (host extinto, CDN que sumiu) ficaram visíveis — e um glifo de
 * erro no meio da lista é pior do que o quadrado neutro que estava ali antes.
 *
 * ⚠️ `useState` e não `onError` direto no `<img>`: sem estado o browser retenta a cada
 * render e o ícone pisca.
 */
function Cover({ work, className }: { work: DiscoveryWork; className: string }) {
  const [quebrou, setQuebrou] = useState(false)
  if (!work.coverUrl || quebrou) {
    return <span className={`block shrink-0 rounded border bg-muted ${className}`} />
  }
  return (
    <Image
      // ⚠️ `getCoverImageSrc` e não a URL crua: 201 das 980 obras têm a primária em
      // `cdn.anime-planet.com`, que recusa hotlink (403 ao browser, 200 ao servidor).
      // Sem isso, 1 em cada 5 linhas caía no placeholder abaixo tendo capa perfeitamente
      // viva — e como o placeholder é neutro, nada denunciava.
      //
      // Aqui é `getCoverImageSrc` avulso, e não o `<CoverImage>`: o placeholder desta lista
      // é escolha registrada (quadrado neutro, sem o traço "—"), e o CoverImage traria o
      // dele junto. O que faltava era o proxy, não o tratamento de erro.
      src={getCoverImageSrc(work.coverUrl)}
      alt=""
      width={44}
      height={62}
      className={`shrink-0 rounded object-cover ${className}`}
      onError={() => setQuebrou(true)}
      unoptimized
    />
  )
}

function WorkMeta({
  work,
  showSeed,
  side,
}: {
  work: DiscoveryWork
  showSeed: boolean
  side: "sim" | "fit" | null
}) {
  return (
    <span className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[11px] text-muted-foreground">
      {work.isAdult && <AdultBadge />}
      <span className="tabular-nums">{work.year ?? "—"}</span>
      <span>·</span>
      <span className="tabular-nums">{work.totalChapters ?? "?"} cap.</span>
      {showSeed && work.nearestSeedTitle && (
        <>
          <span>·</span>
          {/* ⚠️ `max-w` obrigatório: num grid a coluna mede a linha MAIS LARGA, então um nome
              comprido de semente estica a coluna de TODAS e devolve o vão nas curtas. */}
          <span className="max-w-[190px] truncate">puxada por {work.nearestSeedTitle}</span>
        </>
      )}
      {/* 🔴 O chip diz o que ACONTECE, não onde a obra está. A 1ª versão dizia "só deste
          lado" e exigia saber de antemão que o controle tem duas pontas e que a lista muda
          entre elas — quem desenhou a página não entendeu, o que é veredito suficiente.
          Cores dos EIXOS (índigo/esmeralda), nunca um tom de estado. */}
      {side === "sim" && (
        <span
          title="Esta obra está no topo com o controle deste lado. Levando-o para a outra ponta, ela sai da lista."
          className="rounded-full bg-indigo-500/15 px-1.5 py-px text-[10px] font-semibold text-indigo-700 dark:text-indigo-300"
        >
          sai em “A minha cara”
        </span>
      )}
      {side === "fit" && (
        <span
          title="Esta obra está no topo com o controle deste lado. Levando-o para a outra ponta, ela sai da lista."
          className="rounded-full bg-emerald-500/15 px-1.5 py-px text-[10px] font-semibold text-emerald-700 dark:text-emerald-300"
        >
          sai em “Similaridade”
        </span>
      )}
    </span>
  )
}

function Bar({ value, tone }: { value: number | null; tone: "sim" | "fit" }) {
  const pct = value == null ? 0 : Math.max(0, Math.min(100, value))
  return (
    <span className="flex items-center gap-1.5 font-mono text-[10px] tabular-nums">
      {/* `block` é obrigatório: span inline ignora height e a barra sai vazia. */}
      <span className="block h-1 flex-1 overflow-hidden rounded-full bg-border">
        <span
          className={`block h-full rounded-full ${tone === "sim" ? "bg-indigo-500" : "bg-emerald-500"}`}
          style={{ width: `${pct}%` }}
        />
      </span>
      <span
        className={`w-6 text-right ${
          tone === "sim"
            ? "text-indigo-600 dark:text-indigo-400"
            : "text-emerald-600 dark:text-emerald-400"
        }`}
      >
        {value == null ? "—" : Math.round(value)}
      </span>
    </span>
  )
}


function SeedChip({
  seed,
  tone,
  disabled,
  isPrimary,
  onTogglePrimary,
  onRemove,
}: {
  seed: DiscoverySeedInfo
  tone: "positive" | "negative"
  disabled: boolean
  isPrimary?: boolean
  /** Ausente = a estrela não se aplica (anti-semente, ou sementes de menos). */
  onTogglePrimary?: () => void
  onRemove: () => void
}) {
  return (
    <div
      className={`flex max-w-[260px] items-center gap-2 rounded-lg p-1.5 pr-2 ring-1 ${
        tone === "positive"
          ? "bg-indigo-500/10 ring-indigo-500/40"
          : "bg-amber-500/10 ring-amber-500/40"
      } ${isPrimary ? "ring-2 ring-foreground/45" : ""}`}
    >
      {seed.coverUrl ? (
        // `CoverImage` aqui, e não `getCoverImageSrc` avulso como no `Cover` acima: este
        // chip não tratava erro NENHUM, então a capa que não carregasse desenhava o ícone
        // de imagem partida do browser. Não há placeholder próprio a preservar — o dono já
        // traz proxy e queda para o traço.
        <CoverImage
          url={seed.coverUrl}
          className="h-10 w-7 shrink-0 rounded object-cover"
        />
      ) : (
        <div className="h-10 w-7 shrink-0 rounded bg-muted" />
      )}
      <div className="flex min-w-0 flex-col">
        <span className="line-clamp-2 text-xs font-medium leading-tight">{seed.title}</span>
        <span className="text-[10px] text-muted-foreground tabular-nums">
          {seed.year ?? "—"}
          {isPrimary && " · principal"}
          {!seed.hasEmbedding && " · sem vetor"}
        </span>
      </div>
      {onTogglePrimary && (
        // ⚠️ O nível é FORMA (★ cheia × ☆ vazia), não uma cor nova — mesma régua do
        // `TagStanceMark`, e pelo mesmo motivo: quem enxerga cor com dificuldade não pode
        // depender dela para saber qual semente está dirigindo a busca.
        <button
          type="button"
          disabled={disabled}
          onClick={onTogglePrimary}
          aria-pressed={Boolean(isPrimary)}
          title={
            isPrimary
              ? "Deixar de ser a semente principal"
              : `Tornar principal (peso ${PRIMARY_SEED_WEIGHT}×)`
          }
          aria-label={
            isPrimary
              ? `${seed.title} deixa de ser a semente principal`
              : `Tornar ${seed.title} a semente principal, com peso ${PRIMARY_SEED_WEIGHT}×`
          }
          className={`shrink-0 rounded p-0.5 disabled:opacity-50 ${
            isPrimary ? "text-foreground" : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <Star className={`h-3.5 w-3.5 ${isPrimary ? "fill-current" : ""}`} />
        </button>
      )}
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
