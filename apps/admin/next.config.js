/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@fennex/ui", "@fennex/types"],
  experimental: {
    serverComponentsExternalPackages: [],
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "**",
      },
    ],
  },
};

module.exports = nextConfig;
