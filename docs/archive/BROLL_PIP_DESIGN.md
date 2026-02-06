# B-Roll PiP 增强功能设计文档

## 概述

本文档描述 B-Roll 功能的增强版本，新增以下核心能力：

1. **B-Roll 开关配置** - 用户可选择是否开启 B-Roll
2. **B-Roll 类型选择** - 支持全屏（Fullscreen）、PiP（画中画）、混合模式
3. **人脸检测与避让** - PiP B-Roll 自动避开人脸区域

---

## 一、B-Roll 配置选项设计

### 1.1 配置数据结构

```typescript
// 前端类型定义
interface BRollConfig {
  // 是否启用 B-Roll
  enabled: boolean;
  
  // B-Roll 显示模式
  // - fullscreen: 全屏覆盖（默认）
  // - pip: 画中画（小窗口叠加在人像上）
  // - mixed: 混合模式（AI 自动选择）
  displayMode: 'fullscreen' | 'pip' | 'mixed';
  
  // PiP 模式专属配置
  pipConfig?: {
    // PiP 窗口大小（相对于画面的百分比）
    size: 'small' | 'medium' | 'large'; // 20% | 30% | 40%
    
    // 默认位置（当未检测到人脸时使用）
    defaultPosition: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
    
    // 是否启用人脸避让
    faceAvoidance: boolean;
    
    // 边距（距离画面边缘的像素）
    margin: number; // 默认 20px
    
    // 圆角半径
    borderRadius: number; // 默认 12px
  };
  
  // 混合模式配置
  mixedConfig?: {
    // 全屏 B-Roll 的最小时长（毫秒）
    fullscreenMinDuration: number; // 默认 3000ms
    
    // PiP B-Roll 的最小时长（毫秒）
    pipMinDuration: number; // 默认 1500ms
    
    // 使用 PiP 的比例（0-1）
    pipRatio: number; // 默认 0.4，即 40% 用 PiP
  };
}
```

### 1.2 后端配置模型

```python
# backend/app/schemas/broll_config.py

from enum import Enum
from pydantic import BaseModel, Field
from typing import Optional


class BRollDisplayMode(str, Enum):
    """B-Roll 显示模式"""
    FULLSCREEN = "fullscreen"  # 全屏覆盖
    PIP = "pip"                # 画中画
    MIXED = "mixed"            # 混合模式


class PipSize(str, Enum):
    """PiP 窗口大小"""
    SMALL = "small"    # 20% of screen
    MEDIUM = "medium"  # 30% of screen
    LARGE = "large"    # 40% of screen


class PipPosition(str, Enum):
    """PiP 默认位置"""
    TOP_LEFT = "top-left"
    TOP_RIGHT = "top-right"
    BOTTOM_LEFT = "bottom-left"
    BOTTOM_RIGHT = "bottom-right"


class PipConfig(BaseModel):
    """PiP 模式配置"""
    size: PipSize = PipSize.MEDIUM
    default_position: PipPosition = PipPosition.BOTTOM_RIGHT
    face_avoidance: bool = True
    margin: int = Field(default=20, ge=0, le=100)
    border_radius: int = Field(default=12, ge=0, le=50)


class MixedConfig(BaseModel):
    """混合模式配置"""
    fullscreen_min_duration: int = Field(default=3000, ge=1000)
    pip_min_duration: int = Field(default=1500, ge=500)
    pip_ratio: float = Field(default=0.4, ge=0.0, le=1.0)


class BRollConfigRequest(BaseModel):
    """B-Roll 配置请求"""
    enabled: bool = True
    display_mode: BRollDisplayMode = BRollDisplayMode.FULLSCREEN
    pip_config: Optional[PipConfig] = None
    mixed_config: Optional[MixedConfig] = None
```

---

## 二、人脸检测与避让设计

### 2.1 技术方案

使用 **MediaPipe Face Detection** 进行轻量级人脸检测：
- 速度快：单帧 < 20ms
- 准确率高：99%+ 在正脸场景
- 支持多人脸检测
- 返回边界框 + 关键点

### 2.2 人脸检测服务

```python
# backend/app/services/face_detector.py

import mediapipe as mp
import cv2
import numpy as np
from dataclasses import dataclass
from typing import List, Optional, Tuple
import logging

logger = logging.getLogger(__name__)


@dataclass
class FaceRegion:
    """人脸区域"""
    x: float          # 左上角 X（0-1 归一化）
    y: float          # 左上角 Y（0-1 归一化）
    width: float      # 宽度（0-1 归一化）
    height: float     # 高度（0-1 归一化）
    confidence: float # 置信度


@dataclass
class FaceDetectionResult:
    """人脸检测结果"""
    faces: List[FaceRegion]
    frame_width: int
    frame_height: int
    timestamp_ms: int


class FaceDetector:
    """人脸检测器"""
    
    def __init__(self, min_confidence: float = 0.7):
        """
        初始化人脸检测器
        
        Args:
            min_confidence: 最小置信度阈值
        """
        self.min_confidence = min_confidence
        self.mp_face_detection = mp.solutions.face_detection
        self.detector = self.mp_face_detection.FaceDetection(
            model_selection=0,  # 0=近距离（2米内）1=远距离（5米内）
            min_detection_confidence=min_confidence,
        )
    
    def detect_from_frame(
        self, 
        frame: np.ndarray,
        timestamp_ms: int = 0
    ) -> FaceDetectionResult:
        """
        从单帧图像检测人脸
        
        Args:
            frame: BGR 格式的图像（OpenCV 格式）
            timestamp_ms: 帧时间戳
            
        Returns:
            FaceDetectionResult: 检测结果
        """
        height, width = frame.shape[:2]
        
        # 转换为 RGB
        rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        
        # 检测
        results = self.detector.process(rgb_frame)
        
        faces = []
        if results.detections:
            for detection in results.detections:
                bbox = detection.location_data.relative_bounding_box
                faces.append(FaceRegion(
                    x=max(0, bbox.xmin),
                    y=max(0, bbox.ymin),
                    width=min(1 - bbox.xmin, bbox.width),
                    height=min(1 - bbox.ymin, bbox.height),
                    confidence=detection.score[0],
                ))
        
        return FaceDetectionResult(
            faces=faces,
            frame_width=width,
            frame_height=height,
            timestamp_ms=timestamp_ms,
        )
    
    def detect_from_video(
        self,
        video_path: str,
        sample_interval_ms: int = 1000,
        max_samples: int = 30,
    ) -> List[FaceDetectionResult]:
        """
        从视频中采样检测人脸
        
        Args:
            video_path: 视频文件路径
            sample_interval_ms: 采样间隔（毫秒）
            max_samples: 最大采样数
            
        Returns:
            List[FaceDetectionResult]: 各帧检测结果
        """
        cap = cv2.VideoCapture(video_path)
        if not cap.isOpened():
            logger.error(f"无法打开视频: {video_path}")
            return []
        
        fps = cap.get(cv2.CAP_PROP_FPS)
        frame_interval = int(fps * sample_interval_ms / 1000)
        
        results = []
        frame_idx = 0
        sample_count = 0
        
        while cap.isOpened() and sample_count < max_samples:
            ret, frame = cap.read()
            if not ret:
                break
            
            if frame_idx % frame_interval == 0:
                timestamp_ms = int(frame_idx / fps * 1000)
                result = self.detect_from_frame(frame, timestamp_ms)
                results.append(result)
                sample_count += 1
            
            frame_idx += 1
        
        cap.release()
        return results
    
    def get_safe_pip_region(
        self,
        faces: List[FaceRegion],
        pip_size: float = 0.3,
        margin: float = 0.02,
        preferred_position: str = "bottom-right",
    ) -> Tuple[float, float]:
        """
        计算 PiP 窗口的安全位置（避开人脸）
        
        Args:
            faces: 检测到的人脸列表
            pip_size: PiP 窗口大小（相对于画面宽度的比例）
            margin: 边距（相对于画面的比例）
            preferred_position: 首选位置
            
        Returns:
            Tuple[x, y]: PiP 左上角位置（0-1 归一化）
        """
        # 定义四个角落的候选位置
        positions = {
            "top-left": (margin, margin),
            "top-right": (1 - pip_size - margin, margin),
            "bottom-left": (margin, 1 - pip_size - margin),
            "bottom-right": (1 - pip_size - margin, 1 - pip_size - margin),
        }
        
        # 如果没有检测到人脸，返回首选位置
        if not faces:
            return positions.get(preferred_position, positions["bottom-right"])
        
        # 计算每个位置与人脸区域的重叠度
        def calc_overlap(pos: Tuple[float, float]) -> float:
            pip_x, pip_y = pos
            pip_rect = (pip_x, pip_y, pip_x + pip_size, pip_y + pip_size)
            
            total_overlap = 0
            for face in faces:
                face_rect = (
                    face.x,
                    face.y,
                    face.x + face.width,
                    face.y + face.height,
                )
                # 计算交集面积
                inter_x1 = max(pip_rect[0], face_rect[0])
                inter_y1 = max(pip_rect[1], face_rect[1])
                inter_x2 = min(pip_rect[2], face_rect[2])
                inter_y2 = min(pip_rect[3], face_rect[3])
                
                if inter_x2 > inter_x1 and inter_y2 > inter_y1:
                    total_overlap += (inter_x2 - inter_x1) * (inter_y2 - inter_y1)
            
            return total_overlap
        
        # 按重叠度排序，选择重叠最少的位置
        position_scores = [
            (name, pos, calc_overlap(pos))
            for name, pos in positions.items()
        ]
        position_scores.sort(key=lambda x: x[2])
        
        # 优先选择重叠为 0 的位置中，与首选位置最近的
        zero_overlap = [p for p in position_scores if p[2] == 0]
        if zero_overlap:
            # 如果首选位置无重叠，使用首选位置
            for name, pos, _ in zero_overlap:
                if name == preferred_position:
                    return pos
            # 否则返回第一个无重叠位置
            return zero_overlap[0][1]
        
        # 如果所有位置都有重叠，返回重叠最少的
        return position_scores[0][1]
    
    def close(self):
        """释放资源"""
        self.detector.close()
```

### 2.3 人脸区域缓存

为避免重复检测，使用 Redis 缓存人脸检测结果：

```python
# backend/app/services/face_detection_cache.py

import json
import hashlib
from typing import Optional, List
from app.services.face_detector import FaceDetectionResult, FaceRegion
from app.config import redis_client

CACHE_PREFIX = "face_detection:"
CACHE_TTL = 86400 * 7  # 7 天


def get_cache_key(video_path: str) -> str:
    """生成缓存键"""
    path_hash = hashlib.md5(video_path.encode()).hexdigest()
    return f"{CACHE_PREFIX}{path_hash}"


def cache_detection_results(
    video_path: str,
    results: List[FaceDetectionResult],
):
    """缓存检测结果"""
    key = get_cache_key(video_path)
    data = [
        {
            "faces": [
                {
                    "x": f.x, "y": f.y,
                    "width": f.width, "height": f.height,
                    "confidence": f.confidence,
                }
                for f in r.faces
            ],
            "frame_width": r.frame_width,
            "frame_height": r.frame_height,
            "timestamp_ms": r.timestamp_ms,
        }
        for r in results
    ]
    redis_client.setex(key, CACHE_TTL, json.dumps(data))


def get_cached_results(video_path: str) -> Optional[List[FaceDetectionResult]]:
    """获取缓存的检测结果"""
    key = get_cache_key(video_path)
    data = redis_client.get(key)
    if not data:
        return None
    
    results = []
    for item in json.loads(data):
        faces = [
            FaceRegion(
                x=f["x"], y=f["y"],
                width=f["width"], height=f["height"],
                confidence=f["confidence"],
            )
            for f in item["faces"]
        ]
        results.append(FaceDetectionResult(
            faces=faces,
            frame_width=item["frame_width"],
            frame_height=item["frame_height"],
            timestamp_ms=item["timestamp_ms"],
        ))
    return results
```

---

## 三、API 接口设计

### 3.1 保存 B-Roll 配置

```python
# 扩展现有 WorkflowConfigRequest

class WorkflowConfigRequest(BaseModel):
    """工作流配置请求"""
    # 现有字段
    pip_enabled: bool = False
    pip_position: Optional[str] = "bottom-right"
    pip_size: Optional[str] = "medium"
    
    # ★ 新增 B-Roll 配置
    broll_enabled: bool = False
    broll_display_mode: str = "fullscreen"  # fullscreen | pip | mixed
    broll_pip_config: Optional[dict] = None  # PiP 专属配置
    broll_mixed_config: Optional[dict] = None  # 混合模式配置
    
    background_preset: Optional[str] = None
```

### 3.2 获取人脸检测结果

```
POST /api/workspace/sessions/{session_id}/detect-faces
```

**请求**：
```json
{
  "asset_id": "uuid",
  "sample_interval_ms": 1000,
  "max_samples": 20
}
```

**响应**：
```json
{
  "status": "ok",
  "faces": [
    {
      "timestamp_ms": 0,
      "faces": [
        {
          "x": 0.2,
          "y": 0.1,
          "width": 0.3,
          "height": 0.4,
          "confidence": 0.98
        }
      ]
    }
  ],
  "dominant_region": {
    "x": 0.25,
    "y": 0.15,
    "width": 0.35,
    "height": 0.45
  },
  "safe_pip_positions": ["top-left", "bottom-right"]
}
```

### 3.3 生成 B-Roll Clips（增强版）

更新现有 API，支持 `display_mode` 选择：

```
POST /api/workspace/sessions/{session_id}/generate-broll-clips
```

**请求**：
```json
{
  "display_mode": "mixed",
  "pip_config": {
    "size": "medium",
    "default_position": "bottom-right",
    "face_avoidance": true
  }
}
```

---

## 四、前端 UI 设计

### 4.1 B-Roll 配置面板

在 `WorkflowModal` 的 config 步骤中新增 B-Roll 配置区：

```
┌─────────────────────────────────────────────────────────────┐
│  🎬 B-Roll 设置                                              │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  [ ] 启用 B-Roll 自动插入                                    │
│                                                             │
│  ─────────────────────────────────────────────────────────  │
│                                                             │
│  显示模式：                                                  │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐       │
│  │  📺 全屏     │  │  🖼️ 画中画   │  │  🔀 智能混合  │       │
│  │  Fullscreen  │  │    PiP       │  │    Mixed     │       │
│  └──────────────┘  └──────────────┘  └──────────────┘       │
│                                                             │
│  ─────────────────────────────────────────────────────────  │
│                                                             │
│  🖼️ 画中画设置（仅 PiP/Mixed 模式）                           │
│                                                             │
│  窗口大小：  [小] [中] [大]                                   │
│  默认位置：  [左上] [右上] [左下] [右下]                       │
│  [✓] 自动避开人脸                                            │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 4.2 实时预览

提供可视化预览，展示 PiP 窗口位置与人脸区域的关系：

```
┌─────────────────────────────────────────────────────────────┐
│                    预览画面                                  │
│  ┌───────────────────────────────────────────────────┐      │
│  │                                                   │      │
│  │              ┌───────┐                           │      │
│  │              │  👤   │  ← 人脸区域（虚线标注）     │      │
│  │              │       │                           │      │
│  │              └───────┘                           │      │
│  │                                                   │      │
│  │                                   ┌─────────┐    │      │
│  │                                   │ B-Roll  │    │      │
│  │                                   │  PiP    │    │      │
│  │                                   └─────────┘    │      │
│  └───────────────────────────────────────────────────┘      │
│                                                             │
│  ✅ 无遮挡冲突                                               │
└─────────────────────────────────────────────────────────────┘
```

---

## 五、Remotion 渲染适配

### 5.1 PiP B-Roll 组件配置

```typescript
interface PipBRollConfig {
  // 基础信息
  id: string;
  type: 'broll';
  start_ms: number;
  end_ms: number;
  
  // PiP 专属
  display_mode: 'pip';
  pip_position: {
    x: number;  // 0-1 归一化
    y: number;  // 0-1 归一化
  };
  pip_size: number;  // 相对于画面宽度的比例
  border_radius: number;
  
  // 人脸避让信息
  face_regions?: Array<{
    x: number;
    y: number;
    width: number;
    height: number;
  }>;
  
  // 资源
  asset_url: string;
  asset_id: string;
  
  // 过渡动画
  transition_in: 'fade' | 'slide' | 'scale';
  transition_out: 'fade' | 'slide' | 'scale';
}
```

### 5.2 前端渲染组件

```tsx
// frontend/src/remotion/components/PipBRoll.tsx

import { AbsoluteFill, Img, Video, interpolate, useCurrentFrame } from 'remotion';

interface PipBRollProps {
  config: PipBRollConfig;
  canvasWidth: number;
  canvasHeight: number;
}

export function PipBRoll({ config, canvasWidth, canvasHeight }: PipBRollProps) {
  const frame = useCurrentFrame();
  
  // 计算实际像素位置
  const pipWidth = canvasWidth * config.pip_size;
  const pipHeight = pipWidth * 9 / 16; // 保持 16:9 比例
  const pipX = config.pip_position.x * canvasWidth;
  const pipY = config.pip_position.y * canvasHeight;
  
  // 入场动画
  const opacity = interpolate(
    frame,
    [0, 15],
    [0, 1],
    { extrapolateRight: 'clamp' }
  );
  
  const scale = interpolate(
    frame,
    [0, 15],
    [0.8, 1],
    { extrapolateRight: 'clamp' }
  );
  
  return (
    <div
      style={{
        position: 'absolute',
        left: pipX,
        top: pipY,
        width: pipWidth,
        height: pipHeight,
        borderRadius: config.border_radius,
        overflow: 'hidden',
        opacity,
        transform: `scale(${scale})`,
        boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
      }}
    >
      <Video
        src={config.asset_url}
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'cover',
        }}
      />
    </div>
  );
}
```

---

## 六、实现计划

### Phase 1: 基础配置（1-2 天）

1. [ ] 后端：新增 `BRollDisplayMode` 枚举和配置模型
2. [ ] 后端：扩展 `WorkflowConfigRequest` 支持新配置
3. [ ] 前端：WorkflowModal 新增 B-Roll 配置 UI
4. [ ] 前端：配置状态持久化

### Phase 2: 人脸检测（2-3 天）

1. [ ] 后端：实现 `FaceDetector` 服务
2. [ ] 后端：添加 Redis 缓存层
3. [ ] 后端：新增 `/detect-faces` API
4. [ ] 前端：集成人脸检测结果显示

### Phase 3: PiP 位置计算（1-2 天）

1. [ ] 后端：实现 `get_safe_pip_region()` 算法
2. [ ] 后端：更新 B-Roll clip 生成逻辑
3. [ ] 前端：预览画面显示人脸区域和 PiP 位置

### Phase 4: Remotion 适配（2-3 天）

1. [ ] 前端：实现 `PipBRoll` 渲染组件
2. [ ] 前端：支持入场/退场动画
3. [ ] 后端：更新 Remotion 配置生成器
4. [ ] 测试：E2E 渲染测试

### Phase 5: 混合模式（1-2 天）

1. [ ] 后端：实现混合模式决策逻辑
2. [ ] 后端：根据内容类型自动选择 fullscreen/pip
3. [ ] 前端：混合模式配置 UI

---

## 七、依赖项

### Python 包

```txt
# requirements_ai.txt 新增
mediapipe>=0.10.0
```

### 前端无新增依赖

---

## 八、测试用例

### 8.1 人脸检测测试

```python
def test_face_detection():
    detector = FaceDetector()
    
    # 测试单帧检测
    frame = cv2.imread("test_face.jpg")
    result = detector.detect_from_frame(frame)
    assert len(result.faces) >= 1
    assert result.faces[0].confidence > 0.7

def test_pip_position_avoidance():
    detector = FaceDetector()
    
    # 模拟人脸在右下角
    faces = [FaceRegion(x=0.6, y=0.6, width=0.3, height=0.3, confidence=0.9)]
    
    # 期望 PiP 避开右下角
    pos = detector.get_safe_pip_region(faces, pip_size=0.3, preferred_position="bottom-right")
    
    # 应该返回其他角落
    assert pos != (0.68, 0.68)  # 不应该在右下角
```

### 8.2 配置持久化测试

```python
def test_broll_config_save_and_load():
    # 保存配置
    config = {
        "broll_enabled": True,
        "broll_display_mode": "pip",
        "broll_pip_config": {
            "size": "medium",
            "default_position": "top-left",
            "face_avoidance": True,
        }
    }
    
    response = client.post(
        f"/api/workspace/sessions/{session_id}/workflow-config",
        json=config
    )
    assert response.status_code == 200
    
    # 读取配置
    response = client.get(f"/api/workspace/sessions/{session_id}/workflow-config")
    data = response.json()
    assert data["broll_display_mode"] == "pip"
    assert data["broll_pip_config"]["face_avoidance"] == True
```

---

## 九、FAQ

### Q: 为什么选择 MediaPipe 而不是其他人脸检测方案？

A: MediaPipe 优势：
- 轻量级：无需 GPU，CPU 即可高效运行
- 精度高：Google 持续优化
- 跨平台：支持 Python/JS/Mobile
- 免费开源：无许可费用

### Q: PiP 窗口大小如何确定？

A: 基于用户体验研究：
- Small (20%): 适合辅助性内容，不喧宾夺主
- Medium (30%): 平衡展示效果和主内容
- Large (40%): 强调 B-Roll 内容，适合产品展示

### Q: 如果四个角落都与人脸重叠怎么办？

A: 算法会：
1. 计算每个角落与人脸的重叠面积
2. 选择重叠面积最小的位置
3. 如果重叠过大（>50%），可考虑切换到 fullscreen 模式
