"use client"

import { useEffect, useRef, useState } from "react"
import { cn } from "@/lib/utils"

interface IndexItem {
  slug: string
  name: string
  icon: string
}

/**
 * O índice do dicionário: grade de artes que gruda no topo ao rolar e marca o verbete que
 * está sendo lido.
 *
 * 🔴 Três decisões medidas no browser (2026-08-16), todas do tipo que só aparece na tela:
 *
 * 1. **Altura CONSTANTE, grudado ou não.** A primeira versão encolhia ao grudar para
 *    devolver espaço à leitura, e isso tira 45px da altura do documento — o deslocamento
 *    acontece DEPOIS que a rolagem termina, então a âncora acertava o alvo e o título
 *    terminava embaixo da barra (medido: verbete a 63px, barra até 111px).
 *
 * 2. **O recuo das âncoras é MEDIDO, não escrito à mão.** A grade tem 2 linhas acima de
 *    660px e 3 abaixo, então a altura varia (288px × 422px). Um número fixo erraria em
 *    metade das telas; o componente publica `--anchor-offset` a partir da altura real.
 *
 * 3. **A linha de leitura do spy sai da BORDA da barra**, não de uma fração da janela. Com
 *    a barra em 288px e a linha em 30% de 1000px, o alvo do clique parava a 304px e ainda
 *    não tinha cruzado — o índice marcava o verbete ANTERIOR ao que acabara de abrir.
 */
export function AttributeIndex({ items }: { items: IndexItem[] }) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const [ativo, setAtivo] = useState<string | null>(null)

  useEffect(() => {
    const wrap = wrapRef.current
    if (!wrap) return

    const alvos = items
      .map((i) => document.getElementById(i.slug))
      .filter((el): el is HTMLElement => el !== null)

    // 🔴 Quem rola NÃO é o documento: o `AppShell` põe `overflow: hidden` no body e o scroll
    // vive num div interno. Escutar `window` deixa o listener mudo e `window.scrollY` preso
    // em 0 — medido, o índice marcava o ÚLTIMO verbete em qualquer posição, porque a
    // condição de fim de página ficava permanentemente verdadeira. Um mockup solto nunca
    // reproduz isso, então a descoberta do scroller precisa ser feita aqui.
    function acharScroller(): HTMLElement | null {
      let atual = wrap?.parentElement ?? null
      while (atual) {
        const estilo = getComputedStyle(atual)
        if (/(auto|scroll)/.test(estilo.overflowY) && atual.scrollHeight > atual.clientHeight + 4) {
          return atual
        }
        atual = atual.parentElement
      }
      return null
    }

    let scroller = acharScroller()

    function noFim() {
      if (scroller) return scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 4
      return window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 4
    }

    function medir() {
      if (!wrap) return
      const estilo = getComputedStyle(wrap)
      const grudando = estilo.position === "sticky"
      // O recuo tem que contar a barra superior do app TAMBÉM: o scroller começa em y=0 e
      // o `<header>` gruda por cima dele. Ler o `top` computado em vez de somar 57 à mão
      // mantém as duas pontas ligadas — trocar a classe move o recuo junto.
      const topo = grudando ? parseFloat(estilo.top) || 0 : 0
      const altura = grudando ? topo + Math.round(wrap.getBoundingClientRect().height) + 16 : 24
      document.documentElement.style.setProperty("--anchor-offset", `${altura}px`)
      return grudando
    }

    function atualizar() {
      if (!wrap) return
      const grudando = medir()
      const piso = grudando ? Math.max(wrap.getBoundingClientRect().bottom, 0) : 0
      const linha = piso + 32

      let atual: HTMLElement | null = null
      for (const alvo of alvos) if (alvo.getBoundingClientRect().top <= linha) atual = alvo
      // O último verbete pode nunca cruzar a linha; no fim da rolagem ele é o ativo.
      if (noFim()) atual = alvos[alvos.length - 1] ?? null
      setAtivo(atual?.id ?? null)
    }

    let agendado = false
    const aoRolar = () => {
      if (agendado) return
      agendado = true
      requestAnimationFrame(() => {
        atualizar()
        agendado = false
      })
    }
    const aoRedimensionar = () => {
      // O scroller pode trocar quando o layout muda de breakpoint.
      scroller = acharScroller()
      aoRolar()
    }

    atualizar()
    const alvoDoEvento: HTMLElement | Window = scroller ?? window
    alvoDoEvento.addEventListener("scroll", aoRolar, { passive: true })
    window.addEventListener("resize", aoRedimensionar, { passive: true })
    return () => {
      alvoDoEvento.removeEventListener("scroll", aoRolar)
      window.removeEventListener("resize", aoRedimensionar)
      document.documentElement.style.removeProperty("--anchor-offset")
    }
  }, [items])

  return (
    <div
      ref={wrapRef}
      className={cn(
        "z-20 -mx-4 border-b border-transparent px-4 py-3 sm:-mx-6 sm:px-6",
        "bg-background/90 backdrop-blur",
        // Abaixo de 660px a grade quebra em 3 linhas e grudar comeria um terço da tela.
        // `top-[57px]` é a barra superior: `h-14` (56px) + 1px de borda. Em `top-0` os dois
        // grudam no mesmo lugar e o header vence por z-index — o índice fica cortado pela
        // metade, que é como isto apareceu na primeira medição no app.
        "min-[660px]:sticky min-[660px]:top-[57px]",
        ativo && "min-[660px]:border-border"
      )}
    >
      <nav
        aria-label="Ir para um atributo"
        className="grid grid-cols-2 gap-2 min-[660px]:grid-cols-10"
      >
        {items.map((item, i) => (
          <a
            key={item.slug}
            href={`#${item.slug}`}
            aria-current={ativo === item.slug ? "true" : undefined}
            className={cn(
              "flex flex-col items-center gap-2 rounded-xl px-2 pb-2.5 pt-3 ring-1 transition-colors",
              "min-[660px]:col-span-2",
              // 5 em cima e 4 embaixo, com a linha de baixo CENTRADA: numa grade de 10
              // colunas com cards de 2, começar o 6º na coluna 2 deixa meia célula de
              // folga de cada lado. Alinhado à esquerda sobra um buraco no canto direito.
              i === 5 && "min-[660px]:col-start-2",
              ativo === item.slug
                ? "bg-primary/10 text-foreground ring-primary/45"
                : "bg-card text-muted-foreground ring-border hover:ring-primary/60"
            )}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={item.icon}
              alt=""
              width={76}
              height={76}
              className="size-[52px] shrink-0 min-[660px]:size-[76px]"
            />
            <span className="text-center text-[12.5px] font-semibold leading-tight">
              {item.name}
            </span>
          </a>
        ))}
      </nav>
    </div>
  )
}
