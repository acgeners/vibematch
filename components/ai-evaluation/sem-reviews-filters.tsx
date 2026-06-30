"use client"

import { useRouter, useSearchParams, usePathname } from "next/navigation"
import { useState, useTransition } from "react"
import { ArrowDown, ArrowUp, Search, X } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { PUBLICATION_STATUSES_BY_ID } from "@/lib/constants/criteria"
import { PERSONAL_STATUSES, SYNOPSIS_QUALITIES } from "@/types/domain"
import type { NoReviewSort, NoReviewSortKey } from "@/lib/reviews/no-review-classify"

const PUB_OPTIONS = Object.values(PUBLICATION_STATUSES_BY_ID).map((i) => i.status)

const SORT_OPTIONS: { key: NoReviewSortKey; label: string }[] = [
  { key: "title", label: "Título" },
  { key: "expected", label: "Nota prevista" },
  { key: "reviews", label: "Nº reviews" },
]

/** Rascunho local dos filtros — espelha os props (URL aplicada) e só vai pra URL no "Aplicar". */
interface Draft {
  q: string
  pub: string[]
  personal: string[]
  interest: string[]
  src: "yes" | "no" | null
  golden: boolean
  min: number
  max: number
}

export function SemReviewsFilters({
  q,
  activePubStatuses,
  activePersonalStatuses,
  activeInterest,
  hasExternal,
  goldenOnly,
  minReviews,
  maxReviews,
  sort,
}: {
  q: string
  activePubStatuses: string[]
  activePersonalStatuses: string[]
  activeInterest: string[]
  hasExternal: "yes" | "no" | null
  goldenOnly: boolean
  minReviews: number
  maxReviews: number
  sort: NoReviewSort
}) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [isPending, startTransition] = useTransition()

  // Filtros são um RASCUNHO local (staged): mexer nos chips/campos só altera o
  // estado local; nada navega/bate no banco até clicar "Aplicar". Assim ajusta-se
  // vários filtros com UMA navegação/refetch só. A ORDENAÇÃO é exceção: aplica no
  // clique (ação única), levando o rascunho pendente junto pra não perder edições.
  const makeDraft = (): Draft => ({
    q,
    pub: activePubStatuses,
    personal: activePersonalStatuses,
    interest: activeInterest,
    src: hasExternal,
    golden: goldenOnly,
    min: minReviews,
    max: maxReviews,
  })
  const [draft, setDraft] = useState<Draft>(makeDraft)
  // Re-semeia quando a URL aplicada (props) muda — após Aplicar / troca de aba.
  const propsSignature = JSON.stringify([q, activePubStatuses, activePersonalStatuses, activeInterest, hasExternal, goldenOnly, minReviews, maxReviews])
  const [seenSignature, setSeenSignature] = useState(propsSignature)
  if (propsSignature !== seenSignature) {
    setSeenSignature(propsSignature)
    setDraft(makeDraft())
  }

  // Serializa o rascunho na URL (preserva params não-gerenciados; força tab).
  const buildParams = (d: Draft): URLSearchParams => {
    const p = new URLSearchParams(searchParams.toString())
    p.set("tab", "sem-reviews")
    const setOrDel = (key: string, value: string | null) => {
      if (value == null || value === "") p.delete(key)
      else p.set(key, value)
    }
    setOrDel("q", d.q.trim() || null)
    setOrDel("pub", d.pub.length ? d.pub.join(",") : null)
    setOrDel("personal", d.personal.length ? d.personal.join(",") : null)
    setOrDel("synopsis_q", d.interest.length ? d.interest.join(",") : null)
    setOrDel("src", d.src)
    setOrDel("golden", d.golden ? "1" : null)
    setOrDel("minrev", d.min > 0 ? String(d.min) : null)
    setOrDel("maxrev", d.max > 0 ? String(d.max) : null)
    return p
  }

  const navigate = (p: URLSearchParams) => {
    startTransition(() => router.replace(`${pathname}?${p.toString()}`, { scroll: false }))
  }

  const apply = () => navigate(buildParams(draft))

  // Há mudanças não aplicadas? Compara a assinatura das chaves de filtro (sort à parte).
  const OWNED_KEYS = ["q", "pub", "personal", "synopsis_q", "src", "golden", "minrev", "maxrev"]
  const ownedSig = (p: URLSearchParams) => OWNED_KEYS.map((k) => `${k}=${p.get(k) ?? ""}`).join("&")
  const isDirty = ownedSig(buildParams(draft)) !== ownedSig(new URLSearchParams(searchParams.toString()))

  const toggleIn = (list: string[], value: string) =>
    list.includes(value) ? list.filter((x) => x !== value) : [...list, value]

  const clearAll = () => {
    setDraft({ q: "", pub: [], personal: [], interest: [], src: null, golden: false, min: 0, max: 0 })
    const p = new URLSearchParams()
    p.set("tab", "sem-reviews")
    navigate(p)
  }

  // Ordenação aplica no clique (instantâneo), carregando o rascunho pendente junto.
  const setSort = (key: NoReviewSortKey) => {
    const dir: "asc" | "desc" = sort.key === key ? (sort.dir === "asc" ? "desc" : "asc") : key === "title" ? "asc" : "desc"
    const isDefault = key === "title" && dir === "asc"
    const p = buildParams(draft)
    if (isDefault) p.delete("sortr")
    else p.set("sortr", `${key}-${dir}`)
    navigate(p)
  }

  const hasAny =
    draft.q ||
    draft.pub.length > 0 ||
    draft.personal.length > 0 ||
    draft.interest.length > 0 ||
    draft.src != null ||
    draft.golden ||
    draft.min > 0 ||
    draft.max > 0 ||
    sort.key !== "title" ||
    sort.dir !== "asc"

  return (
    <div className="space-y-3 rounded-lg border border-border/60 p-3">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={draft.q}
            onChange={(e) => setDraft((d) => ({ ...d, q: e.target.value }))}
            onKeyDown={(e) => { if (e.key === "Enter") apply() }}
            placeholder="Buscar por título…"
            className="pl-8"
            aria-label="Buscar por título"
          />
        </div>
        {isDirty && !isPending && (
          <span className="text-[11px] font-medium text-amber-600 dark:text-amber-500">alterações não aplicadas</span>
        )}
        {hasAny ? (
          <Button variant="ghost" size="sm" onClick={clearAll} disabled={isPending}>
            <X className="mr-1 h-3.5 w-3.5" /> Limpar
          </Button>
        ) : null}
        <Button size="sm" onClick={apply} disabled={!isDirty || isPending}>
          {isPending ? "Aplicando…" : "Aplicar"}
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-xs text-muted-foreground">Publicação:</span>
        {PUB_OPTIONS.map((s) => (
          <button key={s} type="button" onClick={() => setDraft((d) => ({ ...d, pub: toggleIn(d.pub, s) }))} disabled={isPending}>
            <Badge variant={draft.pub.includes(s) ? "default" : "outline"} className="cursor-pointer">
              {s}
            </Badge>
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-xs text-muted-foreground">Leitura:</span>
        {PERSONAL_STATUSES.map((s) => (
          <button key={s} type="button" onClick={() => setDraft((d) => ({ ...d, personal: toggleIn(d.personal, s) }))} disabled={isPending}>
            <Badge variant={draft.personal.includes(s) ? "default" : "outline"} className="cursor-pointer">
              {s}
            </Badge>
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-xs text-muted-foreground">Interesse:</span>
        {SYNOPSIS_QUALITIES.map((s) => (
          <button key={s} type="button" onClick={() => setDraft((d) => ({ ...d, interest: toggleIn(d.interest, s) }))} disabled={isPending}>
            <Badge variant={draft.interest.includes(s) ? "default" : "outline"} className="cursor-pointer text-sm">
              {s}
            </Badge>
          </button>
        ))}
        <button type="button" onClick={() => setDraft((d) => ({ ...d, interest: toggleIn(d.interest, "none") }))} disabled={isPending}>
          <Badge variant={draft.interest.includes("none") ? "default" : "outline"} className="cursor-pointer">
            Não avaliada
          </Badge>
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-xs text-muted-foreground">Fonte externa:</span>
        <button type="button" onClick={() => setDraft((d) => ({ ...d, src: d.src === "yes" ? null : "yes" }))} disabled={isPending}>
          <Badge variant={draft.src === "yes" ? "default" : "outline"} className="cursor-pointer">Possui</Badge>
        </button>
        <button type="button" onClick={() => setDraft((d) => ({ ...d, src: d.src === "no" ? null : "no" }))} disabled={isPending}>
          <Badge variant={draft.src === "no" ? "default" : "outline"} className="cursor-pointer">Sem fonte aceita</Badge>
        </button>
        <span className="ml-3 text-xs text-muted-foreground">Golden:</span>
        <button type="button" onClick={() => setDraft((d) => ({ ...d, golden: !d.golden }))} disabled={isPending}>
          <Badge variant={draft.golden ? "default" : "outline"} className="cursor-pointer">Só golden pilot-1</Badge>
        </button>
        <span className="ml-3 text-xs text-muted-foreground">Reviews úteis (mín/máx):</span>
        <Input
          type="number"
          min={0}
          step={1}
          value={draft.min || ""}
          onChange={(e) => setDraft((d) => ({ ...d, min: Math.max(0, Math.floor(Number(e.target.value) || 0)) }))}
          onKeyDown={(e) => { if (e.key === "Enter") apply() }}
          disabled={isPending}
          className="h-7 w-16"
          aria-label="Mínimo de reviews úteis"
        />
        <span className="text-xs text-muted-foreground">–</span>
        <Input
          type="number"
          min={0}
          step={1}
          value={draft.max || ""}
          onChange={(e) => setDraft((d) => ({ ...d, max: Math.max(0, Math.floor(Number(e.target.value) || 0)) }))}
          onKeyDown={(e) => { if (e.key === "Enter") apply() }}
          disabled={isPending}
          className="h-7 w-16"
          aria-label="Máximo de reviews úteis"
        />
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-xs text-muted-foreground">Ordenar:</span>
        {SORT_OPTIONS.map((opt) => {
          const active = sort.key === opt.key
          return (
            <button key={opt.key} type="button" onClick={() => setSort(opt.key)} disabled={isPending}>
              <Badge variant={active ? "default" : "outline"} className="cursor-pointer gap-1">
                {opt.label}
                {active ? (sort.dir === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />) : null}
              </Badge>
            </button>
          )
        })}
      </div>
    </div>
  )
}
