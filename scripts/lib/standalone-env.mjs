/**
 * O ambiente do `server.js` no `npm start` local (`scripts/start-standalone.mjs`). Módulo puro: lê o
 * `.env.local` e monta o ambiente do filho; quem spawna é o lançador.
 */
import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import { isCanonicalCheckout } from "../../lib/ai/git-probe.mjs"
import { ehLocal } from "./local-primary.mjs"

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

/**
 * Este checkout pode subir o servidor local? A regra é a das chamadas pagas e do recálculo
 * (`lib/ai/code-provenance.ts`): contra o banco da NUVEM, só um checkout CANÔNICO — rastreado limpo e
 * HEAD exatamente na ref local `origin/main` (`isCanonicalCheckout`, o mesmo predicado). Banco local
 * (`smoke:logado`, `db:local`) e Fly passam sem olhar git.
 *
 * 🔴 Por que no lançador: o `npm start` é a curadoria local, e salvar "Versões da obra…" reconcilia a
 * inferência estrutural na hora (`STRUCTURAL_INFERENCE_AUTO_APPLY`), por um caminho que não passa pela
 * guarda do recálculo. Checkout não canônico não sobe; o Fly não usa este lançador (`node server.js`).
 * ⚠️ Não faz `git fetch`: a ref é a local, como nas outras guardas.
 *
 * @param {{ url: string | undefined, onFly: boolean, sondar: () => import("../../lib/ai/code-provenance").GitProbe }} entrada
 * @returns {{ permitido: true, base: "fly" | "banco_local" | "canonico" } | { permitido: false, motivo: string }}
 */
export function decidirInicioLocal({ url, onFly, sondar }) {
  if (onFly) return { permitido: true, base: "fly" }
  if (ehLocal(url)) return { permitido: true, base: "banco_local" }
  const p = sondar()
  if (isCanonicalCheckout(p)) return { permitido: true, base: "canonico" }
  const onde = p.ok ? `${p.branch ?? "(detached)"} @ ${p.sha.slice(0, 7)}` : "?"
  const porque = !p.ok
    ? `não deu para ler o estado do git (${p.error})`
    : p.atOriginMain === null
      ? "a ref local origin/main não existe"
      : p.dirtyTracked
        ? "há arquivos rastreados modificados"
        : "o HEAD não é a ponta de origin/main (ref local)"
  return {
    permitido: false,
    motivo:
      `npm start RECUSADO: o servidor apontaria para o banco da NUVEM (${url || "sem URL"}) a partir de um ` +
      `checkout não canônico — ${porque}. Checkout: ${onde}. Suba de um checkout limpo exatamente em ` +
      `origin/main (\`git fetch\` + atualizar), ou aponte o app para o banco local (\`npm run db:local\`).`,
  }
}
