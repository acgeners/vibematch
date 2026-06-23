import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Cache gerado (browser do FlareSolverr/Comix) — gitignored (.gitignore: `.cache/`),
    // NÃO é código-fonte do projeto. Excluído p/ o lint refletir só o código versionado.
    ".cache/**",
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "next-env.d 2.ts",
    "**/* [0-9].ts",
    "**/* [0-9].tsx",
    "**/* [0-9].js",
    "**/* [0-9].tsbuildinfo",
    "scripts/seed-from-xlsx.js",
    "**/.vibematch-next-cache/**",
    "Users/**",
  ]),
]);

export default eslintConfig;
