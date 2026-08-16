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
  // grupo inexistente, `/catalog/[id]` que resolve pra slug): esses precisam de
  // uma leitura no banco pra decidir e seguem no `page.tsx`.
  //
  // 🔴 A ORDEM É SIGNIFICATIVA — o Next casa a primeira regra e para. Toda regra
  // específica (`?fav=1`, `/settings/calibration`) tem que vir ANTES da regra ampla
  // que a engoliria, senão ela vira código morto sem nada acusar.
  async redirects() {
    return [
      // --- Específicas: precisam vencer as amplas logo abaixo ---
      {
        source: "/titles",
        has: [{ type: "query", key: "fav", value: "1" }],
        destination: "/favorites",
        permanent: true,
      },
      { source: "/conta/preferencias", destination: "/preferences", permanent: true },
      {
        source: "/settings/calibration",
        destination: "/curation/settings?g=notas&open=ai-audit",
        permanent: true,
      },
      {
        source: "/ranking/desatualizados",
        destination: "/my-ai-scores?tab=ia-rk",
        permanent: true,
      },

      // --- Nomes antigos das rotas (padronização pra inglês, 2026-08-16) ---
      //
      // Todas em 308: são renomeações definitivas, e o que passa por aqui é bookmark,
      // histórico do browser e link colado em conversa. `:path*` cobre a rota e os
      // filhos numa regra só; o Next repassa a query string sozinho, que é o que mantém
      // vivo o deep-link `/settings?g=fontes` do alerta do Comix.
      //
      // ⚠️ `/preferences → /preferencias` existia aqui e foi INVERTIDO, não apagado:
      // agora quem é real é o lado inglês. Apagar teria transformado o alias antigo em
      // 404 justo pra quem já usava o nome novo.
      { source: "/titles/:path*", destination: "/catalog/:path*", permanent: true },
      { source: "/leitura", destination: "/reading", permanent: true },
      { source: "/descobrir", destination: "/discover", permanent: true },
      { source: "/painel", destination: "/dashboard", permanent: true },
      { source: "/conta/perfil", destination: "/account/taste-profile", permanent: true },
      { source: "/conta/:path*", destination: "/account/:path*", permanent: true },
      { source: "/preferencias/:path*", destination: "/preferences/:path*", permanent: true },
      { source: "/sobre", destination: "/about", permanent: true },
      { source: "/guia", destination: "/guide", permanent: true },
      { source: "/bem-vindo", destination: "/welcome", permanent: true },
      { source: "/fila-recomendacao", destination: "/my-ai-scores", permanent: true },
      { source: "/recuperar-senha", destination: "/forgot-password", permanent: true },
      { source: "/nova-senha", destination: "/reset-password", permanent: true },

      // A console virou um prefixo só (`/curation/*`); estas cinco eram rotas irmãs.
      { source: "/curadoria/pedidos", destination: "/curation/requests", permanent: true },
      { source: "/curadoria/:path*", destination: "/curation/:path*", permanent: true },
      { source: "/ai-evaluation/:path*", destination: "/curation/works/:path*", permanent: true },
      { source: "/ai-usage/:path*", destination: "/curation/ai-usage/:path*", permanent: true },
      { source: "/settings/:path*", destination: "/curation/settings/:path*", permanent: true },
      { source: "/admin/model-metrics", destination: "/curation/model-metrics", permanent: true },
    ];
  },
};

export default nextConfig;
