import { FlaskConical } from "lucide-react"
import Link from "next/link"
import { Header } from "@/components/layout/header"
import { CriteriaExperimentPanel } from "@/components/curation/criteria-experiment-panel"
import { experimentoDisponivel } from "@/server/queries/criteria-experiment"
import {
  OFFICIAL_CRITERIA,
  EXPERIMENTAL_EXTRA,
} from "@/lib/model-metrics/criteria-experiment"

export const dynamic = "force-dynamic"
export const metadata = { title: "Comparar 9 × 11 atributos" }

/**
 * Harness de DIAGNÓSTICO: os 9 atributos do ranking real contra os 11 do producer alvo.
 *
 * 🔴 Não é um segundo ranking nem um modo alternativo. Nada aqui grava, e não existe botão de
 * "aplicar": promover o experimental é decisão de produto, tomada fora desta tela.
 */
export default async function Page() {
  // Só a checagem de disponibilidade no load — a comparação custa e sai por botão.
  const disp = await experimentoDisponivel()

  return (
    <div className="space-y-6">
      <Link
        href="/curation/model-metrics"
        className="inline-block text-xs text-muted-foreground hover:underline"
      >
        ← Métricas do modelo
      </Link>

      <Header
        icon={<FlaskConical className="size-5" />}
        kicker="Métricas do modelo"
        title="Comparar 9 × 11 atributos"
        description="Ferramenta de diagnóstico, US$0: com os dados já acumulados, setting_era e angst melhoram de fato a previsão se entrarem no cálculo?"
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <section className="rounded-xl border border-border bg-card p-4">
          <h2 className="text-sm font-semibold">
            Oficial <span className="text-muted-foreground">· 9 atributos</span>
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            É o que o ranking real usa hoje.
          </p>
          <ul className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
            {OFFICIAL_CRITERIA.map((s) => (
              <li key={s} className="font-mono text-muted-foreground">{s}</li>
            ))}
          </ul>
        </section>

        <section className="rounded-xl border border-dashed border-border bg-card p-4">
          <h2 className="text-sm font-semibold">
            Experimental <span className="text-muted-foreground">· 11 atributos</span>
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Os 9 acima <strong>+ os dois abaixo</strong>. Não é usado pelo ranking real, em
            nenhuma circunstância.
          </p>
          <ul className="mt-3 flex gap-3 text-xs">
            {EXPERIMENTAL_EXTRA.map((s) => (
              <li
                key={s}
                className="rounded-full bg-primary/15 px-2.5 py-0.5 font-mono font-semibold text-primary"
              >
                {s}
              </li>
            ))}
          </ul>
        </section>
      </div>

      <CriteriaExperimentPanel disponivel={disp.disponivel} faltando={disp.faltando} />
    </div>
  )
}
