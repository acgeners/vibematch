import { isLocalSupabaseUrl, supabaseTargetLabel } from "@/lib/db-target"

/**
 * Faixa que denuncia quando o app está falando com o Postgres LOCAL.
 *
 * Desde 2026-08-10 a NUVEM é a fonte de verdade e o local é réplica descartável. O modo de
 * falha que sobra é **humano e silencioso**: abrir o app, curar algumas obras e só depois
 * perceber que estava no banco errado — o trabalho fica num banco que o próximo `db:pull`
 * apaga. Foi dessa ambiguidade que nasceram as divergências que duas sessões inteiras
 * gastaram limpando; nada na tela dizia com qual banco se estava falando.
 *
 * 🔴 Mora no layout RAIZ, acima do `AppShell`, e não dentro dele. As rotas full-bleed
 * (`/login`, `/signup`, `/about`, `/welcome`) retornam antes da barra de navegação — e o
 * login é exatamente onde saber o alvo mais importa, porque as contas dos dois bancos são
 * diferentes e entrar no errado parece "minha senha não funciona".
 *
 * Custo em produção: zero. `isLocalSupabaseUrl` é falso lá e o componente devolve `null`.
 *
 * ⚠️ Listras diagonais, e não uma cor chapada, de propósito: o app já usa azul para tarefa
 * durável e âmbar para tarefa request-scoped (ver "Ação lenta tem DUAS cores" no CLAUDE.md).
 * Uma terceira cor chapada entraria nessa conversa e seria lida como estado de tarefa. Isto
 * é ambiente, que é outra categoria — então usa uma FORMA que nenhum estado usa.
 */
export function DbTargetBanner() {
  if (!isLocalSupabaseUrl()) return null

  return (
    <div
      role="note"
      aria-label="Aviso de ambiente"
      className="shrink-0 border-b border-fuchsia-700/40 bg-fuchsia-950 px-4 py-1.5 text-center text-fuchsia-50"
      style={{
        backgroundImage:
          "repeating-linear-gradient(135deg, rgba(255,255,255,.10) 0 8px, transparent 8px 16px)",
      }}
    >
      <span className="text-[.72rem] font-semibold uppercase tracking-[.14em]">
        Banco local — nada daqui vai para produção
      </span>
      <span className="ml-2 font-mono text-[.7rem] text-fuchsia-200/80">{supabaseTargetLabel()}</span>
    </div>
  )
}
