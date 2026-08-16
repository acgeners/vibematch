"use client"

import { cn } from "@/lib/utils"
import { sortByMoodAdjusted, type MoodRefine, type MoodWork } from "@/lib/calculations/mood-refine"

/**
 * A prévia do refino: as obras do cluster na ordem em que a comparação VAI abrir,
 * atualizando a cada ajuste.
 *
 * 🔴 **Este componente não calcula nada.** A ordem sai de `sortByMoodAdjusted` — a
 * MESMA função que o comparador usa para abrir. Reescrever a conta aqui seria a
 * família "dois critérios pro mesmo fato" no pior formato possível: a prévia
 * PROMETE uma ordem e a tela seguinte entrega outra, e quem confia na promessa é
 * exatamente quem está tentando decidir. Se precisar mudar o cálculo, mude em
 * `lib/calculations/mood-refine.ts`.
 *
 * Guardado por `tests/unit/ranking/previa-usa-o-mesmo-calculo.test.tsx`, que compara
 * a ordem RENDERIZADA com a do dono em vários moods — um só coincidiria por acaso.
 *
 * Por que existe: o diálogo prometia "a comparação abre reordenada por isso" e não
 * mostrava nada do efeito. A pessoa configurava às cegas, clicava, e só então
 * descobria se tinha servido — numa feature cujo propósito é ajudar a DECIDIR.
 */
export interface MoodPreviewWork extends MoodWork {
  title: string
}

export function MoodPreview({
  works,
  mood,
  ranges,
  active,
  excluidas = 0,
  maxItems,
}: {
  works: MoodPreviewWork[]
  mood: MoodRefine
  ranges?: Record<string, { ideal_min: number; ideal_max: number }>
  /** Mood vazio → a lista aparece na ordem atual, sem setas de movimento. */
  active: boolean
  /**
   * Quantas obras foram EXCLUÍDAS por categoria. Precisa ser dito: sem isso a lista
   * simplesmente encolhe e a pessoa não sabe se filtrou demais ou se a comparação
   * perdeu obras sozinha.
   */
  excluidas?: number
  /**
   * Quantas obras DESENHAR. O cálculo continua sobre `works` inteiro — só o
   * desenho é cortado.
   *
   * 🔴 Cortar antes de ordenar seria o bug que este componente existe pra evitar,
   * em outra roupa: `computeMoodFit` normaliza cada dimensão pelo min/max do
   * conjunto que recebe, então passar as 6 primeiras faria a prévia prometer uma
   * ordem calculada num universo que não é o da lista.
   */
  maxItems?: number
}) {
  if (works.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        {excluidas
          ? `Nenhuma obra passa nos filtros — ${excluidas} ${excluidas === 1 ? "foi excluída" : "foram excluídas"} em "Não mostrar".`
          : "Nenhuma obra para comparar."}
      </p>
    )
  }

  const antes = works.map((w) => w.id)
  const ordenadas = sortByMoodAdjusted(works, mood, ranges) as MoodPreviewWork[]
  // Ordena TUDO, desenha o começo: o que sobra vira contagem, nunca sumiço mudo.
  const depois = maxItems != null ? ordenadas.slice(0, maxItems) : ordenadas
  const restantes = ordenadas.length - depois.length

  return (
    <div className="space-y-1.5">
      {/* ⚠️ O título anterior era só "Como a comparação vai abrir", e não se explicava:
          não dizia que aqueles cards SÃO as obras selecionadas, nem o que a seta
          significa. Quem desenhou a tela entendeu; quem abriu, não. */}
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
        <p className="text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground">
          {restantes > 0
            ? `As ${depois.length} primeiras de ${ordenadas.length}`
            : `Ordem em que ${works.length === 1 ? "a obra vai" : `as ${works.length} obras vão`} aparecer`}
        </p>
        <span className="text-[10.5px] text-muted-foreground/70">
          {excluidas
            ? `${excluidas} fora por "Não mostrar"`
            : active
              ? "↑ subiu com o que você escolheu"
              : "sua ordem atual — nada escolhido ainda"}
        </span>
      </div>

      {/* Empilha em telas estreitas: cinco cards lado a lado deixam ~103px cada e o
          título é cortado em quase todos (medido no mockup). */}
      <ul className="flex flex-col gap-1.5 sm:flex-row">
        {depois.map((w, i) => {
          const movimento = antes.indexOf(w.id) - i
          return (
            <li
              key={w.id}
              className={cn(
                "flex min-w-0 flex-1 items-baseline gap-2 rounded-lg border px-2.5 py-2 sm:flex-col sm:items-stretch sm:gap-0.5",
                active && movimento > 0
                  ? "border-emerald-500/40 bg-emerald-500/[0.07]"
                  : "border-border/60 bg-muted/30",
              )}
            >
              <span className="flex shrink-0 items-center gap-1 text-[10.5px] tabular-nums text-muted-foreground">
                {i + 1}º
                {active && movimento !== 0 && (
                  <span
                    className={cn(
                      "font-semibold",
                      movimento > 0 ? "text-emerald-500" : "text-muted-foreground/70",
                    )}
                  >
                    {movimento > 0 ? `↑${movimento}` : `↓${-movimento}`}
                  </span>
                )}
              </span>
              <span
                className="min-w-0 flex-1 truncate text-xs leading-tight text-foreground sm:line-clamp-2 sm:whitespace-normal"
                title={w.title}
                data-testid="previa-obra"
              >
                {w.title}
              </span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
