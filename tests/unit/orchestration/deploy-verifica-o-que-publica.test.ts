import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

/**
 * Invariante: o deploy verifica O QUE ELE PUBLICOU, com o script DA VERSÃO PUBLICADA.
 *
 * 🔴 O que isto pega, medido em 19/08/2026 — uma hora depois de o smoke entrar no `main`:
 * `npm run deploy` rodou, publicou o código novo e **não rodou o smoke**. Saiu a mensagem
 * antiga ("confira o /api/health"), o deploy reportou sucesso, e a verificação que existe
 * justamente para pegar rota quebrada simplesmente não aconteceu.
 *
 * A causa é a assimetria do próprio script: ele publica um worktree descartável de
 * `origin/main`, mas quem EXECUTA é o `scripts/deploy.sh` do CHECKOUT LOCAL de quem digitou
 * o comando — que naquele momento estava numa branch já mergeada, com a versão anterior.
 * "Dois critérios pro mesmo fato" aplicado ao deploy: o código publicado e o código que
 * verifica vinham de commits diferentes, e só o primeiro estava sob controle.
 *
 * ⚠️ A parte irredutível fica: as GUARDAS do `deploy.sh` são sempre as do checkout, porque o
 * arquivo precisa existir para rodar. O que dá para consertar — e o que este teste trava — é
 * que tudo o que ele INVOCA venha do worktree publicado, e que o aviso de HEAD divergente
 * diga o que está em jogo em vez de tranquilizar.
 */
const RAIZ = process.cwd()
const DEPLOY = readFileSync(join(RAIZ, "scripts/deploy.sh"), "utf8")

/** As linhas de comando, sem comentário — é o que EXECUTA. */
const CODIGO = DEPLOY.split("\n")
  .filter((l) => !l.trim().startsWith("#"))
  .join("\n")

describe("o deploy verifica o que publica", () => {
  it("o arquivo foi lido (senão os casos abaixo passam por vacuidade)", () => {
    expect(DEPLOY.length).toBeGreaterThan(500)
    expect(CODIGO).toContain("flyctl deploy")
  })

  it("cria um worktree do alvo publicado", () => {
    // O `$WT` é o que dá sentido ao resto: sem ele não existe "a versão publicada" para
    // invocar, e o deploy volta a depender do estado do checkout.
    expect(CODIGO).toMatch(/git worktree add[^\n]*origin\/main/)
    expect(CODIGO).toMatch(/WT=/)
  })

  it("🔴 roda o smoke a partir do worktree PUBLICADO, nunca do checkout local", () => {
    const chamada = CODIGO.split("\n").find((l) => l.includes("smoke-producao.mjs"))
    expect(chamada, "o deploy não chama mais o smoke — a verificação sumiu").toBeDefined()
    expect(
      chamada,
      `o smoke é invocado como \`${chamada?.trim()}\`. Com $REPO_ROOT ele roda a versão do ` +
        `CHECKOUT, que pode ser mais antiga que a publicada — foi assim que ele deixou de ` +
        `rodar em 19/08/2026, com o deploy reportando sucesso.`,
    ).toContain("$WT")
    expect(chamada, "o smoke voltou a sair do checkout local").not.toContain("$REPO_ROOT")
  })

  it("o smoke aponta para o app que acabou de subir, não para um alvo fixo", () => {
    const chamada = CODIGO.split("\n").find((l) => l.includes("smoke-producao.mjs")) ?? ""
    // `--base` derivado de $APP: um domínio escrito à mão aqui e outro no `flyctl deploy`
    // seria a mesma família de erro num nível abaixo.
    expect(chamada).toMatch(/--base=[^\n]*\$APP/)
  })

  it("o aviso de HEAD divergente diz que as GUARDAS são as do checkout", () => {
    // A versão anterior dizia só "o deploy publica origin/main assim mesmo" — verdade sobre o
    // CÓDIGO, e justamente por isso tranquilizadora sobre a coisa errada: quem lia concluía
    // que o checkout desatualizado não tinha consequência nenhuma.
    const trecho = DEPLOY.slice(DEPLOY.indexOf("LOCAL_HEAD"), DEPLOY.indexOf("worktree descartável"))
    expect(trecho, "o aviso de HEAD divergente sumiu").toContain("LOCAL_HEAD")
    expect(
      /guardas deste script|guardas do deploy/i.test(trecho),
      "o aviso não diz que as guardas executadas são as do CHECKOUT, que é o que morde",
    ).toBe(true)
  })

  it("o smoke que ele invoca existe no repo", () => {
    // Chamada para um caminho que não existe faria o `set -e` derrubar TODO deploy — e a
    // primeira pessoa a ver isso seria quem estivesse publicando.
    const smoke = readFileSync(join(RAIZ, "scripts/smoke-producao.mjs"), "utf8")
    expect(smoke).toContain("--base=")
    expect(smoke).toContain("process.exit(1)")
  })
})

/**
 * O SEGUNDO smoke: o que abre num browser.
 *
 * 🔴 O que ele existe para pegar, e que o de HTTP declara não ver: em 2026-08-20 toda página
 * de obra ficou um dia quebrada para visitante (React #310 na hidratação) com o HTML SERVIDO
 * completo, o smoke verde e a suíte verde.
 */
describe("o smoke de browser", () => {
  const LINHA = CODIGO.split("\n").find((l) => l.includes("smoke-browser.mjs"))
  const SMOKE = readFileSync(join(RAIZ, "scripts/smoke-browser.mjs"), "utf8")

  it("o deploy o invoca, a partir do worktree PUBLICADO", () => {
    expect(LINHA, "o deploy não abre mais nada num browser").toBeDefined()
    // Mesma regra do smoke de HTTP: verificar o que subiu com o script de outra versão é
    // verificar outra coisa.
    expect(LINHA).toContain("$WT/scripts/smoke-browser.mjs")
    expect(LINHA).toMatch(/--base=[^\n]*\$APP/)
  })

  it("🔴 o BROWSER vem do checkout, porque worktree novo não tem node_modules", () => {
    // A única coisa que legitimamente sai do `$REPO_ROOT`, e é por necessidade física:
    // `git worktree add` cria um checkout limpo, sem `node_modules` — nem o da raiz nem o do
    // sidecar da Comix, que é quem tem o `playwright-core`. Sem isto o smoke cai no fail-soft
    // em TODO deploy e nunca verifica nada.
    expect(
      LINHA,
      "sem --modules apontando pro checkout, o smoke de browser nunca acha o Playwright " +
        "e pula em silêncio a cada deploy",
    ).toContain('--modules="$REPO_ROOT"')
  })

  it("roda DEPOIS do smoke de HTTP", () => {
    // O de HTTP é mais barato e pega a família mais grave (rota que subiu vazia). Com
    // `set -e`, ele falhando aborta antes de gastar ~25s de browser.
    const linhas = CODIGO.split("\n")
    const http = linhas.findIndex((l) => l.includes("smoke-producao.mjs"))
    const browser = linhas.findIndex((l) => l.includes("smoke-browser.mjs"))
    expect(http).toBeGreaterThan(-1)
    expect(browser).toBeGreaterThan(http)
  })

  it("🔴 é fail-SOFT: sem Playwright ele avisa e sai 0", () => {
    // Com `set -e` no deploy.sh, um exit 1 aqui derrubaria o comando DEPOIS de já ter
    // publicado — trocaria um defeito raro (regressão de hidratação) por um comum.
    expect(SMOKE).toMatch(/process\.exit\(0\)/)
    // ⚠️ E o aviso tem de ser ALTO: fail-soft calado é como se constrói capacidade desligada
    // (o `CoverImage` prometia fallback e estava ligado em 2 de 36 telas).
    expect(SMOKE).toMatch(/NÃO RODOU/)
  })

  it("🔴 o detector NÃO se apoia só em `pageerror` — isso foi medido e não pega", () => {
    // A 1ª versão deste script olhava `pageerror` e passou VERDE com um componente que
    // literalmente lançava na hidratação: o React 19 engole a exceção, cai para render no
    // cliente e nada chega ao `window.onerror`. O que separou os dois estados, medido:
    // resposta 5xx (1 × 0) e esqueleto sobrando depois de hidratar (28 × 0 em 9 rotas sãs).
    expect(SMOKE, "sumiu a checagem de 5xx, que é o sinal que de fato separou").toMatch(/>= 500/)
    expect(
      SMOKE,
      "sumiu a checagem de esqueleto — é o sinal GERAL, o único que não precisa de número por rota",
    ).toContain('data-slot="skeleton"')
  })

  it("carrega as rotas a FRIO, nunca clicando", () => {
    // Medido em 20/08: abertura direta por UUID quebrava 9 de 10; clicar num link, 0 de 10.
    // Um smoke que navegasse clicando passaria verde pelo mesmo motivo que o defeito era
    // invisível para quem desenvolve.
    expect(SMOKE).toMatch(/page\.goto\(/)
    expect(SMOKE, "smoke que clica não reproduz a família").not.toMatch(/\.click\(/)
  })
})
