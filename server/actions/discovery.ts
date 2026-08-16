"use server"

import { suggestSeedReplacements } from "@/server/queries/seed-discovery"
import type { SeedSuggestion } from "@/server/queries/seed-discovery"

/**
 * Sugestões de substituta para a semente que está destoando (`/discover`).
 *
 * 🔴 `export type { X }` SEM `from` derruba o módulo inteiro em runtime. Medido em
 * 2026-08-15 abrindo a página: `ReferenceError: SeedSuggestion is not defined` no *server
 * actions loader*, e com ele **todas** as actions da rota passaram a dar 500 — inclusive a
 * que alimenta o chrome, então a barra exibia "Entrar" para quem estava logado. `tsc
 * --noEmit` passou limpo e a suíte ficou verde: o loader reexporta o NOME, e um binding que
 * só existia como tipo importado não sobrevive à compilação.
 *
 * ⚠️ `export type { X } from "módulo"` é diferente e funciona (cinco arquivos de actions já
 * fazem isso) — lá o loader tem o especificador e não depende de binding local. Aqui a saída
 * foi não reexportar: quem precisa do tipo importa de `@/server/queries/seed-discovery`,
 * onde ele é declarado. Guardado por
 * `tests/unit/orchestration/use-server-so-exporta-async.test.ts`.
 *
 * 🔴 Sem gate de papel, de propósito: a leitura é de CATÁLOGO (embeddings de obras públicas)
 * e a página inteira já exige sessão pelo proxy (`SIGNED_IN_PREFIXES`). O que esta action
 * NÃO pode fazer é tocar em dado per-user — e ela não toca.
 */
export async function suggestSeedReplacementsAction(
  keepIds: string[],
  excludeIds: string[],
): Promise<SeedSuggestion[]> {
  return suggestSeedReplacements(keepIds, excludeIds)
}
