import "server-only"
import { cache } from "react"
import { createAdminClient } from "@/lib/supabase/admin"
import { getOwnerUserId, getSessionUserId } from "./current-user"
import { COVERAGE_CATALOGO, COVERAGE_PESSOAL, type CoverageKey } from "@/lib/scores/glossary"

/**
 * Em quantas obras cada número do dicionário existe HOJE — contado ao vivo.
 *
 * 🔴 Por que ao vivo e não escrito na página: "o Veredito existe em 71% do catálogo" é a
 * informação mais útil do dicionário (ela responde "por que essa coluna está vazia?"), e
 * é exatamente o tipo de número que envelhece sem nada acusar. Número em prosa não tem
 * como denunciar a própria defasagem — o CLAUDE.md tem uma seção inteira sobre isso.
 *
 * 🔴 **Toda contagem é `count: "exact", head: true`** — o servidor conta e não devolve
 * linha nenhuma. Somar no cliente cairia no corte silencioso de 1000 linhas do PostgREST
 * com o catálogo já em ~1.000 obras: o número sairia plausível e errado, que é a pior
 * forma do bug. E `head: true` mantém o egress em zero, o que é o que permite isto rodar
 * numa página pública.
 *
 * 🔴 **As contagens PESSOAIS não podem ser servidas a quem não é o dono.** `calculated_scores`
 * não tem `user_id`: a Nota Prevista, o Alinhamento e o Veredito que moram lá são do DONO.
 * Contá-los para um visitante publicaria o gosto de uma pessoa com cara de estatística do
 * catálogo — a mesma falha que `getScoresReader` documenta, e que já vazou o perfil de
 * gosto dele em `/dashboard`. Aqui a bifurcação é a MESMA que a de lá, de propósito:
 *
 *   sem sessão  → nenhuma contagem pessoal (a página diz que precisa entrar)
 *   dono        → `calculated_scores`
 *   outra pessoa→ `user_calculated_scores` filtrada pelo `user_id` DELA
 *
 * ⚠️ As contagens de CATÁLOGO valem para qualquer um: são fato da obra (quantas têm
 * atributos de IA, nota externa, ano, capítulos, tags), o mesmo que qualquer visitante já
 * lê no /catalog.
 */
export type CoverageMap = Partial<Record<CoverageKey, number>>

export interface ScoreCoverage {
  /** O denominador de tudo: obras ativas no catálogo. */
  total: number
  counts: CoverageMap
  /** `false` quando não há sessão — a página omite as linhas pessoais em vez de mentir. */
  hasPersonal: boolean
}

/** Conta sem trazer linha. `null` em erro, para a página degradar em vez de estourar. */
async function contar(
  build: () => PromiseLike<{ count: number | null; error: unknown }>,
): Promise<number | null> {
  const { count, error } = await build()
  if (error) return null
  return count ?? null
}

export const getScoreCoverage = cache(async (): Promise<ScoreCoverage> => {
  const supabase = createAdminClient()
  const [sessionId, ownerId] = await Promise.all([getSessionUserId(), getOwnerUserId()])

  const ativas = () => supabase.from("works").select("id", { count: "exact", head: true }).eq("is_archived", false)

  const catalogo: Array<[(typeof COVERAGE_CATALOGO)[number], Promise<number | null>]> = [
    ["obras", contar(ativas)],
    [
      // `!inner` conta as obras que têm ao menos um atributo — no PostgREST o embed não
      // multiplica a linha pai. Medido em 19/08/2026: "ao menos 1" e "os 9 completos" dão
      // o MESMO número (975 de 978), porque a avaliação grava os nove de uma vez. Se um dia
      // divergirem, este número passa a ser o de "tem alguma nota de IA" — que é o que o
      // rótulo na tela diz, e não "está completa".
      "nove_atributos",
      contar(() =>
        supabase
          .from("works")
          .select("id, category_scores!inner(work_id)", { count: "exact", head: true })
          .eq("is_archived", false),
      ),
    ],
    [
      "media_externa",
      contar(() =>
        supabase
          .from("works")
          .select("id, platform_ratings!inner(work_id)", { count: "exact", head: true })
          .eq("is_archived", false),
      ),
    ],
    ["ano", contar(() => ativas().not("year", "is", null))],
    ["ano_fim", contar(() => ativas().not("year_end", "is", null))],
    ["capitulos", contar(() => ativas().not("total_chapters", "is", null))],
    [
      "tags",
      contar(() =>
        supabase
          .from("works")
          .select("id, work_tags!inner(work_id)", { count: "exact", head: true })
          .eq("is_archived", false),
      ),
    ],
    [
      // ⚠️ `not null` não basta: 102 obras têm o título original como string VAZIA, e elas
      // caem no "outro" do país de origem igual às sem título. Contá-las como preenchidas
      // infla a cobertura da feature `Origin` em 10 pontos.
      "titulo_original",
      contar(() => ativas().not("original_title", "is", null).neq("original_title", "")),
    ],
  ]

  const counts: CoverageMap = {}
  const resolvidos = await Promise.all(catalogo.map(([, p]) => p))
  catalogo.forEach(([key], i) => {
    const n = resolvidos[i]
    if (n != null) counts[key] = n
  })

  const total = counts.obras ?? 0

  if (!sessionId) return { total, counts, hasPersonal: false }

  const isOwner = sessionId === ownerId

  // 🔴 O `works!inner` + `is_archived` não é enfeite: sem ele a conta ULTRAPASSA o total.
  // `calculated_scores`, `user_calculated_scores` e `user_work_state` guardam linha de obra
  // ARQUIVADA (e de obra que saiu do catálogo), enquanto o denominador é `works` ativas.
  // Medido no clone local em 19/08/2026, com 978 ativas e 10 arquivadas:
  //
  //   | contagem            | sem filtro | com filtro |
  //   |---------------------|-----------:|-----------:|
  //   | Nota Prevista       |    **981** |        975 |
  //   | seu Interesse       |    **886** |        883 |
  //
  // Ou seja a tela imprimiria "existe em 981 de 978 · 100%" para quem estivesse logado —
  // um número impossível, na página que existe justamente para explicar os números. O ramo
  // sem sessão nunca mostrou isso, e foi por isso que passou: a verificação inicial rodou
  // só como visitante.
  const somenteAtivas = "work_id, works!inner(id)"

  const scores = () =>
    isOwner
      ? supabase
          .from("calculated_scores")
          .select(somenteAtivas, { count: "exact", head: true })
          .eq("works.is_archived", false)
      : supabase
          .from("user_calculated_scores")
          .select(somenteAtivas, { count: "exact", head: true })
          .eq("user_id", sessionId)
          .eq("works.is_archived", false)

  const estado = () =>
    supabase
      .from("user_work_state")
      .select(somenteAtivas, { count: "exact", head: true })
      .eq("user_id", sessionId)
      .eq("works.is_archived", false)

  const pessoal: Array<[(typeof COVERAGE_PESSOAL)[number], Promise<number | null>]> = [
    ["nota_prevista", contar(() => scores().not("expected_score", "is", null))],
    ["alinhamento", contar(() => scores().not("personal_fit_percentile", "is", null))],
    ["veredito", contar(() => scores().not("alignment_score", "is", null))],
    ["sua_nota", contar(() => estado().not("user_score", "is", null))],
    ["seu_interesse", contar(() => estado().not("synopsis_quality", "is", null))],
  ]

  const resolvidosP = await Promise.all(pessoal.map(([, p]) => p))
  pessoal.forEach(([key], i) => {
    const n = resolvidosP[i]
    if (n != null) counts[key] = n
  })

  return { total, counts, hasPersonal: true }
})
