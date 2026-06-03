"use client"

import { useRouter } from "next/navigation"
import { useState } from "react"
import { BookOpen, ChartNoAxesCombined, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { runRecommendationAction } from "@/server/actions/recommendations"
import { MOOD_PRESETS } from "@/lib/constants/mood-presets"

interface RunCreatorFormProps {
  disabled?: boolean
  disabledReason?: string | null
}

export function RunCreatorForm({ disabled, disabledReason }: RunCreatorFormProps) {
  const router = useRouter()
  const [userContext, setUserContext] = useState("")
  const [running, setRunning] = useState<"next_read" | "full_analysis" | null>(null)
  const [error, setError] = useState<string | null>(null)

  const handleRun = async (mode: "next_read" | "full_analysis") => {
    setError(null)
    setRunning(mode)
    try {
      const res = await runRecommendationAction({
        mode,
        userContext: userContext.trim() || null,
      })
      if (res.error) setError(res.error)
      else if (res.data) {
        router.push(`/recommendations/${res.data.runSlug}`)
        router.refresh()
      }
    } finally {
      setRunning(null)
    }
  }

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <label htmlFor="user-context" className="text-sm font-medium">
          Contexto extra (opcional)
        </label>
        <div className="flex flex-wrap gap-1.5">
          {MOOD_PRESETS.filter((p) => p.userContextSnippet).map((preset) => (
            <button
              key={preset.id}
              type="button"
              onClick={() => setUserContext(preset.userContextSnippet)}
              disabled={disabled || running !== null}
              className="inline-flex items-center gap-1 rounded-full border border-border/70 bg-background/60 px-2.5 py-1 text-xs transition-colors hover:border-primary/50 hover:bg-primary/10 disabled:cursor-not-allowed disabled:opacity-50"
              title={preset.description}
            >
              <span>{preset.emoji}</span>
              <span>{preset.label}</span>
            </button>
          ))}
        </div>
        <Textarea
          id="user-context"
          placeholder='Ex.: "quero algo leve hoje", "estou no mood de drama denso", "evitar tragédia"'
          value={userContext}
          onChange={(e) => setUserContext(e.target.value)}
          rows={2}
          className="resize-none text-sm"
          maxLength={400}
          disabled={disabled || running !== null}
        />
        <p className="text-xs text-muted-foreground">
          Ajusta a ordem sem mudar seu perfil de gosto cacheado.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <Button
          onClick={() => handleRun("next_read")}
          disabled={disabled || running !== null}
          className="h-auto justify-start whitespace-normal py-2.5 text-left"
        >
          {running === "next_read" ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <BookOpen className="h-4 w-4" />
          )}
          <span className="flex flex-col items-start">
            <span className="text-sm font-semibold">Próxima leitura</span>
            <span className="text-[11px] font-normal opacity-80">
              Só favoritos ainda não avaliados (descoberta)
            </span>
          </span>
        </Button>
        <Button
          onClick={() => handleRun("full_analysis")}
          disabled={disabled || running !== null}
          variant="secondary"
          className="h-auto justify-start whitespace-normal py-2.5 text-left"
        >
          {running === "full_analysis" ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <ChartNoAxesCombined className="h-4 w-4" />
          )}
          <span className="flex flex-col items-start">
            <span className="text-sm font-semibold">Análise do gosto</span>
            <span className="text-[11px] font-normal opacity-80">
              Re-ranqueia a biblioteca inteira de favoritos
            </span>
          </span>
        </Button>
      </div>

      {disabled && disabledReason && (
        <p className="text-xs text-muted-foreground">{disabledReason}</p>
      )}
      {error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
          {error}
        </div>
      )}
    </div>
  )
}
