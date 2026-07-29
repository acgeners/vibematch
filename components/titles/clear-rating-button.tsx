"use client"

import { useState } from "react"
import { Trash2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { clearUserRating } from "@/server/actions/user-rating"
import { useRefresh } from "@/lib/use-refresh"

interface Props {
  workId: string
  /** Nota pessoal gravada hoje. O botão não renderiza quando é `null` — não há o que apagar. */
  userScore: number | null
  /** Quantos dos 8 critérios craft estão preenchidos. */
  craftFilled: number
  /** Quantos dos 8 eixos de gosto estão preenchidos. */
  tasteFilled: number
}

/**
 * "Remover minha nota" — o único caminho pra apagar a própria avaliação de uma obra.
 *
 * Antes não existia nenhum: o campo "Minha nota" é `readOnly` (a nota é derivada) e os dois
 * formulários guardam o valor anterior quando as notas de origem são zeradas, então limpar as
 * estrelas e salvar devolvia a mesma nota. Por isso este botão apaga a nota E as avaliações que
 * a geram — apagar só a derivada seria teatro: a próxima estrela clicada a recalcularia igual.
 *
 * Destrutivo e sem desfazer (e o banco não tem backup automático) → confirmação obrigatória,
 * listando o que será perdido.
 */
export function ClearRatingButton({ workId, userScore, craftFilled, tasteFilled }: Props) {
  const [open, setOpen] = useState(false)
  const [clearing, setClearing] = useState(false)
  const refresh = useRefresh()

  if (userScore == null) return null

  const confirm = async () => {
    setClearing(true)
    const result = await clearUserRating(workId)
    setClearing(false)
    if (!result.ok) {
      toast.error(result.error)
      return
    }
    setOpen(false)
    toast.success("Nota removida.")

    // `refresh()` primeiro: avisa o chrome e as OUTRAS abas (broadcast). Depois recarrega esta.
    //
    // A recarga é necessária, não preguiça: `PostTasteAssessment` semeia as estrelas num
    // `useState({ ...initialScores })` e NUNCA re-sincroniza com a prop. Um `router.refresh()`
    // sozinho traz o dado novo do servidor e a tela continua mostrando as estrelas apagadas
    // preenchidas — o usuário apagaria a nota e veria a avaliação intacta. Dar `key` ao card
    // resolveria, mas a key mudaria também a cada autosave de estrela (o `savePilotTaste`
    // revalida a rota), e um remount no meio do debounce de 550ms descartaria o clique seguinte.
    refresh()
    window.location.reload()
  }

  const losses = [
    `A nota pessoal ${userScore.toFixed(1)}`,
    craftFilled > 0 ? `${craftFilled} de 8 critérios de avaliação` : null,
    tasteFilled > 0 ? `${tasteFilled} de 8 notas de gosto ("Como foi pra você")` : null,
  ].filter((l): l is string => l != null)

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => setOpen(true)}
        className="text-muted-foreground hover:bg-red-500/10 hover:text-red-600 dark:hover:text-red-400"
      >
        <Trash2 className="h-3.5 w-3.5" />
        Remover minha nota
      </Button>

      <AlertDialog open={open} onOpenChange={(v) => !clearing && setOpen(v)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover sua avaliação desta obra?</AlertDialogTitle>
            <AlertDialogDescription>
              Isto apaga a nota e as avaliações que a geram. Não dá pra desfazer.
            </AlertDialogDescription>
          </AlertDialogHeader>

          <ul className="space-y-1.5 rounded-md bg-muted/40 p-3 text-sm">
            {losses.map((l) => (
              <li key={l} className="flex items-start gap-2">
                <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-red-500" aria-hidden />
                <span>{l}</span>
              </li>
            ))}
          </ul>

          <p className="text-xs leading-relaxed text-muted-foreground">
            A obra sai do treino da Nota Prevista (recalculado depois) e as previsões já medidas
            contra esta nota são <span className="font-medium text-foreground">descartadas</span> —
            sem gabarito não há acerto nem erro a contar. Seu status de leitura, anotações,
            interesse ♥ e a sua releitura dos atributos da IA{" "}
            <span className="font-medium text-foreground">não são afetados</span>.
          </p>

          <AlertDialogFooter>
            <AlertDialogCancel disabled={clearing}>Cancelar</AlertDialogCancel>
            {/* Button cru em vez de AlertDialogAction: o Action fecha o diálogo no clique, e aqui
                ele precisa ficar aberto mostrando "Removendo…" até a action responder. */}
            <Button type="button" variant="destructive" onClick={confirm} disabled={clearing}>
              {clearing ? "Removendo…" : "Remover"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
