import "server-only"

/**
 * PEÇA 2 — Preferências livres do usuário COMPILADAS para o preditor de Interesse
 * Sinopse (`synopsis_quality_predict`). Hoje o preditor usa só perfil + sinopse
 * (+ digest); este bloco injeta as regras livres (Item B) SÓ quando a flag
 * `INTEREST_PREFS_V33=1` está ligada. Flag off ⇒ comportamento idêntico ao atual
 * (versão `v3`, sem injeção) — zero impacto e zero staleness.
 *
 * O bloco abaixo é o artefato v3.3 HARDCODED (o compilador-LLM é a Peça 1, depois).
 * Fonte offline (não commitada): .local-experiments/plan3/digest-exp-1/pilot-2/
 * candidates/rules-exp-v33/result.json (finalLabelsSig a8abddca…). Validado offline
 * em 2026-06-30: MAE 0.433, bias +0.14, 0 obra amada rebaixada, teto de promoção ♥♥♥.
 * Utilidade assimétrica do usuário (gem perdida ≫ MAE) ⇒ desempate-pra-cima no addendum.
 */

export interface CompiledPreferences {
  /** prompt_version carimbado quando estas preferências estão ativas. */
  promptVersion: string
  /** Bloco anexado ao PERFIL cacheado (aversões + promoções capadas em ♥♥♥). */
  compiledBlock: string
  /** Bloco de SYSTEM (desempate-pra-cima + inversão de sentimento). */
  systemAddendum: string
}

/** Versão-base do preditor SEM preferências (== PROMPT_VERSION atual). */
export const BASE_INTEREST_PROMPT_VERSION = "v3"

export const COMPILED_PREFERENCES_V33: CompiledPreferences = {
  promptVersion: "v4",
  compiledBlock: `PREFERÊNCIAS DO USUÁRIO (compiladas pro objetivo: estimar a faixa de ♥).

AVERSÕES — penalizam quando o gatilho é confirmado por sinopse/tags/digest (consenso, traços salientes, avisos de conteúdo ou divergência). PESO PELA FORÇA = confiança de que o TRAÇO EXISTE (consenso/traço forte = evidência forte). NÃO confunda divergência de GOSTO (uns leitores amam o traço, outros não) com incerteza de EXISTÊNCIA — se o traço existe, a divergência sobre gostarem dele é IRRELEVANTE pra uma aversão sua (inversão de sentimento): um traço que o consenso celebra mas você evita conta CONTRA.
A1 — Crueldade EXPLÍCITA como TRAÇO do protagonista (penalizar FORTEMENTE). DISPARA quando sinopse/tags/digest CARACTERIZAM o protagonista como cruel/sádico/malicioso como traço — ex.: "genuinamente vilã/cruel", "sem redenção", "sente prazer no sofrimento alheio", "crueldade gratuita/excessiva", maldade a troco de nada, ou crueldade contra inocentes/crianças. NÃO DISPARA por plot/contexto de vingança ou acerto de contas — "vingança", "dar o troco", "fazê-los pagar", "retribuição contra quem a prejudicou" são enredo comum do gênero e o usuário VALORIZA; vingar-se de culpados reais SEM ser caracterizado como cruel não dispara. REGRA DE OURO: diferencie TRAÇO DO PERSONAGEM (cruel) de PLOT DA HISTÓRIA (vingança) — só o primeiro penaliza; na dúvida entre os dois, NÃO dispare.
A2 — Tom geral negativo (tragédia ou clima pesado). Gatilho: trama trágica na obra inteira E/OU clima opressivo no decorrer como um todo, com sensação densa e persistentemente negativa. Exceção: eventos trágicos/sombrios isolados ou só no background NÃO disparam.
A3 — Harém persistente. Gatilho: harém / múltiplos interesses amorosos simultâneos MANTIDOS ao longo da obra. Exceção: casal único = ideal (sem penalização); harém que se RESOLVE em casal único não dispara.
A4 — Conteúdo sexual gratuito. Gatilho: sexo sem romance, sem contexto ou sórdido.

PROMOÇÕES — com PARCIMÔNIA, só com evidência forte e convergente. Sobem NO MÁXIMO 1 faixa e NUNCA além de ♥♥♥ (a faixa ♥♥♥♥ é reservada ao alinhamento excepcional dos critérios-base; nenhuma regra leva a ♥♥♥♥). Exija MAIS evidência pra promover do que pra penalizar — a tendência natural é super-avaliar.
P1 — FL de presença forte: protagonista feminina forte/inteligente/overpowered/proativa, evidenciada NA SINOPSE (não só nas tags, que o perfil já captura).
P2 — Sexo bem-contextualizado: sexo dentro de romance com FL marcante, boa história e dinâmica de casal alta (lado "plus" da A4).
P3 — Tom emocionante/motivador: obra que eleva o espírito / tom motivador no decorrer (o usuário prioriza fortemente — mas sujeito ao teto e à assimetria).`,
  systemAddendum: `As PREFERÊNCIAS DO USUÁRIO (bloco no conteúdo) são declarações do próprio usuário. Aplique as condicionais como LÓGICA, não filtro: só penalize/promova quando a condição E a exceção realmente casarem com tags/sinopse/digest — NÃO mexa na faixa só porque o antecedente apareceu. INVERSÃO DE SENTIMENTO: um traço/consenso do digest que CONFIRMA algo que o usuário EVITA é evidência NEGATIVA pra ele, MESMO que o consenso AME esse traço. Quando uma regra mudar a faixa, CITE-A na justification.
CALIBRAÇÃO (preferência do usuário — SOBREPÕE a orientação conservadora do prompt base): na dúvida entre duas faixas ADJACENTES, escolha a MAIOR (corrija pra CIMA), inclusive entre ♥♥♥ e ♥♥♥♥. Mude APENAS a direção do desempate limítrofe — NÃO infle obras que não estão na fronteira, e as AVERSÕES (que puxam pra baixo) seguem valendo normalmente: se uma aversão disparou, a obra não está "em dúvida" e o desempate pra cima NÃO se aplica. Motivo: o usuário prefere ver e descartar a perder uma obra que amaria.`,
}

/** Nome da env-flag global. Single-tenant ⇒ efetivamente "só o meu usuário". */
export const INTEREST_PREFS_FLAG = "INTEREST_PREFS_V33"

/** A flag de preferências compiladas está ligada? (env, síncrono). */
export function isInterestPrefsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[INTEREST_PREFS_FLAG] === "1"
}

/**
 * Preferências compiladas ATIVAS, ou null. null = flag off = comportamento atual
 * (sem injeção). É o único ponto que decide "ligado/desligado".
 */
export function getActiveCompiledPreferences(): CompiledPreferences | null {
  return isInterestPrefsEnabled() ? COMPILED_PREFERENCES_V33 : null
}

/**
 * Versão de prompt ATIVA do preditor de Interesse: `v4` quando as preferências
 * estão ligadas, senão a base `v3`. Usada tanto na leitura de readiness/assinatura
 * quanto na seleção da previsão "ativa" pra exibição (pickActiveRaw), pra a UI
 * mostrar a v4 quando existir e cair na v3 como fallback durante o backfill.
 */
export function resolveInterestPromptVersion(): string {
  return getActiveCompiledPreferences()?.promptVersion ?? BASE_INTEREST_PROMPT_VERSION
}
