"use client"

import { useState, useTransition } from "react"
import { toast } from "sonner"
import { EDITION_LABEL, MIXED_EDITIONS } from "@/lib/editions/mixed-edition"
import type { MixedEdition } from "@/lib/editions/mixed-edition"
import { setEvaluationEdition } from "@/server/actions/read-edition"
import { useRefresh } from "@/lib/use-refresh"

/** "Versão R18" → "versão R18" (só a inicial: a sigla fica). */
const nome = (ed: MixedEdition) => EDITION_LABEL[ed].charAt(0).toLowerCase() + EDITION_LABEL[ed].slice(1)

/** O texto da linha — exportado para o teste. */
export function evaluationEditionText(args: {
  hasEvaluation: boolean
  evaluationEdition: MixedEdition | null
  activeEdition: MixedEdition
}): string {
  const { hasEvaluation, evaluationEdition, activeEdition } = args
  if (!hasEvaluation) return `Sua avaliação será registrada na ${nome(activeEdition)}, a que você está vendo.`
  if (evaluationEdition == null) return "Versão da sua avaliação não registrada"
  const base = `Sua avaliação é da ${nome(evaluationEdition)}`
  return evaluationEdition === activeEdition ? base : `${base} (você está vendo a ${nome(activeEdition)})`
}

/**
 * Obra mixed, aba "Meu Status": qual versão a SUA avaliação descreve (mig 216, decisão D1 — uma
 * avaliação por obra, com a versão registrada nela). Discreto de propósito: uma linha, sem modal.
 *
 * - Sem avaliação: só informa em que versão ela vai ser registrada (a ativa na tela).
 * - Com avaliação: mostra a versão dela e oferece "Alterar" — troca explícita, que muda só a versão,
 *   nunca a nota (`setEvaluationEdition`).
 * - Avaliação histórica sem versão: oferece registrar uma das duas.
 */
export function EvaluationEditionLine({
  workId,
  hasEvaluation,
  evaluationEdition,
  activeEdition,
}: {
  workId: string
  hasEvaluation: boolean
  evaluationEdition: MixedEdition | null
  activeEdition: MixedEdition
}) {
  const refresh = useRefresh()
  const [pending, startTransition] = useTransition()
  const [choosing, setChoosing] = useState(false)

  const escolher = (edition: MixedEdition) =>
    startTransition(async () => {
      const r = await setEvaluationEdition(workId, edition)
      if (!r.ok) {
        toast.error(r.error)
        return
      }
      setChoosing(false)
      if (r.changed) toast.success(`Avaliação registrada na ${nome(edition)}.`)
      refresh()
    })

  const texto = evaluationEditionText({ hasEvaluation, evaluationEdition, activeEdition })
  const opcoes = hasEvaluation && (choosing || evaluationEdition == null)

  return (
    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground" data-slot="evaluation-edition">
      <span>{texto}</span>
      {hasEvaluation && evaluationEdition != null && !choosing && (
        <>
          <span aria-hidden>·</span>
          <button
            type="button"
            className="font-medium text-foreground underline-offset-4 hover:underline disabled:opacity-50"
            onClick={() => setChoosing(true)}
            disabled={pending}
          >
            Alterar
          </button>
        </>
      )}
      {opcoes && (
        <span role="group" aria-label="Versão da sua avaliação" className="inline-flex items-center gap-1.5">
          <span aria-hidden>·</span>
          {MIXED_EDITIONS.map((ed) => (
            <button
              key={ed}
              type="button"
              disabled={pending || ed === evaluationEdition}
              aria-pressed={ed === evaluationEdition}
              onClick={() => escolher(ed)}
              className="rounded-md px-2 py-0.5 font-medium text-foreground ring-1 ring-border hover:bg-muted disabled:opacity-50"
            >
              {EDITION_LABEL[ed]}
            </button>
          ))}
          {choosing && (
            <button type="button" className="hover:text-foreground" onClick={() => setChoosing(false)} disabled={pending}>
              Cancelar
            </button>
          )}
        </span>
      )}
    </p>
  )
}
