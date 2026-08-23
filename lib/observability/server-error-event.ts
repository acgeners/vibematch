import type { RequestErrorContext } from "next/dist/server/instrumentation/types"
import { sanitizeErrorMessage } from "@/lib/observability/redact"
import { nomeDoErro, runtimeFields, stackSanitizado, texto } from "@/lib/observability/event-fields"

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
 *
 * ⚠️ Este evento cobre o que o FRAMEWORK captura. Erro que a própria aplicação absorve e
 * converte em valor de retorno tem evento PRÓPRIO (`handled_server_error`) — os dois são
 * separados de propósito, porque "quebrou a requisição" e "degradou e seguiu" são fatos
 * diferentes, e colapsá-los num rótulo só apagaria justo a distinção que decide a gravidade.
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

  // `digest` não está no tipo `Error` — o Next o anexa ao objeto lançado.
  const digest = texto((error as { digest?: unknown } | null)?.digest)

  return {
    ts: input.now ?? new Date().toISOString(),
    event: "server_error",
    errorName: nomeDoErro(error),
    // ⚠️ `sanitizeErrorMessage`, e NÃO `mensagemDoErro`: a fonte deste evento é erro LANÇADO,
    // que é `Error` de verdade. A extração de objeto plano existe para a fonte do outro evento
    // (o que o supabase-js DEVOLVE), e trazê-la para cá mudaria o valor deste campo — que é
    // exatamente o schema drift que a introdução do 2º evento não pode causar.
    errorMessage: sanitizeErrorMessage(error),
    digest,
    stack: stackSanitizado(error),
    method: texto(input.method),
    routerKind: texto(context?.routerKind),
    routePath: texto(context?.routePath),
    routeType: texto(context?.routeType),
    renderSource: texto(context?.renderSource),
    revalidateReason: texto(context?.revalidateReason),
    // Um dono só para o runtime: uma 2ª leitura de `FLY_REGION` faria os dois eventos poderem
    // discordar sobre o MESMO processo.
    ...runtimeFields(env),
  }
}
