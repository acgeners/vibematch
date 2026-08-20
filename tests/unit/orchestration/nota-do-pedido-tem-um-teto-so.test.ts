import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, it, expect } from "vitest"
import { CURATION_NOTE_MAX } from "@/server/queries/curation-requests"

/**
 * 🔴 O teto da nota do leitor é UM fato afirmado em DOIS lugares — o check
 * `curation_requests_note_tamanho` (banco) e `CURATION_NOTE_MAX` (contador da tela + recusa da
 * action). É a classe de erro mais cara deste projeto, e aqui ela tem uma forma particularmente
 * ruim: se o número da tela ficar MAIOR, a pessoa escreve o parágrafo inteiro, clica em enviar e
 * recebe "não consegui registrar o pedido" — o texto se perde e nada explica por quê.
 *
 * Como não dá para o banco importar a constante, o teste DERIVA o número da migration mais
 * recente que define o check. Migration nova que mexa no teto entra na checagem sozinha; uma
 * lista fixa de nomes não acharia a próxima.
 */

const MIGRATIONS = join(process.cwd(), "supabase", "migrations")

/** A migration VIGENTE do check é a de maior número que o declara — nunca uma citada por nome. */
function tetoDeclaradoNaMigration(): { arquivo: string; teto: number } {
  const candidatas = readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .reverse()

  for (const arquivo of candidatas) {
    const sql = readFileSync(join(MIGRATIONS, arquivo), "utf8")
    // Só o `add constraint` conta: a mesma migration traz um `drop constraint if exists` com o
    // mesmo nome, e casar o drop leria o teto de uma declaração que está sendo desfeita.
    const m = sql.match(
      /add\s+constraint\s+curation_requests_note_tamanho[\s\S]{0,400}?between\s+1\s+and\s+(\d+)/i,
    )
    if (m) return { arquivo, teto: Number(m[1]) }
  }
  throw new Error("nenhuma migration declara o check curation_requests_note_tamanho")
}

describe("o teto da nota do pedido", () => {
  it("a constante do app é o número que o BANCO recusa", () => {
    const { arquivo, teto } = tetoDeclaradoNaMigration()
    expect(
      CURATION_NOTE_MAX,
      `CURATION_NOTE_MAX diverge do check em ${arquivo} — a tela prometeria um limite que o banco recusa`,
    ).toBe(teto)
  })

  it("o piso do check é 1 — nota em branco é `null`, nunca string vazia", () => {
    const { arquivo } = tetoDeclaradoNaMigration()
    const sql = readFileSync(join(MIGRATIONS, arquivo), "utf8")
    // Sem o piso, `note = ''` passaria: a UI decide "tem nota?" por `is not null` e desenharia
    // um balão de citação sem citação nenhuma, na fila do curador.
    expect(sql).toMatch(/between\s+1\s+and/i)
  })

  it("`report_error` sem nota é recusado pelo BANCO, não só pela action", () => {
    const sql = readdirSync(MIGRATIONS)
      .filter((f) => f.endsWith(".sql"))
      .map((f) => readFileSync(join(MIGRATIONS, f), "utf8"))
      .join("\n")
    // A action é `"use server"`, ou seja endpoint HTTP público: a validação dela é mensagem
    // legível, não garantia ([[project_use_server_public_endpoints]]).
    expect(sql).toMatch(/add\s+constraint\s+curation_requests_erro_tem_nota/i)
  })

  it("🔴 a unicidade de `report_error` inclui a NOTA", () => {
    const sql = readdirSync(MIGRATIONS)
      .filter((f) => f.endsWith(".sql"))
      .map((f) => readFileSync(join(MIGRATIONS, f), "utf8"))
      .join("\n")

    // Sob a chave `(user_id, work_id, kind)` da 177, o SEGUNDO erro relatado na mesma obra —
    // texto DIFERENTE — bateria no unique, e a action trata 23505 como SUCESSO. A pessoa veria
    // "pedido enviado" e o texto não existiria em lugar nenhum: sem erro e sem log.
    const idx = sql.match(
      /create\s+unique\s+index[^;]*?curation_requests_erro_aberto_idx[^;]*?;/i,
    )?.[0]
    expect(idx, "índice único próprio do report_error não existe").toBeTruthy()
    expect(idx, "a chave precisa incluir a nota, senão o 2º relato é engolido").toMatch(/note/i)

    // E o índice antigo precisa EXCLUIR report_error, senão os dois brigam pela mesma linha.
    const antigo = sql.match(
      /create\s+unique\s+index[^;]*?curation_requests_aberto_por_obra_idx[^;]*?;/gi,
    )?.at(-1)
    expect(antigo).toMatch(/kind\s*<>\s*'report_error'/i)
  })
})
