import { SCORING_CRITERION_SLUGS } from "@/lib/calculations/scoring-features"
import {
  expectedOutOfFoldPredictions,
  trainExpectedPredictor,
  type ExpectedScoreInput,
} from "@/lib/calculations/expected"
import { LEGACY_SPLIT_COPY_SOURCE } from "@/lib/calculations/fantasy-drift"

/**
 * O harness que responde "setting_era e angst melhoram a previsão se entrarem no cálculo?".
 *
 * 🔴 DIAGNÓSTICO, não um segundo ranking. Nada aqui grava, e o oficial
 * (`SCORING_CRITERION_SLUGS`) não muda: o experimental é uma lista INJETADA em
 * `expectedOutOfFoldPredictions`, que produção nunca passa.
 *
 * 🔴 E ele nasce com controle por PERMUTAÇÃO porque a medição anterior mostrou que o ponto
 * isolado engana: o efeito de `setting_era` no vetor deu −0,0002, e o braço de controle com
 * RUÍDO PURO na mesma coluna deu +0,0017 — a distância entre os dois era menor que o piso.
 * Um Δ de cvMAE sem o nulo ao lado é um número bonito sem régua.
 */

/** Os 9 que o ranking real usa. */
export const OFFICIAL_CRITERIA: readonly string[] = SCORING_CRITERION_SLUGS
/** Os 2 que o producer alvo avalia e o cálculo NÃO usa — o objeto do experimento. */
export const EXPERIMENTAL_EXTRA: readonly string[] = ["setting_era", "angst"]
/** Os 9 + os 2. Ordem estável: os oficiais primeiro, para o vetor ser comparável. */
export const EXPERIMENTAL_CRITERIA: readonly string[] = [...OFFICIAL_CRITERIA, ...EXPERIMENTAL_EXTRA]

export const DEFAULT_SEED = 20260923
export const DEFAULT_PERMUTATIONS = 50
/** Abaixo disto o Ridge devolve stub; e mesmo acima, amostra pequena merece aviso na tela. */
export const MIN_TRAIN = 20
export const AMOSTRA_PEQUENA = 60

export interface ExperimentWork {
  id: string
  userScore: number
  input: ExpectedScoreInput
  /** `source` de cada critério presente. Ausente do map = a obra não tem a nota. */
  sources: Record<string, string | undefined>
}

/**
 * 🔴 "Ter o atributo de verdade" NÃO é a mesma coisa para os três.
 *
 * `fantasy` vale mesmo com `legacy_split_copy`: é a nota que a obra TEM hoje, é ela que o
 * ranking oficial usa, e exigir avaliação real deixaria a coorte em 1 obra. Já `setting_era` e
 * `angst` não têm seed nenhum — se aparecessem como cópia, seriam cópia de quê? Aceitar
 * `legacy_split_copy` neles seria admitir um valor sem origem no braço que decide o resultado.
 */
export function temCriterioReal(w: ExperimentWork, slug: string): boolean {
  const src = w.sources[slug]
  if (src === undefined) return false
  if (EXPERIMENTAL_EXTRA.includes(slug)) return src !== LEGACY_SPLIT_COPY_SOURCE
  return true
}

/** A coorte principal: obras com rótulo E os 11 atributos de verdade. */
export function selecionarCoorte(works: ExperimentWork[]): ExperimentWork[] {
  return works.filter((w) => EXPERIMENTAL_CRITERIA.every((s) => temCriterioReal(w, s)))
}

export interface Cobertura {
  rotuladas: number
  comSettingEra: number
  comAngst: number
  comAmbos: number
  /** Coorte principal: rótulo + os 11. `null` quando não há rotuladas (nunca 0/0). */
  fracaoComOsOnze: number | null
}

export function medirCobertura(works: ExperimentWork[]): Cobertura {
  const comSettingEra = works.filter((w) => temCriterioReal(w, "setting_era")).length
  const comAngst = works.filter((w) => temCriterioReal(w, "angst")).length
  const comAmbos = works.filter((w) => EXPERIMENTAL_EXTRA.every((s) => temCriterioReal(w, s))).length
  const coorte = selecionarCoorte(works).length
  return {
    rotuladas: works.length,
    comSettingEra,
    comAngst,
    comAmbos,
    // 🔴 `null`, nunca 0: sem rotuladas não é "0% de cobertura", é "não há o que medir".
    fracaoComOsOnze: works.length === 0 ? null : coorte / works.length,
  }
}

// ── métricas ────────────────────────────────────────────────────────────────────────────────
const mae = (p: number[], y: number[]) =>
  p.length === 0 ? null : p.reduce((s, v, i) => s + Math.abs(v - y[i]), 0) / p.length

/** Spearman com midrank. `null` (nunca NaN) quando a variância de um dos lados é zero. */
export function spearman(a: number[], b: number[]): number | null {
  if (a.length !== b.length || a.length < 2) return null
  const rk = (xs: number[]) => {
    const ix = xs.map((v, i) => [v, i] as const).sort((x, y) => x[0] - y[0])
    const r = new Array(xs.length).fill(0)
    let i = 0
    while (i < ix.length) {
      let j = i
      while (j + 1 < ix.length && ix[j + 1][0] === ix[i][0]) j++
      const m = (i + j) / 2 + 1
      for (let k = i; k <= j; k++) r[ix[k][1]] = m
      i = j + 1
    }
    return r
  }
  const ra = rk(a), rb = rk(b), n = a.length
  const ma = ra.reduce((s, v) => s + v, 0) / n
  const mb = rb.reduce((s, v) => s + v, 0) / n
  let num = 0, da = 0, db = 0
  for (let i = 0; i < n; i++) {
    num += (ra[i] - ma) * (rb[i] - mb)
    da += (ra[i] - ma) ** 2
    db += (rb[i] - mb) ** 2
  }
  const den = Math.sqrt(da * db)
  // Empate total dos dois lados ⇒ 0/0. Devolver NaN aqui vazaria para a tela.
  return den === 0 ? null : num / den
}

/**
 * Overlap do top-N entre duas ordenações da MESMA população.
 * ⚠️ `n` é recortado pelo tamanho da população — top-50 sobre 12 obras não é top-50.
 */
export function overlapTopN(ids: string[], a: number[], b: number[], n: number) {
  const efetivo = Math.min(n, ids.length)
  if (efetivo === 0) return { pedido: n, efetivo: 0, comum: 0 }
  const top = (v: number[]) =>
    new Set(ids.map((id, i) => [id, v[i]] as const)
      .sort((x, y) => y[1] - x[1]).slice(0, efetivo).map(([id]) => id))
  const A = top(a), B = top(b)
  return { pedido: n, efetivo, comum: [...A].filter((x) => B.has(x)).length }
}

/** LCG determinístico — mesma seed, mesma sequência, em qualquer máquina. */
function rng(seed: number) {
  let s = seed >>> 0
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 0x100000000 }
}

/**
 * Embaralha os valores de `setting_era`/`angst` ENTRE as obras da coorte.
 *
 * 🔴 É este o nulo certo, e não "ruído aleatório": ele preserva a distribuição real dos dois
 * atributos e destrói só a ASSOCIAÇÃO com a obra. Se o arranjo verdadeiro não bate o sorteado,
 * a coluna não carrega informação — foi assim que `setting_era` deu p = 0,26 na auditoria.
 */
export function permutarExtras(coorte: ExperimentWork[], seed: number): ExperimentWork[] {
  const r = rng(seed)
  const embaralhar = <T,>(xs: T[]) => {
    const o = [...xs]
    for (let i = o.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [o[i], o[j]] = [o[j], o[i]] }
    return o
  }
  const sorteado: Record<string, number[]> = {}
  for (const slug of EXPERIMENTAL_EXTRA) {
    sorteado[slug] = embaralhar(coorte.map((w) => Number(w.input.categoryScores[slug as never])))
  }
  return coorte.map((w, i) => ({
    ...w,
    input: {
      ...w.input,
      categoryScores: {
        ...w.input.categoryScores,
        ...Object.fromEntries(EXPERIMENTAL_EXTRA.map((s) => [s, sorteado[s][i]])),
      },
    },
  }))
}

const oof = (ws: ExperimentWork[], criterios: readonly string[]) =>
  expectedOutOfFoldPredictions(
    ws.map((w) => w.input), ws.map((w) => w.userScore), false, 5, false,
    { criterionSlugs: criterios },
  )

export interface BracoDoExperimento {
  criterios: readonly string[]
  assinatura: string
  cvMae: number | null
  /** Correlação da predição OOF com o `user_score`. */
  rhoComRotulo: number | null
  /** Coeficiente do Ridge por critério, treinado na coorte inteira. */
  coeficientes: Array<{ slug: string; coef: number }>
}

export interface ResultadoPrincipal {
  n: number
  amostraPequena: boolean
  /** `null` quando a coorte é menor que o mínimo do Ridge — nunca NaN. */
  oficial: BracoDoExperimento | null
  experimental: BracoDoExperimento | null
  deltaCvMae: number | null
  spearmanEntreOsDois: number | null
  top10: { pedido: number; efetivo: number; comum: number } | null
  top50: { pedido: number; efetivo: number; comum: number } | null
  nulo: {
    permutacoes: number
    media: number
    desvio: number
    /** Δ real em unidades de desvio do nulo. `null` se o nulo for degenerado. */
    z: number | null
    /** Fração de sorteios com Δ tão bom quanto o real (regra de sucessão). */
    p: number
  } | null
}

function braco(ws: ExperimentWork[], criterios: readonly string[]): BracoDoExperimento | null {
  const pred = oof(ws, criterios)
  if (!pred) return null
  const y = ws.map((w) => w.userScore)
  const modelo = trainExpectedPredictor(ws.map((w) => w.input), y, false, false, {
    criterionSlugs: criterios,
  })
  const coeficientes = criterios.map((slug, i) => ({
    slug,
    coef: modelo.model.coefficients[i] ?? 0,
  }))
  return {
    criterios,
    assinatura: criterios.join(","),
    cvMae: mae(pred, y),
    rhoComRotulo: spearman(pred, y),
    coeficientes,
  }
}

export function rodarAnalisePrincipal(
  works: ExperimentWork[],
  { permutacoes = DEFAULT_PERMUTATIONS, seed = DEFAULT_SEED } = {},
): ResultadoPrincipal {
  const coorte = selecionarCoorte(works)
  const base: ResultadoPrincipal = {
    n: coorte.length,
    amostraPequena: coorte.length < AMOSTRA_PEQUENA,
    oficial: null, experimental: null, deltaCvMae: null,
    spearmanEntreOsDois: null, top10: null, top50: null, nulo: null,
  }
  if (coorte.length < MIN_TRAIN) return base

  // 🔴 Os DOIS braços na MESMA coorte, com os MESMOS folds (mesmo seed interno do OOF).
  // Comparar populações diferentes mediria a coorte, não os critérios.
  const oficial = braco(coorte, OFFICIAL_CRITERIA)
  const experimental = braco(coorte, EXPERIMENTAL_CRITERIA)
  if (!oficial || !experimental) return base

  const pa = oof(coorte, OFFICIAL_CRITERIA)!
  const pb = oof(coorte, EXPERIMENTAL_CRITERIA)!
  const ids = coorte.map((w) => w.id)
  const delta =
    oficial.cvMae != null && experimental.cvMae != null ? experimental.cvMae - oficial.cvMae : null

  let nulo: ResultadoPrincipal["nulo"] = null
  if (delta != null && permutacoes > 0) {
    const ds: number[] = []
    for (let i = 0; i < permutacoes; i++) {
      const p = oof(permutarExtras(coorte, seed + i), EXPERIMENTAL_CRITERIA)
      const m = p ? mae(p, coorte.map((w) => w.userScore)) : null
      if (m != null && oficial.cvMae != null) ds.push(m - oficial.cvMae)
    }
    if (ds.length > 0) {
      const media = ds.reduce((s, v) => s + v, 0) / ds.length
      const desvio =
        ds.length > 1
          ? Math.sqrt(ds.reduce((s, v) => s + (v - media) ** 2, 0) / (ds.length - 1))
          : 0
      const melhores = ds.filter((v) => v <= delta).length
      nulo = {
        permutacoes: ds.length,
        media,
        desvio,
        // Desvio zero ⇒ z seria ±Infinity. `null` diz "o nulo não tem dispersão para medir".
        z: desvio > 0 ? (delta - media) / desvio : null,
        p: (melhores + 1) / (ds.length + 1),
      }
    }
  }

  return {
    ...base,
    oficial,
    experimental,
    deltaCvMae: delta,
    spearmanEntreOsDois: spearman(pa, pb),
    top10: overlapTopN(ids, pa, pb, 10),
    top50: overlapTopN(ids, pa, pb, 50),
    nulo,
  }
}

export interface ResultadoSecundario {
  n: number
  cobertura: Cobertura
  maeOficial: number | null
  maeExperimental: number | null
  delta: number | null
}

/**
 * 🔴 DIAGNÓSTICA, não evidência. Roda sobre TODAS as rotuladas e deixa a imputação pela mediana
 * preencher `setting_era`/`angst` onde faltam — o que torna a coluna quase-constante e faz o
 * braço experimental parecer inerte por CONSTRUÇÃO, não por medição. Serve para ver o efeito
 * no catálogo inteiro; quem decide é a coorte completa.
 */
export function rodarAnaliseSecundaria(works: ExperimentWork[]): ResultadoSecundario {
  const cobertura = medirCobertura(works)
  const base = { n: works.length, cobertura, maeOficial: null, maeExperimental: null, delta: null }
  if (works.length < MIN_TRAIN) return base
  const y = works.map((w) => w.userScore)
  const a = oof(works, OFFICIAL_CRITERIA)
  const b = oof(works, EXPERIMENTAL_CRITERIA)
  const ma = a ? mae(a, y) : null
  const mb = b ? mae(b, y) : null
  return { ...base, maeOficial: ma, maeExperimental: mb, delta: ma != null && mb != null ? mb - ma : null }
}
