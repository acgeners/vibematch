/**
 * Ordem TOTAL para paginar o backup — dono da regra que `scripts/backup-db.mjs` usa.
 *
 * 🔴 `.range()` sem `.order()` NÃO é paginação: o Postgres não promete a mesma ordem entre duas
 * consultas, então a página 2 pode repetir linhas da 1 e pular outras. Medido na nuvem em
 * 2026-09-21: 2.050 linhas lidas em 3 páginas viraram só **1.550 únicas**. No backup isso é
 * MUDO — a conferência do script compara CONTAGEM, e repetidas compensando perdidas fecham a
 * conta. Seria um backup que passa na guarda e não restaura o que promete.
 *
 * A ordem é a CHAVE PRIMÁRIA de cada tabela, lida do mesmo OpenAPI do PostgREST de onde o
 * script já tira a lista de tabelas: o PostgREST marca cada coluna de PK com `<pk/>` na
 * descrição. Conferido contra `pg_constraint` em 2026-10-09: bate nas 69 tabelas com chave
 * (61 PK simples, 8 compostas — 7 das simples NÃO se chamam `id`), e nas 2 views o PostgREST
 * infere a chave da tabela base. Derivar daqui, e não de uma lista escrita à mão, é o que faz
 * tabela nova entrar com a ordem certa sem ninguém lembrar.
 *
 * ⚠️ PK é ordem total por definição (única e NOT NULL). PK composta entra com TODAS as colunas:
 * em `work_tags` o `work_id` se repete, e só o `tag_id` desempata.
 */

/** Marca que o PostgREST põe na descrição de cada coluna de chave primária. */
export const PK_MARKER = "<pk/>"

/** As colunas de PK de uma definição do OpenAPI (vazio quando a relação não tem chave). */
export function chavePrimaria(definicao) {
  const props = definicao?.properties ?? {}
  return Object.keys(props).filter((coluna) => (props[coluna]?.description ?? "").includes(PK_MARKER))
}

/**
 * A ordem com que a tabela vai ser paginada.
 *
 * Sem chave primária só existe um caso seguro: a tabela inteira cabe em UMA página — aí não há
 * paginação e a ordem não importa. Hoje são 9 relações assim (snapshots e staging antigos, máx.
 * 882 linhas). Passou de uma página sem chave ⇒ FALHA: o resto do script já prefere abortar a
 * gravar um backup que mente, e esta é a mesma régua.
 */
export function ordemDePaginacao(tabela, definicao, total, pagina) {
  const pk = chavePrimaria(definicao)
  if (pk.length > 0) return pk
  if ((total ?? 0) <= pagina) return []
  throw new Error(
    `${tabela}: sem chave primária e com ${total} linhas (> ${pagina}, mais de uma página) — ` +
      `paginar sem ordem total pode repetir e perder linhas sem mudar a contagem. Dê uma PK à ` +
      `tabela. (Se TODAS as tabelas grandes falharem assim, o OpenAPI do PostgREST deixou de ` +
      `marcar \`${PK_MARKER}\`.)`,
  )
}

/**
 * Lê a relação inteira, página por página, com a ordem aplicada ANTES do `.range()`.
 * `construir()` devolve um builder novo a cada página (`sb.from(t).select("*")`).
 */
export async function* paginasOrdenadas(construir, ordem, pagina, rotulo) {
  for (let from = 0; ; from += pagina) {
    let consulta = construir()
    for (const coluna of ordem) consulta = consulta.order(coluna, { ascending: true })
    const { data, error } = await consulta.range(from, from + pagina - 1)
    if (error) throw new Error(`${rotulo}: página ${from} falhou — ${error.message}`)
    if (!data?.length) return
    yield data
    if (data.length < pagina) return
  }
}
