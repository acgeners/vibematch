"use client"

import { X } from "lucide-react"

import { cn } from "@/lib/utils"

/**
 * Um chip da barra "Filtros ativos" = **um controle do painel**, não um valor.
 *
 * A versão anterior imprimia um chip por VALOR, e a mesma dimensão repetia o prefixo a
 * cada um: `Sinopse: ♥♥♥`, `Sinopse: ♥♥♥♥`, `Prev. sinopse: ♥♥`… Medido na tela real
 * (12 filtros, painel a 1120px): 12 chips e 1745px de largura somada contra 6 chips e
 * 1370px agrupando — e a economia cresce com o número de valores por dimensão.
 *
 * O agrupamento também conserta uma ambiguidade que a versão por-valor tinha: a mesma
 * dimensão aparecia com DOIS nomes (`Sinopse:` e `Interesse:` são o mesmo controle;
 * `Prev. sinopse:` e `Prev. IA:` idem), nenhum deles igual ao nome usado no painel.
 * Com um chip por controle, o rótulo é o do painel — é lá que se desfaz.
 */
export interface ActiveFilterValue {
  text: string
  /** Valor EXCLUÍDO: risco, a mesma marca do pill excluído no painel. */
  struck?: boolean
  /** Remove só este valor. Ausente = o valor não é removível sozinho. */
  onRemove?: () => void
}

export interface ActiveFilterChip {
  key: string
  /** Nome do controle, como ele aparece no painel. */
  label: string
  /** Vazio = o `label` já é o texto inteiro (chip simples, sem valores destacados). */
  values?: ActiveFilterValue[]
  /** O ✕ do chip: zera o controle inteiro. */
  onClear: () => void
  /** Tom herdado do painel — a mesma cor que ensinou a regra lá dentro. */
  tone?: "exclude" | "loved" | "predicted" | "include" | "optional"
}

const TONE_CLASS: Record<NonNullable<ActiveFilterChip["tone"]>, string> = {
  exclude: "border-rose-400/40 bg-rose-400/10",
  loved: "border-red-500/35 bg-red-500/10",
  predicted: "border-orange-500/35 bg-orange-500/10",
  include: "border-emerald-400/35 bg-emerald-400/10",
  optional: "border-sky-400/35 bg-sky-400/10",
}

const LABEL_TONE_CLASS: Record<NonNullable<ActiveFilterChip["tone"]>, string> = {
  exclude: "text-rose-600 dark:text-rose-300",
  loved: "text-red-600 dark:text-red-300",
  predicted: "text-orange-600 dark:text-orange-300",
  include: "text-emerald-700 dark:text-emerald-300",
  optional: "text-sky-700 dark:text-sky-300",
}

export function ActiveFilterChips({ chips }: { chips: ActiveFilterChip[] }) {
  return (
    <>
      {chips.map((chip) => {
        const values = chip.values ?? []
        const tone = chip.tone ? TONE_CLASS[chip.tone] : "border-border/80 bg-background/55"

        // Chip simples: sem valores (o label é o texto todo) ou um valor só que não
        // precisa de alvo próprio — o chip inteiro vira o botão de remover, como antes.
        if (values.length === 0 || (values.length === 1 && !values[0].struck && !values[0].onRemove)) {
          return (
            <button
              key={chip.key}
              type="button"
              onClick={chip.onClear}
              className={cn(
                "inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium text-foreground transition-colors hover:border-primary/40 hover:bg-primary/10",
                tone,
              )}
              title="Remover filtro"
            >
              {chip.label}
              {values.length === 1 && <span className="font-semibold tabular-nums">{values[0].text}</span>}
              <X className="h-3 w-3 text-muted-foreground" />
            </button>
          )
        }

        return (
          <span
            key={chip.key}
            className={cn(
              "inline-flex h-7 items-center gap-1 rounded-full border px-2.5 text-xs font-medium text-foreground",
              tone,
            )}
          >
            <span className={cn("text-muted-foreground", chip.tone && LABEL_TONE_CLASS[chip.tone])}>
              {chip.label}
            </span>
            {values.map((value, i) => (
              <span key={`${chip.key}-${value.text}`} className="inline-flex items-center gap-1">
                {i > 0 && <span className="text-muted-foreground/55">·</span>}
                {value.onRemove ? (
                  <button
                    type="button"
                    onClick={value.onRemove}
                    // O texto do botão é só o valor ("Cancelled"), que não diz o que o
                    // clique faz — sem o aria-label, um leitor de tela anuncia um botão
                    // chamado "Cancelled" dentro de um chip chamado "Publicação exceto".
                    aria-label={`Remover ${value.text}`}
                    title={`Remover ${value.text}`}
                    className={cn(
                      "rounded px-1 py-0.5 transition-colors hover:bg-foreground/10",
                      value.struck && "line-through decoration-[1.5px]",
                    )}
                  >
                    {value.text}
                  </button>
                ) : (
                  <span className={cn("px-1", value.struck && "line-through decoration-[1.5px]")}>
                    {value.text}
                  </span>
                )}
              </span>
            ))}
            <button
              type="button"
              onClick={chip.onClear}
              aria-label={`Remover o filtro ${chip.label}`}
              title="Remover o filtro inteiro"
              className="ml-0.5 rounded p-0.5 text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground"
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        )
      })}
    </>
  )
}
