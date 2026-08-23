import "server-only"
import { createAdminClient } from "@/lib/supabase/admin"
import { coverCandidates } from "@/lib/work-derived"
import { HIATUS_SELECT_COLUMNS, hiatusFieldsFromRow } from "@/lib/works/hiatus-display"
import type { HiatusFields } from "@/lib/works/hiatus-display"
import type { HiatusKind } from "@/lib/external/hiatus-kind"

export type HeroWork = HiatusFields & {
  title: string
  coverUrls: string[]
  nota: number | null
  publicationStatusId: number | null
}

/**
 * Capas reais pro painel do login/signup — as melhores obras por MÉDIA DAS PLATAFORMAS que
 * tenham capa. Over-fetch + filtra pelas que têm capa. Falha silenciosa (retorna []) — o hero
 * degrada pro fundo sem cascata, nunca derruba a página.
 *
 * ⚠️ Ordenava por `expected_score` e lia `works_owner` (a view do DONO), trazendo até o
 * `personal_status_id` dele — numa tela que roda DESLOGADA. Era o mesmo padrão do eixo público
 * corrigido em `getScoresReader`: preferência de uma pessoa exibida como se fosse a avaliação
 * do acervo, aqui na primeira tela que um visitante vê. Agora usa `works` e um campo de
 * catálogo; o status pessoal sai do tipo, porque não há "pessoal" sem sessão.
 */
export async function getAuthHeroWorks(limit = 21): Promise<HeroWork[]> {
  const supabase = createAdminClient()
  // `works` (não `works_owner`): a view é a fonte do DONO. Numa tela deslogada, nenhuma
  // coluna pessoal deve entrar — nem de enfeite.
  const { data, error } = await supabase
    .from("calculated_scores")
    .select(
      `platform_avg, works!inner(title, is_archived, publication_status_id, ${HIATUS_SELECT_COLUMNS}, work_covers(url, is_primary, position))`,
    )
    .not("platform_avg", "is", null)
    .eq("works.is_archived", false)
    .order("platform_avg", { ascending: false })
    .limit(90)

  if (error) return []

  const rows = (data ?? []) as unknown as Array<{
    platform_avg: number | null
    works: {
      title: string
      publication_status_id: number | null
      hiatus_kind?: HiatusKind | null
      hiatus_kind_confidence?: "high" | "low" | null
      publication_status_note?: string | null
      work_covers?: { url: string; is_primary: boolean }[] | null
    }
  }>

  const out: HeroWork[] = []
  for (const row of rows) {
    const coverUrls = coverCandidates(row.works.work_covers)
    if (coverUrls.length === 0) continue
    out.push({
      title: row.works.title,
      coverUrls,
      nota: row.platform_avg,
      publicationStatusId: row.works.publication_status_id,
      ...hiatusFieldsFromRow(row.works),
    })
    if (out.length >= limit) break
  }
  return out
}

/**
 * Uma métrica do acervo: `number` quando a query RESPONDEU — e aí `0` é um dado legítimo do
 * catálogo — ou `null` quando ela FALHOU.
 *
 * 🔴 O tipo era `number` e o corpo fazia `count ?? 0`, dando a "banco fora" e "catálogo vazio"
 * a MESMA representação. Medido em 2026-08-23 injetando uma service key inválida contra o build
 * de produção: a home respondia HTTP 200 anunciando "0 OBRAS" como fato do acervo — sem erro na
 * tela, sem UMA linha de log, e com o smoke da `/` aprovando, porque o marcador dele
 * (`data-slot=`) é satisfeito pela casca vazia. É a família "erro que produz resultado", na
 * primeira tela que um visitante vê.
 */
export type SiteStatValue = number | null

export type SiteStats = {
  works: SiteStatValue
  criteria: SiteStatValue
  reviews: SiteStatValue
  sources: SiteStatValue
}

/**
 * Converte UMA contagem em métrica, e é o único lugar que decide o que `null` significa.
 *
 * ⚠️ `count` nulo SEM erro é "respondeu e não sei quantos" — vira `null`, nunca 0. O `?? 0`
 * antigo achatava os três casos (erro, indefinido e zero real) num número que a tela afirma.
 */
function contagemDaMetrica(
  tabela: string,
  res: { count: number | null; error: { message: string } | null },
): SiteStatValue {
  if (res.error) {
    // Sem isto a falha da home era INVISÍVEL: nenhuma linha de log saía deste caminho.
    // Só nome de tabela e mensagem do PostgREST — nada de chave, token, e-mail ou id.
    console.error(`[site-stats] contagem de ${tabela} falhou: ${res.error.message}`)
    return null
  }
  return res.count ?? null
}

/**
 * Números reais do catálogo pra vitrine da home e do login/signup — contagens (head:true, sem
 * trazer linhas, egress ~zero).
 *
 * Falha POR MÉTRICA: uma tabela indisponível vira `null` e as outras três continuam valendo —
 * derrubar a home inteira por causa de uma contagem seria trocar um defeito por outro maior.
 * Quem decide o que mostrar é o consumidor; o que esta função garante é que ele consegue
 * DISTINGUIR ausência de dado de dado ausente.
 *
 * ⚠️ `Promise.all` e não `allSettled` porque foi medido: com o backend inalcançável
 * (conexão recusada) o supabase-js **resolve** com `{ count: null, error: "fetch failed" }` em
 * vez de rejeitar. Não há promise para estourar aqui, e `allSettled` seria complexidade
 * defendendo um caso que não existe.
 */
export async function getSiteStats(): Promise<SiteStats> {
  const supabase = createAdminClient()
  const [w, c, r, s] = await Promise.all([
    supabase.from("works").select("*", { count: "exact", head: true }).eq("is_archived", false),
    supabase.from("category_scores").select("*", { count: "exact", head: true }),
    supabase.from("work_reviews").select("*", { count: "exact", head: true }),
    supabase.from("source").select("*", { count: "exact", head: true }),
  ])
  return {
    works: contagemDaMetrica("works", w),
    criteria: contagemDaMetrica("category_scores", c),
    reviews: contagemDaMetrica("work_reviews", r),
    sources: contagemDaMetrica("source", s),
  }
}
