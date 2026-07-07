// Métricas em formato Prometheus (exposition text). Implementação mínima, sem
// dependência externa: counters, summaries (sum+count → média) e gauges por
// callback. Inclui os detectores de vazamento de contexto pedidos:
// browser_context_created_total / browser_context_closed_total (a diferença
// entre eles deve ficar ≈ 0; se crescer, há contexto não fechado).

class Counter {
  private total = 0
  private byLabel = new Map<string, number>()
  constructor(
    readonly name: string,
    readonly help: string,
    readonly labelName?: string,
  ) {}
  inc(label?: string, n = 1): void {
    this.total += n
    if (this.labelName && label !== undefined) {
      this.byLabel.set(label, (this.byLabel.get(label) ?? 0) + n)
    }
  }
  render(): string {
    const lines = [`# HELP ${this.name} ${this.help}`, `# TYPE ${this.name} counter`]
    if (this.labelName && this.byLabel.size > 0) {
      for (const [label, value] of this.byLabel) {
        lines.push(`${this.name}{${this.labelName}="${label}"} ${value}`)
      }
    } else {
      lines.push(`${this.name} ${this.total}`)
    }
    return lines.join("\n")
  }
}

class Summary {
  private sum = 0
  private count = 0
  constructor(
    readonly name: string,
    readonly help: string,
  ) {}
  observe(value: number): void {
    this.sum += value
    this.count += 1
  }
  render(): string {
    return [
      `# HELP ${this.name} ${this.help}`,
      `# TYPE ${this.name} summary`,
      `${this.name}_sum ${this.sum}`,
      `${this.name}_count ${this.count}`,
    ].join("\n")
  }
}

const resolveTotal = new Counter("resolve_total", "Total de requests /resolve concluídos")
const resolveErrors = new Counter("resolve_errors_total", "Erros de /resolve por código", "code")
const browserRestarts = new Counter("browser_restarts_total", "Reinícios do browser")
const contextCreated = new Counter("browser_context_created_total", "BrowserContexts criados")
const contextClosed = new Counter("browser_context_closed_total", "BrowserContexts fechados")

const durationMs = new Summary("resolve_duration_ms", "Duração total de /resolve")
const navMs = new Summary("resolve_nav_ms", "Duração do page.goto")
const xhrMs = new Summary("resolve_xhr_ms", "Espera do XHR de busca")
const queueWaitMs = new Summary("queue_wait_ms", "Espera na fila antes do slot de concorrência")
const candidatesReturned = new Summary("candidates_returned", "Candidatos que o Comix devolveu por busca")

// Gauges lidos sob demanda (inflight/fila/ready) — setados pelo server.
let gaugeSource: () => { inflight: number; queue: number; ready: number } = () => ({ inflight: 0, queue: 0, ready: 0 })

export const metrics = {
  resolveTotal,
  resolveErrors,
  browserRestarts,
  contextCreated,
  contextClosed,
  durationMs,
  navMs,
  xhrMs,
  queueWaitMs,
  candidatesReturned,

  setGaugeSource(fn: () => { inflight: number; queue: number; ready: number }): void {
    gaugeSource = fn
  },

  /** Registra uma resolução (sucesso ou vazio) num só ponto. */
  observeResolve(o: { durationMs: number; navMs: number; xhrMs: number; candidates: number }): void {
    resolveTotal.inc()
    durationMs.observe(o.durationMs)
    navMs.observe(o.navMs)
    xhrMs.observe(o.xhrMs)
    candidatesReturned.observe(o.candidates)
  },

  render(): string {
    const g = gaugeSource()
    const gauges = [
      "# HELP inflight Requests em execução agora",
      "# TYPE inflight gauge",
      `inflight ${g.inflight}`,
      "# HELP queue_length Requests aguardando slot",
      "# TYPE queue_length gauge",
      `queue_length ${g.queue}`,
      "# HELP browser_ready 1 se o browser está apto a atender",
      "# TYPE browser_ready gauge",
      `browser_ready ${g.ready}`,
    ].join("\n")
    return [
      resolveTotal.render(),
      resolveErrors.render(),
      browserRestarts.render(),
      contextCreated.render(),
      contextClosed.render(),
      durationMs.render(),
      navMs.render(),
      xhrMs.render(),
      queueWaitMs.render(),
      candidatesReturned.render(),
      gauges,
    ].join("\n\n") + "\n"
  },
}
