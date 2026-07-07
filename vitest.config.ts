import { defineConfig, configDefaults } from "vitest/config"
import { resolve } from "path"

export default defineConfig({
  test: {
    environment: "jsdom",
    globals: true,
    // `services/` é o sidecar comix-render (subprojeto): usa node:test, roda com
    // `node --test` na sua própria toolchain. Fora da descoberta do vitest do app.
    exclude: [...configDefaults.exclude, "services/**"],
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "."),
      "server-only": resolve(__dirname, "tests/mocks/server-only.js"),
    },
  },
})
