"use client"

import { useRouter } from "next/navigation"
import { useTransition } from "react"
import { CheckCheck, Loader2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { setChaptersRead } from "@/server/actions/works"
import { refreshChrome } from "@/lib/chrome-refresh"

/**
 * "Marcar até o N" do destaque da home — o mesmo gesto que existe em cada card da /reading,
 * na tela onde a obra está em foco.
 *
 * Usa a MESMA action (`setChaptersRead`), então o estado escrito é idêntico ao da /reading:
 * um caminho só para "li até aqui", em vez de dois que podem divergir.
 *
 * Depois de salvar, `router.refresh()` re-renderiza a home no servidor — o destaque muda
 * sozinho, porque a obra deixa de ter capítulo pendente e sai do pool. `refreshChrome()`
 * acompanha para os contadores da sidebar não ficarem para trás.
 */
export function MarkReadButton({
  workId,
  upTo,
  label,
}: {
  workId: string
  /** Capítulo até onde marcar — o último lançado conhecido. */
  upTo: number
  label?: string
}) {
  const router = useRouter()
  const [saving, startSaving] = useTransition()

  const run = () =>
    startSaving(async () => {
      const res = await setChaptersRead(workId, upTo)
      if (res && "error" in res && res.error) {
        toast.error("Não salvou os capítulos", { description: res.error })
        return
      }
      toast.success(`Marcado até o capítulo ${upTo}`)
      refreshChrome()
      router.refresh()
    })

  return (
    <Button variant="outline" size="sm" onClick={run} disabled={saving}>
      {saving ? <Loader2 className="size-3.5 animate-spin" /> : <CheckCheck className="size-3.5" />}
      {label ?? `Marcar até o ${upTo}`}
    </Button>
  )
}
