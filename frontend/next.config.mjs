import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  turbopack: {
    root: __dirname,
  },
  webpack: (config) => {
    // Prevent Next.js from trying to bundle the pdfjs worker
    config.resolve.alias.canvas = false;
    return config;
  },
};

export default nextConfig;
