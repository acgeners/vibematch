"use client"

import * as React from "react"
import { Check, Copy } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

/**
 * Botão de copiar um texto que está na tela.
 *
 * 🔴 Selecionar com o mouse NÃO devolve o texto: triple-click num elemento de bloco
 * faz o browser serializar a borda do bloco junto, e o que cola vem com linhas em
 * branco depois do texto ("As the Heart Leads\n\n"). O botão copia exatamente o
 * valor, sem depender de como o browser resolve a seleção.
 *
 * ⚠️ O valor vai TRIMADO. O espaço sobrando é do dado, não do que a pessoa leu na
 * tela — medido em 2026-08-17: 3 das 988 obras do catálogo têm título com espaço
 * nas pontas (`[Horimiya ]`, `[ Growing the Seed of Evil]`), invisível no HTML e
 * bem visível ao colar num campo de busca.
 */
export function CopyButton({
  value,
  label,
  copiedLabel = "Copiado!",
  size = "icon-sm",
  className,
}: {
  value: string
  /** O que a ação faz — vira `aria-label` e `title`. Ex.: "Copiar o nome da obra". */
  label: string
  copiedLabel?: string
  size?: "icon-xs" | "icon-sm" | "icon"
  className?: string
}) {
  const [copied, setCopied] = React.useState(false)
  const timeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)

  // Sem isto, um clique seguido de navegação agenda setState num componente
  // desmontado — e o timer sobrevive à saída da página.
  React.useEffect(
    () => () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current)
    },
    []
  )

  const handleCopy = async () => {
    const ok = await writeToClipboard(value.trim())
    if (!ok) {
      // Falha calada aqui é um botão morto: a pessoa clica, nada muda na tela e
      // ela só descobre ao colar.
      toast.error("Não consegui copiar — o navegador bloqueou a área de transferência.")
      return
    }
    setCopied(true)
    if (timeoutRef.current) clearTimeout(timeoutRef.current)
    timeoutRef.current = setTimeout(() => setCopied(false), 1500)
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size={size}
      onClick={handleCopy}
      aria-label={copied ? copiedLabel : label}
      title={copied ? copiedLabel : label}
      className={cn(
        "text-muted-foreground hover:text-foreground",
        copied && "text-emerald-600 hover:text-emerald-600 dark:text-emerald-400 dark:hover:text-emerald-400",
        className
      )}
    >
      {copied ? <Check /> : <Copy />}
      {/* O ícone trocando é feedback só pra quem vê. A região viva anuncia o
          desfecho pra quem usa leitor de tela — trocar o `aria-label` do botão
          focado não é anunciado de forma confiável. */}
      <span role="status" aria-live="polite" className="sr-only">
        {copied ? copiedLabel : ""}
      </span>
    </Button>
  )
}

async function writeToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // cai no fallback
  }

  // `navigator.clipboard` só existe em contexto seguro (https ou localhost) e pode
  // ser negado por permissão — sem este caminho o botão morre em silêncio nesses casos.
  try {
    const area = document.createElement("textarea")
    area.value = text
    area.setAttribute("readonly", "")
    area.style.position = "fixed"
    area.style.top = "0"
    area.style.opacity = "0"
    document.body.appendChild(area)
    area.select()
    const ok = document.execCommand("copy")
    document.body.removeChild(area)
    return ok
  } catch {
    return false
  }
}
