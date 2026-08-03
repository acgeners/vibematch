import "server-only"
import { cache } from "react"
import { createAdminClient } from "@/lib/supabase/admin"
import { getSessionUserId } from "./current-user"

// ═══════════════════════════════════════════════════════════════════════════════════════
// A PREVISÃO DE INTERESSE de quem está olhando
//
// `synopsis_quality_predictions` não tem `user_id` — mas TEM `taste_profile_id`, e
// `taste_profile` tem dono. Até 2026-08-03 nenhum leitor usava esse vínculo: a previsão
// exibida era sempre a do DONO, rotulada na tela como **"SEU INTERESSE"**.
//
// Medido: um Leitor sem nenhum perfil de gosto via, numa obra,
//
//   "IA sugere ♥ Fraca · 75% — foge completamente do núcleo do perfil (fantasy_nobility,
//    Reincarnated/Villainess). Além disso, a tag Harem está entre os avoided_tags…"
//
// que é o perfil de gosto do dono descrito em prosa, apresentado como o dela. Das 2286
// previsões do banco, 2286 vinham do perfil dele; ela tinha zero.
//
// ── Por que um LEITOR e não um `.eq()` em cada lugar ─────────────────────────────────
//
// `synopsis_quality_predictions` é lida em ~15 arquivos. Espalhar o filtro por eles deixa
// 15 chances de esquecer — e foi exatamente assim que este bug nasceu. Mesmo argumento (e
// mesma forma) de `getScoresReader` e `getPersonalStateReader`; um teste de arquitetura
// trava os três.
//
// ⚠️ Isto escopa LEITURA. Os caminhos de ESCRITA (actions, orquestração, backfill) já
// resolvem o usuário que está agindo e gravam o `taste_profile_id` dele — lá o escopo é
// correto por construção, e passar por aqui só embaralharia a responsabilidade.
// ═══════════════════════════════════════════════════════════════════════════════════════

/** O mínimo que um builder do PostgREST precisa expor pro `scope()` funcionar. */
interface Filterable {
  in(column: string, values: readonly string[]): unknown
}

/**
 * Aplica o `.in()` preservando o tipo do builder que entrou.
 *
 * ⚠️ O cast é deliberado. Com a assinatura natural (`scope<T extends Filterable>(q: T): T`) o
 * TS precisa checar estruturalmente os genéricos do builder do PostgREST e estoura com
 * "Type instantiation is excessively deep and possibly infinite" — aconteceu neste arquivo.
 * Isolar a inseguraça AQUI, num lugar só e explicado, é melhor que espalhar `.in()` solto
 * por ~10 call sites, que é o que este módulo existe pra evitar.
 */
function applyIn<T>(query: T, ids: string[]): T {
  return (query as Filterable).in("taste_profile_id", ids) as T
}

export interface InterestReader {
  /** Quem está olhando; null sem sessão. */
  userId: string | null
  /** Versões de `taste_profile` desta pessoa. Vazio = ela não tem previsão nenhuma. */
  profileIds: string[]
  /** True quando há ao menos um perfil — a UI usa pra não prometer o que não existe. */
  hasProfile: boolean
  /**
   * Restringe uma query de `synopsis_quality_predictions` às previsões de quem olha.
   *
   * Sem perfis (anônimo, ou usuário que nunca gerou um) o `.in()` recebe lista vazia e a
   * query devolve ZERO linhas — que é a resposta certa: "você não tem previsão", e não "aqui
   * está a de outra pessoa".
   */
  scope<T>(query: T): T
}

/**
 * Leitor das previsões de Interesse do usuário da requisição. Memoizado por request.
 *
 * ⚠️ `getSessionUserId()`, NUNCA `getCurrentUserId()` — o segundo cai no singleton (o dono)
 * quando não há sessão, que é precisamente o vazamento que este módulo existe pra fechar.
 */
export const getInterestReader = cache(async (): Promise<InterestReader> => {
  const sessionId = await getSessionUserId()

  if (!sessionId) {
    return {
      userId: null,
      profileIds: [],
      hasProfile: false,
      scope: (query) => applyIn(query, []),
    }
  }

  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from("taste_profile")
    .select("id")
    .eq("user_id", sessionId)

  if (error) {
    // Falha de leitura NÃO pode virar "mostra o de todo mundo": degrada pra vazio.
    console.warn("[getInterestReader] leitura de taste_profile falhou:", error.message)
    return {
      userId: sessionId,
      profileIds: [],
      hasProfile: false,
      scope: (query) => applyIn(query, []),
    }
  }

  const profileIds = (data ?? []).map((r) => (r as { id: string }).id)
  return {
    userId: sessionId,
    profileIds,
    hasProfile: profileIds.length > 0,
    scope: (query) => applyIn(query, profileIds),
  }
})
