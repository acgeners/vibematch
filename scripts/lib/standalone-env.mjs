/**
 * O ambiente do `server.js` no `npm start` local (`scripts/start-standalone.mjs`). Módulo puro: lê o
 * `.env.local` e monta o ambiente do filho; quem spawna é o lançador.
 */
import { existsSync, readFileSync } from "node:fs"
import path from "node:path"

/**
 * Credenciais ADMINISTRATIVAS: só scripts as usam, nunca o app em runtime. Não entram no servidor,
 * venham do `.env.local` ou do shell.
 *   · `SUPABASE_ACCESS_TOKEN` — token da Management API (db-health, db-diff, egress-baseline,
 *     configurar-smtp, apply-migration).
 *   · `SUPABASE_DB_PASSWORD` — senha do Postgres (backup-db, db-pull, psql das migrations).
 * O teste `standalone-sem-credencial-admin` confere que o código de runtime não cita nenhuma delas.
 */
export const CREDENCIAIS_SO_DE_SCRIPT = ["SUPABASE_ACCESS_TOKEN", "SUPABASE_DB_PASSWORD"]

/**
 * O `server.js` gerado NÃO lê `.env.local` — em produção quem injeta as variáveis é a plataforma
 * (no Fly, o Dockerfile + os secrets). Sem isto, o servidor sobe, responde 200 e toda página morre
 * com "supabaseKey is required" numa tela genérica de erro. Só afeta o `npm start` local.
 *
 * @param {string} raiz
 * @returns {Record<string, string>}
 */
export function carregarEnvLocal(raiz) {
  const arquivo = path.join(raiz, ".env.local")
  if (!existsSync(arquivo)) return {}
  /** @type {Record<string, string>} */
  const env = {}
  for (const linha of readFileSync(arquivo, "utf8").split("\n")) {
    const m = linha.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/)
    if (m && !linha.trimStart().startsWith("#")) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "")
  }
  return env
}

/**
 * O ambiente do servidor: `.env.local`, com o shell vencendo (como sempre foi), sem as credenciais
 * administrativas.
 *
 * 🔴 A ORDEM importa. O `next-server` reescreve o título do processo, e no macOS o `pgrep -fl` passa a
 * mostrar o título seguido da PRIMEIRA string do ambiente (medido em 2026-10-16 com valores
 * fictícios). Era o `SUPABASE_ACCESS_TOKEN`, a 1ª chave do `.env.local` — foi assim que ele apareceu
 * num transcript. `PORT` (não secreta) vai na frente: tirar só a credencial poria a próxima chave do
 * `.env.local`, uma API key paga, nessa posição.
 *
 * @param {{ envLocal: Record<string, string>, processEnv: Record<string, string | undefined>, porta: string }} entrada
 * @returns {Record<string, string | undefined>}
 */
export function ambienteDoServidor({ envLocal, processEnv, porta }) {
  const env = { PORT: porta, ...envLocal, ...processEnv }
  env.PORT = porta
  for (const chave of CREDENCIAIS_SO_DE_SCRIPT) delete env[chave]
  return env
}
