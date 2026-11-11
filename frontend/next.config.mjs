/** @type {import('next').NextConfig} */
const nextConfig = {
  eslint: { ignoreDuringBuilds: true },
  // O deploy builda em .next-build e só troca pela .next no final, para não
  // sobrescrever os arquivos do site que está no ar (ver deploy/deploy.sh).
  distDir: process.env.NEXT_DIST_DIR || '.next',
  async rewrites() {
    // Proxy same-origin para a API: o cookie httpOnly de sessão flui sem
    // gambiarras de CORS/cross-site. O destino é gravado no build (next build): use 127.0.0.1, pois a API
    // escuta só no loopback IPv4.
    const target = process.env.API_PROXY_TARGET ?? 'http://127.0.0.1:4000';
    return [{ source: '/api/:path*', destination: `${target}/:path*` }];
  }
};

export default nextConfig;
