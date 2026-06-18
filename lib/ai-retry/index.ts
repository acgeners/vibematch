// Política de retry das chamadas de IA (Plano 2, commit 4). Tudo puro.
// NÃO substitui os retries internos do SDK (decisão §15 Opção 1) — é a política
// explícita/testável usada para telemetria e p/ os fallbacks que nós controlamos.

export * from "./types"
export * from "./classify-retry"
export * from "./backoff"
export * from "./policies"
