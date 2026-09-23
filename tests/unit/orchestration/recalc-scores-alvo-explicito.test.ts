import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

/**
 * `npm run recalc:scores` GRAVA, e até 2026-09-23 escolhia o banco sozinho.
 *
 * 🔴 O DEFEITO, COMPROVADO rodando os três casos: o npm script era
 * `--env-file=.env.local --env-file=.env.analysis`, e o último `--env-file` vence. O comando
 * resolvia para `http://127.0.0.1:54321` — o clone descartável — enquanto o nome não dizia
 * nada sobre alvo. Com o stack local no ar ele recalcula a réplica e imprime
 * `✓ recalc concluído · recalc_pending agora=false`: **erro que produz resultado**, a família
 * mais cara desta base.
 *
 * ⚠️ A correção NÃO foi inverter a ordem dos `.env`. Isso trocaria o alvo em silêncio — a
 * mesma classe de defeito com o sinal invertido, e quem rodasse o comando por hábito passaria
 * a escrever em PRODUÇÃO sem nada avisar. O alvo passou a ser DECLARADO (`--cloud`/`--local`)
 * e CONFERIDO contra a URL efetiva, e os dois continuam alcançáveis.
 *
 * ⚠️ Este teste é ESTÁTICO de propósito: `tsx` não está em `node_modules` (o `npx` o baixa sob
 * demanda), então executar o script aqui faria a suíte depender de rede. O que ele casa são
 * FATOS estruturais — qual env cada script carrega, a ordem, e a existência das duas direções
 * de recusa —, nunca a grafia de uma mensagem.
 */
const RAIZ = process.cwd()
const PKG = JSON.parse(fs.readFileSync(path.join(RAIZ, "package.json"), "utf8")) as {
  scripts: Record<string, string>
}
const SRC = fs.readFileSync(path.join(RAIZ, "scripts/recalculate-scores.ts"), "utf8")

/** O source sem comentários — a prosa cita o defeito antigo e casaria com quase tudo. */
const CODIGO = SRC.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")

describe("recalc:scores declara o alvo em vez de herdá-lo da ordem dos .env", () => {
  it("existem os DOIS comandos explícitos, além do alias", () => {
    expect(Object.keys(PKG.scripts)).toEqual(
      expect.arrayContaining(["recalc:scores", "recalc:scores:cloud", "recalc:scores:local"]),
    )
  })

  it("todo npm script de recalc aponta para o mesmo runner — não há um 2º caminho de escrita", () => {
    for (const nome of ["recalc:scores", "recalc:scores:cloud", "recalc:scores:local"]) {
      expect(PKG.scripts[nome], `"${nome}"`).toContain("scripts/recalculate-scores.ts")
    }
  })

  it("`:cloud` NÃO carrega .env.analysis — senão o alvo efetivo volta a ser o local", () => {
    // Este é exatamente o estado anterior: o comando dizia uma coisa e resolvia outra.
    expect(PKG.scripts["recalc:scores:cloud"]).not.toContain(".env.analysis")
    expect(PKG.scripts["recalc:scores:cloud"]).toContain("--cloud")
  })

  it("`:local` carrega .env.analysis DEPOIS de .env.local — a ordem é o mecanismo", () => {
    const cmd = PKG.scripts["recalc:scores:local"]
    const iLocal = cmd.indexOf("--env-file=.env.local")
    const iAnalysis = cmd.indexOf("--env-file=.env.analysis")
    expect(iLocal, "carrega .env.local").toBeGreaterThanOrEqual(0)
    expect(iAnalysis, ".env.analysis precisa vir DEPOIS de .env.local").toBeGreaterThan(iLocal)
    expect(cmd).toContain("--local")
  })

  it("🔴 o ALIAS não declara alvo — ele tem de recusar, nunca escolher um", () => {
    // Se o alias ganhasse `--cloud` ou `--local`, o comando que a memória muscular usa
    // voltaria a decidir sozinho, que é o defeito inteiro.
    const alias = PKG.scripts["recalc:scores"]
    expect(alias).not.toContain("--cloud")
    expect(alias).not.toContain("--local")
  })

  it("o script RECUSA quando nenhum alvo foi declarado — sem default", () => {
    // O fato: existe um ramo que trata a ausência de alvo saindo com erro.
    expect(CODIGO).toMatch(/pedido === null/)
    expect(CODIGO).toMatch(/process\.exit\(1\)/)
    // E não existe default: nada preenche o alvo quando ele falta.
    expect(CODIGO, "alvo com valor default reintroduz a escolha implícita").not.toMatch(
      /alvoPedido\([^)]*\)\s*(\?\?|\|\|)\s*["']/,
    )
  })

  it("confere o alvo nas DUAS direções — pedir local contra a nuvem é o lado caro", () => {
    expect(CODIGO).toMatch(/alvo === "cloud" && ehLocal/)
    expect(CODIGO).toMatch(/alvo === "local" && !ehLocal/)
  })

  it("reusa `isLocalSupabaseUrl` em vez de uma 2ª regex de host", () => {
    // Duas grafias do predicado fariam este script aceitar o que o app recusa — a família
    // "dois critérios pro mesmo fato", aqui decidindo em qual banco a escrita cai.
    expect(CODIGO).toMatch(/import\s*\{[^}]*isLocalSupabaseUrl[^}]*\}\s*from\s*["']@\/lib\/db-target["']/)
    expect(CODIGO, "regex de host própria").not.toMatch(/127\\?\.0\\?\.0\\?\.1|localhost/)
  })

  it("imprime o alvo ANTES de tocar o banco — é o que permite abortar a tempo", () => {
    const iAlvo = CODIGO.indexOf("console.log(`alvo:")
    const iLeitura = CODIGO.indexOf("getRecalcPendingState()")
    expect(iAlvo, "o script precisa imprimir o alvo escolhido").toBeGreaterThanOrEqual(0)
    expect(iLeitura).toBeGreaterThanOrEqual(0)
    expect(iAlvo, "o alvo tem de ser impresso antes da primeira leitura").toBeLessThan(iLeitura)
  })

  it("declara ALVO: NUVEM no cabeçalho — é a régua que a varredura de targets lê", () => {
    expect(SRC).toContain("ALVO: NUVEM")
  })
})
