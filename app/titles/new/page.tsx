import { Header } from "@/components/layout/header"
import { WorkForm } from "@/components/titles/work-form"
import { PendingBatchBanner } from "@/components/titles/pending-batch-banner"
import { getPendingBatchCount } from "@/server/actions/works"
import type { WorkFormValues } from "@/lib/validations/work.schema"

interface NewTitlePageProps {
  searchParams: Promise<{
    title?: string
  }>
}

export default async function NewTitlePage({ searchParams }: NewTitlePageProps) {
  const params = await searchParams
  const pendingBatchCount = await getPendingBatchCount()
  const title = params.title?.trim().slice(0, 500)
  const initialValues: Partial<WorkFormValues> | undefined = title ? { title } : undefined

  return (
    <div className="w-full max-w-6xl space-y-6">
      <Header
        kicker="Catálogo"
        title="Adicionar nova obra"
        description="Preencha os dados ou use a busca automática"
      />
      <PendingBatchBanner initialCount={pendingBatchCount} />
      <WorkForm initialValues={initialValues} />
    </div>
  )
}
