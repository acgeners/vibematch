import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
