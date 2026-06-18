// Barrel do cache de resultado das chamadas de IA (Plano 2).
// Commit 1: tipos + chave canônica (puro). Commits seguintes acrescentam
// cache-events (telemetria) e single-flight (dedup em processo).

export * from "./types"
export * from "./canonicalize"
export * from "./build-cache-key"
