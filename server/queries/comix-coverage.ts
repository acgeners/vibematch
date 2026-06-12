import "server-only"
import { createAdminClient } from "@/lib/supabase/admin"

export interface WorkMissingComix {
  id: string
  title: string
}

/**
 * Obras (ativas) SEM um hid da Comix ativo em work_external_ids — ou seja, sem
 * linha `source='comix'` com `is_rejected=false` e `external_id` preenchido.
 * Obras já rejeitadas pelo usuário (is_rejected=true) também aparecem, pra
 * permitir override manual. Usada na lista de preenchimento manual em /settings.
 */
export async function getWorksMissingComixHid(): Promise<WorkMissingComix[]> {
  const supabase = createAdminClient()
  const [worksRes, comixRes] = await Promise.all([
    supabase.from("works").select("id, title").eq("is_archived", false).order("title"),
    supabase.from("work_external_ids").select("work_id, external_id, is_rejected").eq("source", "comix"),
  ])
  if (worksRes.error) throw new Error(worksRes.error.message)
  if (comixRes.error) throw new Error(comixRes.error.message)

  const hasActiveComix = new Set(
    (comixRes.data ?? [])
      .filter((r) => r.is_rejected === false && r.external_id)
      .map((r) => r.work_id as string),
  )

  return (worksRes.data ?? [])
    .filter((w) => !hasActiveComix.has(w.id as string))
    .map((w) => ({ id: w.id as string, title: (w.title as string) ?? "" }))
}
