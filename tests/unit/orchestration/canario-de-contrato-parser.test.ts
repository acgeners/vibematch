import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
// O `.mjs` não tem tipos, mas o TS resolve o módulo — um `@ts-expect-error` aqui vira
// TS2578 ("unused directive") e deixa o `npx tsc --noEmit` vermelho para todo mundo.
import {
  chamadasNoTexto,
  paresNoTexto,
  embedsDoSelect,
  classificarForma,
} from "../../../scripts/contratos-postgrest.mjs"

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

/**
 * A metade EMBED. 🔴 O PostgREST devolve embed **to-one** como OBJETO e **to-many** como ARRAY,
 * e quem decide é o BANCO (direção da FK + índices únicos). Errar não dá erro: `?.[0]` sobre
 * objeto é `undefined`, `.campo` sobre array é `undefined`.
 *
 * ⚠️ Aqui só o PARSER é testado — a forma real é medida contra o banco por `npm run contracts`.
 * Um parser que perde um par deixa o canário cego naquele ponto, e ninguém nota.
 */
describe("o parser de pares (tabela base → embed)", () => {
  it("acha o par simples e ignora o embed do embed", () => {
    // `tags` está DENTRO de `work_tags(...)`: é embed do embed, e a forma dele é outra pergunta.
    const r = paresNoTexto(`sb.from("works").select("id, work_tags(tag_id, tags(id))")`)
    expect(r).toEqual([{ base: "works", embed: "work_tags" }])
  })

  it("ignora `!fk` e `alias:`, que não fazem parte do nome da relação", () => {
    expect(embedsDoSelect("id, work_covers!work_id(url)")).toEqual(["work_covers"])
    expect(embedsDoSelect("id, capas:work_covers(url)")).toEqual(["work_covers"])
  })

  it("aceita template literal — metade dos selects do repo é assim", () => {
    const r = paresNoTexto("sb.from(\"works\").select(`id, calculated_scores(expected_score)`)")
    expect(r).toEqual([{ base: "works", embed: "calculated_scores" }])
  })

  /**
   * 🔴 Sem a janela que para no `.from(` seguinte, o select da 2ª query é atribuído à base da
   * 1ª — e o canário passa a conferir a forma de um par que não existe, contra um banco que
   * responde 400. Erro que produz relatório.
   */
  it("não atribui o select de uma query à base da query anterior", () => {
    // ⚠️ A 1ª query NÃO pode ter `.select(` — com ele, o parser para nele de qualquer jeito e o
    // caso passa mesmo sem a janela. Foi assim que a primeira versão deste teste nasceu
    // inofensiva: ela descrevia o defeito certo e exercitava um caminho que não o alcança
    // (conferido com sonda: removendo a janela, ela seguia verde).
    const r = paresNoTexto(`
      await sb.from("primeira").delete().eq("id", x)
      const { data } = await sb.from("segunda").select("id, work_tags(tag_id)")
    `)
    expect(r).toEqual([{ base: "segunda", embed: "work_tags" }])
  })

  /**
   * 🔴 Este caso é uma sonda que me desmentiu: `${cols.join(", ")}` dentro de um template de
   * select entrava no inventário como se existisse uma relação chamada "join", e o canário
   * reprovava com HTTP 400 sobre uma tabela que ninguém escreveu. Chamada de método tem PONTO
   * antes; relação, não.
   */
  it("não confunde chamada de método com relação embutida", () => {
    expect(embedsDoSelect("id, ${COLUNAS.join(\", \")}, work_tags(tag_id)")).toEqual(["work_tags"])
    expect(embedsDoSelect("id, ${xs.map((x) => x.k)}")).toEqual([])
  })

  it("o inventário do repo não está vazio — sanidade contra o parser virar no-op", () => {
    // Sem isto, um rename faria `paresNoTexto` devolver [] e a metade embed do canário passaria
    // por vacuidade: "31 pares conferidos" viraria "0 pares conferidos", com ✅ no fim.
    const src = readFileSync(join(process.cwd(), "server/queries/ranking.ts"), "utf8")
    expect(paresNoTexto(src).length).toBeGreaterThan(0)
  })
})

/**
 * A tabela `FORMAS` do canário é o lado CONGELADO da comparação. Ela não pode encolher em
 * silêncio: um par apagado dali deixa de ser conferido, e o relatório continua verde.
 */
describe("a tabela de formas do canário", () => {
  const src = readFileSync(join(process.cwd(), "scripts/contratos-postgrest.mjs"), "utf8")
  const bloco = src.match(/const FORMAS = \{([\s\S]*?)\n\}/)?.[1] ?? ""
  const pares = [...bloco.matchAll(/"([a-z_]+→[a-z_]+)":\s*"(ARRAY|OBJETO)"/g)]

  it(`declara a forma de cada par, e só ARRAY ou OBJETO (hoje ${pares.length})`, () => {
    expect(pares.length).toBeGreaterThan(25)
    // Toda linha do bloco que parece declaração tem que ter casado o padrão acima — senão há
    // entrada com forma escrita de outro jeito, que o canário leria como par sem declaração.
    const linhas = bloco.split("\n").filter((l) => l.trim().startsWith('"'))
    expect(linhas.length).toBe(pares.length)
  })

  it("nenhum par declarado duas vezes — a 2ª cópia venceria em silêncio", () => {
    const nomes = pares.map((m) => m[1])
    expect(new Set(nomes).size).toBe(nomes.length)
  })
})

/**
 * 🔴 Ausência de dado é ERRO, nunca sucesso — a mesma régua da zero-linha nas RPCs. Um canário
 * que aprova o que não olhou é exatamente o defeito que ele existe para pegar, aplicado a ele
 * mesmo.
 *
 * ⚠️ Estes ramos NÃO têm como rodar contra o banco: o clone local não tem tabela base vazia
 * (conferido em 6 candidatas). Por isso a decisão foi extraída do fetch — deixá-la sem teste
 * seria confiar justo no caminho que impede o canário de passar sem olhar.
 */
describe("a forma só é aceita quando houve o que olhar", () => {
  it("array de objetos → ARRAY; objeto → OBJETO", () => {
    expect(classificarForma([{ tags: [{ id: 1 }] }], "tags")).toEqual({ forma: "ARRAY" })
    expect(classificarForma([{ tags: { id: 1 } }], "tags")).toEqual({ forma: "OBJETO" })
  })

  it("array VAZIO ainda é uma forma — to-many sem filho não é ausência de dado", () => {
    expect(classificarForma([{ tags: [] }], "tags")).toEqual({ forma: "ARRAY" })
  })

  /**
   * ⚠️ Os dois casos reprovam, e o DIAGNÓSTICO tem que ser diferente: "a base está vazia" manda
   * popular o clone, "o embed veio nulo" manda escolher outra amostra. Exigir só `erro`
   * truthy deixa o guard da base vazia sem rede — o fluxo cairia no guard seguinte e daria a
   * mensagem errada, com o teste verde (conferido com sonda).
   */
  it("base sem linha e embed todo-nulo REPROVAM, com diagnósticos DISTINTOS", () => {
    const vazia = classificarForma([], "tags")
    const nula = classificarForma([{ tags: null }, { tags: null }], "tags")
    expect(vazia.erro).toBeTruthy()
    expect(nula.erro).toBeTruthy()
    expect(vazia.erro).not.toBe(nula.erro)
    expect(vazia.erro).toMatch(/linha/)
  })

  it("basta UMA linha com o embed preenchido — a amostra é de 3", () => {
    expect(classificarForma([{ tags: null }, { tags: { id: 1 } }], "tags")).toEqual({ forma: "OBJETO" })
  })
})
