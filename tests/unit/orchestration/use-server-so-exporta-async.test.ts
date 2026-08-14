import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"

/**
 * Arquivo `"use server"` só pode exportar FUNÇÃO ASYNC (e tipos).
 *
 * 🔴 É regra do Next, não convenção — e ela falha do pior jeito possível: uma
 * `export const` num arquivo de server actions derruba o MÓDULO INTEIRO em
 * runtime ("Only async functions are allowed to be exported in a 'use server'
 * file"), então todos os imports dele passam a não existir e a página responde
 * 500. Enquanto isso `npx tsc --noEmit` passa limpo e a suíte fica verde, porque
 * nada disso é erro de TIPO.
 *
 * Aconteceu em 2026-08-14 com `DIGEST_BATCH_MAX` em `review-digest-batch.ts`; só
 * apareceu ao abrir a página no browser. Este teste é o substituto barato de
 * "lembrar de abrir a página".
 *
 * ⚠️ Deriva a lista do FILESYSTEM (todo arquivo que começa com a diretiva), nunca
 * de uma lista fixa — senão o próximo arquivo de actions nasce fora da checagem,
 * que é exatamente como este tipo de rede envelhece.
 */

const RAIZ = process.cwd()
const PASTAS = ["server", "app", "lib", "components"]

function arquivosTs(dir: string, acc: string[] = []): string[] {
  for (const nome of readdirSync(dir)) {
    if (nome === "node_modules" || nome === ".next" || nome.startsWith(".")) continue
    const caminho = join(dir, nome)
    if (statSync(caminho).isDirectory()) arquivosTs(caminho, acc)
    else if (/\.tsx?$/.test(nome)) acc.push(caminho)
  }
  return acc
}

function ehUseServer(src: string): boolean {
  // A diretiva tem que ser a primeira instrução do arquivo; comentários antes são
  // permitidos, então corta-os pra achar a primeira linha de código.
  const semComentarios = src.replace(/^\s*(\/\*[\s\S]*?\*\/|\/\/[^\n]*)\s*/g, "")
  return /^["']use server["']/.test(semComentarios.trimStart())
}

describe('arquivos "use server" só exportam função async', () => {
  it("nenhum exporta const, let, var ou função síncrona", () => {
    const ofensores: string[] = []

    for (const pasta of PASTAS) {
      for (const caminho of arquivosTs(join(RAIZ, pasta))) {
        const src = readFileSync(caminho, "utf8")
        if (!ehUseServer(src)) continue

        const relativo = caminho.slice(RAIZ.length + 1)
        for (const [, palavra] of src.matchAll(/^export\s+(const|let|var|function)\s/gm)) {
          // `export function` síncrona também é recusada pelo Next; `export async
          // function` é a única forma válida de valor exportado.
          ofensores.push(`${relativo}: export ${palavra}`)
        }
      }
    }

    expect(
      ofensores,
      'mova a constante pra um módulo comum — arquivo "use server" só exporta função async (e tipos)',
    ).toEqual([])
  })
})
