// Logs estruturados (1 JSON por linha). TODO evento carrega `reqId` quando existe
// um request associado, pra rastrear uma resolução inteira ponta a ponta.

export type LogLevel = "info" | "warn" | "error"

export function log(level: LogLevel, event: string, fields: Record<string, unknown> = {}): void {
  const line = JSON.stringify({ ts: new Date().toISOString(), level, event, ...fields })
  if (level === "error") console.error(line)
  else console.log(line)
}
