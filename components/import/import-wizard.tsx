"use client"

import { useState, useCallback, useRef, type DragEvent } from "react"
import { Upload, FileText, ChevronRight, ChevronLeft, Check, AlertCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Progress } from "@/components/ui/progress"
import { Badge } from "@/components/ui/badge"
import { startImport } from "@/server/actions/imports"
import type { ImportColumnMapping, RawImportRow } from "@/types/domain"
import type { ParsedFile, ParsedSheet } from "@/lib/import/parser"

type DuplicateMode = "skip" | "update" | "create_new"

const DUPLICATE_MODE_LABELS: Record<DuplicateMode, string> = {
  skip: "Ignorar duplicatas",
  update: "Atualizar duplicatas",
  create_new: "Criar nova entrada",
}

const TARGET_FIELDS = [
  "ignore",
  "title",
  "romance",
  "couple_dynamics",
  "fantasy_nobility",
  "action_adventure",
  "adult_content",
  "protagonist",
  "humor",
  "drama",
  "tragedy",
  "mu_rating",
  "mu_votes",
  "ap_rating",
  "ap_votes",
  "cmx_rating",
  "cmx_votes",
  "publication_status",
  "total_chapters",
  "chapters_read",
  "synopsis_quality",
  "personal_status",
  "observation_adjustment",
  "user_score",
  "ia_eval",
  "ia_eval_normalized",
  "calc_score",
  "predicted_score",
  "final_score",
] as const

const STEP_LABELS = [
  "Upload",
  "Aba",
  "Preview",
  "Mapeamento",
  "Opções",
  "Importar",
  "Resultado",
]

export function ImportWizard() {
  const [step, setStep] = useState(0)
  const [file, setFile] = useState<File | null>(null)
  const [parsedFile, setParsedFile] = useState<ParsedFile | null>(null)
  const [selectedSheet, setSelectedSheet] = useState<ParsedSheet | null>(null)
  const [mappings, setMappings] = useState<ImportColumnMapping[]>([])
  const [duplicateMode, setDuplicateMode] = useState<DuplicateMode>("update")
  const [importing, setImporting] = useState(false)
  const [progress, setProgress] = useState(0)
  const [isDragOver, setIsDragOver] = useState(false)
  const [importResult, setImportResult] = useState<{
    importedCount: number
    updatedCount: number
    skippedCount: number
    errorCount: number
    errors: Array<{ rowIndex: number; field: string; message: string }>
  } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const setupMappings = useCallback(async (sheet: ParsedSheet) => {
    try {
      const { detectColumnMappings } = await import("@/lib/import/mapper")
      const detected: ImportColumnMapping[] = detectColumnMappings(sheet.columns)
      setMappings(detected)
    } catch {
      // Fallback: map all to ignore
      const detected: ImportColumnMapping[] = sheet.columns.map((col) => ({
        sourceColumn: col,
        targetField: "ignore" as ImportColumnMapping["targetField"],
      }))
      setMappings(detected)
    }
  }, [])

  const processFile = useCallback(
    async (f: File) => {
      setFile(f)
      setError(null)

      try {
        const { parseFile } = await import("@/lib/import/parser")
        const parsed = await parseFile(f)

        setParsedFile(parsed)

        if (parsed.sheets.length === 1) {
          setSelectedSheet(parsed.sheets[0])
          await setupMappings(parsed.sheets[0])
          setStep(2)
        } else {
          setStep(1)
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Erro ao ler arquivo")
      }
    },
    [setupMappings]
  )

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (f) processFile(f)
  }

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setIsDragOver(false)
    const f = e.dataTransfer.files[0]
    if (f) processFile(f)
  }

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setIsDragOver(true)
  }

  const handleDragLeave = () => setIsDragOver(false)

  const handleSheetSelect = async (sheetName: string) => {
    const sheet = parsedFile?.sheets.find((s) => s.name === sheetName)
    if (!sheet) return
    setSelectedSheet(sheet)
    await setupMappings(sheet)
    setStep(2)
  }

  const updateMapping = (index: number, targetField: string) => {
    setMappings((prev) =>
      prev.map((m, i) =>
        i === index
          ? { ...m, targetField: targetField as ImportColumnMapping["targetField"] }
          : m
      )
    )
  }

  const handleImport = async () => {
    if (!file || !selectedSheet) return

    setImporting(true)
    setProgress(10)

    try {
      setProgress(40)
      const result = await startImport({
        filename: file.name,
        fileType: file.name.toLowerCase().endsWith(".csv") ? "csv" : "xlsx",
        sheetName: selectedSheet.name,
        rows: selectedSheet.rows as RawImportRow[],
        columns: selectedSheet.columns,
        mappings,
        duplicateMode,
      })

      setProgress(100)

      if (result.error) {
        setError(result.error)
      } else {
        setImportResult(result.data ?? null)
        setStep(6)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro na importação")
    } finally {
      setImporting(false)
    }
  }

  const reset = () => {
    setStep(0)
    setFile(null)
    setParsedFile(null)
    setSelectedSheet(null)
    setMappings([])
    setDuplicateMode("update")
    setImportResult(null)
    setError(null)
    setProgress(0)
    if (fileInputRef.current) fileInputRef.current.value = ""
  }

  const previewRows = selectedSheet?.rows.slice(0, 20) ?? []

  return (
    <div className="space-y-6">
      {/* Step indicators */}
      <div className="flex items-center gap-1 overflow-x-auto pb-2">
        {STEP_LABELS.map((label, i) => (
          <div key={i} className="flex items-center gap-1 shrink-0">
            <div
              className={`flex items-center justify-center w-7 h-7 rounded-full text-xs font-medium ${
                i < step
                  ? "bg-primary text-primary-foreground"
                  : i === step
                  ? "bg-primary/20 text-primary border border-primary"
                  : "bg-muted text-muted-foreground"
              }`}
            >
              {i < step ? <Check className="h-3.5 w-3.5" /> : i + 1}
            </div>
            <span
              className={`text-xs hidden sm:block ${
                i === step ? "text-foreground font-medium" : "text-muted-foreground"
              }`}
            >
              {label}
            </span>
            {i < STEP_LABELS.length - 1 && (
              <ChevronRight className="h-3 w-3 text-muted-foreground mx-1" />
            )}
          </div>
        ))}
      </div>

      {error && (
        <div className="flex items-start gap-2 p-3 rounded-md bg-destructive/10 text-destructive text-sm">
          <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
          {error}
        </div>
      )}

      {/* Step 0: Upload */}
      {step === 0 && (
        <div>
          <div
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onClick={() => fileInputRef.current?.click()}
            className={`border-2 border-dashed rounded-lg p-12 text-center cursor-pointer transition-colors ${
              isDragOver
                ? "border-primary bg-primary/5"
                : "border-muted-foreground/25 hover:border-primary/50"
            }`}
          >
            <Upload className="h-10 w-10 mx-auto text-muted-foreground mb-4" />
            <p className="text-sm font-medium">
              {isDragOver ? "Solte o arquivo aqui" : "Arraste e solte ou clique para selecionar"}
            </p>
            <p className="text-xs text-muted-foreground mt-1">Aceita arquivos .csv e .xlsx</p>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,.xlsx"
            onChange={handleFileInputChange}
            className="hidden"
          />
        </div>
      )}

      {/* Step 1: Sheet selector (XLSX com múltiplas abas) */}
      {step === 1 && parsedFile && (
        <div className="space-y-4">
          <h3 className="font-medium">Selecione a aba do arquivo</h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {parsedFile.sheets.map((sheet) => (
              <button
                key={sheet.name}
                onClick={() => handleSheetSelect(sheet.name)}
                className="p-4 border rounded-lg hover:bg-muted/50 text-left transition-colors"
              >
                <FileText className="h-5 w-5 mb-2 text-muted-foreground" />
                <p className="font-medium text-sm">{sheet.name}</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {sheet.rows.length} linhas, {sheet.columns.length} colunas
                </p>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Step 2: Preview */}
      {step === 2 && selectedSheet && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-medium">
              Preview: {selectedSheet.name} ({selectedSheet.rows.length} linhas)
            </h3>
            <Badge variant="outline">{selectedSheet.columns.length} colunas</Badge>
          </div>
          <div className="overflow-auto max-h-80 rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  {selectedSheet.columns.map((col) => (
                    <TableHead key={col} className="whitespace-nowrap text-xs">
                      {col}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {previewRows.map((row, i) => (
                  <TableRow key={i}>
                    {selectedSheet.columns.map((col) => (
                      <TableCell key={col} className="text-xs whitespace-nowrap">
                        {String(row[col] ?? "—")}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <div className="flex justify-between">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setStep(parsedFile && parsedFile.sheets.length > 1 ? 1 : 0)}
            >
              <ChevronLeft className="h-4 w-4 mr-1" />
              Voltar
            </Button>
            <Button size="sm" onClick={() => setStep(3)}>
              Próximo
              <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          </div>
        </div>
      )}

      {/* Step 3: Mapeamento */}
      {step === 3 && selectedSheet && (
        <div className="space-y-4">
          <div>
            <h3 className="font-medium">Mapeamento de colunas</h3>
            <p className="text-sm text-muted-foreground mt-1">
              Verifique e ajuste o mapeamento automático das colunas
            </p>
          </div>
          <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
            {mappings.map((mapping, i) => (
              <div key={i} className="flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{mapping.sourceColumn}</p>
                </div>
                <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                <div className="flex-1 min-w-0">
                  <Select
                    value={mapping.targetField}
                    onValueChange={(v) => updateMapping(i, v)}
                  >
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {TARGET_FIELDS.map((f) => (
                        <SelectItem key={f} value={f} className="text-xs">
                          {f === "ignore" ? "— Ignorar —" : f}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            ))}
          </div>
          <div className="flex justify-between">
            <Button variant="outline" size="sm" onClick={() => setStep(2)}>
              <ChevronLeft className="h-4 w-4 mr-1" />
              Voltar
            </Button>
            <Button size="sm" onClick={() => setStep(4)}>
              Próximo
              <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          </div>
        </div>
      )}

      {/* Step 4: Opções */}
      {step === 4 && (
        <div className="space-y-6">
          <h3 className="font-medium">Opções de importação</h3>
          <div className="space-y-2">
            <Label>Modo de duplicata</Label>
            <Select
              value={duplicateMode}
              onValueChange={(v) => setDuplicateMode(v as DuplicateMode)}
            >
              <SelectTrigger className="max-w-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(DUPLICATE_MODE_LABELS) as DuplicateMode[]).map((mode) => (
                  <SelectItem key={mode} value={mode}>
                    {DUPLICATE_MODE_LABELS[mode]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Determina o que fazer quando uma obra com o mesmo título já existe
            </p>
          </div>

          <div className="p-4 border rounded-lg bg-muted/30 space-y-1 text-sm">
            <p className="font-medium">Resumo</p>
            <p className="text-muted-foreground">Arquivo: {file?.name}</p>
            <p className="text-muted-foreground">Aba: {selectedSheet?.name}</p>
            <p className="text-muted-foreground">Linhas: {selectedSheet?.rows.length}</p>
            <p className="text-muted-foreground">
              Colunas mapeadas:{" "}
              {mappings.filter((m) => m.targetField !== "ignore").length}
            </p>
          </div>

          <div className="flex justify-between">
            <Button variant="outline" size="sm" onClick={() => setStep(3)}>
              <ChevronLeft className="h-4 w-4 mr-1" />
              Voltar
            </Button>
            <Button size="sm" onClick={() => setStep(5)}>
              Próximo
              <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          </div>
        </div>
      )}

      {/* Step 5: Importar */}
      {step === 5 && (
        <div className="space-y-6">
          <div>
            <h3 className="font-medium">Iniciar importação</h3>
            <p className="text-sm text-muted-foreground mt-1">
              Tudo pronto. Clique em Importar para processar {selectedSheet?.rows.length} linhas.
            </p>
          </div>

          {importing && (
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">Processando...</p>
              <Progress value={progress} />
            </div>
          )}

          <div className="flex justify-between">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setStep(4)}
              disabled={importing}
            >
              <ChevronLeft className="h-4 w-4 mr-1" />
              Voltar
            </Button>
            <Button size="sm" onClick={handleImport} disabled={importing}>
              {importing ? "Importando..." : "Importar"}
            </Button>
          </div>
        </div>
      )}

      {/* Step 6: Resultado */}
      {step === 6 && importResult && (
        <div className="space-y-6">
          <div className="flex items-center gap-2 text-green-600">
            <Check className="h-5 w-5" />
            <h3 className="font-medium">Importação concluída!</h3>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div className="p-3 rounded-md bg-green-50 border border-green-200 text-center">
              <p className="text-2xl font-bold text-green-700">{importResult.importedCount}</p>
              <p className="text-xs text-green-600">Importadas</p>
            </div>
            <div className="p-3 rounded-md bg-blue-50 border border-blue-200 text-center">
              <p className="text-2xl font-bold text-blue-700">{importResult.updatedCount}</p>
              <p className="text-xs text-blue-600">Atualizadas</p>
            </div>
            <div className="p-3 rounded-md bg-gray-50 border border-gray-200 text-center">
              <p className="text-2xl font-bold text-gray-700">{importResult.skippedCount}</p>
              <p className="text-xs text-gray-600">Ignoradas</p>
            </div>
            <div className="p-3 rounded-md bg-red-50 border border-red-200 text-center">
              <p className="text-2xl font-bold text-red-700">{importResult.errorCount}</p>
              <p className="text-xs text-red-600">Erros</p>
            </div>
          </div>

          {importResult.errors.length > 0 && (
            <div className="space-y-2">
              <p className="text-sm font-medium text-destructive">Erros encontrados:</p>
              <div className="max-h-48 overflow-y-auto space-y-1">
                {importResult.errors.map((err, i) => (
                  <div
                    key={i}
                    className="text-xs p-2 rounded bg-destructive/5 text-destructive"
                  >
                    Linha {err.rowIndex + 1}, campo &quot;{err.field}&quot;: {err.message}
                  </div>
                ))}
              </div>
            </div>
          )}

          <Button onClick={reset} variant="outline">
            Nova importação
          </Button>
        </div>
      )}
    </div>
  )
}
