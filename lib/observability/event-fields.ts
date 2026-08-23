import { redactSecrets, sanitizeErrorMessage } from "@/lib/observability/redact"

/**
 * Os pedaços que os DOIS eventos de erro (`server_error` e `handled_server_error`) precisam
 * afirmar do mesmo jeito. Extraídos em 2026-08-23, quando o segundo evento nasceu.
 *
 * 🔴 A razão é a doença nomeada deste projeto: uma 2ª leitura de `FLY_REGION` ou um 2º teto de
 * stack é "dois critérios pro mesmo fato" — os dois eventos passariam a discordar sobre o mesmo
 * runtime, e o que discordasse seria justo o que ninguém confere. Aqui não há política nova:
 * este arquivo é o que `server-error-event.ts` já fazia inline, sem mudar um valor.
 *
 * ⚠️ NÃO é um logger genérico, e não deve virar um. Sem levels, sem transports, sem adapters:
 * quem decide o formato é cada construtor de evento, e o que mora aqui são os campos que os dois
 * compartilham por serem fatos do MESMO processo.
 */

/** Teto do stack no evento. Compartilhado de propósito: dois tetos = dois eventos truncando em pontos diferentes. */
export const STACK_MAX = 2000

/** String não-vazia ou `null`. Campo ausente vira `null`, nunca `""` nem `undefined`. */
export function texto(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null
}

export type RuntimeFields = {
  env: string | null
  flyApp: string | null
  flyMachine: string | null
  flyRegion: string | null
  flyImage: string | null
  commit: string | null
}

/**
 * Onde o processo está rodando.
 *
 * ⚠️ A plataforma injeta os `FLY_*` em runtime; LOCALMENTE são null, e null é a resposta
 * correta — inventar valor faria o log de dev parecer log de produção.
 *
 * ⚠️ LACUNA REGISTRADA: nada injeta SHA de commit hoje — nem o Dockerfile, nem workflow, nem
 * `generateBuildId`. `commit` fica null de propósito; `flyImage` é o identificador de release
 * que existe de fato.
 */
export function runtimeFields(env: Record<string, string | undefined>): RuntimeFields {
  return {
    env: texto(env.NODE_ENV),
    flyApp: texto(env.FLY_APP_NAME),
    flyMachine: texto(env.FLY_MACHINE_ID),
    flyRegion: texto(env.FLY_REGION),
    flyImage: texto(env.FLY_IMAGE_REF),
    commit: texto(env.GIT_COMMIT_SHA),
  }
}

/** Erro sem nome ainda é um erro: cai num rótulo estável em vez de sumir do evento. */
export function nomeDoErro(error: unknown): string {
  const err = error instanceof Error ? error : null
  return err?.name || (error === null || error === undefined ? "NonError" : typeof error)
}

/**
 * Stack redigido e truncado, nesta ORDEM.
 *
 * 🔴 Redigir ANTES de cortar não é detalhe: cortar primeiro pode partir um segredo ao meio e
 * deixar a metade que o regex já não reconhece.
 */
export function stackSanitizado(error: unknown): string | null {
  const err = error instanceof Error ? error : null
  if (!err?.stack) return null
  const s = redactSecrets(err.stack)
  return s.length > STACK_MAX ? `${s.slice(0, STACK_MAX - 1)}…` : s
}

/**
 * Mensagem do erro, redigida — para a fonte que NÃO lança.
 *
 * 🔴 MEDIDO em 2026-08-23 contra o Supabase local (supabase-js 2.105.1): o cliente devolve o
 * erro do PostgREST como OBJETO PLANO — `{ code, details, hint, message }`, com
 * `instanceof Error` FALSO e SEM `stack`. Como `sanitizeErrorMessage` faz `String(err)` no
 * não-Error, o evento saía com `errorMessage: "[object Object]"`: cego justo na classe que
 * ele existe para cobrir. E saiu — foi o 1º runtime probe deste gate que mostrou, com a suíte
 * inteira verde, porque o teste mockava um `Error` que o runtime nunca produz.
 *
 * ⚠️ As três formas medidas, todas objeto plano: coluna inexistente ⇒
 * `"column … does not exist"`; backend inalcançável ⇒ `"TypeError: fetch failed"`; chave
 * inválida ⇒ `""`. A última é o achado da A3.1, e é o que torna `operation` obrigatório:
 * mensagem vazia não pode inutilizar o evento.
 *
 * ⚠️ Por que aqui, e não dentro de `sanitizeErrorMessage`: aquele é o dono da mensagem do
 * `server_error`, cuja fonte é erro LANÇADO — `Error` de verdade. Mudá-lo para acomodar a
 * fonte DESTE evento seria redesenhar o evento existente por causa do novo. O que a segurança
 * exige compartilhado é a SANITIZAÇÃO, e ela é a mesma (`redactSecrets`, via
 * `sanitizeErrorMessage`); o que difere é de ONDE a mensagem é extraída — e difere porque as
 * duas fontes são de fato diferentes.
 */
export function mensagemDoErro(error: unknown): string {
  if (error === null || typeof error !== "object" || error instanceof Error) {
    return sanitizeErrorMessage(error)
  }
  const m = (error as { message?: unknown }).message
  // Só `message`, e só quando é string: `code`, `details` e `hint` ficam de fora por AUSÊNCIA
  // DE COLETA, que é a defesa forte — o regex é apenas rede.
  return sanitizeErrorMessage(typeof m === "string" ? m : error)
}
