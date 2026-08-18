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
 * ⚠️ Este teste DERIVA tudo que varre: os escritores saem do filesystem e os nomes de exemplo
 * saem das próprias `FAMILIAS` (campo `exemplo`, encostado no `casa` que ele exercita). Lista
 * fixa não acha o que ninguém apontou — que é exatamente a falha que se quer impedir aqui: o
 * próximo script a inventar um prefixo novo. ⚠️ Esta linha já prometia isso enquanto DOIS
 * casos deste arquivo mantinham os mesmos 11 nomes escritos à mão; ver o comentário lá embaixo.
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

  it("toda família declara um `exemplo` — sem ele o regex dela nunca é exercitado", () => {
    // Precondição do teste seguinte, separada pra a mensagem dizer o que fazer. Família nova
    // sem exemplo reprova AQUI, no lugar onde ela foi declarada, e não numa lista distante.
    for (const familia of FAMILIAS) {
      expect(
        typeof familia.exemplo === "string" && familia.exemplo.length > 0,
        `família "${familia.id}" não declara \`exemplo\` em scripts/lib/backups-retencao.mjs — ` +
          `escreva ali um nome de diretório que o \`casa\` dela aceite`,
      ).toBe(true)
    }
  })

  it("cada exemplo casa com exatamente a SUA família", () => {
    // 🔴 Duas invariantes numa asserção só: a família reconhece o próprio diretório (senão o
    // regex está quebrado e a poda nunca acha nada) e nenhuma OUTRA o reconhece junto. A
    // armadilha concreta da segunda metade: um teste ingênuo de prefixo para `push-` engoliria
    // `push-curation-`, e o staging de 96 MB passaria a ser podado pela política de 2 do
    // vizinho. Por isso todo regex datado exige o dígito do ano logo após o prefixo.
    //
    // ⚠️ Os nomes saem de `FAMILIAS`, nunca de uma lista escrita aqui. Eram DUAS cópias dos
    // mesmos 11 nomes, em funções vizinhas deste arquivo — e o docstring do topo já prometia
    // "deriva, nunca lista fixa", promessa que valia só pros escritores. A família seguinte
    // (`normalizar-titulos`) entrou completa — regex exclusivo, `podar()` chamado — e a suíte
    // ficou vermelha só porque ninguém lembrou dos dois lugares. Não era uma allowlist, era um
    // pedágio; e pedágio que nada cobra na hora certa é pago com um vermelho que não é de
    // ninguém.
    for (const familia of FAMILIAS) {
      const casam = FAMILIAS.filter((f) => f.casa(familia.exemplo)).map((f) => f.id)
      expect(
        casam,
        `"${familia.exemplo}" é o exemplo de "${familia.id}" e casou com ${casam.length} ` +
          `família(s): ${casam.join(", ") || "nenhuma"}`,
      ).toEqual([familia.id])
    }
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
