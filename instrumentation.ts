import type { Instrumentation } from "next"
import { buildServerErrorEvent } from "@/lib/observability/server-error-event"

/**
 * Erro que o Next captura vira UMA linha JSON no stderr (`event":"server_error"`).
 *
 * ⚠️ Cobre o que o FRAMEWORK captura — render de Server Component, Route Handler e Server
 * Action que LANÇAM. Não cobre erro que a própria aplicação absorve e converte em valor de
 * retorno ou em Response: `/api/health` responde 503 sozinho e nunca chega aqui (medido).
 * Esse é o ponto cego, e ele é de desenho, não defeito.
 *
 * 🔴 Sem `register()` de propósito: não há nada real para registrar, e um `register` vazio
 * seria capacidade construída e desligada.
 */
export const onRequestError: Instrumentation.onRequestError = (error, request, context) => {
  try {
    console.error(
      JSON.stringify(buildServerErrorEvent({ error, method: request?.method, context })),
    )
  } catch {
    // O hook de erro não pode ser a fonte do próximo erro: se serializar falhar, ainda sai
    // uma linha reconhecível em vez de derrubar o request.
    console.error(
      JSON.stringify({
        event: "server_error",
        errorName: "ObservabilityFailure",
        routePath: context?.routePath ?? null,
      }),
    )
  }
}
