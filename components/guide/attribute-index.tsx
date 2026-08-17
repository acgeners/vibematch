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
 */
export function AttributeIndex({ items }: { items: IndexItem[] }) {
  return (
    <nav
      aria-label="Ir para um atributo"
      className="grid grid-cols-2 gap-2 min-[660px]:grid-cols-10"
    >
      {items.map((item, i) => (
        <Link
          key={item.slug}
          href={`#${item.slug}`}
          className={cn(
            "flex flex-col items-center gap-2 rounded-xl bg-card px-2 pb-2.5 pt-3 text-muted-foreground",
            "ring-1 ring-border transition-colors hover:text-foreground hover:ring-primary/60",
            "min-[660px]:col-span-2",
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
            className="size-[52px] shrink-0 min-[660px]:size-[76px]"
          />
          <span className="text-center text-[12.5px] font-semibold leading-tight">{item.name}</span>
        </Link>
      ))}
    </nav>
  )
}
