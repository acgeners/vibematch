"use client"

import * as React from "react"

import { Button } from "@/components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

type SaveButtonProps = React.ComponentProps<typeof Button> & {
  /**
   * Motivo exibido num tooltip enquanto o botão está desabilitado — ex.:
   * "Nenhuma alteração para salvar". Só aparece quando `disabled` é true;
   * passe `undefined` quando o botão estiver desabilitado por já estar salvando.
   */
  disabledReason?: React.ReactNode
  /**
   * Classe do <span> que embrulha o botão para o tooltip funcionar
   * (ex.: "w-full" quando o botão ocupa a linha inteira).
   */
  wrapperClassName?: string
}

/**
 * Botão de salvar/ação que explica, num tooltip, por que está desabilitado.
 * Botão nativo desabilitado não dispara hover (`disabled:pointer-events-none`),
 * então quando há motivo a mostrar embrulhamos num <span> que recebe o hover.
 * Sem `disabledReason` (ou habilitado) renderiza um Button normal, sem overhead.
 */
export function SaveButton({
  disabledReason,
  wrapperClassName,
  disabled,
  ...props
}: SaveButtonProps) {
  const button = <Button disabled={disabled} {...props} />

  if (!disabled || !disabledReason) return button

  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className={cn("inline-flex", wrapperClassName)}>{button}</span>
        </TooltipTrigger>
        <TooltipContent>{disabledReason}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
