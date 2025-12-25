import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Snowflake SDK를 외부 패키지로 처리 (서버리스 환경 호환)
  serverExternalPackages: ["snowflake-sdk"],
};

export default nextConfig;
