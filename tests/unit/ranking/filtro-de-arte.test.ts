import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import {
  ART_FILTER_CHIP_LABELS,
  ART_FILTER_ORDER,
  ART_FILTER_PARAM,
  ART_FILTER_PERCENTS,
  ART_FILTER_SEGMENT_LABELS,
  ART_FILTER_TOOLTIPS,
  artFilterMatches,
  parseArtFilter,
} from "@/lib/art/url"
import { ART_BAND_CUTOFFS, ART_BAND_LABELS } from "@/lib/art/bands"
import { CRITERION_SLUGS } from "@/types/domain"

const raiz = process.cwd()
const ler = (rel: string) => readFileSync(join(raiz, rel), "utf-8")

describe("parseArtFilter", () => {
  it("aceita só os dois valores do contrato", () => {
    expect(parseArtFilter("forte")).toBe("forte")
    expect(parseArtFilter("sem_fraca")).toBe("sem_fraca")
  })

  it("valor desconhecido vira undefined, não um filtro qualquer", () => {
    // Um fallback silencioso aqui filtraria o catálogo por algo que ninguém pediu.
    for (const lixo of ["8", "media", "true", "", null, undefined, "FORTE"]) {
      expect(parseArtFilter(lixo)).toBeUndefined()
    }
  })
})

describe("artFilterMatches — a assimetria do 'sem estimativa'", () => {
  it("sem filtro, tudo passa (inclusive quem não tem estimativa)", () => {
    for (const b of ["forte", "media", "fraca", null] as const) {
      expect(artFilterMatches(b, undefined)).toBe(true)
    }
  })

  it("'forte' é POSITIVO: quem não tem estimativa NÃO passa", () => {
    // Ninguém apurou que a arte dela é forte — aceitar desconhecido devolveria o que a
    // pessoa não pediu.
    expect(artFilterMatches("forte", "forte")).toBe(true)
    expect(artFilterMatches("media", "forte")).toBe(false)
    expect(artFilterMatches("fraca", "forte")).toBe(false)
    expect(artFilterMatches(null, "forte")).toBe(false)
  })

  it("'sem_fraca' é NEGATIVO: quem não tem estimativa CONTINUA passando", () => {
    // Esconder o que nunca foi medido apagaria 2,4% do catálogo — e 100% antes da semente
    // do sinal, quando `art_signal` ainda é NULL em todas as obras.
    expect(artFilterMatches("forte", "sem_fraca")).toBe(true)
    expect(artFilterMatches("media", "sem_fraca")).toBe(true)
    expect(artFilterMatches("fraca", "sem_fraca")).toBe(false)
    expect(artFilterMatches(null, "sem_fraca")).toBe(true)
  })

  it("os dois lados NÃO tratam o nulo igual — é isto que regride calado", () => {
    expect(artFilterMatches(null, "forte")).not.toBe(artFilterMatches(null, "sem_fraca"))
  })
})

describe("o contrato de URL", () => {
  it("o parâmetro fica FORA da família min_<slug>/max_<slug>", () => {
    // Aquela query string é contrato dos 9 atributos e fala PONTOS. A estimativa de arte é
    // comprimida a ~0,49x a escala do rótulo: lida como pontos, `min_art=8` devolveria 56%
    // do catálogo onde a taxa real é 75% — filtro nenhum, com resultado plausível.
    expect(ART_FILTER_PARAM.startsWith("min_")).toBe(false)
    expect(ART_FILTER_PARAM.startsWith("max_")).toBe(false)
    for (const slug of CRITERION_SLUGS) {
      expect(ART_FILTER_PARAM).not.toBe(`min_${slug}`)
      expect(ART_FILTER_PARAM).not.toBe(`max_${slug}`)
    }
  })

  it("os valores do parâmetro são DISCRETOS — nada numérico na URL", () => {
    // Valor discreto não tem unidade pra confundir: um consumidor que não conheça o
    // parâmetro o ignora, em vez de o interpretar na régua errada.
    for (const v of Object.keys(ART_FILTER_SEGMENT_LABELS)) {
      expect(Number.isNaN(Number(v))).toBe(true)
    }
  })

  it("os rótulos dizem que é ESTIMATIVA — o chip por escrito, o controle pelo tooltip", () => {
    // Sem isso a tela promete "arte forte" como fato — e no topo 20% do estimador quase
    // metade das obras não tem arte >= 9. O botão é curto demais pra caber a ressalva
    // (o segmentado divide ~200px com um rótulo de 96px), então quem a carrega é o
    // tooltip, e ele reusa o nome da faixa que o card da obra já imprime.
    for (const txt of Object.values(ART_FILTER_CHIP_LABELS)) {
      expect(txt.toLowerCase()).toMatch(/est\./)
    }
    expect(ART_FILTER_TOOLTIPS.forte).toContain(ART_BAND_LABELS.forte)
    expect(ART_FILTER_TOOLTIPS.sem_fraca).toContain(ART_BAND_LABELS.fraca)
    for (const txt of Object.values(ART_FILTER_TOOLTIPS)) {
      expect(txt.toLowerCase()).toMatch(/provavelmente/)
    }
  })

  it("o tooltip nunca perde a frase do 'sem estimativa' — é o que não se deduz da tela", () => {
    // Os dois filtros tratam o desconhecido ao CONTRÁRIO um do outro (ver artFilterMatches).
    // Encurtar o texto por cima dessa frase deixa a assimetria invisível.
    expect(ART_FILTER_TOOLTIPS.forte).toMatch(/SEM estimativa fica de fora/)
    expect(ART_FILTER_TOOLTIPS.sem_fraca).toMatch(/SEM estimativa CONTINUA aparecendo/)
  })
})

describe("os rótulos do controle DERIVAM dos cortes de faixa", () => {
  it("o % impresso sai de ART_BAND_CUTOFFS, não de um literal", () => {
    // 🔴 O número no botão e o número que corta a faixa são o MESMO fato. Escritos em dois
    // lugares, mudar o corte deixa o botão mentindo — sem erro e sem log.
    expect(ART_FILTER_PERCENTS.fraca).toBe(Math.round(ART_BAND_CUTOFFS.fraca * 100))
    expect(ART_FILTER_PERCENTS.forte).toBe(Math.round((1 - ART_BAND_CUTOFFS.forte) * 100))
    expect(ART_FILTER_SEGMENT_LABELS.forte).toContain(String(ART_FILTER_PERCENTS.forte))
    // 🔴 O botão do "sem_fraca" NÃO imprime número, e isso é medido: com ele o segmentado vai
    // a 241px contra 218px de orçamento e a linha do card quebra. Quem carrega o corte de
    // baixo é o TOOLTIP — botão sem número não tem como mentir sobre o corte.
    expect(ART_FILTER_SEGMENT_LABELS.sem_fraca).not.toMatch(/\d/)
    expect(ART_FILTER_TOOLTIPS.sem_fraca).toContain(String(ART_FILTER_PERCENTS.fraca))
  })

  it("os dois botões não podem cair no MESMO texto", () => {
    // Dois filtros OPOSTOS com o mesmo nome não quebram nada visível: o segmentado continua com
    // três botões e a URL segue certa. Só a pessoa é que não consegue escolher.
    expect(ART_FILTER_SEGMENT_LABELS.sem_fraca).not.toBe(ART_FILTER_SEGMENT_LABELS.forte)
    expect(ART_FILTER_CHIP_LABELS.sem_fraca).not.toBe(ART_FILTER_CHIP_LABELS.forte)
  })

  it("sem número, o botão chama a FAIXA pelo nome que o card da obra usa", () => {
    // Sem número, a única forma de este botão mentir é a faixa ser renomeada e ele ficar pra
    // trás — "Sem fracas" sobre uma faixa que o resto do app passou a chamar de outra coisa.
    // `ART_BAND_LABELS` é o dono do nome; as três superfícies têm que segui-lo.
    const nucleo = "frac"
    expect(ART_BAND_LABELS.fraca.toLowerCase()).toContain(nucleo)
    expect(ART_FILTER_SEGMENT_LABELS.sem_fraca.toLowerCase()).toContain(nucleo)
    expect(ART_FILTER_CHIP_LABELS.sem_fraca.toLowerCase()).toContain(nucleo)
  })

  it("o chip do filtro ativo repete o que o BOTÃO diz", () => {
    // Chip com um nome e botão com outro, a dois centímetros um do outro, é a família que já
    // deu três nomes à previsão de Interesse. Cada lado repete o seu identificador: o número,
    // no que tem número; a faixa, no que não tem.
    expect(ART_FILTER_CHIP_LABELS.forte).toContain(String(ART_FILTER_PERCENTS.forte))
    expect(ART_FILTER_CHIP_LABELS.sem_fraca).not.toMatch(/\d/)
  })

  it("o painel monta os botões a partir da ORDEM, sem enumerar os três à mão", () => {
    // Enumerados no JSX, o mais restritivo ficou no MEIO por meses: "Forte" (topo 20%) vinha
    // antes de "Sem fraca" (que corta só o fundo 20%). Um segmentado é lido como escala.
    const painel = ler("components/ranking/ranking-filters.tsx")
    expect(painel).toContain("ART_FILTER_ORDER.map(")
    expect(painel).not.toMatch(/label="Sem fraca"/)
    expect(painel).not.toMatch(/label="Forte"/)
  })

  it("a ordem é de exigência CRESCENTE: nenhum filtro, corta o fundo, só o topo", () => {
    expect([...ART_FILTER_ORDER]).toEqual([undefined, "sem_fraca", "forte"])
  })
})

describe("o controle só aparece pra quem TEM estimativa", () => {
  it("é gateado por dono nas duas páginas que montam o painel", () => {
    // Sem o gate, um visitante vê "Arte (estimada)" e o "Forte" devolve lista vazia — que
    // ele lê como "não existe obra com arte forte", não como "isso não é pra mim".
    for (const pagina of ["app/ranking/page.tsx", "app/favorites/[listId]/page.tsx"]) {
      expect(ler(pagina), `${pagina} não passa showArtFilter`).toContain("showArtFilter=")
    }
    const painel = ler("components/ranking/ranking-filters.tsx")
    expect(painel).toContain("{showArtFilter && (")
  })

  it("o chip de filtro ativo morre junto do controle", () => {
    // Chip sem controle é um filtro aplicado que a pessoa não consegue desfazer no painel.
    const painel = ler("components/ranking/ranking-filters.tsx")
    expect(painel).toContain('if (showArtFilter && artMode !== "off")')
  })
})

describe("a estimativa em PONTOS não pode chegar à tela", () => {
  it("o select do /ranking pede art_percentile e NÃO art_estimate", () => {
    // Não trazer o valor cru é o que impede alguém de exibi-lo como se fosse nota: a
    // proteção é a ausência do dado, não uma convenção que alguém precise lembrar.
    const src = ler("server/queries/ranking.ts")
    const select = src.match(/calculated_scores\([^)]*\)/)
    expect(select, "o embed de calculated_scores mudou de forma — reveja este teste").toBeTruthy()
    expect(select![0]).toContain("art_percentile")
    expect(select![0]).not.toContain("art_estimate")
  })

  it("nenhum componente de ranking lê artEstimate", () => {
    const src = ler("components/ranking/ranking-filters.tsx")
    expect(src).not.toContain("artEstimate")
  })
})

describe("a ordenação por arte existe nas DUAS listas", () => {
  it("o campo do painel está na whitelist da página — senão cai em silêncio no default", () => {
    // A whitelist de `app/ranking/page.tsx` espelha `RankingSortBy` à mão, e o próprio
    // comentário dela registra que já houve queda silenciosa pro default por essa causa.
    const painel = ler("components/ranking/ranking-filters.tsx")
    const pagina = ler("app/ranking/page.tsx")

    const grupos = painel.match(/const SORTABLE_FIELD_GROUPS[\s\S]*?\n\]\n/)
    expect(grupos, "SORTABLE_FIELD_GROUPS mudou de forma — reveja este teste").toBeTruthy()
    const campos = [...grupos![0].matchAll(/value:\s*"([a-z_]+)"/g)].map((m) => m[1])
    expect(campos.length).toBeGreaterThan(10)
    expect(campos).toContain("art")

    const whitelist = pagina.match(/const validSortFields[\s\S]*?\n\s*\]\)/)
    expect(whitelist, "validSortFields mudou de forma — reveja este teste").toBeTruthy()
    for (const campo of campos) {
      expect(whitelist![0], `"${campo}" está no painel mas falta na whitelist da página`).toContain(
        `"${campo}"`,
      )
    }
  })

  it("arte é campo PESSOAL de ordenação — sem modelo, não ordena por ela", () => {
    // A estimativa vem dos rótulos do dono. Para quem não é ele, `artPercentile` é null em
    // todas as linhas, e ordenar por um campo todo-null devolve o catálogo em ordem
    // arbitrária com cara de "ordenado por arte".
    const src = ler("server/queries/ranking.ts")
    const bloco = src.match(/const PERSONAL_SORT_FIELDS[\s\S]*?\n\s*\]\)/)
    expect(bloco).toBeTruthy()
    expect(bloco![0]).toContain('"art"')
  })
})
