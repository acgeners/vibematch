/**
 * Dono único do PADRÃO de segredo. Duas políticas são construídas sobre ele, e é de
 * propósito que o padrão não seja reescrito em nenhuma delas: uma segunda cópia do regex
 * é como o log passa a redigir num lugar e vazar no outro.
 *
 * ⚠️ NÃO é detecção exaustiva — é rede de segurança contra vazar credencial num campo
 * que vai para log. O que garante ausência de segredo é não coletar o dado (headers,
 * cookies, body e query ficam FORA do evento), não este regex.
 */
const PADRAO_DE_SEGREDO =
  /\b(sk-[A-Za-z0-9_-]{8,}|eyJ[A-Za-z0-9._-]{10,}|[Bb]earer\s+[A-Za-z0-9._-]{8,})/g

/**
 * VALOR atribuído a um nome sensível — `apikey=…`, `service_role=…`, `senha: …`.
 *
 * 🔴 A 1ª versão exigia `?` ou `&` antes do nome, e MEDIDO em 2026-08-23 isso deixava
 * passar quatro formas reais: `apikey=X` solto numa frase, `service_role=X`,
 * `SUPABASE_SERVICE_ROLE_KEY=X` e `senha=X` (o repo é pt-BR). Só `?apikey=X` era pego.
 * Hoje o gatilho é o NOME em fronteira de palavra, com prefixo opcional — é ele que
 * alcança `SUPABASE_SERVICE_ROLE_KEY`, onde `_` não é fronteira.
 *
 * ⚠️ Redige o VALOR e preserva o NOME — `apikey=[REDACTED]` ainda diz o que aconteceu.
 * ⚠️ Erra para o lado de redigir DEMAIS de propósito: perder um diagnóstico custa menos
 * que vazar credencial num log. O `\b` inicial é o que impede casar `key` dentro de
 * "monkey"; sem ele a redação comeria texto comum.
 */
const PADRAO_DE_ATRIBUICAO_SENSIVEL =
  /\b((?:[\w-]{1,40}[_-])?(?:apikey|api[_-]key|service[_-]?role(?:[_-]?key)?|access[_-]?token|authorization|passwd|password|senha|secret|token|key)[\w-]{0,40})[ \t]{0,4}[=:][ \t]{0,4}[^\s&"';,)}\]]{1,200}/gi

/**
 * E-mail. É PII, não credencial, mas a régua deste evento é a mesma: ele não identifica
 * pessoa. Não casa `@escopo/pacote` de stack trace — ali o caractere antes do `@` é `/`,
 * que fica fora da classe.
 */
const PADRAO_DE_EMAIL = /[\w.+-]{1,64}@[\w-]{1,63}\.[\w.-]{1,63}/g

/**
 * Redige segredo PRESERVANDO quebra de linha — é o que serve para stack trace.
 *
 * 🔴 O stack passa por AQUI, não só a mensagem: segredo que aparece em `error.message`
 * reaparece na 1ª linha de `error.stack`, então sanear só a mensagem seria metade do
 * trabalho — e a metade que engana, porque o campo limpo dá a impressão de cobertura.
 */
const MAX_ENTRADA = 8000

export function redactSecrets(texto: string): string {
  // 🔴 Teto de ENTRADA, medido: um stack de 200 mil caracteres fazia a redação levar **21s**
  // — o handler de erro viraria a próxima falha, o único desfecho que ele não pode ter.
  //
  // ⚠️ A culpa era do PADRÃO DE E-MAIL, não do de atribuição. Isolado em 2026-08-23 sobre
  // 200k caracteres: e-mail **17.744ms**, atribuição **0ms**, segredo **0ms**. A primeira
  // versão deste comentário culpava o de atribuição — era palpite, e a medição o desmentiu.
  // `[\w.+-]+@` varre até o fim, não acha `@`, recua um caractere e repete: O(n²).
  //
  // Hoje são DUAS defesas, e nenhuma é redundante: os quantificadores dos padrões são
  // limitados (tira o quadrático na origem) E a entrada é cortada (teto para o padrão que
  // alguém acrescentar amanhã sem medir). Cortar ANTES de redigir é seguro: o que sai da
  // janela não entra no evento.
  const base = texto.length > MAX_ENTRADA ? texto.slice(0, MAX_ENTRADA) : texto
  return base
    .replace(PADRAO_DE_SEGREDO, "[REDACTED]")
    .replace(PADRAO_DE_ATRIBUICAO_SENSIVEL, "$1=[REDACTED]")
    .replace(PADRAO_DE_EMAIL, "[REDACTED]")
}

/**
 * Mensagem de erro segura p/ persistir em `last_error`: só a message (sem stack),
 * em uma linha, truncada, com redação de padrões óbvios de segredo (api keys,
 * JWT, bearer).
 *
 * ⚠️ Ela ACHATA espaço em branco, então não serve para stack — use `redactSecrets`
 * + truncamento quando as quebras de linha importarem.
 */
export function sanitizeErrorMessage(err: unknown, maxLen = 500): string {
  const raw = err instanceof Error ? err.message : String(err)
  let s = redactSecrets(raw.replace(/\s+/g, " ").trim())
  if (s.length > maxLen) s = `${s.slice(0, maxLen - 1)}…`
  return s
}
