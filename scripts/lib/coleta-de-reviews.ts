import { MangagoUnavailableError } from "../../lib/external/mangago"

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
export type ResultadoDaColeta =
  | { status: "com_reviews"; textos: string[] }
  | { status: "zero" }
  | { status: "falhou"; motivo: string }

/** O motivo que vai pro log. Do Mangago, o `reason` do contrato (`blocked`, `bypass_unavailable`, `fetch_failed`). */
export function motivoDaFalha(err: unknown): string {
  if (err instanceof MangagoUnavailableError) return err.reason
  return err instanceof Error ? err.message : String(err)
}

/** Busca as reviews de uma obra e, SÓ se vierem reviews, chama `salvar`. Sem `salvar` = dry-run. */
export async function coletarReviewsDaObra(
  buscar: () => Promise<string[]>,
  salvar?: (textos: string[]) => Promise<void>,
): Promise<ResultadoDaColeta> {
  let textos: string[]
  try {
    textos = await buscar()
  } catch (err) {
    return { status: "falhou", motivo: motivoDaFalha(err) }
  }
  if (textos.length === 0) return { status: "zero" }
  if (salvar) await salvar(textos)
  return { status: "com_reviews", textos }
}
