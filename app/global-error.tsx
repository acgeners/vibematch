"use client"

import { ERROR_COPY } from "@/lib/errors/copy"

/**
 * Boundary do ROOT LAYOUT — a única rede que `app/error.tsx` não pode ser.
 *
 * 🔴 `error.tsx` envolve a PÁGINA do segmento, não o layout dele: se `app/layout.tsx`
 * estourar (providers, tema, índice da busca, shell), não há boundary de segmento acima para
 * pegá-lo. Este arquivo é o que sobra, e por isso ele SUBSTITUI o root layout — daí precisar
 * de `<html>` e `<body>` próprios.
 *
 * ⚠️ Estilo INLINE, e isto é consequência do parágrafo acima, não preguiça: quando este
 * componente renderiza, o root layout falhou, então nada que dependa dele é garantido —
 * nem `globals.css`, nem o `ThemeProvider`, nem os tokens, nem `Button`. Uma tela de erro
 * que depende do que acabou de quebrar é uma tela de erro que quebra junto.
 *
 * ⚠️ Os valores são os TOKENS do tema escuro do projeto (`app/globals.css`), escritos em
 * hsl() literal porque a variável CSS pode não existir aqui. O app é `defaultTheme="dark"`
 * e não tem seletor de tema, então comprometer-se com o escuro é o que faz esta tela parecer
 * o SatorIA em vez de uma página órfã. Se os tokens mudarem, esta cópia envelhece — é o
 * preço aceito por não depender do CSS, e está escrito para quem vier depois.
 */
export default function GlobalError({
  error,
}: {
  error: Error & { digest?: string }
}) {
  // Mesma decisão do `app/error.tsx`, pelo mesmo motivo medido: RELOAD de documento. Aqui o
  // argumento é ainda mais forte — quem falhou foi o root layout, então o router do App
  // Router faz parte do que pode ter caído, e recuperar por ele seria contar com a peça
  // quebrada. Só no clique: sem timer, sem tentativa automática.
  const tentarNovamente = () => window.location.reload()

  return (
    <html lang="pt-BR">
      <body
        style={{
          margin: 0,
          minHeight: "100dvh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "24px",
          background: "hsl(218 25% 7%)",
          color: "hsl(39 30% 93%)",
          colorScheme: "dark",
          fontFamily:
            "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
        }}
      >
        <main style={{ maxWidth: "32rem", textAlign: "center" }}>
          <p
            style={{
              margin: "0 0 12px",
              fontSize: "12px",
              fontWeight: 700,
              letterSpacing: "0.16em",
              textTransform: "uppercase",
              color: "hsl(200 98% 72%)",
            }}
          >
            SatorIA
          </p>
          <h1 style={{ margin: "0 0 12px", fontSize: "22px", lineHeight: 1.25, fontWeight: 700 }}>
            {ERROR_COPY.titulo}
          </h1>
          <p style={{ margin: "0 0 24px", fontSize: "15px", lineHeight: 1.5, color: "hsl(219 11% 66%)" }}>
            {ERROR_COPY.descricao}
          </p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", justifyContent: "center" }}>
            <button
              type="button"
              onClick={tentarNovamente}
              style={{
                cursor: "pointer",
                borderRadius: "8px",
                border: "1px solid transparent",
                padding: "9px 16px",
                fontSize: "14px",
                fontWeight: 600,
                background: "hsl(200 98% 72%)",
                color: "hsl(224 28% 10%)",
              }}
            >
              {ERROR_COPY.tentarNovamente}
            </button>
            {/* `<a>` e não `<Link>`: o router do App Router faz parte do que pode ter caído
                junto com o root layout. Navegação de documento sempre funciona. */}
            <a
              href="/"
              style={{
                display: "inline-block",
                borderRadius: "8px",
                border: "1px solid hsl(219 16% 23%)",
                padding: "9px 16px",
                fontSize: "14px",
                fontWeight: 600,
                color: "hsl(39 30% 93%)",
                textDecoration: "none",
              }}
            >
              {ERROR_COPY.inicio}
            </a>
          </div>
          {error.digest ? (
            <p style={{ margin: "20px 0 0", fontSize: "11px", color: "hsl(219 11% 66%)", opacity: 0.7 }}>
              {ERROR_COPY.referencia} {error.digest}
            </p>
          ) : null}
        </main>
      </body>
    </html>
  )
}
