import { Header } from "@/components/layout/header"
import { WorkForm } from "@/components/titles/work-form"
import { PendingBatchBanner } from "@/components/titles/pending-batch-banner"
import { getPendingBatchCount } from "@/server/actions/works"

export default async function NewTitlePage() {
  const pendingBatchCount = await getPendingBatchCount()

  return (
    <div className="w-full max-w-6xl space-y-6">
      <Header
        title="Adicionar nova obra"
        description="Preencha os dados ou use a busca automática"
      />
      <PendingBatchBanner initialCount={pendingBatchCount} />
      <WorkForm />
    </div>
  )
}
