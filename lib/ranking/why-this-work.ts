import { computeWorkForces } from "@/lib/calculations/forces"

/**
 * O QUE SEPARA uma obra das outras do MESMO tier.
 *
 * O tier é, por construção, o conjunto de obras que a Nota Prevista não consegue
 * distinguir: com a banda padrão (0,5), 38 das 45 obras do topo caem num tier só (84%),
 * rotulado "prioridade equivalente" (medido 2026-08-06). A view Faixas vai além e
 * escreve "↕ ordem interna aproximada" — ela admite que não sabe ordenar ali dentro.
 * Este módulo responde o que sobra da pergunta: se não dá para ordenar, dá pelo
 * menos para dizer **em que cada uma difere das vizinhas**.
 *
 * Compara as 3 forças da Bússola (Chance × Avaliação × Alcance), e não os 9
 * atributos: estes já têm os chips σ do card (`criterion-highlights.ts`), que
 * respondem "do que a obra é feita". Aqui a pergunta é outra — "que tipo de aposta
 * ela é" — e ela vive nos eixos de decisão, que hoje só aparecem na Bússola.
 *
 * 🔴 **A normalização é em σ, e isso não é firula.** As três forças têm dispersões
 * muito diferentes (medido nas 45 do topo: Chance σ 11,3 · Avaliação σ 3,7 ·
 * Alcance σ 9,6). Comparar desvio BRUTO elegeria Chance ou Alcance quase sempre e o
 * texto sairia igual em toda linha. Com σ, a força eleita se distribui de verdade —
 * no maior tier (38 obras): Alcance 11 · Chance 9 · Avaliação 7.
 *
 * ⚠️ **σ vem do conjunto EXIBIDO, não do tier.** Dentro de um tier as obras são
 * parecidas por construção, então o σ local é minúsculo e qualquer diferença viraria
 * um z gigante — a função afirmaria com força o que é ruído. O σ do conjunto exibido
 * é a régua estável: "1σ" quer dizer a mesma coisa em qualquer tier da mesma tela.
 * (Mesma escolha da Bússola, que também é relativa ao acervo exibido.)
 *
 * Puro, sem I/O: o `/ranking` já tem todas as entries em memória, então isto não
 * custa nenhuma query nova.
 */

/** As 3 forças de decisão. Mesmos nomes de `lib/calculations/forces.ts`. */
export type ForceKey = "chance" | "avaliacao" | "alcance"

export const FORCE_KEYS: readonly ForceKey[] = ["chance", "avaliacao", "alcance"] as const

/** Média e desvio-padrão de uma força no conjunto exibido. */
export interface ForceMoment {
  mean: number
  sd: number
}

export type ForceMoments = Partial<Record<ForceKey, ForceMoment>>

/** O mínimo que esta função precisa saber de uma obra. `RankingEntry` satisfaz. */
export interface WhyThisWorkInput {
  chanceScore: number | null
  platformAvg: number | null
  totalVotes: number | null
}

/**
 * Onde a obra está em relação ao GRUPO, para a frase não afirmar mais do que o
 * dado sustenta:
 *  - `max`/`min` — é o extremo ÚNICO do grupo ("a mais alta daqui")
 *  - `above`/`below` — só está de um lado da média ("acima da média daqui")
 *
 * Empate no extremo cai em `above`/`below` de propósito: com duas obras no mesmo
 * valor máximo, dizer "a mais alta" em ambas é falso nas duas.
 */
export type SeparatorRank = "max" | "min" | "above" | "below"

export interface WorkSeparator {
  force: ForceKey
  /** Valor da força nesta obra (0–100). */
  value: number
  /** (valor − média do GRUPO) ÷ σ do CONJUNTO EXIBIDO. Sinal = direção. */
  z: number
  rank: SeparatorRank
}

/**
 * Abaixo disto o desvio não sustenta uma afirmação.
 *
 * **Calibrado, não escolhido.** Medido sobre os tiers REAIS das 45 obras do topo —
 * `buildRankingTiers` com banda 0,5 e chave `roundToDisplayScore`, que é como o
 * /ranking realmente banda desde o #322. Dá **T1=7 · T2=38** (2026-08-06):
 *
 *   limiar 0,3σ  → 45/45 (100%)   ← rotula TODAS: não diferencia nada
 *   limiar 0,5σ  → 45/45 (100%)
 *   limiar 0,75σ → 41/45 (91%)
 *   limiar 1,0σ  → 33/45 (73%)    ← escolhido, é o joelho da curva
 *   limiar 1,25σ → 20/45 (44%)    ← já corta obra que de fato destoa
 *
 * Um limiar que acha diferença em toda obra é um rótulo sem informação — e essa
 * era a primeira versão deste arquivo, até a medição. Em 1σ, 27% das obras ficam
 * SEM separador, e isso é resposta, não falha: elas são de fato o miolo do tier.
 * Mesmo valor de `HIGHLIGHT_SIGMA_THRESHOLD`, para "1σ" querer dizer a mesma coisa
 * nos dois lugares do app que falam em σ.
 *
 * ⚠️ Calibrar contra o tier ERRADO muda o número: uma primeira medição bandou pela
 * nota CRUA (tiers 4/33/8) e deu 62% em vez de 73%. A chave do tier tem que ser a
 * mesma da ordenação — é a invariante que o próprio `build-tiers.ts` documenta.
 *
 * 🔴 **A calibração acima é de BANDA 0,5, e a banda virou 0,25 (migration 190,
 * 2026-08-13). Os 73% não valem mais.** Remedido no clone local no mesmo dia, com os
 * módulos de produção (`.local-experiments/diag-separador-vs-banda.ts`):
 *
 *   recorte             banda 0,5   banda 0,25
 *   topo-45 (calibração)   62,2%       53,3%
 *   topo-40 (o default)    57,5%       47,5%   ← o que a pessoa vê
 *   catálogo (981)         44,2%       43,3%
 *
 * ⚠️ Duas coisas se somaram, e separá-las importa: **os 73% já estavam velhos antes
 * da banda** — na mesma banda 0,5 o topo-45 de hoje dá 62,2%, porque o catálogo se
 * moveu (a composição medida em 06/08 era T1=7 · T2=38; hoje o topo-45 em 0,5 dá 2
 * tiers, o maior com 23). A banda tirou outros ~9 p.p. do recorte exibido, e quase
 * nada do catálogo inteiro.
 *
 * ⚠️ **Isto NÃO autoriza baixar o limiar.** `SEPARATOR_MIN_SIGMA` é deliberadamente o
 * mesmo `HIGHLIGHT_SIGMA_THRESHOLD` para "1σ" querer dizer a mesma coisa nas duas
 * telas que falam em σ; mexer aqui sem mexer lá cria a segunda régua. E cobertura
 * BAIXA não é defeito por si — o defeito documentado é a alta (rotular todo mundo).
 *
 * 🔴 **O suspeito não é o limiar: é a MÉDIA INCLUSIVA.** `mean` é a média do grupo
 * COM a própria obra dentro, então o desvio sai encolhido pelo fator exato
 * `(k−1)/k`, onde k é quantas obras do tier **têm aquela força** (não o tamanho do
 * tier: nulos saem de `peers`). Num par, ×0,50 — ou seja, a coluna é mais fraca
 * justamente no empate de duas obras, que é o caso que ela existe para resolver. E
 * estreitar a banda cria mais tiers pequenos, então o encolhimento cresce junto.
 *
 * Medido no topo-40 do clone local (banda 0,5, tiers de 22 e 18): média inclusiva
 * rotula **23 de 40**; média das OUTRAS (leave-one-out) rotula **31 de 40**. Os 23
 * foram conferidos por duas implementações independentes, que batem exatamente.
 *
 * ⚠️ **Trocar por leave-one-out é candidato, NÃO conclusão** — 31/40 é 77,5%, e a
 * própria calibração acima trata cobertura alta como o defeito a evitar. Quem decide
 * é uma medição do par (média × limiar) junto, não um patch de um lado só.
 */
export const SEPARATOR_MIN_SIGMA = 1

/** σ abaixo disto é ruído numérico (todas as obras iguais naquela força). */
const MIN_USABLE_SD = 1e-6

const forcesOf = (item: WhyThisWorkInput) =>
  computeWorkForces({
    chanceScore: item.chanceScore,
    platformAvg: item.platformAvg,
    totalVotes: item.totalVotes,
  })

/**
 * Média/σ de cada força no conjunto exibido.
 *
 * σ populacional (÷ n), igual ao `getCriterionMoments` — as duas réguas do app
 * medem a mesma coisa e precisam ser comparáveis.
 */
export function forceMomentsOf(items: readonly WhyThisWorkInput[]): ForceMoments {
  const buckets: Record<ForceKey, number[]> = { chance: [], avaliacao: [], alcance: [] }
  for (const item of items) {
    const f = forcesOf(item)
    for (const key of FORCE_KEYS) {
      const v = f[key]
      if (v != null && Number.isFinite(v)) buckets[key].push(v)
    }
  }

  const out: ForceMoments = {}
  for (const key of FORCE_KEYS) {
    const values = buckets[key]
    if (!values.length) continue
    const mean = values.reduce((a, b) => a + b, 0) / values.length
    const sd = Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length)
    out[key] = { mean, sd }
  }
  return out
}

/**
 * A força que mais separa `item` do resto de `group`.
 *
 * @param item  a obra. Precisa estar DENTRO de `group`.
 * @param group todas as obras do tier, INCLUSIVE `item` — assim não há dúvida se a
 *              média inclui a própria obra (inclui; é a média do grupo exibido).
 * @param moments σ de referência, de `forceMomentsOf(entriesExibidas)`.
 *
 * Devolve `null` quando nada sustenta uma afirmação: grupo de 1, sem moments, força
 * sem dado, σ degenerado ou nenhum |z| acima do limiar.
 */
export function whyThisWork(
  item: WhyThisWorkInput,
  group: readonly WhyThisWorkInput[],
  moments: ForceMoments | null | undefined,
  options?: { threshold?: number },
): WorkSeparator | null {
  if (!moments || group.length < 2) return null
  const threshold = options?.threshold ?? SEPARATOR_MIN_SIGMA

  const itemForces = forcesOf(item)
  const groupForces = group.map(forcesOf)

  let best: WorkSeparator | null = null

  for (const key of FORCE_KEYS) {
    const value = itemForces[key]
    if (value == null || !Number.isFinite(value)) continue

    const moment = moments[key]
    if (!moment || !Number.isFinite(moment.sd) || moment.sd < MIN_USABLE_SD) continue

    const peers = groupForces
      .map((f) => f[key])
      .filter((v): v is number => v != null && Number.isFinite(v))
    if (peers.length < 2) continue

    const mean = peers.reduce((a, b) => a + b, 0) / peers.length
    const z = (value - mean) / moment.sd
    if (!Number.isFinite(z) || Math.abs(z) < threshold) continue

    // Extremo só quando é ÚNICO: empate no topo faria "a mais alta" ser falso nas duas.
    const max = Math.max(...peers)
    const min = Math.min(...peers)
    const isUniqueMax = value === max && peers.filter((v) => v === max).length === 1
    const isUniqueMin = value === min && peers.filter((v) => v === min).length === 1
    const rank: SeparatorRank = z > 0 ? (isUniqueMax ? "max" : "above") : isUniqueMin ? "min" : "below"

    // Empate de |z| resolvido pela ordem de FORCE_KEYS, para a saída ser determinística.
    if (!best || Math.abs(z) > Math.abs(best.z)) best = { force: key, value, z, rank }
  }

  return best
}

/**
 * Quantas obras do grupo têm separador — serve ao cabeçalho do tier ("27 de 33
 * obras têm algo que as distingue") e a testar a calibragem do limiar.
 */
export function separatorCoverage(
  group: readonly WhyThisWorkInput[],
  moments: ForceMoments | null | undefined,
  options?: { threshold?: number },
): { withSeparator: number; total: number } {
  let withSeparator = 0
  for (const item of group) {
    if (whyThisWork(item, group, moments, options)) withSeparator++
  }
  return { withSeparator, total: group.length }
}
