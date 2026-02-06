/** @type {import('next').NextConfig} */
const nextConfig = {
  // 关闭 React Strict Mode (避免开发模式下 useEffect 双重调用)
  reactStrictMode: false,
  
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
  // 代理 API 请求到后端
  async rewrites() {
    // 注意: NEXT_PUBLIC_API_URL 应该是 http://localhost:8000 (不含 /api)
    // 如果环境变量包含 /api，需要去掉
    let backendUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';
    backendUrl = backendUrl.replace(/\/api\/?$/, ''); // 去掉末尾的 /api
    
    return [
      // 代理 Supabase Storage 请求
      {
        source: '/api/storage/:path*',
        destination: 'https://rduiyxvzknaxomrrehzs.supabase.co/storage/v1/:path*',
      },
      // 代理后端静态缓存文件请求（分镜缩略图等）
      {
        source: '/cache/:path*',
        destination: `${backendUrl}/cache/:path*`,
      },
      // 代理后端 API 请求
      {
        source: '/api/:path*',
        destination: `${backendUrl}/api/:path*`,
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
