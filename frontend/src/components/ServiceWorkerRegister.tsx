'use client';

import { useEffect } from 'react';

export function ServiceWorkerRegister() {
  useEffect(() => {
    if ('serviceWorker' in navigator && process.env.NODE_ENV === 'production') {
      window.addEventListener('load', () => {
        navigator.serviceWorker
          .register('/sw.js')
          .then(() => {
            // SW 注册成功，生产环境不输出日志
          })
          .catch(() => {
            // SW 注册失败，生产环境不输出日志
          });
      });
    }
  }, []);

  return null;
}
