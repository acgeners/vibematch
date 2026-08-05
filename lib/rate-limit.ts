/**
 * Limite de taxa por chave, em memória. Existe por causa de UM caso concreto:
 * `searchExternalTitles` deixou de ser exclusivo do curador (2026-08-04) para o leitor poder
 * buscar e escolher a obra ao cadastrar. O docstring da action já dizia o risco disso —
 * "sem gate, é um proxy de scraping grátis, e o excesso de tráfego derruba as fontes pra todo
 * mundo" — e como `"use server"` é endpoint PÚBLICO ([[project_use_server_public_endpoints]]),
 * baixar o gate sem limite trocaria um problema por outro.
 *
 * ⚠️ **É por PROCESSO, não global.** Produção roda 2 máquinas na Fly, então o teto efetivo é o
 * dobro do configurado, e um deploy zera as contagens. Isso é aceitável aqui porque o objetivo é
 * conter abuso e rajada acidental, não cobrar cota — para cota (que exige exatidão) o padrão do
 * projeto é contar no banco, como o Deep Dive faz. Não use isto para nada que envolva dinheiro.
 */

/** Marcas de tempo dos hits recentes, por chave. */
const buckets = new Map<string, number[]>()

/**
 * Teto de chaves distintas. Sem isto o Map cresce com o número de usuários × ações e nunca
 * encolhe — vazamento lento que só aparece em produção, semanas depois.
 */
const MAX_KEYS = 5_000

/**
 * Consome um token da janela deslizante. `true` = pode seguir; `false` = estourou.
 *
 * Chame uma vez por tentativa. Uma chamada que devolve `false` NÃO registra o hit — senão um
 * cliente em retry agressivo mantém a janela cheia para sempre e o bloqueio nunca expira.
 */
export function withinRateLimit(key: string, limit: number, windowMs: number): boolean {
  const agora = Date.now()
  const desde = agora - windowMs
  const hits = (buckets.get(key) ?? []).filter((t) => t > desde)

  if (hits.length >= limit) {
    // Regrava a janela podada mesmo negando: sem isso, marcas velhas ficam no Map até o próximo
    // hit aceito, e uma chave que só recebe negativas nunca é limpa.
    buckets.set(key, hits)
    return false
  }

  hits.push(agora)
  buckets.set(key, hits)

  if (buckets.size > MAX_KEYS) podar(desde)
  return true
}

/** Descarta chaves sem hit dentro da janela. Só roda quando o Map passa do teto. */
function podar(desde: number): void {
  for (const [k, hits] of buckets) {
    const vivos = hits.filter((t) => t > desde)
    if (vivos.length === 0) buckets.delete(k)
    else buckets.set(k, vivos)
  }
}

/** Só para teste: zera o estado entre casos. */
export function resetRateLimits(): void {
  buckets.clear()
}
