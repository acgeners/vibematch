import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react"
import { readFileSync } from "node:fs"
import { join } from "node:path"

/**
 * Preferência de edição da CONTA (`user_settings.preferred_mixed_edition`, mig 213):
 *   · o controle grava pela action e desfaz o otimista quando ela falha;
 *   · a action escreve pelo cliente de SESSÃO (RLS prende à linha da pessoa) e recusa valor inválido;
 *   · quem LÊ a preferência nunca cai no dono sem sessão (gotcha "anônimo vira dono").
 */
vi.mock("server-only", () => ({}))
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const ler = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8")
const semComentarios = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "")

describe("controle da preferência", () => {
  const setPreferredMixedEdition = vi.fn()
  beforeEach(() => {
    vi.resetModules()
    setPreferredMixedEdition.mockReset()
    vi.doMock("@/server/actions/settings", () => ({ setPreferredMixedEdition }))
  })
  afterEach(cleanup)

  it("escolher R18 chama a action com 'r18' e marca a opção", async () => {
    setPreferredMixedEdition.mockResolvedValue({ error: null })
    const { MixedEditionPreference } = await import("@/components/settings/mixed-edition-preference")
    render(<MixedEditionPreference initial={null} hideAdult={false} />)
    expect(screen.getByRole("radio", { name: "Sem preferência" }).getAttribute("aria-checked")).toBe("true")
    fireEvent.click(screen.getByRole("radio", { name: "Versão R18" }))
    await waitFor(() => expect(setPreferredMixedEdition).toHaveBeenCalledWith("r18"))
    expect(screen.getByRole("radio", { name: "Versão R18" }).getAttribute("aria-checked")).toBe("true")
  })

  it("falha da action DESFAZ a escolha otimista", async () => {
    setPreferredMixedEdition.mockResolvedValue({ error: "falhou" })
    const { MixedEditionPreference } = await import("@/components/settings/mixed-edition-preference")
    render(<MixedEditionPreference initial="normal" hideAdult={false} />)
    fireEvent.click(screen.getByRole("radio", { name: "Versão R18" }))
    await waitFor(() => expect(screen.getByRole("radio", { name: "Versão normal" }).getAttribute("aria-checked")).toBe("true"))
  })

  it("com 18+ oculto, o texto diz que a normal é a que vale", async () => {
    const { MixedEditionPreference } = await import("@/components/settings/mixed-edition-preference")
    render(<MixedEditionPreference initial="r18" hideAdult />)
    expect(screen.getByText(/Enquanto obras 18\+ estiverem ocultas, a versão normal é a que vale/)).toBeTruthy()
  })
})

describe("action e leitura da preferência (lidas do source)", () => {
  const settings = semComentarios(ler("server/actions/settings.ts"))
  const corpo = settings.slice(settings.indexOf("export async function setPreferredMixedEdition"))
  const currentUser = semComentarios(ler("server/queries/current-user.ts"))
  const leitor = currentUser.slice(currentUser.indexOf("export async function getPreferredMixedEdition"))
  const editionScores = semComentarios(ler("server/queries/edition-scores.ts"))

  it("a action valida o valor, exige sessão e grava pelo cliente de SESSÃO", () => {
    expect(corpo).toMatch(/parseMixedEdition\(value\)/)
    expect(corpo).toMatch(/Versão inválida/)
    expect(corpo.slice(0, corpo.indexOf("revalidatePath"))).toMatch(/ensureSignedIn\(\)/)
    expect(corpo.slice(0, corpo.indexOf("revalidatePath"))).toMatch(/createUserClient\(\)/)
    expect(corpo.slice(0, corpo.indexOf("revalidatePath"))).not.toMatch(/createAdminClient\(\)/)
  })
  it("a leitura da preferência é da linha de SESSÃO — anônimo recebe null, nunca a do dono", () => {
    expect(leitor.slice(0, leitor.indexOf("\n}"))).toMatch(/getCurrentUserSettingsRow\(\)/)
    expect(leitor.slice(0, leitor.indexOf("\n}"))).not.toMatch(/getCurrentUserId|getOwnerUserId/)
    // A linha memoizada devolve null sem sessão (é ela que impede o "anônimo vira dono").
    const row = currentUser.slice(currentUser.indexOf("const getCurrentUserSettingsRow"))
    expect(row.slice(0, row.indexOf("})"))).toMatch(/if \(!sessionId\) return null/)
  })
  it("o recálculo lê a preferência de um usuário EXPLÍCITO (sem sessão em background)", () => {
    expect(editionScores).toMatch(/export async function loadMixedEditionSettingsFor\(\s*userId: string/)
    expect(editionScores).toMatch(/\.eq\("current_user_id", userId\)/)
  })
  it("trocar a edição na página NÃO chama a action (a preferência só muda em /preferences)", () => {
    expect(ler("components/titles/edition-selector.tsx")).not.toMatch(/setPreferredMixedEdition/)
    expect(semComentarios(ler("app/catalog/[id]/page.tsx"))).not.toMatch(/setPreferredMixedEdition/)
  })
})
