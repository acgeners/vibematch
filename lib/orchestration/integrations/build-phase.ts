/**
 * Detecção da fase de PRODUCTION BUILD do Next.js (App Router).
 *
 * Durante `next build`, o Next define `process.env.NEXT_PHASE` como
 * `PHASE_PRODUCTION_BUILD` (forma oficial, exportada de "next/constants") — o
 * mesmo valor usado em `next.config`. Em runtime (dev/prod server) a env NÃO está
 * setada, então `isProductionBuildPhase()` é false e o comportamento normal segue.
 *
 * Usado pela orquestração para evitar efeitos colaterais (recálculo, jobs) quando
 * o prerender de uma página executa código de leitura que dispararia trabalho.
 */
import { PHASE_PRODUCTION_BUILD } from "next/constants"

export function isProductionBuildPhase(): boolean {
  return process.env.NEXT_PHASE === PHASE_PRODUCTION_BUILD
}
