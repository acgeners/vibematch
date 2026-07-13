import "server-only"
import { createHash } from "node:crypto"
import { createAdminClient } from "@/lib/supabase/admin"
import { getCurrentUserId } from "@/server/queries/current-user"
import { MODEL, PROMPT_VERSION } from "./service"
import type { ProfileTag, RatedWorkInput, TasteProfilePayload, TasteProfileRow } from "./types"

export const MIN_WORKS_FOR_FULL_PROFILE = 10
export const MIN_WORKS_FOR_ANY_PROFILE = 5

export function computeInputHash(works: RatedWorkInput[]): string {
  const canonical = works
    .map((w) => ({
      id: w.id,
      userScore: w.userScore,
      postScores: Object.fromEntries(
        Object.entries(w.postScores)
          .filter(([, v]) => v != null)
          .sort(([a], [b]) => a.localeCompare(b)),
      ),
      categoryScores: Object.fromEntries(
        Object.entries(w.categoryScores)
          .filter(([, v]) => v != null)
          .sort(([a], [b]) => a.localeCompare(b)),
      ),
      tags: [...w.tags].map((t) => `${t.group ?? ""}::${t.name}`).sort(),
      personalStatus: w.personalStatus ?? null,
      synopsisLen: w.synopsis?.length ?? 0,
    }))
    .sort((a, b) => a.id.localeCompare(b.id))

  const payload = JSON.stringify({
    model: MODEL,
    promptVersion: PROMPT_VERSION,
    works: canonical,
  })
  return createHash("sha256").update(payload).digest("hex")
}

/**
 * Assinatura de CONTEÚDO do perfil — hash só dos campos que o preditor de
 * Interesse Sinopse de fato consome pra decidir a faixa: tags/temas amados e
 * evitados, narrative_patterns e os prefs numéricos de critério. É a chave de
 * staleness das previsões de sinopse (NÃO o `input_hash`, que é da biblioteca).
 *
 * Por quê: o `input_hash` muda a CADA edição da biblioteca (1 nota manual, 1 tag),
 * o que regenerava o perfil e marcava TODAS as previsões como desatualizadas —
 * mesmo quando o gosto destilado não mudou em nada. Comparar a saída material do
 * perfil faz uma regeneração "idêntica na prática" não invalidar nada.
 *
 * Exclui de propósito:
 *  - `summary` e os `note` por critério: texto livre que o LLM reescreve a cada
 *    geração; incluí-los manteria a invalidação fútil que estamos consertando.
 *  - model/prompt do perfil: é COMO o perfil foi gerado, não O QUE ele diz.
 * Números são arredondados a 2 casas (jitter < 0.01 é ruído) e arrays ordenados
 * pra a assinatura ser estável à ordem de retorno do modelo.
 */
export function computeProfileSignature(profile: TasteProfilePayload): string {
  const round = (n: number) => Math.round(n * 100) / 100
  const sortTags = (ts: ProfileTag[]) =>
    [...(ts ?? [])]
      .map((t) => ({ n: t.name, g: t.group ?? "", s: round(t.strength) }))
      .sort((a, b) => `${a.g}::${a.n}`.localeCompare(`${b.g}::${b.n}`))
  const sortStrs = (ss: string[]) =>
    [...(ss ?? [])].map((s) => s.trim()).sort((a, b) => a.localeCompare(b))
  const prefs = Object.entries(profile.criterion_preferences ?? {})
    .filter(([, v]) => v != null)
    .map(([k, v]) => [k, { min: round(v!.ideal_min), max: round(v!.ideal_max), w: round(v!.weight) }] as const)
    .sort(([a], [b]) => a.localeCompare(b))

  const canonical = JSON.stringify({
    lovedTags: sortTags(profile.loved_tags),
    avoidedTags: sortTags(profile.avoided_tags),
    lovedThemes: sortStrs(profile.loved_themes),
    avoidedThemes: sortStrs(profile.avoided_themes),
    criterionPreferences: prefs,
    narrativePatterns: sortStrs(profile.narrative_patterns),
  })
  return createHash("sha256").update(canonical).digest("hex")
}

/**
 * Chave de staleness do INTERESSE derivada do fingerprint heurístico
 * DETERMINÍSTICO (das obras rotuladas), não do output LLM do perfil. Motivo: o
 * output do perfil muda 57–73% a cada regeneração do MESMO acervo (sampling temp
 * 0.2) — `computeProfileSignature` então invalidava ~todas as previsões a cada
 * regen, mesmo sem o gosto mudar. Como o fingerprint só muda quando a biblioteca
 * muda MATERIALMENTE, regen do mesmo acervo → mesma chave → zero churn.
 * Fallback p/ `computeProfileSignature` quando não há fingerprint (perfil
 * pré-migration 118 ou biblioteca sem tags qualificadas) — preserva o legado.
 */
export function computeProfileStalenessKey(profile: {
  heuristic_fingerprint?: { loved: string[]; avoided: string[]; criteria: string[] } | null
  profile: TasteProfilePayload
}): string {
  const fp = profile.heuristic_fingerprint ?? null
  if (fp && (fp.loved.length > 0 || fp.avoided.length > 0 || fp.criteria.length > 0)) {
    return createHash("sha256").update(JSON.stringify({ l: fp.loved, a: fp.avoided, c: fp.criteria })).digest("hex")
  }
  return computeProfileSignature(profile.profile)
}

function rowToTasteProfile(row: Record<string, unknown>): TasteProfileRow {
  return {
    id: row.id as string,
    version: row.version as number,
    is_current: row.is_current as boolean,
    is_stub: row.is_stub as boolean,
    n_works_used: row.n_works_used as number,
    input_hash: row.input_hash as string,
    model_name: row.model_name as string,
    prompt_version: row.prompt_version as string,
    profile: row.profile as TasteProfilePayload,
    raw_response: row.raw_response,
    created_at: row.created_at as string,
    heuristic_fingerprint:
      (row.heuristic_fingerprint as { loved: string[]; avoided: string[]; criteria: string[] } | null | undefined) ?? null,
  }
}

/**
 * Perfil de gosto CORRENTE — de UMA pessoa (migration 147).
 *
 * 🔴 Antes desta fatia, esta função buscava `is_current = true` sem filtrar por dono: havia UM
 * perfil corrente no banco inteiro. Um Assinante gerando o perfil dele marcava o dele como
 * corrente e o do DONO deixava de ser encontrado — e o recalc seguinte treinava o Ridge do dono
 * com as `loved_tags` de outra pessoa. Sem erro, sem log, 878 notas mudadas.
 *
 * ⚠️ Sem `userId` explícito, cai em `getCurrentUserId()` — que sem sessão devolve o SINGLETON
 * (o dono). É o certo para o recalc, que roda em background; e é o certo para uma requisição,
 * que devolve o perfil de quem pediu. Mas em código NOVO de background, passe o id na mão: o
 * fallback é uma conveniência, não uma garantia.
 */
export async function loadCurrentTasteProfile(userId?: string): Promise<TasteProfileRow | null> {
  const supabase = createAdminClient()
  const ownerId = userId ?? (await getCurrentUserId())
  const { data, error } = await supabase
    .from("taste_profile")
    .select("*")
    .eq("user_id", ownerId)
    .eq("is_current", true)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) {
    console.error("[taste-profile] erro lendo perfil atual:", error)
    return null
  }
  if (!data) return null
  return rowToTasteProfile(data as Record<string, unknown>)
}

async function nextVersion(): Promise<number> {
  const supabase = createAdminClient()
  const { data } = await supabase
    .from("taste_profile")
    .select("version")
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle()
  const current = (data?.version as number | undefined) ?? 0
  return current + 1
}

/**
 * Desmarca o perfil corrente — 🔴 DE UMA PESSOA SÓ.
 *
 * O nome antigo (`markAllProfilesAsStale`) descrevia o bug com precisão: ele desmarcava o
 * `is_current` de TODO MUNDO. Um Assinante gerando o perfil dele apagava a corrente do dono, e
 * o Ridge do dono ficava sem perfil no recalc seguinte. O `.eq("user_id", …)` é a correção
 * inteira.
 */
async function markOwnProfileAsStale(userId: string): Promise<void> {
  const supabase = createAdminClient()
  await supabase
    .from("taste_profile")
    .update({ is_current: false })
    .eq("user_id", userId)
    .eq("is_current", true)
}

export interface InsertTasteProfileArgs {
  profile: TasteProfilePayload
  nWorks: number
  inputHash: string
  isStub: boolean
  modelName: string
  promptVersion: string
  rawResponse: unknown
  /**
   * Obras rotuladas que geraram o perfil — usadas pra gravar o FINGERPRINT
   * heurístico (drift method-free, migration 118). Opcional/best-effort.
   */
  ratedWorks?: RatedWorkInput[]
  /**
   * DONO do perfil (migration 147). Explícito de propósito: um perfil que descobre sozinho de
   * quem ele é depende de haver sessão — e este código também roda em background (orquestração,
   * backfill), onde não há. Sem `userId`, cai em `getCurrentUserId()`, que sem sessão devolve o
   * singleton (o dono) — conveniente, mas por acidente, não por decisão.
   */
  userId?: string
}

export async function insertNewTasteProfile(
  args: InsertTasteProfileArgs,
): Promise<TasteProfileRow> {
  const supabase = createAdminClient()
  // O perfil é de QUEM PEDIU (migration 147). Sem `user_id`, a linha nova viraria "o perfil
  // corrente" do banco inteiro e derrubaria o do dono.
  const userId = args.userId ?? (await getCurrentUserId())
  // Perfil anterior lido ANTES de desmarcar o corrente — base pra decidir se o gosto mudou
  // MATERIALMENTE (gate da invalidação abaixo).
  const prev = await loadCurrentTasteProfile(userId)
  await markOwnProfileAsStale(userId)
  const version = await nextVersion()
  const { data, error } = await supabase
    .from("taste_profile")
    .insert({
      user_id: userId,
      version,
      is_current: true,
      is_stub: args.isStub,
      n_works_used: args.nWorks,
      input_hash: args.inputHash,
      model_name: args.modelName,
      prompt_version: args.promptVersion,
      profile: args.profile,
      raw_response: args.rawResponse,
    })
    .select("*")
    .single()
  if (error || !data) {
    throw new Error(`Erro persistindo perfil de gosto: ${error?.message ?? "desconhecido"}`)
  }

  // Fingerprint heurístico DETERMINÍSTICO das MESMAS obras (migration 118),
  // computado UMA vez: é a base da chave de staleness E é gravado na linha.
  let newFingerprint: { loved: string[]; avoided: string[]; criteria: string[] } | null = null
  if (args.ratedWorks && args.ratedWorks.length > 0) {
    try {
      const { computeHeuristicFingerprint } = await import("./profile-drift")
      newFingerprint = computeHeuristicFingerprint(args.ratedWorks)
    } catch (err) {
      console.warn("[insertNewTasteProfile] fingerprint falhou:", err instanceof Error ? err.message : err)
    }
  }

  // Invalidação de Interesse GATED por materialidade: só marca previsões stale
  // quando a chave determinística (fingerprint) MUDA vs o perfil anterior. Regen
  // do mesmo acervo → mesma chave → NÃO toca a coluna `stale` (sem churn/flip).
  // A chave vem do fingerprint, NÃO do output LLM (que re-rola 57–73% por regen).
  // Best-effort (não bloqueia a geração do perfil).
  const newKey = computeProfileStalenessKey({ heuristic_fingerprint: newFingerprint, profile: args.profile })
  const prevKey = prev ? computeProfileStalenessKey(prev) : null
  if (prevKey !== newKey) {
    const { markSynopsisPredictionsStale } = await import("@/server/queries/synopsis-quality")
    await markSynopsisPredictionsStale(newKey)
  }

  // Uma nova versão de perfil torna `personal_fit` (derivado por recalculateAll a
  // partir do perfil efetivo) STALE. Sinaliza recálculo pendente — NÃO recalcula
  // aqui (apenas marca; reusa o mecanismo existente). Marcado SÓ após o insert
  // bem-sucedido: geração/persistência que falham nunca chegam aqui (caem no throw
  // acima). Cobre TODOS os caminhos de persistência (este é o único sink).
  const { markRecalcPending } = await import("@/server/recalc/queue")
  await markRecalcPending("taste_profile_new_version")

  // Grava o fingerprint na linha (best-effort; reusa o já computado). Se a coluna
  // não existir (migration pendente) ou faltar `ratedWorks`, apenas avisa e segue.
  if (newFingerprint) {
    const { error: fpErr } = await supabase
      .from("taste_profile")
      .update({ heuristic_fingerprint: newFingerprint })
      .eq("id", (data as { id: string }).id)
    if (fpErr) {
      console.warn("[insertNewTasteProfile] heuristic_fingerprint não gravado (migration 118 aplicada?):", fpErr.message)
    }
  }

  return rowToTasteProfile(data as Record<string, unknown>)
}

/**
 * Perfil mínimo quando o usuário ainda não avaliou obras suficientes pra uma
 * análise IA fiável. Não chama Claude — apenas declara baixa confiança.
 */
export function buildStubProfile(nWorks: number): TasteProfilePayload {
  return {
    loved_tags: [],
    avoided_tags: [],
    loved_themes: [],
    avoided_themes: [],
    criterion_preferences: {},
    narrative_patterns: [],
    summary:
      nWorks === 0
        ? "Você ainda não avaliou obras com nota pessoal. Avalie alguns títulos pra eu identificar seu gosto."
        : `Apenas ${nWorks} obra(s) avaliada(s) — abaixo do mínimo (${MIN_WORKS_FOR_FULL_PROFILE}) pra uma análise rica. Avalie mais títulos pra refinar o perfil.`,
  }
}
