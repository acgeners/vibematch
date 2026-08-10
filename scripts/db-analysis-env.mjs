#!/usr/bin/env node
/**
 * Gera `.env.analysis` — o alvo dos SCRIPTS, que é sempre o Postgres LOCAL.
 *
 * ## Por que existe
 *
 * Até 2026-08-10 o `.env.local` era um interruptor ÚNICO: `npm run db:local` movia o app **e**
 * os 25 scripts de análise ao mesmo tempo. Isso impedia a única configuração que o projeto de
 * fato quer:
 *
 *     app     → NUVEM   (é onde a curadoria e os leitores vivem)
 *     scripts → LOCAL   (é o corte de egress que justifica o stack local existir)
 *
 * Os dois puxam para lados opostos, e com um interruptor só era preciso escolher qual deles
 * estaria errado. Os scripts são o maior consumidor medido de egress — um pico de 1,47 GB num
 * dia com ZERO escrita de curadoria —, então deixá-los seguir o app para a nuvem reintroduz
 * exatamente o problema que criou o banco local.
 *
 * ## Como é usado
 *
 * Os scripts recebem os DOIS arquivos, nesta ordem:
 *
 *     npx tsx --env-file=.env.local --env-file=.env.analysis scripts/x.ts
 *
 * O último vence (verificado no Node e no tsx), então `.env.analysis` carrega **apenas** as 3
 * variáveis de alvo e o `.env.local` continua fornecendo todo o resto — `ANTHROPIC_API_KEY`,
 * `MAL_CLIENT_ID`, tokens. 🔴 Copiar o `.env.local` inteiro aqui seria uma 2ª cópia dos
 * segredos, que diverge em silêncio na primeira vez que uma chave for trocada num só lado.
 *
 * ⚠️ Se este arquivo não existir, o `--env-file` do Node **falha alto** — e isso é proteção,
 * não inconveniência. A alternativa (`--env-file-if-exists`) faria o script rodar contra a
 * NUVEM sem avisar, que é precisamente o erro caro que esta separação existe para impedir.
 *
 * Regenere depois de qualquer `supabase stop && supabase start` que troque as chaves:
 *
 *     npm run db:analysis-env
 */
import fs from "node:fs"
import path from "node:path"
import { execFileSync } from "node:child_process"

const ROOT = path.resolve(import.meta.dirname, "..")
const OUT = path.join(ROOT, ".env.analysis")

const die = (msg) => {
  console.error(`✗ ${msg}`)
  process.exit(1)
}

let raw
try {
  // stderr ignorado: o `status` avisa sobre serviços parados (imgproxy/pooler) que não usamos.
  raw = execFileSync("supabase", ["--workdir", ROOT, "status", "-o", "env"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  })
} catch {
  die("`supabase status` falhou — o stack local está de pé? (`supabase start`)")
}

const s = {}
for (const line of raw.split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)="?([^"]*)"?$/)
  if (m) s[m[1]] = m[2]
}
if (!s.API_URL || !s.ANON_KEY || !s.SERVICE_ROLE_KEY) {
  die("`supabase status` não trouxe API_URL/ANON_KEY/SERVICE_ROLE_KEY")
}

// 🔴 Trava contra o modo de falha que dói: se o `supabase status` devolvesse um alvo remoto,
// os scripts de análise passariam a ler o catálogo inteiro da nuvem — 20,1 MB por varredura.
if (!/127\.0\.0\.1|localhost/.test(s.API_URL)) {
  die(`o alvo veio como "${s.API_URL}", que não é local. Este arquivo só pode apontar pro stack local.`)
}

fs.writeFileSync(
  OUT,
  [
    "# GERADO por scripts/db-analysis-env.mjs — não edite à mão.",
    "#",
    "# Alvo dos SCRIPTS de análise: sempre o Postgres LOCAL. Carregado DEPOIS do .env.local",
    "# (`--env-file=.env.local --env-file=.env.analysis`), então sobrescreve só estas 3 e herda",
    "# todos os outros segredos de lá. O app NÃO usa este arquivo: ele segue o .env.local, que",
    "# aponta pra nuvem.",
    "#",
    "# Regenere depois de `supabase stop && supabase start`:  npm run db:analysis-env",
    "",
    `NEXT_PUBLIC_SUPABASE_URL=${s.API_URL}`,
    `NEXT_PUBLIC_SUPABASE_ANON_KEY=${s.ANON_KEY}`,
    `SUPABASE_SERVICE_ROLE_KEY=${s.SERVICE_ROLE_KEY}`,
    "",
  ].join("\n"),
)

console.log(`✓ .env.analysis gerado — scripts apontam pro LOCAL (${s.API_URL})`)
console.log(`  o app segue o .env.local; confira com \`npm run db:target\``)
