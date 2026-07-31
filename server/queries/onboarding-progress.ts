import "server-only"

import { createAdminClient } from "@/lib/supabase/admin"
import { getSessionUserId } from "@/server/queries/current-user"

export interface FirstStepsProgress {
  saidTastes: boolean
  broughtList: boolean
  interestMarked: number
  interestGoal: number
  firstSheet: boolean
  profileGenerated: boolean
  ratedCount: number
  /** Todos os passos concluídos — o card da ponte some sozinho. */
  complete: boolean
}

/**
 * Progresso dos "Primeiros passos" (a PONTE do onboarding, decisão do mockup):
 * o card fica no dashboard até a conta sair do estado inicial e some sozinho.
 * Anônimo → null (o card é pessoal; visitante não tem o que completar).
 * Leituras via service role com user_id EXPLÍCITO (padrão de leitura do projeto).
 */
export async function getFirstStepsProgress(): Promise<FirstStepsProgress | null> {
  const userId = await getSessionUserId()
  if (!userId) return null

  const sb = createAdminClient()
  const count = async (q: PromiseLike<{ count: number | null }>) => (await q).count ?? 0

  const [prefs, imports, hearts, sheets, taste, profile, rated] = await Promise.all([
    count(sb.from("user_tag_preferences").select("*", { count: "exact", head: true }).eq("user_id", userId)),
    count(sb.from("imports").select("*", { count: "exact", head: true }).eq("user_id", userId)),
    count(
      sb
        .from("user_work_state")
        .select("*", { count: "exact", head: true })
        .eq("user_id", userId)
        .not("synopsis_quality", "is", null),
    ),
    count(
      sb
        .from("user_work_state")
        .select("*", { count: "exact", head: true })
        .eq("user_id", userId)
        .not("post_story_score", "is", null),
    ),
    count(sb.from("pilot_taste_scores").select("*", { count: "exact", head: true }).eq("user_id", userId)),
    count(
      sb
        .from("taste_profile")
        .select("*", { count: "exact", head: true })
        .eq("user_id", userId)
        .eq("is_current", true),
    ),
    count(
      sb
        .from("user_work_state")
        .select("*", { count: "exact", head: true })
        .eq("user_id", userId)
        .not("user_score", "is", null),
    ),
  ])

  const p: FirstStepsProgress = {
    saidTastes: prefs > 0,
    broughtList: imports > 0,
    interestMarked: hearts,
    interestGoal: 5,
    firstSheet: sheets > 0 || taste > 0,
    profileGenerated: profile > 0,
    ratedCount: rated,
    complete: false,
  }
  p.complete =
    p.saidTastes && p.broughtList && p.interestMarked >= p.interestGoal && p.firstSheet && p.profileGenerated
  return p
}
