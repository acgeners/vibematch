/**
 * Limites de `adult_content` por PROCEDÊNCIA do sinal.
 *
 * ## Por que este módulo existe
 *
 * A regra anterior procurava o token "R19" em QUALQUER evidência — sinopse, tags,
 * gêneros, contexto externo e o texto das reviews — e disso derivava um piso de 6,0
 * ou 7,0. Medido em 2026-07-24 sobre as 349 avaliações em que o piso disparou:
 * **166 (48%) vieram só do marcador que o próprio pipeline reinjeta na sinopse**
 * (`cleanSynopsisPre` em `lib/external/index.ts` detecta boilerplate do tipo
 * "Original Webtoon: R19" ou "Official Translations (R19)" e reescreve como
 * `[R19 disponível]`).
 *
 * Esse marcador significa **"existe uma edição R19 desta obra em algum lugar"**. A
 * regra lia como **"esta obra tem sexualização ≥ 6"**. São afirmações diferentes, e
 * a diferença produzia notas que contradiziam a própria justificativa:
 *
 * > "não há evidência explícita de sexo recorrente nas reviews, que inclusive
 * > mencionam romance e 'smut' como algo escasso. Ainda assim, o marcador R19
 * > exige nota mínima de 6."
 *
 * ## O desenho novo: três camadas, e nenhuma delas lê texto livre
 *
 * | camada | sinal | efeito |
 * |---|---|---|
 * | EXPLÍCITO | tag que NOMEIA um ato sexual, gênero Smut/Hentai, `contentRating` pornographic | **piso 9,0** |
 * | TETO R15 | tag "R15 but Based on a R19 Novel" | **teto 6,0** |
 * | RÓTULO ADULTO | tag `R19`/`Adult`/`Sexual Content`, gênero Adult, `contentRating` erotica | piso 7,0 |
 * | classificação leve | `contentRating` suggestive | piso 5,0 |
 * | enredo/aviso | `Sexually Active Protagonist`, `One-Night Stand`, `Sexual Harassment`, `Gore`… | **nenhum limite** |
 * | (nada) | `[R19 disponível]` de boilerplate | **nenhum limite** — só uma dica no prompt |
 *
 * **Nenhuma camada casa keyword em sinopse ou review.** Isso é deliberado: a review
 * que motivou a investigação diz "Romance and smut are lacking", e um `includes("smut")`
 * em texto livre acionaria o piso justamente no caso em que a evidência diz o oposto.
 * Só sinal ESTRUTURADO (tag, gênero, classificação da fonte) vira limite; texto livre
 * é evidência para o modelo pesar, não gatilho de regra.
 *
 * ## O piso 9,0 e a frequência
 *
 * Decisão de produto (2026-07-24): **qualquer quantidade de cena explícita ⇒ > 8**.
 * A frequência não rebaixa. Uma obra com uma única cena explícita é tão "explícita"
 * quanto uma com dez — o que varia é o foco, não a natureza do conteúdo. Por isso a
 * rubrica 9-10 deixou de exigir sexo explícito *recorrente*.
 */

/** Piso quando há evidência estruturada de cena explícita retratada. */
export const EXPLICIT_FLOOR = 9

/**
 * Piso por classificação declarada da fonte externa (MangaDex/ComicK).
 * `pornographic` é explícito por definição, então vale o mesmo que a camada
 * EXPLÍCITO — deixá-lo em 8 permitiria "explícito mas nota 8", que a decisão de
 * produto ("qualquer cena explícita ⇒ > 8") exclui.
 */
const CONTENT_RATING_BOUNDS: Record<string, number> = {
  suggestive: 5,
  erotica: 7,
  pornographic: EXPLICIT_FLOOR,
}

/**
 * Teto para obras marcadas "R15 but Based on a R19 Novel": o R19 é do novel
 * original, a obra avaliada é R15. 6,0 é o topo da faixa "4-6 Suggestive"
 * ("insinuação clara… pode ter cena cortada/fade to black"), que descreve R15 com
 * precisão; a faixa "7-8 Mature" já pressupõe sexo parcialmente MOSTRADO, o que
 * está além de R15.
 */
export const R15_FROM_R19_CEILING = 6

/** Piso dos RÓTULOS de conteúdo adulto (tag `R19`, `Adult`, `Sexual Content`…). Não
 *  vai a 9 porque rótulo de faixa etária não afirma que uma cena é mostrada — R19
 *  pode ser por violência. Havendo tag de ato explícito, a camada EXPLÍCITO manda. */
export const ADULT_LABEL_FLOOR = 7

const ADULT_TAG_GROUP = "content_indicator"

/**
 * Tags do grupo `content_indicator` que nomeiam um ATO sexual RETRATADO. Só estas
 * acionam o piso 9,0 — a lista é conservadora de propósito, porque um falso positivo
 * aqui afirma "esta obra mostra sexo explícito", o que é forte.
 *
 * O critério de inclusão é: **a tag nomeia um ato ou posição sexual específica**. Isso
 * só é atribuído a uma obra que mostra a cena; ninguém etiqueta "Cunnilingus" numa
 * obra com fade to black.
 *
 * Ficam FORA de propósito, em três grupos:
 *  · **rótulo de faixa** (Adult, Sexual Content, Borderline H) → vão pro piso 7, com
 *    o R19: dizem que há conteúdo adulto, não que uma cena é mostrada.
 *  · **fato de enredo/personagem** (Sexually Active Protagonist, One-Night Stand,
 *    Sexual Teasing, Virginity) → NENHUM piso. Dizem que sexo acontece na história,
 *    e a obra pode perfeitamente cortar a cena. Foi o que a medição mostrou: sem
 *    essa separação, 204 obras subiriam pra 9 e várias só têm "Sexually Active
 *    Protagonist".
 *  · **aviso de conteúdo e dinâmica** (Sexual Harassment/Assault/Abuse, Gore, Torture,
 *    Suicide/s, Corpses, BDSM, Femdom, Aphrodisiac, Nudity, Big Breasts, Incest) →
 *    nenhum piso. Retratar violência sexual não é o mesmo que ser sexualmente explícito.
 *
 * Casos de fronteira deixados FORA, mas fáceis de mover se a curadoria discordar:
 * "Breast Sucking", "Breast Grabbing", "Vanilla", "Condom/s", "Voyeurism", "Dirty Talk".
 * São atos ou indícios fortes, mas menos inequívocos que os da lista.
 *
 * Em todos os casos o modelo continua LIVRE pra pontuar alto por causa dessas tags —
 * o que esta lista controla é apenas o piso OBRIGATÓRIO.
 */
export const EXPLICIT_ACT_TAGS: ReadonlySet<string> = new Set([
  "Ahegao",
  "Anal Sex",
  "Ashikoki",
  "Bukkake",
  "Cervix Penetration",
  "Clothed Intercourse",
  "Cowgirl Position",
  "Cunnilingus",
  "Doggy Style",
  "Double/Multiple Penetration",
  "Drunken Intercourse",
  "Ejaculation",
  "Enemies Have Sex",
  "Facial",
  "Fingering",
  "First-Time Intercourse",
  "Footjob",
  "Gangbang",
  "Handjob",
  "Intercrural Intercourse",
  "Masturbation",
  "Mirror Sex",
  "Missionary Position",
  "Office Intercourse",
  "Oral Sex",
  "Orgasms",
  "Outdoor Intercourse",
  "Pegging",
  "Phone Sex",
  "Pregnancy Sex",
  "Prison Sex",
  "Public Sex",
  "Rough Sex",
  "School Intercourse",
  "Sex Magic",
  "Sex Toy/s",
  "Sitting Sex",
  "Squirting",
  "Strap-On",
  "Sumata",
  "Threesome",
  "Toilet Intercourse",
  "Urethral Insertion",
])

/**
 * Tags que ROTULAM a obra como adulta sem nomear uma cena. Acionam o mesmo piso da
 * tag R19 (7,0 = "Mature"): há conteúdo adulto, mas o rótulo não diz que uma cena
 * explícita aparece. Se houver também tag de ato, a camada EXPLÍCITO manda.
 */
export const ADULT_LABEL_TAGS: ReadonlySet<string> = new Set([
  "Adult",
  "Sexual Content",
  "Borderline H",
  "Hypersexuality",
  "R19",
  "R19 Version",
  "Erotica", // semeada (mig 166): rótulo adulto, cena não afirmada → piso 7
])

/**
 * Tags-RÓTULO que, ao contrário das de ADULT_LABEL, AFIRMAM conteúdo sexual
 * explícito mostrado (mesmo sem nomear um ato específico). Semeadas na mig 166 no
 * grupo `content_indicator`. Acionam o piso EXPLÍCITO (9), como os gêneros homônimos
 * "smut"/"hentai" já faziam antes — que agora chegam como TAG, não gênero.
 */
export const EXPLICIT_LABEL_TAGS: ReadonlySet<string> = new Set([
  "Smut",
  "Hentai",
  "Pornographic",
])

/** Gêneros que declaram sexo explícito sem ambiguidade. "Adult" fica de fora e vai
 *  pro tier de RÓTULO (piso 7), pra bater com a tag homônima: na taxonomia das fontes
 *  ele marca faixa etária, não necessariamente cena mostrada. "Mature" também fica
 *  fora — é largo e cobre violência e tema adulto sem sexo. */
const EXPLICIT_GENRES = ["smut", "hentai"]

/** Gêneros que rotulam a obra como adulta sem afirmar cena explícita. */
const ADULT_LABEL_GENRES = ["adult"]


/** Tag que diz que o R19 é do NOVEL, não da obra. */
export const R15_FROM_R19_TAG = "R15 but Based on a R19 Novel"

export interface AdultContentInput {
  /** Nomes das tags com o slug do grupo (só `content_indicator` importa aqui). */
  tags?: Array<{ name: string; group?: string | null }>
  genres?: string[]
  /** `contentRating` das fontes externas aceitas (MangaDex/ComicK). */
  contentRatings?: string[]
  /** Sinopse — usada SÓ pra detectar o marcador de boilerplate, nunca como gatilho. */
  synopsis?: string | null
}

/** Marcador `[R19 disponível]` / linha solta "R19" — boilerplate reinjetado. */
const BOILERPLATE_MARKER_RE = /\[R1[89][^\]]*\]|(?:^|\n)\s*R\s*-?\s*1[89]\s*(?=\n|$)/i

export interface AdultContentBounds {
  /** Piso obrigatório, ou null quando nenhum sinal estruturado o justifica. */
  floor: number | null
  /** Teto obrigatório, ou null. */
  ceiling: number | null
  /** Por que — entra no `raw_response` e na justificativa. */
  reasons: string[]
  /** Tags/gêneros/ratings que acionaram o piso EXPLÍCITO. */
  explicitSignals: string[]
  /** Só existe uma edição R19 em outro lugar: dica pro prompt, sem limite. */
  hasEditionMarkerOnly: boolean
  /** Piso e teto se contradizem (ato explícito numa obra marcada R15). */
  conflict: boolean
}

function contentIndicatorTags(input: AdultContentInput): string[] {
  return (input.tags ?? [])
    .filter((t) => (t.group ?? null) === ADULT_TAG_GROUP)
    .map((t) => t.name.trim())
    .filter(Boolean)
}

/**
 * Calcula piso e teto de `adult_content` a partir de sinais ESTRUTURADOS.
 *
 * ## Precedência (exatamente UMA camada decide, e as razões descrevem só ela)
 *
 * 1. **Ato explícito nomeado** → piso 9. Ganha de tudo, inclusive do teto R15: a tag
 *    descreve conteúdo OBSERVADO, e conteúdo observado ganha de rótulo de faixa etária.
 *    O choque fica marcado em `conflict` pra ser auditável em vez de silencioso.
 * 2. **"R15 but Based on a R19 Novel"** → teto 6, e **anula os pisos de rótulo**. Essa
 *    tag é mais específica que um "R19" solto: ela existe justamente pra dizer que o
 *    R19 é do novel. Obras como "Under the Oak Tree" e "Mokrin" têm as duas tags ao
 *    mesmo tempo, e a específica é que descreve a realidade da adaptação.
 * 3. **Rótulo adulto** (tag `R19`/`Adult`/`Sexual Content`, gênero Adult) → piso 7.
 * 4. **Classificação da fonte** (suggestive 5 / erotica 7) → piso.
 *
 * As `reasons` são montadas DEPOIS da decisão, a partir da camada que venceu. Montar
 * durante a varredura produzia texto contraditório na mesma justificativa — "tem TETO
 * 6.0, não piso" seguido de "adult_content ≥ 7.0" — que é exatamente o tipo de
 * justificativa incoerente que este módulo existe pra eliminar.
 */
export function computeAdultContentBounds(input: AdultContentInput): AdultContentBounds {
  const ciTags = contentIndicatorTags(input)
  const allTagNames = (input.tags ?? []).map((t) => t.name.trim()).filter(Boolean)
  const genresLower = (input.genres ?? []).map((g) => g.toLowerCase().trim())
  const ratings = (input.contentRatings ?? []).map((r) => r.toLowerCase().trim())

  const explicitSignals: string[] = []
  for (const name of ciTags)
    if (EXPLICIT_ACT_TAGS.has(name) || EXPLICIT_LABEL_TAGS.has(name)) explicitSignals.push(`tag "${name}"`)
  for (const g of genresLower) {
    if (EXPLICIT_GENRES.some((kw) => g === kw)) explicitSignals.push(`gênero "${g}"`)
  }
  if (ratings.includes("pornographic")) explicitSignals.push(`classificação externa "pornographic"`)

  const hasR15FromR19 = allTagNames.some(
    (n) => n.toLowerCase() === R15_FROM_R19_TAG.toLowerCase()
  )

  const adultLabels = [
    ...ciTags.filter((n) => ADULT_LABEL_TAGS.has(n)).map((n) => `tag "${n}"`),
    ...genresLower.filter((g) => ADULT_LABEL_GENRES.some((kw) => g === kw)).map((g) => `gênero "${g}"`),
  ]

  let ratingFloor: { floor: number; rating: string } | null = null
  for (const rating of ratings) {
    const bound = CONTENT_RATING_BOUNDS[rating]
    if (bound != null && bound < EXPLICIT_FLOOR && (ratingFloor === null || bound > ratingFloor.floor)) {
      ratingFloor = { floor: bound, rating }
    }
  }

  const hasEditionMarkerOnly =
    BOILERPLATE_MARKER_RE.test(input.synopsis ?? "") &&
    explicitSignals.length === 0 &&
    adultLabels.length === 0 &&
    !hasR15FromR19 &&
    ratingFloor === null

  // ── decide UMA camada ───────────────────────────────────────────────────
  let floor: number | null = null
  let ceiling: number | null = null
  let conflict = false
  const reasons: string[] = []

  if (explicitSignals.length > 0) {
    floor = EXPLICIT_FLOOR
    const shown = explicitSignals.slice(0, 3).join("; ")
    const rest = explicitSignals.length > 3 ? `; +${explicitSignals.length - 3}` : ""
    reasons.push(
      `Há cena de sexo explícito retratada (${shown}${rest}). Qualquer quantidade de conteúdo explícito exige adult_content ≥ ${EXPLICIT_FLOOR.toFixed(1)} — a frequência muda o FOCO da obra, não a natureza do conteúdo.`
    )
    if (hasR15FromR19) {
      conflict = true
      reasons.push(
        `(A obra também tem a tag "${R15_FROM_R19_TAG}", que indicaria o contrário. Prevalece o conteúdo observado sobre o rótulo de faixa etária.)`
      )
    }
  } else if (hasR15FromR19) {
    ceiling = R15_FROM_R19_CEILING
    reasons.push(
      `"${R15_FROM_R19_TAG}": o R19 é do novel original — a obra avaliada é R15 (madura, não explícita). adult_content tem TETO ${R15_FROM_R19_CEILING.toFixed(1)}, não piso.`
    )
    // Rótulos de "R19"/"Adult" na mesma obra são o mal-entendido que esta tag
    // resolve: ignorados de propósito, e o motivo fica dito em voz alta.
    if (adultLabels.length > 0) {
      reasons.push(
        `Os rótulos ${adultLabels.join(", ")} nesta obra se referem à mesma edição R19 do novel e NÃO elevam a nota.`
      )
    }
  } else if (adultLabels.length > 0) {
    floor = ADULT_LABEL_FLOOR
    reasons.push(
      `Obra rotulada como adulta (${adultLabels.join(", ")}); adult_content ≥ ${ADULT_LABEL_FLOOR.toFixed(1)}. O rótulo NÃO afirma que uma cena explícita é mostrada — se for, a faixa correta é 9-10.`
    )
  } else if (ratingFloor) {
    floor = ratingFloor.floor
    reasons.push(
      `Fonte externa classifica o conteúdo como "${ratingFloor.rating}"; adult_content ≥ ${ratingFloor.floor.toFixed(1)}.`
    )
  }

  return { floor, ceiling, reasons, explicitSignals, hasEditionMarkerOnly, conflict }
}

/** Aplica piso/teto a uma nota. Retorna a nota inalterada quando já está na faixa. */
export function clampAdultContentScore(
  score: number,
  bounds: Pick<AdultContentBounds, "floor" | "ceiling">
): number {
  let out = score
  if (bounds.floor != null && out < bounds.floor) out = bounds.floor
  if (bounds.ceiling != null && out > bounds.ceiling) out = bounds.ceiling
  return out
}
