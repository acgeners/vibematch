import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"

/**
 * O smoke da metade LOGADA — as invariantes que, quebradas, o deixam passando verde sem ter
 * verificado nada.
 *
 * 🔴 Por que ele existe, medido em 21/08/2026 contra um build de produção local: os outros dois
 * smokes são anônimos, e na MESMA página de obra o anônimo vê 46 elementos, o leitor 53 e o
 * curador 70. Com uma sonda que estoura na hidratação da `/curation`, o `smoke-browser.mjs`
 * passou VERDE (5 rotas ✅) e este reprovou.
 */

const RAIZ = join(import.meta.dirname, "../../..")
const SMOKE = readFileSync(join(RAIZ, "scripts/smoke-logado.mjs"), "utf8")
/** Sem comentários: eles CITAM o que a régua proíbe (`.click(`, `/login`), e a 1ª versão de um
 *  teste irmão reprovou acusando a própria explicação da mudança. */
const CODIGO = SMOKE.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")

describe("as guardas de alvo", () => {
  it("🔴 recusa qualquer alvo que não seja local — ele ESCREVE senha no banco do alvo", async () => {
    const { ehLocal } = await import("../../../scripts/smoke-logado.mjs")

    // O que tem de passar: o stack e o build locais.
    expect(ehLocal("http://localhost:3100")).toBe(true)
    expect(ehLocal("http://127.0.0.1:54321")).toBe(true)
    expect(ehLocal("http://localhost:3100/")).toBe(true)

    // O que tem de ser recusado. `satoria.fly.dev` é o caso caro: definir senha lá mexeria na
    // credencial de uma conta real.
    expect(ehLocal("https://satoria.fly.dev")).toBe(false)
    expect(ehLocal("https://obwlwukwovetgjqdpizd.supabase.co")).toBe(false)
    expect(ehLocal(undefined)).toBe(false)
    // ⚠️ E o prefixo que ENGANA: um `startsWith("http://localhost")` deixaria passar.
    expect(ehLocal("http://localhost.evil.com")).toBe(false)
    expect(ehLocal("http://127.0.0.1.evil.com")).toBe(false)
  })

  it("🔴 confere o BANCO além do servidor — são dois alvos independentes", () => {
    // Um build local apontando para a nuvem passa na guarda do `--base` e escreveria senha em
    // produção. Por isso a segunda guarda lê NEXT_PUBLIC_SUPABASE_URL.
    expect(CODIGO, "a guarda de banco sumiu — só o --base estaria sendo conferido").toContain(
      "NEXT_PUBLIC_SUPABASE_URL",
    )
    const guarda = CODIGO.slice(CODIGO.indexOf("function exigirLocal"))
    expect(guarda.slice(0, 1600)).toMatch(/NEXT_PUBLIC_SUPABASE_URL/)
  })
})

describe("o que ele verifica", () => {
  it("🔴 cobre os DOIS papéis — é o que produção não conseguiria", async () => {
    const { PAPEIS } = await import("../../../scripts/smoke-logado.mjs")
    const ids = PAPEIS.map((p: { id: string }) => p.id)
    // Medido na nuvem em 21/08: só a conta LEITORA tem senha lá (o curador é Google-only), então
    // um smoke contra produção deixaria a console inteira de fora. É a razão de ele ser local.
    expect(ids, "sem o curador, as 7 rotas de /curation ficam sem rede").toContain("curador")
    expect(ids, "sem o leitor, o painel report_error (#495) fica sem rede").toContain("leitor")
  })

  it("🔴 tem a metade NEGATIVA: o papel insuficiente NÃO pode alcançar a console", async () => {
    const { PAPEIS } = await import("../../../scripts/smoke-logado.mjs")
    const leitor = PAPEIS.find((p: { id: string }) => p.id === "leitor")
    const negativas = leitor?.naoAlcanca ?? []

    // Esta base já pagou 10 vazamentos per-user. Nenhum outro instrumento pergunta "o gate de
    // PAPEL continua de pé?" — o smoke de HTTP cobre o ANÔNIMO (307), que é outro caso.
    expect(negativas.length, "sem checagem negativa, a console pode vazar para leitor em silêncio").toBeGreaterThan(0)
    expect(negativas.map((n: { rota: string }) => n.rota)).toContain("/curation")
    for (const n of negativas) expect(n.destino, "toda negativa declara ONDE devia parar").toBeTruthy()
  })

  it("🔴 a página de obra entra pelos DOIS papéis, com marcador exclusivo de cada um", async () => {
    const { PAPEIS } = await import("../../../scripts/smoke-logado.mjs")
    for (const p of PAPEIS as Array<{ id: string; alcanca: Array<{ obra?: boolean; texto?: RegExp }> }>) {
      const obra = p.alcanca.find((a) => a.obra)
      // A rota não é gateada: o caminho final não prova sessão nenhuma. Sem um texto que só
      // aquele papel vê, a verificação passaria verde com a árvore ANÔNIMA na tela.
      expect(obra, `o papel "${p.id}" não abre a página de obra — a maior árvore hidratada do app`).toBeDefined()
      expect(obra?.texto, `a obra do papel "${p.id}" não exige marcador: a sessão não estaria sendo provada`).toBeInstanceOf(RegExp)
    }
  })
})

describe("os modos de falha do próprio smoke", () => {
  it("🔴 confere o CAMINHO FINAL de toda rota — sessão caída não pode passar verde", () => {
    // Sem isto, sessão caída manda tudo para /login, que renderiza limpa (200, sem esqueleto,
    // sem erro), e o smoke aprovaria tendo olhado a tela de login doze vezes. Conferido com
    // sonda: pulando o login, ele acusa "terminou em /login" em todas as rotas gateadas.
    expect(CODIGO, "a comparação do caminho final sumiu").toMatch(/caminho\s*!==\s*alvo\.rota/)
    expect(CODIGO).toMatch(/\/login/)
  })

  it("🔴 contexto NOVO por papel — senão o leitor herda a sessão do curador", () => {
    // Reusando o contexto, a metade negativa passaria verde afirmando o oposto do que houve:
    // o "leitor" seria o curador, e /curation não redirecionaria.
    const laco = CODIGO.slice(CODIGO.indexOf("for (const papel of PAPEIS)"))
    expect(laco, "o contexto do browser não é recriado dentro do laço de papéis").toMatch(/newContext/)
  })

  it("🔴 sempre `goto`; o ÚNICO clique permitido é o do login", () => {
    // Medido em 20/08: abertura direta por UUID quebrava 9 de 10; clicando num link, 0 de 10.
    // Um smoke que navegasse clicando passaria verde pelo mesmo motivo que o defeito era
    // invisível para quem desenvolve. Mas entrar na conta EXIGE submeter o formulário — então a
    // régua não é "nenhum clique", é "nenhum clique fora do login".
    const cliques = [...CODIGO.matchAll(/\.click\(([^)]*)\)/g)].map((m) => m[1])
    expect(cliques.length, "nenhum clique: o login não estaria sendo submetido").toBeGreaterThan(0)
    for (const c of cliques) {
      expect(c, `clique fora do login (\`${c}\`) — navegação tem de ser goto`).toContain("submit")
    }
  })

  it("🔴 fail-HARD quando falta Playwright, ao contrário do smoke de produção", () => {
    // O fail-soft do `smoke-browser.mjs` existe porque ele roda DEPOIS de publicar, sob `set -e`.
    // Aqui nada foi publicado: "não verifiquei" não pode sair como "verifiquei" — é assim que se
    // constrói capacidade DESLIGADA (o CoverImage prometia fallback e estava ligado em 2 de 36).
    const bloco = CODIGO.slice(CODIGO.indexOf("function semPlaywright"))
    expect(bloco.slice(0, 500), "o smoke logado está saindo 0 sem ter rodado").toMatch(/process\.exit\(1\)/)
  })

  it("🔴 a casca de erro cobre as DUAS grafias do Next", () => {
    // Medido em 21/08 com a sonda de hidratação: o Next 16 serve "This page couldn't load", e
    // "Application error: a client-side exception" NÃO aparece. Casar só a antiga é ter o
    // detector desligado justamente no caso que ele existe para pegar.
    const linha = CODIGO.split("\n").find((l) => l.includes("ERRO_DO_NEXT =")) ?? ""
    expect(linha).toMatch(/Application error/)
    expect(linha, "só a grafia antiga: o Next 16 não seria detectado").toMatch(/This page could/)
  })
})

describe("a guarda de chamada direta", () => {
  it("🔴 resolve SYMLINK — sem isso o smoke sai 0 sem ter aberto uma rota", async () => {
    const { mesmoArquivo } = await import("../../../scripts/smoke-logado.mjs")
    const { mkdtempSync, mkdirSync, writeFileSync, symlinkSync } = await import("node:fs")
    const { tmpdir } = await import("node:os")

    // Reproduz o caso REAL: `mktemp -d` no macOS devolve /var/folders/… (symlink para
    // /private/var/folders/…), e o script é invocado por esse caminho enquanto
    // `import.meta.url` guarda o real. Medido em 21/08: build feito, servidor no ar, e o
    // `smoke-logado.sh` terminou com código 0 sem verificar NADA.
    const base = mkdtempSync(join(tmpdir(), "symlink-"))
    mkdirSync(join(base, "real"))
    const arquivo = join(base, "real", "x.mjs")
    writeFileSync(arquivo, "")
    symlinkSync(join(base, "real"), join(base, "link"))
    const viaLink = join(base, "link", "x.mjs")

    expect(viaLink).not.toBe(arquivo) // os dois caminhos são textualmente diferentes…
    expect(mesmoArquivo(viaLink, arquivo), "a comparação não resolve symlink: o smoke vira no-op silencioso").toBe(true)

    // E continua distinguindo arquivos de verdade — senão a guarda deixaria de guardar.
    const outro = join(base, "real", "y.mjs")
    writeFileSync(outro, "")
    expect(mesmoArquivo(outro, arquivo)).toBe(false)
    expect(mesmoArquivo(join(base, "nao-existe.mjs"), arquivo)).toBe(false)
  })

  it("🔴 importar o módulo NÃO dispara o smoke", async () => {
    // Sem a guarda, importá-lo aqui rodaria o smoke de verdade — e o `process.exit` das
    // guardas de alvo derrubaria a suíte inteira. Que este arquivo de teste rode até o fim já
    // é a prova; a asserção existe para nomeá-la.
    const mod = await import("../../../scripts/smoke-logado.mjs")
    expect(mod.PAPEIS, "o módulo não exporta as peças — o teste estaria casando grafia").toBeDefined()
  })
})
