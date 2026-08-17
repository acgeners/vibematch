/**
 * Conteúdo COMPARTILHADO dos tooltips de Alinhamento e Veredito IA.
 *
 * Fonte única pra que o /ranking (cells compactas) e a aba "Notas e avaliações"
 * da obra (cards grandes) mostrem o MESMO texto ao passar o mouse. Cada consumidor
 * fornece seu próprio <TooltipContent> (side/largura variam por layout); aqui vai
 * só o corpo (os <p>). Sem "use client" de propósito: renderiza tanto no server
 * component da obra quanto nas cells client do ranking.
 *
 * ⚠️ **Uma linha do Alinhamento é condicional ao DADO, e isso não quebra a fonte
 * única.** O nº de tags (e a ressalva que depende dele) só sai onde `tagCount`
 * chega: página da obra, /catalog e o heatmap. O /ranking não embute `work_tags` no
 * payload de propósito — corte de egress —, então lá a linha some. É a MESMA função
 * decidindo com menos entrada, não um segundo texto escrito à parte; se um dia
 * alguém redigir a explicação de novo no consumidor, aí sim vira a família "dois
 * critérios pro mesmo fato" que este arquivo existe pra evitar.
 */

import { LABELS } from "@/lib/constants/ui-labels"
import { ConfidenceMark } from "@/components/ui/confidence-mark"

/** Payload enriquecido do consultor (sub-fase 2.3.A — Smart Shortlist v2+). */
export interface AlignmentPayload {
  confidence?: number
  risks?: string[]
  similar_loved?: string[]
  similar_avoided?: string[]
  review_quotes?: string[]
  mood_fit?: number
}

/**
 * Abaixo disto a obra está SUB-TAGUEADA e o Alinhamento dela mede menos do que
 * parece. 25 é o p25 do catálogo (medido em 15/08/2026 nas 988 obras: p10 19 ·
 * p25 26 · mediana 35 · p90 74 · máx 261) — arredondado pra baixo porque o corte
 * exato do percentil anda a cada obra nova e o número aqui não.
 */
export const SPARSE_TAGS_AT = 25

/**
 * Abaixo disto o Alinhamento é "baixo" pra efeito da ressalva. Mesma faixa da
 * cor slate/laranja da célula.
 */
export const LOW_ALIGNMENT_AT = 30

/**
 * Corpo do tooltip do Alinhamento. Assume `value` != null (o consumidor só
 * renderiza quando há valor). Mostra o percentil como sinal principal ("Top X%")
 * e o bruto ao lado; cai num texto explicativo quando não há percentil.
 *
 * 🔴 **A explicação da fórmula aqui já mentiu por ~2 meses.** O texto dizia
 * "tags amadas/evitadas (40%), faixas ideais de critério (30%) e consistência
 * geral (30%)" — que era `computePersonalFit`, aposentada em 2026-06-27 e REMOVIDA
 * em 15/08/2026 (nunca teve caller fora do teste dela). O que roda é
 * `netNameOverlap` (`server/actions/calculations.ts`, bloco 5): soma da força
 * das tags amadas presentes menos 1,5× as evitadas, min-max sobre o catálogo e
 * depois percentil. Critério NÃO entra — `criterionAlignment` virou feature do
 * Ridge da Nota Prevista, não do Alinhamento.
 *
 * ⚠️ **A ressalva de matéria-prima é DIRECIONAL, e isso é medido.** `netName` é
 * soma sem denominador, então o nº de tags é o teto de quantas amadas a obra
 * pode encostar: poucas tags só conseguem empurrar o valor pra BAIXO. Medido em
 * 15/08/2026 nas 988 obras: Alinhamento ≥75 com <25 tags são **3 obras (0,3%)**,
 * enquanto <30 com <25 tags são **139 (14,1%)**. Por isso a ressalva só aparece
 * no valor baixo — num valor alto ela estaria desmentindo um número correto.
 *
 * ⚠️ **Ela não vira chip em lista**, pelos mesmos 14,1%: 1 em 7 linhas é o
 * alarme que sempre toca. O tooltip é opt-in (exige hover), então a frequência
 * não pesa aqui.
 */
export function AlignmentTooltipContent({
  value,
  percentile,
  tagCount,
}: {
  value: number
  percentile?: number | null
  /**
   * Quantas tags a obra tem — a matéria-prima EXCLUSIVA deste número. Opcional
   * porque o payload do `/ranking` não embute `work_tags` de propósito (corte de
   * egress: `tags(*)` era 85% do payload); ausente → a linha some.
   */
  tagCount?: number | null
}) {
  const displayPct = percentile != null ? Math.round(percentile) : Math.round(value * 100)
  const rawPct = Math.round(value * 100)
  const topLabel =
    percentile == null ? null
    : percentile >= 95 ? "Top 5%"
    : percentile >= 90 ? "Top 10%"
    : percentile >= 75 ? "Top 25%"
    : percentile >= 50 ? "Acima da mediana"
    : percentile >= 25 ? "Abaixo da mediana"
    : "Bottom 25%"

  // A ressalva de matéria-prima: só quando o valor é baixo E a obra é sub-tagueada
  // (ver o ⚠️ direcional no docstring — no valor alto ela desmentiria um número certo).
  //
  // 🔴 **O limiar é do PERCENTIL, então exige percentil.** `displayPct` cai no cru×100
  // quando não há percentil, e as duas escalas não são comparáveis: o `personal_fit` cru
  // tem teto ~0,55 (é a razão de o percentil existir), então "< 30" corta perto da MEDIANA
  // lá e perto do fundo aqui. Aplicar o mesmo número às duas é a família "dois critérios
  // pro mesmo fato" — a mesma que o percentil do /discover já cobrou. Sem percentil a
  // ressalva não sai; o nº de tags continua saindo, que é o fato bruto e não depende de
  // régua nenhuma.
  const sparse =
    percentile != null && tagCount != null && tagCount < SPARSE_TAGS_AT && percentile < LOW_ALIGNMENT_AT

  return (
    <>
      {percentile != null ? (
        <p className="text-xs font-semibold">{topLabel} da sua biblioteca</p>
      ) : (
        <p className="text-xs font-semibold">Alinhamento com seu perfil de gosto</p>
      )}
      {/* ⚠️ Tom secundário é `text-background/<alfa>`, NUNCA `text-muted-foreground`: o
          `TooltipContent` é invertido (`bg-foreground` + `text-background`), então token de
          página aqui dentro passa no escuro e desaba pra ~3:1 no claro. */}
      <p className="text-[11px] text-background/70">
        Bruto <span className="font-mono font-semibold">{rawPct}%</span>
        {percentile != null && (
          <>
            {" · "}Percentil <span className="font-mono font-semibold">{displayPct}%</span>
          </>
        )}
        {tagCount != null && (
          <>
            {" · "}
            <span className="font-mono font-semibold">{tagCount}</span>{" "}
            {tagCount === 1 ? "tag" : "tags"}
          </>
        )}
      </p>
      <p className="text-[11px] text-background/70">
        Soma da força das suas tags amadas presentes na obra, menos 1,5× as evitadas —
        comparada com o resto do catálogo.
        {percentile == null && " Re-rode o cálculo pra ganhar a versão percentil (Top X%)."}
      </p>
      {sparse && (
        // 🔴 SEM cor de estado, e são dois motivos independentes. (1) A régua do
        // `STATUS_TONE`: âmbar quer dizer "desatualizado", e isto não é — é confiança do
        // INPUT, que o projeto já decidiu não deixar disputar cor (ver o
        // `InputConfidenceSeal`, onde o nível virou FORMA). (2) A superfície é invertida,
        // então `text-amber-600 dark:text-amber-400` sai claro-sobre-claro no tema escuro
        // e escuro-sobre-escuro no claro — o `dark:` fica ao contrário do que se lê.
        // O contraste PLENO (sem alfa) já é a ênfase, contra o /70 das linhas acima.
        <p className="text-[11px] font-medium text-background">
          Obra com poucas tags: um valor baixo aqui pode ser tag faltando, não desalinhamento.
        </p>
      )}
    </>
  )
}

/**
 * Corpo do tooltip do Veredito IA. Assume `score` != null. Mostra o veredito,
 * confiança, fit de mood, justificativa e o bloco enriquecido (riscos, reviews
 * citadas, obras similares). A desatualização NÃO entra aqui — é sinalizada
 * visualmente (ícone ↻ no ranking; borda âmbar + chip na página da obra).
 */
export function VerdictTooltipContent({
  score,
  justification,
  payload,
}: {
  score: number
  justification?: string | null
  payload?: AlignmentPayload | null
}) {
  const hasEnriched = Boolean(
    payload && (
      payload.confidence != null ||
      (payload.risks?.length ?? 0) > 0 ||
      (payload.similar_loved?.length ?? 0) > 0 ||
      (payload.similar_avoided?.length ?? 0) > 0 ||
      (payload.review_quotes?.length ?? 0) > 0 ||
      payload.mood_fit != null
    ),
  )

  return (
    <>
      <div className="flex items-center justify-between gap-3">
        <p className="font-semibold text-xs">{LABELS.alignment_score.full}: {Math.round(score)}/100</p>
        {payload?.confidence != null && (
          // 🔴 O TRAÇO vem antes do número de propósito: ele é a legenda da barrinha que a
          // pílula desenha sob o score, e essa barrinha é muda sozinha. Pôr o mesmo desenho
          // encostado na palavra "Confiança" explica sem gastar uma linha de prosa — por isso
          // é o `ConfidenceMark`, o mesmo componente da célula, e não um retângulo parecido.
          //
          // ⚠️ Tom secundário aqui é `text-background/<alfa>`, NUNCA `text-muted-foreground`:
          // o `TooltipContent` é invertido (`bg-foreground` + `text-background`), e o token de
          // página passa no escuro e desaba pra ~3:1 no claro. A função irmã logo acima já
          // documentava isso; esta estava com o token errado.
          <span className="inline-flex shrink-0 items-center gap-1.5 text-[11px] text-background/70">
            {/* 🔴 O traço vai sobre um recorte de `bg-background`, NUNCA direto no fundo do
                tooltip. Calculado em 17/08/2026: o `TooltipContent` é `bg-foreground`, que no
                dark é quase branco (hsl 39 30% 93%), e ali o traço cai pra **1,84:1 (âmbar)** e
                2,18:1 (esmeralda) — abaixo do mínimo de 3:1 pra elemento gráfico. E o âmbar é o
                caso comum (306 das 398 obras com confiança). Sobre o fundo escuro ele tem
                7,4–8,8:1, que é o que ele tem na pílula. O recorte não é enfeite: ele devolve
                ao traço o chão em que a pessoa acabou de vê-lo. */}
            <span className="inline-flex items-center rounded-[3px] bg-background px-1 py-[3px]">
              <ConfidenceMark confidence={payload.confidence} />
            </span>
            Confiança: <span className="font-semibold">{(payload.confidence * 100).toFixed(0)}%</span>
          </span>
        )}
      </div>
      {payload?.mood_fit != null && (
        <p className="text-[11px] text-background/70">
          Fit com mood: <span className="font-mono font-semibold">{(payload.mood_fit * 100).toFixed(0)}%</span>
        </p>
      )}
      {justification && <p className="text-xs leading-relaxed">{justification}</p>}
      {hasEnriched && (
        <div className="border-t border-border/40 pt-1.5 space-y-1.5">
          {payload?.risks && payload.risks.length > 0 && (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-rose-500">⚠ Riscos</p>
              <ul className="mt-0.5 text-xs space-y-0.5">
                {payload.risks.map((r, i) => (
                  <li key={i} className="leading-snug">• {r}</li>
                ))}
              </ul>
            </div>
          )}
          {payload?.review_quotes && payload.review_quotes.length > 0 && (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-background/70">Reviews citadas</p>
              <ul className="mt-0.5 text-xs italic space-y-0.5">
                {payload.review_quotes.map((q, i) => (
                  <li key={i} className="leading-snug">&ldquo;{q}&rdquo;</li>
                ))}
              </ul>
            </div>
          )}
          {payload?.similar_loved && payload.similar_loved.length > 0 && (
            <p className="text-[11px] text-emerald-600 dark:text-emerald-400">
              Lembra de obras que você ama ({payload.similar_loved.length} similar{payload.similar_loved.length > 1 ? "es" : ""})
            </p>
          )}
          {payload?.similar_avoided && payload.similar_avoided.length > 0 && (
            <p className="text-[11px] text-rose-600 dark:text-rose-400">
              Lembra de obras que você não curtiu ({payload.similar_avoided.length})
            </p>
          )}
        </div>
      )}
    </>
  )
}
