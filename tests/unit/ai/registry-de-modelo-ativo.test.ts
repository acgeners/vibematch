import { describe, it, expect } from "vitest"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import { ACTIVE_MODELS } from "@/lib/ai/models"
import { priceForModel } from "@/lib/ai/pricing"
import { AI_OPERATION_KEYS, AI_OPERATIONS } from "@/lib/ai-observability/types"

/**
 * A1b-fix.2 — os TRÊS tiers ativos passam a ter um dono só (`lib/ai/models.ts`).
 *
 * O Sonnet já tinha (`SONNET_MODEL`, 25 importadores). Haiku e Opus eram escolhidos por
 * literais independentes espalhados: 9 seletores Haiku e 4 Opus, todos com o mesmo valor
 * hoje e cada um decidindo sozinho. Não era drift observado — era fragmentação de
 * ownership, o estado em que o próximo bump acerta metade dos lugares.
 *
 * 🔴 O par que mais dói é UI × servidor: `server/actions/ai.ts` ENVIA o Opus e o
 * `ai-evaluation-review-form` COMPARA contra ele para esconder o botão "Reavaliar com
 * Opus". Subir para 4.8 no servidor e esquecer o componente deixa o botão visível depois
 * de uma reavaliação Opus — oferecendo de novo uma ação PAGA que acabou de rodar.
 *
 * ⚠️ Este guard NÃO proíbe literal de modelo no repositório. Versão exata é parte do dado
 * em medição (`confidence-ruler`), em experimento congelado (`synopsis-interest/*`), em
 * piloto, em fixture e em teste. O escopo é RUNTIME OPERACIONAL, e a allowlist é nominal.
 *
 * 🔴 **O matcher procura ID VERSIONADO do provider, não os valores correntes de
 * `ACTIVE_MODELS`** — e essa é a diferença que faz o guard sobreviver a um bump. Procurando
 * só o valor de hoje, o dia em que `ACTIVE_MODELS.haiku` virasse `haiku-4-6` tornaria
 * INVISÍVEL todo seletor esquecido em `haiku-4-5`: o literal stale deixaria de pertencer ao
 * conjunto buscado exatamente quando passa a estar errado. É o drift que o registry existe
 * para impedir, e ele entraria pela porta do próprio guard.
 *
 * ⚠️ Rótulo genérico ("Haiku", "Sonnet") NÃO é ID e não dispara — o padrão exige o prefixo
 * `claude-`, a família e um dígito de versão.
 */

// Código que ESCOLHE modelo em execução. `scripts/` fica fora: lá o literal é ferramenta
// de comparação (`compare-models`, `synopsis-prompt-lab`) e reprodutibilidade de piloto.
const DIRS = ["lib", "server", "app", "components"]
const EXT = /\.(ts|tsx)$/

/**
 * Exceções: arquivos de runtime cujo literal versionado é DADO, não escolha operacional.
 *
 * 🔴 **É o conjunto EXATO das violações legítimas de hoje** — nada preventivo. Entrada que
 * o matcher não encontrar mais reprova pedindo remoção (ver o caso de autopoliciamento):
 * allowlist que sobrevive ao próprio motivo é como a varredura ganha um buraco calado.
 */
const PINADOS: Record<string, string> = {
  "lib/ai-evaluation/confidence-ruler.ts":
    "HISTORICAL_DATA — `OBSERVED_CONFIDENCE_MAX` é teto de confiança MEDIDO por modelo (max + n, ex. sonnet-4-6 n=1500). O ID é a chave do dado; derivar do registry faria uma medição antiga afirmar o modelo de hoje",
  "lib/synopsis-interest/digest-text-only.ts":
    "PINNED_EXPERIMENT — `EXPERIMENT_DIGEST_MODEL` está no bloco de versões CONGELADAS que compõem a assinatura de reprodutibilidade do experimento de digest",
  "lib/synopsis-interest/experiment.ts":
    "PINNED_EXPERIMENT — `CANDIDATES` é registro CONGELADO (s0/s1/b1/e1); o comentário exige preservar EXATAMENTE a identidade de assinatura do snapshot base-1",
  "lib/synopsis-interest/snapshot.ts":
    "PINNED_EXPERIMENT — `SNAPSHOT_VERSIONS` do golden, congelado por construção junto das demais versões do snapshot-base",
}

function arquivos(dir: string, out: string[] = []): string[] {
  let entradas: string[]
  try {
    entradas = readdirSync(dir)
  } catch {
    return out
  }
  for (const e of entradas) {
    if (e === "node_modules" || e.startsWith(".")) continue
    const p = join(dir, e)
    if (statSync(p).isDirectory()) arquivos(p, out)
    else if (EXT.test(e)) out.push(p)
  }
  return out
}

/**
 * Remove comentários PRESERVANDO a numeração de linha — o teste reporta `arquivo:linha`, e
 * colapsar um bloco desloca tudo o que vem depois (medido: apontava a linha 40 para um
 * literal que está na 48).
 *
 * ⚠️ Comentário de FIM de linha precisa sair também: `model: string // "claude-sonnet-4-6"`
 * é documentação, não seletor, e sem isto vira falso positivo. A remoção só acontece quando
 * as aspas ANTES do `//` estão balanceadas — assim um `//` dentro de string não é
 * confundido com comentário. Na dúvida NÃO remove: sobra um falso positivo (barulhento,
 * decidido por gente) em vez de um falso negativo (calado, que é o que o guard existe para
 * não ser).
 */
function semComentarios(src: string): string {
  const semBloco = src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
  return semBloco
    .split("\n")
    .map((linha) => {
      for (let i = 0; i < linha.length - 1; i++) {
        if (linha[i] !== "/" || linha[i + 1] !== "/") continue
        const antes = linha.slice(0, i)
        const balanceado = (["\"", "'", "`"] as const).every(
          (q) => (antes.match(new RegExp(`(?<!\\\\)\\${q}`, "g")) ?? []).length % 2 === 0,
        )
        if (balanceado) return antes
      }
      return linha
    })
    .join("\n")
}

/** Qualquer literal de string com prefixo `claude-`. NÃO conhece família nenhuma. */
const LITERAL_CLAUDE = /["'](claude-[A-Za-z0-9.[\]-]+)["']/g

/**
 * Decide se um literal `claude-*` tem FORMA de ID versionado do provider: algum segmento
 * depois de `claude-` começa com dígito (número de versão ou carimbo de data).
 *
 * 🔴 **Deliberadamente sem lista de famílias.** Um padrão como
 * `claude-(sonnet|haiku|opus)-\d` amarra o guard à nomenclatura de HOJE e à posição da
 * família — e o provider já usou outra: `claude-3-5-sonnet-20241022` põe a versão ANTES do
 * nome. Enumerar famílias faria uma nomenclatura nova exigir editar o guard para ele voltar
 * a funcionar, e ninguém edita um guard que está verde. Quais modelos estão ATIVOS é
 * responsabilidade do registry; aqui a pergunta é só "isto tem forma de ID versionado?".
 *
 * Reconhece: `claude-sonnet-5` · `claude-haiku-4-5-20251001` · `claude-opus-4-7` ·
 * `claude-3-5-sonnet-20241022` · `claude-opus-5[1m]`.
 * Recusa: `"Haiku"`, `"Sonnet"` (sem o prefixo) e `claude-code` (sem componente numérico).
 */
function pareceIdVersionado(literal: string): boolean {
  return literal
    .slice("claude-".length)
    .split("-")
    .some((segmento) => /^\d/.test(segmento))
}

interface Violacao {
  arquivo: string
  linha: number
  modelo: string
}

/** TODO literal versionado em código operacional, fora do dono — allowlist ainda não aplicada. */
function literaisVersionados(): Violacao[] {
  const achados: Violacao[] = []
  for (const d of DIRS) {
    for (const f of arquivos(join(process.cwd(), d))) {
      const rel = f.slice(process.cwd().length + 1)
      if (rel === DONO) continue
      semComentarios(readFileSync(f, "utf8"))
        .split("\n")
        .forEach((ln, i) => {
          LITERAL_CLAUDE.lastIndex = 0
          for (const m of ln.matchAll(LITERAL_CLAUDE)) {
            if (pareceIdVersionado(m[1])) achados.push({ arquivo: rel, linha: i + 1, modelo: m[1] })
          }
        })
    }
  }
  return achados
}

const DONO = "lib/ai/models.ts"
const TODAS = literaisVersionados()

describe("registry de modelo ATIVO", () => {
  it("nenhum seletor de runtime escreve VERSÃO de modelo à mão", () => {
    const soltos = TODAS.filter((v) => !(v.arquivo in PINADOS))
    expect(
      soltos.map((v) => `${v.arquivo}:${v.linha} → ${v.modelo}`),
      "use ACTIVE_MODELS (ou SONNET_MODEL); se for medição/experimento, declare em PINADOS com motivo",
    ).toEqual([])
  })

  it("o matcher pega VERSÃO ANTIGA, não só o valor corrente do registry", () => {
    // A prova de que o guard sobrevive a um bump. Sem isto, trocar `ACTIVE_MODELS.haiku`
    // tornaria invisível todo seletor esquecido na versão anterior — o literal sairia do
    // conjunto buscado no mesmo instante em que passa a estar errado.
    const ativos = new Set<string>(Object.values(ACTIVE_MODELS))
    const antigos = TODAS.filter((v) => !ativos.has(v.modelo))
    expect(antigos.length, "nenhum ID antigo no escopo — o matcher não está sendo exercitado")
      .toBeGreaterThan(0)
  })

  it("reconhece ID versionado em QUALQUER nomenclatura, e recusa rótulo", () => {
    // 🔴 Os dois primeiros são o formato HISTÓRICO da Anthropic, com a versão ANTES da
    // família. Um matcher que exigisse `claude-(sonnet|haiku|opus)-\d` não os veria — e é
    // justamente um ID em formato antigo que sobra esquecido depois de uma troca.
    const deveCasar = [
      "claude-3-5-sonnet-20241022",
      "claude-3-5-haiku-20241022",
      "claude-sonnet-5",
      "claude-haiku-4-5-20251001",
      "claude-opus-4-7",
      "claude-opus-5[1m]",
    ]
    for (const id of deveCasar) {
      expect(pareceIdVersionado(id), `${id} deveria ser reconhecido como ID versionado`).toBe(true)
      expect(`"${id}"`, `${id} não casou o literal`).toMatch(LITERAL_CLAUDE)
      LITERAL_CLAUDE.lastIndex = 0
    }

    // Rótulo de UI e slug sem versão NÃO são ID — acusá-los tornaria o guard ruído.
    for (const nao of ["Haiku", "Sonnet", "Opus", "claude", "Claude Sonnet 4.6"]) {
      expect(`"${nao}"`, `${nao} não deveria casar o prefixo`).not.toMatch(LITERAL_CLAUDE)
      LITERAL_CLAUDE.lastIndex = 0
    }
    expect(pareceIdVersionado("claude-code"), "slug sem componente numérico").toBe(false)
  })

  it(`cada exceção é LOAD-BEARING e justificada (hoje ${Object.keys(PINADOS).length})`, () => {
    // 🔴 Nada preventivo: a allowlist é o conjunto EXATO das violações legítimas de hoje.
    // Entrada que o matcher não encontra mais é allowlist fantasma — some do radar e passa
    // a autorizar um arquivo que ninguém conferiu.
    for (const [arquivo, motivo] of Object.entries(PINADOS)) {
      const achadosNoArquivo = TODAS.filter((v) => v.arquivo === arquivo)
      expect(
        achadosNoArquivo.length,
        `${arquivo}: o matcher não acha literal versionado aqui — exceção STALE, remova de PINADOS`,
      ).toBeGreaterThan(0)
      expect(motivo.split(/\s+/).length, `${arquivo} sem motivo de verdade`).toBeGreaterThan(6)
      expect(motivo, `${arquivo} sem classificação`).toMatch(/HISTORICAL_DATA|PINNED_EXPERIMENT/)
    }
  })

  it("toda exceção aponta para arquivo que EXISTE", () => {
    for (const arquivo of Object.keys(PINADOS)) {
      expect(() => readFileSync(join(process.cwd(), arquivo), "utf8"), arquivo).not.toThrow()
    }
  })

  it("o Sonnet não é duplicado: ACTIVE_MODELS.sonnet É o SONNET_MODEL", async () => {
    const { SONNET_MODEL } = await import("@/lib/ai/models")
    expect(ACTIVE_MODELS.sonnet).toBe(SONNET_MODEL)
  })

  it("os três tiers são distintos e não vazios", () => {
    const v = Object.values(ACTIVE_MODELS)
    expect(new Set(v).size).toBe(v.length)
    for (const m of v) expect(m).toMatch(/^claude-/)
  })

  it("todo modelo ACTIVE tem pricing conhecido HOJE", () => {
    // Usa o resolvedor real. Sem preço, `computeCostUsd` devolve `unknown@…` e grava
    // custo ZERO em `ai_api_calls`, em silêncio — e o gate vira Infinity.
    for (const [tier, modelo] of Object.entries(ACTIVE_MODELS)) {
      const p = priceForModel(modelo)
      expect(p, `${tier} (${modelo}) sem janela de preço vigente`).not.toBeNull()
      expect(p!.inputPerMTok, `${tier} com input grátis?`).toBeGreaterThan(0)
      expect(p!.outputPerMTok, `${tier} com output grátis?`).toBeGreaterThan(0)
    }
  })

  it("operação ATIVA declara um modelo do registry; APOSENTADA não declara nenhum", () => {
    const ativos = new Set<string>(Object.values(ACTIVE_MODELS))
    for (const k of AI_OPERATION_KEYS) {
      const def = AI_OPERATIONS[k]
      if (def.status === "active") {
        // Não força Sonnet: Haiku ativo é legítimo nas operações baratas medidas.
        expect(ativos.has(def.defaultModel), `${k} declara modelo fora do registry ativo`).toBe(true)
      } else {
        expect(
          Object.prototype.hasOwnProperty.call(def, "defaultModel"),
          `${k} é aposentada e voltou a declarar modelo`,
        ).toBe(false)
      }
    }
  })
})
