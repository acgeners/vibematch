"use server"

import { z } from "zod"
import { getBussolaLinksFor } from "@/server/queries/bussola-links"
import type { BussolaLinks } from "@/lib/ranking/bussola-links"

const workIdSchema = z.string().uuid()

/**
 * Ligações de uma obra no mapa da Bússola (painel da obra clicada). Endpoint público como toda
 * server action: só lê, devolve catálogo e os grupos de QUEM chama (nenhum, sem sessão).
 */
export async function getBussolaLinks(workId: string): Promise<BussolaLinks | null> {
  const parsed = workIdSchema.safeParse(workId)
  if (!parsed.success) return null
  try {
    return await getBussolaLinksFor(parsed.data)
  } catch (error) {
    console.error("[bussola] ligações indisponíveis:", error)
    return null
  }
}
