/**
 * Limites de "Mais como estas" (`/descobrir`).
 *
 * 🔴 Mora aqui, e não em `server/queries/seed-discovery.ts`, porque a TELA precisa deles —
 * para saber quando esconder o botão "adicionar" e o que escrever em "3 de 5". Aquele módulo
 * é `server-only` e puxa `next/headers`; importar uma constante de lá num componente
 * `"use client"` arrasta a cadeia inteira para o bundle do browser e a página morre com
 * *"This API is only available in Server Components"*.
 *
 * ⚠️ O erro NÃO aparece no `tsc` — só em runtime, ao abrir a página. Foi assim que ele
 * apareceu aqui: tipos passam (são apagados na compilação), valores não.
 *
 * Mesmo motivo pelo qual `lib/ai-recommendation/limits.ts` existe separado do serviço.
 */

/** Menos de 2 sementes não define eixo nenhum — não há o que cruzar. */
export const MIN_SEEDS = 2

/**
 * Teto de sementes positivas.
 *
 * ⚠️ 5 não é número redondo escolhido no olho: quanto mais obras entram na média, mais o
 * alvo volta a se parecer com o centro do catálogo — que é exatamente o efeito que a
 * centralização existe para desfazer (ver migration 187).
 */
export const MAX_SEEDS = 5

export const MAX_ANTI_SEEDS = 3

/**
 * Quanto uma semente PRINCIPAL pesa a mais que as demais.
 *
 * 🔴 Quem aplica este número é o SQL (`find_similar_to_seeds`, migration 192) — aqui ele só
 * existe para a tela escrever "peso 2×". Constante de TS que duplica valor em vigor no banco
 * é a armadilha do `tier_band_width`, onde o código dizia 0,25, a coluna valia 0,5 e o valor
 * medido nunca esteve em vigor. Por isso `tests/unit/discovery/semente-principal.test.ts`
 * DERIVA o multiplicador do arquivo da migration e reprova se os dois divergirem.
 *
 * ⚠️ Binário de propósito, não um slider: cada regime de pesos desloca a distribuição de
 * `sim_pos`, e os cortes que dependem dela (0,15/0,28 da coesão, λ=0,8 da diversificação)
 * foram medidos com pesos iguais. "2× ou nada" é UM regime novo a remedir.
 */
export const PRIMARY_SEED_WEIGHT = 2

/** Quantas obras a página lista. */
export const DEFAULT_RESULT_LIMIT = 24

/** Quantas substitutas o "Trocar por outra" oferece. */
export const SEED_SUGGESTION_COUNT = 3

/**
 * Quantas obras vão ao modelo no "Explicar".
 *
 * ⚠️ 5, e não as 24 da lista: a chamada é cobrada por token e a prosa das últimas posições
 * não é lida.
 */
export const EXPLAIN_COUNT = 5

/**
 * Custo de UMA explicação, **medido** — não estimado.
 *
 * Execução real de 2026-08-13 (`ai_api_calls`): `recommendation_rank`, claude-sonnet-5,
 * 8.441 tokens de entrada + 2.545 de saída, 34,1 s ⇒ **US$0,0638** para as 5 obras.
 *
 * 🔴 Fica ao lado de `EXPLAIN_COUNT` de propósito: os dois números são o mesmo fato visto
 * de dois ângulos, e mexer no primeiro sem remedir o segundo faz o botão anunciar um preço
 * que já não é o cobrado. A primeira versão dizia "~5¢" por analogia com o Modo rápido — a
 * medição desmentiu em 28%.
 *
 * ⚠️ É UMA medição, não uma média: o custo sobe com sinopses e digests longos.
 */
export const EXPLAIN_COST_USD = 0.0638
