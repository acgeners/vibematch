import Link from "next/link"
import { BookOpenText } from "lucide-react"

/**
 * A porta de entrada de um dicionário, a partir da tela onde o número está sendo lido.
 *
 * 🔴 É um LINK, nunca conteúdo de tooltip. O `TooltipContent` do Radix fecha quando o mouse
 * sai do gatilho, então um link lá dentro é inalcançável — capacidade construída e desligada,
 * a mesma família do fallback de capa que vivia na docstring e em tela nenhuma.
 *
 * ⚠️ E nunca no chip de faixa: são 9 por obra, e o chip já mostra a rubrica daquela faixa no
 * tooltip. A porta mora no CABEÇALHO do bloco — um por card, ao lado do que ela explica.
 *
 * ⚠️ Sem ✨: a marca significa "um modelo escreveu isto" e o dicionário é texto do projeto.
 * Gastá-la aqui a esvaziaria onde ela importa (ver "Dado gerado por IA carrega um SELO").
 */
export function GlossaryLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
    >
      <BookOpenText className="h-3.5 w-3.5 shrink-0" aria-hidden />
      {children}
    </Link>
  )
}
