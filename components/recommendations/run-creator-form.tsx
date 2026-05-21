"use client"

import { useRouter } from "next/navigation"
import { useState } from "react"
import { BookOpen, ChartNoAxesCombined, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Textarea } from "@/components/ui/textarea"
import { runRecommendationAction } from "@/server/actions/recommendations"

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
        router.push(`/recommendations/${res.data.runId}`)
        router.refresh()
      }
    } finally {
      setRunning(null)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Gerar nova recomendação</CardTitle>
        <CardDescription className="text-xs">
          Roda IA sobre seus favoritos. Custo estimado por execução: ~$0.05.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-1.5">
          <label htmlFor="user-context" className="text-sm font-medium">
            Contexto extra (opcional)
          </label>
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
            className="justify-start"
          >
            {running === "next_read" ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <BookOpen className="mr-2 h-4 w-4" />
            )}
            Próxima leitura
          </Button>
          <Button
            onClick={() => handleRun("full_analysis")}
            disabled={disabled || running !== null}
            variant="secondary"
            className="justify-start"
          >
            {running === "full_analysis" ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <ChartNoAxesCombined className="mr-2 h-4 w-4" />
            )}
            Análise do gosto
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
      </CardContent>
    </Card>
  )
}
