/**
 * A OBRA QUE A LEITORA CADASTRA — de quem é o estado pessoal dela?
 *
 * `createWork` deixa QUALQUER usuário logado cadastrar uma obra que falta no catálogo (Fatia
 * 2b/5 — o produto free). O form de criação carrega, além do catálogo (título, ano, capa), o
 * ESTADO PESSOAL de quem cadastra: status de leitura, capítulos lidos, nota, ♥, pós-leitura.
 *
 * A pergunta que esta suíte faz ao BANCO (não à resposta da action, não à UI):
 *
 *   quando a LEITORA cadastra uma obra dando nota 9.5 e marcando "cap. 12",
 *   essa nota vira rótulo de quem?
 *
 * 🔴 O modo de falha que ela procura é SILENCIOSO e caro: `user_score` é o RÓTULO que treina o
 * Ridge do dono. Uma nota estranha injetada ali não aparece como erro — aparece como uma Nota
 * Prevista ligeiramente diferente, que é indistinguível de "o modelo aprendeu".
 *
 * Idempotente: apaga a obra que cria (e a linha de estado que ela gerar).
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
const { owner: OWNER, other: OTHER } = await findTestUsers(admin)

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
  return {
    userId: s.user.id,
    cookie: [...jar].map(([n, v]) => `${n}=${encodeURIComponent(v)}`).join("; "),
  }
}

async function actionIds(paths) {
  const found = {}
  for (const p of paths) {
    const html = await (await fetch(`${APP}${p}`)).text()
    for (const src of [...html.matchAll(/src="(\/_next\/static\/[^"]+\.js)"/g)].map((m) => m[1])) {
      const js = await (await fetch(`${APP}${src}`)).text()
      for (const m of js.matchAll(
        /createServerReference"\]\)\("([0-9a-f]{40,})"[\s\S]{0,600}?"(\w+)"\)/g,
      )) {
        found[m[2]] = m[1]
      }
    }
  }
  return found
}

const call = async (id, args, cookie, referer = "/titles/new") =>
  (
    await fetch(`${APP}${referer}`, {
      method: "POST",
      headers: {
        "Next-Action": id,
        "Content-Type": "text/plain;charset=UTF-8",
        cookie,
      },
      body: JSON.stringify(args),
    })
  ).text()

// ── o cenário ─────────────────────────────────────────────────────────────────────────
const TITLE = `zz-probe-ownership-${Date.now()}`
const NOTA_DELA = 9.5
const CAPS_DELA = 12

console.log("\n── A obra que a LEITORA cadastra: de quem é a nota?\n")

// Limpa sobras de uma execução anterior que tenha morrido no meio. `createWork` tem guarda de
// título duplicado — uma obra `zz-probe-*` esquecida no banco faz a criação ser RECUSADA, e o
// teste falha por sujeira, não por bug. (Foi o que me deu uma falha intermitente.)
{
  const { data: sobras } = await admin.from("works").select("id").like("title", "zz-probe-ownership%")
  for (const w of sobras ?? []) {
    await admin.from("user_work_state").delete().eq("work_id", w.id)
    await admin.from("works").delete().eq("id", w.id)
  }
  if (sobras?.length) console.log(`  (limpei ${sobras.length} obra(s) de uma execução anterior)\n`)
}

const ids = await actionIds(["/titles/new"])
if (!ids.createWork) {
  console.log("  ❌ não achei o id da action createWork no bundle — o app está de pé?")
  process.exit(1)
}

const leitora = await session(OTHER.email)

// O form: catálogo + o estado pessoal DELA.
const values = {
  title: TITLE,
  publication_status: "Ongoing",
  personal_status: "Reading",
  chapters_read: CAPS_DELA,
  user_score: NOTA_DELA,
  observation_adjustment: 0,
  alternative_titles: [],
}

await call(ids.createWork, [values], leitora.cookie)

const { data: work } = await admin
  .from("works")
  .select("id, title, user_score, chapters_read, personal_status_id")
  .eq("title", TITLE)
  .maybeSingle()

if (!work) {
  console.log("  ❌ a obra não foi criada — a Leitora não conseguiu cadastrar (outro bug).")
  process.exit(1)
}
console.log(`  (obra criada: ${work.id.slice(0, 8)})\n`)

const stateOf = async (userId) => {
  const { data } = await admin
    .from("user_work_state")
    .select("user_score, chapters_read, personal_status_id")
    .eq("work_id", work.id)
    .eq("user_id", userId)
    .maybeSingle()
  return data
}

const doDono = await stateOf(OWNER.current_user_id)
const dela = await stateOf(OTHER.current_user_id)

console.log("  estado pessoal gravado para a obra recém-criada:")
console.log(`    dono   : ${JSON.stringify(doDono)}`)
console.log(`    leitora: ${JSON.stringify(dela)}`)
console.log(`    works  : ${JSON.stringify({ user_score: work.user_score, chapters_read: work.chapters_read })}\n`)

// 🔴 O crime: a nota DELA virar rótulo DELE.
check(
  doDono == null || doDono.user_score == null,
  `a nota da Leitora NÃO virou rótulo do dono (user_score do dono = ${doDono?.user_score ?? "sem linha"})`,
)
check(
  doDono == null || doDono.chapters_read == null,
  `os capítulos dela NÃO viraram os do dono (chapters_read do dono = ${doDono?.chapters_read ?? "sem linha"})`,
)

// E o outro lado da moeda: o estado dela tem que existir, senão ela cadastrou e perdeu o dado.
check(
  dela != null && Number(dela.user_score) === NOTA_DELA,
  `a nota dela ficou COM ELA (user_score dela = ${dela?.user_score ?? "sem linha"}, esperado ${NOTA_DELA})`,
)
check(
  dela != null && dela.chapters_read === CAPS_DELA,
  `os capítulos dela ficaram COM ELA (chapters_read dela = ${dela?.chapters_read ?? "sem linha"}, esperado ${CAPS_DELA})`,
)

await admin.from("user_work_state").delete().eq("work_id", work.id)
await admin.from("works").delete().eq("id", work.id)

// ── o outro lado: o DONO cadastrando não pode ter REGREDIDO ───────────────────────────
//
// A correção mexeu no insert de `works` (o estado pessoal só entra quando quem cadastra é o
// dono). Se eu só testasse a Leitora, teria "consertado" o vazamento dela e quebrado, em
// silêncio, a obra que ELE cadastra como "lendo" — que é o caminho comum.
console.log("\n── E o DONO cadastrando? (o caminho comum não pode ter quebrado)\n")

const TITLE_DONO = `zz-probe-ownership-dono-${Date.now()}`
const dono = await session(OWNER.email)
await call(
  ids.createWork,
  [{ ...values, title: TITLE_DONO }],
  dono.cookie,
)

const { data: workDono } = await admin
  .from("works")
  .select("id, user_score, chapters_read, personal_status_id")
  .eq("title", TITLE_DONO)
  .maybeSingle()

if (!workDono) {
  console.log("  ❌ o DONO não conseguiu cadastrar a obra — regressão.")
  process.exit(1)
}

const { data: mirrorDono } = await admin
  .from("user_work_state")
  .select("user_score, chapters_read, personal_status_id")
  .eq("work_id", workDono.id)
  .eq("user_id", OWNER.current_user_id)
  .maybeSingle()

console.log(`    works  : ${JSON.stringify({ user_score: workDono.user_score, chapters_read: workDono.chapters_read })}`)
console.log(`    espelho: ${JSON.stringify(mirrorDono)}\n`)

check(
  mirrorDono != null && Number(mirrorDono.user_score) === NOTA_DELA,
  `o espelho DELE recebeu a nota dele (user_score = ${mirrorDono?.user_score ?? "sem linha"})`,
)
check(
  mirrorDono != null && mirrorDono.chapters_read === CAPS_DELA,
  `o espelho DELE recebeu os capítulos dele (chapters_read = ${mirrorDono?.chapters_read ?? "sem linha"})`,
)
// FASE E: a linha compartilhada NÃO recebe estado pessoal — nem do dono. O que prova que a
// obra dele foi criada certo é o ESPELHO (os dois checks acima), não a cópia morta em `works`.
check(
  workDono.user_score == null && workDono.chapters_read == null,
  `\`works\` NÃO recebeu o estado pessoal dele (user_score=${workDono.user_score}, chapters_read=${workDono.chapters_read}) — o dual-write acabou`,
)

await admin.from("user_work_state").delete().eq("work_id", workDono.id)
await admin.from("works").delete().eq("id", workDono.id)
console.log("  (limpeza: obra e estado apagados)")

console.log(
  fails === 0
    ? "\n✅ a obra é do catálogo; o estado pessoal é de quem cadastrou.\n"
    : `\n❌ ${fails} falha(s) — o estado de quem cadastra está caindo na linha de outra pessoa.\n`,
)
process.exit(fails === 0 ? 0 : 1)
