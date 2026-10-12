import Link from "next/link"
import { cn } from "@/lib/utils"
import { EDITION_LABEL, MIXED_EDITIONS } from "@/lib/editions/mixed-edition"
import type { EditionResolution, MixedEdition } from "@/lib/editions/mixed-edition"

/** A frase ao lado do seletor: POR QUE esta versão está aberta. Exportada para o teste. */
export function editionSelectorNote(resolution: EditionResolution): string | null {
  switch (resolution.source) {
    case "hide_adult":
      return "Você oculta conteúdo 18+: a versão R18 pede confirmação e sua preferência não muda."
    case "adult_filter_hide":
      return "O filtro da lista oculta 18+."
    case "adult_filter_only":
      return "O filtro da lista mostra só 18+."
    case "account":
      return "Você vê conteúdo 18+, então a versão R18 é a padrão."
    case "extras_only":
      return "A versão R18 desta obra está só nos extras; a normal é a padrão."
    case "anonymous":
      return "Esta obra tem duas versões; a normal é a padrão."
    case "url":
      return resolution.requiresConfirmation ? "Versão R18 aberta só nesta visita — sua preferência de ocultar 18+ continua." : null
  }
}

/**
 * Seletor PAGE-WIDE da edição de uma obra `mixed` (fase 2). Estado na URL (`?edition=normal|r18`):
 * links, não um switch — a página inteira (nota, tags, avisos, reviews, Nota Prevista) é renderizada
 * no servidor para a edição escolhida, e trocar de edição é navegar.
 *
 * ⚠️ Só existe para `mixed`. `single`, `r18_only` e `unknown` têm UMA edição — quem chama não monta.
 * ⚠️ Trocar aqui é pontual: NÃO muda a preferência de 18+ da conta, e a página abre de novo na versão
 * padrão (decidida por ela) na próxima visita sem `?edition=`.
 */
export function EditionSelector({
  basePath,
  resolution,
}: {
  basePath: string
  resolution: EditionResolution
}) {
  const nota = editionSelectorNote(resolution)
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5" data-slot="edition-selector">
      <div role="group" aria-label="Versão da obra" className="inline-flex rounded-lg border bg-muted/40 p-0.5">
        {MIXED_EDITIONS.map((ed: MixedEdition) => {
          const ativa = ed === resolution.edition
          return (
            <Link
              key={ed}
              href={`${basePath}?edition=${ed}`}
              replace
              scroll={false}
              aria-current={ativa ? "page" : undefined}
              className={cn(
                "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                ativa ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {EDITION_LABEL[ed]}
            </Link>
          )
        })}
      </div>
      {nota && <span className="text-xs text-muted-foreground">{nota}</span>}
    </div>
  )
}
