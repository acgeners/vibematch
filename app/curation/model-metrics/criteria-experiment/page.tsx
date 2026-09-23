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
export const metadata = { title: "Nota Prevista: 9 × 11 atributos" }

/**
 * Harness de DIAGNÓSTICO do modelo de NOTA PREVISTA (Ridge): os 9 critérios que ele usa hoje
 * contra os mesmos 9 + `setting_era` + `angst`.
 *
 * 🔴 O ESCOPO É O RIDGE, e a tela precisa dizer isso. "9 × 11" sozinho sugere que o cálculo
 * INTEIRO roda com 11 — e não roda: Nota.IA, Chance/Bússola, embeddings e a inferência de
 * pesos continuam nos 9 oficiais e nem entram na comparação. Nomear errado aqui faria alguém
 * ler um Δ de cvMAE como se fosse o efeito no produto todo.
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
        title="Comparar Nota Prevista: 9 × 11 atributos"
        description="Ferramenta de diagnóstico, US$0: com os dados já acumulados, setting_era e angst melhoram de fato a Nota Prevista se entrarem no modelo?"
      />

      <p className="rounded-lg border border-border bg-muted/40 px-3 py-2.5 text-sm">
        Este experimento testa o efeito de <code className="font-mono text-xs">setting_era</code>{" "}
        e <code className="font-mono text-xs">angst</code> no modelo de{" "}
        <strong>Nota Prevista (Ridge)</strong>. Os demais componentes do cálculo oficial
        permanecem inalterados.
      </p>

      <div className="grid gap-4 sm:grid-cols-2">
        <section className="rounded-xl border border-border bg-card p-4">
          <h2 className="text-sm font-semibold">
            Oficial{" "}
            <span className="text-muted-foreground">· Ridge com os 9 critérios atuais</span>
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            É a Nota Prevista que o ranking real usa hoje.
          </p>
          <ul className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
            {OFFICIAL_CRITERIA.map((s) => (
              <li key={s} className="font-mono text-muted-foreground">{s}</li>
            ))}
          </ul>
        </section>

        <section className="rounded-xl border border-dashed border-border bg-card p-4">
          <h2 className="text-sm font-semibold">
            Experimental{" "}
            <span className="text-muted-foreground">· o MESMO Ridge + 2 critérios</span>
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Os 9 acima <strong>+ os dois abaixo</strong>. O ranking oficial não é alterado, em
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

      {/*
        🔴 O que fica FORA é tão importante quanto o que entra: sem esta lista, "9 × 11" é lido
        como "o cálculo inteiro com 11", e o Δ de cvMAE vira uma afirmação sobre o produto todo.
      */}
      <p className="text-xs text-muted-foreground">
        <strong className="text-foreground">Não entram nesta comparação:</strong> Nota.IA,
        Chance/Bússola, embeddings, inferência de pesos e os demais consumidores do scoring
        oficial. Todos continuam nos 9 critérios, aqui e no produto.
      </p>

      <CriteriaExperimentPanel disponivel={disp.disponivel} faltando={disp.faltando} />
    </div>
  )
}
