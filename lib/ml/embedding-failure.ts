/**
 * Por que um embedding falhou — dito na TELA, não só no log do servidor.
 *
 * 🔴 O aviso dizia "15 falharam. Veja os logs do servidor." e o servidor JÁ SABIA o
 * motivo: ele ia pro `console.error` e só a contagem voltava pra tela. "Os logs do
 * servidor" é um arquivo no Mac (`npm start`) ou o painel da Fly (produção) — nenhum
 * dos dois é um lugar do app. E a frase era a mesma pra falta de crédito, chave
 * errada, chave ausente e queda de rede, que têm saídas diferentes.
 *
 * ⚠️ O caso que motivou isto (2026-11-11) foi conta da OpenAI SEM CRÉDITO, e a
 * primeira reação foi conferir o saldo da ANTHROPIC, que tinha crédito. São contas
 * separadas; por isso a descrição nomeia a OpenAI e diz que é outra conta.
 *
 * Módulo PURO (sem `server-only`, sem fetch): a classificação roda no servidor e a
 * descrição roda no painel, que é `"use client"`. Os dois lados leem o mesmo texto.
 */

/** Página de cobrança da OpenAI — a mesma para a qual a própria API aponta no erro. */
export const OPENAI_BILLING_URL = "https://platform.openai.com/settings/organization/billing/overview"

export type EmbeddingFailureKind =
  | "sem_credito"
  | "chave_recusada"
  | "chave_ausente"
  | "limite_de_ritmo"
  | "rede"
  | "gravacao"
  | "desconhecido"

/** Um motivo de falha e quantas obras caíram por ele. Serializável (volta da server action). */
export interface EmbeddingFailure {
  kind: EmbeddingFailureKind
  /** Mensagem original de quem falhou — o texto do caso desconhecido, e o que vai pro log. */
  detail: string
  works: number
}

/** O que a OpenAI devolve no corpo do erro, mais o status HTTP. */
export interface OpenAIErrorFields {
  status: number | null
  type: string | null
  code: string | null
}

/**
 * Conta sem crédito. MEDIDO contra a API em 2026-11-11, e não é o que se supõe:
 *
 *   status 429 · type "insufficient_quota" · code "credit_balance_exhausted"
 *
 * Uma regra que olhasse só `code === "insufficient_quota"` (o formato antigo, ainda
 * aceito aqui) NÃO pegaria o caso real. O sinal estável é o `type`.
 *
 * Importa porque o 429 é o MESMO status de "muitas chamadas em pouco tempo", que é
 * passageiro e vale repetir. Falta de crédito não passa sozinha: repetir só atrasa.
 */
export function isOutOfCredit(e: Pick<OpenAIErrorFields, "type" | "code">): boolean {
  return (
    e.type === "insufficient_quota" ||
    e.code === "insufficient_quota" ||
    e.code === "credit_balance_exhausted"
  )
}

function readErrorFields(err: unknown): OpenAIErrorFields | null {
  if (!err || typeof err !== "object") return null
  const o = err as Record<string, unknown>
  const has = "status" in o || "code" in o || "type" in o
  if (!has) return null
  return {
    status: typeof o.status === "number" ? o.status : null,
    type: typeof o.type === "string" ? o.type : null,
    code: typeof o.code === "string" ? o.code : null,
  }
}

/**
 * Classifica uma exceção lançada pela chamada à OpenAI.
 *
 * Lê os campos por FORMA (`status`/`type`/`code`), não por `instanceof`, para este
 * módulo não importar o cliente da OpenAI — senão o painel levaria o cliente junto
 * pro bundle do browser.
 */
export function classifyEmbeddingError(err: unknown): Omit<EmbeddingFailure, "works"> {
  const detail = err instanceof Error ? err.message : String(err)
  const f = readErrorFields(err)

  if (f) {
    if (f.code === "missing_api_key") return { kind: "chave_ausente", detail }
    if (isOutOfCredit(f)) return { kind: "sem_credito", detail }
    // Medido: chave inválida volta 401 · type "invalid_request_error" · code "invalid_api_key".
    if (f.status === 401 || f.code === "invalid_api_key") return { kind: "chave_recusada", detail }
    if (f.status === 429) return { kind: "limite_de_ritmo", detail }
  }

  // `fetch` do Node lança TypeError("fetch failed") quando nem chega a ter resposta.
  if (err instanceof TypeError || /fetch failed|terminated|ECONNRESET|socket|ETIMEDOUT/i.test(detail)) {
    return { kind: "rede", detail }
  }
  return { kind: "desconhecido", detail }
}

/**
 * Motivo que vale pra CONTA inteira: a próxima obra vai falhar igual. Quem itera em
 * lotes para aqui em vez de bater na API de novo pra receber a mesma recusa.
 */
export function isAccountWideFailure(kind: EmbeddingFailureKind): boolean {
  return kind === "sem_credito" || kind === "chave_recusada" || kind === "chave_ausente"
}

/** O motivo em português, como aparece no aviso. */
export function describeEmbeddingFailure(f: Pick<EmbeddingFailure, "kind" | "detail">): string {
  switch (f.kind) {
    case "sem_credito":
      return "a conta da OpenAI está sem crédito (é outra conta, separada do saldo da Anthropic) — adicione em platform.openai.com → Billing"
    case "chave_recusada":
      return "a OpenAI recusou a chave OPENAI_API_KEY — confira se ela está certa e ativa"
    case "chave_ausente":
      return "a chave OPENAI_API_KEY não está configurada no servidor"
    case "limite_de_ritmo":
      return "a OpenAI limitou o ritmo das chamadas — tente de novo em alguns minutos"
    case "rede":
      return "não foi possível falar com a OpenAI (rede) — tente de novo"
    case "gravacao":
      return `a gravação no banco falhou: ${f.detail}`
    case "desconhecido":
      return f.detail
  }
}

/**
 * Junta os motivos numa frase. Com um motivo só, é a descrição dele; com vários,
 * cada um diz quantas obras levou — senão "15 falharam" ao lado de dois motivos não
 * diz qual pesou.
 */
export function summarizeEmbeddingFailures(failures: readonly EmbeddingFailure[]): string {
  if (failures.length === 0) return "o motivo não foi registrado"
  if (failures.length === 1) return describeEmbeddingFailure(failures[0])
  return failures
    .map((f) => `${f.works} ${f.works === 1 ? "obra" : "obras"}: ${describeEmbeddingFailure(f)}`)
    .join("; ")
}
