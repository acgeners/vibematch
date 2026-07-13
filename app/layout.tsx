import type { Metadata } from "next"
import { cookies } from "next/headers"
import { Geist, Geist_Mono } from "next/font/google"
import "./globals.css"
import { SIDEBAR_COLLAPSED_COOKIE } from "@/lib/sidebar-preference"
import { Sidebar } from "@/components/layout/sidebar"
import { MobileNav } from "@/components/layout/mobile-nav"
import { AppShell } from "@/components/layout/app-shell"
import { AdminProvider } from "@/components/layout/admin-context"
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

export const metadata: Metadata = {
  title: "SatorIA",
  description: "Seu catálogo de manhwas com uma IA que aprende o seu gosto e prevê o que você vai amar ler.",
}

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  // A sidebar sai do servidor JÁ no estado colapsado/expandido do usuário. Ler isto
  // aqui torna as rotas dinâmicas — custo real, mas as 7 que ainda eram estáticas
  // (/login, /signup, redirects) não fazem trabalho de banco. Em troca, some o
  // mismatch de hidratação e o pulo visual. Ver lib/sidebar-preference.ts.
  const collapsed = (await cookies()).get(SIDEBAR_COLLAPSED_COOKIE)?.value === "1"

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
              <AppShell
                sidebar={<Sidebar defaultCollapsed={collapsed} />}
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
            </AdminProvider>
            <Toaster />
          </CostConfirmProvider>
        </ThemeProvider>
      </body>
    </html>
  )
}
