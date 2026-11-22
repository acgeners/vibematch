/**
 * Cópia do estado anterior das notas de algumas obras de UMA pessoa, conferida depois de gravada. Dono único
 * do formato: os scripts que alinham e os que desfazem leem e escrevem por aqui.
 * ⚠️ `COPIA_DIR` aponta para o `.backups/` do checkout principal quando o script roda de um worktree — a pasta
 * do worktree some com ele.
 */
import fs from "node:fs"
import path from "node:path"
import { podar } from "./backups-retencao.mjs"

const TABELAS = ["user_work_state", "pilot_taste_scores", "prediction_ledger", "prediction_snapshots"]

export async function copiarNotas(sb, userId, workIds, motivo) {
  podar("nota-das-categorias")
  const stamp = new Date().toISOString().replace(/[:.]/g, "-")
  const base = process.env.COPIA_DIR ?? path.resolve(process.cwd(), ".backups")
  const dir = path.join(base, `nota-das-categorias-${stamp}`)
  /** @type {Record<string, any[]>} */
  const tabelas = {}
  for (const t of TABELAS) {
    const { data, error, count } = await sb
      .from(t)
      .select("*", { count: "exact" })
      .eq("user_id", userId)
      .in("work_id", workIds)
      .order("work_id")
      .limit(1000)
    if (error) throw new Error(`cópia de ${t}: ${error.message}`)
    if (count !== data.length) throw new Error(`cópia de ${t} incompleta: ${data.length} de ${count}`)
    tabelas[t] = data
  }
  fs.mkdirSync(dir, { recursive: true })
  const arquivo = path.join(dir, "antes.json")
  fs.writeFileSync(arquivo, JSON.stringify({ motivo, stamp, userId, workIds, tabelas }, null, 2))
  const relido = JSON.parse(fs.readFileSync(arquivo, "utf8"))
  for (const t of TABELAS) {
    if (relido.tabelas[t].length !== tabelas[t].length) throw new Error(`cópia de ${t} não bate ao reler`)
  }
  const resumo = TABELAS.map((t) => `${t} ${tabelas[t].length}`).join(" · ")
  console.log(`cópia conferida: ${arquivo}\n  ${resumo}`)
  return { arquivo, tabelas }
}
