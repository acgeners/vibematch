/**
 * O que, do conteúdo de uma obra `mixed`, a versão NORMAL não mostra — módulo PURO, régua de LEITURA.
 *
 * Nada aqui grava nada. `work_tags`, o digest e as reviews continuam UMA vez por obra; a página
 * esconde da versão NORMAL o que pode descrever a R18, e mostra tudo na R18.
 *
 * ── Tags: TRÊS classes, todas lidas das flags do banco (migrations 199/203/210) ──────────────
 *
 * | classe        | flag (dado)                                                     | normal | R18 |
 * |---------------|-----------------------------------------------------------------|--------|-----|
 * | `r18`         | `adult_indicator_strong` ou `adult_score_tier = 'explicit'`     | oculta | sim |
 * | `desconhecida`| `adult_indicator` (fraca) ou `adult_score_tier = 'label'`       | oculta | sim |
 * | `compartilhada`| `marks_r19_edition` ("R19 disponível") ou tag sem sinal adulto | sim    | sim |
 *
 * 🔴 A classe do MEIO é a regra de 2026-10-11: tag adulta cuja edição é DESCONHECIDA (Adult, Sexual
 * Content, Nudity, First-Time Intercourse…) fica oculta na normal. Isso NÃO apaga a tag, NÃO afirma que
 * ela é da R18, NÃO mexe no gate nem na nota — só impede que uma informação possivelmente da edição
 * adulta apareça como se descrevesse a normal.
 *
 * ⚠️ Nenhuma lista de slugs aqui: a família R19, Smut/Hentai/Pornographic e os atos explícitos JÁ
 * são `strong`/`explicit` no banco; Adult/Sexual Content/Borderline H/Erotica são fracas com tier
 * `label`. Medido nas 140 mixed em 2026-10-11: esta régua oculta EXATAMENTE os mesmos 673 vínculos
 * que a régua de 3 classes da auditoria (`impacto-mixed-v3.mjs`, que ainda tinha listas), 0
 * divergências, e o resíduo (tag de vocabulário sexual SEM flag visível na normal) é 0.
 * ⚠️ Violência sexual (Sexual Assault, Sexual Abuse…) não tem sinal adulto desde a mig 203: é fato da
 * história e aparece nas DUAS edições — por dado, sem regex.
 */
import type { MixedEdition } from "@/lib/editions/mixed-edition"

export type TagEditionClass = "r18" | "desconhecida" | "compartilhada"

export interface EditionTagFacts {
  adult_indicator?: boolean | null
  adult_indicator_strong?: boolean | null
  adult_score_tier?: string | null
  marks_r19_edition?: boolean | null
}

export function tagEditionClass(tag: EditionTagFacts): TagEditionClass {
  if (tag.adult_indicator_strong === true || tag.adult_score_tier === "explicit") return "r18"
  if (tag.marks_r19_edition === true) return "compartilhada"
  if (tag.adult_indicator === true || tag.adult_score_tier === "label") return "desconhecida"
  return "compartilhada"
}

/** A tag aparece na versão NORMAL? Só as compartilhadas (inclusive as sem sinal adulto). */
export function isVisibleOnNormalEdition(tag: EditionTagFacts): boolean {
  return tagEditionClass(tag) === "compartilhada"
}

/** As tags visíveis numa edição. Obra não-mixed (`edition` null) e a versão R18 veem todas. */
export function tagsForEdition<T extends EditionTagFacts>(tags: ReadonlyArray<T>, edition: MixedEdition | null): T[] {
  if (edition !== "normal") return [...tags]
  return tags.filter(isVisibleOnNormalEdition)
}

// ── Avisos de conteúdo do digest ────────────────────────────────────────────────────────────

const SEXUAL_RE = /sexo|sexua|smut|nudez|nud[eo]|er[oó]tic|nsfw|[ií]ntim|hentai/i
/** Violência sexual é FATO DA HISTÓRIA (está nas duas edições) — e não liga o gate (mig 203). */
const SEXUAL_VIOLENCE_RE = /viol[eê]ncia sexual|estupro|abuso sexual|ass[eé]dio|n[aã]o consensual|consentimento|coer[cç][aã]o|coagid|pedofil/i
const EXPLICIT_RE = /expl[ií]cit|gr[aá]fic|smut|n[aã]o censurad|sem censura|uncensored|r-?19|19\+|18\+|vers[aã]o (er[oó]tica|alternativa|mature|adulta)/i
/** "(censuradas)" descreve justamente a edição normal. */
const CENSORED_RE = /(?<!n[aã]o )censurad/i

/**
 * Aviso que descreve SÓ a R18: conteúdo sexual explícito / não censurado / "versão erótica". Violência
 * sexual, violência, trauma e o resto continuam nas duas edições.
 */
export function isR18ExclusiveWarning(text: string): boolean {
  if (!SEXUAL_RE.test(text) || SEXUAL_VIOLENCE_RE.test(text)) return false
  if (CENSORED_RE.test(text) && !/n[aã]o censurad|sem censura|uncensored/i.test(text)) return false
  return EXPLICIT_RE.test(text)
}

export function warningsForEdition<T>(warnings: ReadonlyArray<T>, edition: MixedEdition | null, textOf: (w: T) => string): T[] {
  if (edition !== "normal") return [...warnings]
  return warnings.filter((w) => !isR18ExclusiveWarning(textOf(w)))
}

// ── Texto livre (digest em prosa, resumo, reviews, justificativas) ──────────────────────────

// ⚠️ As DUAS ordens: "explícito sexual" E "sexual explícito" / "explicit sexual". A 1ª versão só pegava
// a primeira e deixava passar 19 resumos de avaliação e 2 digests das 140 (medido em 2026-10-11, na
// verificação visual: "conteúdo sexual explícito recorrente" aparecia na versão normal).
const EXPLICIT_TEXT_RE =
  /\b(smut|smutty|sexo expl[ií]cit\w*|sexua\w* expl[ií]cit\w*|sexualmente expl[ií]cit\w*|cenas? (de sexo|sexuais)|sex scenes?|explicit (sex\w*|scenes?)|sexually explicit|expl[ií]cit\w* (sexua\w*|de sexo)|uncensored|n[aã]o censurad\w*|porn\w*|nsfw|r-?19|19\+|lemon|spicy scenes?|steamy)\b/i

/**
 * O texto cita conteúdo sexual explícito? Na versão normal ele não é mostrado como se descrevesse a
 * R15 — o digest e as reviews MISTURAM as duas edições (97,6% das reviews não dizem qual leram), e
 * separar frase a frase seria fingir uma separação que o dado não tem.
 */
export function mentionsExplicitSexualContent(text: string | null | undefined): boolean {
  return !!text && EXPLICIT_TEXT_RE.test(text)
}
