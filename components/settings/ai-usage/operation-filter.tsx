"use client"

import { Filter } from "lucide-react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { useTransition } from "react"

interface Props {
  operations: string[]
  active: string | null
}

export function OperationFilter({ operations, active }: Props) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [pending, startTransition] = useTransition()

  function handleChange(event: React.ChangeEvent<HTMLSelectElement>) {
    const value = event.target.value
    const params = new URLSearchParams(searchParams.toString())
    if (value) params.set("op", value)
    else params.delete("op")
    const qs = params.toString()
    startTransition(() => {
      router.push(qs ? `${pathname}?${qs}` : pathname)
    })
  }

  return (
    <label
      className="inline-flex items-center gap-2 rounded-lg border border-border/70 bg-card/60 px-2.5 py-1.5 text-xs shadow-sm shadow-black/5"
      title="Filtrar todas as métricas por operação"
    >
      <Filter className="h-3.5 w-3.5 text-muted-foreground" />
      <span className="font-medium text-muted-foreground">Operação</span>
      <select
        value={active ?? ""}
        onChange={handleChange}
        disabled={pending}
        className="cursor-pointer bg-transparent font-mono text-[11px] font-medium text-foreground outline-none disabled:opacity-50"
      >
        <option value="">Todas</option>
        {operations.map((op) => (
          <option key={op} value={op}>
            {op}
          </option>
        ))}
      </select>
    </label>
  )
}
