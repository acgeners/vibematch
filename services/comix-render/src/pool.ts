// Semáforo com fila FIFO e teto de espera (§5). Limita a concorrência ao número
// de contextos que a VM aguenta; requests além do limite esperam na fila, e se a
// fila enche ou a espera estoura, viram `BusyError` → 503 (backpressure, o app
// degrada como "Comix indisponível" em vez de empilhar).

export class BusyError extends Error {
  constructor() {
    super("busy")
    this.name = "BusyError"
  }
}

interface Waiter {
  resolve: () => void
  reject: (err: Error) => void
  timer: ReturnType<typeof setTimeout>
  enqueuedAt: number
}

export class Semaphore {
  private active = 0
  private waiters: Waiter[] = []

  constructor(
    private readonly max: number,
    private readonly maxQueue: number,
    private readonly maxWaitMs: number,
  ) {}

  get inFlight(): number {
    return this.active
  }
  get queueLength(): number {
    return this.waiters.length
  }

  /** Adquire um slot. Resolve com o tempo esperado na fila (ms). Lança BusyError
   *  se a fila está cheia ou a espera estourou o teto. */
  async acquire(now: () => number = Date.now): Promise<number> {
    if (this.active < this.max) {
      this.active++
      return 0
    }
    if (this.waiters.length >= this.maxQueue) throw new BusyError()

    const enqueuedAt = now()
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        const i = this.waiters.findIndex((w) => w.timer === timer)
        if (i >= 0) this.waiters.splice(i, 1)
        reject(new BusyError())
      }, this.maxWaitMs)
      this.waiters.push({ resolve, reject, timer, enqueuedAt })
    })
    this.active++
    return now() - enqueuedAt
  }

  /** Libera o slot e passa a vez pro próximo da fila (se houver). */
  release(): void {
    this.active--
    const next = this.waiters.shift()
    if (next) {
      clearTimeout(next.timer)
      next.resolve()
    }
  }
}
