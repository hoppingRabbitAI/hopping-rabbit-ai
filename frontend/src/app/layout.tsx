import type { Metadata } from "next";
import "./globals.css";
import { AuthGuard } from "@/components/AuthGuard";
import ErrorBoundary from "@/components/ErrorBoundary";
import { ServiceWorkerRegister } from "@/components/ServiceWorkerRegister";
import { DevErrorTracker } from "@/components/DevErrorTracker";
import Script from "next/script";

export const metadata: Metadata = {
  title: "HoppingRabbit AI - 智能口播视频剪辑",
  description: "像编辑文档一样编辑视频，AI 自动去静音、去废话、智能运镜",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <head>
        {/* 全局错误处理脚本 - 必须在所有其他脚本之前加载 */}
        <Script
          id="global-error-handler"
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{
            __html: `
              // 捕获全局加载错误
              window.addEventListener('error', function(event) {
                // 如果是资源加载错误（如脚本、样式表）
                if (event.target !== window) {
                  console.error('[Global] Resource load error:', event.target);
                  
                  // 如果是关键资源加载失败，显示友好提示
                  const target = event.target;
                  if (target && (target.tagName === 'SCRIPT' || target.tagName === 'LINK')) {
                    const errorMsg = '页面资源加载失败，请刷新重试';
                    
                    // 防止重复显示
                    if (!window.__resourceLoadErrorShown) {
                      window.__resourceLoadErrorShown = true;
                      
                      // 3秒后如果页面还没加载完成，显示错误提示
                      setTimeout(function() {
                        if (!document.querySelector('[data-app-loaded]')) {
                          showGlobalError(errorMsg);
                        }
                      }, 3000);
                    }
                  }
                }
                
                // 捕获语法错误
                if (event.message && (
                  event.message.includes('SyntaxError') || 
                  event.message.includes('Unexpected token') ||
                  event.message.includes('Invalid or unexpected token')
                )) {
                  console.error('[Global] Syntax error detected:', event.message);
                  
                  if (!window.__syntaxErrorShown) {
                    window.__syntaxErrorShown = true;
                    setTimeout(function() {
                      if (!document.querySelector('[data-app-loaded]')) {
                        showGlobalError('页面脚本加载异常，请清除缓存后重试');
                      }
                    }, 2000);
                  }
                }
              }, true);
              
              // 捕获未处理的 Promise 错误
              window.addEventListener('unhandledrejection', function(event) {
                console.error('[Global] Unhandled promise rejection:', event.reason);
              });
              
              // 显示全局错误提示
              function showGlobalError(message) {
                const existingError = document.getElementById('global-error-overlay');
                if (existingError) return;
                
                const overlay = document.createElement('div');
                overlay.id = 'global-error-overlay';
                overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:#0a0a0a;z-index:999999;display:flex;align-items:center;justify-content:center;';
                
                overlay.innerHTML = \`
                  <div style="text-align:center;max-width:500px;padding:32px;">
                    <div style="width:64px;height:64px;margin:0 auto 24px;background:rgba(234,179,8,0.1);border-radius:50%;display:flex;align-items:center;justify-content:center;">
                      <svg style="width:32px;height:32px;color:#eab308;" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                      </svg>
                    </div>
                    <h2 style="color:#fff;font-size:20px;font-weight:bold;margin-bottom:12px;">页面加载失败</h2>
                    <p style="color:#9ca3af;font-size:14px;margin-bottom:24px;">\${message}</p>
                    <div style="display:flex;gap:12px;justify-content:center;">
                      <button onclick="location.reload()" style="padding:12px 24px;background:#2563eb;color:#fff;border:none;border-radius:8px;font-weight:500;cursor:pointer;">
                        刷新页面
                      </button>
                      <button onclick="clearCacheAndReload()" style="padding:12px 24px;background:#374151;color:#fff;border:none;border-radius:8px;font-weight:500;cursor:pointer;">
                        清除缓存
                      </button>
                    </div>
                  </div>
                \`;
                
                document.body.appendChild(overlay);
              }
              
              // 清除缓存并重载
              function clearCacheAndReload() {
                if ('caches' in window) {
                  caches.keys().then(function(names) {
                    names.forEach(function(name) { caches.delete(name); });
                  });
                }
                try { localStorage.clear(); } catch(e) {}
                try { sessionStorage.clear(); } catch(e) {}
                location.reload();
              }
              
              // 页面加载超时检测（20秒）
              setTimeout(function() {
                if (!document.querySelector('[data-app-loaded]')) {
                  console.warn('[Global] Page load timeout after 20s');
                  if (!window.__pageLoadTimeoutShown) {
                    window.__pageLoadTimeoutShown = true;
                    showGlobalError('页面加载超时，请检查网络连接');
                  }
                }
              }, 20000);
            `,
          }}
        />
      </head>
      <body className="antialiased min-h-screen bg-[#FAFAFA] text-gray-900" data-app-loaded="true">
        <ErrorBoundary>
          <AuthGuard>{children}</AuthGuard>
        </ErrorBoundary>
        <ServiceWorkerRegister />
        <DevErrorTracker />
      </body>
    </html>
  );
}
