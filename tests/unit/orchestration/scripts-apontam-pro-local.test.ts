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

describe("scripts de análise apontam para o banco local", () => {
  it("existem scripts com --env-file (senão a varredura não prova nada)", () => {
    expect(comEnvLocal.length).toBeGreaterThan(0)
  })

  it("todo script que carrega .env.local também carrega .env.analysis", () => {
    for (const [nome, cmd] of comEnvLocal) {
      expect(
        cmd,
        `"${nome}" carrega .env.local sem .env.analysis — vai rodar contra a NUVEM e queimar ` +
          `egress em silêncio. Acrescente: --env-file=.env.local --env-file=.env.analysis`,
      ).toContain("--env-file=.env.analysis")
    }
  })

  it(".env.analysis vem DEPOIS de .env.local — a ordem é o mecanismo", () => {
    // O último `--env-file` vence (verificado no Node e no tsx). Invertida, a ordem faz o
    // .env.local sobrescrever o alvo de volta para a nuvem, e o arquivo vira decoração.
    for (const [nome, cmd] of comEnvLocal) {
      const iLocal = cmd.indexOf("--env-file=.env.local")
      const iAnalysis = cmd.indexOf("--env-file=.env.analysis")
      expect(iAnalysis, `"${nome}": .env.analysis precisa vir depois de .env.local`).toBeGreaterThan(iLocal)
    }
  })

  it("o gerador do .env.analysis existe e se recusa a apontar para fora do local", () => {
    // Sem essa trava, um `supabase status` devolvendo alvo remoto faria TODOS os scripts
    // migrarem para a nuvem de uma vez — o oposto exato do que este arquivo protege.
    const src = fs.readFileSync(path.join(process.cwd(), "scripts/db-analysis-env.mjs"), "utf8")
    expect(src).toMatch(/127\\?\.0\\?\.0\\?\.1|localhost/)
    expect(src).toContain("die(")
  })
})
