import { describe, it, expect } from "vitest"
import { execSync } from "node:child_process"
import { existsSync, readFileSync, readdirSync } from "node:fs"
import { join, dirname, resolve as resolvePath } from "node:path"

/**
 * Invariante: quem lê `works_owner` só pode pedir coluna que a VIEW expõe.
 *
 * 🔴 O que isto pega, medido em 2026-08-18: `computeLowCoverage` pedia
 * `works_owner.genres` — coluna que não existe em lugar nenhum desde a migration **024**,
 * que dropou o array legado `works.genres` em favor de `work_genres` + `genres`. O erro do
 * PostgREST vinha em `{ data: null, error }`, o chamador lia só o `data`, e o cálculo saía
 * sobre ZERO linhas: guard 2 em "unknown" e o badge ⚠ de baixa cobertura do `/ranking` nunca
 * acendendo. Nada quebrava — a página abria certa, só sem o aviso. Foi a paginação
 * (`fetchAllRows`, que LANÇA no erro do PostgREST) que transformou isso em Runtime Error e
 * denunciou o defeito.
 *
 * ⚠️ A view lista as colunas de `works` UMA A UMA (ver o comentário da migration 184), então
 * a divergência é nos DOIS sentidos: coluna nova em `works` nasce invisível aqui, e coluna
 * dropada de `works` continua sendo pedida por quem não foi avisado. Os dois lados são
 * derivados — a lista sai da migration vigente e as colunas saem do source.
 *
 * ## O que a varredura alcança (remedido em 2026-08-19)
 *
 * A 1ª versão cobria os `.select("literal")` de UM arquivo: **8 de 32** pontos de leitura. A
 * causa de perder os outros NÃO era a quebra de linha (a regex tinha `\s*` e já a aceitava) —
 * era a classe `[^"()]`, que descartava todo select com EMBED, e embed é o caso comum aqui
 * (`work_covers(url, is_primary)`). Hoje o parser quebra por vírgula em nível ZERO, então
 * embed deixou de ser obstáculo **e** deixou de virar falso positivo: `calc_score` dentro de
 * `calculated_scores(...)` é coluna da OUTRA tabela e não é cobrado desta view.
 *
 * O universo medido, e o que cada forma exigiu:
 *
 * | forma | n | como é resolvida |
 * |---|---|---|
 * | `.from("works_owner").select(…)` | **27** | literal · template com `${}` · variável · ternário (os DOIS ramos) · `[…].join(", ")` com spread · const IMPORTADA de outro arquivo · `Object.keys(obj)` |
 * | `.from("works_owner").update({…})` | **1** | as CHAVES do objeto — escrever coluna que não existe falha igual |
 * | embed `works_owner!fk(…)` a partir de OUTRA tabela | **3** | nunca passa por `.from("works_owner")`; um scanner ancorado no `.from` é cego pros três |
 * | `pageAll("works_owner", "id", …)` | **1** | helper com a tabela no 1º argumento |
 *
 * ✅ **Nenhum defeito vivo** nos 32 (162 referências de coluna, 30 distintas): este teste é
 * REDE, não conserto. O `synopsis_interest_skipped` da sonda defensiva da migration 121 está
 * na view — não é exceção.
 *
 * 🔴 **O universo é DERIVADO, não uma lista de formas conhecidas.** Toda ocorrência do token
 * `works_owner` fora de comentário tem que cair num dos baldes acima (ou ser consumo do
 * resultado: `r.works_owner`, chave de tipo). Sobrando qualquer uma, o teste REPROVA com o
 * `arquivo:linha` — é isso que pega a forma que ninguém apontou, que foi exatamente como o
 * embed e o `pageAll` apareceram. Checar só o que se sabe parsear, calado, dá falso conforto.
 *
 * ⚠️ Select que o parser não conseguir resolver também REPROVA, com o texto da expressão. A
 * saída não é apagar a asserção: é declarar na linha `// works-owner-dinamico: <motivo>`, e
 * o teste imprime quantas declarações existem (hoje **0**) pra elas não se acumularem caladas.
 */

const ROOT = join(__dirname, "../../..")
const MIGRATIONS = join(ROOT, "supabase/migrations")

/** As colunas da definição MAIS RECENTE da view (a que está em vigor). */
function colunasDaView(view: string): { arquivo: string; colunas: string[] } {
  for (const nome of readdirSync(MIGRATIONS).filter((n) => n.endsWith(".sql")).sort().reverse()) {
    const sql = readFileSync(join(MIGRATIONS, nome), "utf8")
    // Só a definição REAL conta — os comentários citam a view o tempo todo.
    const m = sql.match(
      new RegExp(`create\\s+or\\s+replace\\s+view\\s+(?:public\\.)?${view}\\s+as([\\s\\S]*?)\\bFROM\\s+works\\s+w\\b`, "i"),
    )
    if (!m) continue
    const corpo = m[1].replace(/^\s*SELECT/i, "").replace(/--[^\n]*/g, "")
    const colunas = corpo
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean)
      .map((t) => {
        const apelido = t.match(/\bAS\s+([a-z_][a-z0-9_]*)\s*$/i) // COALESCE(...) AS is_favorite
        if (apelido) return apelido[1]
        const simples = t.match(/^[a-z]\.([a-z_][a-z0-9_]*)$/i) // w.title / s.user_score
        return simples ? simples[1] : null
      })
      .filter((c): c is string => Boolean(c))
    return { arquivo: nome, colunas }
  }
  return { arquivo: "", colunas: [] }
}

const VIEW = colunasDaView("works_owner")

// ─────────────────────────────────────────────────────────────────────────────
// O parser. Tudo entra por `ler`, então as sondas exercitam o MESMO código com
// fontes sintéticas — sem escrever arquivo e sem depender do estado do repo.
// ─────────────────────────────────────────────────────────────────────────────

type Ler = (rel: string) => string | null

interface Pedido { arquivo: string; linha: number; coluna: string; via: string }
interface Pendencia { arquivo: string; linha: number; motivo: string }
interface Varredura {
  pedidos: Pedido[]
  naoResolvidos: Pendencia[]
  naoClassificados: Pendencia[]
  declarados: Pendencia[]
  locais: string[]
  cadeias: number
}

/**
 * Apaga comentários preservando os offsets. Precisa conhecer REGEX LITERAL: um
 * `/^["']|["']$/g` tem aspas DENTRO, e um stripper que só conhece string entra em modo
 * string ali e dessincroniza o arquivo inteiro daquele ponto em diante — medido em
 * `scripts/e2e/verify-fase-d-dono.mjs`, onde isso escondia a leitura de baixo.
 */
export function semComentarios(src: string): string {
  const out = src.split("")
  const n = src.length
  let i = 0
  let prev = ""
  const podeSerRegex = () =>
    prev === "" ||
    /[(,=:[!&|?{};+\-*%~^<>]/.test(prev) ||
    /\b(return|typeof|case|in|of|do|else|yield|await|new|delete|void|instanceof)$/.test(prev)
  const pulaString = (start: number, q: string): number => {
    let j = start + 1
    while (j < n) {
      if (src[j] === "\\") { j += 2; continue }
      if (q === "`" && src[j] === "$" && src[j + 1] === "{") {
        let d = 1
        j += 2
        while (j < n && d > 0) { if (src[j] === "{") d++; else if (src[j] === "}") d--; j++ }
        continue
      }
      if (src[j] === q) return j + 1
      j++
    }
    return j
  }
  while (i < n) {
    const c = src[i]
    if (c === '"' || c === "'" || c === "`") { i = pulaString(i, c); prev = "x"; continue }
    if (c === "/" && src[i + 1] === "/") { while (i < n && src[i] !== "\n") { out[i] = " "; i++ } continue }
    if (c === "/" && src[i + 1] === "*") {
      while (i < n && !(src[i] === "*" && src[i + 1] === "/")) { if (src[i] !== "\n") out[i] = " "; i++ }
      if (i < n) { out[i] = " "; out[i + 1] = " "; i += 2 }
      continue
    }
    if (c === "/" && podeSerRegex()) {
      let j = i + 1
      let classe = false
      let fechou = false
      while (j < n && src[j] !== "\n") {
        if (src[j] === "\\") { j += 2; continue }
        if (src[j] === "[") classe = true
        else if (src[j] === "]") classe = false
        else if (src[j] === "/" && !classe) { fechou = true; break }
        j++
      }
      if (fechou) { i = j + 1; prev = "x"; continue }
    }
    if (!/\s/.test(c)) prev = /[\w$]/.test(c) ? (prev + c).slice(-12) : c
    i++
  }
  return out.join("")
}

/** Do "(" que abre, o texto do argumento até o ")" que FECHA — parênteses balanceados. */
export function argumentoEm(src: string, abre: number): { texto: string; fim: number } | null {
  let d = 0
  let i = abre
  const n = src.length
  while (i < n) {
    const c = src[i]
    if (c === '"' || c === "'" || c === "`") {
      const q = c
      i++
      while (i < n) {
        if (src[i] === "\\") { i += 2; continue }
        if (q === "`" && src[i] === "$" && src[i + 1] === "{") {
          let dd = 1
          i += 2
          while (i < n && dd > 0) { if (src[i] === "{") dd++; else if (src[i] === "}") dd--; i++ }
          continue
        }
        if (src[i] === q) { i++; break }
        i++
      }
      continue
    }
    if (c === "(") d++
    else if (c === ")") { d--; if (d === 0) return { texto: src.slice(abre + 1, i), fim: i } }
    i++
  }
  return null
}

/**
 * Quebra por vírgula em NÍVEL ZERO, respeitando aspas e parênteses.
 *
 * 🔴 É a peça que faz o embed parar de mentir nos dois sentidos: sem ela,
 * `"id, calculated_scores(expected_score, calc_score)"` vira cinco pedaços e `calc_score`
 * é cobrado desta view, quando é coluna de OUTRA tabela. Foi esse o falso positivo que
 * apareceu ao medir o inventário — e falso positivo é o jeito mais rápido de um teste ser
 * desligado.
 */
export function fatiarNivelZero(lista: string): string[] {
  const partes: string[] = []
  let atual = ""
  let d = 0
  for (let i = 0; i < lista.length; i++) {
    const c = lista[i]
    if (c === '"' || c === "'" || c === "`") {
      const q = c
      let j = i + 1
      while (j < lista.length) {
        if (lista[j] === "\\") { j += 2; continue }
        if (lista[j] === q) break
        j++
      }
      atual += lista.slice(i, j + 1)
      i = j
      continue
    }
    if ("([{".includes(c)) d++
    if (")]}".includes(c)) d--
    if (c === "," && d === 0) { partes.push(atual); atual = ""; continue }
    atual += c
  }
  partes.push(atual)
  return partes.map((p) => p.trim()).filter(Boolean)
}

/** As colunas de PRIMEIRO nível de um select — o que tem "(" é embed, de outra tabela. */
export function colunasDoSelect(sel: string): string[] {
  return fatiarNivelZero(sel)
    .filter((t) => !t.includes("("))
    .map((t) => (t.includes(":") ? t.slice(t.indexOf(":") + 1) : t).trim()) // apelido:coluna
    .filter((t) => t && t !== "*")
}

/** Tira vírgula final e asserção de tipo (`as const`, `as Foo[]`) — ruído, não expressão. */
function limpar(t: string): string {
  let e = t.trim()
  for (;;) {
    const antes = e
    e = e.replace(/,$/, "").trim()
    e = e.replace(/\s+as\s+[A-Za-z_$][\w$.]*(?:<[^<>]*>)?(?:\[\])*$/, "").trim()
    if (e === antes) return e
  }
}

function criarResolvedor(ler: Ler) {
  const cache = new Map<string, string | null>()
  const fonte = (rel: string): string | null => {
    if (!cache.has(rel)) {
      const bruto = ler(rel)
      cache.set(rel, bruto == null ? null : semComentarios(bruto))
    }
    return cache.get(rel) ?? null
  }

  const moduloDe = (arquivo: string, spec: string): string | null => {
    const base = spec.startsWith("@/")
      ? spec.slice(2)
      : spec.startsWith(".")
        ? resolvePath("/" + dirname(arquivo), spec).slice(1)
        : null
    if (!base) return null
    for (const ext of [".ts", ".tsx", ".mjs", ".js", "/index.ts", "/index.tsx"]) {
      if (fonte(base + ext) != null) return base + ext
    }
    return null
  }

  /** O arquivo que DECLARA `nome`, seguindo os imports. */
  const ondeDeclara = (arquivo: string, nome: string, prof = 0): string | null => {
    const src = fonte(arquivo)
    if (src == null || prof > 6) return null
    if (new RegExp(`\\b(?:export\\s+)?const\\s+${nome}\\b`).test(src)) return arquivo
    for (const m of src.matchAll(/import\s+(?:type\s+)?\{([^}]*)\}\s*from\s*["']([^"']+)["']/g)) {
      if (!m[1].split(",").some((t) => t.trim().split(/\s+as\s+/)[0].trim() === nome)) continue
      const mod = moduloDe(arquivo, m[2])
      if (mod) return ondeDeclara(mod, nome, prof + 1) ?? mod
    }
    return null
  }

  /** O texto de `const <nome> = <isto>`. */
  const inicializador = (src: string, nome: string): string | null => {
    const m = src.match(new RegExp(`\\b(?:export\\s+)?const\\s+${nome}\\s*(?::[^=]*)?=\\s*`))
    if (!m || m.index == null) return null
    let i = m.index + m[0].length
    let d = 0
    let out = ""
    const n = src.length
    while (i < n) {
      const c = src[i]
      if (c === '"' || c === "'" || c === "`") {
        const q = c
        let j = i + 1
        while (j < n) {
          if (src[j] === "\\") { j += 2; continue }
          if (q === "`" && src[j] === "$" && src[j + 1] === "{") {
            let dd = 1
            j += 2
            while (j < n && dd > 0) { if (src[j] === "{") dd++; else if (src[j] === "}") dd--; j++ }
            continue
          }
          if (src[j] === q) { j++; break }
          j++
        }
        out += src.slice(i, j)
        i = j
        continue
      }
      if ("([{".includes(c)) d++
      if (")]}".includes(c)) { if (d === 0) break; d-- }
      if (d === 0 && (c === ";" || c === "\n")) {
        // Continua só se a linha seguinte encadeia (`? :`, `+`, `.`) — senão a declaração acabou.
        const folga = src.slice(i + 1).match(/^\s*/)![0].length
        const prox = src[i + 1 + folga]
        if (c === "\n" && ((prox && "?:+.".includes(prox)) || /[?:+.]\s*$/.test(out))) { out += c; i++; continue }
        break
      }
      out += c
      i++
    }
    return out.trim()
  }

  /** Ternário no nível zero → os dois ramos (os DOIS rodam em produção). */
  const fatiaTernaria = (e: string): { entao: string; senao: string } | null => {
    let d = 0
    for (let i = 0; i < e.length; i++) {
      const c = e[i]
      if (c === '"' || c === "'" || c === "`") {
        const q = c
        let j = i + 1
        while (j < e.length) { if (e[j] === "\\") { j += 2; continue } if (e[j] === q) break; j++ }
        i = j
        continue
      }
      if ("([{".includes(c)) d++
      if (")]}".includes(c)) d--
      if (c === "?" && d === 0 && e[i + 1] !== "?" && e[i + 1] !== ".") {
        let dd = 0
        for (let j = i + 1; j < e.length; j++) {
          const k = e[j]
          if (k === '"' || k === "'" || k === "`") {
            const q = k
            let z = j + 1
            while (z < e.length) { if (e[z] === "\\") { z += 2; continue } if (e[z] === q) break; z++ }
            j = z
            continue
          }
          if ("([{".includes(k)) dd++
          if (")]}".includes(k)) dd--
          if (k === "?" && dd === 0) return null
          if (k === ":" && dd === 0) return { entao: e.slice(i + 1, j), senao: e.slice(j + 1) }
        }
      }
    }
    return null
  }

  const fatiaSoma = (e: string): string[] | null => {
    const partes: string[] = []
    let atual = ""
    let d = 0
    let achou = false
    for (let i = 0; i < e.length; i++) {
      const c = e[i]
      if (c === '"' || c === "'" || c === "`") {
        const q = c
        let j = i + 1
        while (j < e.length) { if (e[j] === "\\") { j += 2; continue } if (e[j] === q) break; j++ }
        atual += e.slice(i, j + 1)
        i = j
        continue
      }
      if ("([{".includes(c)) d++
      if (")]}".includes(c)) d--
      if (c === "+" && d === 0) { partes.push(atual); atual = ""; achou = true; continue }
      atual += c
    }
    partes.push(atual)
    return achou ? partes.map((p) => p.trim()) : null
  }

  /** Uma expressão de select → as strings POSSÍVEIS (ternário devolve mais de uma). */
  const comoStrings = (arquivo: string, expr: string, prof = 0): string[] | null => {
    const e = limpar(expr)
    if (prof > 8 || !e) return null

    if (e.startsWith("(")) {
      const dentro = argumentoEm(e, 0)
      if (dentro && dentro.fim === e.length - 1) return comoStrings(arquivo, dentro.texto, prof + 1)
    }

    // `[\s\S]` e não `.` com a flag `s`: o target do tsconfig é anterior a es2018.
    const lit = e.match(/^(["'])((?:[^\\]|\\[\s\S])*?)\1$/)
    if (lit) return [lit[2].replace(/\\(.)/g, "$1")]

    const tern = fatiaTernaria(e)
    if (tern) {
      const a = comoStrings(arquivo, tern.entao, prof + 1)
      const b = comoStrings(arquivo, tern.senao, prof + 1)
      return a && b ? [...a, ...b] : null
    }

    if (e.startsWith("`") && e.endsWith("`")) {
      let saidas = [""]
      const corpo = e.slice(1, -1)
      let i = 0
      while (i < corpo.length) {
        const abre = corpo.indexOf("${", i)
        if (abre === -1) { const fixo = corpo.slice(i); saidas = saidas.map((s) => s + fixo); break }
        const fixo = corpo.slice(i, abre)
        saidas = saidas.map((s) => s + fixo)
        let d = 1
        let j = abre + 2
        while (j < corpo.length && d > 0) { if (corpo[j] === "{") d++; else if (corpo[j] === "}") d--; j++ }
        const dentro = comoStrings(arquivo, corpo.slice(abre + 2, j - 1), prof + 1)
        if (!dentro) return null
        saidas = saidas.flatMap((s) => dentro.map((v) => s + v))
        i = j
      }
      return saidas
    }

    const soma = fatiaSoma(e)
    if (soma) {
      const partes = soma.map((p) => comoStrings(arquivo, p, prof + 1))
      if (partes.some((p) => p == null)) return null
      return (partes as string[][]).reduce<string[]>((acc, p) => acc.flatMap((a) => p.map((v) => a + v)), [""])
    }

    const jn = e.match(/^([\s\S]+)\.join\s*\(/)
    if (jn) {
      const abre = e.indexOf("(", jn[1].length)
      const arg = argumentoEm(e, abre)
      if (arg && arg.fim === e.length - 1) {
        const sep = arg.texto.trim() ? comoStrings(arquivo, arg.texto, prof + 1) : [","]
        const arr = comoArray(arquivo, jn[1], prof + 1)
        if (arr && sep) return sep.map((s) => arr.join(s))
      }
    }

    if (/^[A-Za-z_$][\w$]*$/.test(e)) {
      const onde = ondeDeclara(arquivo, e)
      const src = onde && fonte(onde)
      const ini = src ? inicializador(src, e) : null
      if (onde && ini) return comoStrings(onde, ini, prof + 1)
    }
    return null
  }

  const comoArray = (arquivo: string, expr: string, prof = 0): string[] | null => {
    const e = limpar(expr)
    if (prof > 8) return null
    if (e.startsWith("[") && e.endsWith("]")) {
      const out: string[] = []
      for (const item of fatiarNivelZero(e.slice(1, -1))) {
        if (item.startsWith("...")) {
          const sub = comoArray(arquivo, item.slice(3), prof + 1)
          if (!sub) return null
          out.push(...sub)
          continue
        }
        const s = comoStrings(arquivo, item, prof + 1)
        if (!s || s.length !== 1) return null
        out.push(s[0])
      }
      return out
    }
    if (/^Object\.keys\s*\(/.test(e)) {
      const arg = argumentoEm(e, e.indexOf("("))
      if (arg) {
        const chaves = chavesDoObjeto(arquivo, arg.texto, prof + 1)
        if (chaves) return chaves
      }
    }
    if (/^[A-Za-z_$][\w$]*$/.test(e)) {
      const onde = ondeDeclara(arquivo, e)
      const src = onde && fonte(onde)
      const ini = src ? inicializador(src, e) : null
      if (onde && ini) return comoArray(onde, ini, prof + 1)
    }
    return null
  }

  const chavesDoObjeto = (arquivo: string, expr: string, prof = 0): string[] | null => {
    const e = limpar(expr)
    if (prof > 8) return null
    if (e.startsWith("{") && e.endsWith("}")) {
      const out: string[] = []
      for (const par of fatiarNivelZero(e.slice(1, -1))) {
        const k = par.match(/^\s*(?:(["'])([^"']+)\1|([A-Za-z_$][\w$]*))\s*:/)
        if (!k) return null
        out.push((k[2] ?? k[3])!)
      }
      return out
    }
    if (/^[A-Za-z_$][\w$]*$/.test(e)) {
      const onde = ondeDeclara(arquivo, e)
      const src = onde && fonte(onde)
      const ini = src ? inicializador(src, e) : null
      if (onde && ini) return chavesDoObjeto(onde, ini, prof + 1)
    }
    return null
  }

  return { fonte, comoStrings, comoArray, chavesDoObjeto }
}

const linhaDe = (src: string, idx: number) => src.slice(0, idx).split("\n").length
const resumir = (s: string) => s.replace(/\s+/g, " ").trim().slice(0, 70)

/**
 * Varre `arquivos` atrás de TODA referência a coluna de `works_owner`.
 *
 * O universo é o TOKEN, não uma lista de formas: cada ocorrência fora de comentário precisa
 * cair num balde conhecido, e o que sobrar volta em `naoClassificados` com arquivo:linha.
 */
export function varrerWorksOwner(arquivos: string[], ler: Ler): Varredura {
  const { fonte, comoStrings, chavesDoObjeto } = criarResolvedor(ler)
  const pedidos: Pedido[] = []
  const naoResolvidos: Pendencia[] = []
  const naoClassificados: Pendencia[] = []
  const declarados: Pendencia[] = []
  const locais = new Set<string>()
  let cadeias = 0

  for (const f of arquivos) {
    const bruto = ler(f)
    if (bruto == null || !bruto.includes("works_owner")) continue
    const src = fonte(f)!
    const linhasBrutas = bruto.split("\n")
    const classificadas = new Set<number>()

    /** `// works-owner-dinamico: <motivo>` na linha da leitura ou nas 3 acima. */
    const declaradoPerto = (linha: number) =>
      linhasBrutas.slice(Math.max(0, linha - 4), linha).some((l) => l.includes("works-owner-dinamico:"))

    const registrar = (idx: number, linha: number, via: string, colunas: string[]) => {
      locais.add(`${f}:${linha}`)
      for (const c of colunas) pedidos.push({ arquivo: f, linha, coluna: c, via })
      classificadas.add(idx)
    }
    const pendente = (idx: number, linha: number, motivo: string) => {
      classificadas.add(idx)
      locais.add(`${f}:${linha}`)
      if (declaradoPerto(linha)) declarados.push({ arquivo: f, linha, motivo })
      else naoResolvidos.push({ arquivo: f, linha, motivo })
    }

    // (A) cadeia `.from("works_owner").<metodo>(…)`
    for (const m of src.matchAll(/\.from\(\s*["'`]works_owner["'`]\s*\)/g)) {
      const idx = m.index! + m[0].indexOf("works_owner")
      const linha = linhaDe(src, idx)
      cadeias++
      const met = src.slice(m.index! + m[0].length).match(/^\s*\.(\w+)\s*\(/)
      if (!met) { pendente(idx, linha, "cadeia `.from()` sem método legível"); continue }
      const arg = argumentoEm(src, m.index! + m[0].length + met[0].length - 1)
      if (!arg) { pendente(idx, linha, `.${met[1]}() sem argumento legível`); continue }
      const primeiro = fatiarNivelZero(arg.texto)[0] ?? ""
      if (met[1] === "select") {
        const strings = comoStrings(f, primeiro)
        if (!strings) { pendente(idx, linha, `.select(${resumir(primeiro)})`); continue }
        registrar(idx, linha, ".select()", strings.flatMap(colunasDoSelect))
      } else if (met[1] === "update" || met[1] === "insert" || met[1] === "upsert") {
        const chaves = chavesDoObjeto(f, primeiro)
        if (!chaves) { pendente(idx, linha, `.${met[1]}(${resumir(primeiro)})`); continue }
        registrar(idx, linha, `.${met[1]}()`, chaves)
      } else {
        // `.delete()` e afins não nomeiam coluna — a cadeia está classificada e não pede nada.
        classificadas.add(idx)
      }
    }

    // (B) EMBED `works_owner!fk(…)` dentro do select de OUTRA tabela — nunca passa pelo `.from`
    for (const m of src.matchAll(/works_owner(?:!\w+)?\s*\(/g)) {
      const idx = m.index!
      if (classificadas.has(idx)) continue
      if (/\.from\(\s*["'`]$/.test(src.slice(Math.max(0, idx - 12), idx))) continue
      const linha = linhaDe(src, idx)
      const arg = argumentoEm(src, idx + m[0].length - 1)
      if (!arg) { pendente(idx, linha, "embed `works_owner(…)` ilegível"); continue }
      registrar(idx, linha, "embed", colunasDoSelect(arg.texto))
    }

    // (C) helper com a tabela no 1º argumento: `pageAll("works_owner", "id", …)`
    for (const m of src.matchAll(/([A-Za-z_$][\w$]*)\s*\(\s*(["'`])works_owner\2\s*,/g)) {
      const idx = m.index! + m[0].indexOf("works_owner")
      if (classificadas.has(idx)) continue
      const linha = linhaDe(src, idx)
      const arg = argumentoEm(src, m.index! + m[0].indexOf("("))
      if (!arg) { pendente(idx, linha, `${m[1]}("works_owner", …) ilegível`); continue }
      const cols = fatiarNivelZero(arg.texto)[1] ?? ""
      const strings = comoStrings(f, cols)
      if (!strings) { pendente(idx, linha, `${m[1]}("works_owner", ${resumir(cols)})`); continue }
      registrar(idx, linha, `${m[1]}()`, strings.flatMap(colunasDoSelect))
    }

    // O que sobrou: ou é consumo do RESULTADO, ou é forma nova — e forma nova reprova.
    for (const m of src.matchAll(/works_owner/g)) {
      const idx = m.index!
      if (classificadas.has(idx)) continue
      const antes = src.slice(Math.max(0, idx - 2), idx)
      const depois = src.slice(idx + "works_owner".length)
      if (antes.endsWith(".")) continue // r.works_owner — consumo do embed
      if (/^\s*[?]?\s*:/.test(depois)) continue // chave de tipo / de objeto
      naoClassificados.push({
        arquivo: f,
        linha: linhaDe(src, idx),
        motivo: resumir(src.slice(Math.max(0, idx - 30), idx + 40)),
      })
    }
  }

  return { pedidos, naoResolvidos, naoClassificados, declarados, locais: [...locais].sort(), cadeias }
}

// ─────────────────────────────────────────────────────────────────────────────
// A varredura do repositório
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ⚠️ `git ls-files` e não o disco: é o ÍNDICE que vira o commit, e arquivo não rastreado
 * (rascunho, cópia de sessão) contaminaria a contagem — a mesma armadilha de medir a suíte
 * em árvore suja.
 *
 * ⚠️ `tests/` fica de fora de propósito: nenhum teste consulta o banco, e este arquivo cita
 * `works_owner` dezenas de vezes em prosa e em SONDA — varrê-lo seria varrer a si mesmo.
 */
const RASTREADOS = execSync("git ls-files", { cwd: ROOT, encoding: "utf8" })
  .split("\n")
  .filter((f) => /\.(ts|tsx|mjs|js)$/.test(f) && !f.startsWith("tests/"))

const lerDoRepo: Ler = (rel) => {
  const p = join(ROOT, rel)
  return existsSync(p) ? readFileSync(p, "utf8") : null
}

const REPO = varrerWorksOwner(RASTREADOS, lerDoRepo)

/** Contagem INDEPENDENTE do `.from("works_owner")`, pra denunciar parser que ficou cego. */
const CADEIAS_CRUAS = RASTREADOS.reduce((n, f) => {
  const src = lerDoRepo(f)
  return n + (src ? src.split(/\.from\(\s*["'`]works_owner["'`]\s*\)/).length - 1 : 0)
}, 0)

describe("contrato de colunas da view works_owner", () => {
  it("a definição vigente é legível (senão o teste passa por vacuidade)", () => {
    expect(VIEW.arquivo).not.toBe("")
    expect(VIEW.colunas.length).toBeGreaterThan(40)
    expect(VIEW.colunas).toContain("id")
    expect(VIEW.colunas).toContain("user_score")
  })

  it("🔴 NÃO expõe `genres` — o array legado morreu na migration 024", () => {
    expect(VIEW.colunas).not.toContain("genres")
  })

  it("a varredura enxerga o repositório (contraprova de vacuidade)", () => {
    // Se o parser ficar cego, `pedidos` esvazia e TODO o resto passa sem checar nada.
    expect(REPO.locais.length).toBeGreaterThan(20) // 32 em 2026-08-19
    expect(REPO.pedidos.length).toBeGreaterThan(100) // 162
    // E a contagem do parser tem que bater com a contagem crua da MESMA coisa.
    expect(REPO.cadeias).toBe(CADEIAS_CRUAS)
  })

  it("🔴 toda ocorrência de `works_owner` é CLASSIFICADA — forma nova não passa calada", () => {
    expect(
      REPO.naoClassificados.map((u) => `${u.arquivo}:${u.linha} → ${u.motivo}`),
      "Apareceu uma forma de tocar `works_owner` que a varredura não conhece. Ela NÃO está " +
        "sendo checada contra a view — foi assim que o embed `works_owner!fk(…)` e o " +
        '`pageAll("works_owner", …)` ficaram fora por meses. Ensine a forma ao parser (balde ' +
        "A, B ou C de `varrerWorksOwner`) em vez de excluir a linha.",
    ).toEqual([])
  })

  it("🔴 toda leitura é RESOLVÍVEL — checar só o que se sabe parsear dá falso conforto", () => {
    expect(
      REPO.naoResolvidos.map((u) => `${u.arquivo}:${u.linha} → ${u.motivo}`),
      "Este select não pôde ser resolvido estaticamente, então as colunas dele NÃO foram " +
        "conferidas contra a view. Extraia a lista pra uma const legível, ou declare o motivo " +
        "na linha com `// works-owner-dinamico: <motivo medido>`.",
    ).toEqual([])
    // Exceção declarada não pode virar hábito: hoje são ZERO, e o número aparece aqui.
    expect(REPO.declarados.map((d) => `${d.arquivo}:${d.linha}`)).toEqual([])
  })

  it("🔴 nenhuma leitura pede coluna que a view não expõe", () => {
    const forasteiras = REPO.pedidos
      .filter((p) => !VIEW.colunas.includes(p.coluna))
      .map((p) => `${p.arquivo}:${p.linha} ${p.via} pede "${p.coluna}"`)
    expect(
      forasteiras,
      `A view (${VIEW.arquivo}) expõe ${VIEW.colunas.length} colunas e não expõe as acima. ` +
        `O PostgREST devolve erro no lugar de dado — e quem ignorar o \`error\` calcula sobre ` +
        `zero linhas, em silêncio.`,
    ).toEqual([])
  })

  it("🔴 a cobertura de gênero sai de `work_genres`, nunca de uma coluna da obra", () => {
    const src = readFileSync(join(ROOT, "server/queries/calibration-guards.ts"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "")
    expect(src).toMatch(/\.from\("work_genres"\)/)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Sondas: o parser precisa PEGAR o defeito real em cada forma, e não pode acusar
// o que está certo. Sem isto, "0 forasteiras" pode significar "não olhei".
// ─────────────────────────────────────────────────────────────────────────────

/** Roda a varredura sobre fontes sintéticas — o MESMO código que varre o repo. */
function sondar(arquivos: Record<string, string>) {
  return varrerWorksOwner(Object.keys(arquivos), (rel) => arquivos[rel] ?? null)
}
const pede = (v: Varredura, col: string) => v.pedidos.some((p) => p.coluna === col)

describe("a varredura PEGA a coluna dropada em cada forma de leitura", () => {
  it.each([
    ["literal simples", { "a.ts": `sb.from("works_owner").select("id, genres")` }],
    ["literal COM EMBED — o cego da regex antiga", {
      "a.ts": `sb.from("works_owner").select("id, work_covers(url, is_primary), genres")`,
    }],
    ["`.select(` na linha de baixo", { "a.ts": `sb\n  .from("works_owner")\n  .select(\n    "id, genres",\n  )` }],
    ["template com `${}`", { "a.ts": `const X = "genres"\nsb.from("works_owner").select(\`id, \${X}, title\`)` }],
    ["const local", { "a.ts": `const COLS = "id, genres"\nsb.from("works_owner").select(COLS)` }],
    ["ternário — os DOIS ramos rodam", {
      "a.ts": `const c = opts.countOnly ? "id" : "id, genres"\nsb.from("works_owner").select(c)`,
    }],
    ["const IMPORTADA de outro arquivo", {
      "a.ts": `import { C } from "@/lib/c"\nsb.from("works_owner").select(C)`,
      "lib/c.ts": `export const C = "id, genres"`,
    }],
    ["`[…].join()` com spread de `Object.keys` cross-file", {
      "a.ts": `import { F } from "@/lib/f"\nconst cols = ["id", ...F].join(", ")\nsb.from("works_owner").select(cols)`,
      "lib/f.ts": `import { W } from "@/lib/w"\nexport const F = Object.keys(W) as Campo[]`,
      "lib/w.ts": `export const W = { genres: 1, title: 2 } as const`,
    }],
    ["EMBED a partir de OUTRA tabela", {
      "a.ts": `sb.from("synopsis_quality_predictions").select("predicted_quality, works_owner!work_id(genres)")`,
    }],
    ["helper com a tabela no 1º argumento", { "a.mjs": `const r = await pageAll('works_owner', 'genres', (q) => q)` }],
    ["`.update({…})` — escrever coluna que não existe falha igual", {
      "a.ts": `sb.from("works_owner").update({ genres: [] }).eq("id", x)`,
    }],
  ])("%s", (_nome, arquivos) => {
    const v = sondar(arquivos as Record<string, string>)
    expect(pede(v, "genres")).toBe(true)
    expect(v.naoResolvidos).toEqual([])
    expect(v.naoClassificados).toEqual([])
  })
})

describe("a varredura NÃO acusa o que está certo", () => {
  it("coluna de EMBED é de outra tabela — não é cobrada desta view", () => {
    const v = sondar({ "a.ts": `sb.from("works_owner").select("id, calculated_scores(expected_score, calc_score)")` })
    expect(v.pedidos.map((p) => p.coluna)).toEqual(["id"])
  })

  it("apelido `alias:coluna` é lido pela COLUNA", () => {
    const v = sondar({ "a.ts": `sb.from("works_owner").select("nota:user_score")` })
    expect(v.pedidos.map((p) => p.coluna)).toEqual(["user_score"])
  })

  it("menção em COMENTÁRIO não é leitura", () => {
    const v = sondar({ "a.ts": `// works_owner.genres morreu na 024\nsb.from("works_owner").select("id")` })
    expect(pede(v, "genres")).toBe(false)
    expect(v.naoClassificados).toEqual([])
  })

  it("🔴 regex com aspas não dessincroniza o resto do arquivo", () => {
    // Sem conhecer regex literal, o `["']` abre uma string falsa e tudo abaixo some da varredura.
    const v = sondar({
      "a.ts": `const v = s.replace(/^["']|["']$/g, "")\nsb.from("works_owner").select("id, genres")`,
    })
    expect(pede(v, "genres")).toBe(true)
  })
})

describe("o que a varredura não sabe ler, ela DENUNCIA", () => {
  it("select montado em runtime é reportado, nunca pulado", () => {
    const v = sondar({ "a.ts": `sb.from("works_owner").select(montaColunas(opts))` })
    expect(v.naoResolvidos).toHaveLength(1)
    expect(v.naoResolvidos[0].motivo).toContain("montaColunas")
  })

  it("com `// works-owner-dinamico:` ele sai do vermelho mas fica CONTADO", () => {
    const v = sondar({
      "a.ts": `// works-owner-dinamico: as colunas vêm da escolha do usuário\nsb.from("works_owner").select(montaColunas(opts))`,
    })
    expect(v.naoResolvidos).toEqual([])
    expect(v.declarados).toHaveLength(1)
  })

  it("🔴 forma NOVA de tocar a view não passa calada", () => {
    // O `.from(<variável>)` é o próximo buraco natural: o parser não o segue, então ele
    // precisa aparecer como não-classificado em vez de sumir.
    const v = sondar({ "a.ts": `const T = "works_owner"\nsb.from(T).select("genres")` })
    expect(v.naoClassificados).toHaveLength(1)
  })
})
