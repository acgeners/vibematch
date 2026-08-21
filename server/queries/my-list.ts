import "server-only"
import { createAdminClient } from "@/lib/supabase/admin"
import { coverCandidates } from "@/lib/work-derived"
import { roundToDisplayScore } from "@/lib/score-rounding"
import { getPersonalStateReader } from "@/server/queries/user-work-state"
import { getScoresReader } from "@/server/queries/user-scores"
import { belongsToMyList, emptyShelfCounts, shelfOfStatusId } from "@/lib/my-list/shelves"
import type { ShelfCounts, ShelfKey } from "@/lib/my-list/shelves"

const PAGE = 1000
/**
 * ⚠️ Faixas de 200 na leitura de `works`, não 1000. O peso ali é BYTE, não linha — a mesma
 * lição do `loadEmbeddingCandidates`: 1000 linhas desta projeção com os joins embutidos é a
 * maior resposta única que o app faz.
 */
const WORK_CHUNK = 200

export interface MyListWork {
  id: string
  title: string
  coverUrls: string[]
  personalStatusId: number | null
  shelf: ShelfKey | null
  chaptersRead: number | null
  totalChapters: number | null
  userScore: number | null
  expectedScore: number | null
  lastReadAt: string | null
  isAdult: boolean
}

export interface MyList {
  works: MyListWork[]
  counts: ShelfCounts
  /** Quantas estão na lista mas em prateleira nenhuma (nota sem status) — ver `belongsToMyList`. */
  semPrateleira: number
  /** Obras ativas do catálogo em que a pessoa nunca se pronunciou. */
  foraDaLista: number
  /** Amostra para a zona de entrada: as mais novas do catálogo ainda fora da lista. */
  paraTriar: Array<{ id: string; title: string; coverUrls: string[]; totalChapters: number | null }>
}

const VAZIA: MyList = {
  works: [],
  counts: emptyShelfCounts(),
  semPrateleira: 0,
  foraDaLista: 0,
  paraTriar: [],
}

type CoverRow = { url: string; is_primary: boolean; position: number }

/**
 * As candidatas de capa desta lista. Delega a `coverCandidates` — 2,9% das capas do
 * catálogo estavam mortas e em 21 obras havia alternativa viva que a tela não usava.
 *
 * 🔴 Isto era uma reimplementação da mesma ordenação (is_primary, depois position), a
 * QUARTA no repo. Nenhuma estava errada; o problema é que a ordem das capas passava a
 * depender de qual cópia a tela chamasse, e nada acusaria a divergência.
 */
function coversOf(rows: CoverRow[] | null | undefined): string[] {
  return coverCandidates(rows)
}

/**
 * A lista de quem está logado: tudo em que a pessoa se pronunciou.
 *
 * 🔴 O filtro sai do ESPELHO (`user_work_state`) da sessão, nunca de `works.personal_status_id`
 * — essa coluna saiu na Fase F, e antes dela filtrar por lá devolvia a lista do DONO para
 * qualquer um que abrisse a página.
 *
 * 🔴 Sem sessão devolve VAZIO, e isso é o desenho, não uma degradação: `/my-list` está em
 * `SIGNED_IN_PREFIXES`, mas o gate de rota é a 1ª camada e esta é a 2ª — a mesma dupla que
 * `/dashboard` e `/account` precisaram ter ([[project-conta-exige-sessao]]).
 */
export async function getMyList(): Promise<MyList> {
  const personal = await getPersonalStateReader()
  if (!personal.userId) return VAZIA

  const supabase = createAdminClient()

  // 1. O espelho inteiro da pessoa, paginado. `select` corta em 1000 sem avisar, e o dono
  //    tem 988 linhas — a 12 linhas do corte silencioso.
  const espelho: Array<{ work_id: string; personal_status_id: number | null; user_score: number | null }> = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("user_work_state")
      .select("work_id, personal_status_id, user_score")
      .eq("user_id", personal.userId)
      .order("work_id", { ascending: true })
      .range(from, from + PAGE - 1)
    if (error) throw new Error(`user_work_state: ${error.message}`)
    if (!data?.length) break
    espelho.push(...(data as typeof espelho))
    if (data.length < PAGE) break
  }

  const meus = espelho.filter((r) =>
    belongsToMyList({ personalStatusId: r.personal_status_id, userScore: r.user_score }),
  )
  if (meus.length === 0) {
    return { ...VAZIA, foraDaLista: await contarAtivas(supabase), paraTriar: await amostraParaTriar(supabase, new Set()) }
  }

  // 2. As obras, em faixas de 200.
  const scores = await getScoresReader()
  const ids = meus.map((r) => r.work_id)
  const works: MyListWork[] = []
  for (let i = 0; i < ids.length; i += WORK_CHUNK) {
    const chunk = ids.slice(i, i + WORK_CHUNK)
    const { data, error } = await supabase
      .from("works")
      .select(
        "id, title, total_chapters, is_adult, calculated_scores(expected_score), work_covers(url, is_primary, position)",
      )
      .eq("is_archived", false)
      .in("id", chunk)
    if (error) throw new Error(`works: ${error.message}`)
    for (const w of (data ?? []) as unknown as Array<{
      id: string
      title: string
      total_chapters: number | null
      is_adult: boolean | null
      calculated_scores?: { expected_score?: number | null } | null
      work_covers?: CoverRow[] | null
    }>) {
      const estado = personal.get(w.id)
      works.push({
        id: w.id,
        title: w.title,
        coverUrls: coversOf(w.work_covers),
        personalStatusId: estado.personalStatusId,
        shelf: shelfOfStatusId(estado.personalStatusId),
        chaptersRead: estado.chaptersRead,
        totalChapters: w.total_chapters ?? null,
        userScore: estado.userScore,
        // A Nota Prevista é de QUEM OLHA: sem o overlay ela vem de `calculated_scores`, que é
        // a linha do DONO, e a leitora veria a previsão do gosto dele como se fosse a dela.
        expectedScore: scores.overlay(w.id, w.calculated_scores)?.expected_score ?? null,
        lastReadAt: estado.lastReadAt,
        isAdult: Boolean(w.is_adult),
      })
    }
  }

  // 3. Ordem: sua nota primeiro, depois a Prevista, depois título.
  //
  // ⚠️ Arredonda pela nota EXIBIDA (`roundToDisplayScore`), não pelo decimal cru — a tela
  // imprime `toFixed(1)` e ordenar pelo cru põe um 8,35 que aparece como "8,3" na frente de
  // dois 8,4 legítimos. É a invariante que custou 19.624 pares de empate na Prioridade.
  //
  // ⚠️ Nota ausente vai pro FIM em vez de contar como zero: "não avaliei" não é "achei ruim".
  const chave = (v: number | null) => (v == null ? -Infinity : roundToDisplayScore(v))
  works.sort(
    (a, b) =>
      chave(b.userScore) - chave(a.userScore) ||
      chave(b.expectedScore) - chave(a.expectedScore) ||
      a.title.localeCompare(b.title, "pt-BR"),
  )

  // 4. Contagens por prateleira — derivadas das MESMAS obras que a lista mostra, nunca
  //    contadas à parte. Chip dizendo 78 sobre uma prateleira que abre com 71 é a família
  //    "dois critérios pro mesmo fato", aqui a dois centímetros um do outro.
  const counts = emptyShelfCounts()
  let semPrateleira = 0
  for (const w of works) {
    if (w.shelf) counts[w.shelf] += 1
    else semPrateleira += 1
  }

  const naLista = new Set(works.map((w) => w.id))
  return {
    works,
    counts,
    semPrateleira,
    foraDaLista: Math.max(0, (await contarAtivas(supabase)) - naLista.size),
    paraTriar: await amostraParaTriar(supabase, naLista),
  }
}

async function contarAtivas(supabase: ReturnType<typeof createAdminClient>): Promise<number> {
  // `count: "exact", head: true` — não traz linha nenhuma. Contar via `select` seria o bug
  // das 1000 linhas na sua forma mais cara: um total que parece certo e para em 1000.
  const { count, error } = await supabase
    .from("works")
    .select("*", { count: "exact", head: true })
    .eq("is_archived", false)
  if (error) throw new Error(`works (count): ${error.message}`)
  return count ?? 0
}

/**
 * Candidatas da zona de entrada: as mais RECENTES do catálogo que ainda não são suas.
 *
 * ⚠️ A ordem é "chegou por último", não "a melhor" — de propósito. Ordenar por Nota Prevista
 * exigiria carregar as ~693 fora da lista com os joins de nota só para escolher 12, e triagem
 * não precisa das melhores: precisa de qualquer uma que você ainda não julgou. Busca 60 e
 * corta as suas em memória (70% do catálogo está fora da lista, então 60 sempre sobra).
 */
async function amostraParaTriar(
  supabase: ReturnType<typeof createAdminClient>,
  naLista: ReadonlySet<string>,
): Promise<MyList["paraTriar"]> {
  const { data, error } = await supabase
    .from("works")
    .select("id, title, total_chapters, created_at, work_covers(url, is_primary, position)")
    .eq("is_archived", false)
    .order("created_at", { ascending: false })
    .limit(60)
  if (error) throw new Error(`works (triagem): ${error.message}`)
  return ((data ?? []) as unknown as Array<{
    id: string
    title: string
    total_chapters: number | null
    work_covers?: CoverRow[] | null
  }>)
    .filter((w) => !naLista.has(w.id))
    .slice(0, 12)
    .map((w) => ({
      id: w.id,
      title: w.title,
      coverUrls: coversOf(w.work_covers),
      totalChapters: w.total_chapters ?? null,
    }))
}
