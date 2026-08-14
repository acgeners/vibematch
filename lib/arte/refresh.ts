import "server-only"
import { createAdminClient } from "@/lib/supabase/admin"
import { extractArtSignal, isArtSignalStale, parseArtSignal, type ArtSignal } from "@/lib/arte/signal"

/**
 * Reextrai `works.art_signal` de UMA obra.
 *
 * 🔴 É esta a metade CARA do estimador de arte: lê o digest e o texto de todas as reviews.
 * Ela roda na ESCRITA — quando o digest é regravado ou as reviews mudam — e o recalc consome
 * só os 6 números que ela deixa. Sem essa separação o recalc passaria a puxar `review_digest`
 * do catálogo inteiro, e ele já é o maior consumidor de egress do projeto.
 *
 * ⚠️ As TAGS não entram aqui: o recalc já as tem pelo `work_tags` do select, e guardá-las no
 * sinal obrigaria a reler o digest a cada mudança de tag.
 *
 * ⚠️ Falha é NÃO-FATAL, mesma política do `saveWorkReviews` que a chama: a estimativa de arte
 * é conveniência de ordenação, e derrubar a persistência de reviews por causa dela seria
 * trocar um problema pequeno por um grande. O preço é sinal envelhecendo em silêncio — por
 * isso o log leva o prefixo `[arte-signal]`, que é o que dá pra medir depois, e por isso
 * `isArtSignalStale` existe para o script de semente varrer o que ficou para trás.
 */
export async function refreshArtSignalForWork(workId: string): Promise<ArtSignal | null> {
  if (!workId) return null
  try {
    const sb = createAdminClient()
    const { data: work, error: werr } = await sb
      .from("works")
      .select("id, review_digest")
      .eq("id", workId)
      .maybeSingle()
    if (werr) throw new Error(werr.message)
    if (!work) return null

    // Paginado: obra popular passa de 1000 reviews e o select corta sem avisar.
    const reviewTexts: string[] = []
    for (let from = 0; ; from += 1000) {
      const { data, error } = await sb
        .from("work_reviews")
        .select("text")
        .eq("work_id", workId)
        .range(from, from + 999)
      if (error) throw new Error(error.message)
      if (!data?.length) break
      for (const r of data) reviewTexts.push(String((r as { text?: unknown }).text ?? ""))
      if (data.length < 1000) break
    }

    const signal = extractArtSignal({
      reviewDigest: (work as { review_digest?: unknown }).review_digest,
      reviewTexts,
    })
    const { error: uerr } = await sb.from("works").update({ art_signal: signal }).eq("id", workId)
    if (uerr) throw new Error(uerr.message)
    return signal
  } catch (e) {
    console.error(`[arte-signal] falhou para ${workId}:`, e instanceof Error ? e.message : e)
    return null
  }
}

/**
 * Reextrai só se o sinal estiver ausente ou de régua antiga. Para caminhos que passam pela
 * obra sem necessariamente terem mudado reviews ou digest — refazer ali seria pagar a leitura
 * do digest à toa.
 */
export async function refreshArtSignalIfStale(workId: string, current: unknown): Promise<void> {
  if (!isArtSignalStale(parseArtSignal(current))) return
  await refreshArtSignalForWork(workId)
}
