import "server-only"
import { revalidatePath, revalidateTag } from "next/cache"
import { createAdminClient } from "@/lib/supabase/admin"
import { ensureAdmin } from "@/server/queries/current-user"
import { SELECTABLE_EXTERNAL_SOURCES } from "@/lib/external/source-order"
import { sourceLabel } from "@/lib/external/source-labels"
import type { ExternalSourceId } from "@/lib/external/types"

/**
 * "Esta obra não existe nesta fonte" — o marcador da migration 038
 * (`is_rejected=true` + `external_id` NULL).
 *
 * 🔴 **É a única coisa que TIRA uma obra da fila de Fontes sem achar um vínculo**, e
 * por isso é o que decide se a fila zera algum dia: das 1.424 lacunas do catálogo, a
 * maioria se fecha declarando ausência, não achando link.
 *
 * 🔴 **Dono ÚNICO, e não é generalização gratuita.** O `markComixAbsent` fazia
 * exatamente isto com a string `"comix"` fixa; a fila nova precisava do mesmo para as
 * outras oito fontes. Duas cópias divergiriam na guarda abaixo — que é a parte que
 * evita perder dado — então o da Comix passou a delegar para cá.
 *
 * 🔴 **A guarda não é paranoia: sem ela o upsert APAGA um vínculo válido.** O
 * `onConflict: "work_id,source"` sobrescreveria um `external_id` ativo com NULL. A UI
 * só oferece a ação em obra com lacuna, mas uma lista aberta há minutos pode estar
 * defasada (o vínculo pode ter entrado em background, pelo resolve resiliente) — e
 * `"use server"` é endpoint público, então confiar no cliente aqui custa um hid.
 * Nesse caso a operação FALHA em vez de apagar.
 */
export async function markSourceAbsent(
  workId: string,
  source: ExternalSourceId,
): Promise<{ ok: boolean; error?: string }> {
  const res = await markSourcesAbsent([workId], source)
  if (res.error) return { ok: false, error: res.error }
  if (res.skipped > 0) {
    return {
      ok: false,
      error: `Esta obra já tem um vínculo de ${sourceLabel(source)} — recarregue a lista.`,
    }
  }
  return { ok: true }
}

export interface MarkAbsentResult {
  /** Quantas passaram a valer "não existe nesta fonte". */
  marked: number
  /** Quantas foram PULADAS por já terem vínculo ativo (a guarda). */
  skipped: number
  error?: string
}

/**
 * Versão em LOTE, para a aba "Fontes": declara ausência de várias obras numa fonte só.
 *
 * ⚠️ **A fonte vem do chip do mapa, nunca implícita.** Declarar "não existe" sem dizer
 * ONDE é uma afirmação sem sujeito — e como a UI só habilita a ação com um chip de
 * fonte ativo, o lote nunca fica ambíguo sobre o que está sendo afirmado.
 *
 * 🔴 **Isto grava a declaração de uma PESSOA, e é de propósito que não haja varredura
 * automática por trás.** Medido em 2026-08-15 contra verdade conhecida (30 obras que
 * comprovadamente estão no mangago): uma varredura por título com o limiar de aceite
 * (0,72) deixaria **7% delas abaixo do corte** — em 175 obras seriam ~12 declarações
 * FALSAS de "não existe", que somem da fila para sempre e ninguém revisita. As duas que
 * falharam na amostra não eram salváveis por variantes (0,00 e 0,50 mesmo com
 * `original_title` e alternativos). Automatizar a gravação aqui é a família "erro que
 * produz resultado".
 */
export async function markSourcesAbsent(
  workIds: string[],
  source: ExternalSourceId,
): Promise<MarkAbsentResult> {
  const gate = await ensureAdmin()
  if (!gate.ok) return { marked: 0, skipped: 0, error: gate.error }
  if (!(SELECTABLE_EXTERNAL_SOURCES as readonly string[]).includes(source)) {
    return { marked: 0, skipped: 0, error: "Fonte inválida." }
  }
  const ids = [...new Set(workIds.filter(Boolean))]
  if (ids.length === 0) return { marked: 0, skipped: 0, error: "Nenhuma obra selecionada." }

  const supabase = createAdminClient()

  // A guarda: quem já tem vínculo ATIVO nesta fonte fica de fora do upsert.
  const { data: existing, error: readError } = await supabase
    .from("work_external_ids")
    .select("work_id, external_id, is_rejected")
    .eq("source", source)
    .in("work_id", ids)
  if (readError) return { marked: 0, skipped: 0, error: readError.message }

  const comVinculo = new Set(
    (existing ?? [])
      .filter((r) => r.external_id && r.is_rejected !== true)
      .map((r) => r.work_id as string),
  )
  const alvo = ids.filter((id) => !comVinculo.has(id))
  if (alvo.length === 0) return { marked: 0, skipped: comVinculo.size }

  const { error } = await supabase.from("work_external_ids").upsert(
    alvo.map((work_id) => ({ work_id, source, external_id: null, is_rejected: true })),
    { onConflict: "work_id,source" },
  )
  if (error) return { marked: 0, skipped: comVinculo.size, error: error.message }

  revalidatePath("/curation/works")
  revalidatePath("/curation/settings")
  revalidatePath("/catalog")
  // O contador da aba é cacheado por esta tag — sem isto o número só cairia em 60s,
  // e a lista já teria encolhido: as duas discordariam na mesma tela.
  revalidateTag("ai-eval-tab-counts", "max")
  return { marked: alvo.length, skipped: comVinculo.size }
}

/**
 * Desfaz a declaração de ausência — a obra volta a ser lacuna.
 *
 * ⚠️ O filtro `external_id IS NULL AND is_rejected = true` garante que só o MARCADOR
 * some, nunca um vínculo válido (defesa contra chamar na obra errada).
 */
export async function unmarkSourceAbsent(
  workId: string,
  source: ExternalSourceId,
): Promise<{ ok: boolean; error?: string }> {
  const gate = await ensureAdmin()
  if (!gate.ok) return { ok: false, error: gate.error }
  if (!workId) return { ok: false, error: "Obra inválida." }
  const supabase = createAdminClient()
  const { error } = await supabase
    .from("work_external_ids")
    .delete()
    .eq("work_id", workId)
    .eq("source", source)
    .is("external_id", null)
    .eq("is_rejected", true)
  if (error) return { ok: false, error: error.message }
  revalidatePath("/curation/works")
  revalidatePath("/curation/settings")
  revalidatePath("/catalog")
  revalidateTag("ai-eval-tab-counts", "max")
  return { ok: true }
}
