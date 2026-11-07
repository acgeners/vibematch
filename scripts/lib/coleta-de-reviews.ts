import { buildCandidateFromExternalIds, collectReviewsFromCandidate } from "../../lib/external/index"
import { MangagoUnavailableError } from "../../lib/external/mangago"
import type { ExternalSourceId, SourcedReview } from "../../lib/external/types"
import { pgSafeText } from "../../lib/text/pg-safe-text"

/**
 * O que UMA tentativa de coleta de reviews devolveu — e o que o backfill faz com isso.
 *
 * Por que existe: até 2026-10-07 o `backfill-source-reviews.ts` fazia `fetch(...).catch(() => [])`.
 * O adaptador do Mangago LANÇA `MangagoUnavailableError` quando a fonte não respondeu (bloqueio,
 * bypass fora, fetch falho) e devolve `[]` só quando ela respondeu que não há review — e o catch
 * desfazia exatamente essa distinção: a falha virava "0" na linha da obra e entrava na contagem
 * "obras sem review", a mesma resposta de uma obra que de fato não tem nada lá.
 *
 * Três estados, nunca dois:
 *   com_reviews  a fonte respondeu e trouxe texto            → grava (só com `salvar`, i.e. --apply)
 *   zero         a fonte respondeu e não há review           → não grava; é RESULTADO
 *   falhou       a fonte NÃO respondeu (a promise rejeitou)  → não grava; NÃO é zero
 *
 * ⚠️ Falha nunca escreve: as reviews já salvas da obra ficam como estão, e como nada é gravado a
 * obra continua no escopo da próxima execução (o escopo é "vínculo aceito + zero reviews da fonte").
 *
 * ⚠️ O limite é o do ADAPTADOR. `fetchComixReviews` devolve `[]` também quando a fonte falha (ele
 * não lança), então para a Comix este helper não tem como separar falha de zero — lá quem denuncia
 * é o alarme "nenhuma obra trouxe review" do script.
 */
export type ResultadoDaColeta<T = string> =
  | { status: "com_reviews"; textos: T[] }
  | { status: "zero" }
  | { status: "falhou"; motivo: string }

/** O motivo que vai pro log. Do Mangago, o `reason` do contrato (`blocked`, `bypass_unavailable`, `fetch_failed`). */
export function motivoDaFalha(err: unknown): string {
  if (err instanceof MangagoUnavailableError) return err.reason
  return err instanceof Error ? err.message : String(err)
}

/**
 * Busca as reviews de uma obra e, SÓ se vierem reviews, chama `salvar`. Sem `salvar` = dry-run.
 * `T` é o formato que o adaptador devolve: texto cru (Comix, Mangago) ou a review já montada pelo
 * caminho do app (MangaUpdates — ver o script).
 */
export async function coletarReviewsDaObra<T = string>(
  buscar: () => Promise<T[]>,
  salvar?: (textos: T[]) => Promise<void>,
): Promise<ResultadoDaColeta<T>> {
  let textos: T[]
  try {
    textos = await buscar()
  } catch (err) {
    return { status: "falhou", motivo: motivoDaFalha(err) }
  }
  if (textos.length === 0) return { status: "zero" }
  if (salvar) await salvar(textos)
  return { status: "com_reviews", textos }
}

/**
 * Busca as reviews de UMA fonte pelo MESMO caminho do app ("Buscar reviews"): candidato montado
 * pelo id aceito e coleta restrita à fonte.
 *
 * 🔴 Reusar não é estilo. A gravação deduplica por texto EXATO, e o app apara e FILTRA as reviews
 * (`collectReviewsFromCandidate` prefere as de ≥100 caracteres) e extrai a nota antes de montá-las.
 * Um mapeamento próprio gravaria os comentários curtos que o app nunca grava, ou o mesmo texto com
 * outra nota — e o pool divergiria do que a próxima coleta pelo app produz.
 *
 * A coleta do app ENGOLE a rejeição e a devolve em `failedSources`; aqui ela volta a ser exceção,
 * para `coletarReviewsDaObra` contar falha como falha, e não como "0 reviews".
 */
export async function buscarComoOApp(source: ExternalSourceId, externalId: string, title: string): Promise<SourcedReview[]> {
  const candidato = buildCandidateFromExternalIds({ title }, { [source]: externalId })
  const r = await collectReviewsFromCandidate(candidato, undefined, [source])
  if (r.failedSources.includes(source)) throw new Error(`${source}_indisponivel`)
  return r.reviews
}

/** A MESMA chave do `saveWorkReviews` acumulativo: o texto como é GRAVADO (`pgSafeText`), aparado. */
export const chaveDaReview = (texto: string) => pgSafeText(texto).trim()

/**
 * As reviews do lote cujo texto a obra ainda não tem — a conta que o `saveWorkReviews`
 * acumulativo faz por dentro, feita ANTES para o ensaio dizer quantas entram (e para obra sem
 * nada novo nem ser gravada). Repetida dentro do lote conta uma vez.
 */
export function soAsNovas(existentes: ReadonlySet<string> | undefined, reviews: SourcedReview[]): SourcedReview[] {
  const vistas = new Set(existentes ?? [])
  return reviews.filter((r) => {
    const k = chaveDaReview(r.text)
    if (vistas.has(k)) return false
    vistas.add(k)
    return true
  })
}
