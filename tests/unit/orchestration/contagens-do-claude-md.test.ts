import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { execSync } from "node:child_process"
import { join } from "node:path"

import { FAMILIAS } from "../../../scripts/lib/backups-retencao.mjs"
import { PAPEIS } from "../../../scripts/smoke-logado.mjs"

/**
 * As contagens do CLAUDE.md que GOVERNAM DECISÃO passam a ser derivadas do disco.
 *
 * 🔴 O levantamento de 21/08 (eixo C do "inventário dos PARES") mediu o tamanho do buraco:
 * o arquivo faz **103 afirmações de contagem** sobre artefatos deste repositório e **duas**
 * eram conferidas por teste — `rotas-de-sessao` (os prefixos do middleware) e
 * `scripts-apontam-pro-local` (a tabela de alvos). As outras envelhecem **sem nada acusar**,
 * que é a família "dois critérios pro mesmo fato" com um dos lados em markdown.
 *
 * O histórico do próprio arquivo é a evidência: "29 / 29" sobre 58 arquivos, "12 réguas"
 * sobre 13, "7 famílias" sobre 11, e a tabela de `SIGNED_IN_PREFIXES` errada DUAS vezes com
 * o aviso "isto já envelheceu" escrito logo abaixo dela. **Aviso em prosa não impede a
 * repetição** — o que impede é um lado derivar do outro.
 *
 * ⚠️ E foi medido de novo aqui: das 7 contagens deste arquivo, **duas já estavam erradas**
 * quando o teste nasceu — `makeUsdScale` (15 na prosa, 16 no disco) e `FAMILIAS` (11 × 14).
 * A das famílias é a mais didática: a própria linha manda *"não a repita aqui, leia o
 * `FAMILIAS`"* — e ela mesma repetiu, e defasou em 3.
 *
 * ── o que entra aqui, e o que NÃO entra ──────────────────────────────────────────────────
 *
 * O critério é **risco**, nunca "é derivável". A maioria das 103 é DESCRITIVA (medida de
 * tela, retrato de uma investigação, número histórico de um defeito já pago) e congelá-la
 * seria pintar a suíte de vermelho por mudança inocente.
 *
 * Entram as que satisfazem os três:
 *
 *   1. **governam decisão** — se estiverem erradas, alguém decide errado ou uma verificação
 *      promete cobertura que não tem;
 *   2. **derivam do disco** — o outro lado existe em código, não numa medição externa;
 *   3. **mudam RARO** — senão viram o alarme que sempre toca, e alarme que sempre toca não
 *      é lido (a mesma régua do `db:health` e do painel "Estado da obra").
 *
 * 🔴 O critério 3 é o que mantém a contagem de TESTES fora daqui, embora ela seja a que mais
 * envelhece neste arquivo (já teve ~28 valores diferentes). Ela muda a cada PR: um caso sobre
 * ela reprovaria toda mudança, e a saída barata para um vermelho constante é desligá-lo.
 */

const RAIZ = join(import.meta.dirname, "../../..")
const DOC = readFileSync(join(RAIZ, "CLAUDE.md"), "utf8")

const ler = (p: string) => readFileSync(join(RAIZ, p), "utf8")

/** Do GIT, não do disco: arquivo gitignored não é o que o repositório contém. */
const doGit = (dir: string) => execSync(`git ls-files ${dir}`, { cwd: RAIZ, encoding: "utf8" }).split("\n").filter(Boolean)

/* ------------------------------------------------------------------ */
/* As medições                                                        */
/* ------------------------------------------------------------------ */

/** Quantas entradas o array `ROTAS` do smoke de HTTP declara. */
function rotasDoSmokeHttp(): number {
  const src = ler("scripts/smoke-producao.mjs")
  const bloco = src.match(/const ROTAS = \[([\s\S]*?)\n\]/)?.[1] ?? ""
  return (bloco.match(/\brota:/g) ?? []).length
}

/**
 * O smoke de browser tem rotas FIXAS mais a página de obra, que entra por descoberta nas duas
 * formas da URL (slug e UUID). Contar só as fixas diria 3 e a prosa fala do total.
 */
function rotasDoSmokeBrowser(): number {
  const src = ler("scripts/smoke-browser.mjs")
  const fixas = (src.match(/const ROTAS_FIXAS = \[([\s\S]*?)\n\]/)?.[1].match(/\brota:/g) ?? []).length
  const descobertas = (src.match(/rotas\.push\(/g) ?? []).length
  return fixas + descobertas
}

/** Quantos alvos POSITIVOS (rotas que o papel deve alcançar) cada papel do smoke logado tem. */
function alvosDoSmokeLogado(): Record<string, number> {
  return Object.fromEntries(PAPEIS.map((p) => [p.id, p.alcanca.length]))
}

/** Toda `page.tsx` sob `app/` — o universo de rotas do app. */
function rotasDoApp(): string[] {
  return doGit("app").filter((p) => /\/page\.tsx$/.test(p))
}

/** Os prefixos que o middleware gateia, por lista. */
function prefixosGateados(): { console: string[]; sessao: string[] } {
  const src = ler("middleware.ts")
  const lista = (nome: string) =>
    [...(src.match(new RegExp(`const ${nome} = \\[([^\\]]*)\\]`))?.[1] ?? "").matchAll(/"([^"]+)"/g)].map((m) => m[1]!)
  return { console: lista("CONSOLE_PREFIXES"), sessao: lista("SIGNED_IN_PREFIXES") }
}

/** Quantas rotas do app caem atrás de um dado conjunto de prefixos. */
const gateadasPor = (prefixos: string[]) =>
  rotasDoApp().filter((p) => {
    const rota = "/" + p.replace(/^app\//, "").replace(/\/page\.tsx$/, "")
    return prefixos.some((pre) => rota === pre || rota.startsWith(`${pre}/`))
  }).length

/**
 * As RÉGUAS de dinheiro — o mesmo grep que a seção "Dinheiro tem UM dono" manda rodar antes de
 * mexer no número. Cada chamada é uma comparação lado a lado que precisa de UMA unidade só; o
 * número existe para que a próxima cópia não nasça sem ninguém decidir nada.
 */
function reguasDeDinheiro(): number {
  const out = execSync(
    `grep -rn 'makeUsdScale(' --include='*.ts' --include='*.tsx' . ` +
      `--exclude-dir=node_modules --exclude-dir=.next ` +
      `| grep -v 'lib/format/money.ts' | grep -v '^\\.\\?/\\?tests/' | wc -l`,
    { cwd: RAIZ, encoding: "utf8", shell: "/bin/bash" },
  )
  return Number(out.trim())
}

/** Scripts de correção que declaram o funil (o "nada a fazer" que prova que olhou). */
function scriptsComFunil(): number {
  return doGit("scripts").filter((p) => /^scripts\/[^/]+\.(ts|mjs|js)$/.test(p) && /criarFunil/.test(ler(p))).length
}

/* ------------------------------------------------------------------ */
/* A régua: cada contagem tem uma ÂNCORA na prosa                     */
/* ------------------------------------------------------------------ */

/**
 * ⚠️ O padrão casa a AFIRMAÇÃO, com uma âncora de vocabulário que não é acidental — nunca uma
 * linha inteira nem uma posição. Reescrever o texto ao redor não pode reprovar; o que reprova
 * é o NÚMERO divergir.
 *
 * 🔴 E âncora que não casa mais REPROVA, em vez de passar por vacuidade: é assim que esta rede
 * deixa de existir em silêncio. Se a frase for reescrita de propósito, o teste vem junto — é o
 * mesmo contrato de `rotas-de-sessao` ("a linha sumiu da tabela").
 */
type Contagem = {
  id: string
  /** Por que este número governa decisão — some na mensagem de erro. */
  porque: string
  padrao: RegExp
  medir: () => number
  onde: string
}

const CONTAGENS: Contagem[] = [
  {
    id: "smoke de HTTP: rotas",
    porque: "é a cobertura do que se verifica DEPOIS de publicar",
    padrao: /`scripts\/smoke-producao\.mjs`, que bate em \*\*(\d+) rotas\*\*/,
    medir: rotasDoSmokeHttp,
    onde: "o array ROTAS de scripts/smoke-producao.mjs",
  },
  {
    id: "smoke de browser: rotas",
    porque: "é a cobertura da família 'quebra depois da hidratação', invisível ao smoke de HTTP",
    padrao: /Carrega (\d+) rotas num/,
    medir: rotasDoSmokeBrowser,
    onde: "ROTAS_FIXAS + os rotas.push() de scripts/smoke-browser.mjs",
  },
  {
    id: "smoke logado: alvos do curador",
    porque: "é a metade LOGADA do app, que nenhum outro instrumento alcança",
    padrao: /\| \*\*alcança\*\* \|[^|]*\| (\d+) \(curador\)/,
    medir: () => alvosDoSmokeLogado().curador!,
    onde: "PAPEIS[curador].alcanca em scripts/smoke-logado.mjs",
  },
  {
    id: "smoke logado: alvos do leitor",
    porque: "idem — e o leitor é quem vê o painel de reportar erro",
    padrao: /\| \*\*alcança\*\* \|[^|]*\| \d+ \(curador\) \+ (\d+) \(leitor\)/,
    medir: () => alvosDoSmokeLogado().leitor!,
    onde: "PAPEIS[leitor].alcanca em scripts/smoke-logado.mjs",
  },
  {
    id: "rotas do app",
    porque: "é o denominador do argumento de cobertura do smoke logado",
    padrao: /o app tem \*\*(\d+) rotas\*\*/,
    medir: () => rotasDoApp().length,
    onde: "as page.tsx sob app/",
  },
  {
    id: "rotas gateadas",
    porque: "rota gateada nova sem instrumento é exatamente o buraco que o smoke logado fechou",
    padrao: /\*\*(\d+) gateadas\*\*/,
    medir: () => gateadasPor([...prefixosGateados().console, ...prefixosGateados().sessao]),
    onde: "as page.tsx sob CONSOLE_PREFIXES + SIGNED_IN_PREFIXES do middleware.ts",
  },
  {
    id: "réguas de dinheiro",
    porque: "uma cópia a mais é como duas telas voltam a discordar sobre o mesmo número",
    padrao: /\*\*Hoje são (\d+) réguas\*\*/,
    medir: reguasDeDinheiro,
    onde: "o grep de makeUsdScale( que a própria seção manda rodar",
  },
  {
    id: "famílias de retenção",
    porque: "família que não existe na lista grava em .backups sem dono e sem poda",
    padrao: /\*\*São (\d+) hoje\*\*/,
    medir: () => FAMILIAS.length,
    onde: "FAMILIAS em scripts/lib/backups-retencao.mjs",
  },
  {
    id: "scripts com funil",
    porque: "script de correção sem funil volta a dizer 'nada a fazer' sem provar que olhou",
    padrao: /Aplicado a \*\*(\d+) scripts\*\* de correção/,
    medir: scriptsComFunil,
    onde: "quem importa criarFunil em scripts/",
  },
]

describe(`as contagens do CLAUDE.md que governam decisão derivam do disco (hoje ${CONTAGENS.length})`, () => {
  for (const c of CONTAGENS) {
    it(`${c.id}: a prosa bate com o repositório`, () => {
      const medido = c.medir()

      // Sanidade: sem isto, um rename faria a medição virar 0 e o caso passaria por
      // vacuidade — que é o jeito silencioso de esta rede deixar de existir.
      expect(medido, `a medição de "${c.id}" deu 0 — a derivação quebrou (${c.onde})`).toBeGreaterThan(0)

      const naProsa = DOC.match(c.padrao)?.[1]
      expect(
        naProsa,
        `não achei a afirmação de "${c.id}" no CLAUDE.md (padrão ${c.padrao}).\n` +
          `Se a frase foi reescrita de propósito, atualize a âncora aqui junto — âncora que ` +
          `não casa mais é esta rede deixando de existir em silêncio.`,
      ).toBeDefined()

      expect(
        Number(naProsa),
        `o CLAUDE.md diz ${naProsa} e o repositório tem ${medido} (${c.onde}).\n` +
          `Quem manda é o código — atualize a prosa. Este número governa decisão: ${c.porque}.`,
      ).toBe(medido)
    })
  }
})

/**
 * A auto-descrição do eixo C. Ela é a única contagem deste arquivo que fala do PRÓPRIO
 * levantamento, e por isso não pode ser escrita à mão: era exatamente esse o defeito.
 *
 * ⚠️ "Conferidas" = contagens com teste, não arquivos de teste. As duas redes anteriores
 * conferem uma lista cada (os prefixos do middleware, a tabela de alvos), e este arquivo
 * acrescenta as suas — por isso o total sai daqui, somado às que já existiam.
 */
describe("o eixo C descreve a si mesmo pelo número real", () => {
  const JA_CONFERIDAS = 2 // rotas-de-sessao (prefixos) + scripts-apontam-pro-local (alvos)

  it("o CLAUDE.md diz quantas contagens são conferidas, e o número sai do teste", () => {
    const total = JA_CONFERIDAS + CONTAGENS.length
    const naProsa = DOC.match(/\*\*(\d+) afirmações de contagem\*\* \(\d+ distintas\)/)
    expect(naProsa, "não achei a afirmação do eixo C sobre quantas contagens o arquivo faz").not.toBeNull()

    // 🔴 TODAS as ocorrências, nunca a primeira: o número aparece no título da seção E na
    // prosa dela, e conferir só uma delas deixaria as duas livres para divergir — que é
    // literalmente o defeito que esta seção nomeia, dentro da rede que existe para pegá-lo.
    const conferidas = [...DOC.matchAll(/(\d+) conferidas?\b/g)].map((m) => Number(m[1]))
    expect(
      conferidas.length,
      "não achei nenhuma afirmação de \"N conferidas\" no CLAUDE.md — a âncora do eixo C sumiu",
    ).toBeGreaterThan(0)
    expect(
      conferidas,
      `o CLAUDE.md diz [${conferidas}] conferidas e hoje são ${total} ` +
        `(${JA_CONFERIDAS} das redes anteriores + ${CONTAGENS.length} deste arquivo). ` +
        `São ${conferidas.length} lugares afirmando o mesmo número — todos têm que bater.`,
    ).toEqual(conferidas.map(() => total))
  })

  it("as duas redes anteriores continuam lendo o CLAUDE.md", () => {
    // Se uma delas parar de ler, JA_CONFERIDAS passa a mentir — e o total acima com ela.
    for (const t of ["rotas-de-sessao", "scripts-apontam-pro-local"]) {
      const src = ler(`tests/unit/orchestration/${t}.test.ts`)
      // ⚠️ As duas leem de formas diferentes (`readFileSync("CLAUDE.md")` × via `path.join`), então
      // o que se casa é o FATO — ler o arquivo —, não a grafia da chamada.
      expect(src, `${t} deixou de ler o CLAUDE.md — o total de conferidas mudou`).toMatch(
        /readFileSync\([\s\S]{0,60}CLAUDE\.md/,
      )
    }
  })
})
