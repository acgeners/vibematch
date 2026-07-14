/**
 * 🔴 GUARDA: nenhum nome de status PESSOAL pode ser escrito à mão no código.
 *
 * Este teste existe porque renomear "Completed" → "Finished" no Supabase quebrou 10 lugares e o
 * TypeScript só pegou 6. Os outros eram strings soltas dentro de `new Set([...])` / arrays — o TS
 * não tipa isso, então elas PARAM DE CASAR em silêncio. As 74 obras terminadas deixaram de pedir
 * as 8 notas pós-leitura, de sumir do ranking e de sair da fila de Interesse. Sem um único erro.
 *
 * Depois da varredura, mais dois mapas MORTOS apareceram, e ninguém tinha notado:
 *   · a cor do status no gráfico do dashboard (entrada "Completed" → as 74 obras sem cor)
 *   · a descrição PT do status (entrada "Paused", um status que nunca existiu)
 *
 * Se este teste ficar vermelho: não troque o nome — pergunte o CONCEITO
 * (`isTerminalPersonalStatus`, `UNREAD_PERSONAL_STATUSES`, `DEFAULT_PERSONAL_STATUS`…), ou, quando
 * a referência a UM status for inevitável (a seção "Em hiato" da /leitura), use
 * `personalStatusNameBySlugOrThrow` — que estoura alto em vez de falhar calado.
 */
import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join, relative } from "node:path"
import { PERSONAL_STATUSES, PUBLICATION_STATUSES } from "@/types/domain"

const ROOT = process.cwd()
const DIRS = ["app", "components", "server", "lib"]

/**
 * Onde o nome PODE aparecer:
 *  · os arquivos GERADOS (são a fonte — é de lá que os nomes saem)
 *  · lib/external/* — o vocabulário de status de PUBLICAÇÃO das fontes ("Hiatus", "Completed"),
 *    que é outro domínio e não tem relação com o status pessoal do usuário
 */
const ALLOW = [
  "lib/constants/criteria.ts",
  "lib/constants/tags.ts",
  "lib/constants/ui-labels.ts",
  "lib/import/normalizer.ts",
  "lib/import/mapper.ts",
  "types/domain.ts",
]
const ALLOW_DIRS = ["lib/external/"]

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (/\.tsx?$/.test(entry)) out.push(full)
  }
  return out
}

/**
 * Apaga o CONTEÚDO dos comentários preservando as quebras de linha — a história do bug está
 * contada neles, e citar o nome ali é legítimo. Preservar as linhas importa: a primeira versão
 * removia os comentários inteiros e reportava o número da linha ERRADO, mandando quem lesse a
 * falha pra um trecho que não tinha nada a ver.
 */
function maskComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, pre) => pre + " ".repeat(m.length - pre.length))
}

describe("🔴 nenhum nome de status pessoal escrito à mão", () => {
  it("os nomes só aparecem nos arquivos gerados e no vocabulário das fontes externas", () => {
    // "Hiatus" é status PESSOAL **e** de PUBLICAÇÃO. Um `data.publicationStatus === "Hiatus"` é
    // legítimo e não tem nada a ver com o status de leitura do usuário — checá-lo daria falso
    // positivo em 3 arquivos. Então o guarda cobre só os nomes EXCLUSIVOS do vocabulário pessoal.
    //
    // O buraco é conhecido e aceito: um "Hiatus" pessoal escrito à mão passaria. Em troca, o teste
    // não cria ruído — e um guarda que grita à toa é um guarda que alguém desliga.
    const pub = new Set<string>(PUBLICATION_STATUSES as readonly string[])
    const nomes = (PERSONAL_STATUSES as readonly string[]).filter((n) => !pub.has(n))
    const ofensores: string[] = []

    for (const dir of DIRS) {
      for (const file of walk(join(ROOT, dir))) {
        const rel = relative(ROOT, file)
        if (ALLOW.includes(rel) || ALLOW_DIRS.some((d) => rel.startsWith(d))) continue

        const src = maskComments(readFileSync(file, "utf8"))
        for (const nome of nomes) {
          // Só status PESSOAL: "Hiatus" e "Completed" também são de publicação, e ali são legítimos.
          // Por isso a checagem é por nome exato entre aspas, e `lib/external/` está liberado.
          src.split("\n").forEach((linha, i) => {
            if (linha.includes(`"${nome}"`)) ofensores.push(`${rel}:${i + 1} → "${nome}"`)
          })
        }
      }
    }

    expect(
      ofensores,
      `Nome de status pessoal escrito à mão. O nome mora no Supabase e JÁ mudou uma vez — ` +
        `pergunte o conceito (isTerminalPersonalStatus, UNREAD_PERSONAL_STATUSES, ` +
        `DEFAULT_PERSONAL_STATUS…) ou use personalStatusNameBySlugOrThrow.\n\n` +
        ofensores.join("\n"),
    ).toEqual([])
  })
})
