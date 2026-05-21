/**
 * Cliente fino pra OpenAI embeddings via fetch (sem dependência npm).
 *
 * Modelo: text-embedding-3-small (1536 dims, $0.02/M tokens).
 * Suporta batch de até 100 inputs por request com retry exponencial em
 * erros transientes (429 / 5xx).
 */

const EMBEDDING_MODEL = "text-embedding-3-small"
const EMBEDDING_DIMENSIONS = 1536
const MAX_BATCH_SIZE = 100
const MAX_RETRIES = 3
const BASE_RETRY_DELAY_MS = 1000

const OPENAI_EMBEDDINGS_URL = "https://api.openai.com/v1/embeddings"

interface OpenAIEmbeddingResponse {
  data: Array<{ embedding: number[]; index: number }>
  model: string
  usage: { prompt_tokens: number; total_tokens: number }
}

interface OpenAIErrorResponse {
  error?: { message?: string; type?: string; code?: string }
}

export interface EmbeddingBatchResult {
  vectors: number[][]
  tokensUsed: number
}

function getApiKey(): string {
  const key = process.env.OPENAI_API_KEY
  if (!key) {
    throw new Error(
      "OPENAI_API_KEY não configurada — defina em .env.local pra gerar embeddings.",
    )
  }
  return key
}

async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

async function callOpenAIBatch(texts: string[]): Promise<EmbeddingBatchResult> {
  const apiKey = getApiKey()

  let lastError: unknown = null
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const response = await fetch(OPENAI_EMBEDDINGS_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: EMBEDDING_MODEL,
          input: texts,
        }),
      })

      if (!response.ok) {
        // Retry em 429 (rate limit) e 5xx (server). Outros são erros do cliente.
        const isTransient = response.status === 429 || response.status >= 500
        const body = (await response.json().catch(() => ({}))) as OpenAIErrorResponse
        const msg = body?.error?.message ?? response.statusText
        if (isTransient && attempt < MAX_RETRIES - 1) {
          const wait = BASE_RETRY_DELAY_MS * Math.pow(2, attempt)
          console.warn(
            `[embeddings] HTTP ${response.status}: ${msg}. Retry em ${wait}ms (${attempt + 1}/${MAX_RETRIES})`,
          )
          await delay(wait)
          continue
        }
        throw new Error(`OpenAI embeddings falhou (${response.status}): ${msg}`)
      }

      const data = (await response.json()) as OpenAIEmbeddingResponse
      // Ordena por `index` pra garantir alinhamento com o array de entrada
      // (a API geralmente retorna em ordem, mas é defensivo).
      const sorted = [...data.data].sort((a, b) => a.index - b.index)
      const vectors = sorted.map((d) => d.embedding)

      if (vectors.length !== texts.length) {
        throw new Error(
          `OpenAI retornou ${vectors.length} vetores pra ${texts.length} inputs.`,
        )
      }
      for (const v of vectors) {
        if (v.length !== EMBEDDING_DIMENSIONS) {
          throw new Error(
            `Vetor com dimensão inesperada: ${v.length} (esperado ${EMBEDDING_DIMENSIONS}).`,
          )
        }
      }

      return {
        vectors,
        tokensUsed: data.usage?.total_tokens ?? 0,
      }
    } catch (err) {
      lastError = err
      // Erros de rede tipicamente não dão response.ok=false; retry com backoff
      if (attempt < MAX_RETRIES - 1 && err instanceof TypeError) {
        const wait = BASE_RETRY_DELAY_MS * Math.pow(2, attempt)
        console.warn(`[embeddings] erro de rede: ${err.message}. Retry em ${wait}ms.`)
        await delay(wait)
        continue
      }
      throw err
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("Falha desconhecida ao chamar OpenAI embeddings.")
}

/**
 * Embeda um array de textos arbitrário. Faz batching automático e agrega
 * resultados. Mantém a ordem do input.
 */
export async function embedTexts(texts: string[]): Promise<EmbeddingBatchResult> {
  if (texts.length === 0) return { vectors: [], tokensUsed: 0 }

  const allVectors: number[][] = []
  let totalTokens = 0

  for (let i = 0; i < texts.length; i += MAX_BATCH_SIZE) {
    const batch = texts.slice(i, i + MAX_BATCH_SIZE)
    const result = await callOpenAIBatch(batch)
    allVectors.push(...result.vectors)
    totalTokens += result.tokensUsed
  }

  return { vectors: allVectors, tokensUsed: totalTokens }
}

export { EMBEDDING_MODEL, EMBEDDING_DIMENSIONS, MAX_BATCH_SIZE }
