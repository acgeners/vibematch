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

export async function getComixResolverStatus() {
  return impl.getComixResolverStatus()
}

export async function startComixResolver() {
  return impl.startComixResolver()
}

export async function getComixHealthStatus() {
  return impl.getComixHealthStatus()
}

export async function isComixAutoResolveAvailable() {
  return impl.isComixAutoResolveAvailable()
}

export async function getComixResolutionStatus(workId: string) {
  return impl.getComixResolutionStatus(workId)
}

export async function validateComixHid(hidOrUrl: string) {
  return impl.validateComixHid(hidOrUrl)
}

export async function checkComixHealth() {
  return impl.checkComixHealth()
}

export async function setComixHidManually(input: { workId: string; hidOrUrl: string }) {
  return impl.setComixHidManually(input)
}
