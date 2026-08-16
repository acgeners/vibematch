import { execSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

/**
 * Script de análise roda contra o banco LOCAL; o app roda contra a NUVEM. São lados opostos, e
 * o que os separa é o `.env.analysis` carregado DEPOIS do `.env.local` na linha de comando.
 *
 * Até 2026-08-10 o `.env.local` era um interruptor único — `npm run db:local` movia o app e os
 * scripts juntos —, então essa configuração era impossível: dava para escolher qual dos dois
 * estaria errado, não acertar os dois. Os scripts são o maior consumidor medido de egress
 * (pico de **1,47 GB num dia com zero escrita de curadoria**), e desde que o app passou a
 * apontar para a nuvem, um script que esqueça o `.env.analysis` vai ler o catálogo inteiro de
 * lá — 20,1 MB por varredura, contra 0 no local.
 *
 * 🔴 O modo de falha é silencioso: o script **funciona**, devolve os números certos e só
 * queima quota. Nada no resultado denuncia contra qual banco ele rodou. Por isso a defesa é
 * estrutural e não uma convenção escrita.
 *
 * ⚠️ Deriva a lista do `package.json`, nunca de nomes fixos: o que precisa ser pego aqui é o
 * script que ainda não existe.
 */
const PKG = JSON.parse(fs.readFileSync(path.join(process.cwd(), "package.json"), "utf8")) as {
  scripts: Record<string, string>
}

const comEnvLocal = Object.entries(PKG.scripts).filter(([, cmd]) => cmd.includes("--env-file=.env.local"))

/**
 * A exceção é DECLARADA no arquivo, não numa lista aqui: um script marcado `ALVO: NUVEM`
 * grava, e para ele o local é o alvo errado. Ler o cabeçalho em vez de manter uma allowlist
 * mantém **uma régua só** para as duas portas (npm script e comando copiado à mão) — e é a
 * mesma escolha de derivar do filesystem que o resto deste arquivo faz.
 */
function declaraAlvoNuvem(cmd: string): boolean {
  const arquivo = cmd.match(/scripts\/[\w.-]+\.(?:ts|mjs)/)?.[0]
  if (!arquivo) return false
  const p = path.join(process.cwd(), arquivo)
  return fs.existsSync(p) && fs.readFileSync(p, "utf8").includes("ALVO: NUVEM")
}

const devemApontarPraLocal = comEnvLocal.filter(([, cmd]) => !declaraAlvoNuvem(cmd))

describe("scripts de análise apontam para o banco local", () => {
  it("existem scripts com --env-file (senão a varredura não prova nada)", () => {
    expect(comEnvLocal.length).toBeGreaterThan(0)
  })

  it("todo script que carrega .env.local também carrega .env.analysis", () => {
    for (const [nome, cmd] of devemApontarPraLocal) {
      expect(
        cmd,
        `"${nome}" carrega .env.local sem .env.analysis — vai rodar contra a NUVEM e queimar ` +
          `egress em silêncio. Acrescente: --env-file=.env.local --env-file=.env.analysis` +
          ` (ou, se o script GRAVA, declare "ALVO: NUVEM" no cabeçalho dele)`,
      ).toContain("--env-file=.env.analysis")
    }
  })

  it(".env.analysis vem DEPOIS de .env.local — a ordem é o mecanismo", () => {
    // O último `--env-file` vence (verificado no Node e no tsx). Invertida, a ordem faz o
    // .env.local sobrescrever o alvo de volta para a nuvem, e o arquivo vira decoração.
    for (const [nome, cmd] of devemApontarPraLocal) {
      const iLocal = cmd.indexOf("--env-file=.env.local")
      const iAnalysis = cmd.indexOf("--env-file=.env.analysis")
      expect(iAnalysis, `"${nome}": .env.analysis precisa vir depois de .env.local`).toBeGreaterThan(iLocal)
    }
  })

  /**
   * 🔴 Script pago que aponta pra nuvem não pode depender só do `package.json`: quem copia o
   * comando do cabeçalho não passa por ele. Medido em 2026-08-10, o que estava em jogo era
   * `backfill:interest --execute` = **US$10,60** gravados num banco descartável.
   */
  it("script marcado ALVO: NUVEM e pago barra o --execute contra o local", () => {
    const pagos = comEnvLocal.filter(([, cmd]) => declaraAlvoNuvem(cmd))
    expect(pagos.length, "nenhum script pago no package.json — a varredura não prova nada").toBeGreaterThan(0)
    for (const [nome, cmd] of pagos) {
      const arquivo = cmd.match(/scripts\/[\w.-]+\.(?:ts|mjs)/)![0]
      const src = fs.readFileSync(path.join(process.cwd(), arquivo), "utf8")
      if (!src.includes("--execute") && !src.includes('hasFlag("execute")')) continue
      expect(
        src,
        `"${nome}" tem modo --execute e aponta pra nuvem, mas não chama exigeAlvoNuvem(): ` +
          `rodado à mão com o .env.analysis, ele paga as chamadas de IA e grava no banco ` +
          `descartável — o resultado morre no próximo db:pull.`,
      ).toContain("exigeAlvoNuvem(")
    }
  })

  /**
   * ⚠️ O `package.json` cobre só os ~25 scripts registrados como npm script. Os outros são
   * invocados à mão pelo comando escrito no CABEÇALHO do arquivo — e esse comando é a
   * interface real deles, tanto quanto a entrada do `package.json` é a dos primeiros.
   *
   * 🔴 Medido em 2026-08-10, logo depois do cutover: **58 arquivos** em `scripts/` traziam
   * `--env-file=.env.local` sem `.env.analysis`. Nenhum deles foi editado para ficar errado
   * — enquanto o `.env.local` apontava para o local, aquela linha era o alvo CERTO. O
   * cutover inverteu o significado da mesma linha, sem tocar em nada e sem nada acusar.
   *
   * Por isso a exigência é **declarar** o alvo, e não "usar o local": 29 desses scripts
   * gravam (catálogo ou o log de custo), e mandá-los para uma réplica descartável perde o
   * trabalho no próximo `db:pull` — falha mais cara que o egress que o `.env.analysis` evita.
   */
  const SCRIPTS_DIR = path.join(process.cwd(), "scripts")
  const arquivosComEnvLocal = fs
    .readdirSync(SCRIPTS_DIR)
    .filter((n) => n.endsWith(".ts") || n.endsWith(".mjs"))
    .map((n) => ({ nome: n, src: fs.readFileSync(path.join(SCRIPTS_DIR, n), "utf8") }))
    .filter(({ src }) => src.includes("--env-file=.env.local"))

  it("existem scripts invocados à mão (senão a varredura não prova nada)", () => {
    expect(arquivosComEnvLocal.length).toBeGreaterThan(0)
  })

  it("todo script de scripts/ DECLARA o alvo: .env.analysis (lê) ou ALVO: NUVEM (grava)", () => {
    for (const { nome, src } of arquivosComEnvLocal) {
      const linhaComLocal = src
        .split("\n")
        .filter((l) => l.includes("--env-file=.env.local"))
      const declaraLocal = linhaComLocal.every((l) => l.includes("--env-file=.env.analysis"))
      const declaraNuvem = src.includes("ALVO: NUVEM")
      expect(
        declaraLocal || declaraNuvem,
        `"${nome}" carrega .env.local sem declarar alvo. Desde o cutover de 2026-08-10 essa ` +
          `linha aponta para a NUVEM. Se o script só LÊ, acrescente ` +
          `"--env-file=.env.analysis" depois do .env.local; se ele GRAVA, escreva "ALVO: NUVEM" ` +
          `no cabeçalho dizendo por quê.`,
      ).toBe(true)
    }
  })

  it("nos scripts de leitura, .env.analysis vem DEPOIS de .env.local", () => {
    for (const { nome, src } of arquivosComEnvLocal) {
      if (src.includes("ALVO: NUVEM")) continue
      for (const linha of src.split("\n").filter((l) => l.includes("--env-file=.env.analysis"))) {
        expect(
          linha.indexOf("--env-file=.env.analysis"),
          `"${nome}": invertida, o .env.local sobrescreve o alvo de volta para a nuvem`,
        ).toBeGreaterThan(linha.indexOf("--env-file=.env.local"))
      }
    }
  })

  /**
   * 🔴 O FILTRO ACIMA ERA UMA ALLOWLIST DISFARÇADA, e deixou 16 scripts de fora.
   *
   * `arquivosComEnvLocal` só olha quem **menciona** `--env-file=.env.local`. Um script que
   * não menciona env-file nenhum escapava da varredura inteira — e escapar não quer dizer
   * ser inofensivo: medido em 2026-08-15, `measure-stale-assessments.mjs` trazia
   * `config({ path: '.env.local' })` no CÓDIGO e lia a NUVEM em toda execução, com o
   * `.env.analysis` sem poder algum sobre ele.
   *
   * A regra certa não é "menciona env-file" — é **toca o banco**. Quem cria client Supabase
   * decide um alvo, mencione-o ou não, e por isso precisa declarar qual.
   *
   * ⚠️ Scripts do `package.json` ficam de fora: para eles a interface é a entrada npm, que os
   * blocos anteriores já cobrem. Incluí-los aqui exigiria declarar o alvo duas vezes.
   */
  const TOCA_BANCO = /createAdminClient|createClient\(|SUPABASE_SERVICE_ROLE_KEY/
  const noPackageJson = (nome: string) =>
    Object.values(PKG.scripts).some((cmd) => cmd.includes(`scripts/${nome}`))

  /**
   * ⚠️ `.js` entrou em 2026-08-15, e a extensão era o último recorte da varredura. Ficavam de
   * fora **7 scripts do pipeline de consolidação de tags** — todos gravando no catálogo, todos
   * de julho, e cinco deles chamando a Anthropic. Não eram lixo, como pareciam pela idade: os
   * comentários de `server/actions/tag-consolidation.ts`, `lib/tag-consolidation/merge.ts` e
   * `lib/ai-evaluation/tag-clustering.ts` os citam como a metade OFFLINE de uma feature que
   * tem aba viva em `/curation/settings/tag-consolidation`.
   *
   * 🔴 A régua: o que define o escopo é **tocar o banco**, nunca a extensão do arquivo. Cada
   * recorte que sobra ("só .ts", "só quem menciona env-file") é uma allowlist esperando para
   * esconder o próximo.
   */
  /**
   * 🔴 A varredura pergunta ao GIT, não ao disco — e a diferença apareceu na primeira execução
   * com `.js` ligado: `seed-from-xlsx 4.js` reprovou o teste sendo **gitignored**, ou seja,
   * lixo local que não está no repositório e não existe em nenhum outro clone. Medir o disco
   * torna o resultado dependente da máquina; medir o índice do git é o que o repositório de
   * fato contém.
   */
  const rastreados = new Set(
    execSync("git ls-files scripts", { cwd: process.cwd(), encoding: "utf8" })
      .split("\n")
      .filter(Boolean)
      .map((p) => p.replace(/^scripts\//, ""))
      .filter((p) => !p.includes("/")), // subpastas (scripts/lib) têm régua própria
  )

  const invocadosAMao = [...rastreados]
    .filter((n) => n.endsWith(".ts") || n.endsWith(".mjs") || n.endsWith(".js"))
    .filter((n) => !noPackageJson(n))
    .map((n) => ({ nome: n, src: fs.readFileSync(path.join(SCRIPTS_DIR, n), "utf8") }))
    .filter(({ src }) => TOCA_BANCO.test(src))

  it("existem scripts fora do package.json que tocam o banco (senão a varredura não prova nada)", () => {
    expect(invocadosAMao.length).toBeGreaterThan(0)
  })

  it("todo script que TOCA o banco declara alvo, mencione --env-file ou não", () => {
    for (const { nome, src } of invocadosAMao) {
      expect(
        /--env-file=\.env\.analysis/.test(src) || src.includes("ALVO: NUVEM"),
        `"${nome}" cria um client Supabase e não declara alvo. Sem declaração ele roda contra ` +
          `a NUVEM (o .env.local é o default de fato) e queima egress em silêncio. Se só LÊ, ` +
          `escreva a linha de uso com "--env-file=.env.local --env-file=.env.analysis"; se ` +
          `GRAVA, escreva "ALVO: NUVEM" no cabeçalho dizendo por quê.`,
      ).toBe(true)
    }
  })

  /**
   * 🔴 Declarar LOCAL e fixar `.env.local` no código é pior que não declarar: a linha de uso
   * promete um alvo que o `dotenv` do próprio arquivo sobrescreve depois, e quem lê o
   * cabeçalho não tem como saber. Quatro arquivos estavam assim em 2026-08-15 — a mesma
   * família de "dois critérios pro mesmo fato", com a doc de um lado e o código do outro.
   */
  it("script que declara LOCAL não fixa .env.local no código", () => {
    for (const { nome, src } of invocadosAMao) {
      if (src.includes("ALVO: NUVEM")) continue
      if (!/--env-file=\.env\.analysis/.test(src)) continue
      expect(
        /config\(\{[^}]*path:\s*['"`]\.env\.local/.test(src),
        `"${nome}" declara alvo LOCAL na linha de uso mas chama config({ path: '.env.local' }) ` +
          `no código — o dotenv vence o --env-file e o script lê a NUVEM. Remova o config() e ` +
          `deixe o --env-file mandar; sem ele o script falha alto, que é o desejado.`,
      ).toBe(false)
    }
  })

  /**
   * 🔴 A TABELA DO CLAUDE.md É DERIVADA DAQUI — senão ela envelhece, e envelheceu DUAS vezes.
   *
   * Ela dizia "29 / 29" sobre 58 arquivos por semanas. Foi remedida para "44 / 39 sobre 89"
   * em 2026-08-15 e **quebrou no mesmo dia**: o PR seguinte ampliou o escopo da varredura
   * (`.js` entrou, 7 scripts de tag viraram `ALVO: NUVEM`) e não voltou na seção. Nada
   * acusou — número em prosa não sabe que está defasado.
   *
   * É a família "dois critérios pro mesmo fato" com um dos lados em MARKDOWN: o código conta
   * de um jeito, a doc afirma outro, e quem lê a doc para decidir onde mexer aprende o errado.
   * A saída é a de sempre: um lado deriva do outro. Aqui a doc é conferida contra o código.
   *
   * ⚠️ O teste casa a LINHA da tabela pelo rótulo, não pela posição — reordenar a tabela ou
   * reescrever o texto ao redor não pode reprovar. O que reprova é o NÚMERO divergir.
   */
  it("os números da tabela do CLAUDE.md batem com a varredura", () => {
    const doc = fs.readFileSync(path.join(process.cwd(), "CLAUDE.md"), "utf8")

    const declaram = invocadosAMao.filter(({ src }) => /--env-file=\.env\.analysis/.test(src) && !src.includes("ALVO: NUVEM"))
    const gravam = invocadosAMao.filter(({ src }) => src.includes("ALVO: NUVEM"))
    const universo = [...rastreados]
      .filter((n) => n.endsWith(".ts") || n.endsWith(".mjs") || n.endsWith(".js"))
      .filter((n) => !noPackageJson(n))

    /**
     * ⚠️ Ancora no COMEÇO da linha (`| <rótulo> |`), não em "contém". A 1ª versão usava
     * `includes` e casou a linha de OUTRA tabela do arquivo, que cita o mesmo rótulo dentro
     * de uma célula — o teste reprovava com `expected null`, apontando para o lugar errado.
     */
    const numeroDaLinha = (rotulo: string): number | null => {
      const linha = doc.split("\n").find((l) => l.startsWith(`| ${rotulo} |`))
      const m = linha?.match(/\|\s*\*{0,2}(\d+)\*{0,2}\s*\|/)
      return m ? Number(m[1]) : null
    }

    expect(
      numeroDaLinha("`--env-file=.env.analysis` na linha de uso"),
      `a tabela do CLAUDE.md diz outro número de scripts que só LEEM; a varredura conta ${declaram.length}`,
    ).toBe(declaram.length)

    expect(
      numeroDaLinha("`ALVO: NUVEM` no cabeçalho"),
      `a tabela do CLAUDE.md diz outro número de scripts que GRAVAM; a varredura conta ${gravam.length}`,
    ).toBe(gravam.length)

    expect(
      doc,
      `o total mudou: são ${universo.length} arquivos rastreados fora do package.json. ` +
        `Atualize o "(**N arquivos, remedidos em …**)" da seção de alvo dos scripts.`,
    ).toContain(`${universo.length} arquivos, remedidos`)
  })

  it("o gerador do .env.analysis existe e se recusa a apontar para fora do local", () => {
    // Sem essa trava, um `supabase status` devolvendo alvo remoto faria TODOS os scripts
    // migrarem para a nuvem de uma vez — o oposto exato do que este arquivo protege.
    const src = fs.readFileSync(path.join(process.cwd(), "scripts/db-analysis-env.mjs"), "utf8")
    expect(src).toMatch(/127\\?\.0\\?\.0\\?\.1|localhost/)
    expect(src).toContain("die(")
  })
})
