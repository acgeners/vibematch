import type { Metadata } from "next"
import { Geist, Geist_Mono } from "next/font/google"
import "./globals.css"
import { Sidebar } from "@/components/layout/sidebar"
import { MobileNav } from "@/components/layout/mobile-nav"
import { Toaster } from "@/components/ui/sonner"
import { ThemeProvider } from "@/components/theme-provider"
import { ActiveChatFab } from "@/components/recommendations/active-chat-fab"
import { TasksFab } from "@/components/tasks/tasks-fab"

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

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="pt-BR"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="h-dvh overflow-hidden flex bg-background text-foreground">
        <ThemeProvider>
          <Sidebar />
          <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
            <main className="relative z-10 min-h-0 flex-1 overflow-y-auto scroll-smooth px-4 py-5 pb-24 md:px-7 md:py-7 md:pb-7">
              {children}
            </main>
          </div>
          <MobileNav />
          <ActiveChatFab />
          <TasksFab />
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  )
}
