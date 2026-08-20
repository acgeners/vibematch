import Link from "next/link"
import { cn } from "@/lib/utils"

interface IndexItem {
  slug: string
  name: string
  icon: string
}

/**
 * O índice do dicionário: a grade de artes no topo da página, 5 em cima e 4 embaixo.
 *
 * 🔴 **Ele NÃO gruda, e isso foi decidido em uso** (2026-08-16). A versão anterior era
 * `sticky`, e o custo medido é alto demais: a barra fica em **288px no desktop** (29% de
 * uma tela de 1000px) e **561px no celular** (84% de um iPhone SE). Vista em movimento, ela
 * espreme o verbete contra a borda de baixo — a página vira índice com um pouco de conteúdo.
 *
 * O que substitui a navegação constante são duas coisas mais baratas: o **título de cada
 * verbete gruda** enquanto ele está em cena (~40px, e diz onde você está sem ocupar o topo)
 * e o botão **Voltar ao topo** traz de volta para cá. Ver `components/guide/back-to-top.tsx`.
 *
 * ⚠️ Sem `sticky` some também o scroll-spy: destacar o item ativo só faz sentido enquanto o
 * índice está na tela, e quando ele está na tela você está no topo, onde nenhum verbete está
 * sendo lido. Isso devolveu o componente ao servidor — sem `"use client"`, sem listener.
 *
 * ## Abaixo de 660px ele é uma TIRA que rola na horizontal (2026-08-19)
 *
 * 🔴 A grade de 2 colunas dava **5 linhas — 561px**, ou **84% de um iPhone SE** (375x667) e 66%
 * de um iPhone 14. Nada estava quebrado (zero overflow, a página rolava), mas quem abria o
 * dicionário no celular via uma parede de ícones antes de "Como ler a escala": o índice virava
 * a primeira tela inteira, e o conteúdo começava fora dela.
 *
 * A tira resolve com UMA linha. O preço é honesto e escolhido: nem todos os nove cabem de
 * relance, e os últimos exigem rolar de lado. Num índice isso é aceitável — ele existe pra
 * quem PROCURA um atributo específico, e a página inteira segue rolando na vertical.
 *
 * ⚠️ O sangramento (`-mx-4 px-4`) casa com o `px-4` do `AppShell` e não é enfeite: encostar
 * nas duas bordas é o que sinaliza que a tira continua além da tela. Com margem, ela parece
 * uma fileira cortada. Se o padding do shell mudar, este número muda junto.
 *
 * ⚠️ Acima de 660px NADA muda — a grade de 10 colunas, os 76px de arte e a linha de baixo
 * centrada continuam iguais. É media query, não redesenho.
 */
export function AttributeIndex({ items }: { items: IndexItem[] }) {
  return (
    <nav
      aria-label="Ir para um atributo"
      className={cn(
        // Tira rolável no celular; a grade de 10 colunas volta a partir de 660px.
        "-mx-4 flex snap-x snap-mandatory gap-2 overflow-x-auto px-4 pb-1",
        "min-[660px]:mx-0 min-[660px]:grid min-[660px]:grid-cols-10 min-[660px]:overflow-x-visible min-[660px]:px-0 min-[660px]:pb-0",
      )}
    >
      {items.map((item, i) => (
        <Link
          key={item.slug}
          href={`#${item.slug}`}
          className={cn(
            "flex flex-col items-center gap-2 rounded-xl bg-card px-2 pb-2.5 pt-3 text-muted-foreground",
            "ring-1 ring-border transition-colors hover:text-foreground hover:ring-primary/60",
            // Largura fixa e `shrink-0` só valem na tira: num flex sem eles os nove se
            // espremeriam na largura da tela em vez de rolar.
            "w-[96px] shrink-0 snap-start",
            "min-[660px]:w-auto min-[660px]:shrink min-[660px]:col-span-2",
            // 5 em cima e 4 embaixo, com a linha de baixo CENTRADA: numa grade de 10 colunas
            // com cards de 2, começar o 6º na coluna 2 deixa meia célula de folga de cada
            // lado. Alinhado à esquerda sobra um buraco no canto direito.
            i === 5 && "min-[660px]:col-start-2"
          )}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={item.icon}
            alt=""
            width={76}
            height={76}
            className="size-[56px] shrink-0 min-[660px]:size-[76px]"
          />
          {/* 🔴 A BARRA vira ponto de quebra. "Fantasia/Nobreza" é UMA palavra para o
              navegador (107px a 12,5px) e não quebra sozinha: na tira de 96px ela vazava 35px
              do card, sem corte, sem rolagem e sem erro — os três canais mudos de sempre. O
              `\u200B` depois da "/" dá a quebra no lugar CERTO ("Fantasia/" + "Nobreza");
              `break-words` quebraria no meio da palavra. Sai do DADO, não de uma lista de
              nomes: critério novo no Supabase entra já quebrando. */}
          <span className="text-center text-[11.5px] font-semibold leading-tight break-words min-[660px]:text-[12.5px]">
            {item.name.replace(/\//g, "/\u200B")}
          </span>
        </Link>
      ))}
    </nav>
  )
}
