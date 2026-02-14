import React, { useState } from 'react';
import Image from 'next/image';

interface LepusLoaderProps {
  size?: number;
  className?: string;
  text?: string;
}

export function LepusLoader({ size = 48, className = '', text = '加载中...' }: LepusLoaderProps) {
  const [imageError, setImageError] = useState(false);

  // 如果图片加载失败，使用CSS动画作为兜底
  if (imageError) {
    return (
      <div className={`flex flex-col items-center justify-center gap-3 ${className}`}>
        <div 
          className="border-2 border-gray-500/20 border-t-gray-500 rounded-full animate-spin"
          style={{ width: size, height: size }}
        />
        {text && <span className="text-gray-500 text-sm">{text}</span>}
      </div>
    );
  }

  return (
    <div className={`flex flex-col items-center justify-center gap-3 ${className}`}>
      <img 
        src="/rabbit-loading.gif" 
        alt="Loading..." 
        width={size} 
        height={size}
        className="object-contain"
        onError={() => setImageError(true)}
      />
      {text && <span className="text-gray-500 text-sm">{text}</span>}
    </div>
  );
}
