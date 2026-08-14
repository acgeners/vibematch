import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, it, expect, vi, afterEach } from "vitest"
import {
  DEFAULT_TIER_BAND_WIDTH,
  tierBandWidthSchema,
  resolveTierBandWidth,
} from "@/lib/ranking/tier-config"
import { buildRankingTiers } from "@/lib/ranking/build-tiers"

afterEach(() => vi.restoreAllMocks())

describe("DEFAULT_TIER_BAND_WIDTH", () => {
  /**
   * Este número não é gosto: saiu da medição documentada no módulo — honestidade
   * pairwise (53,3% em 0,25 contra 57,9% em 0,50) desempatada por estabilidade
   * sob reamostragem (± 0,7 em 0,25, o menor de todos). O teste existe para que
   * mudá-lo exija mexer aqui e reencontrar a medição, em vez de trocar a
   * constante em silêncio.
   */
  it("é 0,25 — o valor medido, não o provisório 0,5", () => {
    expect(DEFAULT_TIER_BAND_WIDTH).toBe(0.25)
  })

  it("está dentro do range aceito pelo schema (e pelo CHECK da migration 104)", () => {
    expect(tierBandWidthSchema.safeParse(DEFAULT_TIER_BAND_WIDTH).success).toBe(true)
  })

  it("é menor que o cv_mae do modelo (~0,69) — banda não é erro de calibração", () => {
    // Com Δ 0,7 a Prevista já ordena 61% dos pares certo: usar o MAE como banda
    // agruparia obras que o modelo sabe separar. Ver o docstring do módulo.
    expect(DEFAULT_TIER_BAND_WIDTH).toBeLessThan(0.69)
  })
})

/**
 * 🔴 O código e o BANCO afirmam a mesma coisa, e quem vence é o banco.
 *
 * `resolveTierBandWidth` só usa a constante quando o valor persistido é ausente — e a
 * coluna é NOT NULL. Então a constante sozinha não põe nada em vigor: quem manda é o
 * DEFAULT da coluna (para banco novo) mais a linha existente.
 *
 * Foi exatamente aqui que a medição de 2026-08-06 se perdeu. A constante foi para 0,25,
 * a mensagem do commit anunciou o UPDATE, e o UPDATE nunca rodou: uma semana depois
 * LOCAL e NUVEM ainda estavam em 0,5 — o valor que a própria medição havia reprovado —
 * com a suíte verde e nada acusando, porque nenhum teste olhava o outro lado do par.
 *
 * Este teste DERIVA o default do banco da migration mais recente que o define, em vez
 * de repetir o número: migration nova que mexa na coluna entra na checagem sozinha.
 */
describe("o DEFAULT da coluna e a constante do código são o mesmo número", () => {
  const dir = join(process.cwd(), "supabase/migrations")

  /** A migration de maior número que define um DEFAULT para `tier_band_width`. */
  function defaultVigenteNaMigration(): { arquivo: string; valor: number } {
    const encontrados = readdirSync(dir)
      .filter((f) => f.endsWith(".sql"))
      .map((arquivo) => {
        const sql = readFileSync(join(dir, arquivo), "utf8")
        // Pega tanto `ADD COLUMN tier_band_width numeric NOT NULL DEFAULT x` quanto
        // `ALTER COLUMN tier_band_width SET DEFAULT x`. Comentários com "DEFAULT" no
        // meio da prosa não casam: exige o nome da coluna antes, na mesma statement.
        const stmt = sql
          .split(";")
          .map((s) => s.replace(/^\s*--.*$/gm, ""))
          .find((s) => /tier_band_width/.test(s) && /\bdefault\s+[\d.]+/i.test(s))
        if (!stmt) return null
        const valor = Number(/\bdefault\s+([\d.]+)/i.exec(stmt)?.[1])
        const num = Number(arquivo.split("_")[0])
        return Number.isFinite(valor) && Number.isFinite(num) ? { arquivo, valor, num } : null
      })
      .filter((x): x is { arquivo: string; valor: number; num: number } => x != null)
      .sort((a, b) => a.num - b.num)

    const ultima = encontrados.at(-1)
    if (!ultima) throw new Error("nenhuma migration define DEFAULT para tier_band_width")
    return { arquivo: ultima.arquivo, valor: ultima.valor }
  }

  it("um banco criado do zero nasce com a banda medida", () => {
    const { arquivo, valor } = defaultVigenteNaMigration()
    expect(
      valor,
      `${arquivo} deixa a coluna em ${valor}, mas DEFAULT_TIER_BAND_WIDTH é ${DEFAULT_TIER_BAND_WIDTH}`
    ).toBe(DEFAULT_TIER_BAND_WIDTH)
  })

  it("a migration que troca o DEFAULT também corrige a linha existente", () => {
    // Trocar só o DEFAULT não move o banco que já existe — e é o banco que já existe
    // que serve o /ranking hoje.
    const { arquivo } = defaultVigenteNaMigration()
    const sql = readFileSync(join(dir, arquivo), "utf8")
    if (!/set\s+default/i.test(sql)) return // a 104 cria a coluna; nada a atualizar
    expect(sql).toMatch(/update\s+formula_config[\s\S]*tier_band_width\s*=/i)
  })
})

describe("resolveTierBandWidth", () => {
  it("usa o default quando não há valor persistido", () => {
    expect(resolveTierBandWidth(null)).toBe(DEFAULT_TIER_BAND_WIDTH)
    expect(resolveTierBandWidth(undefined)).toBe(DEFAULT_TIER_BAND_WIDTH)
  })

  it("aceita numeric do Postgres chegando como string", () => {
    expect(resolveTierBandWidth("0.25")).toBe(0.25)
    expect(resolveTierBandWidth("0.3")).toBe(0.3)
  })

  it("respeita um valor válido persistido, sem forçar o default", () => {
    expect(resolveTierBandWidth(0.2)).toBe(0.2)
    expect(resolveTierBandWidth(1.5)).toBe(1.5)
  })

  it("valor inválido cai no default e AVISA — não é mascarado", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    expect(resolveTierBandWidth(0.01)).toBe(DEFAULT_TIER_BAND_WIDTH)
    expect(resolveTierBandWidth(5)).toBe(DEFAULT_TIER_BAND_WIDTH)
    expect(resolveTierBandWidth("abacaxi")).toBe(DEFAULT_TIER_BAND_WIDTH)
    expect(warn).toHaveBeenCalledTimes(3)
  })
})

describe("o efeito da banda no agrupamento", () => {
  /**
   * Amostra real do topo do ranking (Nota Prevista, 2026-08-06). Serve para o
   * teste falar do comportamento que o usuário vê, não de números inventados.
   */
  const TOPO = [
    9.11, 8.74, 8.71, 8.65, 8.58, 8.57, 8.55, 8.54, 8.49, 8.48,
    8.46, 8.46, 8.43, 8.43, 8.41, 8.41, 8.36, 8.33, 8.33, 8.3,
  ]
  const sizes = (band: number) => {
    const t = buildRankingTiers(TOPO, (v) => v, band)
    const counts = new Map<number, number>()
    for (const { tier } of t) counts.set(tier, (counts.get(tier) ?? 0) + 1)
    return [...counts.entries()].sort((a, b) => a[0] - b[0]).map(([, n]) => n)
  }

  it("banda menor produz MAIS tiers e um maior tier menor", () => {
    const largo = sizes(0.5)
    const estreito = sizes(DEFAULT_TIER_BAND_WIDTH)
    expect(estreito.length).toBeGreaterThanOrEqual(largo.length)
    expect(Math.max(...estreito)).toBeLessThanOrEqual(Math.max(...largo))
  })

  it("0,3 não estilhaça a lista em tiers de uma obra só", () => {
    const s = sizes(DEFAULT_TIER_BAND_WIDTH)
    // um punhado de tiers unitários é normal (a cauda), mas não pode ser a regra
    expect(s.filter((n) => n === 1).length).toBeLessThan(s.length / 2)
  })

  it("a banda continua sendo um limite INCLUSIVO ancorado na 1ª obra do tier", () => {
    // 8.0 e 7.7 juntos (Δ 0,3 ≤ 0,3); 7.4 fora, porque o tier ancora em 8.0 e
    // não encadeia 8.0↔7.7↔7.4.
    const t = buildRankingTiers([8.0, 7.7, 7.4], (v) => v, 0.3)
    expect(t.map((x) => x.tier)).toEqual([1, 1, 2])
  })
})
