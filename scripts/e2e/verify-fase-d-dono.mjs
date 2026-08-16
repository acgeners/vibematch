/**
 * FASE D — o DONO trocou de fonte. Ele viu alguma coisa mudar?
 *
 * As páginas dele liam as colunas pessoais de `works`; agora leem o espelho
 * (`user_work_state`). A promessa é que isso é um NO-OP pra ele — mesmos números, outra tabela.
 *
 * Este é o único momento em que dá pra PROVAR isso de graça: o dual-write ainda está ligado,
 * então as DUAS fontes existem e têm que concordar. Depois da Fase E (quando `works` parar de
 * receber escrita) esta comparação deixa de ser possível — e um erro aqui viraria "sempre foi
 * assim".
 *
 * O juiz é o BANCO (`works`, a fonte ANTIGA) contra o que a PÁGINA do dono renderiza agora.
 * Não é assert por ausência de string: exige que cada título esperado ESTEJA lá.
 */
import fs from "node:fs"
import { createRequire } from "node:module"
const require = createRequire(import.meta.url)
const R = "/Users/geners/Code/VibeMatch/animedb"
for (const l of fs.readFileSync(R + "/.env.local", "utf8").split("\n")) {
  const m = l.match(/^([A-Z0-9_]+)=(.*)$/)
  if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "")
}
const { createClient } = require(R + "/node_modules/@supabase/supabase-js")
const { createServerClient } = require(R + "/node_modules/@supabase/ssr")
const U = process.env.NEXT_PUBLIC_SUPABASE_URL
const A = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const APP = "http://localhost:3001"
const admin = createClient(U, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
})
const { findTestUsers } = await import("./_users.mjs")
const { owner: OWNER } = await findTestUsers(admin)

let fails = 0
const check = (c, m) => {
  console.log(`  ${c ? "✅" : "❌"} ${m}`)
  if (!c) fails++
}

async function session(email) {
  const { data } = await admin.auth.admin.generateLink({ type: "magiclink", email })
  const a = createClient(U, A, { auth: { persistSession: false } })
  const { data: s } = await a.auth.verifyOtp({
    token_hash: data.properties.hashed_token,
    type: "email",
  })
  const jar = new Map()
  const ssr = createServerClient(U, A, {
    cookies: {
      getAll: () => [...jar].map(([n, v]) => ({ name: n, value: v })),
      setAll: (l) => l.forEach(({ name, value }) => jar.set(name, value)),
    },
  })
  await ssr.auth.setSession({
    access_token: s.session.access_token,
    refresh_token: s.session.refresh_token,
  })
  return [...jar].map(([n, v]) => `${n}=${encodeURIComponent(v)}`).join("; ")
}

const page = async (path, cookie) =>
  (await fetch(`${APP}${path}`, { headers: { cookie } })).text()

// O HTML escapa aspas/&; normaliza os dois lados antes de procurar o título.
const norm = (s) =>
  s
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")

console.log("\n── FASE D: o dono trocou de fonte. Os números dele mudaram?\n")

const cookie = await session(OWNER.email)

// ── O baseline: o espelho CRU (`user_work_state`), lido direto por SQL ─────────────────
//
// Até a migration 154 este baseline saía das colunas pessoais de `works`. Elas não existem mais
// (o DROP), e o espelho é a única fonte.
//
// 🔴 E ele PRECISA sair da tabela crua, não da view `works_owner`: a Fase D fez o APP ler essa
// view. Usá-la aqui faria baseline e app compartilharem a mesma dependência — uma view que
// juntasse o usuário errado deixaria os dois errados JUNTOS, e a suíte ficaria verde. A tabela
// é a única fonte independente do caminho que estou testando.
const statusId = async (name) => {
  const { data } = await admin.from("personal_status").select("id").eq("status", name).single()
  return data.id
}
const readingId = await statusId("Reading")

// O espelho não tem `title` nem `is_archived` (são do catálogo) — daí o embed em `works`.
const mirrorWorks = async (narrow) => {
  const q = admin
    .from("user_work_state")
    .select("work_id, works!inner(id, title, is_archived)")
    .eq("user_id", OWNER.current_user_id)
    .eq("works.is_archived", false)
  const { data, error } = await narrow(q)
  if (error) throw new Error(`baseline do espelho falhou: ${error.message}`)
  return (data ?? []).map((r) => ({ id: r.works.id, title: r.works.title }))
}

const hisReading = await mirrorWorks((q) => q.eq("personal_status_id", readingId))
const hisFavs = await mirrorWorks((q) => q.eq("is_favorite", true))
const hisRatedRows = await mirrorWorks((q) => q.not("user_score", "is", null))
const hisRated = hisRatedRows.length

console.log(
  `  baseline (espelho cru): ${hisReading.length} "Reading" · ${hisFavs.length} favoritas · ${hisRated} avaliadas\n`,
)

// ── /reading — TODAS as obras que ele está lendo têm que aparecer ──────────────────────
const leitura = norm(await page("/reading", cookie))
const faltandoLeitura = hisReading.filter((w) => !leitura.includes(norm(w.title)))
check(
  faltandoLeitura.length === 0,
  `/reading traz as ${hisReading.length} obras "Reading" dele` +
    (faltandoLeitura.length ? ` — FALTAM ${faltandoLeitura.length}: ${faltandoLeitura.slice(0, 3).map((w) => w.title).join(" · ")}` : ""),
)

// ── /favorites — TODAS as favoritas dele têm que aparecer ──────────────────────────────
const favs = norm(await page("/favorites", cookie))
const faltandoFavs = hisFavs.filter((w) => !favs.includes(norm(w.title)))
check(
  faltandoFavs.length === 0,
  `/favoritos traz as ${hisFavs.length} favoritas dele` +
    (faltandoFavs.length ? ` — FALTAM ${faltandoFavs.length}: ${faltandoFavs.slice(0, 3).map((w) => w.title).join(" · ")}` : ""),
)

// ── home — os números que passam por `personal.get()` ──────────────────────────────────
//
// 🔴 ESTES são os asserts que valem. Os de cima (títulos em /reading e /favoritos) passam pela
// resolução de IDS, que consulta `user_work_state` DIRETO — eles ficariam verdes mesmo com o
// `get()` devolvendo estado vazio. Descobri isso sabotando o reader de propósito: a suíte
// continuou 100% verde. Uma suíte que não fica vermelha quando o código quebra não testa nada.
//
// "Acompanhando: N obras" (getDashboardStats) e "lidos/total" (getContinueReading) são
// computados obra a obra COM `personal.get()`. Com o reader vazio, viram "0 obras" e "0/N".
const home = norm(await page("/", cookie))

const startedId = await statusId("Started")
const hisFollowing = await mirrorWorks((q) =>
  q.in("personal_status_id", [readingId, startedId]),
)

check(
  home.includes(`${hisFollowing.length} obras`),
  `home: "Acompanhando ${hisFollowing.length} obras" — o KPI que passa por personal.get()`,
)

// O card de "Continue lendo" imprime `${chaptersRead}/${totalChapters}` de cada obra. Pega a
// que o widget certamente mostra: a de leitura mais recente COM capítulos pendentes.
const continuando = hisFollowing
  .filter((w) => w.total_chapters != null && w.total_chapters - (w.chapters_read ?? 0) > 0)
  .sort((a, b) => (b.last_read_at ?? "").localeCompare(a.last_read_at ?? ""))[0]

if (continuando) {
  const progresso = `${continuando.chapters_read ?? 0}/${continuando.total_chapters}`
  check(
    home.includes(progresso),
    `home: o progresso "${progresso}" de "${continuando.title}" — capítulos vindos de personal.get()`,
  )
} else {
  console.log("  (sem obra com capítulo pendente — pulei o check de progresso)")
}

// ── /ranking — o filtro pessoal PADRÃO não pode ter esvaziado a página ─────────────────
//
// O /ranking filtra por ["Want to Read","Untracked"] POR PADRÃO, e obra SEM linha de estado
// É "Want to Read". Foi exatamente aqui que um filtro por lista de ids apagou o catálogo
// inteiro pra quem não tinha linha nenhuma. Pro dono tem que continuar cheio.
const ranking = await page("/ranking", cookie)
check(
  !ranking.includes("Nenhuma obra encontrada"),
  "/ranking do dono NÃO está vazio (o filtro pessoal padrão continua achando obra)",
)

// ── /catalog com filtro de status — o caminho que saiu do SQL e foi pra memória ─────────
const titlesReading = norm(await page("/catalog?personalStatus=Reading", cookie))
const faltandoTitles = hisReading.filter((w) => !titlesReading.includes(norm(w.title)))
check(
  hisReading.length === 0 || faltandoTitles.length < hisReading.length,
  `/catalog?personalStatus=Reading traz obra dele (o filtro pessoal sobreviveu à ida pra memória)`,
)

console.log(
  fails === 0
    ? "\n✅ FASE D VERDE — o dono trocou de fonte e não viu nada mudar.\n"
    : `\n❌ ${fails} falha(s) — a troca de fonte MUDOU o que o dono vê.\n`,
)
process.exit(fails === 0 ? 0 : 1)
