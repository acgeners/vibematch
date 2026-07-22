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
  async redirects() {
    return [
      {
        source: "/titles",
        has: [{ type: "query", key: "fav", value: "1" }],
        destination: "/favorites",
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
