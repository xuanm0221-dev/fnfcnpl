import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Snowflake SDK를 외부 패키지로 처리 (서버리스 환경 호환)
  serverExternalPackages: ["snowflake-sdk"],
  
  // Webpack 설정 (Turbopack 미사용 시)
  webpack: (config, { isServer }) => {
    if (isServer) {
      config.externals = config.externals || [];
      config.externals.push({
        "snowflake-sdk": "commonjs snowflake-sdk",
      });
    }
    return config;
  },
};

export default nextConfig;
