import type { RequestErrorContext } from "next/dist/server/instrumentation/types"
import { redactSecrets, sanitizeErrorMessage } from "@/lib/observability/redact"

/**
 * UMA linha JSON por erro que o Next captura. Formato achatado de propósito: o consumidor
 * real hoje é `flyctl logs`, onde o que serve é `grep server_error` e ler o campo.
 *
 * 🔴 `errorMessage` é CONTEXTO, nunca a chave do evento. Medido em 2026-08-23 (A3.1): uma
 * falha do PostgREST chega como `{"message":""}` — sem `code`, `details` ou `hint`. Quem
 * identifica o evento é `event` + `routePath` + `routeType` + `errorName` + `digest`, e é
 * por isso que a mensagem vazia não o inutiliza.
 *
 * ⚠️ O que NÃO entra, e é a metade que importa: headers, cookies, Authorization, body e a
 * URL crua. `errorRequest.path` carrega a QUERY STRING (entrada do usuário), então a rota
 * sai de `context.routePath`, que é o caminho LÓGICO — `/catalog/[id]`, não `/catalog/x?q=…`.
 * Ausência de coleta é o que garante ausência de vazamento; o regex de redação é só rede.
 */
export type ServerErrorEvent = {
  ts: string
  event: "server_error"
  errorName: string
  errorMessage: string
  digest: string | null
  stack: string | null
  method: string | null
  routerKind: string | null
  routePath: string | null
  routeType: string | null
  renderSource: string | null
  revalidateReason: string | null
  env: string | null
  flyApp: string | null
  flyMachine: string | null
  flyRegion: string | null
  flyImage: string | null
  commit: string | null
}

const STACK_MAX = 2000

function texto(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null
}

export function buildServerErrorEvent(input: {
  error: unknown
  method?: string | null
  context: Partial<RequestErrorContext> | null | undefined
  /** Injetado nos testes; em runtime é o `process.env`. */
  env?: Record<string, string | undefined>
  /** Injetado nos testes para o carimbo ser determinístico. */
  now?: string
}): ServerErrorEvent {
  const { error, context } = input
  const env = input.env ?? process.env
  const err = error instanceof Error ? error : null

  // `digest` não está no tipo `Error` — o Next o anexa ao objeto lançado.
  const digest = texto((error as { digest?: unknown } | null)?.digest)

  let stack = err?.stack ? redactSecrets(err.stack) : null
  if (stack && stack.length > STACK_MAX) stack = `${stack.slice(0, STACK_MAX - 1)}…`

  return {
    ts: input.now ?? new Date().toISOString(),
    event: "server_error",
    // Erro sem nome ainda é um erro: cai num rótulo estável em vez de sumir.
    errorName: err?.name || (error === null || error === undefined ? "NonError" : typeof error),
    errorMessage: sanitizeErrorMessage(error),
    digest,
    stack,
    method: texto(input.method),
    routerKind: texto(context?.routerKind),
    routePath: texto(context?.routePath),
    routeType: texto(context?.routeType),
    renderSource: texto(context?.renderSource),
    revalidateReason: texto(context?.revalidateReason),
    env: texto(env.NODE_ENV),
    // A plataforma injeta estes em runtime; LOCALMENTE são null, e null é a resposta
    // correta — inventar valor faria o log de dev parecer log de produção.
    flyApp: texto(env.FLY_APP_NAME),
    flyMachine: texto(env.FLY_MACHINE_ID),
    flyRegion: texto(env.FLY_REGION),
    flyImage: texto(env.FLY_IMAGE_REF),
    // ⚠️ LACUNA REGISTRADA: nada injeta SHA de commit hoje — nem o Dockerfile, nem
    // workflow, nem `generateBuildId`. Fica null de propósito; mudar o deploy só para
    // preenchê-lo está fora deste gate. `flyImage` é o identificador de release que
    // existe de fato.
    commit: texto(env.GIT_COMMIT_SHA),
  }
}
