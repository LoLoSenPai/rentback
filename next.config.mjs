/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  outputFileTracingRoot: process.cwd(),
  outputFileTracingIncludes: { "/api/share/reclaim-image": ["./public/fonts/*.ttf"] },
};

export default nextConfig;
