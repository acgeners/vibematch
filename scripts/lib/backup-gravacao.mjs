/**
 * Grava um backup e só o declara pronto depois de conferido — o pipeline do `backup-db.mjs`,
 * separado do Supabase para poder ser exercitado com leitores falsos
 * (`tests/unit/orchestration/backup-completo-ou-marcado.test.ts`).
 *
 * O contrato: a pasta é escrita como `<stamp>.incompleto/` e só RENOMEADA no fim — para
 * `<stamp>/` (completo) ou `<stamp>.sem-schema/` (dado conferido, schema ausente). Qualquer falha
 * deixa a `.incompleto` com `FALHA.json` dizendo a etapa e a tabela. Régua dos estados:
 * `lib/backup-integridade.mjs`.
 */
import fs from "node:fs"
import path from "node:path"
import zlib from "node:zlib"
import {
  FORMATO,
  MANIFESTO,
  SUFIXO_SEM_SCHEMA,
  SUFIXO_TABELA_PARCIAL,
  conferirConteudo,
  registrarFalha,
} from "./backup-integridade.mjs"

/**
 * Escreve as páginas num NDJSON gzipado e confere a contagem. Devolve `{ rows, bytes }`.
 *
 * 🔴 Em 18/10 uma queda de rede no meio de `work_embeddings` deixou o gzip aberto e truncado, com
 * o nome de um arquivo bom. Aqui, qualquer falha (leitura, escrita ou contagem) fecha os streams e
 * renomeia o arquivo para `.parcial`: o que foi lido fica para diagnóstico, sem poder ser tomado
 * pela tabela inteira.
 *
 * @param {string} arquivo
 * @param {AsyncIterable<object[]>} paginas
 * @param {{ esperado?: number, rotulo?: string }} [opcoes]
 */
export async function escreverNdjsonGz(arquivo, paginas, { esperado, rotulo = path.basename(arquivo) } = {}) {
  const gzip = zlib.createGzip()
  const out = fs.createWriteStream(arquivo)
  gzip.pipe(out)
  let escritas = 0
  try {
    for await (const pagina of paginas) {
      for (const linha of pagina) gzip.write(JSON.stringify(linha) + "\n")
      escritas += pagina.length
    }
    await new Promise((res, rej) => {
      out.on("finish", res)
      out.on("error", rej)
      gzip.on("error", rej)
      gzip.end()
    })
    // A conferência que torna o backup confiável. Sem ela, truncar não daria erro.
    // ⚠️ `escritas > esperado` é corrida numa tabela viva (ex.: ai_api_calls ganhando linha durante
    // o dump), não truncamento — repetir resolve. `escritas < esperado` é o que ela existe pra pegar.
    if (esperado != null && escritas !== esperado) {
      throw new Error(`${rotulo}: BACKUP INCOMPLETO — ${escritas} linhas gravadas, ${esperado} no banco`)
    }
  } catch (e) {
    gzip.destroy()
    out.destroy()
    if (!out.closed) await new Promise((res) => out.once("close", res))
    if (fs.existsSync(arquivo)) fs.renameSync(arquivo, arquivo + SUFIXO_TABELA_PARCIAL)
    throw e
  }
  return { rows: escritas, bytes: fs.statSync(arquivo).size }
}

/**
 * Despeja as tabelas em `dir` (a pasta `.incompleto`, já criada), salva o schema, confere tudo no
 * disco e renomeia. Nunca lança: devolve o desfecho para quem chamou decidir o código de saída.
 *
 *   despejar(tabela, dir) → { table, rows, bytes }   (lança em qualquer falha)
 *   salvarSchema(dir)     → { status: "ok", bytes, … } | { status: "ausente", motivo }
 *
 * Desfechos: completo · sem-schema · vazio (zero linhas: a pasta desta execução é removida, não
 * há dado nenhum nela) · falhou (a pasta fica `.incompleto` com FALHA.json).
 */
export async function gravarBackup({ dir, destinoFinal, tabelas, despejar, salvarSchema, project, log = () => {} }) {
  const manifest = []
  let totalRows = 0
  let totalBytes = 0
  let etapa = "tabelas"
  let tabela = null
  try {
    for (const t of tabelas) {
      tabela = t
      const r = await despejar(t, dir)
      manifest.push(r)
      totalRows += r.rows
      totalBytes += r.bytes
      if (r.rows > 0) {
        log(`  ${t.padEnd(34)} ${String(r.rows).padStart(7)} linhas  ${(r.bytes / 1024).toFixed(0).padStart(6)} KB`)
      }
    }
    tabela = null

    // 🔴 FAIL-CLOSED: backup que não trouxe linha nenhuma não é backup — é falha de acesso.
    if (totalRows === 0) {
      fs.rmSync(dir, { recursive: true, force: true })
      return { estado: "vazio", tabelas: tabelas.length }
    }

    etapa = "schema"
    const schema = salvarSchema(dir)

    // Relê do disco o que ficou gravado: cada tabela descompactada e contada, e o schema.
    etapa = "conferência"
    const problemas = await conferirConteudo(dir, manifest, { schema: schema.status === "ok" })
    if (problemas.length) {
      throw new Error(`conferência no disco falhou: ${problemas.slice(0, 5).join("; ")}` +
        (problemas.length > 5 ? ` (+${problemas.length - 5})` : ""))
    }

    etapa = "manifesto"
    const status = schema.status === "ok" ? "completo" : "sem-schema"
    const agora = new Date().toISOString()
    fs.writeFileSync(
      path.join(dir, MANIFESTO),
      JSON.stringify(
        {
          formato: FORMATO,
          status,
          takenAt: agora,
          project,
          tables: manifest,
          totalRows,
          schema,
          conferencia: { em: agora, tabelas: manifest.length, linhas: totalRows },
        },
        null,
        2,
      ),
    )

    // O ponto de commit: só depois daqui a pasta tem nome de backup. Renomear na mesma pasta é
    // atômico — não existe instante em que `<stamp>/` exista pela metade.
    etapa = "finalização"
    const destino = status === "completo" ? destinoFinal : destinoFinal + SUFIXO_SEM_SCHEMA
    fs.renameSync(dir, destino)
    return { estado: status, dir: destino, totalRows, totalBytes, tabelas: manifest.length, schema }
  } catch (e) {
    const erro = String(e?.message ?? e)
    registrarFalha(dir, { etapa, tabela, erro })
    return { estado: "falhou", dir, etapa, tabela, erro }
  }
}
