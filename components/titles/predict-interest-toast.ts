"use client"

import { toast } from "sonner"
import { predictSynopsisQualityForWorkAction } from "@/server/actions/synopsis-quality"
import type { PredictWorkOpts } from "@/lib/orchestration/integrations/interest-ui"
import { SYNOPSIS_QUALITY_LABELS } from "@/lib/constants/criteria"
import { previewCost } from "@/lib/cost-preview/catalog"
import { runTask } from "@/lib/tasks-store"
import type { ConfirmFn } from "@/components/cost/cost-confirm"

/**
 * Dispara a previsão JÁ CONFIRMADA como tarefa durável (indicador azul).
 *
 * 🔴 **Só depois da confirmação, nunca em volta da chamada inteira.** A primeira
 * chamada de `predictInterestWithToast` pode voltar `blocked_cost_confirmation` e
 * abrir um modal: uma tarefa em volta dela anunciaria "rodando" enquanto o modal
 * espera um clique — pior que indicador nenhum, porque afirma trabalho que não
 * começou. Era essa recursão que mantinha a previsão POR OBRA sem indicador
 * enquanto o LOTE já tinha o dele.
 *
 * Azul (durável) e não âmbar: as duas etapas GRAVAM — a cascata persiste uma versão
 * nova de `taste_profile` e a previsão persiste em `synopsis_quality_predictions`.
 * Pela régua do projeto, quem grava sobrevive à navegação e o indicador tem que
 * dizer isso ("pode sair da página").
 *
 * ⚠️ O `id` é por OBRA: duas obras previstas em paralelo aparecem como duas tarefas,
 * e o mesmo botão clicado duas vezes é deduplicado pelo store em vez de cobrar duas
 * chamadas pagas.
 *
 * ⚠️ `successToast: () => null` — os desfechos (estimado / processando / falhou)
 * já saem tipados no `switch` abaixo. O toast genérico do store diria "pronto"
 * inclusive quando a previsão voltou `failed`.
 */
function runPredictAsTask(
  workId: string,
  label: string,
  run: () => Promise<void>,
): void {
  runTask({
    id: `interest:${workId}`,
    kind: "interest",
    label,
    run,
    successToast: () => null,
  })
}

/**
 * Chama a previsão individual (passo 4) e traduz o estado TIPADO em toast.
 * Resultados (sucesso/erro/processando) são toasts; QUALQUER decisão de custo vai
 * pro MODAL CENTRAL (`confirmCost`) — nunca um toast de confirmação no canto. A
 * cascata do perfil (~$0,40) usa o botão secundário do modal pra oferecer o
 * caminho barato (prever com o perfil atual). Passe `confirmCost`
 * (`useCostConfirm()`) do componente chamador.
 */
export async function predictInterestWithToast(
  workId: string,
  refresh: () => void,
  opts: PredictWorkOpts = {},
  confirmCost?: ConfirmFn,
): Promise<void> {
  const res = await predictSynopsisQualityForWorkAction(workId, opts)
  switch (res.status) {
    case "fresh":
    case "succeeded": {
      const label = SYNOPSIS_QUALITY_LABELS[res.predictedQuality]
      const partial = res.partial ? ` · parcial (${res.usedFallbacks.join(", ")})` : ""
      toast.success(`Interesse estimado: ${res.predictedQuality} (${label})${partial}`)
      refresh()
      break
    }
    case "processing":
      toast.info(res.message)
      break
    case "not_ready":
    case "blocked_manual":
      toast.error(res.message)
      break
    case "failed":
      toast.error(`Falhou: ${res.error}. Tente novamente.`)
      break
    case "blocked_cost_confirmation": {
      // Decisão de custo = SEMPRE modal central (nunca toast no canto).
      if (!confirmCost) {
        // Chamada legada sem o confirmador — degrada pra notificação informativa.
        toast.error(res.message)
        break
      }
      const predict = previewCost("predict_interest")

      if (res.reason === "profile_cascade") {
        // Custo = regen do perfil (~$0,40) + previsão. Dois caminhos: atualizar o
        // perfil antes (confirmCascade) ou prever com o perfil ATUAL, mais barato
        // (acceptStaleProfile) — este vira o botão secundário do modal.
        const proceed = await confirmCost({
          estimate: {
            likelyUsd: res.likelyUsd,
            upperBoundUsd: res.upperBoundUsd,
            etaSeconds: predict.etaSeconds + 35,
            model: predict.model,
            background: true,
          },
          title: "Atualizar o perfil e prever?",
          // Custo/tempo já saem nos tiles + botões; a descrição carrega o "porquê"
          // e preserva a dica de defasagem que o servidor anexa (quando disponível).
          description: [
            "Regerar seu perfil de gosto dá a melhor previsão. Dá pra prever só com o perfil atual (mais barato). Consome seu saldo Anthropic.",
            res.message.match(/Perfil ~[^.]*\.?/)?.[0]?.trim(),
          ]
            .filter(Boolean)
            .join(" "),
          confirmLabel: "Atualizar perfil e prever",
          steps: [
            {
              label: "Destilar perfil de gosto",
              model: predict.model,
              likelyUsd: Math.max(0, res.likelyUsd - predict.likelyUsd),
              etaSeconds: 35,
            },
            { label: "Prever Interesse", model: predict.model, likelyUsd: predict.likelyUsd, etaSeconds: predict.etaSeconds },
          ],
          secondaryAction: {
            label: "Prever com o perfil atual",
            likelyUsd: predict.likelyUsd,
            onSelect: () => {
              runPredictAsTask(workId, "Prevendo Interesse", () =>
                predictInterestWithToast(
                  workId,
                  refresh,
                  { ...opts, acceptStaleProfile: true, confirmCascade: true },
                  confirmCost,
                ),
              )
            },
          },
        })
        if (proceed) {
          // O caminho longo: ~35s destilando o perfil + ~5s prevendo. Sem indicador,
          // o modal fechava e a tela ficava 40s idêntica ao estado anterior — o
          // desfecho aparecia num toast que já não tinha ligação com o clique.
          runPredictAsTask(workId, "Atualizando perfil e prevendo Interesse", () =>
            predictInterestWithToast(workId, refresh, { ...opts, confirmCascade: true }, confirmCost),
          )
        }
        break
      }

      if (res.reason === "over_cap" || res.reason === "pricing_unknown") {
        // Bloqueio real: não dá pra "confirmar e seguir" — é notificação, não decisão.
        toast.error(res.message)
        break
      }

      // Custo previsível (threshold): confirmação simples no modal central.
      const proceed = await confirmCost({
        estimate: {
          likelyUsd: res.likelyUsd,
          upperBoundUsd: res.upperBoundUsd,
          etaSeconds: predict.etaSeconds,
          model: predict.model,
          background: true,
        },
        title: "Prever o Interesse?",
        description: "Consome seu saldo Anthropic.",
        confirmLabel: "Prever",
      })
      if (proceed) {
        runPredictAsTask(workId, "Prevendo Interesse", () =>
          predictInterestWithToast(workId, refresh, { ...opts, confirmCascade: true }, confirmCost),
        )
      }
      break
    }
  }
}
