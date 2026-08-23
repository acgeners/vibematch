/**
 * O erro que a APLICAÇÃO capturou e absorveu — o ponto cego que `onRequestError` declara não
 * cobrir, e que a A3.2 mediu: com `getPublicShowcase` devolvendo `null`, o hook do Next não
 * dispara e a página responde 200. A UI degrada certo desde a A3.4; o que faltava era o sinal.
 *
 * 🔴 O evento tem rótulo PRÓPRIO. "A requisição quebrou" e "uma fonte caiu e a aplicação seguiu
 * de pé" são fatos de gravidade diferente; um rótulo só apagaria justo a distinção que decide
 * se alguém precisa acordar.
 */
import { describe, it, expect, vi } from "vitest"
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { dirname, join, relative } from "node:path"
import { fileURLToPath } from "node:url"
import {
  buildHandledServerErrorEvent,
  reportHandledServerError,
} from "@/lib/observability/handled-error"
import { mensagemDoErro } from "@/lib/observability/event-fields"
import { buildServerErrorEvent } from "@/lib/observability/server-error-event"

/**
 * As varreduras de arquitetura deste arquivo leem o FILESYSTEM.
 *
 * 🔴 A 1ª versão usava `git grep`, e a troca não é cosmética. Aquele enxerga o ÍNDICE do git:
 * arquivo ainda não `git add`-ado escapa da varredura — e foi exatamente assim que uma
 * checagem deste mesmo gate passou VERDE sobre um arquivo novo, até um `git add -N` revelá-la.
 * Além disso ele dependia de `.git`, do worktree e de um binário externo, nenhum dos quais é
 * o objeto do teste. O que a regra afirma é sobre o CÓDIGO QUE VAI RODAR, e o que roda é o
 * que está no disco.
 *
 * ⚠️ A raiz sai do caminho DESTE arquivo, nunca de `process.cwd()`: cwd depende de onde o
 * runner foi invocado, e a âncora precisa ser o repositório.
 */
const RAIZ = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))))
const IGNORAR = new Set(["node_modules", ".next", ".git", ".turbo", "dist", ".backups", ".cache"])

type Fonte = { caminho: string; texto: string }

/** Todo `.ts`/`.tsx`/`.mjs`/`.js` sob os alvos, com o conteúdo atual do disco. */
function fontes(alvos: string[]): Fonte[] {
  const achados: Fonte[] = []
  const ler = (abs: string) => achados.push({ caminho: relative(RAIZ, abs), texto: readFileSync(abs, "utf8") })
  const descer = (abs: string) => {
    for (const nome of readdirSync(abs)) {
      if (IGNORAR.has(nome)) continue
      const filho = join(abs, nome)
      if (statSync(filho).isDirectory()) descer(filho)
      else if (/\.(ts|tsx|mjs|js)$/.test(nome)) ler(filho)
    }
  }
  for (const alvo of alvos) {
    const abs = join(RAIZ, alvo)
    if (!existsSync(abs)) continue
    statSync(abs).isDirectory() ? descer(abs) : ler(abs)
  }
  return achados
}

/** Os fontes de produção — o universo de toda regra abaixo. */
const PRODUCAO = fontes(["lib", "server", "app", "components", "instrumentation.ts"])

const semFly: Record<string, string | undefined> = { NODE_ENV: "production" }
const comFly: Record<string, string | undefined> = {
  NODE_ENV: "production",
  FLY_APP_NAME: "satoria",
  FLY_MACHINE_ID: "148e393c73d089",
  FLY_REGION: "gru",
  FLY_IMAGE_REF: "registry.fly.io/satoria:deployment-01K3",
}

const build = (over: Partial<Parameters<typeof buildHandledServerErrorEvent>[0]> = {}) =>
  buildHandledServerErrorEvent({
    operation: "public-showcase.getPublicShowcase",
    error: new Error("boom"),
    env: semFly,
    now: "2026-08-23T12:00:00.000Z",
    ...over,
  })

/**
 * A forma REAL do erro do supabase-js, MEDIDA na 2.105.1 contra o Supabase local: OBJETO PLANO,
 * `instanceof Error` FALSO, sem `name` e sem `stack`. É ela que percorre os quatro callsites.
 *
 * ⚠️ Este helper já foi `Object.assign(new Error(...))`, e estava errado: a classe
 * `PostgrestError` existe e É `Error`, mas o cliente NÃO a usa neste caminho. Quem desmentiu
 * foi o runtime probe — a suíte estava verde afirmando o contrário.
 */
const postgrestReal = (message: string, extra: Record<string, unknown> = {}) =>
  ({ message, details: null, hint: null, ...extra }) as unknown

describe("A — Error normal", () => {
  it("o evento é parseável e traz identidade, operação e runtime", () => {
    const e = build()
    expect(e.event).toBe("handled_server_error")
    expect(e.ts).toBe("2026-08-23T12:00:00.000Z")
    expect(e.operation).toBe("public-showcase.getPublicShowcase")
    expect(e.errorName).toBe("Error")
    expect(e.errorMessage).toBe("boom")
    expect(e.stack).toContain("Error: boom")
    expect(e.env).toBe("production")
    expect(JSON.parse(JSON.stringify(e)).operation).toBe("public-showcase.getPublicShowcase")
  })
})

describe("B — erro do PostgREST (objeto PLANO, a forma de runtime)", () => {
  /**
   * 🔴 A REGRESSÃO que o runtime probe pegou com a suíte inteira VERDE: o evento saía
   * `errorMessage: "[object Object]"` — cego justo na classe que ele existe para cobrir.
   * `sanitizeErrorMessage` faz `String(err)` no não-Error, e o cliente nunca manda um Error.
   */
  it("a MENSAGEM entra — nada de \"[object Object]\"", () => {
    const e = build({ error: postgrestReal('relation "public.works" does not exist', { code: "42P01" }) })
    expect(e.errorMessage).toBe('relation "public.works" does not exist')
    expect(e.errorMessage).not.toContain("[object Object]")
  })

  it("sem `name` e sem `stack`, o evento continua identificável pela operação", () => {
    const e = build({ error: postgrestReal("x") })
    expect(e.stack).toBeNull()
    expect(e.errorName).toBe("object")
    expect(e.operation).toBe("public-showcase.getPublicShowcase")
  })

  it("code/details/hint NÃO entram — ausência de COLETA, não redação", () => {
    const linha = JSON.stringify(
      build({ error: postgrestReal("x", { code: "42703", details: "d-interno", hint: "h-interno" }) }),
    )
    expect(() => JSON.parse(linha)).not.toThrow()
    for (const cru of ["42703", "d-interno", "h-interno"]) expect(linha).not.toContain(cru)
  })

  it("`message` que NÃO é string não vira objeto cru no evento", () => {
    const linha = JSON.stringify(build({ error: { message: { interno: "vaza?" }, code: "x" } }))
    expect(linha).not.toContain("vaza?")
    expect(JSON.parse(linha).operation).toBe("public-showcase.getPublicShowcase")
  })
})

describe("C — mensagem vazia (a falha real do PostgREST)", () => {
  it("o evento continua útil: quem identifica é `operation`, não a mensagem", () => {
    // A forma medida com chave de service inválida: `{message:""}`, sem code/details/hint.
    const e = build({ error: { message: "" }, operation: "site-stats.count.works" })
    expect(e.errorMessage).toBe("")
    expect(e.operation).toBe("site-stats.count.works")
    expect(e.event).toBe("handled_server_error")
  })

  it("erro que nem é Error ainda produz evento", () => {
    for (const [erro, nome] of [[null, "NonError"], [undefined, "NonError"], ["x", "string"], [42, "number"]] as const) {
      const e = build({ error: erro })
      expect(e.errorName).toBe(nome)
      expect(e.operation).toBeTruthy()
    }
  })
})

describe("D — segredo DENTRO do erro", () => {
  const VENENOSO = () => {
    const e = new Error(
      "apikey=OPACA_APIKEY service_role=OPACA_ROLE SUPABASE_SERVICE_ROLE_KEY=OPACA_KEY " +
        "senha=OPACA_SENHA jwt=eyJhbGciOiJIUzI1NiJ9.PAYLOAD.SIG user=leitor@exemplo.test",
    )
    e.stack = `Error: ${e.message}\n    at auth (Bearer abcd1234efghij)\n    at db (sk-abcdefgh12345678)`
    return e
  }
  const PROIBIDOS = [
    "OPACA_APIKEY", "OPACA_ROLE", "OPACA_KEY", "OPACA_SENHA", "eyJhbGciOiJIUzI1NiJ9",
    "PAYLOAD", "leitor@exemplo.test", "abcd1234efghij", "sk-abcdefgh12345678",
  ]

  it("NENHUM valor secreto sobrevive em campo NENHUM do JSON", () => {
    const linha = JSON.stringify(build({ error: VENENOSO(), env: comFly }))
    for (const p of PROIBIDOS) expect(linha).not.toContain(p)
  })

  it("o STACK especificamente está limpo — é o campo que a mensagem esconde", () => {
    const stack = build({ error: VENENOSO() }).stack!
    for (const p of ["abcd1234efghij", "sk-abcdefgh12345678", "OPACA_APIKEY"]) {
      expect(stack).not.toContain(p)
    }
    // Redigir não pode apagar o diagnóstico: a estrutura do stack fica.
    expect(stack).toContain("at auth")
  })

  it("o NOME da categoria fica — `apikey=[REDACTED]` ainda diz o que aconteceu", () => {
    const e = build({ error: VENENOSO() })
    expect(e.errorMessage).toContain("[REDACTED]")
    expect(e.errorMessage).toContain("apikey")
  })

  /**
   * 🔴 O caminho que de fato roda: segredo dentro da `message` de um objeto PLANO. Redigir só
   * o `Error` deixaria a extração nova como um bypass da sanitização — a porta que o gate abriu.
   */
  it("segredo na message do objeto PLANO também é redigido", () => {
    const e = build({
      error: { message: "apikey=OPACA_APIKEY jwt=eyJhbGciOiJIUzI1NiJ9.PAYLOAD.SIG leitor@exemplo.test", code: "x" },
    })
    for (const p of ["OPACA_APIKEY", "eyJhbGciOiJIUzI1NiJ9", "leitor@exemplo.test"]) {
      expect(e.errorMessage).not.toContain(p)
    }
    expect(e.errorMessage).toContain("[REDACTED]")
  })

  it("stack gigante é truncado no MESMO teto do `server_error`", () => {
    const err = new Error("x")
    err.stack = "L".repeat(9000)
    expect(build({ error: err }).stack!.length).toBeLessThanOrEqual(2000)
    expect(buildServerErrorEvent({ error: err, context: null, env: semFly }).stack!.length)
      .toBe(build({ error: err }).stack!.length)
  })
})

describe("E — runtime LOCAL: sem variáveis da Fly", () => {
  it("os campos de plataforma são null, e não valor inventado", () => {
    const e = build({ env: semFly })
    expect(e.flyApp).toBeNull()
    expect(e.flyMachine).toBeNull()
    expect(e.flyRegion).toBeNull()
    expect(e.flyImage).toBeNull()
    expect(e.commit).toBeNull()
    expect(e.env).toBe("production")
  })
})

describe("F — runtime FLY simulado", () => {
  it("app, machine, region e image entram", () => {
    const e = build({ env: comFly })
    expect(e.flyApp).toBe("satoria")
    expect(e.flyMachine).toBe("148e393c73d089")
    expect(e.flyRegion).toBe("gru")
    expect(e.flyImage).toBe("registry.fly.io/satoria:deployment-01K3")
  })
})

describe("G — `operation` é a identidade deste evento", () => {
  it("está presente e é exatamente o que o callsite passou", () => {
    for (const op of [
      "site-stats.count.works", "site-stats.count.category_scores",
      "site-stats.count.work_reviews", "site-stats.count.source",
      "auth-hero.getAuthHeroWorks",
      "public-showcase.getSpotlightWork", "public-showcase.getPublicShowcase",
    ]) {
      expect(build({ operation: op }).operation).toBe(op)
    }
  })

  it("sobrevive ao erro mais degenerado — é o único campo que não depende dele", () => {
    expect(build({ error: null, operation: "site-stats.count.source" }).operation)
      .toBe("site-stats.count.source")
  })
})

describe("o que NÃO é inventado", () => {
  /**
   * 🔴 Onde a aplicação captura o erro não existe rota, método nem digest — quem captura é uma
   * função de consulta, que não conhece a requisição. Preencher esses campos exigiria
   * `headers()` só para enfeitar telemetria, ou empurrar a rota à mão pela árvore. Rota errada
   * num log é PIOR que rota ausente, porque é lida como fato.
   */
  it("as chaves são exatamente as declaradas — nada entra de carona", () => {
    expect(Object.keys(build()).sort()).toEqual(
      [
        "commit", "env", "errorMessage", "errorName", "event", "flyApp", "flyImage",
        "flyMachine", "flyRegion", "operation", "stack", "ts",
      ].sort(),
    )
  })

  it("não há campo de requisição fingido", () => {
    const chaves = Object.keys(build())
    for (const inventado of ["routePath", "routeType", "renderSource", "method", "digest", "routerKind", "headers", "cookies", "url"]) {
      expect(chaves).not.toContain(inventado)
    }
  })
})

describe("o reporter EMITE — e não pode virar a próxima falha", () => {
  function capturar(fn: () => void) {
    const linhas: string[] = []
    const spy = vi.spyOn(console, "error").mockImplementation((...a: unknown[]) =>
      void linhas.push(a.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" ")),
    )
    try { fn() } finally { spy.mockRestore() }
    return linhas
  }

  it("UMA linha JSON, filtrável pelo rótulo", () => {
    const linhas = capturar(() =>
      reportHandledServerError({ operation: "public-showcase.getSpotlightWork", error: new Error("boom") }),
    )
    expect(linhas).toHaveLength(1)
    expect(linhas[0]).toContain('"event":"handled_server_error"')
    const e = JSON.parse(linhas[0])
    expect(e.operation).toBe("public-showcase.getSpotlightWork")
    expect(e.errorName).toBe("Error")
  })

  it("erro NÃO serializável ainda produz linha reconhecível, com a operação", () => {
    const ciclico: Record<string, unknown> = { message: "x" }
    ciclico.self = ciclico
    // Um getter que estoura na serialização: o pior caso do `JSON.stringify`.
    const bomba = new Error("b")
    Object.defineProperty(bomba, "stack", { get() { throw new Error("stack explodiu") } })
    for (const erro of [ciclico, bomba]) {
      const linhas = capturar(() => reportHandledServerError({ operation: "site-stats.count.works", error: erro }))
      expect(linhas).toHaveLength(1)
      const e = JSON.parse(linhas[0])
      expect(e.event).toBe("handled_server_error")
      expect(e.operation).toBe("site-stats.count.works")
    }
  })
})

describe("A3.2 não sofre drift — os dois eventos são distinguíveis e concordam sobre o runtime", () => {
  const erro = new Error("boom")
  const tratado = build({ error: erro, env: comFly })
  const naoTratado = buildServerErrorEvent({
    error: erro,
    context: { routePath: "/catalog", routeType: "render" } as never,
    env: comFly,
    now: "2026-08-23T12:00:00.000Z",
  })

  it("o rótulo `event` é o que os separa", () => {
    expect(naoTratado.event).toBe("server_error")
    expect(tratado.event).toBe("handled_server_error")
    expect(naoTratado.event).not.toBe(tratado.event)
  })

  it("`server_error` MANTÉM os campos de requisição que só ele tem", () => {
    // 🔴 Introduzir o 2º evento não pode virar redesenho do 1º: se alguém "unificar" os dois,
    // é aqui que aparece — o `server_error` perderia justo o que o torna acionável.
    for (const campo of ["digest", "method", "routerKind", "routePath", "routeType", "renderSource", "revalidateReason"]) {
      expect(Object.keys(naoTratado)).toContain(campo)
    }
    expect(naoTratado.routePath).toBe("/catalog")
    expect(naoTratado.routeType).toBe("render")
  })

  it("os campos COMPARTILHADOS saem do mesmo dono — mesmo erro e mesmo env, mesmos valores", () => {
    for (const campo of ["errorName", "errorMessage", "stack", "env", "flyApp", "flyMachine", "flyRegion", "flyImage", "commit"] as const) {
      expect(tratado[campo]).toEqual(naoTratado[campo as keyof typeof naoTratado])
    }
  })

  /**
   * ⚠️ A ÚNICA divergência deliberada, e ela tem motivo medido: sobre objeto PLANO o evento
   * tratado EXTRAI `.message` e o `server_error` não. As fontes são diferentes — um recebe erro
   * LANÇADO (Error de verdade), o outro recebe o que o supabase-js DEVOLVE (objeto plano).
   * Alinhar os dois exigiria mexer no evento existente, que é o que este gate não faz.
   */
  it("sobre objeto PLANO os dois divergem — de propósito, e só na EXTRAÇÃO", () => {
    const plano = { message: "column x does not exist", code: "42703" }
    const t = build({ error: plano })
    const n = buildServerErrorEvent({ error: plano, context: null, env: semFly })
    expect(t.errorMessage).toBe("column x does not exist")
    expect(n.errorMessage).toBe("[object Object]")
    // A SANITIZAÇÃO, que é o que a segurança exige compartilhada, continua a mesma nos dois.
    expect(t.errorName).toBe(n.errorName)
    expect(t.stack).toBe(n.stack)
  })
})

describe("error: unknown — a observabilidade não pode virar a exceção que o catch evitou", () => {
  /**
   * 🔴 O requisito é de SEGURANÇA do caminho de degradação, não de formato do evento. Cada um
   * destes quatro callsites está DENTRO de um `if (error)` que existe para a página continuar
   * de pé: se o reporter lançar porque o valor capturado não tem cara de `Error`, ele converte
   * uma degradação que funcionava numa falha de render — e a página que a A3.4 salvou volta a
   * cair, agora por causa do instrumento que veio observá-la.
   *
   * ⚠️ Exercita `reportHandledServerError`, não o builder: é a função que os callsites chamam,
   * e é ela que precisa não lançar. Um teste do builder deixaria de fora o `JSON.stringify` e
   * o `console.error`, que é onde as formas degeneradas de fato explodem.
   */
  const FORMAS: Array<[string, unknown]> = [
    ["Error normal", new Error("x")],
    ["objeto PostgREST plano", { message: "x", code: "42P01", details: null, hint: null }],
    ["objeto com message vazia", { message: "" }],
    ["objeto SEM message", { code: "42P01", details: "d", hint: "h" }],
    ["string", "explodiu"],
    ["null", null],
    ["undefined", undefined],
  ]

  function emitir(error: unknown) {
    const linhas: string[] = []
    const spy = vi.spyOn(console, "error").mockImplementation((...a: unknown[]) =>
      void linhas.push(a.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" ")),
    )
    try {
      reportHandledServerError({ operation: "public-showcase.getPublicShowcase", error })
    } finally {
      spy.mockRestore()
    }
    return linhas
  }

  it.each(FORMAS)("%s: não lança, e emite UM evento identificável", (_rotulo, error) => {
    let linhas: string[] = []
    expect(() => { linhas = emitir(error) }).not.toThrow()
    expect(linhas).toHaveLength(1)
    const e = JSON.parse(linhas[0])
    expect(e.event).toBe("handled_server_error")
    expect(e.operation).toBe("public-showcase.getPublicShowcase")
    expect(typeof e.errorMessage).toBe("string")
  })

  it.each(FORMAS)("%s: a extração de mensagem também não lança", (_rotulo, error) => {
    expect(() => mensagemDoErro(error)).not.toThrow()
    expect(typeof mensagemDoErro(error)).toBe("string")
  })

  /**
   * ⚠️ Objeto SEM `message` degrada para o `String(error)` herdado — `"[object Object]"`. Não é
   * bom, e é o desfecho CERTO: inventar mensagem a partir de `code`/`details`/`hint` seria
   * normalização nova, e nenhum deles é coletado por decisão deste gate.
   */
  it("objeto sem message não vira normalização inventada de code/details/hint", () => {
    const linha = JSON.stringify(
      buildHandledServerErrorEvent({ operation: "site-stats.count.works", error: { code: "42P01", details: "d-interno", hint: "h-interno" } }),
    )
    for (const cru of ["42P01", "d-interno", "h-interno"]) expect(linha).not.toContain(cru)
  })
})

describe("os pontos ligados ao reporter são só os quatro autorizados", () => {
  /**
   * A3.5 liga o reporter a QUATRO pontos: as contagens de `getSiteStats`, `getAuthHeroWorks`,
   * `getSpotlightWork` e `getPublicShowcase`. Os 26 catches de Server Action e os Route
   * Handlers ficam de fora do gate — e nada no código impede alguém de acrescentá-los sem
   * decidir nada, que é o que esta regra guarda.
   */
  const EMISSORES_AUTORIZADOS = ["server/queries/auth-hero.ts", "server/queries/public-showcase.ts"]

  /**
   * As sete operações, uma por consulta INDEPENDENTE. `getSiteStats` tem quatro porque dispara
   * quatro contagens que falham em separado — colapsá-las num rótulo só apagaria a única
   * pergunta acionável ali ("qual das quatro caiu?").
   */
  const OPERACOES = [
    "site-stats.count.works",
    "site-stats.count.category_scores",
    "site-stats.count.work_reviews",
    "site-stats.count.source",
    "auth-hero.getAuthHeroWorks",
    "public-showcase.getSpotlightWork",
    "public-showcase.getPublicShowcase",
  ]

  it("só os arquivos autorizados emitem", () => {
    const emissores = PRODUCAO.filter(
      (f) => /reportHandledServerError\s*\(/.test(f.texto) && f.caminho !== "lib/observability/handled-error.ts",
    ).map((f) => f.caminho).sort()
    expect(emissores).toEqual([...EMISSORES_AUTORIZADOS].sort())
  })

  /**
   * 🔴 Casa o FATO da interpolação, não a grafia. A 1ª versão do callsite de `site-stats` fazia
   * `\`site-stats.count.${tabela}\``: a string que saía no log NÃO existia em lugar nenhum do
   * código, então quem lesse `site-stats.count.works` num incidente não achava o callsite por
   * grep — que é justamente o que o campo existe para permitir.
   */
  it("nenhuma operação é montada por interpolação", () => {
    const interpoladas = PRODUCAO.flatMap((f) =>
      [...f.texto.matchAll(/operation:\s*`[^`]*\$\{/g)].map(() => f.caminho),
    )
    expect(interpoladas).toEqual([])
  })

  it.each(OPERACOES)("%s existe como literal no source — é greppável a partir do log", (op) => {
    const onde = PRODUCAO.filter((f) => f.texto.includes(`"${op}"`)).map((f) => f.caminho)
    expect(onde.length).toBeGreaterThan(0)
  })
})

describe("o runtime tem UM dono — a duplicação que a suíte não vê", () => {
  /**
   * 🔴 Esta rede nasceu de um defeito REAL desta sessão: uma sonda desfez o reuso do helper com
   * um `git checkout`, a duplicação de `FLY_*` voltou aos dois construtores, e a suíte inteira
   * seguiu VERDE — porque o comportamento é idêntico. Só o `git diff` denunciou.
   *
   * O que se perde com a duplicação não é o resultado de hoje: é a garantia de que os dois
   * eventos continuem concordando sobre o MESMO processo. Duas leituras podem divergir amanhã,
   * e a que divergir será a que ninguém confere.
   *
   * ⚠️ Deriva do filesystem, nunca de uma lista de nomes: o evento que alguém acrescentar
   * amanhã cai na regra sozinho.
   */
  const ENVS_DE_PLATAFORMA = ["FLY_APP_NAME", "FLY_MACHINE_ID", "FLY_REGION", "FLY_IMAGE_REF", "GIT_COMMIT_SHA"]
  const DONO = "lib/observability/event-fields.ts"

  it.each(ENVS_DE_PLATAFORMA)("%s é lido num lugar só", (chave) => {
    // O comentário do próprio dono cita as chaves para explicar a regra — casar o FATO é casar
    // a LEITURA (`env.CHAVE`), não a menção.
    const leitores = PRODUCAO.filter((f) => new RegExp(String.raw`env\.${chave}\b`).test(f.texto))
    expect(leitores.map((f) => f.caminho)).toEqual([DONO])
  })

  it("o teto do stack também tem um dono só", () => {
    const declaradores = PRODUCAO.filter((f) => /STACK_MAX\s*=\s*[0-9]/.test(f.texto))
    expect(declaradores.map((f) => f.caminho)).toEqual([DONO])
  })
})

describe("uma captura, UM sinal", () => {
  /**
   * 🔴 O log mínimo não pode conviver com o evento: duas linhas para a mesma captura fazem
   * qualquer contagem por operação mentir, e é ela que diz se o problema é recorrente.
   *
   * ⚠️ Derivado do git, não de uma lista de nomes: o arquivo que alguém migrar amanhã cai na
   * regra sozinho. Lista fixa não acha o callsite novo.
   */
  const arquivos = PRODUCAO.filter(
    (f) => f.texto.includes("reportHandledServerError") && f.caminho !== "lib/observability/handled-error.ts",
  ).map((f) => f.caminho)

  it("há callsites migrados (senão esta regra passaria por vacuidade)", () => {
    expect(arquivos.length).toBeGreaterThanOrEqual(2)
  })

  it.each(arquivos)("%s não emite console.* ao lado do evento", (arquivo) => {
    const fonte = readFileSync(arquivo, "utf8")
    expect(fonte).not.toMatch(/console\.(error|warn|log|info)\s*\(/)
  })

  /**
   * ⚠️ Casa o FATO — o prefixo dentro de uma CHAMADA de console —, nunca a grafia. A 1ª versão
   * procurava o prefixo em qualquer lugar do source e reprovou acusando a própria docstring do
   * reporter, que o CITA para explicar o que substituiu. Teste que se satisfaz apagando um
   * comentário protege a grafia, não o comportamento.
   */
  it("nenhum log mínimo dos quatro callsites ainda é EMITIDO", () => {
    const emissoes = PRODUCAO.filter((f) =>
      /console\.[a-z]+\([^)]*\[(site-stats|auth-hero|public-showcase)\]/.test(f.texto),
    ).map((f) => f.caminho)
    expect(emissoes).toEqual([])
  })
})
