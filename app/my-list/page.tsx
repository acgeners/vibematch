import { Library } from "lucide-react"
import { Header } from "@/components/layout/header"
import { MyListView } from "@/components/my-list/my-list-view"
import { UntrackedEntry } from "@/components/my-list/untracked-entry"
import { getMyList } from "@/server/queries/my-list"

export const metadata = { title: "Minha lista" }

/**
 * A lista do leitor: o recorte do catálogo em que ELE se pronunciou.
 *
 * Mesma estrutura de produto do MyAnimeList e do AnimePlanet — catálogo público compartilhado
 * + uma lista por pessoa, definida pelo status que ela deu. O que faltava aqui não era o dado
 * (295 das 988 obras já têm status ou nota do dono), era o LUGAR: a `/reading` mostra só
 * `Reading` + `Hiatus` (38 obras), e as outras **253 — 87% da lista — não tinham página
 * nenhuma**, só filtro no catálogo. Entre elas `Started` (40, com 39 tendo capítulos lidos),
 * `On-hold` (37) e `Stalled` (28), que o banco marca como `tracks_progress`.
 *
 * ⚠️ Esta página NÃO absorve `/reading`, `/ranking` nem `/recommendations` — decisão da Ana em
 * 2026-08-16. `/reading` responde **ritmo** ("saiu capítulo? estou em dia?", com bandas e
 * calendário); aqui a pergunta é **estado** ("o que eu já disse sobre esta obra?"). As duas
 * prateleiras se cruzam de propósito.
 */
export default async function MyListPage() {
  const lista = await getMyList()

  return (
    <div className="space-y-4">
      <Header
        title="Minha lista"
        description="Todas as obras em que você se pronunciou — por status de leitura ou por nota sua. O catálogo inteiro fica em Catálogo; aqui só o que é seu."
        icon={<Library />}
      />

      <MyListView
        works={lista.works}
        counts={lista.counts}
        semPrateleira={lista.semPrateleira}
      />

      <UntrackedEntry foraDaLista={lista.foraDaLista} paraTriar={lista.paraTriar} />
    </div>
  )
}
