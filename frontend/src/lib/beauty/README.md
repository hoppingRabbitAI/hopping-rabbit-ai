# 美颜美体系统 - MediaPipe + WebGL

## 📦 安装依赖

```bash
pnpm add @mediapipe/tasks-vision
```

## 🚀 快速开始

### 1. 使用 Hook 处理视频

```tsx
import { useVideoBeauty, BEAUTY_PRESETS } from '@/lib/beauty';

function VideoEditor() {
  const videoRef = useRef<HTMLVideoElement>(null);
  
  const {
    isReady,
    fps,
    outputCanvasRef,
    startProcessing,
    stopProcessing,
    setBeautySettings,
    applyPreset,
    beautySettings,
  } = useVideoBeauty({ enabled: true });
  
  // 视频加载后开始处理
  const handleVideoPlay = () => {
    if (videoRef.current && isReady) {
      startProcessing(videoRef.current);
    }
  };
  
  return (
    <div>
      {/* 原始视频(隐藏) */}
      <video ref={videoRef} src="/video.mp4" onPlay={handleVideoPlay} hidden />
      
      {/* 美颜后的输出 */}
      <canvas ref={outputCanvasRef} />
      
      {/* 预设按钮 */}
      {BEAUTY_PRESETS.map(preset => (
        <button key={preset.id} onClick={() => applyPreset(preset.id)}>
          {preset.icon} {preset.name}
        </button>
      ))}
      
      {/* 参数调节 */}
      <input
        type="range"
        value={beautySettings.smoothSkin}
        onChange={e => setBeautySettings({ smoothSkin: +e.target.value })}
      />
    </div>
  );
}
```

### 2. 直接使用处理器

```tsx
import { BeautyProcessor } from '@/lib/beauty';

const processor = new BeautyProcessor({
  maxFaces: 1,
  enablePoseDetection: true,
});

await processor.initialize();

// 设置参数
processor.setBeautySettings({
  smoothSkin: 50,
  whitening: 30,
  eyeEnlarge: 25,
});

// 处理帧
const result = await processor.processFrame({
  source: videoElement,
  timestamp: performance.now(),
  width: 1280,
  height: 720,
});

// 获取处理后的画布
const outputCanvas = result.outputCanvas;
```

## 📋 功能列表

### 美颜功能
| 功能 | 参数名 | 范围 | 说明 |
|------|--------|------|------|
| 磨皮 | `smoothSkin` | 0-100 | 双边滤波，保留边缘 |
| 美白 | `whitening` | 0-100 | HSL色彩空间提亮 |
| 锐化 | `sharpness` | 0-100 | USM锐化 |
| 瘦脸 | `faceSlim` | 0-100 | 基于人脸关键点 |
| 大眼 | `eyeEnlarge` | 0-100 | 眼部区域膨胀 |
| 瘦鼻 | `noseSlim` | 0-100 | 鼻翼收缩 |
| 下巴 | `chinLength` | -50~50 | 下巴长度调整 |

### 美体功能
| 功能 | 参数名 | 范围 | 说明 |
|------|--------|------|------|
| 瘦身 | `slimBody` | 0-100 | 整体瘦身 |
| 长腿 | `longLeg` | 0-100 | 腿部拉伸 |
| 瘦腰 | `slimWaist` | 0-100 | 腰部收缩 |
| 窄肩 | `slimShoulder` | 0-100 | 肩部调整 |

### 滤镜预设
- 自然：清新、暖阳、清冷
- 人像：柔光、粉嫩、奶油
- 风格：胶片、黑白、戏剧
- 复古：复古、褪色

## 🏗️ 架构说明

```
lib/beauty/
├── types.ts          # TypeScript类型定义
├── constants.ts      # 常量和预设配置
├── core/
│   ├── FaceDetector.ts    # MediaPipe人脸检测 (478特征点)
│   ├── PoseDetector.ts    # MediaPipe身体检测 (33特征点)
│   ├── WebGLRenderer.ts   # WebGL渲染器
│   └── BeautyProcessor.ts # 主处理器
├── shaders/
│   └── index.ts      # WebGL着色器 (磨皮/美白/变形等)
└── hooks/
    ├── useBeautyProcessor.ts  # 基础Hook
    └── useVideoBeauty.ts      # 视频处理Hook
```

## ⚡ 性能优化

1. **GPU加速**: WebGL着色器在GPU上并行计算
2. **检测间隔**: 每2帧检测一次人脸/身体，减少计算量
3. **帧率控制**: 目标30FPS，自动跳帧
4. **懒加载模型**: 首次使用时从CDN加载

## 🔧 配置选项

```tsx
const config = {
  mode: 'video',               // 'video' | 'image'
  enableFaceDetection: true,   // 启用人脸检测
  enablePoseDetection: true,   // 启用身体检测
  maxFaces: 1,                 // 最大检测人脸数
  maxPoses: 1,                 // 最大检测身体数
  minDetectionConfidence: 0.5, // 检测置信度阈值
  minTrackingConfidence: 0.5,  // 跟踪置信度阈值
};
```

## 📝 待办事项

- [ ] LUT滤镜加载和应用
- [ ] 更多脸型调整效果（眼距、眼角等）
- [ ] Web Worker后台处理
- [ ] 导出时应用美颜效果
- [ ] 实时预览优化
