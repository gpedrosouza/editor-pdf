/** @type {import('next').NextConfig} */
const nextConfig = {
  webpack: (config) => {
    // Prevent Next.js from trying to bundle the pdfjs worker
    config.resolve.alias.canvas = false;
    return config;
  },
};

export default nextConfig;
