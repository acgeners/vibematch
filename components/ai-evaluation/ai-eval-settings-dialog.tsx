"use client"

import { useState } from "react"
import { SlidersHorizontal } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { AiEvalPreferencesForm } from "@/components/settings/ai-eval-preferences-form"
import type { FormulaConfig } from "@/types/domain"

/**
 * Config dos filtros da fila de avaliação (tolerância de versão de prompt + limiar
 * de baixa confiança). Mora aqui — em /ai-evaluation — porque os dois knobs
 * configuram justamente os filtros "Modelo/prompt antigos" e "Baixa confiança"
 * desta página (não é preferência de gosto). Abre num diálogo pra não poluir a fila.
 */
export function AiEvalSettingsDialog({
  config,
  currentPromptVersion,
  currentPromptVersionNum,
}: {
  config: FormulaConfig
  currentPromptVersion: string
  currentPromptVersionNum: number
}) {
  const [open, setOpen] = useState(false)
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5">
          <SlidersHorizontal className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Filtros da fila</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Configuração dos filtros</DialogTitle>
          <DialogDescription>
            Define o que a fila trata como “modelo/prompt antigo” e o limiar de confiança
            abaixo do qual uma avaliação entra na revisão.
          </DialogDescription>
        </DialogHeader>
        <AiEvalPreferencesForm
          config={config}
          currentPromptVersion={currentPromptVersion}
          currentPromptVersionNum={currentPromptVersionNum}
        />
      </DialogContent>
    </Dialog>
  )
}
