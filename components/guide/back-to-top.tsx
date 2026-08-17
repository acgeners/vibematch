"use client"

import { useEffect, useState } from "react"
import { ArrowUp } from "lucide-react"

/**
 * Botão flutuante que devolve a pessoa ao topo — onde mora o índice do dicionário.
 *
 * Existe porque o índice **deixou de grudar**: sem ele no topo da tela, um documento de nove
 * verbetes longos não tem como pular de um atributo para outro sem rolar tudo de volta. É a
 * troca deliberada — 288px de barra permanente (561px no celular) por um alvo de 40px que só
 * aparece quando você já se afastou.
 *
 * 🔴 **Quem rola NÃO é o documento.** O `AppShell` põe `overflow: hidden` no body e o scroll
 * vive num div interno: escutar `window` deixa o botão mudo e `window.scrollY` preso em 0.
 * Isso já custou caro no scroll-spy desta mesma página — o índice marcava o último verbete em
 * qualquer posição, porque a leitura de scroll nunca mudava.
 */
export function BackToTop({ label = "Voltar ao topo" }: { label?: string }) {
  const [visivel, setVisivel] = useState(false)
  const [scroller, setScroller] = useState<HTMLElement | null>(null)

  useEffect(() => {
    function acharScroller(): HTMLElement | null {
      // Do main para cima: o primeiro ancestral que de fato rola.
      let atual: HTMLElement | null = document.querySelector("main")
      while (atual) {
        const estilo = getComputedStyle(atual)
        if (/(auto|scroll)/.test(estilo.overflowY) && atual.scrollHeight > atual.clientHeight + 4) {
          return atual
        }
        atual = atual.parentElement
      }
      return null
    }

    const alvo = acharScroller()
    setScroller(alvo)

    // Uma tela inteira: antes disso o índice ainda está perto, e o botão seria ruído.
    const gatilho = () => (alvo ? alvo.clientHeight : window.innerHeight)

    let agendado = false
    function aoRolar() {
      if (agendado) return
      agendado = true
      requestAnimationFrame(() => {
        const posicao = alvo ? alvo.scrollTop : window.scrollY
        setVisivel(posicao > gatilho())
        agendado = false
      })
    }

    aoRolar()
    const fonte: HTMLElement | Window = alvo ?? window
    fonte.addEventListener("scroll", aoRolar, { passive: true })
    return () => fonte.removeEventListener("scroll", aoRolar)
  }, [])

  function subir(evento: React.MouseEvent<HTMLButtonElement>) {
    // 🔴 Tirar o foco ANTES de rolar. O botão se esconde no meio do caminho (quando a
    // posição cai abaixo de uma tela), e esconder o elemento FOCADO faz o navegador
    // devolver o foco ao body — o que CANCELA a rolagem suave em curso. Medido: a
    // animação parava em 869px de 3000 e a pessoa ficava no meio do documento, com o
    // botão já sumido. Com o blur antes, ela vai até o fim.
    evento.currentTarget.blur()
    const comportamento: ScrollBehavior = window.matchMedia("(prefers-reduced-motion: reduce)").matches
      ? "auto"
      : "smooth"
    if (scroller) scroller.scrollTo({ top: 0, behavior: comportamento })
    else window.scrollTo({ top: 0, behavior: comportamento })
  }

  return (
    <button
      type="button"
      onClick={subir}
      aria-label={label}
      // `hidden` de verdade quando invisível: um botão fora da tela mas focável rouba o Tab
      // de quem navega por teclado, e some do fluxo sem avisar que existe.
      hidden={!visivel}
      className="fixed bottom-20 right-4 z-30 flex items-center gap-2 rounded-full border border-border bg-card/95 px-4 py-2.5 text-[13px] font-semibold shadow-lg backdrop-blur transition-colors hover:border-primary hover:text-primary sm:bottom-6 sm:right-6"
    >
      <ArrowUp className="size-4" />
      {label}
    </button>
  )
}
