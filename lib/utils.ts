import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function titleToSlug(title: string): string {
  const base = title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
  if (base) return base
  // Título sem NENHUM caractere latino (coreano/japonês/cirílico) slugificaria pra
  // vazio. O fallback fixo "untitled" fazia TODAS essas obras colidirem na mesma URL
  // (`/titles/untitled`, first-wins → obra errada/ambígua). Deriva um sufixo
  // DETERMINÍSTICO do título original: mantém o slug único por título E reconstruível
  // — `getWorkBySlug` casa `titleToSlug(title) === slug`, então a mesma entrada gera
  // o mesmo slug dos dois lados. (Hoje 0 obras caem aqui; é defensivo p/ futuro.)
  return `untitled-${hashString(title)}`
}

// FNV-1a 32-bit → base36. Hash determinístico, sem dependências e idêntico no
// servidor e no cliente (titleToSlug roda nos dois). Não é criptográfico — só
// precisa distribuir títulos distintos em sufixos distintos.
function hashString(s: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(36)
}

// Canonical kebab-case slug for tag names. Used by every tag ingestion path
// so we don't end up with both `abandoned_protagonist` and `abandoned-protagonist`.
// Returns "" when the input has no alphanumeric content — callers filter those out.
export function slugifyTagName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
}

/**
 * Nome de fonte de capa digitado à mão → slug aceito pelo banco.
 *
 * `work_covers.source` tem `CHECK (source ~ '^[a-z0-9][a-z0-9-]{0,79}$')`, mas o
 * Zod só limita o tamanho: um nome com espaço ou acento passa na validação e
 * estoura no INSERT. E `syncWorkCovers` apaga as capas ANTES de inserir, sem
 * transação — um erro de constraint deixaria a obra sem capa nenhuma. Normalizar
 * aqui torna o caso impossível em vez de tratável.
 *
 * Acento é dobrado antes (`Ilustração` → `ilustracao`, não `ilustra-o`).
 */
export function normalizeCoverSource(raw: string | null | undefined): string {
  if (!raw) return "manual"
  const folded = raw.normalize("NFD").replace(/\p{M}/gu, "")
  return slugifyTagName(folded).slice(0, 80).replace(/-+$/, "") || "manual"
}

export function readingProgressPercent(
  read: number | null | undefined,
  total: number | null | undefined,
): number | null {
  if (read == null || total == null || total <= 0) return null
  return Math.min(100, Math.max(0, Math.round((read / total) * 100)))
}
