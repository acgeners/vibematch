/**
 * Parsing + validação (Zod) dos argumentos da CLI do backfill — PURO (sem IO,
 * sem server-only), testável isoladamente. Erros de configuração devem encerrar
 * ANTES de qualquer chamada paga (a CLI sai com código != 0).
 *
 * Regra de segurança: dry-run é o PADRÃO; `--execute` exige simultaneamente
 * `--plan-signature` e `--max-cost-usd` (o micro-threshold individual NUNCA
 * autoriza o lote agregado).
 */
import { z } from "zod"

export function parseRawArgs(argv: string[]): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {}
  for (const arg of argv) {
    if (!arg.startsWith("--")) continue
    const body = arg.slice(2)
    const eq = body.indexOf("=")
    if (eq === -1) out[body] = true
    else out[body.slice(0, eq)] = body.slice(eq + 1)
  }
  return out
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const BackfillArgsSchema = z
  .object({
    execute: z.boolean().default(false),
    // Escopo de piloto: lista de UUIDs separados por vírgula (ex.: --work-id=a,b,c).
    "work-id": z
      .string()
      .optional()
      .transform((s) => (s ? s.split(",").map((x) => x.trim()).filter(Boolean) : undefined))
      .refine((ids) => !ids || ids.every((id) => UUID_RE.test(id)), {
        message: "--work-id deve conter apenas UUIDs válidos separados por vírgula.",
      }),
    limit: z.coerce.number().int().positive().optional(),
    "plan-signature": z.string().min(16).optional(),
    "max-cost-usd": z.coerce.number().positive().finite().optional(),
    concurrency: z.coerce.number().int().min(1).max(5).default(3),
    "retry-failed": z.boolean().default(false),
  })
  .refine((a) => !a.execute || (!!a["plan-signature"] && a["max-cost-usd"] != null), {
    message: "Execução exige --plan-signature=<hash> E --max-cost-usd=<valor>.",
  })
  .refine((a) => !(a["work-id"] && a["work-id"].length > 0 && a.limit != null), {
    message: "--work-id e --limit são mutuamente exclusivos (escopo ambíguo).",
  })

export type BackfillArgs = z.infer<typeof BackfillArgsSchema>

/** Escopo derivado dos args (alinhado a BackfillScope do domínio). */
export type CliScope =
  | { kind: "full" }
  | { kind: "ids"; workIds: string[] }
  | { kind: "limit"; limit: number }

export function scopeFromArgs(args: BackfillArgs): CliScope {
  if (args["work-id"] && args["work-id"].length > 0) return { kind: "ids", workIds: args["work-id"] }
  if (args.limit != null) return { kind: "limit", limit: args.limit }
  return { kind: "full" }
}

export type ParseResult =
  | { ok: true; args: BackfillArgs; scope: CliScope }
  | { ok: false; error: string }

export function parseBackfillCliArgs(argv: string[]): ParseResult {
  const parsed = BackfillArgsSchema.safeParse(parseRawArgs(argv))
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues.map((i) => i.message).join("; ") }
  }
  return { ok: true, args: parsed.data, scope: scopeFromArgs(parsed.data) }
}
