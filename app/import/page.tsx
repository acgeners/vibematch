import { Header } from "@/components/layout/header"
import { ImportWizard } from "@/components/import/import-wizard"

export default function ImportPage() {
  return (
    <div className="max-w-3xl space-y-6">
      <Header
        title="Importar obras"
        description="Importe obras a partir de arquivos CSV ou XLSX"
      />
      <ImportWizard />
    </div>
  )
}
