import { describe, it, expect } from "vitest"
import {
  evaluateLocalExternalReviewEditorGate,
  normalizeHostname,
} from "@/lib/synopsis-interest/local-external-review-gate"

const OPEN = { nodeEnv: "development", flag: "true", host: "localhost:3001", vercelEnv: undefined }

describe("local-external-review-gate — decisão pura", () => {
  it("1. fechado por padrão: flag ausente ⇒ bloqueado", () => {
    expect(evaluateLocalExternalReviewEditorGate({ ...OPEN, flag: undefined }).allowed).toBe(false)
    expect(evaluateLocalExternalReviewEditorGate({ ...OPEN, flag: undefined }).reason).toBe("flag_disabled")
    // flag com qualquer valor != "true" também bloqueia
    expect(evaluateLocalExternalReviewEditorGate({ ...OPEN, flag: "1" }).allowed).toBe(false)
    expect(evaluateLocalExternalReviewEditorGate({ ...OPEN, flag: "TRUE" }).allowed).toBe(false)
  })

  it("2. produção bloqueada mesmo com flag e host local", () => {
    const r = evaluateLocalExternalReviewEditorGate({ ...OPEN, nodeEnv: "production" })
    expect(r.allowed).toBe(false)
    expect(r.reason).toBe("production")
  })

  it("3. Vercel (Preview ou Production) bloqueado", () => {
    expect(evaluateLocalExternalReviewEditorGate({ ...OPEN, vercelEnv: "preview" }).reason).toBe("vercel")
    expect(evaluateLocalExternalReviewEditorGate({ ...OPEN, vercelEnv: "production" }).reason).toBe("vercel")
    expect(evaluateLocalExternalReviewEditorGate({ ...OPEN, vercelEnv: "development" }).reason).toBe("vercel")
  })

  it("4. host não-local bloqueado", () => {
    for (const host of ["example.com", "satoria.app", "10.0.0.5", "192.168.1.10:3001", null]) {
      const r = evaluateLocalExternalReviewEditorGate({ ...OPEN, host })
      expect(r.allowed).toBe(false)
    }
    expect(evaluateLocalExternalReviewEditorGate({ ...OPEN, host: null }).reason).toBe("unknown_host")
    expect(evaluateLocalExternalReviewEditorGate({ ...OPEN, host: "example.com" }).reason).toBe("non_local_host")
  })

  it("5. aberto SOMENTE com todas as condições (não-prod + flag=true + sem vercel + host local)", () => {
    for (const host of ["localhost", "localhost:3001", "127.0.0.1", "127.0.0.1:3001", "[::1]:3001", "::1"]) {
      const r = evaluateLocalExternalReviewEditorGate({ nodeEnv: "development", flag: "true", host, vercelEnv: undefined })
      expect(r.allowed).toBe(true)
      expect(r.reason).toBeNull()
    }
    // teste/undefined nodeEnv (não é "production") também passa
    expect(evaluateLocalExternalReviewEditorGate({ nodeEnv: "test", flag: "true", host: "localhost", vercelEnv: "" }).allowed).toBe(true)
  })

  it("normalizeHostname: remove porta e colchetes IPv6", () => {
    expect(normalizeHostname("localhost:3001")).toBe("localhost")
    expect(normalizeHostname("127.0.0.1:3001")).toBe("127.0.0.1")
    expect(normalizeHostname("[::1]:3001")).toBe("::1")
    expect(normalizeHostname("::1")).toBe("::1")
    expect(normalizeHostname("EXAMPLE.com")).toBe("example.com")
    expect(normalizeHostname("")).toBeNull()
    expect(normalizeHostname(null)).toBeNull()
  })
})

describe("local-external-review-gate — AUDIT B2.2N: spoof de host / headers de proxy", () => {
  // FATO empírico (B2.2N, dev loopback direto): o Next SINTETIZA `x-forwarded-host`
  // (= valor do Host) e `x-forwarded-for` (= IP do socket) em TODO request. Logo a
  // PRESENÇA de x-forwarded-* NÃO distingue proxy de conexão direta — por isso o gate
  // NÃO consulta esses headers (a tentativa B2.2M-AUDIT de bloquear por presença foi
  // revertida: bloqueava 100% dos requests). A defesa AUTORITATIVA é a ligação loopback.

  it("Host remoto ⇒ bloqueado (non_local_host) — único header usado é o Host", () => {
    const r = evaluateLocalExternalReviewEditorGate({ ...OPEN, host: "evil.example.com" })
    expect(r.allowed).toBe(false)
    expect(r.reason).toBe("non_local_host")
  })

  it("Host=localhost ⇒ liberado (caminho do dev loopback) — sem dependência de forwarded", () => {
    expect(evaluateLocalExternalReviewEditorGate({ ...OPEN, host: "localhost:3001" }).allowed).toBe(true)
  })

  it("a decisão NÃO depende de campos de forwarded (não são input do gate)", () => {
    // Passar chaves extras de proxy não muda nada — o tipo de input nem as expõe.
    const base = { nodeEnv: "development", flag: "true", host: "localhost", vercelEnv: undefined }
    const withExtra = { ...base, xForwardedHost: "evil.com", xForwardedFor: "8.8.8.8" } as unknown as Parameters<typeof evaluateLocalExternalReviewEditorGate>[0]
    expect(evaluateLocalExternalReviewEditorGate(withExtra).allowed).toBe(true)
  })

  it("precedência de bloqueio: production > vercel > flag > host", () => {
    expect(evaluateLocalExternalReviewEditorGate({ nodeEnv: "production", flag: "true", host: "localhost", vercelEnv: "production" }).reason).toBe("production")
    expect(evaluateLocalExternalReviewEditorGate({ nodeEnv: "test", flag: "false", host: "localhost" }).reason).toBe("flag_disabled")
    expect(evaluateLocalExternalReviewEditorGate({ nodeEnv: "test", flag: "true", host: "8.8.8.8" }).reason).toBe("non_local_host")
  })
})
