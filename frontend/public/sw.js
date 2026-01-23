// Service Worker for error handling and offline support

const CACHE_NAME = 'hoppingrabbit-v1';
const RUNTIME_CACHE = 'hoppingrabbit-runtime';

// 不需要缓存的资源
const EXCLUDED_URLS = [
  '/api/',
  'chrome-extension://',
  'supabase.co',
];

// 安装 Service Worker
self.addEventListener('install', (event) => {
  console.log('[SW] Installing...');
  // 强制激活新的 Service Worker
  self.skipWaiting();
});

// 激活 Service Worker
self.addEventListener('activate', (event) => {
  console.log('[SW] Activating...');
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME && name !== RUNTIME_CACHE)
          .map((name) => {
            console.log('[SW] Deleting old cache:', name);
            return caches.delete(name);
          })
      );
    })
  );
  return self.clients.claim();
});

// 拦截请求
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // 跳过不需要缓存的请求
  if (EXCLUDED_URLS.some((excluded) => request.url.includes(excluded))) {
    return;
  }

  // 只处理 GET 请求
  if (request.method !== 'GET') {
    return;
  }

  event.respondWith(
    caches.match(request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }

      return fetch(request)
        .then((response) => {
          // 不缓存错误响应
          if (!response || response.status !== 200 || response.type === 'error') {
            return response;
          }

          // 克隆响应并缓存
          const responseToCache = response.clone();
          caches.open(RUNTIME_CACHE).then((cache) => {
            cache.put(request, responseToCache);
          });

          return response;
        })
        .catch((error) => {
          console.error('[SW] Fetch failed:', error);
          // 返回友好的错误页面
          return new Response(
            JSON.stringify({
              error: 'Network error',
              message: '网络连接失败，请检查您的网络设置',
            }),
            {
              status: 503,
              statusText: 'Service Unavailable',
              headers: new Headers({
                'Content-Type': 'application/json',
              }),
            }
          );
        });
    })
  );
});
