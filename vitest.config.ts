import { defineConfig, configDefaults } from "vitest/config"
import { resolve } from "path"

export default defineConfig({
  test: {
    environment: "jsdom",
    globals: true,
    // `services/` é o sidecar comix-render (subprojeto): usa node:test, roda com
    // `node --test` na sua própria toolchain. Fora da descoberta do vitest do app.
    // `Auditoria/` é material local de auditoria, fora do git (`.git/info/exclude`): os testes de
    // lá dependem de arquivos temporários e de outros worktrees, e pintavam a suíte de vermelho
    // sem nenhum teste versionado falhar.
    exclude: [...configDefaults.exclude, "services/**", "Auditoria/**"],
    setupFiles: ["tests/setup/jsdom-lacunas.ts"],
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "."),
      "server-only": resolve(__dirname, "tests/mocks/server-only.js"),
    },
  },
})
