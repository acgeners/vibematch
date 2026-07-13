"use server"

// FACHADA de server actions dos embeddings. Ver a nota em `@/server/embeddings/refresh`:
// `countStaleEmbeddings` (lida por uma query server-side) e `refreshEmbeddingForWork`
// (roda na cascata de criação, sem sessão) saem do `"use server"` pra deixarem de ser
// endpoint HTTP público. Aqui fica só o botão do painel — gated na implementação.

import * as impl from "@/server/embeddings/refresh"

export type { RefreshEmbeddingsResult } from "@/server/embeddings/refresh"

export async function refreshEmbeddings() {
  return impl.refreshEmbeddings()
}
