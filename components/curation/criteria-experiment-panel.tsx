"use client"

import { useState } from "react"
import { Loader2, FlaskConical, Info } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  rodarExperimentoDeCriterios,
  type RespostaDoExperimento,
} from "@/server/actions/criteria-experiment"
import { DEFAULT_PERMUTATIONS } from "@/lib/model-metrics/criteria-experiment"

const n4 = (v: number | null | undefined) =>
  v != null && Number.isFinite(v) ? v.toFixed(4) : "—"
const n2 = (v: number | null | undefined) =>
  v != null && Number.isFinite(v) ? v.toFixed(2) : "—"
const pct = (v: number | null | undefined) =>
  v != null && Number.isFinite(v) ? `${(v * 100).toFixed(1)}%` : "—"
const sinal = (v: number | null | undefined) =>
  v == null || !Number.isFinite(v) ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(4)}`

function Linha({ rotulo, valor, dica }: { rotulo: string; valor: string; dica?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-border/50 py-1.5 last:border-b-0">
      <span className="text-xs text-muted-foreground">
        {rotulo}
        {dica ? <span className="ml-1 opacity-70">({dica})</span> : null}
      </span>
      <span className="font-mono text-sm tabular-nums">{valor}</span>
    </div>
  )
}

export function CriteriaExperimentPanel({
  disponivel,
  faltando,
}: {
  disponivel: boolean
  faltando: string[]
}) {
  const [rodando, setRodando] = useState(false)
  const [r, setR] = useState<RespostaDoExperimento | null>(null)

  if (!disponivel) {
    return (
      <section className="rounded-xl border border-border bg-muted/40 p-5">
        <p className="text-sm font-medium">
          O experimento estará disponível após o producer de 11 atributos ser ativado.
        </p>
        <p className="mt-1.5 text-xs text-muted-foreground">
          Faltam em <code className="font-mono">criteria</code>:{" "}
          <span className="font-mono">{faltando.join(", ") || "—"}</span>. A migration 198 os
          cria; até lá não existe nota de <code className="font-mono">setting_era</code> nem de{" "}
          <code className="font-mono">angst</code> para comparar.
        </p>
      </section>
    )
  }

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Button
          onClick={async () => {
            setRodando(true)
            try {
              setR(await rodarExperimentoDeCriterios(DEFAULT_PERMUTATIONS))
            } finally {
              setRodando(false)
            }
          }}
          disabled={rodando}
        >
          {rodando ? <Loader2 className="size-4 animate-spin" /> : <FlaskConical className="size-4" />}
          {rodando ? "Comparando…" : "Executar comparação"}
        </Button>
        <span className="text-xs text-muted-foreground">
          Só a Nota Prevista (Ridge) · US$0 · nada é gravado · {DEFAULT_PERMUTATIONS} permutações
        </span>
      </div>

      {r && !r.ok && "indisponivel" in r ? (
        <p className="text-sm text-muted-foreground">
          Indisponível: faltam {r.faltando.join(", ")}.
        </p>
      ) : null}
      {r && !r.ok && "erro" in r ? (
        <pre className="overflow-x-auto rounded-lg border border-rose-500/40 bg-rose-500/10 p-3 text-xs whitespace-pre-wrap">
          {r.erro}
        </pre>
      ) : null}

      {r?.ok ? (
        <div className="space-y-4">
          {/* ── cobertura ───────────────────────────────────────────── */}
          <div className="rounded-xl border border-border bg-card p-4">
            <h3 className="text-sm font-semibold">Cobertura</h3>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Quando o N crescer, vale repetir — é isto que diz o momento do reteste.
            </p>
            <p className="mt-3 text-2xl font-semibold tabular-nums">
              {r.principal.n}{" "}
              <span className="text-base font-normal text-muted-foreground">
                / {r.cobertura.rotuladas} obras rotuladas com os 11 atributos
              </span>
            </p>
            <div className="mt-3">
              <Linha rotulo="com setting_era real" valor={String(r.cobertura.comSettingEra)} />
              <Linha rotulo="com angst real" valor={String(r.cobertura.comAngst)} />
              <Linha rotulo="com ambos" valor={String(r.cobertura.comAmbos)} />
              <Linha rotulo="cobertura da coorte" valor={pct(r.cobertura.fracaoComOsOnze)} />
            </div>
            {r.principal.amostraPequena ? (
              <p className="mt-3 flex gap-2 rounded-lg bg-amber-500/15 p-2.5 text-xs text-amber-700 dark:text-amber-300">
                <Info className="mt-0.5 size-3.5 shrink-0" />
                Amostra pequena. O resultado abaixo é válido como medição, mas o poder de
                detectar um efeito pequeno é baixo — leia o nulo por permutação antes de
                concluir qualquer coisa.
              </p>
            ) : null}
          </div>

          {/* ── análise principal ───────────────────────────────────── */}
          <div className="rounded-xl border border-border bg-card p-4">
            <h3 className="text-sm font-semibold">
              Análise principal · Nota Prevista na coorte completa{" "}
              <span className="font-normal text-muted-foreground">(n = {r.principal.n})</span>
            </h3>
            <p className="mt-0.5 text-xs text-muted-foreground">
              O mesmo Ridge, nas <strong>mesmas obras</strong> e com os mesmos folds, com 9 e com
              11 critérios. É esta que decide se os dois atributos acrescentam sinal preditivo.
            </p>
            {r.principal.oficial && r.principal.experimental ? (
              <>
                <div className="mt-3">
                  <Linha rotulo="CV MAE OOF · Ridge 9" valor={n4(r.principal.oficial.cvMae)} />
                  <Linha
                    rotulo="CV MAE OOF · Ridge 11"
                    valor={n4(r.principal.experimental.cvMae)}
                  />
                  <Linha
                    rotulo="Δ CV MAE"
                    valor={sinal(r.principal.deltaCvMae)}
                    dica="negativo = o Ridge de 11 erra menos"
                  />
                  <Linha
                    rotulo="rho(Nota Prevista, user_score) · 9"
                    valor={n4(r.principal.oficial.rhoComRotulo)}
                  />
                  <Linha
                    rotulo="rho(Nota Prevista, user_score) · 11"
                    valor={n4(r.principal.experimental.rhoComRotulo)}
                  />
                  <Linha
                    rotulo="Spearman entre as duas Notas Previstas"
                    valor={n4(r.principal.spearmanEntreOsDois)}
                  />
                  <Linha
                    rotulo="overlap top-10"
                    valor={
                      r.principal.top10
                        ? `${r.principal.top10.comum}/${r.principal.top10.efetivo}`
                        : "—"
                    }
                    dica={
                      r.principal.top10 && r.principal.top10.efetivo < r.principal.top10.pedido
                        ? `a coorte tem ${r.principal.top10.efetivo} obras`
                        : undefined
                    }
                  />
                  <Linha
                    rotulo="overlap top-50"
                    valor={
                      r.principal.top50
                        ? `${r.principal.top50.comum}/${r.principal.top50.efetivo}`
                        : "—"
                    }
                    dica={
                      r.principal.top50 && r.principal.top50.efetivo < r.principal.top50.pedido
                        ? `a coorte tem ${r.principal.top50.efetivo} obras`
                        : undefined
                    }
                  />
                </div>

                <h4 className="mt-4 text-xs font-semibold">Coeficientes do Ridge</h4>
                <div className="mt-1.5 overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="text-muted-foreground">
                      <tr>
                        <th className="py-1 text-left font-medium">critério</th>
                        <th className="py-1 text-right font-medium">9</th>
                        <th className="py-1 text-right font-medium">11</th>
                      </tr>
                    </thead>
                    <tbody className="font-mono tabular-nums">
                      {r.principal.experimental.coeficientes.map((c) => {
                        const of = r.principal.oficial?.coeficientes.find((x) => x.slug === c.slug)
                        return (
                          <tr key={c.slug} className="border-t border-border/50">
                            <td className="py-1">{c.slug}</td>
                            <td className="py-1 text-right">{of ? n4(of.coef) : "—"}</td>
                            <td className="py-1 text-right">{n4(c.coef)}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            ) : (
              <p className="mt-3 text-sm text-muted-foreground">
                Coorte insuficiente para treinar o modelo — nenhuma métrica foi calculada.
              </p>
            )}
          </div>

          {/* ── nulo por permutação ─────────────────────────────────── */}
          <div className="rounded-xl border border-border bg-card p-4">
            <h3 className="text-sm font-semibold">Controle por permutação</h3>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Os mesmos valores de <code className="font-mono">setting_era</code>/
              <code className="font-mono">angst</code>, sorteados entre as mesmas obras. Se o
              arranjo verdadeiro não bate o sorteado, a coluna não carrega informação.
            </p>
            {r.principal.nulo ? (
              <>
                <div className="mt-3">
                  <Linha rotulo="permutações" valor={String(r.principal.nulo.permutacoes)} />
                  <Linha rotulo="Δ real" valor={sinal(r.principal.deltaCvMae)} />
                  <Linha rotulo="média do nulo" valor={sinal(r.principal.nulo.media)} />
                  <Linha rotulo="desvio-padrão do nulo" valor={n4(r.principal.nulo.desvio)} />
                  <Linha rotulo="z aproximado" valor={n2(r.principal.nulo.z)} />
                  <Linha
                    rotulo="p empírico"
                    valor={n2(r.principal.nulo.p)}
                    dica="fração dos sorteios tão bons quanto o real"
                  />
                </div>
                {/*
                  🔴 Descrição FACTUAL, nunca veredito. "Aprovado/reprovado" aqui viraria decisão
                  de produto tomada por um limiar que ninguém escolheu.
                */}
                <p className="mt-3 rounded-lg bg-muted p-2.5 text-xs">
                  {r.principal.nulo.z != null && Math.abs(r.principal.nulo.z) >= 2
                    ? "A diferença observada está separada da distribuição de permutação."
                    : "A diferença observada NÃO está claramente separada da distribuição de permutação."}{" "}
                  <span className="text-muted-foreground">
                    Isto descreve a medição — não é uma decisão de produto.
                  </span>
                </p>
              </>
            ) : (
              <p className="mt-3 text-sm text-muted-foreground">
                Nulo não calculado (coorte insuficiente).
              </p>
            )}
          </div>

          {/* ── análise secundária ──────────────────────────────────── */}
          <div className="rounded-xl border border-dashed border-border bg-card p-4">
            <h3 className="text-sm font-semibold">
              Análise secundária · Nota Prevista no catálogo rotulado, com imputação
            </h3>
            <p className="mt-0.5 rounded-lg bg-amber-500/15 p-2.5 text-xs text-amber-700 dark:text-amber-300">
              <strong>Não é a evidência principal.</strong> Aqui{" "}
              <code className="font-mono">setting_era</code> e{" "}
              <code className="font-mono">angst</code> ausentes são preenchidos pela mediana, o
              que torna as colunas quase-constantes — o braço experimental tende a parecer inerte
              por construção, não por medição.
            </p>
            <div className="mt-3">
              <Linha rotulo="N (rotuladas elegíveis)" valor={String(r.secundaria.n)} />
              <Linha rotulo="com setting_era real" valor={String(r.secundaria.cobertura.comSettingEra)} />
              <Linha rotulo="com angst real" valor={String(r.secundaria.cobertura.comAngst)} />
              <Linha rotulo="com ambos" valor={String(r.secundaria.cobertura.comAmbos)} />
              <Linha rotulo="MAE OOF · Ridge 9" valor={n4(r.secundaria.maeOficial)} />
              <Linha rotulo="MAE OOF · Ridge 11" valor={n4(r.secundaria.maeExperimental)} />
              <Linha rotulo="Δ" valor={sinal(r.secundaria.delta)} />
            </div>
          </div>

          {/* ── proveniência ────────────────────────────────────────── */}
          <div className="rounded-xl border border-border bg-muted/30 p-4 text-xs">
            <h3 className="font-semibold">Proveniência desta execução</h3>
            <p className="mt-1 text-muted-foreground">
              Sem isto, dois resultados de populações diferentes seriam lidos como o mesmo
              experimento.
            </p>
            <dl className="mt-2 grid gap-x-6 gap-y-1 sm:grid-cols-2">
              <div><dt className="inline text-muted-foreground">executado em: </dt>
                <dd className="inline font-mono">{new Date(r.provenancia.executadoEm).toLocaleString("pt-BR")}</dd></div>
              <div><dt className="inline text-muted-foreground">duração: </dt>
                <dd className="inline font-mono">{(r.duracaoMs / 1000).toFixed(1)}s</dd></div>
              <div><dt className="inline text-muted-foreground">N da coorte: </dt>
                <dd className="inline font-mono">{r.principal.n}</dd></div>
              <div><dt className="inline text-muted-foreground">seed: </dt>
                <dd className="inline font-mono">{r.provenancia.seed}</dd></div>
              <div><dt className="inline text-muted-foreground">permutações: </dt>
                <dd className="inline font-mono">{r.provenancia.permutacoes}</dd></div>
              <div className="sm:col-span-2"><dt className="inline text-muted-foreground">assinatura oficial: </dt>
                <dd className="inline font-mono break-all">{r.provenancia.assinaturaOficial}</dd></div>
              <div className="sm:col-span-2"><dt className="inline text-muted-foreground">assinatura experimental: </dt>
                <dd className="inline font-mono break-all">{r.provenancia.assinaturaExperimental}</dd></div>
            </dl>
          </div>
        </div>
      ) : null}
    </section>
  )
}
