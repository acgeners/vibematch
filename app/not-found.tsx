import Link from "next/link"
import { SearchX } from "lucide-react"
import { EmptyState } from "@/components/ui/empty-state"
import { Button } from "@/components/ui/button"
import { NOT_FOUND_COPY } from "@/lib/errors/copy"

/**
 * 404 do app. Cobre endereço inexistente E os `notFound()` explícitos — hoje 5 no trunk:
 * `app/catalog/[id]/page.tsx`, `app/catalog/[id]/edit/page.tsx`,
 * `app/recommendations/[slug]/page.tsx`, `app/recommendations/chat/[slug]/page.tsx` e
 * `components/curation/console-shell.tsx` (o caminho do leitor logado que tenta `/curation`).
 *
 * 🔴 Até 2026-09-25 esses 5 caminhos serviam a tela padrão do Next — "404 | This page could
 * not be found", em INGLÊS, num app inteiramente em pt-BR. Não é detalhe de acabamento: o
 * do `console-shell` é a resposta que um usuário legítimo recebe ao bater numa área que não
 * é dele, e ele fica sem saber se errou o endereço ou se não tem acesso.
 *
 * ⚠️ Server Component, sem `"use client"`: não há estado, nem handler, nem `reset()`. 404 é
 * definitivo — oferecer "Tentar novamente" prometeria que recarregar muda o resultado.
 *
 * ⚠️ Não imprime o caminho pedido. Ecoar slug/id devolveria ao visitante o texto que ele
 * mesmo digitou, numa página servida pelo app, sem acrescentar nada a quem já o conhece.
 */
export default function NotFound() {
  return (
    <EmptyState
      icon={<SearchX aria-hidden className="mx-auto size-10" />}
      title={NOT_FOUND_COPY.titulo}
      description={NOT_FOUND_COPY.descricao}
      action={
        <div className="flex flex-wrap items-center justify-center gap-2">
          <Button asChild>
            <Link href="/">{NOT_FOUND_COPY.inicio}</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/catalog">{NOT_FOUND_COPY.catalogo}</Link>
          </Button>
        </div>
      }
    />
  )
}
