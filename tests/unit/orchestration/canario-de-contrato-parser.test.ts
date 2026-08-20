import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
// @ts-expect-error — script .mjs sem tipos, importado pelo que ele EXPORTA
import { chamadasNoTexto } from "../../../scripts/contratos-postgrest.mjs"

/**
 * O parser do canário de contrato (`scripts/contratos-postgrest.mjs`).
 *
 * 🔴 Ele existe porque o canário DEPENDE de ler o source direito, e o meu errou duas vezes na
 * primeira hora de vida — as duas produzindo resultado plausível:
 *
 *   1. ligava o tipo por PROXIMIDADE, e acusou `seed_pair_similarity` de declarar cinco campos
 *      fantasmas que pertenciam à chamada VIZINHA no mesmo `Promise.all`;
 *   2. procurava `create function public.x` e afirmou "nenhuma migration declara
 *      `work_card_counts`" sobre uma função declarada na 122 como
 *      `CREATE OR REPLACE FUNCTION work_card_counts`.
 *
 * Um detector que produz resultado plausível e errado é exatamente a família que o canário
 * existe para pegar. Estes casos são a rede dele.
 *
 * ⚠️ Só o PARSER é testado aqui. A conferência contra o banco é `npm run contracts` e mora
 * fora da suíte de propósito: como teste do vitest, a saída óbvia seria "pula quando não
 * alcança o banco" — o fail-soft calado que some sem ninguém notar.
 */
describe("o parser de chamadas de RPC", () => {
  it("acha a chamada simples e os argumentos", () => {
    const r = chamadasNoTexto(`const { data } = await supabase.rpc("minha_fn", { alvo: id, teto: 5 })`)
    expect(r).toHaveLength(1)
    expect(r[0].nome).toBe("minha_fn")
    expect(r[0].args.sort()).toEqual(["alvo", "teto"])
  })

  it("acha chamada sem argumento nenhum", () => {
    const r = chamadasNoTexto(`await supabase.rpc("touch_algo")`)
    expect(r).toHaveLength(1)
    expect(r[0].args).toEqual([])
  })

  it("🔴 acha AS DUAS chamadas de um Promise.all", () => {
    // O arranjo que produziu o falso positivo: duas RPCs na mesma expressão. Perder uma delas
    // tiraria a segunda do canário inteiro, sem nada acusar.
    const r = chamadasNoTexto(`
      const [a, b] = await Promise.all([
        supabase.rpc("primeira", { seed_ids: ids, match_limit: 20 }),
        supabase.rpc("segunda", { seed_ids: ids }),
      ])`)
    expect(r.map((x) => x.nome)).toEqual(["primeira", "segunda"])
    expect(r[1].args).toEqual(["seed_ids"])
  })

  it("só pega chaves de PRIMEIRO nível do objeto de argumentos", () => {
    // `{ a: 1, b: { c: 2 } }` passa `a` e `b` — `c` não é argumento da função.
    const r = chamadasNoTexto(`await sb.rpc("fn", { a: 1, b: { c: 2 }, d: [3] })`)
    expect(r[0].args.sort()).toEqual(["a", "b", "d"])
  })

  it("não confunde `.rpc(` com outra coisa que termine em rpc", () => {
    const r = chamadasNoTexto(`const x = meuRpc("nao_e")\nawait sb.rpc("e_sim")`)
    expect(r.map((x) => x.nome)).toEqual(["e_sim"])
  })
})

/**
 * ⚠️ Estes dois casos não testam o parser: travam as DECISÕES do canário que, se caírem, o
 * fazem passar verde sem olhar nada — que é a única forma de ele piorar a situação em vez de
 * melhorá-la.
 */
describe("as decisões que impedem o canário de passar sem olhar", () => {
  const SRC = readFileSync(join(process.cwd(), "scripts/contratos-postgrest.mjs"), "utf8")

  it("🔴 zero linha é FALHA, não sucesso", () => {
    // "não deu para ver coluna nenhuma" indistinguível de "está tudo certo" é o defeito que o
    // canário existe para pegar, aplicado a ele mesmo.
    expect(SRC).toMatch(/linhas\.length === 0/)
    const i = SRC.indexOf("linhas.length === 0")
    expect(SRC.slice(i, i + 400), "zero linha precisa empurrar em `falhas`").toMatch(/falhas\.push/)
  })

  it("🔴 banco fora do ar é FALHA, não skip", () => {
    const i = SRC.indexOf("não alcancei o PostgREST")
    expect(i, "sumiu a mensagem de banco inalcançável").toBeGreaterThan(-1)
    expect(SRC.slice(i, i + 300)).toMatch(/process\.exit\(1\)/)
  })

  it("recusa alvo que não seja o local", () => {
    // Ele EXECUTA RPC: apontar pra nuvem por acidente queima quota e lê dado de produção.
    expect(SRC).toMatch(/127\\\.0\\\.0\\\.1\|localhost/)
  })
})
