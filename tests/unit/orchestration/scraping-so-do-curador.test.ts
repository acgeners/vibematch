import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { PERMISSIONS, type Role } from "@/lib/plans/roles"

/**
 * Invariante de PRODUTO, e ela custa dinheiro se quebrar.
 *
 * Produção não tem sidecar nem FlareSolverr — decisão de 2026-08-04, tomada depois de medir que
 * pagá-los custaria US$11–17/mês. Em troca, TODA ação que raspa fonte externa passou a ser do
 * CURADOR, que roda no Mac onde o bypass é grátis, e empurra o resultado pelos scripts de push.
 *
 * O que este arquivo impede: alguém baixar o gate de uma ação que raspa. O sintoma não seria erro
 * nenhum — a ação roda em produção, colhe 6 das 9 fontes (ComicK, Mangago e Comix ficam atrás do
 * Cloudflare) e grava dado pobre por cima de dado bom, em silêncio. Foi exatamente assim que
 * `autoRefreshWorkData` ficou liberada pra assinante sem ninguém notar.
 *
 * Trava o PAPEL EFETIVO, não a grafia do gate: `ensureAdmin()` e `ensurePermission("refresh_work")`
 * são a mesma coisa aqui, e travar o nome faria o teste reprovar uma refatoração legítima.
 */

/**
 * SEMENTE: entradas da camada externa que de fato disparam rede para as fontes.
 *
 * ⚠️ Sozinha ela varre de MENOS, e a 1ª versão deste teste passou verde por isso: achou só as 4
 * actions de `external.ts`, porque `ai.ts` e `enrich.ts` chamam a camada externa por helpers
 * LOCAIS (`resolveEvaluationContext`) e `works.ts` chama outras actions. Por isso a semente vira
 * ponto fixo abaixo — quem chama quem raspa, raspa também.
 */
const RASPAM_SEMENTE = [
  "searchAllSources",
  "searchAllSourcesWithStatus",
  "fetchMultiSourceDetails",
  "fetchExternalEvaluationContextForWork",
  "fetchExternalEvaluationContextForCandidate",
  "fetchMangaUpdatesAlternativeTitles",
  "fetchComixById",
  "fetchMangagoById",
  "resolveComixUrl",
  "resolveMangagoUrlProd",
  "resolveMangagoForEvalContext",
  "acquireAndPersistWorkReviews",
  "buildAutoRefreshPlan",
]

/**
 * As exceções, cada uma com o motivo. Uma lista sem motivo vira depósito: o próximo a esbarrar no
 * teste acrescenta o nome dele e o teste morre.
 */
const EXCECOES: Record<string, { papel: Role; porque: string }> = {
  searchExternalTitles: {
    papel: "leitor",
    porque:
      "só LÊ, não grava. É o que permite ao leitor achar e escolher a obra ao cadastrar o que " +
      "falta no catálogo. Segura em par com LIMITE DE TAXA — ver a asserção específica abaixo.",
  },
  createWork: {
    papel: "leitor",
    porque:
      "cadastrar obra que falta é do leitor por decisão de produto. A obra nasce incompleta e " +
      "entra na fila do curador (`ai_eval_status='pending'`); quem enriquece é ele, local.",
  },
}

/**
 * ⚠️ `createWorkPending` NÃO está aqui de propósito: conferido, ela não raspa (a aquisição do
 * caminho de importação acontece no `finalizePendingBatch`, que é do curador). Exceção que não
 * corresponde a nada detectado é pior que ausente — ela perdoaria em silêncio o dia em que a
 * função PASSASSE a raspar.
 */

const ARQUIVOS = [
  "server/actions/external.ts",
  "server/actions/works.ts",
  "server/actions/ai.ts",
  "server/actions/enrich.ts",
]

const semComentarios = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")

/**
 * Onde o CORPO começa — que não é "a primeira `{` depois do nome", nem "depois do primeiro `)`".
 * Parâmetro com objeto inline (`input: { title: string }`) e tipo de retorno com chaves
 * (`Promise<{ data?: X }>`) enganam as duas versões ingênuas. Mesma armadilha que
 * `leitores-por-sessao.test.ts` já documenta: fecha os parênteses CONTANDO, e depois só aceita `{`
 * fora de qualquer `<…>` de genérico (`=>` não conta como fechamento).
 */
function inicioDoCorpo(src: string, decl: number): number {
  let i = src.indexOf("(", decl)
  if (i < 0) return -1
  for (let nivel = 0; i < src.length; i++) {
    if (src[i] === "(") nivel++
    else if (src[i] === ")" && --nivel === 0) break
  }
  let angulo = 0
  for (i++; i < src.length; i++) {
    const c = src[i]
    if (c === "<") angulo++
    else if (c === ">" && src[i - 1] !== "=") angulo--
    else if (c === "{" && angulo === 0) return i
  }
  return -1
}

/**
 * Corpos das funções do arquivo, delimitados por contagem de chaves.
 * `exportadas: false` inclui os helpers locais — é por dentro deles que a chamada de rede escapa.
 */
function corpos(arquivo: string, exportadas = true): Map<string, string> {
  const src = semComentarios(readFileSync(join(process.cwd(), arquivo), "utf8"))
  const out = new Map<string, string>()
  const re = exportadas
    ? /export\s+async\s+function\s+([A-Za-z0-9_]+)/g
    : /(?:export\s+)?(?:async\s+)?function\s+([A-Za-z0-9_]+)/g
  for (let m = re.exec(src); m; m = re.exec(src)) {
    const abre = inicioDoCorpo(src, m.index)
    if (abre < 0) continue
    let nivel = 0
    for (let i = abre; i < src.length; i++) {
      if (src[i] === "{") nivel++
      else if (src[i] === "}" && --nivel === 0) {
        out.set(m[1], src.slice(abre, i + 1))
        break
      }
    }
  }
  return out
}

/** Papel mínimo exigido pelo gate encontrado no corpo — null quando não há gate. */
function papelExigido(corpo: string): Role | null {
  if (/ensureAdmin\s*\(/.test(corpo)) return "curador"
  const perm = /ensurePermission\s*\(\s*["']([a-z_]+)["']/.exec(corpo)
  if (perm) {
    const papel = (PERMISSIONS as Record<string, Role>)[perm[1]]
    expect(papel, `permissão desconhecida "${perm[1]}"`).toBeTruthy()
    return papel
  }
  return null
}

const chama = (corpo: string, nomes: Iterable<string>) =>
  [...nomes].some((fn) => new RegExp(`\\b${fn}\\s*\\(`).test(corpo))

describe("arquitetura: o que raspa fonte externa é do CURADOR", () => {
  // Ponto fixo: começa nas entradas de rede e cresce para quem as chama, direta ou
  // indiretamente, dentro dos arquivos varridos. Sem isto, um helper local esconde a chamada e
  // a action que o usa passa despercebida.
  const raspam = new Set(RASPAM_SEMENTE)
  const todosOsCorpos: Array<[string, string, string]> = []
  for (const arquivo of ARQUIVOS) {
    for (const [nome, corpo] of corpos(arquivo, false)) todosOsCorpos.push([arquivo, nome, corpo])
  }
  for (let mudou = true; mudou; ) {
    mudou = false
    for (const [, nome, corpo] of todosOsCorpos) {
      if (!raspam.has(nome) && chama(corpo, raspam)) {
        raspam.add(nome)
        mudou = true
      }
    }
  }

  const encontradas: Array<[string, string, string]> = []
  for (const arquivo of ARQUIVOS) {
    for (const [nome, corpo] of corpos(arquivo)) {
      if (raspam.has(nome) || chama(corpo, raspam)) encontradas.push([arquivo, nome, corpo])
    }
  }

  it("a varredura acha alguma coisa (senão o resto passa vazio)", () => {
    // Sem este controle, um erro de regex faria TODAS as asserções abaixo passarem sem existir —
    // suíte verde provando nada, que é o pior resultado possível num teste de arquitetura.
    expect(encontradas.length).toBeGreaterThan(3)
  })

  for (const [arquivo, nome, corpo] of encontradas) {
    it(`${nome} (${arquivo.split("/").pop()})`, () => {
      const excecao = EXCECOES[nome]
      const papel = papelExigido(corpo)
      expect(papel, `${nome} raspa fonte externa e não tem gate nenhum`).not.toBeNull()

      if (!excecao) {
        expect(
          papel,
          `${nome} raspa fonte externa: tem de exigir "curador". Se for exceção deliberada, ` +
            `declare em EXCECOES COM o motivo — produção não tem bypass, e rodar isto lá colhe ` +
            `6 das 9 fontes e grava dado pobre em silêncio.`,
        ).toBe("curador")
        return
      }
      expect(
        papel,
        `${nome} está em EXCECOES como "${excecao.papel}" mas o código exige "${papel}" — ` +
          `alinhe os dois. Motivo registrado: ${excecao.porque}`,
      ).toBe(excecao.papel)
    })
  }

  it("searchExternalTitles, por ser de leitor, é limitada por taxa", () => {
    // O gate baixo só é defensável junto com o limite: `"use server"` é endpoint PÚBLICO, e sem
    // teto isto vira proxy de scraping grátis — que é a razão pela qual ela era admin.
    const corpo = corpos("server/actions/external.ts").get("searchExternalTitles") ?? ""
    expect(corpo, "searchExternalTitles sem withinRateLimit").toMatch(/withinRateLimit\s*\(/)
    expect(corpo, "o limite tem de ser por USUÁRIO, não global").toMatch(/userId/)
  })
})
