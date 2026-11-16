import { displayChance } from "@/lib/calculations/forces"
import { roundToDisplayScore } from "@/lib/score-rounding"
import { ARCHETYPE_LABEL } from "@/lib/ranking/tier-composition"
import { CORNER_ARCHETYPE } from "@/lib/ranking/archetype-style"

/**
 * As contas da Bússola do /ranking (o mapa de capas), separadas do componente para serem
 * testáveis sem layout: posição por percentil, marcas dos eixos com o valor real, separação das
 * capas que caem no mesmo lugar e onde cabe cada nome.
 *
 * Desenho aprovado no mockup de 16/11/2026 (capas no lugar das bolinhas, sem cor por tipo de
 * aposta, três pares de eixos, ligações ao clicar).
 */

export type BussolaMeasureKey = "chance" | "crit" | "votes"
export type BussolaFaceKey = "cc" | "cv" | "cr"

/** O mínimo que o mapa lê de cada obra. */
export interface BussolaMeasureInput {
  chanceScore: number | null
  platformAvg: number | null
  totalVotes: number
}

/**
 * Dado mínimo que a Bússola consome. `RankingEntry` (do /ranking) satisfaz esta forma
 * estruturalmente; o WorkCompareDrawer mapeia CompareWork pra cá.
 */
export interface BussolaDatum extends BussolaMeasureInput {
  workId: string
  title: string
  coverUrls: string[]
  year: number | null
  /**
   * Classificação da obra (`works.is_adult`). OBRIGATÓRIO de propósito: opcional, um consumidor
   * novo esqueceria de mapear e a Bússola dele ficaria sem o selo **sem erro nenhum** — como já
   * aconteceu com o `WorkCompareDrawer`, que só ganhou o campo quando o `tsc` reprovou.
   */
  isAdult: boolean
  /** Obra `mixed` (versão normal + R18) — decide o selo junto com `isAdult` (`workContentBadge`). */
  isMixed: boolean
  publicationStatus?: string | null
  publicationStatusShort?: string | null
  publicationStatusColor?: string | null
  expectedScore: number | null
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

const fmt1 = (n: number) => n.toFixed(1).replace(".", ",")

/** Votos curtos, para marca de eixo e coluna estreita ("23 mil"). */
export function formatVotesShort(v: number): string {
  if (v >= 1000) return `${(v / 1000).toFixed(v >= 10000 ? 0 : 1).replace(".", ",")} mil`
  return `${v}`
}

export interface BussolaMeasure {
  label: string
  /** Cabeçalho da coluna da lista. */
  col: string
  /** Título do eixo no mapa. */
  axis: string
  /** Classe de cor do texto (a mesma cor para a medida em todo o mapa). */
  text: string
  /** Cor de preenchimento (barras do painel). */
  fill: string
  /**
   * O valor que POSICIONA e ORDENA. É o número da tela (chance inteira, nota com uma casa), não o
   * decimal cru: posição e lista não podem discordar do que está impresso
   * (`roundToDisplayScore`, `displayChance`).
   */
  value: (w: BussolaMeasureInput) => number | null
  show: (v: number) => string
  tick: (v: number) => string
}

export const BUSSOLA_MEASURES: Record<BussolaMeasureKey, BussolaMeasure> = {
  chance: {
    label: "Chance de você gostar",
    col: "Chance",
    axis: "chance de você gostar",
    text: "text-violet-600 dark:text-violet-400",
    fill: "bg-violet-500 dark:bg-violet-400",
    value: (w) => displayChance(w.chanceScore),
    show: (v) => `${v}%`,
    tick: (v) => `${v}%`,
  },
  crit: {
    label: "Nota da crítica",
    col: "Crítica",
    axis: "★ crítica",
    text: "text-amber-600 dark:text-amber-400",
    fill: "bg-amber-500 dark:bg-amber-400",
    value: (w) => (w.platformAvg != null ? roundToDisplayScore(w.platformAvg) : null),
    show: (v) => fmt1(v),
    tick: (v) => `★ ${fmt1(v)}`,
  },
  votes: {
    label: "Quanta gente leu",
    col: "Votos",
    axis: "votos",
    text: "text-slate-500 dark:text-slate-300",
    fill: "bg-slate-400 dark:bg-slate-300",
    value: (w) => w.totalVotes,
    show: (v) => formatVotesShort(v),
    tick: (v) => formatVotesShort(v),
  },
}

export interface BussolaFace {
  x: BussolaMeasureKey
  y: BussolaMeasureKey
  label: string
  sub: string
  lede: string
  /** Nome de cada canto. Em Chance × Crítica, são os tipos de aposta. */
  quad: { tr: string; tl: string; br: string; bl: string }
}

export const BUSSOLA_FACES: Record<BussolaFaceKey, BussolaFace> = {
  cc: {
    x: "chance",
    y: "crit",
    label: "Chance × Crítica",
    sub: "para decidir",
    lede: "Direita: mais chance de você gostar. Em cima: a crítica gosta mais.",
    // Neste par os cantos SÃO os tipos de aposta: o nome sai do mesmo lugar que a view Cards usa.
    quad: {
      tr: capitalize(ARCHETYPE_LABEL[CORNER_ARCHETYPE.tr]),
      tl: capitalize(ARCHETYPE_LABEL[CORNER_ARCHETYPE.tl]),
      br: capitalize(ARCHETYPE_LABEL[CORNER_ARCHETYPE.br]),
      bl: capitalize(ARCHETYPE_LABEL[CORNER_ARCHETYPE.bl]),
    },
  },
  cv: {
    x: "chance",
    y: "votes",
    label: "Chance × Alcance",
    sub: "para descobrir",
    lede: "Direita: mais chance de você gostar. Em cima: mais gente leu. Embaixo à direita ficam as que combinam com você e pouca gente conhece.",
    quad: { tr: "Sucesso do teu tipo", tl: "Popular, fora do teu perfil", br: "Joia escondida", bl: "Fundo de catálogo" },
  },
  cr: {
    x: "crit",
    y: "votes",
    label: "Crítica × Alcance",
    sub: "sem o teu gosto",
    lede: "Direita: a crítica gosta mais. Em cima: mais gente leu. O tipo de aposta de cada obra fica no painel dela.",
    quad: { tr: "Consagrada", tl: "Popular e dividida", br: "Cult pouco lida", bl: "Fundo de catálogo" },
  },
}

export const archetypeName = (label: string) => capitalize(label)

export const BUSSOLA_FACE_ORDER: BussolaFaceKey[] = ["cc", "cv", "cr"]

export const isBussolaFaceKey = (v: unknown): v is BussolaFaceKey =>
  typeof v === "string" && (BUSSOLA_FACE_ORDER as string[]).includes(v)

/**
 * Percentil midrank (0–100) de `v` entre `values`. A mediana divide a tela em duas metades, e
 * empate fica no meio do degrau dele.
 */
export function percentileFn(values: number[]): (v: number) => number {
  const sorted = [...values].sort((a, b) => a - b)
  return (v) => {
    if (sorted.length === 0) return 50
    let less = 0
    let eq = 0
    for (const x of sorted) {
      if (x < v) less++
      else if (x === v) eq++
    }
    return ((less + eq / 2) / sorted.length) * 100
  }
}

/** Valor real na posição `p` (0–100) da ordem: é o que as marcas do eixo imprimem. */
export function quantileOf(values: number[], p: number): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const i = Math.min(sorted.length - 1, Math.max(0, Math.round((p / 100) * (sorted.length - 1))))
  return sorted[i]
}

/**
 * Margens da área dos pontos dentro do mapa, em px. Em cima ficam o título do eixo vertical e os
 * cantos de cima; embaixo, as marcas do eixo horizontal, o título dele e os cantos de baixo; à
 * esquerda, as marcas do eixo vertical. Nenhum texto fica atrás de uma capa.
 */
export const BUSSOLA_INSET = { left: 66, right: 30, top: 50, bottom: 72 } as const

/**
 * Lado da capa, o MESMO para todas as obras, proporcional ao mapa: ~42px no mapa normal (560px de
 * altura) e ~72–78px na tela inteira. O tamanho por alcance saiu (pedido da Ana, 16/11/2026): ele
 * não tinha legenda e brigava com a capa. A largura também conta, mas só morde em tela estreita
 * (no celular a área tem ~230px e 40 capas de 40px viravam uma pilha só).
 */
export function coverSizeFor(innerHeight: number, innerWidth = Infinity): number {
  return Math.round(Math.max(32, Math.min(78, innerHeight * 0.095, innerWidth * 0.075)))
}

export interface CoverPoint {
  id: string
  /** Percentil (0–100) nos dois eixos. */
  x: number
  y: number
}

export interface PlacedCover {
  /** Centro da capa, em px dentro da área dos pontos (y cresce para baixo). */
  x: number
  y: number
  /** Lugar real (sem o afastamento), em px. */
  ox: number
  oy: number
}

/**
 * Capas que caem no mesmo lugar se empurram até se sobreporem no máximo pela METADE (os centros a
 * pelo menos meia capa de distância, em cada eixo). Separar por inteiro espalhava os grupos e
 * apagava a diferença entre eles (escolha da Ana).
 *
 * Duas amarras: cada capa é puxada de leve de volta ao lugar real, e NUNCA cruza a mediana — o
 * canto (no par principal, o tipo de aposta) não muda por causa do afastamento. A capa inteira
 * fica dentro da área, sem cobrir as marcas dos eixos.
 *
 * Determinístico: o mesmo conjunto dá sempre o mesmo desenho (o empurrão inicial que desfaz empate
 * exato vem do índice, não de sorteio).
 */
export function separateCovers(points: CoverPoint[], W: number, H: number, size: number): Map<string, PlacedCover> {
  const minD = size * 0.5
  const half = size / 2
  const pts = points.map((p, i) => {
    const ox = (p.x / 100) * W
    const oy = H - (p.y / 100) * H
    return {
      id: p.id,
      ox,
      oy,
      x: ox + (((i * 37) % 7) - 3) * 0.6,
      y: oy + (((i * 53) % 7) - 3) * 0.6,
      right: p.x >= 50,
      top: p.y >= 50,
    }
  })
  const keep = (q: (typeof pts)[number]) => {
    q.x = q.right ? Math.max(W / 2, Math.min(W - half, q.x)) : Math.min(W / 2, Math.max(half, q.x))
    q.y = q.top ? Math.min(H / 2, Math.max(half, q.y)) : Math.max(H / 2, Math.min(H - half, q.y))
  }
  const push = () => {
    for (let a = 0; a < pts.length; a++) {
      for (let b = a + 1; b < pts.length; b++) {
        const A = pts[a]
        const B = pts[b]
        const dx = B.x - A.x
        const dy = B.y - A.y
        const ovx = minD - Math.abs(dx)
        const ovy = minD - Math.abs(dy)
        if (ovx <= 0 || ovy <= 0) continue
        // Empurra pelo eixo de MENOR sobreposição: é o caminho mais curto até o limite.
        if (ovx < ovy) {
          const d = ((dx >= 0 ? 1 : -1) * ovx) / 2
          A.x -= d
          B.x += d
        } else {
          const d = ((dy >= 0 ? 1 : -1) * ovy) / 2
          A.y -= d
          B.y += d
        }
      }
    }
  }
  pts.forEach(keep)
  for (let it = 0; it < 160; it++) {
    push()
    for (const q of pts) {
      q.x += (q.ox - q.x) * 0.03
      q.y += (q.oy - q.y) * 0.03
      keep(q)
    }
  }
  // Acabamento sem a mola: ela roda depois do empurrão e deixava a sobreposição ~3% acima da
  // metade. Aqui só empurra e respeita a mediana e as bordas.
  for (let it = 0; it < 40; it++) {
    push()
    pts.forEach(keep)
  }
  return new Map(pts.map((q) => [q.id, { x: q.x, y: q.y, ox: q.ox, oy: q.oy }]))
}

/** Largura estimada de um nome a 11px/600 (o mapa não depende de canvas para medir). */
export const estimateLabelWidth = (text: string) => text.length * 6.3 + 6
export const LABEL_HEIGHT = 14
const LABEL_MAX_CHARS = 24

export interface LabelRequest {
  id: string
  title: string
  /** 0 = obra clicada, 1 = ligada a ela, 2 = as demais (só com "Todos os nomes"). */
  rank: 0 | 1 | 2
  /** Lado efetivo da capa (já com o zoom da clicada/ligada). */
  size: number
}

export interface PlacedLabel {
  id: string
  text: string
  rank: 0 | 1 | 2
  x: number
  y: number
  w: number
}

/**
 * Nome ao lado de cada capa: tenta à direita, à esquerda, em cima e embaixo; se nenhum lugar cabe
 * sem cobrir outro nome ou outra capa, o nome fica para o mouse. A obra clicada e as ligadas vêm
 * primeiro e com o nome inteiro; as demais, cortadas em 24 caracteres. `requests` já vem na ordem
 * de prioridade.
 */
export function placeLabels(
  requests: LabelRequest[],
  covers: Array<{ id: string; x: number; y: number; size: number }>,
  W: number,
  H: number,
  measure: (text: string) => number = estimateLabelWidth,
): PlacedLabel[] {
  const coverBoxes = covers.map((c) => {
    const r = c.size / 2 + 1
    return { id: c.id, x1: c.x - r, x2: c.x + r, y1: c.y - r, y2: c.y + r }
  })
  const centers = new Map(covers.map((c) => [c.id, c]))
  const placed: Array<{ x1: number; x2: number; y1: number; y2: number }> = []
  const overlaps = (a: { x1: number; x2: number; y1: number; y2: number }, b: typeof a) =>
    a.x1 < b.x2 && a.x2 > b.x1 && a.y1 < b.y2 && a.y2 > b.y1
  const out: PlacedLabel[] = []
  for (const req of requests) {
    const c = centers.get(req.id)
    if (!c) continue
    const text =
      req.rank < 2 || req.title.length <= LABEL_MAX_CHARS
        ? req.title
        : `${req.title.slice(0, LABEL_MAX_CHARS - 1).trimEnd()}…`
    const w = measure(text)
    const h = LABEL_HEIGHT
    const half = req.size / 2 + 4
    const tries = [
      { x: c.x + half, y: c.y - h / 2 },
      { x: c.x - half - w, y: c.y - h / 2 },
      { x: c.x - w / 2, y: c.y - half - h },
      { x: c.x - w / 2, y: c.y + half },
    ]
    const spot = tries.find((t) => {
      const box = { x1: t.x, x2: t.x + w, y1: t.y, y2: t.y + h }
      if (box.x1 < 0 || box.x2 > W || box.y1 < 0 || box.y2 > H) return false
      if (placed.some((p) => overlaps(box, p))) return false
      return !coverBoxes.some((q) => q.id !== req.id && overlaps(box, q))
    })
    if (!spot) continue
    placed.push({ x1: spot.x, x2: spot.x + w, y1: spot.y, y2: spot.y + h })
    out.push({ id: req.id, text, rank: req.rank, x: spot.x, y: spot.y, w })
  }
  return out
}

/** As `k` obras mais próximas na face atual (distância em percentil). */
export function nearestOnFace(
  id: string,
  positions: Map<string, { x: number; y: number }>,
  k = 4,
): string[] {
  const me = positions.get(id)
  if (!me) return []
  return [...positions.entries()]
    .filter(([other]) => other !== id)
    .map(([other, p]) => ({ other, d: Math.hypot(p.x - me.x, p.y - me.y) }))
    .sort((a, b) => a.d - b.d || (a.other < b.other ? -1 : 1))
    .slice(0, k)
    .map((r) => r.other)
}
