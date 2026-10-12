"use server"

import { revalidatePath } from "next/cache"
import { after } from "next/server"
import { parseMixedEdition } from "@/lib/editions/mixed-edition"
import { ensureReadingStateWriter, writeReadingState } from "@/server/queries/user-work-state"
import { markRecalcPending } from "@/server/recalc/queue"
import { recalculateForUser } from "@/server/recalc/user-recalc"

/**
 * Troca EXPLÍCITA da versão que a SUA avaliação de uma obra mixed descreve (o "Alterar" ao lado de
 * "Versão R18"). Mig 216, decisão D1: uma avaliação por obra — trocar a versão troca a da avaliação
 * inteira (nota, nota rápida, pós-leitura, piloto), sem mexer em nota nenhuma.
 *
 * Sem avaliação na obra (ou obra que não é mixed), não há o que trocar: nada é gravado — uma linha só
 * com a versão afirmaria uma avaliação que não existe. A versão de uma avaliação NOVA é a versão ativa
 * na tela, decidida por quem grava a nota (`updateWorkStatus`, `savePilotTaste`).
 *
 * Recálculo: a versão acompanha o RÓTULO no treino (`adult_content` da versão), então trocá-la muda a
 * entrada do treino. Dona → fila global; demais → `recalculateForUser` em `after()`.
 */
export async function setEvaluationEdition(
  workId: string,
  edition: string,
): Promise<{ ok: true; changed: boolean } | { ok: false; error: string }> {
  const gate = await ensureReadingStateWriter()
  if (!gate.ok) return { ok: false, error: gate.error }
  if (!workId) return { ok: false, error: "workId ausente" }
  const chosen = parseMixedEdition(edition)
  if (!chosen) return { ok: false, error: `versão inválida: ${edition}` }

  const write = await writeReadingState(gate.userId, [workId], {}, { kind: "explicit", edition: chosen })
  if (write.error) return { ok: false, error: write.error }
  const changed = (write.readEditionsWritten ?? 0) > 0
  if (!changed) return { ok: true, changed: false }

  if (gate.isOwner) {
    await markRecalcPending("setEvaluationEdition", { changed: ["read_edition"], actorId: gate.userId })
  } else {
    after(async () => {
      try {
        await recalculateForUser(gate.userId)
      } catch (err) {
        console.error("[setEvaluationEdition] recalc do usuário falhou:", err)
      }
    })
  }
  revalidatePath("/catalog/[id]", "page")
  return { ok: true, changed: true }
}
