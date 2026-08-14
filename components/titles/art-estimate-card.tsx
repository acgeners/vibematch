import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { AiProvenanceSeal } from "@/components/ui/ai-provenance"
import { ART_TAG_SLUGS } from "@/lib/arte/signal"
import { ART_BAND_LABELS } from "@/lib/arte/model"
import type { ArtEvidenceForWork } from "@/server/queries/art-evidence"

/**
 * Card de PILOTO: a estimativa de arte com tudo que entrou nela.
 *
 * Existe porque a saída sozinha não sustenta decisão. Medido em 2026-08-12: 953 obras
 * produzem 256 valores distintos, e um único valor (7,88) cobre 70 obras — no meio do
 * catálogo, que é onde o desempate faz falta, o número repete. A informação que discrimina
 * está no TEXTO (665 frases de arte no digest, em 66% do catálogo), e o modelo a reduzia a
 * uma contagem de polaridade.
 *
 * 🔴 O card NÃO é a versão final da feature. Ele existe para a curadora julgar, obra a obra,
 * se a evidência bate com o que ela vê — e essa avaliação é que decide o desenho do filtro.
 *
 * 🔴 A nota dela fica atrás de um `<details>`, e isso não é economia de espaço: ver a própria
 * nota antes de julgar a evidência ancora o julgamento. Mesma razão pela qual o gold set foi
 * avaliado às cegas. `<details>` nativo — sem JS, sem risco de hidratação.
 *
 * **Confirmado pela curadora em 2026-08-12**, contra a alternativa de mostrar aberto (que
 * pouparia um clique em 200 obras e permitiria comparar estimativa × nota de relance). Ela
 * escolheu proteger o julgamento. Não "simplifique" isto abrindo o bloco: o clique É a
 * feature.
 *
 * ⚠️ As tags exibidas vêm dos SUB-GRUPOS no banco, não da lista fixa do modelo: tag nova em
 * Format › Presentation aparece aqui antes de alguém decidir se ela entra no vetor. Quando a
 * exibida não está no vetor, o card diz isso — silenciar seria afirmar que ela pesou.
 */

const POLARITY_GLYPH: Record<string, string> = {
  positive: "▲",
  negative: "▼",
  mixed: "◆",
}

function Bloco({ titulo, children, nota }: { titulo: string; children: React.ReactNode; nota?: string }) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline gap-2">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{titulo}</h4>
        {nota && <span className="text-[11px] text-muted-foreground/70">{nota}</span>}
      </div>
      {children}
    </div>
  )
}

export function ArtEstimateCard({ data }: { data: ArtEvidenceForWork }) {
  const { estimate, percentile, band, ownerLabel, signal, evidence, tags, reviewCount } = data
  const noVetor = new Set<string>(ART_TAG_SLUGS)
  const semSinal =
    tags.length === 0 &&
    evidence.digestTraits.length === 0 &&
    (signal?.artMentions ?? 0) === 0

  return (
    <Card className="gap-2 py-4 bg-card/50">
      <CardHeader className="px-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-base font-bold text-foreground">Estimativa de arte</CardTitle>
          <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
            piloto
          </span>
        </div>
        <p className="text-xs text-muted-foreground">
          Estima <strong>o quanto você tende a gostar</strong> da arte, a partir do que leitores
          escreveram e das tags de formato. <strong>Nenhuma imagem é analisada.</strong>
        </p>
      </CardHeader>

      <CardContent className="px-4 space-y-4">
        {/* ---- A saída ---- */}
        <div className="rounded-md border border-border/60 bg-background/50 p-3">
          {estimate == null ? (
            <p className="text-sm text-muted-foreground">
              <strong className="text-foreground">Sem estimativa.</strong>{" "}
              {semSinal
                ? "Esta obra não tem nenhum sinal de arte — sem tag de apresentação, sem menção em review e sem traço no digest. Ficar sem número aqui é o comportamento certo: a média seria um fato que ninguém apurou."
                : "O sinal existe, mas a estimativa ainda não foi calculada para o catálogo."}
            </p>
          ) : (
            <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1">
              <div>
                <span className="text-2xl font-bold tabular-nums text-foreground">
                  {estimate.toFixed(2)}
                </span>
                <span className="ml-1 text-xs text-muted-foreground">/ 10</span>
              </div>
              {percentile != null && (
                <div className="text-sm text-muted-foreground">
                  percentil <strong className="text-foreground tabular-nums">{Math.round(percentile * 100)}</strong> do catálogo
                </div>
              )}
              {band && <div className="text-sm text-muted-foreground">{ART_BAND_LABELS[band]}</div>}
            </div>
          )}
          {estimate != null && (
            <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground/80">
              A escala é comprimida (~0,49× a do seu rótulo), então este número{" "}
              <strong>não é comparável em pontos</strong> com uma nota de critério — só a posição
              relativa significa alguma coisa.
            </p>
          )}
        </div>

        {/* ---- Tags ---- */}
        <Bloco
          titulo="Tags consideradas"
          nota={tags.length === 0 ? "nenhuma nesta obra" : `${tags.length} nesta obra`}
        >
          {tags.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Sem tag de Format › Presentation / Status (colorização) / Structure (webtoon).
            </p>
          ) : (
            <ul className="space-y-1">
              {tags.map((t) => (
                <li key={t.slug} className="flex flex-wrap items-baseline gap-x-2 text-sm">
                  <span className="font-medium text-foreground">{t.name}</span>
                  <span className="text-[11px] text-muted-foreground">{t.subgroup}</span>
                  <span className="text-[11px] tabular-nums text-muted-foreground/80">
                    {t.catalogCount} obras no catálogo
                  </span>
                  {!noVetor.has(t.slug) && (
                    <span className="rounded bg-amber-500/15 px-1 text-[11px] text-amber-700 dark:text-amber-300">
                      fora do vetor do modelo
                    </span>
                  )}
                  {noVetor.has(t.slug) && t.catalogCount <= 5 && (
                    <span className="text-[11px] text-muted-foreground/70">
                      rara demais para o modelo aprender
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Bloco>

        {/* ---- Digest ---- */}
        <Bloco titulo="O que a síntese das reviews diz da arte">
          {evidence.digestTraits.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum traço do eixo &ldquo;arte&rdquo; no digest.</p>
          ) : (
            <ul className="space-y-1">
              {evidence.digestTraits.map((t, i) => (
                <li key={i} className="flex gap-2 text-sm">
                  <span
                    className="shrink-0 tabular-nums text-muted-foreground"
                    title={t.polarity || "sem polaridade"}
                  >
                    {POLARITY_GLYPH[t.polarity] ?? "·"}
                  </span>
                  <span className="text-foreground">{t.trait}</span>
                </li>
              ))}
            </ul>
          )}
          <div className="pt-0.5">
            <AiProvenanceSeal
              title="Síntese das reviews"
              model={null}
              at={null}
              label="texto gerado por IA"
              note="As frases acima são do digest de reviews, escrito por um modelo. A estimativa em si não é: é regressão sobre contagens."
            />
          </div>
        </Bloco>

        {/* ---- Léxico ---- */}
        <Bloco
          titulo="Palavras de qualidade encontradas"
          nota={`só dentro de ±140 caracteres de cada menção a arte`}
        >
          {evidence.lexHits.positive.length === 0 && evidence.lexHits.negative.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhuma.</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {evidence.lexHits.positive.map(([termo, n]) => (
                <span
                  key={`p-${termo}`}
                  className="rounded border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0.5 text-xs text-emerald-800 dark:text-emerald-300"
                >
                  ▲ {termo}
                  {n > 1 && <span className="ml-1 tabular-nums opacity-70">×{n}</span>}
                </span>
              ))}
              {evidence.lexHits.negative.map(([termo, n]) => (
                <span
                  key={`n-${termo}`}
                  className="rounded border border-rose-500/30 bg-rose-500/10 px-1.5 py-0.5 text-xs text-rose-800 dark:text-rose-300"
                >
                  ▼ {termo}
                  {n > 1 && <span className="ml-1 tabular-nums opacity-70">×{n}</span>}
                </span>
              ))}
            </div>
          )}
        </Bloco>

        {/* ---- Trechos ---- */}
        {evidence.excerpts.length > 0 && (
          <Bloco titulo="O que leitores escreveram" nota="trecho em torno da menção">
            <ul className="space-y-1.5">
              {evidence.excerpts.map((e, i) => (
                <li key={i} className="border-l-2 border-border pl-2 text-xs leading-relaxed text-muted-foreground">
                  …{e}…
                </li>
              ))}
            </ul>
          </Bloco>
        )}

        {/* ---- Os números crus ---- */}
        <Bloco titulo="Os números que o modelo recebeu">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs @sm:grid-cols-3">
            {[
              ["menções a arte", signal?.artMentions ?? 0],
              ["reviews da obra", signal?.reviewCount ?? reviewCount],
              ["léxico positivo", signal?.lexPositive ?? 0],
              ["léxico negativo", signal?.lexNegative ?? 0],
              ["digest ▲", signal?.digestPositive ?? 0],
              ["digest ▼", signal?.digestNegative ?? 0],
            ].map(([k, v]) => (
              <div key={String(k)} className="flex items-baseline justify-between gap-2">
                <dt className="text-muted-foreground">{k}</dt>
                <dd className="tabular-nums font-medium text-foreground">{v}</dd>
              </div>
            ))}
          </dl>
          {signal == null && (
            <p className="text-[11px] text-muted-foreground/80">
              ⚠️ `works.art_signal` ainda não foi extraído — os números acima vieram do cálculo
              feito agora, não do que está persistido.
            </p>
          )}
        </Bloco>

        {/* ---- A nota dela, atrás de uma porta ---- */}
        {ownerLabel != null && (
          <details className="rounded-md border border-border/60 bg-background/40 px-3 py-2">
            <summary className="cursor-pointer text-xs font-medium text-muted-foreground">
              Ver a nota que você já deu à arte desta obra
            </summary>
            <p className="pt-2 text-sm">
              <strong className="tabular-nums text-foreground">{ownerLabel}</strong>
              <span className="ml-2 text-xs text-muted-foreground">
                fica escondida de propósito: ver a nota antes de julgar a evidência ancora o
                julgamento.
              </span>
            </p>
          </details>
        )}
      </CardContent>
    </Card>
  )
}
