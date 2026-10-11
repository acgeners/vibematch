import "server-only"
import type { createAdminClient } from "@/lib/supabase/admin"

type Admin = ReturnType<typeof createAdminClient>

/**
 * A régua do gate 18+ automático (`works.adult_auto`) — dono ÚNICO em TypeScript.
 *
 * 🔴 Regra desde 2026-10-10 (decisão da Ana): **liga quando a obra tem ≥ 1 tag FORTE**
 * (`tags.adult_indicator_strong`), e só isso. O gate protege contra conteúdo sexual explicitamente
 * mostrado/descrito; uma tag forte é a que, sozinha, afirma isso.
 *
 * O que NÃO liga mais, de propósito:
 *   · tag fraca (`adult_indicator` sem `_strong`), em NENHUMA combinação — inclusive com a nota
 *     `adult_content` alta. A regra antiga ("tag fraca + nota ≥ 7") foi removida: gate e nota são
 *     dimensões diferentes, a tag genérica não prova explicitness mostrada, e a nota tem legado e
 *     pisos que a inflam. Tag fraca segue existindo como sinal de auditoria/revisão;
 *   · a nota sozinha (nunca ligou).
 *
 * Quem a regra NÃO toca:
 *   · motivo `ai_review` (2ª opinião de IA com evidência explícita nas reviews) — evidência
 *     independente das tags; só um humano (override) desfaz;
 *   · o override humano (`adult_override`) e o estado de edição: quem decide o `is_adult` final é a
 *     coluna gerada `COALESCE(adult_override, CASE edition_state … ELSE adult_auto END)`.
 */
export type AdultAutoDecision = { adult_auto: boolean; adult_reason: string | null } | null

export function decideAdultAuto(atual: { adult_auto: boolean; adult_reason: string | null }, temForte: boolean): AdultAutoDecision {
  if (atual.adult_reason === "ai_review") return null
  if (temForte) {
    return atual.adult_auto && atual.adult_reason === "tag_explicit" ? null : { adult_auto: true, adult_reason: "tag_explicit" }
  }
  // Sem tag forte: desliga o que a régua de TAGS tinha ligado (inclusive o legado 'tag_soft_score').
  if (atual.adult_auto && (atual.adult_reason === "tag_explicit" || atual.adult_reason === "tag_soft_score")) {
    return { adult_auto: false, adult_reason: null }
  }
  return null
}

/**
 * Aplica `decideAdultAuto` a UMA obra, lendo as tags atuais. Chame depois de MUDAR A COMPOSIÇÃO DE
 * TAGS da obra (formulário, "Atualizar dados", inferência, tag nova enriquecida, flag de tag
 * alterada). A nota não entra: mudar a nota não muda o gate.
 *
 * Best-effort: loga e volta em silêncio se algo falhar — nunca quebra o fluxo de salvar tags.
 */
export async function recomputeAdultAuto(supabase: Admin, workId: string): Promise<void> {
  try {
    const { data: work } = await supabase
      .from("works")
      .select("adult_auto, adult_reason")
      .eq("id", workId)
      .maybeSingle()
    if (!work) return

    const { data: wtRows } = await supabase
      .from("work_tags")
      .select("tags(adult_indicator_strong)")
      .eq("work_id", workId)
    const temForte = ((wtRows ?? []) as unknown as Array<{ tags: { adult_indicator_strong: boolean } | null }>)
      .some((r) => r.tags?.adult_indicator_strong === true)

    const d = decideAdultAuto(work as { adult_auto: boolean; adult_reason: string | null }, temForte)
    if (!d) return
    await supabase.from("works").update(d).eq("id", workId)
  } catch (err) {
    console.warn("[recomputeAdultAuto] falhou:", err instanceof Error ? err.message : err)
  }
}
