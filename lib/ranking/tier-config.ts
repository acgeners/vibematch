import { z } from "zod"

/**
 * Largura da banda de tiers do ranking. É uma regra de AGRUPAMENTO/APRESENTAÇÃO
 * (não faz parte da fórmula do score) — por isso vive em `lib/ranking`, não em
 * `lib/calculations`. Persistida em `formula_config.tier_band_width` para ser
 * ajustável SEM mudança de código; esta constante é só o fallback.
 *
 * ## 0,5 era PROVISÓRIO. Isto aqui é o resultado da medição que ele pedia.
 *
 * O tier promete "prioridade equivalente". A pergunta que valida a largura é
 * direta: **dos pares que a banda declara equivalentes, quantos a Nota Prevista
 * teria ordenado corretamente?** Se ~50%, agrupar é honesto — a Prevista não
 * sabia mesmo. Se bem mais, a banda está jogando fora sinal que existia.
 *
 * Medido em 2026-08-06 sobre as 206 obras com nota do usuário (todos os pares,
 * empates de nota real excluídos):
 *
 *   banda 0,20 → 52,7%   honesto
 *   banda 0,25 → 53,3%   honesto  ← ESCOLHIDO
 *   banda 0,30 → 53,8%   honesto
 *   banda 0,35 → 55,0%   limítrofe
 *   banda 0,50 → 57,9%   jogava fora sinal (era o valor anterior)
 *   banda 0,73 → 60,8%   claramente errado
 *
 * Isso deixa 0,20–0,30 empatados em honestidade (a diferença cabe no ruído: 206
 * obras geram ~21 mil pares que NÃO são independentes, então o n efetivo é bem
 * menor que a contagem). O desempate vem de duas medidas sobre o catálogo (975
 * obras com Prevista), e é aí que 0,25 ganha:
 *
 *   banda   tiers   maior tier   tiers de 1 obra   ESTABILIDADE (reamostra 60%, 200×)
 *   0,20     18      183 (19%)          2           17,0% ± 2,5   ← começa a estilhaçar
 *   0,25     15      192 (20%)          1           19,9% ± 0,7   ← o mais estável
 *   0,30     13      242 (25%)          1           26,2% ± 1,3
 *   0,50      8      375 (38%)          0           38,6% ± 1,2   ← anterior
 *
 * 0,25 é tão honesto quanto 0,20/0,30, distribui melhor que 0,30 e é o menos
 * sensível à composição do catálogo — o que importa porque o catálogo cresce.
 *
 * 🔴 **"Banda = erro do modelo" é a intuição errada, e o dado mostra por quê.**
 * O `cv_mae_expected_stage1` é 0,69 — mas com Δ 0,7 a Prevista já ordena 61% dos
 * pares certo. O MAE mede calibração ABSOLUTA; a banda precisa do limiar de
 * DISCRIMINAÇÃO par-a-par, que é bem menor. Usar o MAE como banda agruparia obras
 * que o modelo sabe separar.
 *
 * 🔴 **NÃO calibre a banda olhando o topo da lista — lá ela não é um botão
 * monotônico.** Como o tier ancora na PRIMEIRA obra do grupo, num recorte estreito
 * o resultado depende de onde a âncora cai, e anda para trás. Medido no topo-40
 * (que ocupa só 0,7 ponto, de 9,1 a 8,4):
 *
 *   0,20 → 3·10·27 (maior 27)      0,35 → 6·34 (maior 34)
 *   0,25 → 3·20·17 (maior 20)      0,45 → 13·27 (maior 27)
 *   0,30 → 6·34   (maior 34)       0,50 → 23·17 (maior 23)
 *
 * Estreitar de 0,30 para 0,25 MELHORA o topo; de 0,35 para 0,30 não muda nada; e
 * 0,50 parece melhor que 0,30. É artefato da âncora, não sinal. O critério válido
 * é o pairwise (que independe do recorte) + o catálogo inteiro.
 *
 * ⚠️ **Nada disto conserta o amontoamento do topo**, e é honesto dizer: aquelas
 * 40 obras ocupam 1,27 ponto de amplitude. A banda controla se o agrupamento é
 * honesto; ela não cria separação que a nota não tem. Ver `why-this-work.ts`.
 *
 * Remedir quando o número de obras avaliadas crescer bastante (hoje 206).
 */
export const DEFAULT_TIER_BAND_WIDTH = 0.25

// Mesmo range do CHECK da migration 104 (0,05–2). Banda fora disso é erro.
export const tierBandWidthSchema = z.number().min(0.05).max(2)

/**
 * Resolve a largura vinda do banco. Usa o default APENAS quando o valor está
 * ausente (sem registro de config / coluna ainda não migrada → `null`/`undefined`).
 * Um valor presente porém inválido (fora do range) NÃO é mascarado silenciosamente:
 * loga e cai no default. `numeric` do Postgres pode chegar como string.
 */
export function resolveTierBandWidth(raw: unknown): number {
  if (raw == null) return DEFAULT_TIER_BAND_WIDTH
  const value = typeof raw === "string" ? Number(raw) : raw
  const parsed = tierBandWidthSchema.safeParse(value)
  if (!parsed.success) {
    console.warn(`[ranking] tier_band_width inválido (${String(raw)}); usando default ${DEFAULT_TIER_BAND_WIDTH}`)
    return DEFAULT_TIER_BAND_WIDTH
  }
  return parsed.data
}
