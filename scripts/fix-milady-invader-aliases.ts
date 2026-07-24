/**
 * DESCONTAMINAÇÃO pontual: "Milady's Land's a Mess!" (2f904f7b) absorveu, por um
 * falso positivo de duplicata (fragmento "your majesty"), os 9 nomes da obra
 * "Heika Kondo wa Watashi ga Sodatemasu". Este script remove SÓ esses 9 aliases.
 *
 * Segurança: imprime o array ANTIGO inteiro (rollback fica no transcript) e, se
 * qualquer um dos 9 invasores não bater exatamente, FALHA sem gravar — nunca
 * escreve uma linha meio-limpa.
 *
 *   npx tsx --tsconfig tsconfig.smoke.json --env-file=.env.local scripts/fix-milady-invader-aliases.ts            # dry-run
 *   npx tsx --tsconfig tsconfig.smoke.json --env-file=.env.local scripts/fix-milady-invader-aliases.ts --apply    # grava
 */
import { createAdminClient } from "@/lib/supabase/admin"

const WORK_ID = "2f904f7b-0fe1-42f3-8cbb-d368ff98dcc9"
const APPLY = process.argv.includes("--apply")

/** Nomes que pertencem a "Heika Kondo…" e vazaram pra dentro da Milady's. */
const INVADERS = [
  "Heika Kondo wa Watashi ga Sodatemasu",
  "Your Majesty, I Will Raise Him This Time",
  "陛下、今度は私が育てます！",
  "陛下今度は私が育てます",
  "Dessa Vez Quem Cuida do Herdeiro Sou Eu",
  "陛下，这次由我来抚养！",
  "Heika",
  "Kondo wa Watashi ga Sodatemasu!",
  "I Will Raise Him This Time",
]

async function main() {
  const sb = createAdminClient()
  const { data, error } = await sb
    .from("works")
    .select("id, title, alternative_titles")
    .eq("id", WORK_ID)
    .single()
  if (error) throw new Error(error.message)

  const current: string[] = data.alternative_titles ?? []
  console.log(`obra: ${JSON.stringify(data.title)}`)
  console.log(`alternative_titles ANTES (${current.length}):`)
  console.log(JSON.stringify(current, null, 2))
  console.log()

  const missing = INVADERS.filter((inv) => !current.includes(inv))
  if (missing.length) {
    throw new Error(
      `ABORTADO: ${missing.length} invasor(es) não bateram exatamente — a linha pode já ter sido corrigida ou os nomes mudaram:\n` +
        missing.map((m) => `  · ${JSON.stringify(m)}`).join("\n"),
    )
  }

  const invaderSet = new Set(INVADERS)
  const next = current.filter((name) => !invaderSet.has(name))
  console.log(`removendo ${current.length - next.length} invasores (esperado: ${INVADERS.length})`)
  console.log(`alternative_titles DEPOIS (${next.length}):`)
  console.log(JSON.stringify(next, null, 2))
  console.log()

  if (current.length - next.length !== INVADERS.length) {
    throw new Error("ABORTADO: contagem removida ≠ 9 — não grava por segurança.")
  }

  if (!APPLY) {
    console.log("DRY-RUN — nada gravado. Rode com --apply para aplicar.")
    return
  }

  const { error: upErr } = await sb
    .from("works")
    .update({ alternative_titles: next })
    .eq("id", WORK_ID)
  if (upErr) throw new Error(upErr.message)
  console.log("✅ GRAVADO.")
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
