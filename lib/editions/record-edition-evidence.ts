import "server-only"
import type { createAdminClient } from "@/lib/supabase/admin"
import { decideAutoEditionState, type CurrentEditionState } from "./edition-evidence"
import { readEditionEvidence } from "./edition-evidence-cache"

type Admin = ReturnType<typeof createAdminClient>

export type RecordEditionOutcome =
  | "sem_evidencia_em_cache"
  | "mantido"
  | "inserido"
  | "atualizado"
  | "erro"

/**
 * Grava, em `work_edition_state` (mig 204), o que o MangaUpdates disse sobre as edições da obra —
 * chamado quando o SAVE confirma o vínculo com o MU (`upsertWorkExternalIds`).
 *
 * A régua de quem pode mudar o quê é `decideAutoEditionState` (pura): a ingestão só preenche estado
 * ausente ou sobe um `unknown` automático; decisão de auditoria, curadoria e o legado da mig 199
 * nunca são tocados, e `r18_only` nunca sai daqui. `works.r19_edition`, a tag "R19 disponível" e o
 * gate saem do estado por gatilho — este helper não escreve em `works` nem em `work_tags`.
 *
 * Best-effort, como o `recomputeAdultAuto`: nunca derruba o save. Mas NÃO é calado — toda saída
 * loga com o prefixo `[edition-evidence]`, inclusive "não havia evidência", porque "nada gravado"
 * e "nada a gravar" são indistinguíveis sem isso.
 */
export async function recordMangaUpdatesEditionEvidence(
  supabase: Admin,
  workId: string,
  muId: string,
): Promise<RecordEditionOutcome> {
  const cached = readEditionEvidence("mangaupdates", muId)
  if (!cached) {
    console.info(`[edition-evidence] work=${workId} mu=${muId}: sem evidência em cache (nada gravado)`)
    return "sem_evidencia_em_cache"
  }
  const { evidence, fetchedAt } = cached
  try {
    const { data: row, error: readError } = await supabase
      .from("work_edition_state")
      .select("state, decided_by")
      .eq("work_id", workId)
      .maybeSingle()
    if (readError) throw new Error(readError.message)
    const current: CurrentEditionState | null = row
      ? {
          state: (row as { state: CurrentEditionState["state"] }).state,
          decidedBy: (row as { decided_by: CurrentEditionState["decidedBy"] }).decided_by,
        }
      : null

    const decision = decideAutoEditionState(current, evidence.verdict)
    if (decision.action === "keep") {
      console.info(`[edition-evidence] work=${workId} mu=${muId}: mantido (${decision.why}; veredito ${evidence.verdict})`)
      return "mantido"
    }

    const payload = {
      state: decision.state,
      basis: evidence.basis ?? "mangaupdates_description",
      decided_by: "auto" as const,
      evidence: {
        mangaupdates: {
          series_id: muId,
          verdict: evidence.verdict,
          reason: evidence.reason,
          normal_lines: evidence.normalLines,
          r18_lines: evidence.r18Lines,
          novel_r18_lines: evidence.novelR18Lines,
          categories: evidence.categories,
          notes: evidence.notes,
        },
      },
      evidence_fetched_at: fetchedAt,
    }

    if (decision.action === "insert") {
      // `ignoreDuplicates`: se o gatilho do marcador/da tag criou a linha no meio tempo, ela fica, e
      // a próxima passada decide a subida unknown→mixed. Nunca sobrescreve no escuro.
      const { error } = await supabase
        .from("work_edition_state")
        .upsert({ work_id: workId, ...payload }, { onConflict: "work_id", ignoreDuplicates: true })
      if (error) throw new Error(error.message)
      console.info(`[edition-evidence] work=${workId} mu=${muId}: inserido ${decision.state} (${evidence.reason})`)
      return "inserido"
    }

    // update: só se a linha ainda for o `unknown` automático que a decisão viu.
    const { error } = await supabase
      .from("work_edition_state")
      .update(payload)
      .eq("work_id", workId)
      .eq("decided_by", "auto")
      .eq("state", "unknown")
    if (error) throw new Error(error.message)
    console.info(`[edition-evidence] work=${workId} mu=${muId}: unknown → ${decision.state} (${evidence.reason})`)
    return "atualizado"
  } catch (err) {
    console.error(`[edition-evidence] work=${workId} mu=${muId}: falhou:`, err instanceof Error ? err.message : err)
    return "erro"
  }
}
