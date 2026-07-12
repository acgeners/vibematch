import { comixSidecarResponseSchema, renderResponseSchema } from "@/lib/validations/comix-render.schema"
import type { ComixResolveInput, ComixSidecarResponse } from "@/lib/validations/comix-render.schema"

// ============================================================================
// Client HTTP do sidecar comix-render. ÚNICO lugar que conhece detalhes da API
// além do contrato: base URL, path `/resolve`, timeout, retry e a VALIDAÇÃO Zod
// da resposta. O resto do app (`resolveComixUrl`) fala só com a interface
// `ComixRenderClient` — se surgir uma v2 da API, muda tudo aqui.
// ============================================================================

// Re-export dos tipos do contrato pra o app importar de um lugar só.
export type {
  ComixResolveInput,
  ComixSidecarItem,
  ComixSidecarMeta,
  ComixSidecarResponse,
} from "@/lib/validations/comix-render.schema"

/** Interface consumida pelo app. Injetável nos testes (fake client). */
export interface ComixRenderClient {
  resolve(input: ComixResolveInput, limit: number): Promise<ComixSidecarResponse>
}

// Detalhes da API — concentrados aqui. v2 mexe só nesta seção.
const RESOLVE_PATH = "/resolve"
const RENDER_PATH = "/render"

// Circuito do /render: quando o sidecar está fora (não deployado, container caído), o
// fetch falha na hora (ECONNREFUSED). Sem circuito, TODA busca de página pagaria essa
// tentativa antes de cair no FlareSolverr — e o scraping chama isso dezenas de vezes.
// Reabre sozinho após o TTL (se o sidecar voltar, volta a ser usado).
const RENDER_CIRCUIT_TTL_MS = 60_000
let renderCircuitOpenUntil = 0

const num = (env: string | undefined, fallback: number) => {
  const n = Number(env)
  return Number.isFinite(n) && n > 0 ? n : fallback
}
// Lido a cada chamada (não no load do módulo) pra ser configurável/testável.
const sidecarUrl = () => process.env.COMIX_RENDER_URL?.trim() || ""
const sidecarTimeoutMs = () => num(process.env.COMIX_RENDER_TIMEOUT_MS, 25000)

/** True quando o sidecar está configurado (`COMIX_RENDER_URL`). Usado pra pular a
 *  resolução com um motivo claro (`sidecar_disabled`) sem nem tocar no client. */
export function isComixRenderConfigured(): boolean {
  return sidecarUrl().length > 0
}

/** Resposta de erro normalizada (mesmo shape do contrato) — mantém o app
 *  fail-soft: qualquer falha vira `{ ok:false }` → `resolveComixUrl` → null. */
function errorResponse(error: string): ComixSidecarResponse {
  return { ok: false, error, meta: { elapsedMs: 0, source: "comix:client" } }
}

function isTimeoutError(err: unknown): boolean {
  return err instanceof Error && (err.name === "TimeoutError" || /timeout|aborted/i.test(err.message))
}

/**
 * Busca o HTML de uma URL pelo sidecar (browser REAL). É o substituto do FlareSolverr:
 * o Chromium do Playwright atravessa o Cloudflare das fontes que respondem 403
 * `cf-mitigated` ao fetch do Node (anime-planet, mangago, comick), porque o bloqueio é
 * por fingerprint TLS/browser.
 *
 * Fail-soft por definição: sem `COMIX_RENDER_URL`, sidecar fora ou payload fora do
 * contrato → `null`, e quem chamou cai no FlareSolverr (ver `fetchHtmlWithCfFallback`).
 * SEM retry: um render custa segundos e o FlareSolverr já é a segunda tentativa.
 */
export async function renderHtmlViaSidecar(
  url: string,
  headers?: Record<string, string>,
  timeoutMs?: number,
): Promise<{ html: string; finalUrl: string } | null> {
  const baseUrl = sidecarUrl()
  if (!baseUrl) return null
  if (Date.now() < renderCircuitOpenUntil) return null

  try {
    const res = await fetch(`${baseUrl}${RENDER_PATH}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url, headers, timeoutMs }),
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs ?? sidecarTimeoutMs()),
    })
    const raw: unknown = await res.json().catch(() => null)
    const parsed = renderResponseSchema.safeParse(raw)
    if (!parsed.success) {
      console.error("[comix-render] /render: resposta fora do contrato", parsed.error.issues?.[0])
      return null
    }
    renderCircuitOpenUntil = 0 // o sidecar respondeu (mesmo que ok:false) → está vivo
    if (!parsed.data.ok) {
      // upstream_blocked = nem o browser real passou → o FlareSolverr é a última chance.
      console.error(`[comix-render] /render falhou: ${parsed.data.error} url=${url}`)
      return null
    }
    return { html: parsed.data.html, finalUrl: parsed.data.finalUrl }
  } catch (err) {
    // Erro de conexão/timeout = sidecar indisponível → abre o circuito e deixa o
    // FlareSolverr assumir sem que cada chamada pague a tentativa.
    renderCircuitOpenUntil = Date.now() + RENDER_CIRCUIT_TTL_MS
    console.error(`[comix-render] /render indisponível (${err instanceof Error ? err.message : err})`)
    return null
  }
}

/**
 * Client HTTP real. Sem `COMIX_RENDER_URL` → `disabled` (Comix vira opcional).
 * 1 retry com backoff curto em falha de conexão/5xx. TODA resposta passa pelo
 * `safeParse` do contrato: payload que não bate → `invalid_response` (nunca
 * entregamos dado malformado ao matching).
 */
export const httpComixRenderClient: ComixRenderClient = {
  async resolve(input, limit) {
    const baseUrl = sidecarUrl()
    if (!baseUrl) return errorResponse("disabled")
    const body = JSON.stringify({ ...input, limit })
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await fetch(`${baseUrl}${RESOLVE_PATH}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body,
          cache: "no-store",
          signal: AbortSignal.timeout(sidecarTimeoutMs()),
        })
        const raw: unknown = await res.json().catch(() => null)
        const parsed = comixSidecarResponseSchema.safeParse(raw)
        // Corpo que bate o contrato → o sidecar FALOU deliberadamente (inclui
        // `503 busy` / `ok:false`): devolve como está, SEM retry (não adianta
        // martelar um sidecar ocupado; o app trata ok:false como null).
        if (parsed.success) return parsed.data
        // Corpo fora do contrato: se for 5xx, é falha transiente → retry;
        // 4xx/2xx com lixo não melhora com retry → invalid_response.
        if (res.status >= 500) throw new Error(`sidecar HTTP ${res.status} (corpo fora do contrato)`)
        console.error("[comix-render] resposta inválida do sidecar:", parsed.error.issues?.[0])
        return errorResponse("invalid_response")
      } catch (err) {
        if (attempt === 1) {
          return errorResponse(isTimeoutError(err) ? "render_timeout" : "network_error")
        }
        await new Promise((r) => setTimeout(r, 500))
      }
    }
    return errorResponse("network_error")
  },
}
