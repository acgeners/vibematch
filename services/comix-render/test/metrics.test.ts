import { test } from "node:test"
import assert from "node:assert/strict"
import { metrics } from "../src/metrics.js"

test("render expõe os detectores de leak de contexto", () => {
  metrics.contextCreated.inc()
  metrics.contextCreated.inc()
  metrics.contextClosed.inc()
  const out = metrics.render()
  assert.match(out, /# TYPE browser_context_created_total counter/)
  assert.match(out, /browser_context_created_total \d+/)
  assert.match(out, /browser_context_closed_total \d+/)
})

test("resolveErrors rotula por código", () => {
  metrics.resolveErrors.inc("busy")
  metrics.resolveErrors.inc("render_timeout")
  metrics.resolveErrors.inc("busy")
  const out = metrics.render()
  assert.match(out, /resolve_errors_total\{code="busy"\} 2/)
  assert.match(out, /resolve_errors_total\{code="render_timeout"\} 1/)
})

test("observeResolve alimenta summaries (sum + count)", () => {
  metrics.observeResolve({ durationMs: 1000, navMs: 300, xhrMs: 200, candidates: 28 })
  metrics.observeResolve({ durationMs: 2000, navMs: 400, xhrMs: 250, candidates: 10 })
  const out = metrics.render()
  assert.match(out, /resolve_duration_ms_sum 3000/)
  assert.match(out, /resolve_duration_ms_count 2/)
  assert.match(out, /candidates_returned_sum 38/)
})

test("gauges vêm da fonte configurada", () => {
  metrics.setGaugeSource(() => ({ inflight: 2, queue: 5, ready: 1 }))
  const out = metrics.render()
  assert.match(out, /\ninflight 2/)
  assert.match(out, /\nqueue_length 5/)
  assert.match(out, /\nbrowser_ready 1/)
})
