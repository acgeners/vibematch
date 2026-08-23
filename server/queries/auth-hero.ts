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
 * O "erro" do caso sem `count`.
 *
 * ⚠️ Objeto plano com `message`, e nada além: é a MESMA forma que o supabase-js entrega em
 * toda falha real (medido — nunca um `Error`, nunca com `stack`), então o evento sai idêntico
 * aos vizinhos em vez de destoar. Um `new Error` daria um stack do NOSSO código, que é o mesmo
 * para as quatro operações e leria como se houvesse exceção onde não houve.
 *
 * 🔴 A mensagem descreve o que MEDIMOS — a contagem não veio —, nunca uma causa que não temos.
 * O 404 mascarado é a origem provável, e afirmá-la aqui seria inventar detalhe de backend: o
 * mesmo estado apareceria numa causa nova que ninguém previu. Quem identifica o evento é a
 * `operation`, como no resto do A3.5.
 */
const CONTAGEM_SEM_COUNT = { message: "contagem exact não retornou count" }

/**
 * A ausência de `count` numa contagem `exact` não é resultado — é falha SEM erro.
 *
 * 🔴 Medido em 2026-08-23, e o achado inverte o que esta função afirmava. `getSiteStats` pede
 * `count: "exact"`, então resposta saudável DEVE trazer número (o zero legítimo vem como `0`, com
 * o `content-range` marcando zero linhas). Varridas 10 variantes contra o PostgREST local: com `count`
 * pedido, **nenhum** cenário legítimo produz `count: null` — nem RLS bloqueando (dá 0), nem
 * filtro sem match (dá 0), nem view, nem `planned`/`estimated`. Em 6 respostas 2xx, todas
 * trouxeram `content-range`.
 *
 * 🔴 Os únicos dois cenários que produzem `count: null` COM `error: null` são falha: relação
 * ausente e RPC ausente. E a falha vem mascarada — o PostgREST responde 404, mas com
 * `head: true` o HTTP não transmite corpo, e o `postgrest-js` (2.105.1,
 * `dist/index.cjs:381-385`) tem um ramo que, ao não conseguir parsear o corpo VAZIO de um 404,
 * **reescreve o status para 204 e deixa `error` em null**. Quem engole é o cliente; o
 * PostgREST está correto, e o `head` é só a condição que expõe.
 *
 * ⚠️ Esta função afirmava o contrário — "`count` nulo SEM erro é 'respondeu e não sei
 * quantos'". Era hipótese defensiva, aceita sem observação; o que existe em runtime é falha
 * disfarçada de indeterminação. A degradação da tela já estava certa desde a A3.1: o que
 * faltava era o SINAL, e é só ele que muda aqui.
 *
 * ⚠️ A régua é a INVARIANTE do pedido, não o status HTTP: "pedi `exact`, logo espero número".
 * Casar `status === 204` amarraria a aplicação a um detalhe de uma versão do cliente — o dia
 * em que o `postgrest-js` corrigir aquele ramo, o 404 volta a chegar como erro e a guarda
 * viraria código morto sem nada acusar.
 *
 * ⚠️ Vale para quem PEDE contagem. Consulta que não pede `count` recebe `null` legitimamente,
 * e nada disto se aplica a ela.
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

  const count = res.count ?? null
  if (count === null) {
    // A degradação é a MESMA de sempre (null, nunca 0) — o que muda é deixar rastro.
    reportHandledServerError({ operation, error: CONTAGEM_SEM_COUNT })
    return null
  }
  return count
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
