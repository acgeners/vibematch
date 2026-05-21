import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
