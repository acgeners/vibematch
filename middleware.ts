import { updateSession } from "@/lib/supabase/middleware"
import type { NextRequest } from "next/server"

export async function middleware(request: NextRequest) {
  return await updateSession(request)
}

export const config = {
  matcher: [
    /*
     * Roda em todas as rotas EXCETO assets estáticos e imagens — refresh de
     * sessão em navegação/ações, não em bytes estáticos. Ajustar quando a
     * proteção de rota entrar (Fase 1b).
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
}
