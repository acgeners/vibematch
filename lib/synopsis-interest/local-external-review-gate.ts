/**
 * Plano 3 — Gate LOCAL do editor de reviews externas manuais (Fase B2.2M §2 + B2.2M-AUDIT §2).
 *
 * O projeto NÃO tem auth administrativa. Esta interface (e suas Server Actions) só
 * pode existir em ambiente de desenvolvimento local. O gate é FECHADO POR PADRÃO:
 * variável ausente ⇒ bloqueado; produção/Vercel Preview ⇒ bloqueado; host não-local
 * ⇒ bloqueado. O componente NÃO renderiza quando bloqueado E cada Server Action
 * executa o MESMO gate (não basta esconder o componente). A service-role key nunca
 * chega ao client — as ações são server-only.
 *
 * ⚠️ LIMITE DE SEGURANÇA (auditado em B2.2N): o `host` vem do header HTTP `Host`, que é
 * CONTROLÁVEL PELO CLIENTE. `Host: localhost` numa conexão REMOTA passaria no teste de
 * host-local — o header NÃO prova que a conexão é loopback. A defesa AUTORITATIVA é
 * OPERACIONAL: subir o servidor ligado SÓ a 127.0.0.1 (`npm run dev:local-editor`), de
 * modo que conexões remotas nunca cheguem. O host-local é condição NECESSÁRIA mas NÃO
 * suficiente — é só uma 2ª camada barata.
 *
 * NOTA DE CORREÇÃO (B2.2N): uma tentativa anterior (B2.2M-AUDIT) de bloquear por presença
 * de `X-Forwarded-Host`/`Forwarded` foi REVERTIDA — o servidor do Next SINTETIZA esses
 * headers `x-forwarded-*` em TODO request (inclusive loopback direto), então a presença
 * deles não distingue proxy de conexão direta (bloqueava TUDO, quebrando o editor) e o
 * valor é igualmente spoofável. Não há, via `next/headers`, sinal CONFIÁVEL do endereço
 * remoto dentro da Server Action ⇒ não se usa header de proxy. Gate fail-closed.
 *
 * A lógica de decisão é PURA (`evaluateLocalExternalReviewEditorGate`), testável sem
 * Next/headers. Os wrappers que leem `process.env` + `next/headers` fazem `import`
 * dinâmico de `next/headers` SÓ quando chamados (mantém o módulo importável em teste).
 */

/** Hostnames considerados locais (§2). */
export const ALLOWED_LOCAL_HOSTNAMES = ["localhost", "127.0.0.1", "::1"] as const

export const LOCAL_EXTERNAL_REVIEW_EDITOR_FLAG = "ENABLE_LOCAL_EXTERNAL_REVIEW_EDITOR"

export interface LocalEditorGateInputs {
  /** `process.env.NODE_ENV`. */
  nodeEnv: string | undefined
  /** `process.env[LOCAL_EXTERNAL_REVIEW_EDITOR_FLAG]`. */
  flag: string | undefined
  /** Header `host` (pode ter porta / colchetes IPv6). `null` ⇒ desconhecido. */
  host: string | null
  /** `process.env.VERCEL_ENV` (production/preview/development) — qualquer valor ⇒ Vercel ⇒ bloqueado. */
  vercelEnv?: string | undefined
}

export interface LocalEditorGateResult {
  allowed: boolean
  /** Motivo do bloqueio (null quando permitido). */
  reason:
    | null
    | "production"
    | "vercel"
    | "flag_disabled"
    | "non_local_host"
    | "unknown_host"
}

/**
 * Extrai o hostname puro de um header `host`: remove a porta e os colchetes de
 * IPv6. `localhost:3001` → `localhost`; `[::1]:3001` → `::1`; `127.0.0.1:3001` →
 * `127.0.0.1`. Retorna `null` quando vazio.
 */
export function normalizeHostname(host: string | null | undefined): string | null {
  if (host == null) return null
  const h = host.trim().toLowerCase()
  if (h === "") return null
  // IPv6 com colchetes: [::1] ou [::1]:porta
  const bracket = h.match(/^\[([^\]]+)\](?::\d+)?$/)
  if (bracket) return bracket[1]
  // IPv6 sem colchetes (contém ≥2 ':') — não tem porta separável de forma segura
  if ((h.match(/:/g)?.length ?? 0) >= 2) return h
  // host:porta comum
  const colon = h.lastIndexOf(":")
  return colon === -1 ? h : h.slice(0, colon)
}

/**
 * Decisão PURA do gate. Todas as condições precisam ser verdadeiras para liberar:
 * não-produção · flag === "true" · sem Vercel · host local. Fechado por padrão. O
 * host-local é condição NECESSÁRIA mas NÃO suficiente (header `Host` é spoofável) — a
 * suficiência real é a ligação loopback do servidor (`dev:local-editor`). Headers de
 * proxy NÃO são consultados (o Next sintetiza `x-forwarded-*` em todo request).
 */
export function evaluateLocalExternalReviewEditorGate(
  inputs: LocalEditorGateInputs,
): LocalEditorGateResult {
  if (inputs.nodeEnv === "production") return { allowed: false, reason: "production" }
  // Vercel (Preview ou Production) — nunca é "local". Qualquer VERCEL_ENV bloqueia.
  if (inputs.vercelEnv != null && inputs.vercelEnv.trim() !== "") return { allowed: false, reason: "vercel" }
  if (inputs.flag !== "true") return { allowed: false, reason: "flag_disabled" }
  const host = normalizeHostname(inputs.host)
  if (host == null) return { allowed: false, reason: "unknown_host" }
  if (!ALLOWED_LOCAL_HOSTNAMES.includes(host as (typeof ALLOWED_LOCAL_HOSTNAMES)[number])) {
    return { allowed: false, reason: "non_local_host" }
  }
  return { allowed: true, reason: null }
}

/**
 * Lê os inputs do ambiente + request (server). `host` via `next/headers`. NÃO lê
 * `x-forwarded-*` (sintetizados pelo Next em todo request ⇒ sem valor de localidade).
 */
async function readGateInputs(): Promise<LocalEditorGateInputs> {
  let host: string | null = null
  try {
    const { headers } = await import("next/headers")
    const h = await headers()
    host = h.get("host")
  } catch {
    host = null
  }
  return {
    nodeEnv: process.env.NODE_ENV,
    flag: process.env[LOCAL_EXTERNAL_REVIEW_EDITOR_FLAG],
    host,
    vercelEnv: process.env.VERCEL_ENV,
  }
}

/** `true` somente quando o gate está totalmente aberto. NÃO lança. */
export async function isLocalExternalReviewEditorAllowed(): Promise<boolean> {
  return evaluateLocalExternalReviewEditorGate(await readGateInputs()).allowed
}

export class LocalEditorBlockedError extends Error {
  constructor(public readonly reason: LocalEditorGateResult["reason"]) {
    super(`Editor de reviews externas indisponível (gate local: ${reason ?? "desconhecido"}).`)
    this.name = "LocalEditorBlockedError"
  }
}

/**
 * Gate server-only centralizado. LANÇA `LocalEditorBlockedError` quando bloqueado.
 * Toda Server Action de cadastro/edição/exclusão deve chamar isto ANTES de tocar
 * no banco — não confiar em esconder o componente.
 */
export async function assertLocalExternalReviewEditorAllowed(): Promise<void> {
  const result = evaluateLocalExternalReviewEditorGate(await readGateInputs())
  if (!result.allowed) throw new LocalEditorBlockedError(result.reason)
}
