import { CRITERIA_INFO, CRITERIA_RUBRICS } from "@/lib/constants/criteria"
import { bandBarBounds } from "@/lib/criteria/justification"
import { GLOSSARY_NOTES, type GlossaryNote } from "@/lib/criteria/glossary-notes"
import { VISIBLE_CRITERION_SLUGS } from "@/lib/criteria/visible"

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
 * Faixa sem "|" é descartada. Faixa sem ":" fica sem APELIDO e mantém a definição inteira —
 * degrada para menos informação, nunca para informação errada. Dar apelido curto a ela é
 * edição de banco, não de código.
 */
function parseRange(range: string): { band: string; label: string; text: string } | null {
  const bruto = range.trim()
  const barra = bruto.indexOf("|")
  if (barra === -1) return null
  const band = bruto.slice(0, barra).trim()
  const resto = bruto.slice(barra + 1).trim()
  const doisPontos = resto.indexOf(":")
  // 🔴 Sem ":" a faixa não tem APELIDO — e é assim que o producer c1 escreve 7 dos 11
  // (ex.: "0-3 | Romance ausente ou marginal."). O texto inteiro vai para `text`, que é o que
  // responde "o que significa romance 7,5?"; `label` fica vazio e a página não desenha o
  // cabeçalho. A versão anterior fazia o oposto — punha a frase inteira no rótulo e deixava a
  // DEFINIÇÃO vazia —, o que na tela virava um título longo sobre um corpo em branco.
  if (doisPontos === -1) return { band, label: "", text: capitalizar(resto) }
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

/**
 * 🔴 Critérios SEM arte preparada — lacuna DECLARADA, não silenciosa.
 *
 * O producer alvo (migration 198) trouxe `setting_era` e `angst`, e a arte deles ainda não
 * existe: as fontes ficam em `Imagens/Atributos/` (fora do git) e ninguém desenhou as duas.
 * Sem esta lista a página pediria `/attributes/setting_era-480.webp`, o servidor devolveria 404
 * e o leitor veria o ícone de imagem quebrada — falha visível, porém muda para a suíte.
 *
 * ⚠️ Isto é DÍVIDA com prazo, não arranjo permanente: rode
 * `node scripts/preparar-artes-atributos.mjs` quando as artes existirem e apague o slug daqui.
 * O teste conta os itens no TÍTULO do caso, então a lista não cresce sem aparecer.
 */
export const ATTRIBUTE_ART_PENDING: readonly string[] = ["setting_era", "angst"]

/** `true` quando existe arte preparada para o critério. */
export function hasAttributeArt(slug: string): boolean {
  return !ATTRIBUTE_ART_PENDING.includes(slug)
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
  return VISIBLE_CRITERION_SLUGS.map((slug) => {
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
