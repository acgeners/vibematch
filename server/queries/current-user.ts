import "server-only"
import { cache } from "react"
import { createAdminClient } from "@/lib/supabase/admin"
import { createClient } from "@/lib/supabase/server"
import { isRole, planFromRole, roleAllows, roleAtLeast, deniedMessage } from "@/lib/plans/roles"
import type { Role, Permission, UserPlan } from "@/lib/plans/roles"

type AdminClient = ReturnType<typeof createAdminClient>

// Id do usuário autenticado, lido da sessão Supabase (cookies). Memoizado por
// request (React cache) — várias queries no mesmo request não repetem a chamada.
// Retorna null quando não há sessão: anon, ou contexto sem request (scripts,
// tarefas em background) onde cookies() lança — daí o try/catch.
export const getSessionUserId = cache(async (): Promise<string | null> => {
  try {
    const supabase = await createClient()
    const { data, error } = await supabase.auth.getUser()
    if (error) return null
    return data.user?.id ?? null
  } catch {
    return null
  }
})

// Fallback pré-auth: o current_user_id da linha singleton (migration 074). É um
// UUID fixo, então cachear em módulo é seguro (não é por-usuário). Só alcançado
// quando NÃO há sessão — um usuário logado sempre resolve via getSessionUserId.
let cachedSingletonId: string | null = null

async function getSingletonUserId(admin?: AdminClient): Promise<string> {
  if (cachedSingletonId) return cachedSingletonId

  const supabase = admin ?? createAdminClient()
  const { data, error } = await supabase
    .from("user_settings")
    .select("current_user_id")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle()

  if (error) throw new Error(`Falha lendo user_settings: ${error.message}`)
  if (!data?.current_user_id) {
    throw new Error("user_settings sem linha singleton — rode a migration 074.")
  }

  cachedSingletonId = data.current_user_id as string
  return cachedSingletonId
}

// Id do usuário atual. Prefere a sessão de auth; cai no singleton legado enquanto
// a auth não está ligada (dev / transição multi-user). Assinatura preservada —
// nenhum caller muda. É aqui a costura single-user → multi-user.
export async function getCurrentUserId(admin?: AdminClient): Promise<string> {
  const sessionId = await getSessionUserId()
  if (sessionId) return sessionId
  return getSingletonUserId(admin)
}

/**
 * Id do DONO do catálogo — a linha singleton de `user_settings` (a mais antiga).
 *
 * É o eixo da Fatia 1 (PLANO-MULTIUSER-FASE2.md §13). As colunas pessoais de `works`
 * (`is_favorite`, `personal_status_id`, `chapters_read`, `last_read_at`) moram na linha
 * COMPARTILHADA do catálogo — logo, o estado que está lá é o **dele**. Quem compara contra
 * este id decide duas coisas:
 *
 *   - na ESCRITA: se pode tocar em `works` (só o dono pode; para os demais, a escrita vai
 *     só pra `user_work_state`). Sem essa comparação, a Leitora favorita uma obra e
 *     sobrescreve o `is_favorite` do dono — sem erro, sem log.
 *   - na LEITURA: de onde vem o estado dela (`works` pro dono; `user_work_state` pros
 *     outros, sem fallback). Sem isso, ela vê os favoritos e os capítulos do dono como se
 *     fossem dela.
 *
 * ⚠️ NÃO é "quem está logado" nem "quem é curador": é o dono do dado legado. Um segundo
 * curador passa em `ensureAdmin()` e mesmo assim NÃO é o dono — e não pode herdar o estado
 * pessoal de ninguém.
 */
export async function getOwnerUserId(admin?: AdminClient): Promise<string> {
  return getSingletonUserId(admin)
}

// ⚠️⚠️ NUNCA use `getCurrentUserId()` para ESCREVER.
//
// Sem sessão ele cai no SINGLETON — o dono. Um visitante anônimo que faça POST numa
// action que grave por `getCurrentUserId()` escreve NAS LINHAS DO DONO (e toda função
// exportada de um arquivo "use server" É um endpoint HTTP público: esconder o botão
// não protege nada). Para escrita per-usuário, use `ensureSignedIn()` — sem sessão,
// sem escrita.
//
// O fallback FICA porque a LEITURA depende dele: o recalc roda em background (fila,
// `after()`, cascatas) SEM sessão e precisa do `biasMap` do dono — sem o singleton ele
// recalcularia as notas do dono sem a calibração dele, em silêncio. E o catálogo é
// compartilhado por design: o anônimo vê o app pelos olhos do dono.

// Linha de user_settings do usuário ATUAL (select *), memoizada por request.
// - Anônimo (sem sessão) → NULL: NÃO herda a linha do dono. Fecha os buracos de
//   (a) anon herdar o plano PAID do dono (custo — dispararia features pagas no saldo
//   dele) e (b) anon ver o perfil/email do dono. Pós-claim da conta, o dono usa o
//   app LOGADO — não existe mais "dono deslogado" pra esta função servir.
// - Logado: a linha própria (current_user_id = sessão). Sem linha própria → null
//   (usa defaults; NUNCA herda a de outro).
const getCurrentUserSettingsRow = cache(async (): Promise<Record<string, unknown> | null> => {
  const sessionId = await getSessionUserId()
  if (!sessionId) return null

  const supabase = createAdminClient()
  const own = await supabase
    .from("user_settings")
    .select("*")
    .eq("current_user_id", sessionId)
    .limit(1)
    .maybeSingle()
  return !own.error && own.data ? (own.data as Record<string, unknown>) : null
})

// id da linha de settings do usuário atual — pros writers (setPlan, toggles,
// perfil) atualizarem a linha certa. null quando não há linha própria/legada.
export async function getCurrentUserSettingsId(): Promise<string | null> {
  const row = await getCurrentUserSettingsRow()
  return (row?.id as string | undefined) ?? null
}

/**
 * Papel do usuário atual — a FONTE DE VERDADE do acesso (migration 140).
 *
 * Fail-closed em `leitor`: anônimo, linha ausente ou erro transitório NÃO liberam
 * escrita nem IA.
 *
 * FALLBACK-SAFE: a migration 140 é aplicada à mão, então a coluna `role` pode ainda
 * não existir. Nesse caso deriva do par legado (`is_admin` × `user_plan`) — exatamente
 * o mesmo backfill que a migration faz. O comportamento é IDÊNTICO antes e depois.
 */
export const getCurrentRole = cache(async (): Promise<Role> => {
  const row = await getCurrentUserSettingsRow()
  if (!row) return "leitor"
  if (isRole(row.role)) return row.role

  // Pré-migration 140: deriva do estado antigo.
  if (row.is_admin === true) return "curador"
  if (row.user_plan === "paid") return "assinante"
  return "leitor"
})

/**
 * Plano do usuário atual — VISTA derivada do papel (curador/assinante = `paid`;
 * leitor = `free`), para a UI que fala "plano". Não gateia nada: quem autoriza é
 * `ensurePermission(verbo)`.
 */
export async function getCurrentPlan(_admin?: AdminClient): Promise<UserPlan> {
  return planFromRole(await getCurrentRole())
}

/**
 * "Pode consumir IA?" como booleano — pra UI (esconder botão, mostrar selo "Pago").
 * O gate de verdade é `ensurePermission("consume_ai")` na action; isto só evita
 * oferecer o que vai ser negado. Memoizado por request.
 */
export const canConsumeAi = cache(async (): Promise<boolean> =>
  roleAllows(await getCurrentRole(), "consume_ai"),
)

/** Gate por PAPEL: exige `min` ou acima na escada (leitor < assinante < curador). */
export async function ensureRole(
  min: Role,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const role = await getCurrentRole()
  if (roleAtLeast(role, min)) return { ok: true }
  return {
    ok: false,
    error:
      min === "curador"
        ? "Só o Curador do catálogo pode fazer isso."
        : `Recurso do plano ${min === "assinante" ? "Assinante" : "Leitor"}.`,
  }
}

/**
 * Gate por PERMISSÃO (o verbo, não o papel). Preferir este a `ensureRole` nos call
 * sites novos: `ensurePermission("refresh_work")` diz o que está sendo protegido;
 * `ensureRole("assinante")` só diz quem passa — e quebra silenciosamente se a escada
 * mudar. Ver lib/plans/roles.ts.
 */
export async function ensurePermission(
  permission: Permission,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const role = await getCurrentRole()
  return roleAllows(role, permission)
    ? { ok: true }
    : { ok: false, error: deniedMessage(permission) }
}

// Toggle "avaliação IA na criação de obras" (migration 097). Default false.
export async function getAiEvalOnCreate(_admin?: AdminClient): Promise<boolean> {
  const row = await getCurrentUserSettingsRow()
  return (row?.ai_eval_on_create as boolean | undefined) ?? false
}

// Toggle "gerar sinopse canônica na criação" (migration 119). Default true.
export async function getSynopsisCanonicalOnCreate(_admin?: AdminClient): Promise<boolean> {
  const row = await getCurrentUserSettingsRow()
  return (row?.synopsis_canonical_on_create as boolean | undefined) ?? true
}

// Toggle "inferir tags por IA na criação" (migration 128). Default true.
export async function getTagInferenceOnCreate(_admin?: AdminClient): Promise<boolean> {
  const row = await getCurrentUserSettingsRow()
  return (row?.tag_inference_on_create as boolean | undefined) ?? true
}

// Toggle "shadow A/B da Previsão de Interesse na criação" (migration 128). Default false.
export async function getInterestShadowOnCreate(_admin?: AdminClient): Promise<boolean> {
  const row = await getCurrentUserSettingsRow()
  return (row?.interest_shadow_on_create as boolean | undefined) ?? false
}

// Toggle "gerar TODOS os dados na criação" (migration 130). Default false (opt-in).
export async function getGenerateAllOnCreate(_admin?: AdminClient): Promise<boolean> {
  const row = await getCurrentUserSettingsRow()
  return (row?.generate_all_on_create as boolean | undefined) ?? false
}

export interface ReviewSynthesisToggles {
  summaryEnabled: boolean
  digestEnabled: boolean
}

// Toggles "gerar Resumo / Digest de reviews" (migration 127). Default true/true.
export async function getReviewSynthesisToggles(
  _admin?: AdminClient,
): Promise<ReviewSynthesisToggles> {
  const row = await getCurrentUserSettingsRow()
  return {
    summaryEnabled: (row?.review_summary_enabled as boolean | undefined) ?? true,
    digestEnabled: (row?.review_digest_enabled as boolean | undefined) ?? true,
  }
}

export interface CurrentUserProfile {
  userId: string
  displayName: string | null
  email: string | null
  avatarUrl: string | null
  plan: UserPlan
  role: Role
}

/**
 * Perfil completo do usuário atual. Lê a linha do usuário (via resolver, com
 * fallback singleton só p/ anon). O userId vem da identidade (sessão/singleton),
 * não da linha, pra ser sempre o id real do usuário atual.
 */
export async function getCurrentUserProfile(admin?: AdminClient): Promise<CurrentUserProfile> {
  const [row, userId, role] = await Promise.all([
    getCurrentUserSettingsRow(),
    getCurrentUserId(admin),
    getCurrentRole(),
  ])
  return {
    userId,
    displayName: (row?.display_name as string | null | undefined) ?? null,
    email: (row?.email as string | null | undefined) ?? null,
    avatarUrl: (row?.avatar_url as string | null | undefined) ?? null,
    // Derivado do papel — NÃO lê `user_plan`, que virou legado (migration 140).
    plan: role === "leitor" ? "free" : "paid",
    role,
  }
}

/**
 * Gate de capability pra server actions. Retorna erro estruturado quando o
 * plano atual não libera a feature — o caller propaga pro client.
 */
/**
 * Exige uma SESSÃO. Use antes de escrever qualquer dado per-usuário.
 *
 * ⚠️ Não dá pra substituir por `ensurePermission("own_state")`: o papel de um anônimo
 * é `leitor` (fail-closed), e `own_state` é liberado pro leitor — ou seja, o gate de
 * papel passa. O que falta ao anônimo não é permissão, é IDENTIDADE: sem `user_id`
 * próprio, `getCurrentUserId()` cai no singleton e ele escreve nas linhas do DONO.
 */
export async function ensureSignedIn(): Promise<
  { ok: true; userId: string } | { ok: false; error: string }
> {
  const userId = await getSessionUserId()
  return userId
    ? { ok: true, userId }
    : { ok: false, error: "Entre na sua conta para fazer isso." }
}

// Admin = o DONO/operador do catálogo. Só o admin muta o catálogo COMPARTILHADO
// (obras/notas/status/etc.); demais usuários são read-only, o que evita corromper
// os dados do dono enquanto a partição per-obra (Fase 2) não existe. Memoizado por request.
//
// A admin-ness vem da FLAG `user_settings.is_admin` (migration 139), lida da linha
// do usuário logado. A conta do dono já foi reivindicada (claim) e loga normalmente,
// então NÃO tratamos mais "deslogado" como admin:
//  - Sem sessão (anônimo/deslogado) → NÃO admin (visitante read-only). Fecha o buraco
//    de produção em que qualquer anônimo seria admin. O dono agora usa o app LOGADO.
//  - Logado com linha própria + coluna is_admin → usa a flag.
//  - Fallback (coluna ausente pré-mig 139, ou logado sem linha própria) → critério
//    legado (=== singleton).
export const isCurrentUserAdmin = cache(async (): Promise<boolean> => {
  const sessionId = await getSessionUserId()
  if (!sessionId) return false // anônimo/deslogado = read-only

  // Admin = CURADOR (migration 140). `getCurrentRole` já cobre o fallback pré-140
  // (deriva de is_admin/user_plan), então este caminho não muda de comportamento.
  if ((await getCurrentRole()) === "curador") return true

  // Logado SEM linha própria: nem role nem is_admin existem pra consultar → critério
  // legado (é o dono do singleton?). Com linha própria, o papel é a palavra final.
  const row = await getCurrentUserSettingsRow()
  if (row) return false
  return sessionId === (await getSingletonUserId())
})

/**
 * Gate de curadoria — muta o catálogo compartilhado ou a config global.
 *
 * Alias de `ensureRole("curador")`. Preservado com este nome porque ~130 call sites o
 * usam; a semântica não mudou (admin sempre foi o curador). Em código NOVO prefira
 * `ensurePermission(verbo)`, que diz o que está protegido em vez de quem passa.
 */
export async function ensureAdmin(): Promise<{ ok: true } | { ok: false; error: string }> {
  return (await isCurrentUserAdmin())
    ? { ok: true }
    : { ok: false, error: "Só o Curador do catálogo pode fazer isso." }
}
