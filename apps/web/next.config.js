const path = require("path");

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
  webpack: (config) => {
    // pnpm store aliases — node_modules is root-owned so symlinks can't be created;
    // tsconfig paths cover TS resolution; these aliases cover webpack bundling.
    const store = path.resolve(__dirname, "../../node_modules/.pnpm");
    Object.assign(config.resolve.alias, {
      "i18next": path.join(store, "i18next@26.3.4_typescript@5.9.3/node_modules/i18next"),
      "react-i18next": path.join(store, "react-i18next@17.0.8_i18next@26.3.4_typescript@5.9.3__react-dom@18.3.1_react@18.3.1__react@18.3.1_typescript@5.9.3/node_modules/react-i18next"),
      "i18next-browser-languagedetector": path.join(store, "i18next-browser-languagedetector@8.2.1/node_modules/i18next-browser-languagedetector"),
      "i18next-http-backend": path.join(store, "i18next-http-backend@4.0.0/node_modules/i18next-http-backend"),
    });
    return config;
  },
};

module.exports = nextConfig;
