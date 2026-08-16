import { CRITERIA_INFO, CRITERIA_RUBRICS } from "@/lib/constants/criteria"
import { bandBarBounds } from "@/lib/criteria/justification"
import { CRITERION_SLUGS } from "@/types/domain"
import { GLOSSARY_NOTES, type GlossaryNote } from "@/lib/criteria/glossary-notes"

/**
 * O dicionário dos 9 atributos (`/guide/attributes`) montado a partir da MESMA rubrica que
 * entra no prompt da avaliação — `criteria.description` e `criteria.ranges` no Supabase,
 * via `sync-constants`. Nada aqui é escrito à mão.
 *
 * 🔴 Isso não é preciosismo de arquitetura: a rubrica é editada no banco, e uma segunda
 * cópia em prosa envelheceria em silêncio. A página existe justamente para responder "o que
 * significa romance 7,5?" — se ela responder diferente do que o modelo leu, é pior do que
 * não existir. Mesma régua do `CRITERIA_SCALE_LEGEND` dos prompts de ranking.
 */
export interface GlossaryBand {
  /** Faixa como a rubrica a escreve: "0-3", "4-6", "7-8", "9-10". */
  band: string
  /** Rótulo curto e canônico: "Ausente", "Substancial", "Smut". */
  label: string
  /** A definição inteira da faixa — não a primeira frase (isso é `rubricSummary`). */
  text: string
  /** O que a faixa COBRE de fato, já em português: "0,0–3,9". Ver o ⚠️ abaixo. */
  covers: string
}

export interface GlossaryEntry {
  slug: string
  name: string
  emoji: string
  description: string
  bands: GlossaryBand[]
  note: GlossaryNote | null
}

/**
 * "0-3 | Ausente: nenhum conteúdo romântico…" → as três partes.
 *
 * Faixa sem "|" (rubrica escrita como frase corrida) devolve o texto inteiro como rótulo e
 * fica sem definição — degrada para menos informação, nunca para informação errada. Dar
 * apelido curto a ela é edição de banco, não de código.
 */
function parseRange(range: string): { band: string; label: string; text: string } | null {
  const bruto = range.trim()
  const barra = bruto.indexOf("|")
  if (barra === -1) return null
  const band = bruto.slice(0, barra).trim()
  const resto = bruto.slice(barra + 1).trim()
  const doisPontos = resto.indexOf(":")
  if (doisPontos === -1) return { band, label: resto, text: "" }
  return {
    band,
    label: resto.slice(0, doisPontos).trim(),
    text: capitalizar(resto.slice(doisPontos + 1).trim()),
  }
}

/**
 * A rubrica é escrita como continuação do rótulo ("Ausente: nenhuma perda irreversível…"),
 * então o texto começa em minúscula. Isolado num parágrafo próprio ele vira frase, e frase
 * começa com maiúscula. Só a primeira letra — a CAIXA ALTA do meio ("NÃO conta", "DIREÇÃO
 * da trama") é ênfase dirigida ao modelo e fica: reescrevê-la seria manter uma segunda
 * versão do texto que a IA leu.
 */
function capitalizar(texto: string): string {
  if (!texto) return texto
  return texto[0].toUpperCase() + texto.slice(1)
}

/**
 * ⚠️ O rótulo da faixa MENTE sobre o meio ponto, e é por isso que esta linha existe.
 *
 * Os bins são de inteiros e não se tocam: escritos como "0-3" e "4-6", nenhum contém 3,5.
 * O bin REAL é semiaberto — "7-8" cobre [7, 9) —, que é o que `bandBarBounds` devolve e o
 * que `bandForScore` aplica. Imprimir "7–8" sem dizer que 8,5 cai ali faz a página
 * contradizer a nota que a obra exibe.
 */
function coverageLabel(band: string): string {
  const [lo, hi] = bandBarBounds(band)
  const fim = hi >= 10 ? "10" : `${(hi - 0.1).toFixed(1).replace(".", ",")}`
  return `${lo.toFixed(1).replace(".", ",")}–${fim}`
}

/** Caminho da arte pronta em `public/attributes` (ver `scripts/preparar-artes-atributos.mjs`). */
export function attributeArtSrc(slug: string, size: 480 | 160 | 64): string {
  return `/attributes/${slug}-${size}.webp`
}

/**
 * Os verbetes na ordem canônica dos critérios.
 *
 * Deriva de `CRITERION_SLUGS`, então critério novo no Supabase entra na página sozinho —
 * e o teste reprova se ele chegar sem rubrica ou sem arte, em vez de a página renderizar
 * um verbete vazio.
 */
export function buildGlossary(): GlossaryEntry[] {
  return CRITERION_SLUGS.map((slug) => {
    const info = CRITERIA_INFO[slug]
    const ranges = CRITERIA_RUBRICS[slug]?.ranges ?? []
    const bands = ranges
      .map(parseRange)
      .filter((r): r is NonNullable<typeof r> => r !== null)
      .map((r) => ({ ...r, covers: coverageLabel(r.band) }))

    return {
      slug,
      name: info?.name ?? slug,
      emoji: info?.emoji ?? "",
      // A description do banco vem com "\n" separando o que o critério mede de como
      // pontuar; na tela viram dois parágrafos, então a quebra é preservada.
      description: info?.description ?? "",
      bands,
      note: GLOSSARY_NOTES[slug] ?? null,
    }
  })
}
