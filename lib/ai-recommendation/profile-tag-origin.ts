import type { ProfileTag } from "@/lib/ai-recommendation/types"

/**
 * De onde veio cada tag do perfil de gosto — a resposta da /account/taste-profile à pergunta
 * "o quanto vocês me entendem?".
 *
 * 🔴 Por que isto é evidência e não enfeite: o perfil é destilado **só** das obras
 * avaliadas. `getRatedWorksForProfile` manda título, notas, sinopse, critérios e tags
 * da OBRA — e **nunca** manda `user_tag_preferences`. Então uma tag que aparece nos
 * dois lados com a mesma stance é concordância independente, não eco do que a pessoa
 * declarou. Se algum dia o prompt do perfil passar a receber as preferências
 * declaradas, este módulo vira circular e a seção tem que sair da tela — não há como
 * a UI perceber isso sozinha.
 *
 * ⚠️ A partição é por STANCE, não por presença: uma tag declarada com o lado OPOSTO
 * ao do perfil é `conflict`, nunca `confirmed`. Contar as duas juntas transformaria
 * uma discordância em prova de acerto, que é o oposto do que ela é.
 */

export type ProfileTagStance = "love" | "avoid"

/** O mínimo da declaração que a classificação precisa (vem de `DeclaredTagPref`). */
export interface DeclaredTagLite {
  name: string
  stance: ProfileTagStance
  /** Nível de onde a stance veio. Só `"tag"` conta como concordância — ver abaixo. */
  source: "tag" | "subgroup" | "group"
}

/**
 * 🔴 Só declaração de NÍVEL TAG entra na conta, e isto é o que separa evidência de
 * número inflado.
 *
 * `getDeclaredTagPreferences` EXPANDE uma declaração de grupo/subgrupo para todas as
 * tags membras — é o certo para o ranker, e errado aqui: quem marca um grupo inteiro
 * faz qualquer tag daquele grupo "concordar" de graça, sem nunca ter opinado sobre
 * ela. Medido em 2026-08-09 no perfil v23: com a expansão são **314 declaradas e 23
 * concordâncias**; só com nível tag, **147 e 17**. As 6 a mais não vieram de a IA
 * acertar mais — vieram de o denominador ter engordado com tags que a pessoa nunca
 * escolheu uma a uma.
 */
const COUNTS_AS_DECLARATION = "tag" as const

export interface ProfileTagWithOrigin extends ProfileTag {
  stance: ProfileTagStance
  /** `true` quando a pessoa também declarou esta tag (em qualquer nível). */
  declared: boolean
  /** `true` só quando declarou o lado CONTRÁRIO ao que o perfil afirma. */
  conflict: boolean
}

export interface ProfileTagOriginSplit {
  /** Nos dois lados, mesma stance — a concordância independente. */
  confirmed: ProfileTagWithOrigin[]
  /** Só no perfil: a IA chegou nelas lendo as obras. */
  discovered: ProfileTagWithOrigin[]
  /** Nos dois lados, stances opostas. */
  conflicts: ProfileTagWithOrigin[]
  /** Declaradas que não entraram no destilado (o perfil é top-N, não inventário). */
  declaredOnly: number
  declaredTotal: number
  profileTotal: number
  /**
   * Denominador da manchete: quantas tags os DOIS lados opinaram
   * (`confirmed + conflicts`). "17 de 17" e não "17 de 40" — as 23 descobertas não
   * tinham declaração contra a qual concordar, então não cabem no denominador.
   */
  agreementBase: number
}

/** trim + lower — o único casamento possível: o perfil guarda nome, não id de tag. */
const key = (name: string) => name.trim().toLowerCase()

export function classifyProfileTagOrigin(
  lovedTags: ProfileTag[],
  avoidedTags: ProfileTag[],
  declared: DeclaredTagLite[],
): ProfileTagOriginSplit {
  // Última declaração vence em caso de nome repetido; na prática não acontece
  // (a expansão de `getDeclaredTagPreferences` já resolve precedência por slug).
  const declaredByName = new Map<string, ProfileTagStance>()
  for (const d of declared) {
    if (d.source !== COUNTS_AS_DECLARATION) continue
    declaredByName.set(key(d.name), d.stance)
  }

  const confirmed: ProfileTagWithOrigin[] = []
  const discovered: ProfileTagWithOrigin[] = []
  const conflicts: ProfileTagWithOrigin[] = []
  const matched = new Set<string>()

  const walk = (tags: ProfileTag[], stance: ProfileTagStance) => {
    for (const tag of tags) {
      const k = key(tag.name)
      const decl = declaredByName.get(k)
      if (decl == null) {
        discovered.push({ ...tag, stance, declared: false, conflict: false })
        continue
      }
      matched.add(k)
      const entry = { ...tag, stance, declared: true, conflict: decl !== stance }
      ;(entry.conflict ? conflicts : confirmed).push(entry)
    }
  }
  walk(lovedTags, "love")
  walk(avoidedTags, "avoid")

  const byStrength = (a: ProfileTagWithOrigin, b: ProfileTagWithOrigin) => b.strength - a.strength
  confirmed.sort(byStrength)
  discovered.sort(byStrength)
  conflicts.sort(byStrength)

  return {
    confirmed,
    discovered,
    conflicts,
    // Nomes distintos, não linhas: a mesma tag não pode ser contada duas vezes só
    // porque o perfil a listou de um lado e a declaração de outro.
    declaredOnly: Math.max(0, declaredByName.size - matched.size),
    declaredTotal: declaredByName.size,
    profileTotal: lovedTags.length + avoidedTags.length,
    agreementBase: confirmed.length + conflicts.length,
  }
}
