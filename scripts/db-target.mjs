#!/usr/bin/env node
/**
 * Troca o alvo do Supabase no `.env.local` entre a NUVEM e o stack LOCAL.
 *
 *   node scripts/db-target.mjs          → mostra o alvo atual
 *   node scripts/db-target.mjs local    → aponta pro stack da CLI (127.0.0.1:54321)
 *   node scripts/db-target.mjs cloud    → volta pra nuvem
 *
 * Por que existe: em 2026-07-29 o projeto da nuvem foi restrito por `exceed_egress_quota`
 * (plano free, 5 GB/ciclo, queima medida de ~620 MB/dia — cada navegação em dev bate no banco
 * remoto porque toda rota é dinâmica). Desenvolver contra o local custa 0 de egress.
 *
 * ⚠️ Os valores da nuvem só existem no `.env.local`, que é gitignored — não há outra cópia.
 * Antes de sobrescrever, este script os arquiva em `.env.supabase-cloud`. Se esse arquivo
 * sumir enquanto o alvo é `local`, as chaves da nuvem se perdem: por isso o script se RECUSA
 * a rodar num estado em que sobrescreveria a única cópia.
 *
 * As chaves do stack local são lidas de `supabase status` (fonte da verdade), nunca chumbadas.
 */
import fs from "node:fs"
import path from "node:path"
import { execFileSync } from "node:child_process"

const ROOT = path.resolve(import.meta.dirname, "..")
const ENV_FILE = path.join(ROOT, ".env.local")
const CLOUD_SNAPSHOT = path.join(ROOT, ".env.supabase-cloud")

/** As 3 únicas variáveis que definem o alvo. Todo o resto do .env.local fica intacto. */
const MANAGED = ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"]

const parseEnv = (text) => {
  const out = {}
  for (const line of text.split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "")
  }
  return out
}

const mask = (v) => (!v ? "(vazio)" : v.length <= 12 ? v : `${v.slice(0, 8)}…${v.slice(-4)}`)
const isLocal = (url) => /127\.0\.0\.1|localhost/.test(url ?? "")

const readEnvFile = () => {
  if (!fs.existsSync(ENV_FILE)) die(`não achei ${ENV_FILE}`)
  return fs.readFileSync(ENV_FILE, "utf8")
}

function die(msg) {
  console.error(`✗ ${msg}`)
  process.exit(1)
}

/** Reescreve só as linhas gerenciadas, preservando ordem, comentários e o resto dos segredos. */
function writeManaged(values) {
  const text = readEnvFile()
  const lines = text.split("\n")
  const pending = new Set(MANAGED)
  const next = lines.map((line) => {
    const m = line.match(/^([A-Z0-9_]+)=/)
    if (m && pending.has(m[1])) {
      pending.delete(m[1])
      return `${m[1]}=${values[m[1]]}`
    }
    return line
  })
  for (const key of pending) next.push(`${key}=${values[key]}`)
  fs.writeFileSync(ENV_FILE, next.join("\n"))
}

function localValues() {
  let raw
  try {
    // stderr ignorado: o `status` avisa "Stopped services: [imgproxy pooler]" (nenhum dos dois é
    // usado aqui — falamos Postgres direto na 54322) e isso só poluiria a saída.
    raw = execFileSync("supabase", ["--workdir", ROOT, "status", "-o", "env"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    })
  } catch {
    die("`supabase status` falhou — o stack local está de pé? (`supabase start`)")
  }
  const s = parseEnv(raw)
  if (!s.API_URL || !s.ANON_KEY || !s.SERVICE_ROLE_KEY) die("`supabase status` não trouxe API_URL/ANON_KEY/SERVICE_ROLE_KEY")
  return {
    NEXT_PUBLIC_SUPABASE_URL: s.API_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: s.ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY: s.SERVICE_ROLE_KEY,
  }
}

const cmd = (process.argv[2] ?? "status").toLowerCase()
const current = parseEnv(readEnvFile())
const currentIsLocal = isLocal(current.NEXT_PUBLIC_SUPABASE_URL)

if (cmd === "status") {
  console.log(`alvo atual: ${currentIsLocal ? "LOCAL" : "NUVEM"}  (${current.NEXT_PUBLIC_SUPABASE_URL})`)
  console.log(`  anon         ${mask(current.NEXT_PUBLIC_SUPABASE_ANON_KEY)}`)
  console.log(`  service_role ${mask(current.SUPABASE_SERVICE_ROLE_KEY)}`)
  console.log(`cópia da nuvem em .env.supabase-cloud: ${fs.existsSync(CLOUD_SNAPSHOT) ? "sim" : "NÃO"}`)
  process.exit(0)
}

if (cmd === "local") {
  if (!fs.existsSync(CLOUD_SNAPSHOT)) {
    // Sem cópia arquivada: só é seguro arquivar se o .env.local AINDA aponta pra nuvem.
    if (currentIsLocal) {
      die(
        "o .env.local já aponta pro local e não existe .env.supabase-cloud — as chaves da nuvem\n" +
          "  não estão em lugar nenhum. Pegue-as no dashboard (Project Settings → API) e escreva\n" +
          "  .env.supabase-cloud antes de continuar."
      )
    }
    const snap = MANAGED.map((k) => `${k}=${current[k] ?? ""}`).join("\n")
    fs.writeFileSync(CLOUD_SNAPSHOT, `# valores da NUVEM, arquivados por scripts/db-target.mjs\n${snap}\n`)
    console.log("✓ chaves da nuvem arquivadas em .env.supabase-cloud")
  }
  writeManaged(localValues())
  console.log("✓ alvo agora é LOCAL (http://127.0.0.1:54321) — reinicie o `npm run dev`")
  process.exit(0)
}

if (cmd === "cloud") {
  if (!fs.existsSync(CLOUD_SNAPSHOT)) die("não existe .env.supabase-cloud pra restaurar")
  const snap = parseEnv(fs.readFileSync(CLOUD_SNAPSHOT, "utf8"))
  const missing = MANAGED.filter((k) => !snap[k])
  if (missing.length) die(`.env.supabase-cloud está incompleto: falta ${missing.join(", ")}`)
  writeManaged(snap)
  console.log(`✓ alvo agora é NUVEM (${snap.NEXT_PUBLIC_SUPABASE_URL}) — reinicie o \`npm run dev\``)
  process.exit(0)
}

die(`uso: node scripts/db-target.mjs [status|local|cloud]`)
