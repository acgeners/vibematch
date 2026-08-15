import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { FAMILIAS, keepDe } from "@/scripts/lib/backups-retencao.mjs"

/**
 * Todo script que grava em `.backups/` tem que ter uma FAMÍLIA declarada em
 * `scripts/lib/backups-retencao.mjs`, e toda família datada tem que ser podada.
 *
 * Em 2026-08-10 o `.backups` chegou a **1,9 GB** — 1,5 GB deles em 23 diretórios
 * `push-curation-*` gravados quase todos num único dia, a maioria ENSAIO. Disco cheio já
 * derrubou a VM do Docker aqui, e é o Docker que segura o Supabase local.
 *
 * 🔴 A causa não foi um script esquecido, foi o PADRÃO: cada um inventava prefixo e política
 * próprios, e cada retenção era um regex que enxerga só a própria família. Medido: de 7
 * escritores, **3 nunca podavam nada**, e havia 3 entradas órfãs de script nenhum — uma de
 * 33 MB. Nenhuma das retenções existentes estava errada; todas eram cegas por construção.
 *
 * ⚠️ Este teste DERIVA a lista de escritores do filesystem, nunca de uma lista fixa. Uma lista
 * fixa não acha o que ninguém apontou — que é exatamente a falha que se quer impedir aqui: o
 * próximo script a inventar um prefixo novo.
 */
const SCRIPTS_DIR = path.join(process.cwd(), "scripts")

/**
 * Um script é ESCRITOR se cita `.backups` e cria diretório. Validado contra a realidade em
 * 2026-08-10: pega os 7 escritores e deixa de fora `db-make-cloudsim.mjs`, que só LÊ os
 * `pull-*` para montar o clone. (Meu primeiro levantamento o contou como escritor por olhar
 * só o `path.join` — daí a checagem exigir também a criação do diretório.)
 */
function escritoresDeBackups(): string[] {
  return fs
    .readdirSync(SCRIPTS_DIR)
    .filter((n) => n.endsWith(".mjs") || n.endsWith(".ts"))
    .filter((n) => {
      const src = fs.readFileSync(path.join(SCRIPTS_DIR, n), "utf8")
      // 🔴 Qualquer forma de citar `.backups`, não só a string exata `".backups"`.
      // A 1ª versão exigia o literal fechado, e por isso deixou passar dois escritores que
      // usavam `".backups/fix-external-ids"` — o caminho embutido no próprio literal. Quem
      // os pegou foi o `podar()` do db:pull, olhando o filesystem de verdade, dias depois.
      // Um teste que só reconhece uma grafia protege a grafia, não a invariante.
      return /["'`]\.backups[/"'`]/.test(src) && src.includes("mkdirSync")
    })
}

const donos = new Set(FAMILIAS.map((f) => f.dono))

describe("retenção de .backups: um dono único, e ninguém grava sem família", () => {
  it("existe pelo menos um escritor (senão a varredura mudou de forma e não prova nada)", () => {
    expect(escritoresDeBackups().length).toBeGreaterThan(0)
  })

  it("todo script que grava em .backups está declarado como dono de uma família", () => {
    for (const script of escritoresDeBackups()) {
      expect(
        donos.has(script),
        `${script} grava em .backups mas não é dono de nenhuma família.\n` +
          `Declare-a em scripts/lib/backups-retencao.mjs — sem isso a pasta cresce sem teto ` +
          `e nada acusa até o disco acabar.`,
      ).toBe(true)
    }
  })

  it("todo escritor de família DATADA chama a poda", () => {
    // Família de diretório fixo (`fingerprints`) não acumula versões — chama `podar` só pela
    // checagem de órfãos, mas não teria o que apagar.
    for (const familia of FAMILIAS.filter((f) => f.keepPadrao != null)) {
      const src = fs.readFileSync(path.join(SCRIPTS_DIR, familia.dono), "utf8")
      expect(src, `${familia.dono} não importa a retenção compartilhada`).toContain(
        "backups-retencao.mjs",
      )
      // Aceita argumentos extras: `backup-db.mjs` passa `{ base }`, porque o destino dele pode
      // vir por argv (`node scripts/backup-db.mjs /outro/lugar`).
      expect(
        src,
        `${familia.dono} importa a retenção mas nunca chama podar("${familia.id}")`,
      ).toMatch(new RegExp(`podar\\("${familia.id}"`))
    }
  })

  it("nenhum escritor mantém uma retenção PRÓPRIA em paralelo", () => {
    // Duas políticas para a mesma pasta é como se volta ao estado anterior: a segunda cópia
    // diverge em silêncio. Mesma armadilha do LOW_BALANCE_USD e do STRONG_TAG_WEIGHT.
    for (const script of escritoresDeBackups()) {
      const src = fs.readFileSync(path.join(SCRIPTS_DIR, script), "utf8")
      const semComentarios = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")
      expect(
        semComentarios,
        `${script} voltou a filtrar .backups por regex próprio — a política é do módulo`,
      ).not.toMatch(/readdirSync\([^)]*\.backups[\s\S]{0,200}?rmSync/)
    }
  })

  it("as famílias são MUTUAMENTE EXCLUSIVAS", () => {
    // 🔴 A armadilha concreta: um teste ingênuo de prefixo para `push-` engoliria
    // `push-curation-`, e o staging de 96 MB passaria a ser contado na política de 2 MB do
    // vizinho. Por isso todo regex datado exige o dígito do ano logo após o prefixo.
    const nomes = [
      "2026-08-10T15-46-58-638Z",
      "pull-2026-07-30T00-31-49-679Z",
      "push-2026-08-04T04-19-44-904Z",
      "push-curation-2026-08-10T17-37-07-121Z",
      "new-works-2026-08-04T15-56-02-670Z",
      "synopsis-lab-2026-07-30T05-38-06-927Z",
      "fingerprints",
      "backfill-tags",
      "fix-external-ids-2026-08-14T00-15-58-115Z",
      "push-opening-structure-2026-08-14T01-00-49-104Z",
      "repick-cover-2026-08-15T03-11-22-333Z",
    ]
    for (const nome of nomes) {
      const casam = FAMILIAS.filter((f) => f.casa(nome)).map((f) => f.id)
      expect(casam, `"${nome}" casou com ${casam.length} famílias: ${casam.join(", ")}`).toHaveLength(1)
    }
  })

  it("cada nome de exemplo tem exatamente uma família, e toda família reconhece o seu", () => {
    // O espelho do teste acima: garante que nenhuma família ficou sem nome de exemplo, o que
    // deixaria um regex quebrado passar despercebido.
    const cobertas = new Set(
      ["2026-08-10T15-46-58-638Z", "pull-2026-07-30T00-31-49-679Z", "push-2026-08-04T04-19-44-904Z",
       "push-curation-2026-08-10T17-37-07-121Z", "new-works-2026-08-04T15-56-02-670Z",
       "synopsis-lab-2026-07-30T05-38-06-927Z", "fingerprints", "backfill-tags",
       "fix-external-ids-2026-08-14T00-15-58-115Z",
       "push-opening-structure-2026-08-14T01-00-49-104Z",
       "repick-cover-2026-08-15T03-11-22-333Z"]
        .flatMap((n) => FAMILIAS.filter((f) => f.casa(n)).map((f) => f.id)),
    )
    for (const f of FAMILIAS) expect(cobertas.has(f.id), `família "${f.id}" sem nome de exemplo`).toBe(true)
  })

  it("keep nunca é 0 nem NaN — isso apagaria o que acabou de ser gravado", () => {
    const familia = FAMILIAS.find((f) => f.env === "PULL_KEEP")!
    const antes = process.env.PULL_KEEP
    try {
      process.env.PULL_KEEP = "0"
      expect(keepDe(familia)).toBeGreaterThanOrEqual(1)
      process.env.PULL_KEEP = "não é número"
      expect(keepDe(familia)).toBe(familia.keepPadrao)
      process.env.PULL_KEEP = "7"
      expect(keepDe(familia)).toBe(7)
    } finally {
      if (antes === undefined) delete process.env.PULL_KEEP
      else process.env.PULL_KEEP = antes
    }
  })
})
