"use client"

import { useEffect, useState } from "react"
import { Minus, Plus, SlidersHorizontal } from "lucide-react"

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { CRITERIA_INFO } from "@/lib/constants/criteria"
import { CRITERION_SLUGS, type CriterionSlug } from "@/types/domain"
import { MAX_COMPARE_WORKS } from "@/lib/compare-config"
import type { AttributeWeight, MoodExclusionKey, MoodPracticalDimension, MoodRefine } from "@/lib/calculations/mood-refine"
import { BIPOLAR_DIMENSIONS, MOOD_DIMENSION_INFO, MOOD_EXCLUSION_GROUPS, UNIPOLAR_DIMENSIONS } from "@/lib/ui/mood-dimensions"
import { MoodPreview, type MoodPreviewWork } from "@/components/ranking/mood-preview"
import { filterMoodWorks, isMoodActive } from "@/lib/calculations/mood-refine"

const EMPTY_MOOD: MoodRefine = { attributes: {}, practical: {} }

// Escala de 5 níveis por atributo, estilo "equalizer": barras crescentes
// (evitar → priorizar), com altura e cor (verde → vermelho) codificando a
// intensidade. `null` = neutro (a barra do meio). Arrays paralelos, na ordem.
const SCALE: Array<{ value: AttributeWeight | null; title: string }> = [
  { value: -2, title: "Evitar muito" },
  { value: -1, title: "Evitar" },
  { value: null, title: "Neutro" },
  { value: 1, title: "Priorizar" },
  { value: 2, title: "Priorizar muito" },
]
const BAR_HEIGHT = ["h-2.5", "h-3.5", "h-4", "h-5", "h-6"]
// Vermelho (evitar, −) → verde (priorizar, +).
const BAR_COLOR = ["bg-red-500", "bg-orange-500", "bg-amber-400", "bg-lime-500", "bg-emerald-500"]
// Barras da legenda: mais baixas e um pouco mais largas que as do seletor.
const LEGEND_HEIGHT = ["h-1", "h-1.5", "h-2", "h-2.5", "h-3"]

/**
 * Popup de refino por mood. As obras do tier estão tecnicamente empatadas (dentro
 * do erro do modelo); aqui o user diz o que quer priorizar AGORA e a comparação
 * abre reordenada por uma Prioridade ajustada (limitada ao MAE). Ver
 * lib/calculations/mood-refine.ts.
 */
export function MoodRefineDialog({
  open,
  onOpenChange,
  workCount,
  onApply,
  onSkip,
  hasRanges = false,
  works = [],
  ranges,
  scope = "cluster",
  initialMood = null,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  workCount: number
  onApply: (mood: MoodRefine) => void
  onSkip: () => void
  /**
   * De onde o popup foi aberto. Muda só o TEXTO e o rótulo do botão — o cálculo é
   * o mesmo, e tem que continuar sendo: duas fórmulas conforme a porta de entrada
   * fariam a mesma escolha produzir ordens diferentes em duas telas.
   */
  scope?: "cluster" | "list"
  /**
   * O refino JÁ aplicado, para reabrir o popup com ele em vez de em branco.
   *
   * 🔴 Só faz sentido no escopo LISTA, e é o que torna o botão honesto: o gatilho
   * diz "mudar o refino", e abrir vazio transformava "mudar" em "refazer do zero" —
   * quem quisesse trocar arte de +2 para +1 perdia as outras dimensões. No escopo
   * cluster o popup continua nascendo vazio, porque lá cada comparação é uma
   * pergunta nova sobre outras obras.
   */
  initialMood?: MoodRefine | null
  /** Há perfil com faixas ideais → níveis intermediários miram a borda da faixa. */
  hasRanges?: boolean
  /**
   * As obras do cluster, para a PRÉVIA. Vazio = sem prévia (o diálogo segue
   * funcionando) — é o que mantém este componente utilizável por quem ainda não
   * passa a lista, em vez de quebrar a tela.
   */
  works?: MoodPreviewWork[]
  /** Faixas ideais por critério — a mesma prop que o cálculo recebe. */
  ranges?: Record<string, { ideal_min: number; ideal_max: number }>
}) {
  const [mood, setMood] = useState<MoodRefine>(EMPTY_MOOD)
  // Colapsado por padrão (excluir é o caso raro) e aberto quando o refino reaberto
  // já traz exclusão — ver o effect logo abaixo.
  const [mostrarExclusoes, setMostrarExclusoes] = useState(false)

  // Reseta o estado a cada abertura (sync controlado prop→state, intencional).
  //
  // ⚠️ `initialMood` nas deps é seguro porque ele só muda quando o refino é
  // APLICADO — e aplicar fecha o diálogo. Enquanto ele está aberto a referência não
  // muda, então isto não atropela o que a pessoa está editando.
  useEffect(() => {
    if (!open) return
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMood(initialMood ?? EMPTY_MOOD)
    // ⚠️ Reabrir com exclusão ativa TEM que abrir o bloco: ele nasce colapsado
    // porque excluir é o caso raro, mas colapsado sobre uma exclusão em vigor
    // esconde justamente a explicação de por que faltam obras na lista.
    setMostrarExclusoes((initialMood?.exclude?.length ?? 0) > 0)
  }, [open, initialMood])

  const setAttr = (slug: CriterionSlug, weight: AttributeWeight | null) => {
    setMood((m) => {
      const attributes = { ...m.attributes }
      if (weight == null) delete attributes[slug]
      else attributes[slug] = weight
      return { ...m, attributes }
    })
  }

  const setPractical = (key: MoodPracticalDimension, weight: AttributeWeight | null) => {
    setMood((m) => {
      const practical = { ...(m.practical ?? {}) }
      if (weight == null) delete practical[key]
      else practical[key] = weight
      return { ...m, practical }
    })
  }

  const toggleExclusion = (key: MoodExclusionKey) =>
    setMood((m) => {
      const atual = m.exclude ?? []
      const exclude = atual.includes(key) ? atual.filter((k) => k !== key) : [...atual, key]
      return { ...m, exclude: exclude.length ? exclude : undefined }
    })

  const toggleChapters = (dir: "curto" | "longo") =>
    setMood((m) => ({ ...m, chapters: m.chapters === dir ? undefined : dir }))

  const excluidas = mood.exclude?.length ?? 0
  const sobrando = filterMoodWorks(works, mood)
  const active = isMoodActive(mood)
  const naLista = scope === "list"
  // O teto do comparador não existe na lista: lá as obras não vão pro drawer.
  const overflow = !naLista && workCount > MAX_COMPARE_WORKS

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* ⚠️ `sm:max-w-3xl`, não `max-w-3xl`: o DialogContent já traz `sm:max-w-lg`, e a
          variante responsiva vence a classe base acima de 640px — o diálogo ficava em
          512px e as duas colunas do topo espremiam. Medido. */}
      <DialogContent className="flex max-h-[90vh] flex-col sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <SlidersHorizontal className="h-4 w-4 text-primary" />
            {naLista ? "Refinar a lista" : "Refinar comparação"}
          </DialogTitle>
          <DialogDescription>
            {naLista ? (
              <>
                Diga o que você quer priorizar agora e estas {workCount} obras se reordenam por
                isso. O ajuste é <span className="font-medium">limitado à margem de erro do
                modelo</span>, então ele desempata o que já estava empatado — não inventa distância
                entre obras.{" "}
                <span className="text-muted-foreground">
                  Vale só nesta visita: sair da página desfaz o refino.
                </span>
              </>
            ) : (
              <>
                Estas {workCount} obras estão tecnicamente empatadas em Prioridade (dentro do erro
                do modelo). Diga o que você quer priorizar agora — a comparação abre reordenada por
                isso
                {overflow ? `, mostrando as ${MAX_COMPARE_WORKS} melhores pro seu mood` : ""}.{" "}
                <span className="text-muted-foreground">
                  Grátis e instantâneo, sem IA — o desempate por IA é opcional, dentro da
                  comparação.
                </span>
              </>
            )}
          </DialogDescription>
        </DialogHeader>

        {/* ⚠️ A lista ROLA e o rodapé NÃO: o diálogo passou de 3 toggles pra 7 linhas de
            equalizer (835px), e sem isto ele estourava a janela por cima — medido em
            2026-08-15: a 800px de altura o topo ficava em −17px e a 700px o botão de
            confirmar saía da tela, sem scroll nenhum pra alcançá-lo. */}
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto py-1 pr-1">
          {/* Topo em DUAS colunas: pares à esquerda, chips à direita. Cada bloco tem a
              forma do que significa — par exclusivo tem dois lados opostos, chip só
              tem um. Antes eram 7 escalas iguais em coluna única: uma parede de 835px
              que estourava a janela, e as barras nem alinhavam (3 segmentos nas
              dimensões sem oposto, 5 nas com oposto). */}
          <div className="grid items-start gap-5 sm:grid-cols-[auto_1px_minmax(0,1fr)]">
            <div className="w-full sm:w-[366px]">
              <div className="mb-2 flex items-baseline justify-between gap-2">
                <p className="text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Prefiro que seja
                </p>
                <span className="text-[10.5px] text-muted-foreground/70">um lado, ou nenhum</span>
              </div>
              <div className="space-y-1">
                <PairRow
                  emoji="📖"
                  label="Tamanho"
                  down="Curta"
                  up="Longa"
                  value={mood.chapters === "curto" ? -1 : mood.chapters === "longo" ? 1 : 0}
                  onPick={(side: -1 | 1) =>
                    toggleChapters(side === -1 ? "curto" : "longo")
                  }
                />
                {BIPOLAR_DIMENSIONS.map((key: MoodPracticalDimension) => {
                  const info = MOOD_DIMENSION_INFO[key]
                  return (
                    <PairRow
                      key={key}
                      emoji={info.emoji}
                      label={info.name}
                      down={info.down ?? ""}
                      up={info.up}
                      value={mood.practical?.[key] ?? 0}
                      onPick={(side: -1 | 1) =>
                        setPractical(key, (mood.practical?.[key] ?? 0) === side ? null : (side as AttributeWeight))
                      }
                    />
                  )
                })}
              </div>
            </div>

            <div className="hidden bg-border/60 sm:block sm:self-stretch" aria-hidden />

            <div className="min-w-0">
              <p className="mb-2 text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground">
                E que conte a favor
              </p>
              <div className="flex flex-wrap gap-1.5">
                {UNIPOLAR_DIMENSIONS.map((key: MoodPracticalDimension) => {
                  const info = MOOD_DIMENSION_INFO[key]
                  const lvl = mood.practical?.[key] ?? 0
                  return (
                    <button
                      key={key}
                      type="button"
                      title={info.hint}
                      aria-pressed={lvl > 0}
                      onClick={() =>
                        setPractical(key, lvl === 0 ? 1 : lvl === 1 ? 2 : null)
                      }
                      className={cn(
                        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors",
                        lvl === 2
                          ? "border-primary/80 bg-primary/20 font-semibold text-primary"
                          : lvl === 1
                            ? "border-primary/45 bg-primary/10 text-primary"
                            : "border-border/70 text-muted-foreground hover:border-primary/40 hover:text-foreground",
                      )}
                    >
                      <span aria-hidden>{info.emoji}</span>
                      {info.name}
                      {lvl === 2 && <span className="text-[9.5px] tracking-wide">EM DOBRO</span>}
                    </button>
                  )
                })}
              </div>
              <p className="mt-2 text-[10.5px] leading-snug text-muted-foreground/70">
                Clique de novo para contar em dobro.
              </p>
            </div>
          </div>

          {/* Atributos — o ÚNICO bloco que usa escala, porque é o único em que
              intensidade quer dizer algo ("um pouco de drama" ≠ "nada de drama").
              Duas colunas preenchendo por COLUNA (5 + 4): com o fluxo por linha a
              ordem lida intercala as duas e vira Romance → Protagonista → Dinâmica. */}
          <div className="mt-4 border-t pt-3">
            <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <p className="text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground">
                Atributos da obra
              </p>
              <span className="inline-flex items-center gap-1.5 text-[10.5px] text-muted-foreground/70">
                <Minus className="h-2.5 w-2.5 text-red-500" />
                evitar
                <span className="inline-flex items-end gap-px" aria-hidden>
                  {LEGEND_HEIGHT.map((h, i) => (
                    <span key={i} className={cn("w-1 rounded-full", h, BAR_COLOR[i])} />
                  ))}
                </span>
                priorizar
                <Plus className="h-2.5 w-2.5 text-emerald-500" />
              </span>
            </div>
            {hasRanges && (
              <p className="mb-1.5 text-[10.5px] leading-snug text-muted-foreground/70">
                Os níveis do meio miram a{" "}
                <span className="text-foreground">borda da sua faixa ideal</span>; os extremos vão ao
                mínimo/máximo absoluto.
              </p>
            )}
            <div className="grid grid-flow-row gap-x-6 sm:grid-flow-col sm:grid-cols-2 sm:grid-rows-5">
              {CRITERION_SLUGS.map((slug) => {
                const info = CRITERIA_INFO[slug]
                const cur = mood.attributes[slug] ?? null
                return (
                  <div
                    key={slug}
                    className="grid max-w-[348px] grid-cols-[minmax(0,1fr)_auto] items-center gap-2 py-0.5"
                  >
                    <span className="flex min-w-0 items-center gap-1.5 text-[13px]" title={info.name}>
                      <span aria-hidden>{info.emoji}</span>
                      <span className="truncate">{info.name}</span>
                    </span>
                    <IntensityScale value={cur} onChange={(w) => setAttr(slug, w)} />
                  </div>
                )
              })}
            </div>
          </div>

          {/* "Não mostrar" nasce COLAPSADO (escolha da Ana): excluir categoria é o caso
              raro, e sete linhas de chip permanentes devolveriam a parede que este
              redesenho desmontou. O contador fica no gatilho pra exclusão ativa nunca
              ficar escondida — mesma régua do badge da barra superior. */}
          <div className="mt-3 border-t pt-2.5">
            <button
              type="button"
              onClick={() => setMostrarExclusoes((v) => !v)}
              aria-expanded={mostrarExclusoes}
              className="flex w-full items-center gap-2 text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground transition-colors hover:text-foreground"
            >
              <span aria-hidden className={cn("text-[10px] transition-transform", mostrarExclusoes && "rotate-90")}>
                ▸
              </span>
              Não mostrar
              <span className="ml-auto text-[11px] font-medium normal-case tracking-normal text-muted-foreground/70">
                {excluidas === 0
                  ? "nada excluído"
                  : `${excluidas} ${excluidas === 1 ? "categoria" : "categorias"} · ${sobrando.length} de ${works.length} obras`}
              </span>
            </button>
            {mostrarExclusoes && (
              <div className="mt-2 space-y-2">
                {MOOD_EXCLUSION_GROUPS.map((grupo) => (
                  <div key={grupo.label} className="flex flex-wrap items-center gap-1.5">
                    <span className="w-[92px] shrink-0 text-[11px] text-muted-foreground">
                      <span aria-hidden>{grupo.emoji}</span> {grupo.label}
                    </span>
                    {grupo.items.map((item) => {
                      const off = mood.exclude?.includes(item.key) ?? false
                      return (
                        <button
                          key={item.key}
                          type="button"
                          aria-pressed={off}
                          onClick={() => toggleExclusion(item.key)}
                          className={cn(
                            "rounded-full border px-2.5 py-1 text-xs transition-colors",
                            off
                              ? "border-rose-500/50 bg-rose-500/15 text-rose-600 line-through dark:text-rose-300"
                              : "border-border/70 text-muted-foreground hover:border-rose-500/40 hover:text-foreground",
                          )}
                        >
                          {item.label}
                        </button>
                      )
                    })}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* A prévia fica FORA da área que rola: ela é o resultado, e resultado que
            sai da tela quando se rola pra mexer num controle não fecha o loop. */}
        {works.length > 0 && (
          <div className="shrink-0 border-t pt-3">
            <MoodPreview
              works={sobrando}
              mood={mood}
              ranges={ranges}
              active={active}
              excluidas={works.length - sobrando.length}
              // Na lista o conjunto é o catálogo filtrado inteiro — desenhar 126
              // cards devolveria a parede que este popup existe pra evitar. O
              // cálculo segue sobre todas; o corte é só do desenho.
              maxItems={naLista ? 6 : undefined}
            />
          </div>
        )}

        <DialogFooter>
          {/* Botão único condicional: sem nada selecionado, segue sem refinar
              (onSkip); ao escolher/alterar qualquer coisa, aplica o mood montado.
              ⚠️ No escopo LISTA o `onSkip` é o que LIMPA um refino anterior — daí
              o rótulo dizer "Limpar refino" em vez de repetir a ação de aplicar. */}
          <Button onClick={() => (active ? onApply(mood) : onSkip())}>
            {naLista
              ? active
                ? "Aplicar na lista"
                : "Limpar refino"
              : active
                ? "Comparar assim"
                : "Comparar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function IntensityScale({
  value,
  onChange,
  className,
  positiveOnly = false,
}: {
  value: AttributeWeight | null
  onChange: (w: AttributeWeight | null) => void
  className?: string
  /**
   * Dimensão SEM oposto com sentido (arte, alinhamento, sinopse, média externa):
   * desenha só neutro→priorizar. Oferecer "evitar arte boa" seria um controle que
   * não quer dizer nada — ver MOOD_DIMENSION_INFO.
   */
  positiveOnly?: boolean
}) {
  const num = value ?? 0
  const min = positiveOnly ? 0 : -2
  const segments = positiveOnly ? SCALE.filter((s) => (s.value ?? 0) >= 0) : SCALE
  const step = (delta: number) => {
    const next = Math.max(min, Math.min(2, num + delta))
    onChange(next === 0 ? null : (next as AttributeWeight))
  }
  return (
    <div className={cn("flex items-end gap-2", className)}>
      <button
        type="button"
        aria-label="Diminuir (evitar mais)"
        title="Evitar mais"
        onClick={() => step(-1)}
        disabled={num <= min}
        className="shrink-0 pb-0.5 text-red-500 transition-colors hover:text-red-600 disabled:opacity-40"
      >
        <Minus className="h-3.5 w-3.5" />
      </button>
      <div className="flex items-end gap-1">
        {segments.map((seg) => {
          const i = SCALE.findIndex((s) => s.value === seg.value)
          const selected = value === seg.value
          return (
            <button
              key={seg.title}
              type="button"
              title={seg.title}
              aria-label={seg.title}
              aria-pressed={selected}
              onClick={() => onChange(selected ? null : seg.value)}
              className="flex h-6 items-end px-0.5"
            >
              <span
                className={cn(
                  "w-2 rounded-full transition-all",
                  BAR_HEIGHT[i],
                  BAR_COLOR[i],
                  selected
                    ? "opacity-100 ring-2 ring-foreground/40 ring-offset-1 ring-offset-background"
                    : "opacity-25 hover:opacity-60",
                )}
              />
            </button>
          )
        })}
      </div>
      <button
        type="button"
        aria-label="Aumentar (priorizar mais)"
        title="Priorizar mais"
        onClick={() => step(1)}
        disabled={num >= 2}
        className="shrink-0 pb-0.5 text-emerald-500 transition-colors hover:text-emerald-600 disabled:opacity-40"
      >
        <Plus className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}

/**
 * Uma dimensão com dois lados opostos: dois botões, e no máximo um aceso.
 *
 * ⚠️ O container tem largura FIXA e os botões são `flex-1` — com largura no botão,
 * o par mais largo ("Em andamento") empurra a borda e a coluna serrilha. Medido.
 */
function PairRow({
  emoji,
  label,
  down,
  up,
  value,
  onPick,
}: {
  emoji: string
  label: string
  down: string
  up: string
  value: number
  onPick: (side: -1 | 1) => void
}) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2.5 py-0.5">
      <span className="flex min-w-0 items-center gap-1.5 text-[13px]">
        <span aria-hidden>{emoji}</span>
        <span className="truncate">{label}</span>
      </span>
      <span className="inline-flex w-[218px] overflow-hidden rounded-md border border-border/70 bg-muted/40">
        {([-1, 1] as const).map((side) => (
          <button
            key={side}
            type="button"
            aria-pressed={value === side}
            onClick={() => onPick(side)}
            className={cn(
              "flex-1 whitespace-nowrap px-2 py-1 text-xs transition-colors",
              side === 1 && "border-l border-border/70",
              value === side
                ? "bg-primary/15 font-semibold text-primary"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            {side === -1 ? down : up}
          </button>
        ))}
      </span>
    </div>
  )
}
