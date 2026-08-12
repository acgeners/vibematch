"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  Activity,
  BookMarked,
  BookOpen,
  BookOpenText,
  ChartNoAxesCombined,
  Clock,
  Gauge,
  Globe,
  Heart,
  Home,
  Info,
  Palette,
  Plus,
  Scale,
  Search,
  Settings,
  ShieldAlert,
  SlidersHorizontal,
  Sparkles,
  Trophy,
  UserCircle,
  Wand2,
  Wrench,
} from "lucide-react"
import type { LucideIcon } from "lucide-react"
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import { useIsSignedIn, useRole } from "@/components/layout/admin-context"
import { searchWorkSuggestions } from "@/server/actions/work-search"
import type { WorkSuggestion } from "@/server/queries/work-suggestions"
import type { SearchEntry, SearchKind } from "@/server/queries/search-index"
import { roleAtLeast } from "@/lib/plans/roles"
import { cn } from "@/lib/utils"

const ICONS: Record<string, LucideIcon> = {
  Home, BookOpen, Trophy, Wand2, Info, BookOpenText, BookMarked, Heart, Clock,
  Upload: BookOpenText, UserCircle, Sparkles, Gauge, Wrench, Activity,
  ChartNoAxesCombined, Plus, Settings, Globe, Scale, Palette, ShieldAlert,
  SlidersHorizontal,
}

/** Mesma regra do `/titles`: com 1 letra o resultado é grande demais pra ser útil. */
const MIN_WORK_QUERY = 2
/** Espera o usuário parar de digitar antes de ir ao servidor. */
const DEBOUNCE_MS = 200

/** Referência estável: um `[]` novo a cada render invalidaria os memos que dependem dele. */
const EMPTY_WORKS: WorkSuggestion[] = []
const EMPTY_ENTRIES: SearchEntry[] = []

type Scope = "tudo" | "obra" | "config" | "pref" | "page"

const SCOPES: Array<{ k: Scope; label: string; prefix: string | null }> = [
  { k: "tudo", label: "Tudo", prefix: null },
  { k: "obra", label: "Obras", prefix: "obra:" },
  { k: "config", label: "Configurações", prefix: "config:" },
  { k: "pref", label: "Preferências", prefix: "pref:" },
  { k: "page", label: "Páginas", prefix: "ir:" },
]

const KIND_LABEL: Record<SearchKind, string> = {
  config: "Configurações",
  pref: "Preferências",
  page: "Páginas",
}

/** minúsculas + sem acento — "calibracao" tem que achar "Calibração". */
function fold(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
}

/**
 * Casa por INÍCIO DE PALAVRA, não por substring solta.
 *
 * ⚠️ A 1ª versão fazia `includes()` no texto inteiro, e o resultado era surpreendente: buscar
 * "cor" trazia "Viés & atributos", porque a descrição dela diz "Nenhum **sco**re é alterado" —
 * s-cor-e contém "cor". Também casava em "correções", "percorre", "decoração". Quem digita
 * "cor" quer "Cores das notas".
 *
 * Termo com espaço volta a ser substring do texto todo: aí a intenção é uma frase
 * ("nota 18+"), e exigir início de palavra em cada pedaço quebraria o casamento.
 */
function matchesTerm(haystack: string, term: string): boolean {
  const t = fold(term)
  if (!t) return true
  const h = fold(haystack)
  if (t.includes(" ")) return h.includes(t)
  return h.split(/[^\p{L}\p{N}+]+/u).some((w) => w.startsWith(t))
}

/**
 * A busca global do app — o que ⌘K abre.
 *
 * Duas velocidades de propósito: páginas e seções saem NA TECLA (o índice veio no HTML, é
 * dado estático dos registries); obras precisam do servidor e chegam depois, sem travar o
 * resto da lista. É a diferença entre "achar o ajuste cujo nome não lembro" — instantâneo —
 * e "achar aquela obra", que sempre foi uma busca de catálogo.
 *
 * Renderiza o GATILHO e o DIÁLOGO juntos: assim o atalho de teclado e o botão do topo moram no
 * mesmo lugar, sem context nem estado global pra manter em sincronia.
 */
export function GlobalSearch({ index }: { index: SearchEntry[] }) {
  const [open, setOpen] = useState(false)
  const [raw, setRaw] = useState("")
  const [scope, setScope] = useState<Scope>("tudo")
  // O resultado do servidor + o termo que o produziu, num estado só. Ver o bloco de obras.
  const [fetched, setFetched] = useState<{ term: string; items: WorkSuggestion[] }>({
    term: "",
    items: [],
  })

  const role = useRole()
  const signedIn = useIsSignedIn()

  // ⌘K / Ctrl+K em qualquer lugar. Ignora quando o foco está num campo de texto: o app tem
  // busca ao vivo no /titles e caixas de comentário, e sequestrar o atalho lá seria hostil.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "k" || !(e.metaKey || e.ctrlKey)) return
      const el = document.activeElement
      const typing =
        el instanceof HTMLInputElement ||
        el instanceof HTMLTextAreaElement ||
        (el instanceof HTMLElement && el.isContentEditable)
      if (typing && !open) return
      e.preventDefault()
      setOpen((v) => !v)
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [open])

  // O prefixo digitado (`config:comix`) vence o chip — quem escreve foi mais específico.
  // `find` e não `for`+`return`: o React Compiler não preserva a memoização de um useMemo com
  // saída antecipada dentro de laço, e o lint reprova ("Compilation Skipped").
  const { term, activeScope } = useMemo(() => {
    const typed = SCOPES.find((s) => s.prefix != null && raw.toLowerCase().startsWith(s.prefix))
    return typed?.prefix
      ? { term: raw.slice(typed.prefix.length).trim(), activeScope: typed.k }
      : { term: raw.trim(), activeScope: scope }
  }, [raw, scope])

  const reaches = useCallback(
    (e: SearchEntry) => roleAtLeast(role, e.minRole) && (!e.requiresSession || signedIn),
    [role, signedIn],
  )

  const visible = useMemo(() => index.filter(reaches), [index, reaches])

  /**
   * Sem termo, NADA. O diálogo abria despejando o índice inteiro (~40 seções de Configurações,
   * Preferências e Páginas), e o efeito era o oposto do pretendido: uma parede de itens que a
   * pessoa não pediu, ordenada pelo registry, na frente do campo que ela veio usar. A lista
   * cheia também não é um menu utilizável — ninguém navega 40 linhas de teclado.
   *
   * ⚠️ Isto NÃO é o mesmo que filtrar por termo vazio: `visible` continua sendo a fonte dos
   * chips de escopo (que dependem do que o PAPEL alcança, não do que foi digitado).
   */
  const matches = useMemo(() => {
    if (!term) return EMPTY_ENTRIES
    const hay = (e: SearchEntry) => `${e.title} ${e.description} ${e.crumb ?? ""}`
    return visible.filter((e) => matchesTerm(hay(e), term))
  }, [visible, term])

  /**
   * Obras: só quando o escopo pede e há termo suficiente.
   *
   * O resultado é guardado JUNTO com o termo que o produziu, e `works`/`loadingWorks` são
   * DERIVADOS dessa comparação. Duas coisas saem de graça:
   *   - o efeito nunca chama setState de forma síncrona (o lint reprova: dispara renders em
   *     cascata) — só dentro do `.then`;
   *   - some o flash de resultado velho: enquanto a resposta do termo atual não chega, a lista
   *     de obras é vazia por construção, não por um `setWorks([])` que corre atrás.
   */
  const canSearchWorks =
    (activeScope === "tudo" || activeScope === "obra") && term.length >= MIN_WORK_QUERY && open
  const works = canSearchWorks && fetched.term === term ? fetched.items : EMPTY_WORKS
  const loadingWorks = canSearchWorks && fetched.term !== term

  // Um id de request descarta respostas fora de ordem — sem isso, uma busca lenta antiga
  // sobrescreve o resultado da nova.
  const reqId = useRef(0)
  useEffect(() => {
    if (!canSearchWorks || fetched.term === term) return
    const id = ++reqId.current
    const timer = setTimeout(() => {
      searchWorkSuggestions(term)
        .then((r) => {
          if (id === reqId.current) setFetched({ term, items: r })
        })
        .catch(() => {
          if (id === reqId.current) setFetched({ term, items: [] })
        })
    }, DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [term, canSearchWorks, fetched.term])

  const availableScopes = useMemo(
    () =>
      SCOPES.filter(
        (s) =>
          s.k === "tudo" ||
          s.k === "obra" ||
          visible.some((e) => e.kind === (s.k as SearchKind)),
      ),
    [visible],
  )

  const countOf = (k: Scope) => {
    if (k === "obra") return works.length
    if (k === "tudo") return works.length + matches.length
    return matches.filter((e) => e.kind === (k as SearchKind)).length
  }

  const cycleScope = () => {
    const ks = availableScopes.map((s) => s.k)
    setScope(ks[(ks.indexOf(activeScope) + 1) % ks.length] ?? "tudo")
  }

  const close = () => {
    setOpen(false)
    setRaw("")
    setScope("tudo")
  }

  const showWorks = activeScope === "tudo" || activeScope === "obra"
  /**
   * Em "Tudo", só as 4 primeiras obras.
   *
   * Medido: buscar "cor" trazia 8 obras (casadas por títulos alternativos — "corvini",
   * "correspondido") e empurrava "Cores das notas" para fora da vista. O catálogo tem ~980
   * obras contra ~40 seções, então sem teto a categoria maior sempre engole as outras — e a
   * busca deixa de servir para "achar o ajuste cujo nome não lembro", que é metade do motivo
   * dela existir. No escopo Obras aparecem todas.
   */
  const shownWorks = activeScope === "obra" ? works : works.slice(0, 4)
  const hiddenWorks = works.length - shownWorks.length
  const groups = (["config", "pref", "page"] as const).filter(
    (k) => activeScope === "tudo" || activeScope === k,
  )
  const nothing = works.length === 0 && matches.length === 0 && !loadingWorks

  return (
    <>
      {/* Elástica: cresce até 460px e é a PRIMEIRA a ceder quando a barra aperta — os
          destinos e os contadores não cedem nunca (ver a régua em top-nav.tsx). O
          placeholder longo só entra quando cabe inteiro; truncá-lo diria menos que o
          texto curto. Era `md:min-w-[168px]` fixo, o menor elemento da barra. */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="hidden h-9 w-full min-w-[190px] max-w-[460px] items-center gap-2 rounded-lg border border-border/70 bg-card/50 px-3 text-sm text-muted-foreground transition-colors hover:border-primary/45 hover:text-foreground md:flex"
      >
        <Search className="size-4 shrink-0" />
        <span className="truncate">
          <span className="hidden lg:inline">Buscar obras, ajustes e páginas</span>
          <span className="lg:hidden">Buscar…</span>
        </span>
        <kbd className="ml-auto hidden shrink-0 rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px] font-semibold lg:inline">
          ⌘K
        </kbd>
      </button>

      {/* Ícone só, no mobile — não há largura pro botão com rótulo. */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Buscar"
        className="grid size-9 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground md:hidden"
      >
        <Search className="size-[18px]" />
      </button>

      <CommandDialog
        open={open}
        onOpenChange={(v) => (v ? setOpen(true) : close())}
        title="Buscar"
        description="Busque obras, ajustes e páginas"
        /**
         * 🔴 Ancorado no TOPO, não centrado. O `DialogContent` padrão é
         * `top-1/2 -translate-y-1/2`, e num diálogo cuja ALTURA depende do resultado isso move
         * a borda de cima a cada tecla: o campo de busca — o único elemento que a pessoa está
         * olhando e usando — escorrega debaixo do cursor enquanto ela digita. Com o topo fixo,
         * só a borda de baixo acompanha o número de resultados.
         *
         * ⚠️ `translate-y-0` é obrigatório junto do `top-*`: sem ele o `-translate-y-1/2` do
         * padrão continua valendo e o diálogo sobe metade da própria altura — que volta a
         * depender do resultado, só que pra cima.
         *
         * ⚠️ 68px NÃO é número escolhido: é a altura da barra (`h-14` = 56) + 1px da borda de
         * baixo + 11px de respiro. Se a barra mudar de altura, o respiro muda junto e nada
         * avisa. Era `10vh`/`sm:14vh`, e o vh trabalhava contra no pior caso: quanto mais
         * baixa a janela, mais a lista quer espaço e mais o topo descia junto dela (medido a
         * 650px de altura: 91px de topo e só 81px de folga no rodapé, contra 104px hoje).
         */
        className="top-[68px] translate-y-0"
        // `shouldFilter={false}`: quem filtra somos nós (o casamento inclui descrição e
        // migalha, e as obras vêm já filtradas do servidor). Com o filtro do cmdk ligado,
        // ele re-filtraria por cima e sumiria com acertos legítimos de descrição.
        shouldFilter={false}
      >
        <CommandInput
          placeholder="Buscar obras, ajustes, páginas…"
          value={raw}
          onValueChange={setRaw}
          onKeyDown={(e) => {
            if (e.key === "Tab") {
              e.preventDefault()
              cycleScope()
            }
          }}
        />

        <div className="flex flex-wrap items-center gap-1.5 border-b px-3 pb-2.5">
          {availableScopes.map((s) => {
            const on = s.k === activeScope
            const n = term ? countOf(s.k) : null
            return (
              <button
                key={s.k}
                type="button"
                onClick={() => setScope(s.k)}
                aria-pressed={on}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11.5px] font-semibold transition-colors",
                  on
                    ? "border-primary/45 bg-primary/15 text-primary"
                    : "border-border text-muted-foreground hover:text-foreground",
                )}
              >
                {s.label}
                {n != null && <span className="font-mono text-[10px] opacity-80">{n}</span>}
              </button>
            )
          })}
          <span className="ml-auto hidden items-center gap-1.5 text-[10.5px] text-muted-foreground/80 sm:flex">
            <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px]">
              tab
            </kbd>
            cicla
          </span>
        </div>

        {/* O padrão do shadcn é `max-h-[300px]`, pensado pra uma lista de comandos. Aqui há
            até quatro categorias empilhadas, e com 300px a busca cortava em "mais N obras" —
            Configurações e Preferências ficavam abaixo da dobra, que é justamente o que esta
            busca existe pra achar. Medido na tela, buscando "cor". */}
        <CommandList className="max-h-[min(60vh,460px)]">
          {nothing && (
            <CommandEmpty>
              {term
                ? `Nada para "${term}" neste escopo.`
                : "Comece a digitar para buscar."}
            </CommandEmpty>
          )}

          {showWorks && works.length > 0 && (
            <CommandGroup heading="Obras">
              {shownWorks.map((w) => (
                <CommandItem key={w.id} value={`work-${w.id}`} asChild className="cursor-pointer">
                  {/* Âncora de verdade, não handler: o cmdk espalha as props do usuário ANTES
                      de definir o `onClick` dele, então um onClick aqui nunca roda — o clique
                      vira no-op sem erro. Com <a>, ainda ganhamos ctrl+clique e URL no hover. */}
                  <a href={`/titles/${w.slug}`} onClick={close}>
                    <span className="grid size-8 shrink-0 place-items-center overflow-hidden rounded bg-muted text-[9px] text-muted-foreground">
                      {w.coverUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element -- capa externa, sem images config
                        <img src={w.coverUrl} alt="" className="size-full object-cover" />
                      ) : (
                        "—"
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13.5px] font-semibold">{w.title}</span>
                      <span className="block truncate text-[11.5px] text-muted-foreground">
                        {w.matchedAlias
                          ? `também conhecida como ${w.matchedAlias}`
                          : [w.year, w.publicationStatus].filter(Boolean).join(" · ") || "—"}
                      </span>
                    </span>
                    {w.isAdult && (
                      <span className="shrink-0 rounded-full bg-rose-500/15 px-2 py-0.5 text-[10px] font-bold text-rose-600 dark:text-rose-400">
                        18+
                      </span>
                    )}
                  </a>
                </CommandItem>
              ))}
              {hiddenWorks > 0 && (
                <CommandItem value="more-works" asChild className="cursor-pointer">
                  <button type="button" onClick={() => setScope("obra")}>
                    <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground [&_svg]:size-4">
                      <Search />
                    </span>
                    <span className="text-[13px] text-muted-foreground">
                      mais {hiddenWorks} {hiddenWorks === 1 ? "obra" : "obras"} — ver só obras
                    </span>
                  </button>
                </CommandItem>
              )}
            </CommandGroup>
          )}

          {groups.map((kind) => {
            const items = matches.filter((e) => e.kind === kind)
            if (items.length === 0) return null
            return (
              <CommandGroup key={kind} heading={KIND_LABEL[kind]}>
                {items.map((e) => {
                  const Icon = ICONS[e.iconName] ?? Settings
                  return (
                    <CommandItem key={e.id} value={e.id} asChild className="cursor-pointer">
                      <a href={e.href} onClick={close}>
                        <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground [&_svg]:size-4">
                          <Icon />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13.5px] font-semibold">
                            {e.crumb && (
                              <span className="font-medium text-muted-foreground">
                                {e.crumb} ›{" "}
                              </span>
                            )}
                            {e.title}
                          </span>
                          <span className="block truncate text-[11.5px] text-muted-foreground">
                            {e.description}
                          </span>
                        </span>
                      </a>
                    </CommandItem>
                  )
                })}
              </CommandGroup>
            )
          })}
        </CommandList>
      </CommandDialog>
    </>
  )
}
