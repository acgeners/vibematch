import { describe, it, expect, afterEach } from "vitest"
import {
  getActiveCompiledPreferences,
  resolveInterestPromptVersion,
  isInterestPrefsEnabled,
} from "@/lib/ai-evaluation/compiled-preferences"
import { buildSynopsisQualityUserPrompt } from "@/lib/ai-evaluation/synopsis-quality-predictor"
import type { TasteProfilePayload } from "@/lib/ai-recommendation/types"
import type { PredictWorkInput } from "@/lib/ai-evaluation/synopsis-quality-predictor"

// Wiring da Peça 2: a env-flag INTEREST_PREFS_V33 governa (a) a versão de prompt
// ativa e (b) a injeção do bloco v3.3. Flag off = comportamento idêntico ao atual.
const KEY = "INTEREST_PREFS_V33"
const profile = {} as unknown as TasteProfilePayload
const work: PredictWorkInput = { id: "t", title: "Test", synopsis: "abc", tags: [] }

afterEach(() => {
  delete process.env[KEY]
})

describe("compiled preferences flag wiring (Peça 2)", () => {
  it("flag OFF ⇒ v3, sem injeção (comportamento atual)", () => {
    delete process.env[KEY]
    expect(isInterestPrefsEnabled()).toBe(false)
    expect(getActiveCompiledPreferences()).toBeNull()
    expect(resolveInterestPromptVersion()).toBe("v3")
    const { profileBlock } = buildSynopsisQualityUserPrompt(profile, work, getActiveCompiledPreferences())
    expect(profileBlock).not.toContain("PREFERÊNCIAS DO USUÁRIO")
  })

  it("flag ON ⇒ v4, bloco compilado no perfil + addendum disponível", () => {
    process.env[KEY] = "1"
    expect(isInterestPrefsEnabled()).toBe(true)
    const compiled = getActiveCompiledPreferences()
    expect(compiled).not.toBeNull()
    expect(resolveInterestPromptVersion()).toBe("v4")
    expect(compiled!.promptVersion).toBe("v4")
    // Tamanhos byte-exatos do artefato v3.3 (guarda contra transcrição corrompida).
    expect(compiled!.compiledBlock).toHaveLength(2667)
    expect(compiled!.systemAddendum).toHaveLength(1002)
    expect(compiled!.systemAddendum).toContain("INVERSÃO DE SENTIMENTO")
    const { profileBlock } = buildSynopsisQualityUserPrompt(profile, work, compiled)
    expect(profileBlock).toContain("PREFERÊNCIAS DO USUÁRIO")
    expect(profileBlock).toContain(compiled!.compiledBlock)
  })

  it("valor diferente de '1' não liga a flag", () => {
    process.env[KEY] = "true"
    expect(isInterestPrefsEnabled()).toBe(false)
    expect(resolveInterestPromptVersion()).toBe("v3")
  })
})
