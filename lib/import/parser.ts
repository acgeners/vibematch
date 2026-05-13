import type { RawImportRow } from "@/types/domain"

export interface ParsedFile {
  sheets: ParsedSheet[]
}

export interface ParsedSheet {
  name: string
  columns: string[]
  rows: RawImportRow[]
}

/**
 * Parse de CSV usando papaparse.
 * O CSV da planilha tem uma linha vazia no topo antes do header real;
 * detectamos isso verificando se a primeira linha tem muitas células vazias.
 */
export async function parseCSV(file: File): Promise<ParsedFile> {
  const Papa = (await import("papaparse")).default
  const text = await file.text()

  return new Promise((resolve, reject) => {
    Papa.parse<string[]>(text, {
      header: false,
      skipEmptyLines: false,
      complete: (result) => {
        const rawRows = result.data as string[][]
        if (rawRows.length === 0) {
          resolve({ sheets: [{ name: "Sheet1", columns: [], rows: [] }] })
          return
        }

        // Detectar linha de header: primeira linha com pelo menos metade das células preenchidas
        let headerIndex = 0
        for (let i = 0; i < Math.min(5, rawRows.length); i++) {
          const filled = rawRows[i].filter((c) => c && c.trim()).length
          if (filled >= rawRows[i].length / 3) {
            headerIndex = i
            break
          }
        }

        const headers = rawRows[headerIndex].map((h) => h.trim())
        const dataRows = rawRows.slice(headerIndex + 1)

        const rows: RawImportRow[] = dataRows
          .filter((row) => row.some((c) => c && c.trim()))
          .map((row) => {
            const obj: RawImportRow = {}
            headers.forEach((h, i) => {
              if (h) obj[h] = row[i] ?? null
            })
            return obj
          })

        resolve({
          sheets: [{ name: "Sheet1", columns: headers.filter(Boolean), rows }],
        })
      },
      error: reject,
    })
  })
}

/**
 * Parse de XLSX usando SheetJS.
 * Retorna todas as abas disponíveis.
 */
export async function parseXLSX(file: File): Promise<ParsedFile> {
  const XLSX = await import("xlsx")
  const buffer = await file.arrayBuffer()
  const workbook = XLSX.read(buffer, { type: "array", cellDates: false })

  const sheets: ParsedSheet[] = workbook.SheetNames.map((sheetName) => {
    const ws = workbook.Sheets[sheetName]
    const data = (XLSX.utils.sheet_to_json(ws, {
      header: 1,
      defval: null,
      blankrows: false,
    }) as unknown) as unknown[][]

    if (data.length === 0) {
      return { name: sheetName, columns: [], rows: [] }
    }

    // Detectar linha de header: primeira linha com mais conteúdo que a anterior
    let headerRowIndex = 0
    if (data.length > 1) {
      const row0Filled = (data[0] as unknown[]).filter((c) => c != null && c !== "").length
      const row1Filled = (data[1] as unknown[]).filter((c) => c != null && c !== "").length
      // Se linha 0 tem muito menos conteúdo, é linha vazia/sumário
      if (row0Filled < row1Filled * 0.5) {
        headerRowIndex = 1
      }
    }

    const headerRow = data[headerRowIndex] as unknown[]
    const columns = headerRow
      .map((h) => (h != null ? String(h).trim() : ""))
      .filter(Boolean)

    const dataRows = data.slice(headerRowIndex + 1)
    const rows: RawImportRow[] = dataRows.map((row) => {
      const obj: RawImportRow = {}
      headerRow.forEach((h, i) => {
        const key = h != null ? String(h).trim() : ""
        if (key) obj[key] = ((row as unknown[])[i] as string | number | null) ?? null
      })
      return obj
    })

    return { name: sheetName, columns, rows }
  })

  return { sheets }
}

/**
 * Entry point: detecta o tipo do arquivo e faz parse.
 */
export async function parseFile(file: File): Promise<ParsedFile> {
  const name = file.name.toLowerCase()
  if (name.endsWith(".csv")) return parseCSV(file)
  if (name.endsWith(".xlsx") || name.endsWith(".xls")) return parseXLSX(file)
  throw new Error(`Formato não suportado: ${file.name}`)
}
