/** @type {import('next').NextConfig} */
const nextConfig = {
  // 允许从 Supabase Storage 加载视频和图片
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '*.supabase.co',
      },
    ],
  },
  // 实验性功能：服务端 Actions
  experimental: {
    serverActions: {
      bodySizeLimit: '100mb', // 支持大视频上传
    },
  },
  // 代理 Supabase Storage 请求以解决 CORS 问题（开发环境）
  async rewrites() {
    return [
      {
        source: '/api/storage/:path*',
        destination: 'https://rduiyxvzknaxomrrehzs.supabase.co/storage/v1/:path*',
      },
    ];
  },
  // 添加 headers 以支持视频播放
  async headers() {
    return [
      {
        source: '/api/storage/:path*',
        headers: [
          { key: 'Access-Control-Allow-Origin', value: '*' },
          { key: 'Access-Control-Allow-Methods', value: 'GET, HEAD, OPTIONS' },
        ],
      },
    ];
  },
  // 改善开发模式下的热更新稳定性
  onDemandEntries: {
    // 页面在内存中保持的时间（毫秒）
    maxInactiveAge: 60 * 1000,
    // 同时保持的页面数量
    pagesBufferLength: 5,
  },
};

export default nextConfig;
