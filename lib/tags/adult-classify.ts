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
 * 🔴 Segundo motivo desde 2026-11-15: **classificação etária 18 da obra** (`work_age_rating`, linha
 * `obra`, `faixa = 18`; migration 223) liga com `adult_reason = 'official_rating'`. "Ocultar 18+"
 * esconde idade 18 E conteúdo explícito por esta MESMA coluna — nenhum consumidor do gate muda. A tag
 * forte tem precedência no motivo (é a evidência mais específica).
 *
 * Quem a regra NÃO toca:
 *   · motivo `ai_review` (2ª opinião de IA com evidência explícita nas reviews) — evidência
 *     independente das tags; só um humano (override) desfaz;
 *   · o override humano (`adult_override`) e o estado de edição: quem decide o `is_adult` final é a
 *     coluna gerada `COALESCE(adult_override, CASE edition_state … ELSE adult_auto END)`.
 */
export type AdultAutoDecision = { adult_auto: boolean; adult_reason: string | null } | null

/** Motivos que ESTA régua liga — e portanto desliga quando o sinal some. `ai_review` não está aqui. */
const MOTIVOS_DA_REGUA = new Set(["tag_explicit", "tag_soft_score", "official_rating"])

export function decideAdultAuto(
  atual: { adult_auto: boolean; adult_reason: string | null },
  temForte: boolean,
  temClassificacao18 = false,
): AdultAutoDecision {
  if (atual.adult_reason === "ai_review") return null
  if (temForte) {
    return atual.adult_auto && atual.adult_reason === "tag_explicit" ? null : { adult_auto: true, adult_reason: "tag_explicit" }
  }
  if (temClassificacao18) {
    return atual.adult_auto && atual.adult_reason === "official_rating" ? null : { adult_auto: true, adult_reason: "official_rating" }
  }
  // Sem sinal: desliga o que esta régua tinha ligado (inclusive o legado 'tag_soft_score').
  if (atual.adult_auto && atual.adult_reason != null && MOTIVOS_DA_REGUA.has(atual.adult_reason)) {
    return { adult_auto: false, adult_reason: null }
  }
  return null
}

/**
 * Lê o estado atual e as duas entradas da régua (tag forte, classificação 18) e devolve a decisão.
 * LANÇA em erro de leitura — sem isso uma falha transitória viraria "sem sinal" e desligaria o gate.
 */
export async function planAdultAuto(supabase: Admin, workId: string): Promise<AdultAutoDecision> {
  const { data: work, error: wErr } = await supabase
    .from("works")
    .select("adult_auto, adult_reason")
    .eq("id", workId)
    .maybeSingle()
  if (wErr) throw new Error(`works: ${wErr.message}`)
  if (!work) return null

  const { data: wtRows, error: tErr } = await supabase
    .from("work_tags")
    .select("tags(adult_indicator_strong)")
    .eq("work_id", workId)
  if (tErr) throw new Error(`work_tags: ${tErr.message}`)
  const temForte = ((wtRows ?? []) as unknown as Array<{ tags: { adult_indicator_strong: boolean } | null }>)
    .some((r) => r.tags?.adult_indicator_strong === true)

  const { data: rating, error: rErr } = await supabase
    .from("work_age_rating")
    .select("faixa")
    .eq("work_id", workId)
    .eq("versao", "obra")
    .maybeSingle()
  if (rErr) throw new Error(`work_age_rating: ${rErr.message}`)
  const temClassificacao18 = Number((rating as { faixa?: unknown } | null)?.faixa) === 18

  return decideAdultAuto(work as { adult_auto: boolean; adult_reason: string | null }, temForte, temClassificacao18)
}

/**
 * Aplica `decideAdultAuto` a UMA obra. Chame depois de MUDAR A COMPOSIÇÃO DE TAGS da obra
 * (formulário, "Atualizar dados", inferência, tag nova enriquecida, flag de tag alterada) ou a
 * classificação etária dela. A nota não entra: mudar a nota não muda o gate.
 *
 * Best-effort: loga e volta sem gravar se algo falhar — nunca quebra o fluxo de salvar tags.
 */
export async function recomputeAdultAuto(supabase: Admin, workId: string): Promise<void> {
  try {
    const d = await planAdultAuto(supabase, workId)
    if (!d) return
    const { error } = await supabase.from("works").update(d).eq("id", workId)
    if (error) throw new Error(error.message)
  } catch (err) {
    console.warn("[recomputeAdultAuto] falhou:", err instanceof Error ? err.message : err)
  }
}
