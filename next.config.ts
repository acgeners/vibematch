import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Gera um servidor mínimo (.next/standalone) pra imagem Docker enxuta no deploy.
  // Só afeta `next build`; não muda o `next dev`.
  output: "standalone",
  // O rastreador de arquivos errava pro lado de incluir demais: puxava `.cache/comix-chrome/`
  // (o Chrome que o sidecar baixa, 90 MB) pra dentro do standalone — 2/3 do artefato era um
  // browser que o servidor Next nunca executa; quem usa é o `comix-render`, que tem a própria
  // cópia. Também gerava dois `Failed to copy traced files` no build, em arquivos de lock com
  // `:` no nome que somem entre rastrear e copiar.
  outputFileTracingExcludes: {
    "**/*": [".cache/**"],
  },
  // Indicador de dev do Next (botão flutuante "N") vai pro canto inferior
  // direito — no canto esquerdo ele sobrepunha o avatar do chip de conta na
  // sidebar. Só afeta `next dev`.
  devIndicators: {
    position: "bottom-right",
  },
  experimental: {
    optimizePackageImports: [
      "recharts",
      "lucide-react",
      "date-fns",
      "@radix-ui/react-alert-dialog",
      "@radix-ui/react-checkbox",
      "@radix-ui/react-dialog",
      "@radix-ui/react-dropdown-menu",
      "@radix-ui/react-label",
      "@radix-ui/react-progress",
      "@radix-ui/react-select",
      "@radix-ui/react-separator",
      "@radix-ui/react-slot",
      "@radix-ui/react-tabs",
      "@radix-ui/react-toast",
      "radix-ui",
    ],
  },
  // 🔴 Alias de rota vai AQUI, nunca num `page.tsx` que só chama `redirect()`.
  //
  // O `redirect()` de um server component não devolve 3xx: o layout já começou a
  // streamar, então o Next responde **200** e manda o cliente navegar — e o
  // Router estoura com "Rendered more hooks than during the previous render"
  // (React #310 em produção, medido em 2026-08-08 nas duas builds). A página
  // acaba certa, mas o erro é real e aparece pro usuário no console.
  //
  // É a MESMA armadilha do `notFound()` no layout da console (ver CLAUDE.md):
  // quem decide depois do primeiro byte não decide mais o status. Aqui a decisão
  // não depende de dado nenhum, então ela cabe antes de qualquer render — e o
  // `redirects()` do config emite 308 de verdade.
  //
  // ⚠️ Isto NÃO cobre redirect que depende de dado (`/favorites/[listId]` de
  // grupo inexistente, `/titles/[id]` que resolve pra slug): esses precisam de
  // uma leitura no banco pra decidir e seguem no `page.tsx`.
  async redirects() {
    return [
      {
        source: "/titles",
        has: [{ type: "query", key: "fav", value: "1" }],
        destination: "/favorites",
        permanent: true,
      },
      { source: "/preferences", destination: "/preferencias", permanent: true },
      { source: "/conta/preferencias", destination: "/preferencias", permanent: true },
      {
        source: "/ranking/desatualizados",
        destination: "/fila-recomendacao?tab=ia-rk",
        permanent: true,
      },
      {
        source: "/settings/calibration",
        destination: "/settings?g=notas&open=ai-audit",
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
