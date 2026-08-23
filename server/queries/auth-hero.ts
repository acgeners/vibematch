import "server-only"
import { createAdminClient } from "@/lib/supabase/admin"
import { reportHandledServerError } from "@/lib/observability/handled-error"
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
/**
 * `HeroWork[]` = a consulta respondeu (`[]` é vazio legítimo); `null` = ela FALHOU.
 *
 * 🔴 Antes o erro virava `[]`, o mesmo valor de "não há obra com capa" — e o consumidor não
 * tinha como agir diferente. ⚠️ A parede que ele alimenta é `aria-hidden` e puramente
 * decorativa (fica ATRÁS do formulário de login), então o tratamento proporcional é
 * distinguir no CONTRATO e registrar no log, sem aviso na tela: anunciar "não carreguei as
 * capas de fundo" a quem está tentando entrar é ruído sobre algo que não é conteúdo.
 */
export async function getAuthHeroWorks(limit = 21): Promise<HeroWork[] | null> {
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

  if (error) {
    // A parede do login degrada sozinha, mas a falha precisa deixar rastro: capturada aqui, ela
    // nunca chega ao `onRequestError`. O detalhe do erro entra SANITIZADO pelos mesmos donos do
    // `server_error` — a política de "só a operação" existia porque o sanitizador vivia noutra
    // branch, e essa razão caiu quando A3.2 e A3.5 passaram a conviver.
    reportHandledServerError({ operation: "auth-hero.getAuthHeroWorks", error })
    return null
  }

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
  operation: string,
  res: { count: number | null; error: { message: string } | null },
): SiteStatValue {
  if (res.error) {
    // Sem isto a falha da home era INVISÍVEL: nenhuma linha de log saía deste caminho.
    //
    // ⚠️ Uma OPERAÇÃO POR MÉTRICA, nunca um "site-stats falhou" agregado: as quatro contagens
    // batem em tabelas diferentes e falham em separado (é o que `contagemDaMetrica` existe para
    // permitir). Um rótulo só faria as quatro somarem no mesmo balde, e a pergunta "qual delas
    // cai?" — que é a única acionável aqui — deixaria de ter resposta no log.
    //
    // 🔴 A operação chega PRONTA, e não montada aqui a partir do nome da tabela. Com
    // `\`site-stats.count.${tabela}\``, a string que aparece no log não existia em lugar nenhum
    // do código: quem lesse `site-stats.count.works` num incidente não achava o callsite por
    // grep — que é justamente o que o campo existe para permitir. O parâmetro antigo (`tabela`)
    // não servia para mais nada, então isto não duplica nome nenhum: só o move para onde ele já
    // era escrito à mão.
    reportHandledServerError({ operation, error: res.error })
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
    works: contagemDaMetrica("site-stats.count.works", w),
    criteria: contagemDaMetrica("site-stats.count.category_scores", c),
    reviews: contagemDaMetrica("site-stats.count.work_reviews", r),
    sources: contagemDaMetrica("site-stats.count.source", s),
  }
}
