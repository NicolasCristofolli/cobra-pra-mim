/** @type {import('next').NextConfig} */
const nextConfig = {
  eslint: { ignoreDuringBuilds: true },
  async rewrites() {
    // Proxy same-origin para a API: o cookie httpOnly de sessão flui sem
    // gambiarras de CORS/cross-site. Em produção, aponte para a URL da API.
    const target = process.env.API_PROXY_TARGET ?? 'http://localhost:4000';
    return [{ source: '/api/:path*', destination: `${target}/:path*` }];
  }
};

export default nextConfig;
