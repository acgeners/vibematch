import type { Metadata } from "next"
import { Geist, Geist_Mono } from "next/font/google"
import "./globals.css"
import { TopNav } from "@/components/layout/top-nav"
import { MobileNav } from "@/components/layout/mobile-nav"
import { AppShell } from "@/components/layout/app-shell"
import { AdminProvider } from "@/components/layout/admin-context"
import { ChromeBadgesProvider } from "@/components/layout/chrome-badges"
import { buildSearchIndex } from "@/server/queries/search-index"
import { Toaster } from "@/components/ui/sonner"
import { ThemeProvider } from "@/components/theme-provider"
import { ActiveChatFab } from "@/components/recommendations/active-chat-fab"
import { TasksFab } from "@/components/tasks/tasks-fab"
import { CostConfirmProvider } from "@/components/cost/cost-confirm"

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
})

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
})

/**
 * 🔴 NÃO REMOVA sem ler isto — e sem substituir por outra garantia.
 *
 * Este app é inteiramente per-user: quase toda página serve dado de QUEM OLHA (estado de
 * leitura, Nota Prevista, favoritos, filas). Uma rota prerenderizada congela no HTML do build
 * o que era verdade para quem (ou ninguém) estava logado naquele instante, e passa a servir
 * isso para todo mundo — sem erro, sem log, com a página renderizando normalmente. É a mesma
 * classe de falha do "anônimo vira dono" (ver `getScoresReader`), por outro mecanismo.
 *
 * Até 2026-08-02 essa garantia existia por ACIDENTE: o layout lia `cookies()` para saber se a
 * sidebar estava recolhida, e isso bastava para marcar todas as rotas como dinâmicas. Quando a
 * sidebar virou barra superior, o `cookies()` saiu junto — e a rede caiu sem que nada
 * apontasse para ela. Esta linha existe para que a garantia pare de depender de um efeito
 * colateral que qualquer refatoração inocente derruba.
 *
 * O preço: as institucionais (`/sobre`, `/guia`, `/login`, `/signup`) perdem prerender. Para
 * liberar essas, o caminho é MEDIR — rodar `next build`, ler a tabela `ƒ`/`○` e marcar rota a
 * rota — nunca simplesmente apagar esta linha.
 */
export const dynamic = "force-dynamic"

export const metadata: Metadata = {
  title: "SatorIA",
  description: "Curadoria pessoal movida por IA: a SatorIA aprende o seu gosto e recomenda os próximos mangás e manhwas à altura dele.",
}

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  // Índice da busca global: dado estático dos registries (páginas + as seções de
  // Configurações e Preferências). Montado aqui e embarcado no HTML, então buscar um ajuste
  // responde na tecla — só obra vai ao servidor. Ver server/queries/search-index.ts.
  const searchIndex = buildSearchIndex()

  return (
    <html
      lang="pt-BR"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="h-dvh overflow-hidden flex bg-background text-foreground">
        <ThemeProvider>
          <CostConfirmProvider>
            <AdminProvider>
              {/* Acima do shell: a barra superior e a sidebar da console leem os
                  mesmos contadores, e um fetch por consumidor duplicaria a leitura
                  mais cara do chrome. Ver components/layout/chrome-badges.tsx. */}
              <ChromeBadgesProvider>
                <AppShell
                  topNav={<TopNav searchIndex={searchIndex} />}
                  overlays={
                    <>
                      <MobileNav />
                      <ActiveChatFab />
                      <TasksFab />
                    </>
                  }
                >
                  {children}
                </AppShell>
              </ChromeBadgesProvider>
            </AdminProvider>
            <Toaster />
          </CostConfirmProvider>
        </ThemeProvider>
      </body>
    </html>
  )
}
