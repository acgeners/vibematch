import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  compararConteudo,
  copiasNoDestino,
  enviarBackup,
  montar,
  desmontar,
  nomeDoDmg,
  planejarEnvio,
  planejarPodaDestino,
  sha256Arquivo,
} from "@/scripts/lib/backup-icloud.mjs"

/**
 * A cópia dos backups no iCloud só conta quando está CONFERIDA, e a poda nunca apaga o que não é
 * dela nem o que ainda não foi confirmado. Tudo roda em diretórios temporários: nenhum caso toca
 * o iCloud nem o Keychain de verdade (a senha do caso de integração é passada direto).
 */

const S = (dia: string) => `2026-${dia}T07-00-04-196Z`
const copia = (stamp: string, confirmada = true) => ({ stamp, nome: nomeDoDmg(stamp), hash: confirmada ? "a".repeat(64) : null, confirmada })

let tmp: string
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "backup-icloud-teste-"))
})
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true })
})

describe("o que enviar", () => {
  it("manda os N completos mais recentes que não estão confirmados lá", () => {
    const completos = [S("10-04"), S("11-01"), S("10-25"), S("10-11"), S("10-18")]
    const r = planejarEnvio({ completos, copias: [copia(S("11-01"))], keep: 3 })
    expect(r.alvo).toEqual([S("11-01"), S("10-25"), S("10-18")])
    expect(r.enviar).toEqual([S("10-25"), S("10-18")])
  })

  it("cópia sem .sha256 não está confirmada e é enviada de novo", () => {
    const r = planejarEnvio({ completos: [S("11-01")], copias: [copia(S("11-01"), false)], keep: 5 })
    expect(r.enviar).toEqual([S("11-01")])
  })
})

describe("poda do iCloud", () => {
  it("apaga só confirmadas além das N mais recentes", () => {
    const copias = [copia(S("10-04")), copia(S("11-01")), copia(S("10-25")), copia(S("10-18"), false)]
    expect(planejarPodaDestino({ copias, keep: 2 })).toEqual([nomeDoDmg(S("10-04"))])
  })

  it("com N ou menos confirmadas, não apaga nada — nem a não confirmada", () => {
    const copias = [copia(S("11-01")), copia(S("10-04"), false)]
    expect(planejarPodaDestino({ copias, keep: 5 })).toEqual([])
  })

  it("só enxerga arquivos deste módulo: cópias manuais da pasta ficam fora", () => {
    for (const n of ["VibeMatch-preservacao-2026-10-19.dmg", "VibeMatch-complemento-2026-10-19.dmg", "outro.dmg"]) {
      fs.writeFileSync(path.join(tmp, n), "x")
    }
    const nome = nomeDoDmg(S("11-01"))
    fs.writeFileSync(path.join(tmp, nome), "x")
    fs.writeFileSync(path.join(tmp, `${nome}.sha256`), `${"b".repeat(64)}  ${nome}\n`)
    const copias = copiasNoDestino(tmp)
    expect(copias.map((c) => c.nome)).toEqual([nome])
    expect(planejarPodaDestino({ copias, keep: 0 })).toEqual([nome])
  })

  it(".sha256 que nomeia OUTRO arquivo, ou malformado, não confirma", () => {
    const a = nomeDoDmg(S("11-01"))
    const b = nomeDoDmg(S("10-25"))
    for (const n of [a, b]) fs.writeFileSync(path.join(tmp, n), "x")
    fs.writeFileSync(path.join(tmp, `${a}.sha256`), `${"c".repeat(64)}  ${b}\n`)
    fs.writeFileSync(path.join(tmp, `${b}.sha256`), "isto não é um hash\n")
    expect(copiasNoDestino(tmp).every((c) => !c.confirmada)).toBe(true)
  })
})

describe("conferência do conteúdo", () => {
  const preparar = () => {
    const a = path.join(tmp, "a")
    const b = path.join(tmp, "b")
    for (const d of [a, b]) {
      fs.mkdirSync(path.join(d, "sub"), { recursive: true })
      fs.writeFileSync(path.join(d, "manifest.json"), "{}")
      fs.writeFileSync(path.join(d, "sub", "t.ndjson.gz"), "dados")
    }
    return { a, b }
  }

  it("igual ⇒ sem problemas; entradas de sistema na raiz do volume são ignoradas", () => {
    const { a, b } = preparar()
    fs.mkdirSync(path.join(b, ".fseventsd"))
    expect(compararConteudo(a, b)).toEqual([])
  })

  it("acusa arquivo faltando, diferente e a mais", () => {
    const { a, b } = preparar()
    fs.writeFileSync(path.join(b, "sub", "t.ndjson.gz"), "outro")
    fs.rmSync(path.join(b, "manifest.json"))
    fs.writeFileSync(path.join(b, "extra.txt"), "x")
    expect(compararConteudo(a, b).sort()).toEqual(
      ["arquivo a mais: extra.txt", "falta manifest.json", "sub/t.ndjson.gz difere do original"].sort(),
    )
  })

  it("origem vazia nunca passa como conferida", () => {
    fs.mkdirSync(path.join(tmp, "a"))
    fs.mkdirSync(path.join(tmp, "b"))
    expect(compararConteudo(path.join(tmp, "a"), path.join(tmp, "b"))).toContain("a pasta de origem está vazia")
  })
})

describe.runIf(process.platform === "darwin")("envio de verdade com hdiutil", () => {
  it(
    "gera DMG criptografado, confere e só então escreve o .sha256; senha errada não abre",
    () => {
      const stamp = S("11-01")
      const origemDir = path.join(tmp, stamp)
      const destinoDir = path.join(tmp, "icloud")
      fs.mkdirSync(origemDir)
      fs.mkdirSync(destinoDir)
      fs.writeFileSync(path.join(origemDir, "manifest.json"), JSON.stringify({ formato: 2 }))
      fs.writeFileSync(path.join(origemDir, "works.ndjson.gz"), Buffer.alloc(200_000, 7))
      const senha = `teste-${Math.random().toString(36).slice(2)}`

      const r = enviarBackup({ origemDir, stamp, destinoDir, senha })
      const final = path.join(destinoDir, nomeDoDmg(stamp))
      expect(fs.readdirSync(destinoDir).sort()).toEqual([nomeDoDmg(stamp), `${nomeDoDmg(stamp)}.sha256`])
      expect(fs.readFileSync(`${final}.sha256`, "utf8")).toBe(`${r.hash}  ${nomeDoDmg(stamp)}\n`)
      expect(sha256Arquivo(final)).toBe(r.hash)
      expect(fs.statSync(final).mode & 0o777).toBe(0o600)
      expect(copiasNoDestino(destinoDir)).toEqual([expect.objectContaining({ stamp, confirmada: true })])

      expect(() => montar(final, "senha-errada")).toThrow(/não abriu/)
      const m = montar(final, senha)
      try {
        expect(compararConteudo(origemDir, m.ponto)).toEqual([])
      } finally {
        desmontar(m)
      }
    },
    120_000,
  )

  it(
    "falha no meio não deixa cópia nem .sha256 no destino",
    () => {
      const stamp = S("10-25")
      const destinoDir = path.join(tmp, "icloud")
      fs.mkdirSync(destinoDir)
      // Origem inexistente: o hdiutil create falha antes de qualquer cópia.
      expect(() => enviarBackup({ origemDir: path.join(tmp, "nao-existe"), stamp, destinoDir, senha: "x" })).toThrow()
      expect(fs.readdirSync(destinoDir)).toEqual([])
    },
    60_000,
  )
})

describe("o agente de domingo chama a cópia", () => {
  it("backup-primary roda a cópia no iCloud depois do backup do banco, sem esconder a falha do banco", () => {
    const src = fs.readFileSync(path.join(process.cwd(), "scripts/backup-primary.mjs"), "utf8")
    const banco = src.indexOf('"scripts/backup-db.mjs"')
    const icloud = src.indexOf('"scripts/backup-icloud.mjs"')
    expect(banco).toBeGreaterThan(-1)
    expect(icloud).toBeGreaterThan(banco)
    expect(src).toMatch(/process\.exit\(banco !== 0 \? banco : icloud\)/)
  })
})
