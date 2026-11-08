import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { spawnSync } from "node:child_process"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  compararConteudo,
  copiasNoDestino,
  desmontar,
  enviarPasta,
  montar,
  planejarPodaDestino,
} from "@/scripts/lib/backup-icloud.mjs"
import { FAMILIAS } from "@/scripts/lib/backups-retencao.mjs"
import {
  RE_DMG_LOCAIS,
  copiarComExclusao,
  montarCopia,
  nomeDoDmgLocais,
  procurarValores,
  selecionarBackups,
  selecionarCaminhos,
  valoresSecretos,
} from "@/scripts/lib/copia-locais.mjs"

/**
 * A cópia semanal do que só existe no Mac (Auditoria, gold, estado anterior, branches só locais,
 * WIP). O que entra é DERIVADO do git; cada caso abaixo é uma forma de a cópia sair errada sem que
 * nada acuse. Tudo em diretórios temporários: nenhum caso toca o iCloud nem o Keychain de verdade.
 */

let tmp: string
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "copia-locais-teste-"))
})
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true })
})

const escrever = (p: string, conteudo = "x") => {
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, conteudo)
}

describe("o que entra é derivado do git, com exclusões justificadas", () => {
  const porcelana = [
    "?? VIBEMATCH_DOCUMENTO_MESTRE.md",
    "!! Auditoria/",
    "!! .gold/",
    "!! scripts/diag-x.ts",
    "!! scripts/seed-from-xlsx 4.js",
    "!! node_modules/",
    "!! services/comix-render/node_modules/",
    "!! .next/",
    "!! .cache/",
    "!! .env.local",
    "!! .env.example",
    "!! .backups/",
    "!! .DS_Store",
    "!! lib/.DS_Store",
    "!! tsconfig.tsbuildinfo",
    "!! next-env.d.ts",
    "!! supabase/.temp/cli-latest",
    " M lib/rastreado-e-modificado.ts",
  ].join("\0")

  it("entra o que é só local; fica fora o recriável, o segredo e o que tem régua própria", () => {
    const { incluir, excluidos } = selecionarCaminhos(porcelana + "\0")
    expect(incluir).toEqual(
      [".gold", "Auditoria", "VIBEMATCH_DOCUMENTO_MESTRE.md", "scripts/diag-x.ts", "scripts/seed-from-xlsx 4.js"].sort(),
    )
    expect(excluidos.map((e) => e.rel).sort()).toEqual(
      [
        ".DS_Store",
        ".backups",
        ".cache",
        ".env.example",
        ".env.local",
        ".next",
        "lib/.DS_Store",
        "next-env.d.ts",
        "node_modules",
        "services/comix-render/node_modules",
        "supabase/.temp/cli-latest",
        "tsconfig.tsbuildinfo",
      ].sort(),
    )
    for (const e of excluidos) expect(e.motivo.length).toBeGreaterThan(10)
  })

  it("arquivo rastreado e modificado não entra aqui (vai no patch do checkout)", () => {
    expect(selecionarCaminhos(" M lib/x.ts\0").incluir).toEqual([])
  })
})

describe("a exclusão vale em toda profundidade, e link é copiado como link", () => {
  it("dentro de uma pasta copiada: .env, node_modules e .DS_Store ficam fora; o link relativo fica igual", () => {
    const raiz = path.join(tmp, "repo")
    escrever(path.join(raiz, "Auditoria/estudo/notas.md"), "notas")
    escrever(path.join(raiz, "Auditoria/estudo/.env.local"), "ANTHROPIC_API_KEY=sk-ant-x")
    escrever(path.join(raiz, "Auditoria/estudo/node_modules/pkg/index.js"))
    escrever(path.join(raiz, "Auditoria/.DS_Store"))
    fs.mkdirSync(path.join(raiz, "Auditoria/indice"), { recursive: true })
    fs.symlinkSync("../estudo/notas.md", path.join(raiz, "Auditoria/indice/atalho.md"))

    const destino = path.join(tmp, "copia", "Auditoria")
    copiarComExclusao(raiz, "Auditoria", destino)

    expect(fs.readFileSync(path.join(destino, "estudo/notas.md"), "utf8")).toBe("notas")
    expect(fs.existsSync(path.join(destino, "estudo/.env.local"))).toBe(false)
    expect(fs.existsSync(path.join(destino, "estudo/node_modules"))).toBe(false)
    expect(fs.existsSync(path.join(destino, ".DS_Store"))).toBe(false)
    // Verbatim: resolvido, apontaria para o Mac e não para dentro da cópia.
    expect(fs.readlinkSync(path.join(destino, "indice/atalho.md"))).toBe("../estudo/notas.md")
  })

  it("uma entrada de .backups escolhida por família É copiada — a regra de .backups não barra a própria entrada", () => {
    const raiz = path.join(tmp, "repo")
    escrever(path.join(raiz, ".backups/vies-dona-2026-10-13T03-01-13-127Z/antes.json"), "{}")
    escrever(path.join(raiz, ".backups/vies-dona-2026-10-13T03-01-13-127Z/.env.local"), "SEGREDO=1")
    const destino = path.join(tmp, "copia", ".backups", "vies-dona-2026-10-13T03-01-13-127Z")
    copiarComExclusao(raiz, ".backups/vies-dona-2026-10-13T03-01-13-127Z", destino)
    expect(fs.readFileSync(path.join(destino, "antes.json"), "utf8")).toBe("{}")
    expect(fs.existsSync(path.join(destino, ".env.local"))).toBe(false)
  })
})

describe("famílias de .backups declaram se entram", () => {
  it("toda família declara `copiaLocal` booleano — família nova sem a decisão reprova", () => {
    const sem = FAMILIAS.filter((f: { copiaLocal?: unknown }) => typeof f.copiaLocal !== "boolean").map((f) => f.id)
    expect(sem, `declare copiaLocal (true/false, com o motivo) em backups-retencao.mjs: ${sem.join(", ")}`).toEqual([])
  })

  it("os dumps grandes e o staging ficam fora; o estado anterior entra", () => {
    const porId = Object.fromEntries(FAMILIAS.map((f: { id: string; copiaLocal: boolean }) => [f.id, f.copiaLocal]))
    for (const id of ["backup", "backup-parcial", "local-primary", "pull", "push-curation", "push-evals", "fingerprints"]) {
      expect(porId[id], id).toBe(false)
    }
    for (const id of ["fix-external-ids", "repick-cover", "adult-content-razao", "vies-dona", "limpar-sufixo-mu"]) {
      expect(porId[id], id).toBe(true)
    }
  })

  it("selecionarBackups: entra o estado anterior e a entrada sem família; sai o dump", () => {
    const r = selecionarBackups([
      "2026-11-06T09-44-52-275Z",
      "pull-2026-08-23T01-30-32-783Z",
      "vies-dona-2026-10-13T03-01-13-127Z",
      "algo-sem-dono.json",
    ])
    expect(r.incluir).toEqual(["algo-sem-dono.json", "vies-dona-2026-10-13T03-01-13-127Z"])
    expect(r.fora.map((f) => f.nome)).toEqual(["2026-11-06T09-44-52-275Z", "pull-2026-08-23T01-30-32-783Z"])
    expect(r.semFamilia).toEqual(["algo-sem-dono.json"])
  })
})

describe("retenção no iCloud só enxerga a própria cópia", () => {
  const S = (dia: string) => `2026-${dia}T07-00-04-196Z`
  it("ignora a cópia manual de 06/11 e os DMGs do banco; poda além das N confirmadas", () => {
    fs.mkdirSync(path.join(tmp, "2026-11-06"))
    for (const n of ["VibeMatch-backup-2026-11-01T07-00-04-196Z.dmg", "outro.dmg"]) escrever(path.join(tmp, n))
    for (const dia of ["11-01", "11-08", "11-15"]) {
      const nome = nomeDoDmgLocais(S(dia))
      escrever(path.join(tmp, nome))
      escrever(path.join(tmp, `${nome}.sha256`), `${"a".repeat(64)}  ${nome}\n`)
    }
    const copias = copiasNoDestino(tmp, RE_DMG_LOCAIS)
    expect(copias.map((c) => c.nome)).toEqual([S("11-15"), S("11-08"), S("11-01")].map(nomeDoDmgLocais))
    expect(planejarPodaDestino({ copias, keep: 2 })).toEqual([nomeDoDmgLocais(S("11-01"))])
  })
})

describe("chave real dentro da cópia é encontrada (e o lacre da revisão cega vale para programa)", () => {
  it("acha o valor, ignora pasta LACRADO-NAO-ABRIR e lê só chaves com nome de segredo", () => {
    const raiz = path.join(tmp, "repo")
    escrever(path.join(raiz, ".env.local"), 'ANTHROPIC_API_KEY="sk-ant-valor-real-123"\nSITE_URL=https://satoria.fly.dev\nCURTO_KEY=abc\n')
    const valores = valoresSecretos(raiz)
    expect(valores).toEqual([{ chave: "ANTHROPIC_API_KEY", valor: "sk-ant-valor-real-123" }])

    const copia = path.join(tmp, "copia")
    escrever(path.join(copia, "dados-locais/scripts/teste.js"), "const k = 'sk-ant-valor-real-123'")
    escrever(path.join(copia, "dados-locais/Auditoria/LACRADO-NAO-ABRIR/saida.json"), "sk-ant-valor-real-123")
    escrever(path.join(copia, "dados-locais/limpo.md"), "nada aqui")
    expect(procurarValores(copia, valores)).toEqual([{ rel: "dados-locais/scripts/teste.js", chave: "ANTHROPIC_API_KEY" }])
  })
})

describe("a conferência compara link pelo alvo, sem segui-lo", () => {
  const preparar = () => {
    const a = path.join(tmp, "a")
    const b = path.join(tmp, "b")
    for (const d of [a, b]) {
      escrever(path.join(d, "x.md"), "x")
      fs.mkdirSync(path.join(d, "pasta"))
      fs.symlinkSync("x.md", path.join(d, "ok.md"))
      fs.symlinkSync("pasta", path.join(d, "para-pasta"))
      fs.symlinkSync("nao-existe.md", path.join(d, "quebrado.md"))
    }
    return { a, b }
  }

  it("links iguais (inclusive para pasta e quebrado) conferem sem erro", () => {
    const { a, b } = preparar()
    expect(compararConteudo(a, b)).toEqual([])
  })

  it("link com alvo diferente é acusado", () => {
    const { a, b } = preparar()
    fs.rmSync(path.join(b, "ok.md"))
    fs.symlinkSync("outro.md", path.join(b, "ok.md"))
    expect(compararConteudo(a, b)).toEqual(["ok.md: link difere do original"])
  })
})

describe.runIf(process.platform === "darwin")("ponta a ponta: repositório de verdade, DMG de verdade", () => {
  const g = (cwd: string, ...args: string[]) => {
    const r = spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd, encoding: "utf8" })
    if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`)
    return r.stdout
  }

  it(
    "monta a cópia (dados, .backups, bundle, branches só locais, WIP), envia criptografada e confere",
    () => {
      const raiz = path.join(tmp, "repo")
      fs.mkdirSync(raiz)
      g(raiz, "init", "-q", "-b", "main")
      escrever(path.join(raiz, ".gitignore"), "Auditoria/\n.env*\n.backups/\nnode_modules/\n")
      escrever(path.join(raiz, "app.ts"), "export const a = 1\n")
      g(raiz, "add", "-A")
      g(raiz, "commit", "-q", "-m", "inicial")
      escrever(path.join(raiz, "Auditoria/piloto.json"), '{"pago":true}')
      fs.symlinkSync("piloto.json", path.join(raiz, "Auditoria/atalho.json"))
      escrever(path.join(raiz, ".env.local"), "ANTHROPIC_API_KEY=sk-ant-nao-deve-sair-123\n")
      escrever(path.join(raiz, "node_modules/pkg/i.js"))
      escrever(path.join(raiz, ".backups/vies-dona-2026-10-13T03-01-13-127Z/antes.json"), "{}")
      escrever(path.join(raiz, ".backups/2026-11-06T09-44-52-275Z/works.ndjson.gz"), "dump")
      escrever(path.join(raiz, "NOTAS.md"), "não rastreado")
      // Branch só local e um worktree com mudança não commitada.
      g(raiz, "branch", "experimento")
      const wt = path.join(tmp, "repo-wt")
      g(raiz, "worktree", "add", "-q", wt, "experimento")
      escrever(path.join(wt, "app.ts"), "export const a = 2\n")
      escrever(path.join(wt, "novo.ts"), "export const b = 3\n")
      g(wt, "commit", "-q", "--allow-empty", "-m", "só local")

      const staging = path.join(tmp, "staging")
      fs.mkdirSync(staging)
      const resumo = montarCopia({ raiz, staging })

      const dados = path.join(staging, "dados-locais")
      expect(fs.readFileSync(path.join(dados, "Auditoria/piloto.json"), "utf8")).toBe('{"pago":true}')
      expect(fs.readlinkSync(path.join(dados, "Auditoria/atalho.json"))).toBe("piloto.json")
      expect(fs.existsSync(path.join(dados, "NOTAS.md"))).toBe(true)
      expect(fs.existsSync(path.join(dados, ".env.local"))).toBe(false)
      expect(fs.existsSync(path.join(dados, "node_modules"))).toBe(false)
      expect(fs.existsSync(path.join(dados, ".backups/vies-dona-2026-10-13T03-01-13-127Z/antes.json"))).toBe(true)
      expect(fs.existsSync(path.join(dados, ".backups/2026-11-06T09-44-52-275Z"))).toBe(false)

      expect(fs.statSync(path.join(staging, "git/repo.bundle")).size).toBeGreaterThan(0)
      expect(fs.readFileSync(path.join(staging, "git/branches-so-locais.txt"), "utf8")).toMatch(/^experimento /m)
      expect(resumo.worktreesComMudanca).toEqual(["repo-wt"])
      expect(fs.readFileSync(path.join(staging, "git/wip/repo-wt/alteracoes.patch"), "utf8")).toMatch(/export const a = 2/)
      const lista = spawnSync("tar", ["-tf", path.join(staging, "git/wip/repo-wt/nao-rastreados.tar")], { encoding: "utf8" })
      expect(lista.stdout.trim()).toBe("novo.ts")
      expect(procurarValores(staging, valoresSecretos(raiz))).toEqual([])

      const destinoDir = path.join(tmp, "icloud")
      fs.mkdirSync(destinoDir)
      const senha = `teste-${Math.random().toString(36).slice(2)}`
      const nome = nomeDoDmgLocais("2026-11-08T07-00-04-196Z")
      enviarPasta({ origemDir: staging, nome, volume: "teste", destinoDir, senha })
      expect(copiasNoDestino(destinoDir, RE_DMG_LOCAIS)).toEqual([expect.objectContaining({ nome, confirmada: true })])
      const m = montar(path.join(destinoDir, nome), senha)
      try {
        expect(compararConteudo(staging, m.ponto)).toEqual([])
      } finally {
        desmontar(m)
      }
    },
    180_000,
  )
})
