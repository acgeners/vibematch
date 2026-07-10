import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"

/**
 * Callback do OAuth (Google). O Supabase redireciona pra cá com ?code=…;
 * trocamos o code por uma sessão (grava os cookies) e mandamos pra home.
 * O trigger handle_new_user (migration 137) já provisionou a linha free.
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get("code")
  const next = searchParams.get("next") ?? "/"

  if (code) {
    const supabase = await createClient()
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`)
    }
  }

  return NextResponse.redirect(`${origin}/login?error=oauth`)
}
