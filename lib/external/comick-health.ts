import "server-only"
import { fetchComicKByHid, fetchComicKReviews } from "./comick"
import { upsertSourceHealth } from "./source-health-store"

/**
 * Gate ATIVO de saúde do ComicK por canário — espelha o checkComixHealth do
 * Comix, mas resolve o buraco do "erro silencioso": no caminho de reviews o
 * ComicK engole falha de infra em vazio (fetchComicKByHid `catch{return null}`,
 * fetchComicKReviews `.catch(()=>[])`), indistinguível de "a obra não existe".
 * Um canário — obra que SABIDAMENTE existe e tem reviews — desfaz a ambiguidade:
 * se o canário volta vazio, é INFRA caída, não ausência.
 *
 * Diferente do Comix (hid fixo "003kd"), o hid do ComicK NÃO aparece na URL (a
 * URL usa slug) — foi resolvido 1× pela API: "Solo Leveling" = hid "71gMd0vF"
 * (validado 2026-07-05: detail + 33 reviews). Overridable por env COMICK_CANARY_HID
 * (rode `npm run comick:canary "<título>"` pra resolver outro). Se explicitamente
 * vazio, o gate do ComicK vira NÃO-BLOQUEANTE (fail-open) — um hid errado
 * bloquearia TODA cascata, então nunca travamos por canário mal configurado.
 */
export const COMICK_CANARY_HID = process.env.COMICK_CANARY_HID ?? "71gMd0vF"

export interface ComicKHealth {
  /** true = saudável; false = infra caída; null = canário não configurado. */
  ok: boolean | null
  configured: boolean
  detail: boolean
  reviews: boolean
}

/** Probe ativo do canário: detalhe (JSON) + reviews. Persiste no store genérico
 *  de saúde (external_source_health, source="comick") best-effort. */
export async function checkComicKHealth(): Promise<ComicKHealth> {
  if (!COMICK_CANARY_HID) {
    return { ok: null, configured: false, detail: false, reviews: false }
  }
  const detail = await fetchComicKByHid(COMICK_CANARY_HID)
  const reviews = detail ? await fetchComicKReviews(COMICK_CANARY_HID) : []
  const detailOk = !!detail?.title
  const reviewsOk = reviews.length > 0
  const ok = detailOk && reviewsOk

  void upsertSourceHealth("comick", {
    status: ok ? "ok" : "down",
    lastOkAt: ok ? Date.now() : null,
    lastFailAt: ok ? null : Date.now(),
    failReason: ok ? null : "canary_empty",
    consecutiveFails: ok ? 0 : 1,
  }).catch(() => {})

  return { ok, configured: true, detail: detailOk, reviews: reviewsOk }
}

// Backoff (ms) — mesmo shape do Comix (COMIX_WARM_BACKOFF_MS): ~6 tentativas, ~3 min.
const COMICK_WARM_BACKOFF_MS = [3_000, 8_000, 20_000, 45_000, 90_000]

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Garante o ComicK utilizável com retry bounded + backoff (espelha ensureComixReady).
 * Canário não configurado ⇒ ok:true (não-bloqueante) pra não travar a cascata.
 */
export async function ensureComicKReady(
  opts?: { maxAttempts?: number },
): Promise<{ ok: boolean; configured: boolean; attempts: number }> {
  if (!COMICK_CANARY_HID) return { ok: true, configured: false, attempts: 0 }
  const max = Math.max(1, opts?.maxAttempts ?? 6)
  for (let attempt = 1; attempt <= max; attempt++) {
    const h = await checkComicKHealth().catch(
      () => ({ ok: false, configured: true, detail: false, reviews: false }) as ComicKHealth,
    )
    if (h.ok) return { ok: true, configured: true, attempts: attempt }
    if (attempt < max) {
      await sleep(COMICK_WARM_BACKOFF_MS[Math.min(attempt - 1, COMICK_WARM_BACKOFF_MS.length - 1)])
    }
  }
  return { ok: false, configured: true, attempts: max }
}
