"use client"

import { useRouter, useSearchParams } from "next/navigation"
import { X } from "lucide-react"
import { MOOD_PRESETS } from "@/lib/constants/mood-presets"

/**
 * Barra "Modo de hoje" no topo do ranking. Aplica um mood temporário via
 * query param `?mood=<id>` — não persiste em preferências. Recarregar sem o
 * param volta ao ranking estável padrão.
 *
 * O parsing/aplicação do mood (filtros + sort override) acontece no server
 * em `app/ranking/page.tsx`. Aqui só lê o param atual e oferece a UI.
 */
export function MoodBar() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const activeMood = searchParams.get("mood")

  const setMood = (moodId: string | null) => {
    const params = new URLSearchParams(searchParams.toString())
    if (moodId) params.set("mood", moodId)
    else params.delete("mood")
    params.delete("page")
    const qs = params.toString()
    router.push(qs ? `/ranking?${qs}` : "/ranking")
  }

  // "surpresa" não é mood — abre um dialog separado. Filtrado fora.
  const moods = MOOD_PRESETS.filter((p) => p.id !== "surpresa")

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border/55 bg-card/60 px-3 py-2">
      <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Modo de hoje
      </span>
      <div className="flex flex-wrap gap-1.5">
        {moods.map((preset) => {
          const active = activeMood === preset.id
          return (
            <button
              key={preset.id}
              type="button"
              onClick={() => setMood(active ? null : preset.id)}
              className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs transition-colors ${
                active
                  ? "border-primary/60 bg-primary/15 text-primary"
                  : "border-border/70 bg-background/60 hover:border-primary/40 hover:bg-primary/5"
              }`}
              title={preset.description}
            >
              <span>{preset.emoji}</span>
              <span>{preset.label}</span>
            </button>
          )
        })}
      </div>
      {activeMood && (
        <button
          type="button"
          onClick={() => setMood(null)}
          className="ml-auto inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          aria-label="Limpar modo"
        >
          <X className="h-3 w-3" />
          Limpar
        </button>
      )}
    </div>
  )
}
