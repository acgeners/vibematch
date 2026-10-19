/**
 * O que faz de uma pasta de `.backups/` um BACKUP — dono único da régua que o `backup-db.mjs`
 * aplica ao terminar e que a retenção aplica antes de contar.
 *
 * 🔴 Até 2026-10-19 a régua era o NOME. O `backup-db.mjs` criava `.backups/<stamp>/` antes da
 * primeira tabela, e em 18/10 uma queda de rede em `work_embeddings` (página 1000,
 * `TypeError: terminated`) deixou ali 68 tabelas, um gzip truncado e nenhum manifesto ou schema —
 * com o mesmo nome de um backup bom. A retenção ordenava por nome e mantinha "os 5 mais
 * recentes": no backup seguinte, essa pasta contaria entre as 5 e empurraria uma cópia válida
 * para a exclusão.
 *
 * Os quatro estados, e o que cada um deixa fazer:
 *
 *   completo     manifesto, tabelas (tamanho a tamanho) e schema conferem → restaurável; conta
 *                na retenção e é o único estado que ela pode apagar
 *   sem-schema   dados conferidos, schema ausente → útil, NÃO restaura sozinho; nunca conta
 *   incompleto   execução interrompida/falhou ou pasta não confere → só diagnóstico; nunca conta
 *   desconhecido manifesto num formato que esta régua não sabe ler → nunca conta
 *
 * Nenhum estado diferente de `completo` é apagado automaticamente.
 */
import fs from "node:fs"
import path from "node:path"
import zlib from "node:zlib"
import { pipeline } from "node:stream/promises"

/** Versão do manifesto que carrega o veredito (`status`). Manifesto sem `formato` é legado. */
export const FORMATO = 2
/** Pasta em andamento — e, se o processo morrer, pasta interrompida. */
export const SUFIXO_INCOMPLETO = ".incompleto"
/** Dados conferidos, schema não salvo. */
export const SUFIXO_SEM_SCHEMA = ".sem-schema"
/** Tabela cuja escrita foi interrompida (o gzip pode estar truncado). */
export const SUFIXO_TABELA_PARCIAL = ".parcial"
export const MANIFESTO = "manifest.json"
export const SCHEMA = "schema.sql.gz"
export const FALHA = "FALHA.json"

const arquivoDaTabela = (dir, tabela) => path.join(dir, `${tabela}.ndjson.gz`)

/**
 * Classificação ESTRUTURAL e barata (stat + JSON): é o que a retenção roda a cada execução.
 * Confere o que está no disco contra o manifesto — nunca o nome da pasta sozinho.
 *
 * Backup anterior ao marcador (manifesto sem `formato`) é classificado pelas mesmas provas: o
 * script antigo só escrevia o manifesto depois de TODAS as tabelas passarem na contagem, e
 * registrava o tamanho de cada arquivo já fechado. Sem manifesto ⇒ incompleto.
 */
export function classificarBackup(dir) {
  const r = (estado, motivo, extra = {}) => ({ estado, completo: estado === "completo", motivo, ...extra })

  if (path.basename(dir).endsWith(SUFIXO_INCOMPLETO)) {
    return r("incompleto", "pasta em andamento ou interrompida (sufixo .incompleto)")
  }
  const falha = path.join(dir, FALHA)
  if (fs.existsSync(falha)) {
    let f = {}
    try {
      f = JSON.parse(fs.readFileSync(falha, "utf8"))
    } catch {}
    return r("incompleto", `registrou falha${f.etapa ? ` na etapa ${f.etapa}` : ""}${f.tabela ? ` (${f.tabela})` : ""}`)
  }

  const manifesto = path.join(dir, MANIFESTO)
  if (!fs.existsSync(manifesto)) return r("incompleto", "sem manifest.json — a execução não chegou ao fim")
  let m
  try {
    m = JSON.parse(fs.readFileSync(manifesto, "utf8"))
  } catch {
    return r("incompleto", "manifest.json ilegível")
  }
  const legado = m.formato == null
  if (!legado && m.formato !== FORMATO) return r("desconhecido", `manifesto no formato ${m.formato}`)
  if (!Array.isArray(m.tables) || m.tables.length === 0) return r("incompleto", "manifest.json sem tabelas")

  let soma = 0
  for (const t of m.tables) {
    if (typeof t?.table !== "string" || typeof t.bytes !== "number" || typeof t.rows !== "number") {
      return r("desconhecido", "manifesto sem tabela/linhas/bytes por tabela")
    }
    const arquivo = arquivoDaTabela(dir, t.table)
    if (!fs.existsSync(arquivo)) return r("incompleto", `falta ${t.table}.ndjson.gz`)
    const tamanho = fs.statSync(arquivo).size
    if (tamanho !== t.bytes) {
      return r("incompleto", `${t.table}.ndjson.gz tem ${tamanho} bytes; o manifesto diz ${t.bytes}`)
    }
    soma += t.rows
  }
  if (soma === 0 || soma !== m.totalRows) {
    return r("incompleto", `manifesto soma ${soma} linhas e declara ${m.totalRows}`)
  }

  const schema = path.join(dir, SCHEMA)
  const bytesSchema = fs.existsSync(schema) ? fs.statSync(schema).size : 0
  const base = { legado, takenAt: m.takenAt, totalRows: m.totalRows, tabelas: m.tables.length }

  if (legado) {
    if (bytesSchema === 0) return r("sem-schema", "anterior ao marcador; dados conferem, sem schema.sql.gz", base)
    // O manifesto antigo não registrava o schema: sem tamanho para comparar, descompacta (~45 KB).
    try {
      zlib.gunzipSync(fs.readFileSync(schema))
    } catch {
      return r("incompleto", "anterior ao marcador; schema.sql.gz ilegível", base)
    }
    return r("completo", "anterior ao marcador; manifesto, tamanhos e schema conferem", base)
  }
  if (m.status === "sem-schema") return r("sem-schema", m.schema?.motivo ?? "schema não salvo", base)
  if (m.status !== "completo") return r("incompleto", `status "${m.status}" no manifesto`, base)
  if (bytesSchema === 0) return r("incompleto", "o manifesto afirma schema, mas schema.sql.gz não está na pasta", base)
  if (m.schema?.bytes !== bytesSchema) {
    return r("incompleto", `schema.sql.gz tem ${bytesSchema} bytes; o manifesto diz ${m.schema?.bytes}`, base)
  }
  return r("completo", "manifesto, tamanhos e schema conferem", base)
}

/** Quantas linhas (`\n`) um NDJSON gzipado tem. Gzip truncado/corrompido ⇒ rejeita. */
export async function contarLinhasGz(arquivo) {
  let linhas = 0
  await pipeline(fs.createReadStream(arquivo), zlib.createGunzip(), async function (fonte) {
    for await (const pedaco of fonte) {
      for (let i = pedaco.indexOf(10); i !== -1; i = pedaco.indexOf(10, i + 1)) linhas++
    }
  })
  return linhas
}

/**
 * Conferência PROFUNDA, rodada uma vez pelo `backup-db.mjs` antes de declarar o backup completo:
 * relê do disco cada tabela (descompactando inteira) e o schema. Prova o que FICOU gravado, não o
 * que o script acha que escreveu. Devolve a lista de problemas (vazia = confere).
 *
 * `JSON.stringify` escapa quebra de linha dentro de string, então cada `\n` cru é uma linha.
 */
export async function conferirConteudo(dir, tabelas, { schema = false } = {}) {
  const problemas = []
  for (const t of tabelas) {
    const arquivo = arquivoDaTabela(dir, t.table)
    if (!fs.existsSync(arquivo)) {
      problemas.push(`${t.table}: arquivo ausente`)
      continue
    }
    const tamanho = fs.statSync(arquivo).size
    if (tamanho !== t.bytes) problemas.push(`${t.table}: ${tamanho} bytes no disco, ${t.bytes} registrados`)
    try {
      const linhas = await contarLinhasGz(arquivo)
      if (linhas !== t.rows) problemas.push(`${t.table}: ${linhas} linhas no arquivo, ${t.rows} no banco`)
    } catch (e) {
      problemas.push(`${t.table}: gzip ilegível (${e.message})`)
    }
  }
  if (schema) {
    const arquivo = path.join(dir, SCHEMA)
    try {
      const sql = zlib.gunzipSync(fs.readFileSync(arquivo)).toString()
      if (!/CREATE TABLE/.test(sql)) problemas.push("schema.sql.gz sem nenhum CREATE TABLE")
    } catch (e) {
      problemas.push(`schema.sql.gz ilegível (${e.message})`)
    }
  }
  return problemas
}

/** Grava o motivo da falha na pasta interrompida. Best-effort: falhar aqui não pode mascarar a falha original. */
export function registrarFalha(dir, info) {
  try {
    if (!fs.existsSync(dir)) return
    fs.writeFileSync(path.join(dir, FALHA), JSON.stringify({ em: new Date().toISOString(), ...info }, null, 2))
  } catch {}
}
