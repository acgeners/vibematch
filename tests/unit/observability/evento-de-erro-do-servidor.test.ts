/**
 * O evento de `onRequestError` precisa ser útil MESMO quando a mensagem é inútil, e não pode
 * carregar nada da request além do método.
 *
 * 🔴 O achado que molda este formato veio da A3.1: uma falha do PostgREST chega como
 * `{"message":""}` — sem `code`, `details` nem `hint`. Telemetria que dependa da mensagem
 * para saber que houve erro nasce cega nessa classe inteira.
 */
import { describe, it, expect, vi } from "vitest"
import { buildServerErrorEvent } from "@/lib/observability/server-error-event"

const CTX = {
  routerKind: "App Router",
  routePath: "/catalog/[id]",
  routeType: "render",
  renderSource: "react-server-components",
  revalidateReason: undefined,
} as const

const semFly: Record<string, string | undefined> = { NODE_ENV: "production" }
const comFly: Record<string, string | undefined> = {
  NODE_ENV: "production",
  FLY_APP_NAME: "satoria",
  FLY_MACHINE_ID: "148e393c73d089",
  FLY_REGION: "gru",
  FLY_IMAGE_REF: "registry.fly.io/satoria:deployment-01K3",
}

const build = (over: Partial<Parameters<typeof buildServerErrorEvent>[0]> = {}) =>
  buildServerErrorEvent({ error: new Error("boom"), method: "GET", context: CTX, env: semFly, now: "2026-08-23T12:00:00.000Z", ...over })

describe("A — erro normal", () => {
  it("traz identidade, rota e contexto de execução", () => {
    const e = build()
    expect(e.event).toBe("server_error")
    expect(e.ts).toBe("2026-08-23T12:00:00.000Z")
    expect(e.errorName).toBe("Error")
    expect(e.errorMessage).toBe("boom")
    expect(e.method).toBe("GET")
    expect(e.routerKind).toBe("App Router")
    expect(e.routePath).toBe("/catalog/[id]")
    expect(e.routeType).toBe("render")
    expect(e.renderSource).toBe("react-server-components")
    expect(e.env).toBe("production")
    expect(e.stack).toContain("Error: boom")
  })

  it("captura o `digest` que o Next anexa ao erro", () => {
    const err = Object.assign(new Error("x"), { digest: "3178174270" })
    expect(build({ error: err }).digest).toBe("3178174270")
  })
})

describe("B — mensagem VAZIA (a falha real do PostgREST)", () => {
  const vazio = build({ error: Object.assign(new Error(""), { digest: "42" }) })

  it("o evento continua válido e identificável sem a mensagem", () => {
    expect(vazio.errorMessage).toBe("")
    // A identidade do evento NÃO depende da mensagem.
    for (const campo of [vazio.event, vazio.errorName, vazio.routePath, vazio.routeType, vazio.digest]) {
      expect(campo).toBeTruthy()
    }
  })

  it("sobrevive à serialização — é uma linha JSON com o rótulo pesquisável", () => {
    const linha = JSON.stringify(vazio)
    expect(linha).toContain('"event":"server_error"')
    expect(linha).toContain('"routePath":"/catalog/[id]"')
    expect(JSON.parse(linha).digest).toBe("42")
  })

  it("erro que nem é Error ainda produz evento", () => {
    const e = build({ error: "string solta" })
    expect(e.event).toBe("server_error")
    expect(e.errorName).toBe("string")
    expect(e.routeType).toBe("render")
  })
})

describe("C — runtime LOCAL: sem variáveis da Fly", () => {
  it("os campos de plataforma são null, e não valor inventado", () => {
    const e = build({ env: { NODE_ENV: "development" } })
    expect(e.flyApp).toBeNull()
    expect(e.flyMachine).toBeNull()
    expect(e.flyRegion).toBeNull()
    expect(e.flyImage).toBeNull()
    expect(e.env).toBe("development")
    // O evento segue utilizável: rota e tipo continuam lá.
    expect(e.routePath).toBe("/catalog/[id]")
  })

  it("`commit` é null — LACUNA registrada: nada injeta SHA hoje", () => {
    expect(build().commit).toBeNull()
    expect(build({ env: { ...semFly, GIT_COMMIT_SHA: "abc1234" } }).commit).toBe("abc1234")
  })
})

describe("D — runtime FLY simulado", () => {
  it("app, machine, region e image entram", () => {
    const e = build({ env: comFly })
    expect(e.flyApp).toBe("satoria")
    expect(e.flyMachine).toBe("148e393c73d089")
    expect(e.flyRegion).toBe("gru")
    expect(e.flyImage).toBe("registry.fly.io/satoria:deployment-01K3")
  })
})

describe("E — privacidade: o que NÃO pode estar no evento", () => {
  /** Um contexto realista de request cheio de coisa que não pode vazar. */
  const venenoso = {
    error: Object.assign(
      new Error("falhou chamando https://x.supabase.co?apikey=eyJhbGciOiJIUzI1NiJ9.PAYLOAD.sig"),
      { digest: "9" },
    ),
    method: "POST",
    context: { ...CTX, routePath: "/my-list" },
  }

  it("segredo na MENSAGEM é redigido", () => {
    const linha = JSON.stringify(build(venenoso))
    expect(linha).toContain("[REDACTED]")
    expect(linha).not.toContain("eyJhbGciOiJIUzI1NiJ9")
  })

  it("segredo no STACK é redigido, e o stack preserva quebras de linha", () => {
    const err = new Error("x")
    err.stack = "Error: x\n    at f (a.ts:1)\n    Bearer abcd1234efghij\n    at g (b.ts:2)"
    const e = build({ error: err })
    expect(e.stack).toContain("[REDACTED]")
    expect(e.stack).not.toContain("abcd1234efghij")
    expect(e.stack!.split("\n").length).toBeGreaterThan(2)
  })

  it("NADA da request além do método entra — nem header, nem cookie, nem query", () => {
    const linha = JSON.stringify(build(venenoso))
    // Nada DERIVADO da request pode aparecer. O formatter só recebe `method` e o
    // `context` — headers, cookies e body nem chegam até ele, que é o que de fato
    // garante a ausência (o regex de redação é só rede de segurança).
    for (const proibido of [
      "cookie", "Cookie", "authorization", "Authorization", "Bearer",
      "set-cookie", "user-agent", "x-forwarded-for",
      "sb-access-token", "service_role", "@gmail.com",
    ]) {
      expect(linha).not.toContain(proibido)
    }
  })

  it("VALOR de query sensível é redigido mesmo sem formato de segredo conhecido", () => {
    // 🔴 O regex de segredo só pega forma conhecida (JWT, `sk-`, Bearer). Uma chave
    // opaca passava inteira dentro da URL que a mensagem de erro embute.
    const e = build({ error: new Error("GET https://x.co/rest?apikey=k9x2mqOPACA&id=7 falhou") })
    expect(e.errorMessage).toContain("apikey=[REDACTED]")
    expect(e.errorMessage).not.toContain("k9x2mqOPACA")
    // O que NÃO é sensível continua legível — senão a mensagem perde o diagnóstico.
    expect(e.errorMessage).toContain("id=7")
  })

  it("a rota vem do caminho LÓGICO, nunca da URL crua com query", () => {
    // `errorRequest.path` do Next carrega a query string; o formatter nem a recebe —
    // por isso a asserção é sobre o CAMPO, não sobre a ausência da string "?x=" no JSON
    // (a mensagem do erro pode legitimamente citar uma URL, já redigida).
    const e = build({ ...venenoso, context: { ...CTX, routePath: "/catalog/[id]" } })
    expect(e.routePath).toBe("/catalog/[id]")
    expect(e.routePath).not.toContain("?")
    expect(Object.keys(e)).not.toContain("path")
    expect(Object.keys(e)).not.toContain("headers")
  })

  it("as chaves do evento são exatamente as declaradas — nada entra de carona", () => {
    expect(Object.keys(build()).sort()).toEqual(
      [
        "commit", "digest", "env", "errorMessage", "errorName", "event", "flyApp", "flyImage",
        "flyMachine", "flyRegion", "method", "renderSource", "revalidateReason", "routePath",
        "routeType", "routerKind", "stack", "ts",
      ].sort(),
    )
  })

  it("stack gigante é truncado", () => {
    const err = new Error("x")
    err.stack = "L".repeat(5000)
    expect(build({ error: err }).stack!.length).toBeLessThanOrEqual(2000)
  })
})

describe("contexto ausente não derruba o formatter", () => {
  it("context null ainda produz evento", () => {
    const e = build({ context: null })
    expect(e.event).toBe("server_error")
    expect(e.routePath).toBeNull()
    expect(e.routeType).toBeNull()
  })
})

/**
 * O HANDLER, não só o formatter.
 *
 * 🔴 As asserções de privacidade acima afirmam a ausência de headers que o formatter NUNCA
 * recebe — elas passariam por VACUIDADE. Quem recebe a request de verdade é o hook, então é
 * ele que precisa ser alimentado com uma request venenosa e provar que não a propaga.
 */
describe("onRequestError — o hook do Next", () => {
  const REQUEST_VENENOSA = {
    path: "/my-list?q=segredo&apikey=k9x2mqOPACA",
    method: "POST",
    headers: {
      cookie: "sb-access-token=eyJhbGciOiJIUzI1NiJ9.PAYLOAD.sig; theme=dark",
      authorization: "Bearer abcd1234efghij",
      "user-agent": "Mozilla/5.0",
      "x-forwarded-for": "203.0.113.7",
      "x-usuario": "leitor@exemplo.test",
    },
  }

  async function capturar(error: unknown, context: unknown) {
    const { onRequestError } = await import("@/instrumentation")
    const linhas: string[] = []
    const spy = vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => void linhas.push(a.join(" ")))
    await onRequestError!(error, REQUEST_VENENOSA as never, context as never)
    spy.mockRestore()
    return linhas
  }

  it("emite UMA linha JSON com o rótulo pesquisável", async () => {
    const linhas = await capturar(new Error("boom"), CTX)
    expect(linhas).toHaveLength(1)
    const e = JSON.parse(linhas[0])
    expect(e.event).toBe("server_error")
    expect(e.routeType).toBe("render")
    expect(e.method).toBe("POST")
  })

  it("NÃO propaga nada da request venenosa — nem path, nem header, nem cookie", async () => {
    const linha = (await capturar(new Error("boom"), CTX))[0]
    for (const proibido of [
      "sb-access-token", "eyJhbGciOiJIUzI1NiJ9", "abcd1234efghij", "Mozilla",
      "203.0.113.7", "leitor@exemplo.test", "k9x2mqOPACA", "q=segredo",
      "cookie", "authorization", "user-agent", "x-forwarded-for",
    ]) {
      expect(linha).not.toContain(proibido)
    }
    // E o path CRU da request (com query) não vira a rota do evento.
    expect(JSON.parse(linha).routePath).toBe("/catalog/[id]")
  })

  it("hook não estoura com contexto/erro degenerados — ele não pode virar a 2ª falha", async () => {
    for (const [err, ctx] of [[null, null], [undefined, CTX], ["str", {}]] as const) {
      const linhas = await capturar(err, ctx)
      expect(linhas).toHaveLength(1)
      expect(JSON.parse(linhas[0]).event).toBe("server_error")
    }
  })
})

/**
 * Segredo dentro do PRÓPRIO Error — não da request.
 *
 * 🔴 Provar que a request não é serializada NÃO prova isto: o mesmo valor que aparece em
 * `error.message` reaparece na 1ª linha de `error.stack`, então sanear só a mensagem deixaria
 * o segredo no evento — e no campo que ninguém confere, porque o outro parece limpo.
 *
 * ⚠️ As quatro últimas formas foram MEDIDAS vazando em 2026-08-23, antes deste bloco existir:
 * `apikey=` sem `?`, `service_role=`, `SUPABASE_SERVICE_ROLE_KEY=` e `senha=` (o repo é pt-BR).
 */
describe("segredo DENTRO do Error — mensagem e stack", () => {
  /** Valores opacos: nenhum tem forma reconhecível, então só o nome ao lado os denuncia. */
  const VALORES = [
    "tok_abcd1234efgh", "eyJhbGciOiJIUzI1NiJ9", "SIGSIGSIG",
    "OPACA_APIKEY_SEM_QUERY", "OPACA_APIKEY_EM_QUERY", "OPACA_ROLE",
    "OPACA_ROLE_ENVVAR", "OPACA_SENHA", "OPACA_SECRET",
    "tok_zzzz9999yyyy", "OPACA_ROLE_NO_STACK", "leitor@exemplo.test",
  ]

  function erroVenenoso() {
    const err = new Error(
      "Authorization: Bearer tok_abcd1234efgh; " +
        "jwt=eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.SIGSIGSIG; " +
        "apikey=OPACA_APIKEY_SEM_QUERY https://x.co/r?apikey=OPACA_APIKEY_EM_QUERY " +
        "service_role=OPACA_ROLE SUPABASE_SERVICE_ROLE_KEY=OPACA_ROLE_ENVVAR " +
        "senha=OPACA_SENHA secret=OPACA_SECRET user=leitor@exemplo.test status=500",
    )
    err.stack =
      `Error: ${err.message}\n` +
      "    at f (/app/.next/server/chunks/x.js:1:2)\n" +
      "    ctx: Bearer tok_zzzz9999yyyy | leitor@exemplo.test | service_role=OPACA_ROLE_NO_STACK\n" +
      "    at g (/app/.next/server/chunks/y.js:3:4)"
    return err
  }

  const evento = () => buildServerErrorEvent({ error: erroVenenoso(), method: "GET", context: CTX, env: semFly, now: "2026-08-23T12:00:00.000Z" })

  it("NENHUM valor secreto sobrevive em campo NENHUM do JSON", () => {
    const linha = JSON.stringify(evento())
    for (const v of VALORES) expect(linha).not.toContain(v)
  })

  it("o STACK especificamente está limpo — é o campo que a mensagem esconde", () => {
    const stack = evento().stack!
    for (const v of VALORES) expect(stack).not.toContain(v)
    expect(stack).toContain("[REDACTED]")
    // Ele continua sendo um stack: quebras e frames preservados.
    expect(stack.split("\n").length).toBeGreaterThanOrEqual(4)
    expect(stack).toContain("chunks/x.js:1:2")
  })

  it("o NOME da categoria fica — redigir não pode apagar o diagnóstico", () => {
    const m = evento().errorMessage
    expect(m).toContain("apikey=[REDACTED]")
    expect(m).toContain("senha=[REDACTED]")
    // O que não é sensível permanece legível.
    expect(m).toContain("status=500")
  })

  it("o JSON continua válido e parseável depois de tudo", () => {
    const e = JSON.parse(JSON.stringify(evento()))
    expect(e.event).toBe("server_error")
    expect(e.routeType).toBe("render")
    expect(typeof e.stack).toBe("string")
  })
})

describe("limites de tamanho", () => {
  const grande = (n: number) => "L".repeat(n)

  it("abaixo do limite, o conteúdo permanece inteiro", () => {
    const err = new Error(grande(400))
    err.stack = grande(1500)
    const e = buildServerErrorEvent({ error: err, context: CTX })
    expect(e.errorMessage).toHaveLength(400)
    expect(e.stack).toHaveLength(1500)
    expect(e.errorMessage.endsWith("…")).toBe(false)
  })

  it("muito acima do limite, trunca: mensagem 500, stack 2000", () => {
    const err = new Error(grande(50_000))
    err.stack = grande(200_000)
    const e = buildServerErrorEvent({ error: err, context: CTX })
    expect(e.errorMessage).toHaveLength(500)
    expect(e.stack).toHaveLength(2000)
    expect(e.errorMessage.endsWith("…")).toBe(true)
    expect(e.stack!.endsWith("…")).toBe(true)
  })

  it("truncar NÃO reintroduz segredo — a redação vem antes do corte", () => {
    // O segredo fica no COMEÇO, ou seja dentro da janela que sobrevive ao corte.
    const err = new Error(`apikey=OPACA_NO_COMECO ${grande(50_000)}`)
    err.stack = `Bearer tok_abcd1234efgh\n${grande(200_000)}`
    const e = buildServerErrorEvent({ error: err, context: CTX })
    expect(JSON.stringify(e)).not.toContain("OPACA_NO_COMECO")
    expect(JSON.stringify(e)).not.toContain("tok_abcd1234efgh")
    expect(e.stack).toContain("[REDACTED]")
  })

  it("mesmo truncado, o JSON continua válido", () => {
    const err = new Error(grande(50_000))
    err.stack = grande(200_000)
    const linha = JSON.stringify(buildServerErrorEvent({ error: err, context: CTX }))
    expect(() => JSON.parse(linha)).not.toThrow()
    expect(linha.length).toBeLessThan(4000)
  })
})

describe("o redator não pode virar a próxima falha", () => {
  it("entrada gigante é limitada ANTES do regex", async () => {
    const { redactSecrets } = await import("@/lib/observability/redact")
    // 🔴 Guarda de regressão do backtracking: sem o teto, 200 mil caracteres levavam 21s.
    // A asserção é sobre o TETO (determinística), não sobre tempo (que seria instável).
    expect(redactSecrets("L".repeat(200_000)).length).toBeLessThanOrEqual(8000)
    expect(redactSecrets("ok").length).toBe(2)
  })
})
