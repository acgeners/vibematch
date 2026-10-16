"use server"

import { revalidatePath } from "next/cache"
import { createAdminClient } from "@/lib/supabase/admin"
import { ensureAdmin } from "@/server/queries/current-user"
import { markRecalcPending } from "@/server/recalc/queue"
import { reconcileStructuralInferenceForWork } from "@/server/editions/structural-inference-sync"
import {
  describeRevertTarget,
  editionCurationSchema,
  planEditionCuration,
  planRevertEditionCuration,
} from "@/lib/editions/edition-curation"
import type {
  CuratedEditionState,
  CuratedScoreRow,
  CurrentEditionCuration,
  CurrentEditionScore,
  EditionCurationInput,
  EditionDecidedBy,
} from "@/lib/editions/edition-curation"
import type { EditionScoreSource, MixedEdition } from "@/lib/editions/mixed-edition"

/**
 * "Edições da obra" — a curadoria declara o estado de edição (`work_edition_state`) e, numa obra
 * `mixed`, a nota de conteúdo adulto de cada edição (`work_edition_scores`). A decisão do que gravar
 * é de `planEditionCuration` / `planRevertEditionCuration` (puras); aqui só se lê, executa e marca o
 * recálculo.
 *
 * 🔴 `works.adult_override` NÃO é tocado: ele é o "Marcar como 18+" e vence o estado no gate. Dizer
 * que a obra TEM versão R18 é este estado — usar o override para isso esconde a obra inteira.
 */

export interface WorkEditionCuration extends CurrentEditionCuration {
  decidedBy: EditionDecidedBy | null
  basis: string | null
  decidedAt: string | null
  /** O "Marcar como 18+". Ligado, vence o estado de edição no gate (a tela avisa). */
  adultOverride: boolean | null
  /** Para onde "Remover decisão da curadoria" volta — null quando a decisão não é da curadoria. */
  revertTarget: string | null
  /** A remoção é possível (há decisão da curadoria E se sabe o estado de antes). */
  canRevert: boolean
}

type Admin = ReturnType<typeof createAdminClient>
type Result<T> = { data: T } | { error: string }

async function readCuration(supabase: Admin, workId: string): Promise<WorkEditionCuration> {
  const [stateRes, scoresRes, workRes] = await Promise.all([
    supabase
      .from("work_edition_state")
      .select("state, r18_extra_chapters, basis, decided_by, decided_at, evidence")
      .eq("work_id", workId)
      .maybeSingle(),
    supabase
      .from("work_edition_scores")
      .select("edition, criterion_slug, score, source, evidence, decided_by")
      .eq("work_id", workId)
      .eq("criterion_slug", "adult_content"),
    supabase.from("works").select("adult_override").eq("id", workId).maybeSingle(),
  ])
  // Erro LANÇA: "sem estado" e "não consegui ler" levariam a gravar por cima de uma decisão existente.
  if (stateRes.error) throw new Error(`work_edition_state: ${stateRes.error.message}`)
  if (scoresRes.error) throw new Error(`work_edition_scores: ${scoresRes.error.message}`)
  if (workRes.error) throw new Error(`works: ${workRes.error.message}`)
  if (!workRes.data) throw new Error("Obra não encontrada.")

  const st = stateRes.data as {
    state: CuratedEditionState
    r18_extra_chapters: boolean
    basis: string
    decided_by: EditionDecidedBy
    decided_at: string | null
    evidence: Record<string, unknown> | null
  } | null
  const scores: Partial<Record<MixedEdition, CurrentEditionScore>> = {}
  for (const r of (scoresRes.data ?? []) as Array<{
    edition: MixedEdition
    score: unknown
    source: EditionScoreSource
    evidence: Record<string, unknown> | null
    decided_by: CurrentEditionScore["decidedBy"]
  }>) {
    // numeric do PostgREST volta como STRING — sem Number(), "9.0" !== 9 e todo salvar "mudaria".
    scores[r.edition] = {
      score: r.score == null ? null : Number(r.score),
      source: r.source,
      evidence: r.evidence ?? null,
      decidedBy: r.decided_by ?? null,
    }
  }
  const base: CurrentEditionCuration = {
    state: st?.state ?? null,
    r18ExtraChapters: st?.r18_extra_chapters ?? false,
    evidence: st?.evidence ?? null,
    basis: st?.basis ?? null,
    decidedBy: st?.decided_by ?? null,
    decidedAt: st?.decided_at ?? null,
    scores,
  }
  const revert = planRevertEditionCuration(base, new Date().toISOString())
  return {
    ...base,
    basis: base.basis ?? null,
    decidedBy: base.decidedBy ?? null,
    decidedAt: base.decidedAt ?? null,
    adultOverride: (workRes.data as { adult_override: boolean | null }).adult_override ?? null,
    revertTarget: describeRevertTarget(revert),
    canRevert: revert.kind === "apagar" || revert.kind === "restaurar",
  }
}

export async function getWorkEditionCuration(workId: string): Promise<Result<WorkEditionCuration>> {
  const gate = await ensureAdmin()
  if (!gate.ok) return { error: gate.error }
  try {
    return { data: await readCuration(createAdminClient(), workId) }
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) }
  }
}

/**
 * "Não avaliado" sobre uma nota existente. O gatilho da 213 recusa REBAIXAR num UPDATE (e no upsert,
 * que passa pelo mesmo BEFORE UPDATE), e o PostgREST não deixa abrir a exceção
 * (`app.permitir_rebaixar_edicao`) — cada chamada é uma transação separada. Sem função SQL nova, a
 * troca é DELETE … RETURNING + INSERT, com COMPENSAÇÃO: se o INSERT falhar, a linha devolvida pelo
 * DELETE (exatamente a que existia, com autoria, data e evidência) é reinserida.
 *
 * O resíduo, declarado: se a REINSERÇÃO também falhar, a edição fica sem linha. Isso é gritado no log
 * com a linha inteira e devolvido na mensagem — nunca tratado como sucesso.
 */
async function replaceWithNotRated(
  supabase: Admin,
  workId: string,
  row: CuratedScoreRow,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const del = await supabase
    .from("work_edition_scores")
    .delete()
    .eq("work_id", workId)
    .eq("edition", row.edition)
    .eq("criterion_slug", "adult_content")
    .select("*")
  if (del.error) return { ok: false, error: del.error.message }
  const apagada = ((del.data ?? []) as Array<Record<string, unknown>>)[0] ?? null

  const ins = await supabase.from("work_edition_scores").insert({ work_id: workId, ...row })
  if (!ins.error) return { ok: true }

  if (!apagada) return { ok: false, error: ins.error.message }
  // `updated_at` sai: o gatilho da 213 o regrava. `created_at`, autoria e evidência voltam como eram.
  const { updated_at: _u, ...restaurar } = apagada
  void _u
  const back = await supabase.from("work_edition_scores").insert(restaurar)
  if (!back.error) {
    return { ok: false, error: `${ins.error.message} (a nota anterior foi mantida)` }
  }
  console.error(
    `[edition-curation] RESTAURAÇÃO FALHOU work=${workId} edição=${row.edition}: a linha abaixo foi apagada e NÃO voltou —`,
    JSON.stringify(apagada),
    `· insert: ${ins.error.message} · restauração: ${back.error.message}`,
  )
  return {
    ok: false,
    error:
      `ATENÇÃO: a nota anterior (${apagada.score ?? "sem nota"}, ${String(apagada.source)}) foi apagada e não pôde ser restaurada — ` +
      `a versão ficou sem registro. Refaça a decisão. (${ins.error.message} · ${back.error.message})`,
  }
}

export async function saveWorkEditionCuration(
  workId: string,
  input: EditionCurationInput,
): Promise<Result<{ changed: boolean; recalcMarked: boolean }>> {
  const gate = await ensureAdmin()
  if (!gate.ok) return { error: gate.error }
  const parsed = editionCurationSchema.safeParse(input)
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Dados inválidos." }

  const supabase = createAdminClient()
  let current: WorkEditionCuration
  try {
    current = await readCuration(supabase, workId)
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) }
  }

  const plan = planEditionCuration(current, parsed.data, new Date().toISOString())
  if (!plan.state && plan.scoreOps.length === 0) return { data: { changed: false, recalcMarked: false } }

  // O ESTADO primeiro: o gatilho da 213 só aceita nota de edição em obra que JÁ é mixed (lê o
  // espelho `works.edition_state`, que o gatilho da 204 atualiza nesta mesma escrita).
  if (plan.state) {
    const { error } = await supabase
      .from("work_edition_state")
      .upsert({ work_id: workId, ...plan.state }, { onConflict: "work_id" })
    if (error) return { error: `Estado das versões: ${error.message}` }
  }

  const falhas: string[] = []
  // Só conta nota GRAVADA que muda o valor usado na previsão (uma restaurada não muda nada).
  let notaMudouPrevisao = false
  for (const op of plan.scoreOps) {
    if (op.op === "replace") {
      const r = await replaceWithNotRated(supabase, workId, op.row)
      if (r.ok) notaMudouPrevisao ||= op.marksRecalc
      else falhas.push(`${op.edition}: ${r.error}`)
    } else {
      const { error } = await supabase
        .from("work_edition_scores")
        .upsert({ work_id: workId, ...op.row }, { onConflict: "work_id,edition,criterion_slug" })
      if (error) falhas.push(`${op.edition}: ${error.message}`)
      else notaMudouPrevisao ||= op.marksRecalc
    }
  }

  // A inferência ESTRUTURAL acompanha a decisão: trocar estado ou extras pode criar ou retirar a base
  // e o piso inferidos (nunca as notas que a curadoria acabou de gravar — elas são mais fortes).
  const inferencia = await reconcileStructuralInferenceForWork(supabase, workId)

  // Marca só quando a ENTRADA da previsão muda: a obra entrou/saiu de mixed, uma nota gravada
  // trocou o valor que a edição usa, ou a inferência estrutural gravou algo — ou ficou devendo, e
  // aí é a varredura do recálculo que termina o trabalho. Origem, autoria e single↔r18_only↔unknown
  // não marcam.
  const recalcMarked = plan.stateMarksRecalc || notaMudouPrevisao || inferencia.changed || inferencia.failed
  if (recalcMarked) await markRecalcPending("saveWorkEditionCuration", { changed: ["edition_scores"] })
  revalidateWork(workId)

  if (falhas.length > 0) return { error: `Nota por versão não gravada — ${falhas.join(" · ")}` }
  return { data: { changed: true, recalcMarked } }
}

/**
 * "Remover decisão da curadoria": volta ao estado de antes dela (ou à ausência de estado). Uma
 * escrita só — UPDATE ou DELETE —, e as duas exigem que a linha AINDA seja da curadoria: se outra
 * escrita entrou no meio, nada é desfeito por cima dela. Notas por edição e `adult_override` ficam.
 */
export async function revertWorkEditionCuration(
  workId: string,
): Promise<Result<{ changed: boolean; recalcMarked: boolean }>> {
  const gate = await ensureAdmin()
  if (!gate.ok) return { error: gate.error }

  const supabase = createAdminClient()
  let current: WorkEditionCuration
  try {
    current = await readCuration(supabase, workId)
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) }
  }

  const plan = planRevertEditionCuration(current, new Date().toISOString())
  if (plan.kind === "sem_decisao") return { data: { changed: false, recalcMarked: false } }
  if (plan.kind === "sem_registro") return { error: describeRevertTarget(plan) ?? "Não há para onde voltar." }

  const tabela = supabase.from("work_edition_state")
  const write =
    plan.kind === "apagar"
      ? tabela.delete().eq("work_id", workId).eq("decided_by", "curator").select("work_id")
      : tabela.update(plan.row).eq("work_id", workId).eq("decided_by", "curator").select("work_id")
  const { data, error } = await write
  if (error) return { error: `Estado das versões: ${error.message}` }
  if (!data || data.length === 0) return { error: "A decisão sobre as versões mudou enquanto o diálogo estava aberto. Reabra e confira." }

  if (plan.kind === "apagar") {
    // Sem estado anterior, "sem decisão" é ausência de linha — o registro da decisão vai para o log.
    console.info(`[edition-curation] decisão da curadoria removida work=${workId}:`, JSON.stringify({ state: current.state, evidence: current.evidence }))
  }
  const inferencia = await reconcileStructuralInferenceForWork(supabase, workId)
  const recalcMarked = plan.marksRecalc || inferencia.changed || inferencia.failed
  if (recalcMarked) await markRecalcPending("revertWorkEditionCuration", { changed: ["edition_scores"] })
  revalidateWork(workId)
  return { data: { changed: true, recalcMarked } }
}

function revalidateWork(workId: string) {
  revalidatePath(`/catalog/${workId}`)
  revalidatePath("/catalog")
  revalidatePath("/")
}
