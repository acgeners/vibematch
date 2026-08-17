/**
 * O CONTRATO de URL do filtro de arte — dono único do nome do parâmetro e dos valores.
 *
 * 🔴 Fica FORA da família `min_<slug>`/`max_<slug>` de propósito. Aquela query string é
 * contrato dos 9 atributos e **fala pontos** — `getRanking`, os presets salvos
 * (`ranking_filter_presets` guarda a query CRUA), o `/favorites` e o diálogo de recomendação
 * leem os mesmos limiares sem saber que existe outra unidade. A estimativa de arte é
 * comprimida a ~0,49× a escala do rótulo: um `min_art=8` seria lido como "8 pontos" e
 * devolveria 56% do catálogo onde a taxa real é 75%. Filtro nenhum, sem erro, com resultado
 * plausível — exatamente o bug que `lib/ranking/criterion-unit.ts` documenta.
 *
 * Por isso o valor é DISCRETO (uma faixa, não um número): não tem unidade para confundir, e
 * um consumidor que não conheça o parâmetro simplesmente o ignora em vez de o interpretar
 * errado.
 *
 * ⚠️ Três páginas montam `RankingFilters` a partir da URL (`/ranking`, `/favorites`,
 * `/catalog`). Uma 2ª cópia deste parse é como o filtro passa a valer numa e não na outra.
 */

import { ART_BAND_CUTOFFS, ART_BAND_LABELS } from "./bands"

export const ART_FILTER_PARAM = "art"

export type ArtFilter = "forte" | "sem_fraca"

/**
 * Os dois valores tratam "sem estimativa" ao CONTRÁRIO um do outro — ver `RankingFilters.artFilter`:
 *   "forte"     → só a faixa de cima; obra sem estimativa NÃO passa
 *   "sem_fraca" → esconde a faixa de baixo; obra sem estimativa PASSA
 */
export function parseArtFilter(raw: string | null | undefined): ArtFilter | undefined {
  return raw === "forte" || raw === "sem_fraca" ? raw : undefined
}

/**
 * A regra do filtro, num lugar só — porque a parte sutil dela é a ASSIMETRIA e ela regride
 * calada: trocada, o filtro devolve um recorte plausível e errado, sem erro nem log.
 *
 * | filtro      | faixa forte | media | fraca | SEM estimativa |
 * |-------------|-------------|-------|-------|----------------|
 * | (nenhum)    | passa       | passa | passa | passa          |
 * | "forte"     | passa       | não   | não   | **não**        |
 * | "sem_fraca" | passa       | passa | não   | **passa**      |
 *
 * O "sem estimativa" é o que muda de lado: um filtro POSITIVO que aceita desconhecido devolve
 * o que ninguém pediu; um filtro NEGATIVO que rejeita desconhecido apaga obra que nunca foi
 * medida — 2,4% do catálogo hoje, e 100% antes da semente do sinal.
 */
export function artFilterMatches(
  band: "forte" | "media" | "fraca" | null | undefined,
  filter: ArtFilter | undefined,
): boolean {
  if (!filter) return true
  if (filter === "forte") return band === "forte"
  return band !== "fraca"
}

/**
 * A ORDEM dos três botões do controle, em exigência crescente.
 *
 * 🔴 Não é cosmética: a ordem anterior era `Tudo · Forte · Sem fraca`, com o mais restritivo
 * no MEIO — "Forte" deixa passar o topo 20% e "Sem fraca" corta só o fundo 20%. Um segmentado
 * é lido como escala da esquerda pra direita (o vizinho "Esconder tags evitadas" já é), e
 * quebrar isso faz a pessoa escolher o filtro errado achando que escolheu o do meio.
 */
export const ART_FILTER_ORDER = [undefined, "sem_fraca", "forte"] as const

/**
 * Os percentuais que os rótulos imprimem — DERIVADOS de `ART_BAND_CUTOFFS`, nunca digitados.
 *
 * 🔴 O número no botão e o número que corta a faixa são o MESMO fato. Escritos em dois
 * lugares, mudar o corte deixa o rótulo mentindo em silêncio — a família de erro que este
 * projeto já pagou no `LOW_BALANCE_USD` e na banda dos tiers. `ART_BAND_CUTOFFS.fraca = 0.2`
 * ⇒ "o fundo 20%" (o que o tooltip diz que sai); `forte = 0.8` ⇒ o que sobra acima ⇒ "top 20%".
 *
 * ⚠️ O lado `fraca` só aparece no TOOLTIP — o botão dele nomeia a FAIXA, não a posição (ver
 * `ART_FILTER_SEGMENT_LABELS`). Botão sem número não tem como mentir sobre o corte.
 */
export const ART_FILTER_PERCENTS = {
  fraca: Math.round(ART_BAND_CUTOFFS.fraca * 100),
  forte: Math.round((1 - ART_BAND_CUTOFFS.forte) * 100),
} as const

/**
 * Rótulos do CONTROLE. Curtos porque o segmentado divide ~218px com um rótulo de 96px — o
 * nome longo mora no tooltip, e ele vem de `ART_BAND_LABELS` (o dono desses nomes, usado
 * pelo card da obra), nunca de uma 2ª cópia aqui.
 *
 * 🔴 **"Sem os 20% piores" virou "Sem fracas" (escolha da Ana, 17/08/2026) porque o rótulo
 * longo QUEBRAVA a linha.** O custo estava medido desde o dia em que ele entrou — o segmentado
 * ia de 180 → 249px e a linha quebrava em duas —, e foi aceito como "não estoura o card". Não
 * bastava: a quebra caía na largura de uso. Remedido no browser com a fonte real, o orçamento
 * é **218px** (o que cabe no card de 366px), e o teto útil é **208px**, que é a linha
 * "Conteúdo 18+" — acima disso a arte vira a primeira a quebrar. `Sem fracas · Top 20%` = 205px.
 *
 * 🔴 **A forma dos dois botões é DIFERENTE de propósito, porque os dois filtros são
 * diferentes.** "Sem …" remove uma faixa; "Top …" seleciona um topo. Uma primeira versão usou
 * `Top 80% · Top 20%` — simétrico, 190px e mais curto —, e a simetria mentia: fazia o filtro
 * de baixo parecer SELEÇÃO POSITIVA, quando ele é negativo e deixa passar obra SEM estimativa
 * (ver `artFilterMatches`).
 *
 * ⚠️ **Todo rótulo negativo COM o número estoura** — medido: `Sem o fundo 20%` 241px,
 * `Sem 20% pior` 220px, `Sem o pior 20%` 230px. E os curtos que cabem sem dizer a ponta
 * (`Corta 20%` 201px, `Fora 20%` 195px) trocam um erro por outro. Por isso o número saiu deste
 * botão em vez de a frase encurtar.
 *
 * ⚠️ **"fraca" fala da POSIÇÃO na estimativa, não da arte** — medido, Chobits tem 38 palavras
 * de elogio, zero de crítica, e cai no percentil 5. O card da obra diz "Arte provavelmente
 * fraca", e o botão não tem largura para o "provavelmente": quem segura essa leitura é o
 * rótulo **"Arte (estimada)"** ao lado do controle. Se ele sair, este botão passa a prometer
 * um julgamento da arte que o dado não paga.
 *
 * ⚠️ E a assimetria do "sem estimativa" continua sendo coisa do TOOLTIP — nenhum rótulo de
 * ~110px a expressa. É a frase que nunca se corta para encurtar.
 */
export const ART_FILTER_SEGMENT_LABELS: Record<ArtFilter, string> = {
  // "fracas" é o nome da FAIXA — o mesmo que `ART_BAND_LABELS.fraca` imprime no card da obra.
  // Guardado por teste: renomear a faixa sem trazer o botão junto reprova.
  sem_fraca: "Sem fracas",
  forte: `Top ${ART_FILTER_PERCENTS.forte}%`,
}

/**
 * Versão curta, para o chip de filtro ativo.
 *
 * ⚠️ Acompanha o BOTÃO, não o mecanismo: o chip nomeia o filtro que a pessoa acabou de ligar, e
 * chamá-lo de "Sem os 20% piores" a dois centímetros de um botão escrito "Sem fracas" é dar
 * dois nomes ao mesmo fato — a família de erro que já produziu três nomes para a previsão de
 * Interesse (`lib/ui/interest-predict-label.ts`). Aqui o chip tem largura para o "(est.)" que
 * não cabe no botão.
 */
export const ART_FILTER_CHIP_LABELS: Record<ArtFilter, string> = {
  forte: `Arte no top ${ART_FILTER_PERCENTS.forte}% (est.)`,
  sem_fraca: "Sem a arte fraca (est.)",
}

/**
 * O texto longo, que só o tooltip comporta. Começa pelo nome da FAIXA (`ART_BAND_LABELS`),
 * que é o mesmo que o card da obra imprime — é assim que as duas telas passam a falar do
 * mesmo jeito sobre o mesmo número.
 *
 * ⚠️ A 2ª frase de cada um diz o que acontece com obra SEM estimativa, e os dois lados são
 * OPOSTOS de propósito (ver `artFilterMatches`). É a única parte que a pessoa não tem como
 * deduzir da tela, então nunca é a que se corta para encurtar.
 */
export const ART_FILTER_TOOLTIPS: Record<ArtFilter, string> = {
  forte:
    `${ART_BAND_LABELS.forte}: só o topo ${ART_FILTER_PERCENTS.forte}% da estimativa. ` +
    "Obra SEM estimativa fica de fora — ninguém apurou que a arte dela é forte.",
  sem_fraca:
    `Esconde o fundo ${ART_FILTER_PERCENTS.fraca}% da estimativa (“${ART_BAND_LABELS.fraca}”). ` +
    "Obra SEM estimativa CONTINUA aparecendo — esconder o que nunca foi medido tiraria obra " +
    "da lista sem motivo.",
}
