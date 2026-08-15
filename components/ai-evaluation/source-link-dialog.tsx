"use client"

import { useState } from "react"
import { Link2, SkipForward } from "lucide-react"
import { toast } from "sonner"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { SourceSelectionStep } from "@/components/titles/source-selection-step"
import { useRefresh } from "@/lib/use-refresh"

export interface SourceLinkQueueItem {
  id: string
  title: string
}

/**
 * Diálogo de "Atribuir fontes" da aba Fontes: hospeda o `SourceSelectionStep` — o
 * MESMO passo que o "Atualizar dados" da página da obra usa — e, ao salvar, avança
 * sozinho pra próxima obra da fila.
 *
 * 🔴 **Reusar o passo é o ponto, não uma economia.** Ele já resolve o que uma segunda
 * tela erraria em silêncio: distingue "fonte fora do ar" de "obra sem match" (senão uma
 * queda de infra vira rejeição gravada), marca candidato não-reconfirmado em vez de
 * mostrá-lo como match real, e traz o campo de hid manual da Comix. Uma UI própria aqui
 * seria um segundo critério pro mesmo fato — e o lado errado venceria calado.
 *
 * ⚠️ **A busca é ÂMBAR (request-scoped), não azul.** `revalidateWorkSources` só LÊ: o
 * resultado existe na tela e some se você sair. Por isso ele não entra no `runTask` —
 * o indicador azul convidaria a navegar e jogaria fora o trabalho. E por morar num
 * `Dialog` (modal do Radix, com scrim), a porta de saída é FECHAR o diálogo: nada de
 * `guardNavigation`, que criaria um interceptador global que nunca dispara.
 *
 * ⚠️ O `key` no `SourceSelectionStep` é obrigatório: ele busca uma vez no mount
 * (`useEffect` com `[workId]` faz a re-busca, mas o estado de seleção é local e
 * sobreviveria à troca). Trocar a chave desmonta e remonta limpo a cada obra.
 */
export function SourceLinkDialog({
  queue,
  startIndex,
  open,
  onOpenChange,
}: {
  /** A fila JÁ na ordem da lista exibida — o "próxima" segue o que está na tela. */
  queue: SourceLinkQueueItem[]
  startIndex: number
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [index, setIndex] = useState(startIndex)
  const [done, setDone] = useState(0)
  const refresh = useRefresh()

  const current = queue[index]
  const next = queue[index + 1]

  const close = () => {
    onOpenChange(false)
    // Só recarrega se algo foi salvo — a lista é uma query de servidor, e refrescar
    // depois de um "Cancelar" cobraria o scan à toa.
    if (done > 0) refresh()
  }

  // `completed` vem por PARÂMETRO em vez de ler `done`: o `setDone` do caller ainda
  // não foi aplicado quando isto roda, e o valor do closure seria o de antes da obra
  // que acabou de ser salva — um "0 obra(s) revisada(s)" ao fim de uma fila de uma.
  const finish = (completed: number) => {
    toast.success(
      completed === 1 ? "Fila concluída." : `Fila concluída — ${completed} obra(s) revisada(s).`,
    )
    onOpenChange(false)
    refresh()
  }

  if (!current) return null

  return (
    <Dialog open={open} onOpenChange={(v) => (v ? onOpenChange(true) : close())}>
      <DialogContent className="flex max-h-[95vh] flex-col overflow-hidden sm:max-w-2xl">
        <DialogHeader className="shrink-0 text-left">
          <DialogTitle className="flex items-center gap-2 text-base">
            <Link2 className="size-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0 truncate">{current.title}</span>
          </DialogTitle>
          {/* ⚠️ NÃO repetir "confirme os matches por fonte": o próprio
              `SourceSelectionStep` abre com essa frase, dois centímetros abaixo. O que só
              esta tela sabe é a consequência na FILA — e os nomes das opções são citados
              exatamente como aparecem nos rádios, senão a explicação e o controle passam a
              chamar a mesma coisa por dois nomes. */}
          <DialogDescription className="text-xs">
            O que tira a obra desta fila é decidir cada fonte:{" "}
            <strong>ignorar esta fonte</strong> fecha a lacuna;{" "}
            <strong>não decidir agora</strong> a mantém aqui.
          </DialogDescription>
        </DialogHeader>

        {queue.length > 1 && (
          <div className="flex shrink-0 flex-wrap items-center gap-2 rounded-md border border-border/60 bg-muted/40 px-2.5 py-1.5 text-xs">
            <span className="font-medium tabular-nums text-foreground">
              Fila · {index + 1} de {queue.length}
            </span>
            <span className="min-w-0 flex-1 truncate text-muted-foreground">
              {next ? `próxima: ${next.title}` : "última da fila"}
            </span>
            <div className="flex shrink-0 items-center gap-1">
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2"
                onClick={() => (next ? setIndex(index + 1) : close())}
              >
                <SkipForward className="h-3.5 w-3.5" /> Pular esta
              </Button>
              <Button variant="ghost" size="sm" className="h-7 px-2" onClick={close}>
                Encerrar fila
              </Button>
            </div>
          </div>
        )}

        {/* Área de rolagem ÚNICA do diálogo: sem ela quem rola é o DialogContent e o
            cabeçalho + a barra da fila rolam junto — com 9 fontes de candidatos o
            "Continuar" do passo sai da tela e o diálogo vira beco sem saída.
            `min-h-0` é o que deixa o flex item encolher abaixo do conteúdo. */}
        <div className="-mx-6 min-h-0 flex-1 overflow-y-auto px-6">
          <SourceSelectionStep
            key={current.id}
            workId={current.id}
            confirmLabel={next ? "Salvar e ir pra próxima" : "Salvar"}
            onConfirm={() => {
              setDone(done + 1)
              if (next) setIndex(index + 1)
              else finish(done + 1)
            }}
            onCancel={close}
          />
        </div>
      </DialogContent>
    </Dialog>
  )
}
