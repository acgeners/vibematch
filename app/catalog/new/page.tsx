import { Header } from "@/components/layout/header"
import { WorkForm } from "@/components/titles/work-form"
import { PendingBatchBanner } from "@/components/titles/pending-batch-banner"
import { getPendingBatchCount } from "@/server/actions/works"
import { getAiEvalOnCreate } from "@/server/queries/current-user"
import type { WorkFormValues } from "@/lib/validations/work.schema"

interface NewTitlePageProps {
  searchParams: Promise<{
    title?: string
  }>
}

export const metadata = { title: "Nova obra" }

export default async function NewTitlePage({ searchParams }: NewTitlePageProps) {
  const params = await searchParams
  const [pendingBatchCount, aiEvalOnCreate] = await Promise.all([
    getPendingBatchCount(),
    getAiEvalOnCreate(),
  ])
  const title = params.title?.trim().slice(0, 500)
  const initialValues: Partial<WorkFormValues> | undefined = title ? { title } : undefined

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6">
      <Header
        kicker="Catálogo"
        title="Adicionar nova obra"
        description="Preencha os dados ou use a busca automática"
      />
      <PendingBatchBanner initialCount={pendingBatchCount} />
      <WorkForm initialValues={initialValues} aiEvalOnCreate={aiEvalOnCreate} />
    </div>
  )
}
