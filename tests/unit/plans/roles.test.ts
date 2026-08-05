import { describe, it, expect } from "vitest"
import {
  roleAtLeast,
  roleAllows,
  isRole,
  deniedMessage,
  PERMISSIONS,
  ROLE_LABELS,
} from "@/lib/plans/roles"
import type { Role, Permission } from "@/lib/plans/roles"

const ROLES: Role[] = ["leitor", "assinante", "curador"]

describe("escada de papéis", () => {
  it("leitor < assinante < curador", () => {
    expect(roleAtLeast("curador", "assinante")).toBe(true)
    expect(roleAtLeast("curador", "leitor")).toBe(true)
    expect(roleAtLeast("assinante", "leitor")).toBe(true)

    expect(roleAtLeast("assinante", "curador")).toBe(false)
    expect(roleAtLeast("leitor", "assinante")).toBe(false)
    expect(roleAtLeast("leitor", "curador")).toBe(false)
  })

  it("todo papel satisfaz a si mesmo (a escada é ≥, não >)", () => {
    for (const r of ROLES) expect(roleAtLeast(r, r)).toBe(true)
  })

  it("isRole rejeita o vocabulário antigo — nada de free/paid/admin virando papel", () => {
    for (const r of ROLES) expect(isRole(r)).toBe(true)
    for (const v of ["free", "paid", "admin", "Curador", "", null, undefined, 2]) {
      expect(isRole(v)).toBe(false)
    }
  })
})

describe("permissões por papel", () => {
  it("o CURADOR pode tudo — nenhuma permissão fica fora do dono", () => {
    for (const p of Object.keys(PERMISSIONS) as Permission[]) {
      expect(roleAllows("curador", p)).toBe(true)
    }
  })

  it("o LEITOR escreve o PRÓPRIO estado e BUSCA fontes — nada do catálogo, nada de IA", () => {
    // `own_state`: favoritar, status, capítulo lido, nota. É o que o faz deixar de ser um
    // espectador. (Enquanto a Fase 2 não parte `works`, esse estado mora na linha COMPARTILHADA
    // e os writers seguem em `curate_work`. Ver PLANO-MULTIUSER-FASE2.md §2.)
    expect(roleAllows("leitor", "own_state")).toBe(true)
    // `search_sources` entrou em 2026-08-04: o leitor precisa achar e escolher a obra certa pra
    // cadastrar o que falta no catálogo. Só LÊ das fontes — não grava nada e não gasta token.
    expect(roleAllows("leitor", "search_sources")).toBe(true)

    const DO_LEITOR = new Set<Permission>(["own_state", "search_sources"])
    for (const p of Object.keys(PERMISSIONS) as Permission[]) {
      if (DO_LEITOR.has(p)) continue
      expect(roleAllows("leitor", p), `leitor não pode "${p}"`).toBe(false)
    }
  })

  it("ASSINANTE: consome IA, mas NÃO cura nem re-hidrata", () => {
    // O que ele paga pra ter:
    expect(roleAllows("assinante", "consume_ai")).toBe(true)

    // 🔴 `refresh_work` SAIU daqui em 2026-08-04 e virou curador. Não é aperto de segurança: é
    // que produção não tem sidecar nem FlareSolverr, então re-hidratar lá colhe 6 das 9 fontes
    // e sobrescreve dado bom por dado pobre, SEM ERRO. A curadoria roda local, onde o bypass é
    // grátis. Ver `project-curadoria-centralizada-solicitacoes`.
    expect(roleAllows("assinante", "refresh_work")).toBe(false)

    // A fronteira que não pode vazar: `works` é COMPARTILHADA (sem user_id), então
    // curar = decidir pelos outros. Se algum destes virar true, o assinante passa a
    // poder degradar o catálogo do curador — e não há reversão por usuário.
    expect(roleAllows("assinante", "curate_work")).toBe(false)
    expect(roleAllows("assinante", "curate_ai")).toBe(false)
    expect(roleAllows("assinante", "global_config")).toBe(false)
  })

  it("ler fonte ≠ escrever com ela: a distinção existe de fato na tabela", () => {
    // A distinção que sobrou depois de `refresh_work` subir. É ela que sustenta o desenho:
    // BUSCAR é grátis e de qualquer um; tudo que GRAVA a partir das fontes é do curador.
    expect(PERMISSIONS.search_sources).toBe("leitor")
    expect(PERMISSIONS.refresh_work).toBe("curador")
    expect(PERMISSIONS.curate_work).toBe("curador")
  })
})

describe("mensagens de bloqueio", () => {
  it("dizem o que falta, não só que negou", () => {
    expect(deniedMessage("curate_work")).toContain("Curador")
    // `consume_ai` ocupou o lugar do `refresh_work` neste caso: é a permissão de assinante que
    // sobrou depois que a re-hidratação subiu pra curador.
    expect(deniedMessage("consume_ai")).toContain(ROLE_LABELS.assinante)
  })
})
