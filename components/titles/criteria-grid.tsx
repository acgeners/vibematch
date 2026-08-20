"use client"

import { useState } from "react"
import { cn } from "@/lib/utils"

/**
 * Os 9 critérios em GRADE COMPACTA: a lista mostra nome, nota e faixa; a justificativa de UM
 * critério abre por vez — ao lado (card largo) ou logo abaixo da linha (card estreito).
 *
 * 🔴 O bloco era 9 cards com a justificativa SEMPRE aberta, e por isso a altura dele era
 * refém de quanto o modelo escreveu. Medido no app em 2026-08-19, na obra mais completa:
 * **1.687px no desktop (63% da aba) e 4.244px no iPhone SE (70%, 6,4 telas de rolagem)**.
 * Ler os nove no telefone custava rolar quase sete telas.
 *
 * ⚠️ A propriedade que importa não é o corte médio, é o TETO: com uma justificativa aberta
 * por vez, a altura para de crescer com o texto. Medido no mockup sobre as obras real de p10,
 * mediana e p90 do catálogo (justificativa: mediana 274 caracteres, p90 551, máx 1.072), a
 * variante compacta vai de 507px para 516px entre a mediana e a p90 — 9px — enquanto a de
 * hoje vai de 1.336 para 1.841.
 *
 * ⚠️ **O rótulo da faixa ("Saudável", "Presente mas secundário") sai da LISTA** e passa a
 * viver só no painel aberto. A barra continua dizendo QUAL faixa; ela não a nomeia. É o preço
 * da densidade, escolhido com o trade-off à vista.
 */

export interface CriterioItem {
  slug: string
  /** Nome de exibição do critério. */
  nome: string
  /** Já formatada como a tela mostra ("7.5"), ou null quando não há nota. */
  notaTexto: string | null
  /** Índice da faixa na rubrica (0 = "0-3" … 3 = "9-10"); -1 quando não há nota. */
  faixaIndex: number
  /** "7-8" — só para leitor de tela; na linha quem diz a faixa é a barra. */
  faixaLabel: string | null
  /** Classe do pill da nota, calculada no servidor (tier vem do perfil de gosto). */
  pillClass: string
}

/**
 * ⚠️ O detalhe vem PRONTO do servidor (`ReactNode`), não como dado: ele carrega o chip de
 * faixa, os créditos de "Ajustada por você / pela auditoria" e a barra de encaixe, que
 * dependem de lógica e de componentes que já vivem lá. Reconstruir isso aqui seria uma
 * segunda régua para os mesmos fatos.
 */
export function CriteriaGrid({
  items,
  detalhes,
}: {
  items: CriterioItem[]
  detalhes: React.ReactNode[]
}) {
  const [aberto, setAberto] = useState<number>(0)

  return (
    /* ⚠️ `@container` e não breakpoint de viewport: quem decide se cabe painel é a largura do
       CARD, não a da janela. Medido no app: o card tem 868px na página da obra em 1500px de
       tela e ~343px no celular — `@2xl` (672px) separa os dois com folga. Escolher `lg:` daria
       painel lateral num card de 300px dentro de uma coluna estreita. */
    <div className="@container">
      <div className="grid gap-4 @2xl:grid-cols-[minmax(0,320px)_minmax(0,1fr)] @2xl:items-start">
        <ul className="flex flex-col">
          {items.map((c, i) => {
            const ativo = aberto === i
            return (
              <li key={c.slug} className="border-b border-border/40 last:border-b-0">
                <button
                  type="button"
                  onClick={() => setAberto(ativo ? -1 : i)}
                  aria-expanded={ativo}
                  aria-controls={`criterio-${c.slug}`}
                  className={cn(
                    "grid w-full grid-cols-[1fr_auto] items-center gap-x-2.5 gap-y-1 rounded-md px-2 py-2 text-left",
                    "transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    ativo && "bg-muted/40",
                  )}
                >
                  <span className="truncate text-sm font-medium text-foreground">{c.nome}</span>
                  <span
                    className={cn(
                      "grid h-6 min-w-[38px] shrink-0 place-items-center rounded px-1.5 font-mono text-sm font-bold leading-none",
                      c.notaTexto ? c.pillClass : "border border-dashed text-muted-foreground",
                    )}
                  >
                    {c.notaTexto ?? "—"}
                  </span>
                  <FaixaBarra index={c.faixaIndex} label={c.faixaLabel} />
                </button>

                {/* Card ESTREITO: o detalhe abre embaixo. Ele é renderizado nos dois lugares e
                    escondido por CSS de propósito — decidir por JS qual montar exigiria ler a
                    largura no primeiro render, que é a mesma classe de quebra de hidratação do
                    `localStorage` na sidebar. */}
                {ativo && (
                  <div id={`criterio-${c.slug}`} className="px-2 pb-3 @2xl:hidden">
                    {detalhes[i]}
                  </div>
                )}
              </li>
            )
          })}
        </ul>

        {/* Card LARGO: painel ao lado, grudado enquanto a lista rola. */}
        <div className="hidden @2xl:block @2xl:sticky @2xl:top-4">
          {aberto >= 0 && items[aberto] ? (
            <div className="rounded-lg border bg-muted/20 p-4">{detalhes[aberto]}</div>
          ) : (
            <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
              Escolha um critério para ler a justificativa.
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

/**
 * As quatro faixas da rubrica, com a da nota destacada.
 *
 * 🔴 Acromática de propósito. No app a COR de um chip já significa estado — âmbar é
 * "desatualizado", rosa é "falhou" (ver `STATUS_TONE`) —, e pintar uma rampa por faixa criaria
 * um segundo sentido para a mesma cor a dois centímetros dela. Aqui a posição diz a faixa e o
 * preenchimento diz até onde a nota chegou.
 */
function FaixaBarra({ index, label }: { index: number; label: string | null }) {
  return (
    <span className="col-span-2 grid grid-cols-4 gap-0.5" aria-hidden={label == null}>
      {[0, 1, 2, 3].map((k) => (
        <span
          key={k}
          className={cn(
            "h-1 rounded-sm",
            k === index ? "bg-foreground/70" : k < index ? "bg-foreground/25" : "bg-foreground/10",
          )}
        />
      ))}
      {label && <span className="sr-only">Faixa {label}</span>}
    </span>
  )
}
