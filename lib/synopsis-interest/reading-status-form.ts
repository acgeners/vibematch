/**
 * Plano 3 — Formulário OFFLINE de classificação do status de leitura (Fase B2.2D,
 * Parte B). PURO: gera HTML autossuficiente (abre no navegador, sem servidor e sem
 * rede) para classificar as 80 obras únicas do pilot-1 nas 5 categorias finais.
 *
 * Diferente do pacote contextual CEGO: este formulário é sobre o eixo de LEITURA, então
 * MOSTRA título + sinais objetivos do banco (necessários para lembrar se houve leitura).
 * NUNCA mostra: label contextual de interesse · valores de repetições · previsão ·
 * candidato · métrica · score · alignment · ranking · split · stratum · distribuição
 * de labels. A sugestão do banco é exibida marcada como NÃO autoritativa.
 */

import { READING_STATUS_VALUES, type ReadingStatus } from "./reading-status-audit"

/** Uma obra exibida no formulário (somente campos permitidos). */
export interface ReadingStatusFormWork {
  workId: string
  title: string
  /** status atual no banco (rótulo legível). */
  personalStatus: string
  chaptersRead: number | null
  totalChapters: number | null
  /** "YYYY-MM-DD" ou null. */
  lastReadAt: string | null
  /** sugestão do banco (4-vocab) — NÃO autoritativa. */
  dbSuggested: string
}

const STATUS_GUIDE: Array<{ value: ReadingStatus; title: string; desc: string }> = [
  { value: "unread_unfamiliar", title: "Não lida · desconhecida", desc: "Nunca leu conteúdo narrativo E não reconhecia a obra antes do pacote contextual." },
  { value: "unread_familiar", title: "Não lida · familiar", desc: "Nunca leu conteúdo narrativo, mas já conhecia título, premissa, personagens, reputação, comentários ou spoilers antes da rotulagem. Familiaridade NÃO exclui." },
  { value: "partially_read", title: "Lida em parte", desc: "Leu qualquer parte real da narrativa sem concluir (inclui iniciada e abandonada/dropped). Ler capítulo/episódio/páginas/amostra conta. Ler só sinopse/tags/reviews/spoilers/capa NÃO conta." },
  { value: "fully_read", title: "Lida por completo", desc: "Concluiu a obra (ou todo o conteúdo disponível que considera leitura completa). Se ongoing/caught up, deixe uma nota explicativa." },
  { value: "uncertain", title: "Incerto", desc: "Não consegue determinar com segurança se houve leitura real. Nunca é convertido automaticamente." },
]

function esc(s: string): string {
  return (s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
}

function chaptersLine(w: ReadingStatusFormWork): string {
  const read = w.chaptersRead == null ? "—" : String(w.chaptersRead)
  const total = w.totalChapters == null ? "" : ` / ${esc(String(w.totalChapters))}`
  return `Capítulos lidos: <strong>${esc(read)}</strong>${total}`
}

function renderCard(w: ReadingStatusFormWork, i: number): string {
  const name = `s_${esc(w.workId)}`
  const radios = STATUS_GUIDE.map(
    (g) => `<label class="opt"><input type="radio" name="${name}" value="${g.value}"> <span>${esc(g.title)}</span></label>`,
  ).join("")
  const last = w.lastReadAt ? ` · última leitura: <strong>${esc(w.lastReadAt)}</strong>` : ""
  return `<div class="card" data-work-id="${esc(w.workId)}" data-title="${esc(w.title)}">
<div class="hdr"><span class="seq">${i + 1}/80</span> <span class="title">${esc(w.title)}</span></div>
<div class="meta">Status no banco: <strong>${esc(w.personalStatus)}</strong> · ${chaptersLine(w)}${last}</div>
<div class="hint">Sugestão do banco (NÃO autoritativa): <code>${esc(w.dbSuggested)}</code>${w.dbSuggested === "unread" ? " — escolha <em>unread_familiar</em> ou <em>unread_unfamiliar</em> conforme você já conhecia a obra." : ""}</div>
<div class="opts">${radios}</div>
<textarea class="note" rows="1" placeholder="nota opcional"></textarea>
</div>`
}

// Script de exportação OFFLINE: monta o CSV das seleções e baixa via Blob (sem rede).
const EXPORT_SCRIPT = `<script>
(function(){
  function q(s,el){return (el||document).querySelector(s)}
  function qa(s,el){return Array.prototype.slice.call((el||document).querySelectorAll(s))}
  function cell(v){v=String(v==null?"":v);return /[;\\n"]/.test(v)?'"'+v.replace(/"/g,'""')+'"':v}
  function count(){
    var cards=qa("[data-work-id]");var n=0;
    cards.forEach(function(c){if(q("input[type=radio]:checked",c))n++});
    var el=q("#count");if(el)el.textContent=n+"/"+cards.length+" classificadas";
    return n;
  }
  function build(){
    var cards=qa("[data-work-id]");
    var rows=[["work_id","title","final_reading_status","notes"].join(";")];
    cards.forEach(function(c){
      var id=c.getAttribute("data-work-id");var title=c.getAttribute("data-title")||"";
      var sel=q("input[type=radio]:checked",c);var status=sel?sel.value:"";
      var note=(q(".note",c)||{}).value||"";
      rows.push([cell(id),cell(title),cell(status),cell(note.trim())].join(";"));
    });
    return rows.join("\\n")+"\\n";
  }
  function save(){
    var blob=new Blob([build()],{type:"text/csv;charset=utf-8"});
    var url=URL.createObjectURL(blob);
    var a=document.createElement("a");a.href=url;a.download="pilot-1-reading-status-filled.csv";
    document.body.appendChild(a);a.click();document.body.removeChild(a);URL.revokeObjectURL(url);
  }
  document.addEventListener("change",count);
  var btn=q("#export");if(btn)btn.addEventListener("click",save);
  count();
})();
</script>`

export interface ReadingStatusFormMeta {
  goldenVersion: string
  baseSnapshotVersion: string
}

/** Gera o HTML do formulário. Exige EXATAMENTE 80 obras (1 por work_id único). */
export function buildReadingStatusFormHtml(works: ReadingStatusFormWork[], meta: ReadingStatusFormMeta): string {
  const guide = STATUS_GUIDE.map(
    (g) => `<tr><td><code>${g.value}</code></td><td><strong>${esc(g.title)}</strong></td><td>${esc(g.desc)}</td></tr>`,
  ).join("\n")
  const cards = works.map((w, i) => renderCard(w, i)).join("\n")
  return `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8">
<title>Auditoria de leitura — ${esc(meta.goldenVersion)}/${esc(meta.baseSnapshotVersion)}</title>
<style>
body{font:15px/1.6 system-ui,sans-serif;max-width:860px;margin:1.5rem auto;padding:0 1rem 6rem;color:#111}
h1{font-size:1.2rem}h2{font-size:1rem}
.guide{border:1px solid #bbb;border-radius:8px;padding:1rem;margin-bottom:1.2rem;background:#fafafa}
.guide table{border-collapse:collapse;margin:.4rem 0;width:100%}
.guide td{border:1px solid #ddd;padding:.3rem .5rem;vertical-align:top;font-size:.92rem}
.warn{background:#fff7e6;border:1px solid #f0d090;border-radius:6px;padding:.5rem .7rem;margin:.6rem 0;font-size:.92rem}
.card{border:1px solid #ccc;border-radius:8px;padding:.8rem 1rem;margin:.8rem 0}
.hdr{display:flex;gap:.6rem;align-items:baseline}.seq{font-family:monospace;color:#888;font-size:.8rem}
.title{font-weight:700}
.meta{color:#444;font-size:.9rem;margin:.25rem 0}
.hint{color:#666;font-size:.85rem;margin:.2rem 0 .5rem}
code{background:#eee;padding:0 .3em;border-radius:3px;font-size:.9em}
.opts{display:flex;flex-direction:column;gap:.15rem}
.opt{display:flex;gap:.4rem;align-items:flex-start;font-size:.92rem;cursor:pointer}
.note{width:100%;margin-top:.4rem;font:inherit;padding:.3rem;border:1px solid #ddd;border-radius:4px}
.bar{position:fixed;bottom:0;left:0;right:0;background:#111;color:#fff;display:flex;
  justify-content:space-between;align-items:center;padding:.6rem 1rem;gap:1rem}
.bar button{font:inherit;padding:.4rem .9rem;border-radius:6px;border:0;background:#4f8cff;color:#fff;cursor:pointer}
#count{font-family:monospace;font-size:.9rem}
</style></head><body>
<h1>Auditoria de status de leitura — pilot-1 (80 obras)</h1>
<div class="guide">
<h2>Como classificar (eixo de LEITURA)</h2>
<p>Para cada obra, escolha <strong>uma</strong> categoria que descreva sua experiência REAL de leitura. A
<strong>familiaridade</strong> (categoria <code>unread_familiar</code>) deve ser avaliada em relação ao momento
<strong>anterior</strong> à rotulagem contextual.</p>
<table>${guide}</table>
<div class="warn">Apenas ler sinopse, tags, reviews, spoilers, resumos, capa ou trailer <strong>não conta</strong> como leitura.
A sugestão do banco em cada card é só um ponto de partida — <strong>não é autoritativa</strong>. Em caso de dúvida real, use <code>uncertain</code> (nunca chute).</div>
<p>Ao terminar, clique em <strong>Exportar CSV</strong> (baixa <code>pilot-1-reading-status-filled.csv</code>, 100% local).</p>
</div>
${cards}
<div class="bar"><span id="count">0/80 classificadas</span><button id="export" type="button">Exportar CSV</button></div>
${EXPORT_SCRIPT}
</body></html>
`
}

// ── Asserção offline / anti-leakage ──────────────────────────────────────────

/** Tokens proibidos no formulário (labels de interesse + outputs técnicos). */
const FORBIDDEN_TOKENS: Array<{ re: RegExp; label: string }> = [
  { re: /♥/, label: "label de interesse (♥)" },
  { re: /\bprediction\b/i, label: "prediction" },
  { re: /\balignment\b/i, label: "alignment" },
  { re: /\bpersonal_fit\b/i, label: "personal_fit" },
  { re: /\bexpected_score\b/i, label: "expected_score" },
  { re: /\bcalc_score\b/i, label: "calc_score" },
  { re: /\bstratum\b/i, label: "stratum" },
  { re: /\bdata-split\b/i, label: "data-split" },
  { re: /\bdata-stratum\b/i, label: "data-stratum" },
  { re: /\bcontextual[_-]?label\b/i, label: "contextual label" },
  { re: /\btaste_profile\b/i, label: "taste_profile" },
]

/** Primitivas de rede / recursos externos proibidos (mantém o form 100% offline). */
const FORBIDDEN_NETWORK: Array<{ re: RegExp; label: string }> = [
  { re: /https?:\/\//i, label: "URL externa" },
  { re: /<iframe/i, label: "<iframe>" },
  { re: /<link/i, label: "<link>" },
  { re: /\ssrc\s*=/i, label: "atributo src" },
  { re: /@import/i, label: "@import" },
  { re: /\bfetch\s*\(/i, label: "fetch(" },
  { re: /XMLHttpRequest/i, label: "XMLHttpRequest" },
  { re: /WebSocket/i, label: "WebSocket" },
  { re: /\son(?:click|load|error|mouse[a-z]+)\s*=/i, label: "handler inline" },
]

export interface FormOfflineValidation { ok: boolean; issues: string[] }

/** Conta os cards (obras) no HTML do formulário. */
export function countFormCards(html: string): number {
  return (html.match(/data-work-id=/g) ?? []).length
}

/**
 * Valida o formulário: sem tokens proibidos, sem primitivas de rede e (opcional) com
 * a contagem esperada de obras. `opts.workIds` falha se algum work_id NÃO estiver no
 * HTML (sanidade — o form É indexado por work_id, então eles DEVEM estar presentes,
 * ao contrário do pacote cego). Não procura valores de label (não são passados).
 */
export function assertReadingStatusFormOffline(
  html: string,
  opts: { expectedCount?: number } = {},
): FormOfflineValidation {
  const issues: string[] = []
  for (const { re, label } of FORBIDDEN_TOKENS) if (re.test(html)) issues.push(`token proibido: ${label}`)
  for (const { re, label } of FORBIDDEN_NETWORK) if (re.test(html)) issues.push(`primitiva de rede: ${label}`)
  if (typeof opts.expectedCount === "number") {
    const n = countFormCards(html)
    if (n !== opts.expectedCount) issues.push(`esperado ${opts.expectedCount} obras, encontrado ${n}`)
  }
  return { ok: issues.length === 0, issues }
}

// ── Proteção contra sobrescrita do formulário ────────────────────────────────

export interface FormWriteGuard {
  allowed: boolean
  reason: string
}

/**
 * Decide se o gerador pode ESCREVER no caminho de saída. Por padrão **não** sobrescreve
 * um formulário já existente (protege o artefato rotulável). Regeneração exige ação
 * explícita: `--force` (sobrescreve) ou `--out=<outro caminho>` (resolve para um caminho
 * inexistente ⇒ `outputExists=false`). Pura/determinística.
 */
export function guardFormOutput(opts: { outputExists: boolean; force: boolean }): FormWriteGuard {
  if (!opts.outputExists) return { allowed: true, reason: "saída inexistente — geração permitida" }
  if (opts.force) return { allowed: true, reason: "--force: sobrescreve o formulário existente" }
  return {
    allowed: false,
    reason: "formulário de saída já existe — abortado para não sobrescrever. Use --force ou --out=<outro caminho>.",
  }
}

export const READING_STATUS_FORM_VOCAB = READING_STATUS_VALUES
