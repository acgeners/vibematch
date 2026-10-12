import Link from "next/link"
import { cn } from "@/lib/utils"
import { EDITION_LABEL, MIXED_EDITIONS } from "@/lib/editions/mixed-edition"
import type { EditionResolution, MixedEdition } from "@/lib/editions/mixed-edition"

/**
 * Seletor PAGE-WIDE da edição de uma obra `mixed` (fase 2). Estado na URL (`?edition=normal|r18`):
 * links, não um switch — a página inteira (nota, tags, avisos, reviews, Nota Prevista) é renderizada
 * no servidor para a edição escolhida, e trocar de edição é navegar.
 *
 * ⚠️ Só existe para `mixed`. `single`, `r18_only` e `unknown` têm UMA edição — quem chama não monta.
 * ⚠️ Trocar aqui NÃO muda a preferência da conta (`user_settings.preferred_mixed_edition`); a página
 * abre de novo na preferência na próxima visita sem `?edition=`.
 */
export function EditionSelector({
  basePath,
  resolution,
}: {
  basePath: string
  resolution: EditionResolution
}) {
  const nota =
    resolution.source === "hide_adult"
      ? "Você oculta conteúdo 18+: a versão R18 pede confirmação e sua preferência não muda."
      : resolution.source === "adult_filter_hide"
        ? "O filtro da lista oculta 18+."
        : resolution.source === "adult_filter_only"
          ? "O filtro da lista mostra só 18+."
          : resolution.source === "preference"
            ? "Pela sua preferência de versão."
            : resolution.source === "fallback"
              ? "Esta obra tem duas versões; a normal é a padrão."
              : resolution.requiresConfirmation
                ? "Versão R18 aberta só nesta visita — sua preferência de ocultar 18+ continua."
                : null
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
