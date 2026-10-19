import fs from "node:fs"
import http from "node:http"
import os from "node:os"
import path from "node:path"
import zlib from "node:zlib"
import { spawn } from "node:child_process"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { classificarBackup, contarLinhasGz } from "@/scripts/lib/backup-integridade.mjs"
import { escreverNdjsonGz, gravarBackup } from "@/scripts/lib/backup-gravacao.mjs"
import { listarFamilia, planejarPoda, podar } from "@/scripts/lib/backups-retencao.mjs"

/**
 * Um backup incompleto nunca é anunciado, contado ou mantido como completo — e a retenção nunca
 * descarta uma cópia válida para preservar uma inválida.
 *
 * 🔴 O defeito real (18/10/2026): uma queda de rede na página 1000 de `work_embeddings`
 * (`TypeError: terminated`) deixou `.backups/<stamp>/` com 68 de 82 tabelas, um gzip truncado e
 * nenhum manifesto ou schema — com o MESMO nome de um backup bom. A retenção ordenava por nome e
 * a contaria entre "os 5 mais recentes", empurrando uma cópia válida para a exclusão.
 *
 * Tudo aqui roda em diretórios temporários; nenhum caso toca `.backups/` de verdade.
 */

const RAIZ = path.resolve(import.meta.dirname, "../../..")
const LINHA = (i: number) => ({ id: `r-${String(i).padStart(5, "0")}`, texto: `linha\ncom quebra ${i}` })
const linhas = (n: number) => Array.from({ length: n }, (_, i) => LINHA(i))

let base: string
const envAntes = { ...process.env }
beforeEach(() => {
  base = fs.mkdtempSync(path.join(os.tmpdir(), "backup-teste-"))
  delete process.env.BACKUP_PODAR
  delete process.env.BACKUP_KEEP
})
afterEach(() => {
  fs.rmSync(base, { recursive: true, force: true })
  for (const k of ["BACKUP_PODAR", "BACKUP_KEEP", "PUSH_EVALS_KEEP"]) {
    if (envAntes[k] === undefined) delete process.env[k]
    else process.env[k] = envAntes[k]
  }
})

/** Páginas de 1000, como o backup real; `falhaNaPagina` imita a queda de 18/10. */
async function* paginas(rows: object[], rotulo: string, falhaNaPagina?: number) {
  for (let from = 0; from < Math.max(rows.length, 1); from += 1000) {
    if (falhaNaPagina === from) throw new Error(`${rotulo}: página ${from} falhou — TypeError: terminated`)
    const pagina = rows.slice(from, from + 1000)
    if (!pagina.length) return
    yield pagina
  }
}

const DADOS: Record<string, object[]> = { a: linhas(3), b: linhas(2500), c: linhas(0) }

function despejar({ falha }: { falha?: { tabela: string; pagina: number } } = {}) {
  return async (t: string, dir: string) => {
    const r = await escreverNdjsonGz(
      path.join(dir, `${t}.ndjson.gz`),
      paginas(DADOS[t], t, falha?.tabela === t ? falha.pagina : undefined),
      { esperado: DADOS[t].length, rotulo: t },
    )
    return { table: t, ...r }
  }
}

type SalvarSchema = (dir: string) => { status: string; [campo: string]: unknown }

const schemaOk: SalvarSchema = (dir) => {
  const gz = zlib.gzipSync(Buffer.from('CREATE TABLE "public"."a" (id text);\nCREATE POLICY p ON a;\n'))
  fs.writeFileSync(path.join(dir, "schema.sql.gz"), gz)
  return { status: "ok", bytes: gz.length, policies: 1, functions: 0, triggers: 0 }
}
const schemaAusente: SalvarSchema = () => ({ status: "ausente", motivo: "falta SUPABASE_DB_PASSWORD no .env" })

async function backup(stamp: string, opcoes: { falha?: { tabela: string; pagina: number }; schema?: SalvarSchema } = {}) {
  const destinoFinal = path.join(base, stamp)
  const dir = `${destinoFinal}.incompleto`
  fs.mkdirSync(dir, { recursive: true })
  return gravarBackup({
    dir,
    destinoFinal,
    tabelas: Object.keys(DADOS),
    despejar: despejar(opcoes),
    salvarSchema: opcoes.schema ?? schemaOk,
    project: "teste",
  })
}

/** Uma pasta como o `backup-db.mjs` ANTERIOR a 19/10 deixava: manifesto sem `formato`. */
function legado(stamp: string, { manifesto = true, schema = true, truncar = false, formato, em = base }: {
  manifesto?: boolean
  schema?: boolean
  truncar?: boolean
  formato?: number
  em?: string
} = {}) {
  const dir = path.join(em, stamp)
  fs.mkdirSync(dir, { recursive: true })
  const tables = ["a", "b"].map((t) => {
    const gz = zlib.gzipSync(Buffer.from(linhas(4).map((l) => JSON.stringify(l) + "\n").join("")))
    fs.writeFileSync(path.join(dir, `${t}.ndjson.gz`), truncar && t === "b" ? gz.subarray(0, 10) : gz)
    return { table: t, rows: 4, bytes: gz.length }
  })
  if (manifesto) {
    fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify({
      ...(formato != null ? { formato, status: "completo" } : {}),
      takenAt: "2026-10-01T00:00:00Z", project: "teste", tables, totalRows: 8,
    }))
  }
  if (schema) fs.writeFileSync(path.join(dir, "schema.sql.gz"), zlib.gzipSync(Buffer.from("CREATE TABLE x ();")))
  return dir
}

describe("caso 1 — backup completo", () => {
  it("vira <stamp>/ só depois de conferido, com manifesto formato 2 e schema", async () => {
    const r = await backup("2026-10-20T07-00-00-000Z")

    expect(r.estado).toBe("completo")
    expect(r.dir).toBe(path.join(base, "2026-10-20T07-00-00-000Z"))
    expect(fs.readdirSync(base)).toEqual(["2026-10-20T07-00-00-000Z"]) // a .incompleto não sobra

    const m = JSON.parse(fs.readFileSync(path.join(r.dir, "manifest.json"), "utf8"))
    expect(m).toMatchObject({ formato: 2, status: "completo", totalRows: 2503 })
    expect(m.schema).toMatchObject({ status: "ok" })
    expect(fs.existsSync(path.join(r.dir, "FALHA.json"))).toBe(false)
    expect(await contarLinhasGz(path.join(r.dir, "b.ndjson.gz"))).toBe(2500)

    expect(classificarBackup(r.dir)).toMatchObject({ estado: "completo", completo: true, legado: false })
  })
})

describe("caso 2 — interrupção no meio das tabelas", () => {
  it("a queda de 18/10: fica .incompleto com FALHA.json, a tabela vira .parcial, as anteriores sobram", async () => {
    const r = await backup("2026-10-18T07-00-02-555Z", { falha: { tabela: "b", pagina: 1000 } })

    expect(r).toMatchObject({ estado: "falhou", etapa: "tabelas", tabela: "b" })
    expect(r.erro).toContain("TypeError: terminated")

    const dir = path.join(base, "2026-10-18T07-00-02-555Z.incompleto")
    expect(fs.readdirSync(base)).toEqual(["2026-10-18T07-00-02-555Z.incompleto"]) // nunca o nome final
    expect(fs.readdirSync(dir).sort()).toEqual(["FALHA.json", "a.ndjson.gz", "b.ndjson.gz.parcial"])
    expect(JSON.parse(fs.readFileSync(path.join(dir, "FALHA.json"), "utf8"))).toMatchObject({ etapa: "tabelas", tabela: "b" })
    expect(await contarLinhasGz(path.join(dir, "a.ndjson.gz"))).toBe(3) // dado útil preservado

    expect(classificarBackup(dir)).toMatchObject({ estado: "incompleto", completo: false })
    expect(listarFamilia("backup", base)).toEqual([])
    expect(listarFamilia("backup-parcial", base)).toEqual(["2026-10-18T07-00-02-555Z.incompleto"])
  })

  it("contagem que não fecha também falha e marca a tabela como .parcial", async () => {
    const destinoFinal = path.join(base, "2026-10-20T07-00-00-000Z")
    const dir = `${destinoFinal}.incompleto`
    fs.mkdirSync(dir)
    const r = await gravarBackup({
      dir, destinoFinal, tabelas: ["a"], salvarSchema: schemaOk, project: "teste",
      despejar: async (t: string, d: string) => ({
        table: t,
        ...(await escreverNdjsonGz(path.join(d, `${t}.ndjson.gz`), paginas(linhas(3), t), { esperado: 4, rotulo: t })),
      }),
    })
    expect(r.estado).toBe("falhou")
    expect(r.erro).toContain("BACKUP INCOMPLETO — 3 linhas gravadas, 4 no banco")
    expect(fs.existsSync(path.join(dir, "a.ndjson.gz.parcial"))).toBe(true)
    expect(fs.existsSync(destinoFinal)).toBe(false)
  })

  it("a conferência relê o DISCO: arquivo que não bate com o registrado impede o nome final", async () => {
    const destinoFinal = path.join(base, "2026-10-20T07-00-00-000Z")
    const dir = `${destinoFinal}.incompleto`
    fs.mkdirSync(dir)
    const r = await gravarBackup({
      dir, destinoFinal, tabelas: ["a"], salvarSchema: schemaOk, project: "teste",
      // declara 5 linhas mas o arquivo tem 3: o tipo de mentira que só a releitura pega
      despejar: async (t: string, d: string) => {
        const w = await escreverNdjsonGz(path.join(d, `${t}.ndjson.gz`), paginas(linhas(3), t))
        return { table: t, rows: 5, bytes: w.bytes }
      },
    })
    expect(r).toMatchObject({ estado: "falhou", etapa: "conferência" })
    expect(r.erro).toContain("a: 3 linhas no arquivo, 5 no banco")
    expect(fs.existsSync(destinoFinal)).toBe(false)
    expect(fs.existsSync(path.join(dir, "manifest.json"))).toBe(false)
  })
})

describe("caso 3 — schema ausente", () => {
  it("dados preservados em <stamp>.sem-schema/, sem se passar por backup integral", async () => {
    const r = await backup("2026-10-20T07-00-00-000Z", { schema: schemaAusente })

    expect(r.estado).toBe("sem-schema")
    expect(r.dir).toBe(path.join(base, "2026-10-20T07-00-00-000Z.sem-schema"))
    expect(fs.existsSync(path.join(base, "2026-10-20T07-00-00-000Z"))).toBe(false)
    expect(await contarLinhasGz(path.join(r.dir, "b.ndjson.gz"))).toBe(2500)

    const m = JSON.parse(fs.readFileSync(path.join(r.dir, "manifest.json"), "utf8"))
    expect(m).toMatchObject({ formato: 2, status: "sem-schema", schema: { status: "ausente" } })
    expect(classificarBackup(r.dir)).toMatchObject({ estado: "sem-schema", completo: false })
    expect(listarFamilia("backup", base)).toEqual([])
  })

  it("pasta de nome final cujo manifesto afirma schema que não está lá não conta como completa", async () => {
    const r = await backup("2026-10-20T07-00-00-000Z")
    fs.rmSync(path.join(r.dir, "schema.sql.gz"))
    expect(classificarBackup(r.dir)).toMatchObject({ estado: "incompleto", completo: false })
  })
})

describe("caso 4 — retenção com backups válidos e inválidos", () => {
  async function cenario() {
    for (const d of ["01", "02", "03", "04", "05", "06"]) await backup(`2026-10-${d}T07-00-00-000Z`)
    // a mais RECENTE de todas é a interrompida — com nome de backup, como a de 18/10 (legado)
    legado("2026-10-18T07-00-02-555Z", { manifesto: false, schema: false })
    await backup("2026-10-19T07-00-00-000Z", { falha: { tabela: "b", pagina: 1000 } })
    await backup("2026-10-17T07-00-00-000Z", { schema: schemaAusente })
  }

  it("a parcial mais recente não desloca uma completa, e sem BACKUP_PODAR nada é apagado", async () => {
    await cenario()
    const antes = fs.readdirSync(base).sort()
    const log: string[] = []

    const r = podar("backup", { base, log: (l: string) => log.push(l) })

    expect(r.apagados).toEqual([])
    expect(fs.readdirSync(base).sort()).toEqual(antes)
    expect(r.manter).toEqual(["06", "05", "04", "03", "02"].map((d) => `2026-10-${d}T07-00-00-000Z`))
    expect(r.simulados).toEqual(["2026-10-01T07-00-00-000Z"])
    expect(r.preservados.map((p: { nome: string }) => p.nome)).toEqual(["2026-10-18T07-00-02-555Z"])
    expect(log.join("\n")).toContain("SIMULAÇÃO, nada foi apagado")
    expect(log.join("\n")).toContain("apagaria 2026-10-01T07-00-00-000Z")
    expect(log.join("\n")).toContain("2026-10-18T07-00-02-555Z NÃO conta como backup")
  })

  it("com BACKUP_PODAR=1 apaga só completos além do limite — nunca parcial, sem-schema ou interrompido", async () => {
    await cenario()
    process.env.BACKUP_PODAR = "1"
    process.env.BACKUP_KEEP = "2"

    const r = podar("backup", { base, log: () => {} })

    expect(r.apagados).toEqual(["04", "03", "02", "01"].map((d) => `2026-10-${d}T07-00-00-000Z`))
    expect(fs.readdirSync(base).sort()).toEqual([
      "2026-10-05T07-00-00-000Z",
      "2026-10-06T07-00-00-000Z",
      "2026-10-17T07-00-00-000Z.sem-schema",
      "2026-10-18T07-00-02-555Z",
      "2026-10-19T07-00-00-000Z.incompleto",
    ])
  })

  it("a família backup-parcial nunca é podada, nem com BACKUP_PODAR=1", async () => {
    await cenario()
    process.env.BACKUP_PODAR = "1"
    expect(podar("backup-parcial", { base, log: () => {} }).apagados).toEqual([])
    expect(listarFamilia("backup-parcial", base)).toHaveLength(2)
  })
})

describe("caso 5 — backups históricos, sem o marcador novo", () => {
  it("o nome sozinho não basta: a régua confere manifesto, tamanhos e schema", () => {
    const c = (o: Parameters<typeof legado>[1], s: string) => classificarBackup(legado(s, o))
    expect(c({}, "2026-09-01T00-00-00-000Z")).toMatchObject({ estado: "completo", legado: true })
    expect(c({ manifesto: false }, "2026-09-02T00-00-00-000Z")).toMatchObject({ estado: "incompleto" })
    expect(c({ truncar: true }, "2026-09-03T00-00-00-000Z")).toMatchObject({ estado: "incompleto" })
    expect(c({ schema: false }, "2026-09-04T00-00-00-000Z")).toMatchObject({ estado: "sem-schema", legado: true })
    expect(c({ formato: 3 }, "2026-09-05T00-00-00-000Z")).toMatchObject({ estado: "desconhecido" })
  })

  it("histórico de validade não comprovada nunca é apagado nem conta no limite", () => {
    legado("2026-09-01T00-00-00-000Z")
    legado("2026-09-02T00-00-00-000Z")
    legado("2026-09-03T00-00-00-000Z", { manifesto: false })
    legado("2026-09-04T00-00-00-000Z", { truncar: true })
    legado("2026-09-05T00-00-00-000Z", { schema: false })
    legado("2026-09-06T00-00-00-000Z", { formato: 3 })
    process.env.BACKUP_PODAR = "1"
    process.env.BACKUP_KEEP = "1"

    const plano = planejarPoda("backup", { base })
    expect(plano.manter).toEqual(["2026-09-02T00-00-00-000Z"])
    expect(plano.apagar).toEqual(["2026-09-01T00-00-00-000Z"])

    podar("backup", { base, log: () => {} })
    expect(fs.readdirSync(base).sort()).toEqual([
      "2026-09-02T00-00-00-000Z",
      "2026-09-03T00-00-00-000Z",
      "2026-09-04T00-00-00-000Z",
      "2026-09-05T00-00-00-000Z",
      "2026-09-06T00-00-00-000Z",
    ])
  })
})

describe("caso 6 — as outras famílias não mudaram de política", () => {
  it("push-evals segue podando pelo nome, sem exigir BACKUP_PODAR", () => {
    for (let i = 1; i <= 5; i++) fs.mkdirSync(path.join(base, `push-2026-08-0${i}T00-00-00-000Z`))
    const r = podar("push-evals", { base, log: () => {} })
    expect(r.apagados).toEqual(["push-2026-08-02T00-00-00-000Z", "push-2026-08-01T00-00-00-000Z"])
    expect(fs.readdirSync(base)).toHaveLength(3)
  })

  it("podar uma família não toca nas pastas de backup", async () => {
    await backup("2026-10-20T07-00-00-000Z")
    await backup("2026-10-21T07-00-00-000Z", { falha: { tabela: "b", pagina: 1000 } })
    for (let i = 1; i <= 5; i++) fs.mkdirSync(path.join(base, `push-2026-08-0${i}T00-00-00-000Z`))
    process.env.PUSH_EVALS_KEEP = "1"
    podar("push-evals", { base, log: () => {} })
    expect(fs.existsSync(path.join(base, "2026-10-20T07-00-00-000Z"))).toBe(true)
    expect(fs.existsSync(path.join(base, "2026-10-21T07-00-00-000Z.incompleto"))).toBe(true)
  })
})

/**
 * Ponta a ponta: o `backup-db.mjs` REAL contra um PostgREST falso que derruba a conexão no meio
 * da 2ª página — a mesma queda de 18/10. Prova a propagação do erro, o código de saída e o estado
 * da pasta, coisas que o teste do módulo não alcança.
 */
describe("backup-db.mjs de verdade, contra um PostgREST falso", () => {
  const TABELAS: Record<string, object[]> = { a: linhas(3), work_embeddings: linhas(1500) }
  const PK = { id: { type: "string", description: "Note:\nThis is a Primary Key.<pk/>" } }

  async function servidor({ derrubar }: { derrubar: boolean }) {
    const srv = http.createServer((req, res) => {
      const url = new URL(req.url ?? "/", "http://x")
      url.pathname = url.pathname.replace(/^\/https:\/\/[a-z0-9]+\.supabase\.co/, "")
      if (url.pathname === "/rest/v1/") {
        res.setHeader("content-type", "application/json")
        return res.end(JSON.stringify({ definitions: Object.fromEntries(Object.keys(TABELAS).map((t) => [t, { properties: PK }])) }))
      }
      const rows = TABELAS[url.pathname.replace("/rest/v1/", "")] ?? []
      if (req.method === "HEAD") {
        res.writeHead(200, { "content-range": `*/${rows.length}` })
        return res.end()
      }
      const offset = Number(url.searchParams.get("offset") ?? 0)
      const limit = Number(url.searchParams.get("limit") ?? rows.length)
      if (derrubar && url.pathname.endsWith("/work_embeddings") && offset === 1000) {
        res.writeHead(200, { "content-type": "application/json" })
        res.write('[{"id":"r-01000","texto":"meio')
        setTimeout(() => res.socket?.destroy(), 20)
        return
      }
      res.setHeader("content-type", "application/json")
      res.end(JSON.stringify(rows.slice(offset, offset + limit)))
    })
    await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r))
    return srv
  }

  /**
   * `comSchema`: o script só tenta o `pg_dump` quando a URL contém `https://<ref>.supabase.co`, então
   * a URL leva esse trecho como CAMINHO (`http://127.0.0.1:<porta>/https://ref.supabase.co`) — o
   * servidor falso o descarta — e um `pg_dump` falso no PATH escreve um schema de verdade.
   */
  async function rodar(porta: number, { comSchema = false } = {}) {
    const envFile = path.join(base, "teste.env")
    const url = `http://127.0.0.1:${porta}${comSchema ? "/https://reffalsa.supabase.co" : ""}`
    fs.writeFileSync(envFile, `NEXT_PUBLIC_SUPABASE_URL=${url}\nSUPABASE_SERVICE_ROLE_KEY=falsa\n` +
      (comSchema ? "SUPABASE_DB_PASSWORD=falsa\n" : ""))
    const bin = path.join(base, "bin")
    fs.mkdirSync(bin, { recursive: true })
    fs.writeFileSync(path.join(bin, "pg_dump"), "#!/bin/sh\n" +
      'while [ $# -gt 0 ]; do if [ "$1" = "-f" ]; then shift; ' +
      "printf 'CREATE TABLE a (id text);\\nCREATE POLICY p ON a;\\n' > \"$1\"; fi; shift; done\n", { mode: 0o755 })
    const destino = path.join(base, "saida")
    const filho = spawn(process.execPath, [path.join(RAIZ, "scripts/backup-db.mjs"), destino], {
      cwd: RAIZ,
      // Ambiente mínimo de propósito: nada de SUPABASE_DB_PASSWORD herdado do shell.
      env: {
        PATH: `${bin}:${process.env.PATH}`,
        HOME: process.env.HOME,
        BACKUP_ENV_FILE: path.relative(RAIZ, envFile),
        BACKUP_ALLOW_LOCAL: "1",
      } as unknown as NodeJS.ProcessEnv,
    })
    let saida = ""
    filho.stdout.on("data", (d: Buffer) => (saida += d))
    filho.stderr.on("data", (d: Buffer) => (saida += d))
    const codigo = await new Promise<number | null>((r) => filho.on("close", r))
    return { codigo, saida, destino, pastas: fs.existsSync(destino) ? fs.readdirSync(destino) : [] }
  }

  it("tudo certo: exit 0, <stamp>/ completo, e a retenção só SIMULA e preserva as inválidas", async () => {
    // na pasta de saída já existem um backup antigo válido e uma pasta como a de 18/10
    const saida = path.join(base, "saida")
    legado("2026-10-01T00-00-00-000Z", { em: saida })
    legado("2026-10-18T07-00-02-555Z", { em: saida, manifesto: false, schema: false })
    const srv = await servidor({ derrubar: false })
    try {
      const r = await rodar((srv.address() as { port: number }).port, { comSchema: true })

      expect(r.codigo, r.saida).toBe(0)
      expect(r.saida).toContain("✅ BACKUP COMPLETO — 1503 linhas em 2 tabelas + schema")
      expect(r.saida).toContain("SIMULAÇÃO, nada foi apagado")
      expect(r.saida).toContain("2026-10-18T07-00-02-555Z NÃO conta como backup")
      const novo = r.pastas.filter((p) => !p.startsWith("2026-10-01") && !p.startsWith("2026-10-18"))
      expect(novo).toHaveLength(1)
      expect(novo[0]).toMatch(/^\d{4}-\d{2}-\d{2}T[\d-]+Z$/)
      expect(classificarBackup(path.join(r.destino, novo[0]))).toMatchObject({ estado: "completo", legado: false })
      expect(r.pastas).toContain("2026-10-01T00-00-00-000Z")
      expect(r.pastas).toContain("2026-10-18T07-00-02-555Z")
    } finally {
      srv.close()
    }
  }, 30_000)

  it("queda de rede no meio de uma tabela: exit 1, pasta .incompleto, nada com nome de backup", async () => {
    const srv = await servidor({ derrubar: true })
    try {
      const r = await rodar((srv.address() as { port: number }).port)

      expect(r.codigo).toBe(1)
      expect(r.saida).toContain("BACKUP FALHOU na etapa tabelas (tabela work_embeddings)")
      expect(r.saida).toContain("terminated")
      expect(r.saida).not.toContain("✅")
      expect(r.pastas).toHaveLength(1)
      expect(r.pastas[0]).toMatch(/^\d{4}-\d{2}-\d{2}T[\d-]+Z\.incompleto$/)
      const dir = path.join(r.destino, r.pastas[0])
      expect(fs.readdirSync(dir).sort()).toEqual(["FALHA.json", "a.ndjson.gz", "work_embeddings.ndjson.gz.parcial"])
      expect(classificarBackup(dir).estado).toBe("incompleto")
    } finally {
      srv.close()
    }
  }, 30_000)

  it("sem como salvar o schema: exit 2 e pasta .sem-schema, sem ✅ de backup completo", async () => {
    const srv = await servidor({ derrubar: false })
    try {
      const r = await rodar((srv.address() as { port: number }).port)

      expect(r.codigo).toBe(2)
      expect(r.saida).toContain("BACKUP SÓ DE DADOS")
      expect(r.saida).not.toContain("BACKUP COMPLETO")
      expect(r.pastas).toHaveLength(1)
      expect(r.pastas[0]).toMatch(/Z\.sem-schema$/)
      const dir = path.join(r.destino, r.pastas[0])
      expect(classificarBackup(dir)).toMatchObject({ estado: "sem-schema", totalRows: 1503 })
      expect(await contarLinhasGz(path.join(dir, "work_embeddings.ndjson.gz"))).toBe(1500)
    } finally {
      srv.close()
    }
  }, 30_000)
})
