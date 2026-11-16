"use server"

// FACHADA de server actions do resolver da Comix.
//
// Um arquivo `"use server"` publica TODA função exportada como endpoint HTTP — o
// Next gera um id de action e qualquer um pode fazer POST nela, tenha ou não botão
// na tela. Por isso aqui só entra o que a UI de fato chama; a implementação (e as
// funções que rodam em background: resolveComixHidForWork, resolveComixHidsPending,
// ensureComixReady, resolveComixDataResilient) vive em `@/server/comix/resolver`,
// que NÃO é `"use server"` e portanto não é endereçável de fora.
//
// Os gates de admin ficam na implementação (startComixResolver, setComixHidManually).

import * as impl from "@/server/comix/resolver"
import { ensureAdmin } from "@/server/queries/current-user"
import { hasCfBypassConfigured } from "@/lib/external/flaresolverr"

export async function getComixResolverStatus() {
  return impl.getComixResolverStatus()
}

export async function startComixResolver() {
  return impl.startComixResolver()
}

export async function getComixHealthStatus() {
  return impl.getComixHealthStatus()
}

export async function getComixResolutionStatus(workId: string) {
  return impl.getComixResolutionStatus(workId)
}

export async function validateComixHid(hidOrUrl: string) {
  return impl.validateComixHid(hidOrUrl)
}

/**
 * O botão "Testar agora". O canário MOVE o gate da Comix, que é gravado no banco e vale
 * para todo processo: rodado de onde a Comix bloqueia (o servidor do Fly responde 403),
 * ele marcaria a Comix como fora também para o Mac. Por isso só roda com o contorno do
 * Cloudflare configurado — a mesma régua da checagem de capítulos — e só para o curador
 * (até 2026-11-16 esta action não tinha gate nenhum). Quem a usa em background
 * (`ensureComixReady`) chama a implementação direto.
 */
export async function checkComixHealth() {
  const gate = await ensureAdmin()
  if (!gate.ok) throw new Error(gate.error ?? "Só o Curador do catálogo pode fazer isso.")
  if (!hasCfBypassConfigured()) throw new Error("Indisponível neste servidor: sem o contorno do Cloudflare.")
  return impl.checkComixHealth()
}

export async function setComixHidManually(input: { workId: string; hidOrUrl: string }) {
  return impl.setComixHidManually(input)
}

export async function markComixAbsent(workId: string) {
  return impl.markComixAbsent(workId)
}

export async function unmarkComixAbsent(workId: string) {
  return impl.unmarkComixAbsent(workId)
}
