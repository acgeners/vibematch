import "server-only"
import { mensagemDoErro, nomeDoErro, runtimeFields, stackSanitizado } from "@/lib/observability/event-fields"

/**
 * O erro que a APLICAÇÃO capturou, decidiu absorver, e por isso nunca chega ao framework.
 *
 * 🔴 `onRequestError` (A3.2) cobre o que o Next captura — render, Route Handler e Server Action
 * que LANÇAM. Medido em 2026-08-23: quando `getPublicShowcase` pega o erro do PostgREST e
 * devolve `null`, o hook NÃO dispara (`server_error` = 0) e a página responde 200. A UI já
 * degrada corretamente desde a A3.4; o que faltava era o sinal. É essa lacuna que este evento
 * fecha — e só ela.
 *
 * 🔴 Evento SEPARADO de `server_error`, nunca o mesmo rótulo. Os dois fatos têm gravidade
 * diferente: "a requisição quebrou e o usuário viu uma tela de erro" × "uma fonte caiu, a
 * aplicação degradou de propósito e a página seguiu de pé". Colapsá-los num rótulo só apagaria
 * justo a distinção que decide se alguém precisa acordar.
 *
 * ⚠️ Só para falha INESPERADA. Validação, input inválido, autenticação/permissão esperada,
 * conflito de domínio, "não encontrado" legítimo e todo `{ error }` previsto de Server Action
 * ficam FORA: são desfechos do produto, não defeitos. Um evento que toca em ambos vira o alarme
 * que sempre toca, e alarme que sempre toca não é lido.
 */
export type HandledServerErrorEvent = {
  ts: string
  event: "handled_server_error"
  /**
   * QUEM falhou, no vocabulário do código — `public-showcase.getPublicShowcase`.
   *
   * 🔴 É o campo de identidade deste evento, e o motivo é estrutural: sem `routePath`, sem
   * `routeType` e sem `digest` (nada disso existe onde a aplicação captura o erro), `operation`
   * é a única coisa que diz o que quebrou. A A3.1 mediu falha do PostgREST chegando como
   * `{"message":""}`, então depender da mensagem seria nascer cego nessa classe inteira.
   *
   * ⚠️ Vem SEMPRE de literal do código, nunca de entrada do usuário: é isso que o mantém
   * seguro para log e estável para agregação.
   */
  operation: string
  errorName: string
  errorMessage: string
  stack: string | null
  env: string | null
  flyApp: string | null
  flyMachine: string | null
  flyRegion: string | null
  flyImage: string | null
  commit: string | null
}

/**
 * ⚠️ O que NÃO entra, e a ausência é deliberada: `routePath`, `routeType`, `renderSource`,
 * `method` e `digest`. Nenhum deles existe neste ponto — quem captura é uma função de consulta,
 * que não conhece a requisição. Alcançá-los exigiria `headers()`/`cookies()` só para enfeitar
 * telemetria, ou empurrar a rota à mão por toda a árvore de componentes. Evento honesto com
 * `operation` vale mais que campo inventado: rota errada num log é pior que rota ausente,
 * porque ela é lida como fato.
 */
export function buildHandledServerErrorEvent(input: {
  operation: string
  error: unknown
  /** Injetado nos testes; em runtime é o `process.env`. */
  env?: Record<string, string | undefined>
  /** Injetado nos testes para o carimbo ser determinístico. */
  now?: string
}): HandledServerErrorEvent {
  const env = input.env ?? process.env
  return {
    ts: input.now ?? new Date().toISOString(),
    event: "handled_server_error",
    operation: input.operation,
    // Sanitização pelos MESMOS donos do `server_error`: uma 2ª régua de redação é como o log
    // passa a redigir num evento e vazar no outro.
    //
    // ⚠️ `errorName` sai "object" e `stack` sai null no caso comum — MEDIDO: o supabase-js
    // devolve objeto plano, sem nome e sem stack. Não é lacuna a preencher com valor inventado;
    // é a razão de `operation` existir.
    errorName: nomeDoErro(input.error),
    errorMessage: mensagemDoErro(input.error),
    stack: stackSanitizado(input.error),
    ...runtimeFields(env),
  }
}

/**
 * UMA linha JSON por captura, filtrável por `"event":"handled_server_error"`.
 *
 * 🔴 Substitui o log mínimo (`[public-showcase] getPublicShowcase falhou`) em vez de conviver
 * com ele: duas linhas para a mesma captura fazem qualquer contagem por operação mentir, e a
 * que mente é a que alguém usa para decidir se o problema é recorrente.
 */
export function reportHandledServerError(input: { operation: string; error: unknown }): void {
  try {
    console.error(JSON.stringify(buildHandledServerErrorEvent(input)))
  } catch {
    // Mesma disciplina do hook do Next: o reporter de erro não pode ser a fonte do próximo
    // erro. Se serializar falhar, ainda sai uma linha reconhecível — e ela preserva
    // `operation`, que é o único campo que não depende do erro para existir.
    console.error(
      JSON.stringify({
        event: "handled_server_error",
        errorName: "ObservabilityFailure",
        operation: input.operation,
      }),
    )
  }
}
