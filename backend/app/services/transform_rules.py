"""
运镜规则引擎 (Transform Rule Engine)

可扩展的规则系统，用于根据内容分析结果生成运镜参数。
当前阶段聚焦：AI修改视频比例（情绪→缩放比例映射）

设计原则：
1. 策略模式 - 每种规则独立封装，便于扩展
2. 规则链 - 多个规则可组合叠加
3. 配置驱动 - 参数可通过配置调整，无需改代码

后续扩展方向（本阶段不实现）：
- TransitionRule: 转场规则
- EffectRule: 特效规则
- BGMRule: 背景音乐规则
"""

import logging
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Any, Tuple
from enum import Enum

logger = logging.getLogger(__name__)


# ============================================
# 配置常量
# ============================================

# 精度常量：4位小数，与前端统一
# 确保动画平滑且避免浮点误差
PRECISION = 4

def round_precision(value: float) -> float:
    """
    四舍五入到统一精度（4位小数）
    与前端 keyframe-interpolation.ts 保持一致
    """
    return round(value, PRECISION)

# 画面中心点坐标（归一化）
DEFAULT_CENTER_X = 0.5
DEFAULT_CENTER_Y = 0.5

# 位移计算放大系数：控制镜头推进的强度
# ★ 增大到 15，确保在 UI（精度 0.1）上能看到变化
# 计算示例：人脸在 y=0.35，scale=1.1 时
# push_distance = 0.1 × 0.5 = 0.05
# offset_y = -0.15 × 0.05 × 15 = -0.1125 ≈ -0.1（在 UI 上可见）
POSITION_AMPLIFY_FACTOR = 15.0

# 安全边距保留比例：防止黑边的安全余量
SAFETY_MARGIN_RATIO = 0.9  # 留 10% 安全余量

# 时长阈值（秒）
MIN_DURATION_FOR_FACE_ZOOM = 1.0   # 有人脸时需要 > 1 秒才应用缩放规则
MIN_DURATION_FOR_NO_FACE_ZOOM = 2.0  # 无人脸时需要 > 2 秒才应用缩放规则
SHORT_CLIP_THRESHOLD = 1.5  # 短片段阈值

# 位移推进系数：控制镜头推进的平滑度
PUSH_DISTANCE_FACTOR = 0.5  # 乘以 0.5 是为了让推进效果适中


# ============================================
# 基础类型定义
# ============================================

class EmotionType(str, Enum):
    """情绪类型"""
    NEUTRAL = "neutral"
    EXCITED = "excited"
    SERIOUS = "serious"
    HAPPY = "happy"
    SAD = "sad"


class ImportanceLevel(str, Enum):
    """重要性级别"""
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"


class EasingType(str, Enum):
    """缓动函数类型"""
    LINEAR = "linear"
    EASE_IN = "ease-in"
    EASE_OUT = "ease-out"
    EASE_IN_OUT = "ease-in-out"
    ELASTIC = "elastic"  # 弹性效果，用于强调


class ZoomStrategy(str, Enum):
    """
    缩放策略类型
    
    - KEYFRAME: 关键帧渐变（start→end），有推进感
    - INSTANT: 直接放大，首帧就到位，适合突然强调
    - STATIC: 不放大，保持原样
    """
    KEYFRAME = "keyframe"  # 关键帧缩放（渐变）
    INSTANT = "instant"    # 直接放大（首帧即放大）
    STATIC = "static"      # 不放大


@dataclass
class TransformParams:
    """
    运镜参数（决策引擎输出）
    
    方案 B：使用位移补偿实现人脸居中放大
    - 前端只需 translate + scale，无需处理 transform-origin
    - 后端计算好位移，前端零改动
    
    Attributes:
        strategy: 缩放策略（关键帧/直接/不放大）
        start_scale: 起始缩放比例 (1.0 = 100%)
        end_scale: 结束缩放比例
        position_x: X轴位移 (归一化，-0.5~0.5)
        position_y: Y轴位移 (归一化，-0.5~0.5)
        rotation: 旋转角度
        easing: 缓动函数
        rule_applied: 应用的规则名称（用于调试）
    """
    strategy: ZoomStrategy = ZoomStrategy.KEYFRAME
    start_scale: float = 1.0
    end_scale: float = 1.0
    position_x: float = 0.0
    position_y: float = 0.0
    rotation: float = 0.0
    easing: EasingType = EasingType.LINEAR
    rule_applied: str = "none"
    
    @staticmethod
    def calculate_safe_anchor(
        face_x: float, 
        face_y: float, 
        scale: float
    ) -> Tuple[float, float]:
        """
        计算安全的变换原点，确保放大后不会出现黑边
        
        原理：
        - 放大 scale 倍后，可视区域是原始画面的 1/scale
        - 变换原点必须在 "安全区域" 内，才能保证放大后不露黑边
        - 安全边距 margin = (scale - 1) / (2 * scale)
        
        Examples:
            scale=1.3: margin≈0.115, 安全范围=[0.115, 0.885]
            scale=1.5: margin≈0.167, 安全范围=[0.167, 0.833]
            scale=2.0: margin=0.25,  安全范围=[0.25,  0.75]
        """
        if scale <= 1.0:
            return (DEFAULT_CENTER_X, DEFAULT_CENTER_Y)  # 不放大时，原点无所谓
        
        # 计算安全边距
        margin = (scale - 1) / (2 * scale)
        
        # 钳制到安全范围
        safe_x = max(margin, min(1 - margin, face_x))
        safe_y = max(margin, min(1 - margin, face_y))
        
        return (safe_x, safe_y)
    
    @staticmethod
    def calculate_position_offset(
        face_x: float,
        face_y: float,
        scale: float
    ) -> Tuple[float, float]:
        """
        计算镜头推进效果的位移
        
        设计理念："镜头向目标推进并放大"
        - 位移方向：从画面中心指向人脸位置
        - 位移量：与缩放幅度成比例，产生协调的推进感
        
        公式：
        offset = (face_pos - 0.5) * push_distance
        
        其中 push_distance 由 scale 决定：
        - scale=1.08 → 放大8%，push_distance = 0.04（向目标推进4%画面高度）
        - scale=1.15 → 放大15%，push_distance = 0.075
        - scale=1.30 → 放大30%，push_distance = 0.15
        
        Examples:
            人脸在 (0.5, 0.3)（画面上方 20%），放大 1.08 倍:
            push_distance = 0.08 * 0.5 = 0.04
            offset_y = (0.3 - 0.5) * 0.04 / 0.2 = -0.04 (向上推进 4%，约43像素)
            
            人脸在画面中心 (0.5, 0.5)，放大 1.08 倍:
            offset_y = (0.5 - 0.5) * 任何值 = 0 (不位移，只放大)
        
        Returns:
            (position_x, position_y): 归一化位移 (-0.5 ~ 0.5)
        """
        if scale <= 1.0:
            return (0.0, 0.0)
        
        # 推进距离：与缩放幅度成比例
        push_distance = (scale - 1) * PUSH_DISTANCE_FACTOR
        
        # 人脸偏离中心的方向和距离
        face_offset_x = face_x - DEFAULT_CENTER_X  # 负=左，正=右
        face_offset_y = face_y - DEFAULT_CENTER_Y  # 负=上，正=下
        
        # 向人脸方向推进（offset 与 face_offset 同向）
        # 放大 face_offset 的影响，让推进效果更明显
        offset_x = face_offset_x * push_distance * POSITION_AMPLIFY_FACTOR
        offset_y = face_offset_y * push_distance * POSITION_AMPLIFY_FACTOR
        
        # 安全限制：确保不超出边界（防止黑边）
        # ★ 放宽限制：直接用 (scale-1)/2 作为最大位移，确保在 UI 上可见
        # scale=1.1 → max_offset=0.05, 但我们希望至少能达到 0.1
        # 因此不再限制太严，让视觉效果更明显
        margin = (scale - 1) / 2 if scale > 1 else 0  # 理论最大安全边距
        max_offset = max(margin * 2, 0.15)  # ★ 放宽到至少 0.15，确保 UI 能显示
        
        offset_x = max(-max_offset, min(max_offset, offset_x))
        offset_y = max(-max_offset, min(max_offset, offset_y))
        
        return (offset_x, offset_y)
    
    def get_meta(self) -> Dict:
        """
        获取 transform 元信息（存入 clip.transform 字段）
        
        Returns:
            {enable_animation, _rule_applied, _strategy, start_scale, end_scale, position_x, position_y, rotation, easing}
        """
        # 基础信息（所有策略共用）
        base_meta = {
            "start_scale": self.start_scale,
            "end_scale": self.end_scale,
            "position_x": self.position_x,
            "position_y": self.position_y,
            "rotation": self.rotation,
            "easing": self.easing.value if hasattr(self.easing, 'value') else str(self.easing),
        }
        
        # 判断是否有动画
        if self.strategy == ZoomStrategy.STATIC:
            return {
                **base_meta,
                "enable_animation": False,
                "_rule_applied": self.rule_applied,
                "_strategy": "static"
            }
        elif self.strategy == ZoomStrategy.INSTANT:
            has_transform = (
                abs(self.end_scale - 1.0) > 0.001 or
                abs(self.position_x) > 0.001 or
                abs(self.position_y) > 0.001 or
                abs(self.rotation) > 0.001
            )
            return {
                **base_meta,
                "enable_animation": False,
                "_rule_applied": self.rule_applied,
                "_strategy": "instant" if has_transform else "instant_no_change"
            }
        else:
            has_animation = (
                abs(self.start_scale - self.end_scale) > 0.001 or
                abs(self.position_x) > 0.001 or
                abs(self.position_y) > 0.001 or
                abs(self.rotation) > 0.001
            )
            return {
                **base_meta,
                "enable_animation": has_animation,
                "_rule_applied": self.rule_applied,
                "_strategy": "keyframe" if has_animation else "keyframe_no_change"
            }
    
    def get_keyframes_for_db(self, clip_id: str, duration_ms: float) -> List[Dict]:
        """
        生成 keyframes 表记录（直接存入数据库）
        
        Args:
            clip_id: 关联的 clip ID
            duration_ms: clip 时长（毫秒）
            
        Returns:
            keyframes 表记录列表，格式：
            [{id, clip_id, property, offset, value, easing, created_at, updated_at}, ...]
        """
        from uuid import uuid4
        from datetime import datetime
        
        now = datetime.utcnow().isoformat()
        result = []

        strategy_label = self.strategy.value if hasattr(self.strategy, "value") else str(self.strategy)
        logger.info(
            f"[Keyframes] build clip={clip_id[:8]} strategy={strategy_label} "
            f"start_scale={self.start_scale:.3f} end_scale={self.end_scale:.3f} "
            f"pos=({self.position_x:.3f},{self.position_y:.3f}) rot={self.rotation:.3f} "
            f"duration_ms={duration_ms:.0f}"
        )
        
        # 避免除零
        if duration_ms <= 0:
            duration_ms = 1
        
        # STATIC 策略：无关键帧
        if self.strategy == ZoomStrategy.STATIC:
            logger.info(f"[Keyframes] skip clip={clip_id[:8]} reason=static")
            return []
        
        # INSTANT 策略：静态变换（首尾帧相同）
        if self.strategy == ZoomStrategy.INSTANT:
            has_transform = (
                abs(self.end_scale - 1.0) > 0.001 or
                abs(self.position_x) > 0.001 or
                abs(self.position_y) > 0.001 or
                abs(self.rotation) > 0.001
            )
            if not has_transform:
                logger.info(f"[Keyframes] skip clip={clip_id[:8]} reason=instant_no_change")
                return []
            
            # ★ 使用统一精度（4位小数）确保与前端一致
            end_scale_val = round_precision(self.end_scale)
            position_x_val = round_precision(self.position_x)
            position_y_val = round_precision(self.position_y)
            rotation_val = round_precision(self.rotation)
            
            # 生成首尾帧（相同值）
            for offset in [0, 1]:
                easing = "ease_in_out" if offset == 0 else "linear"
                
                # scale: 统一使用 {x, y} 复合格式
                if abs(self.end_scale - 1.0) > 0.001:
                    result.append({
                        "id": str(uuid4()),
                        "clip_id": clip_id,
                        "property": "scale",
                        "offset": offset,
                        "value": {"x": end_scale_val, "y": end_scale_val},
                        "easing": easing,
                        "created_at": now,
                        "updated_at": now,
                    })
                
                # position
                if abs(self.position_x) > 0.001 or abs(self.position_y) > 0.001:
                    result.append({
                        "id": str(uuid4()),
                        "clip_id": clip_id,
                        "property": "position",
                        "offset": offset,
                        "value": {"x": position_x_val, "y": position_y_val},
                        "easing": easing,
                        "created_at": now,
                        "updated_at": now,
                    })
                
                # rotation
                if abs(self.rotation) > 0.001:
                    result.append({
                        "id": str(uuid4()),
                        "clip_id": clip_id,
                        "property": "rotation",
                        "offset": offset,
                        "value": rotation_val,
                        "easing": easing,
                        "created_at": now,
                        "updated_at": now,
                    })
            
            return result
        
        # KEYFRAME 策略：动画变换
        # 分别判断每个属性是否有变化
        has_scale_change = abs(self.start_scale - self.end_scale) > 0.001
        has_position_change = abs(self.position_x) > 0.001 or abs(self.position_y) > 0.001
        has_rotation_change = abs(self.rotation) > 0.001
        
        has_animation = has_scale_change or has_position_change or has_rotation_change
        if not has_animation:
            logger.info(f"[Keyframes] skip clip={clip_id[:8]} reason=keyframe_no_change")
            return []
        
        # 只生成有变化的属性的关键帧
        logger.info(
            f"[Keyframes] generate clip={clip_id[:8]} "
            f"scale_change={has_scale_change} pos_change={has_position_change} rot_change={has_rotation_change}"
        )
        
        # ★ 使用统一精度（4位小数）确保与前端一致
        start_scale_val = round_precision(self.start_scale)
        end_scale_val = round_precision(self.end_scale)
        position_x_val = round_precision(self.position_x)
        position_y_val = round_precision(self.position_y)
        rotation_val = round_precision(self.rotation)
        
        # scale: 只在有缩放变化时生成，统一使用 {x, y} 复合格式
        if has_scale_change:
            result.append({
                "id": str(uuid4()),
                "clip_id": clip_id,
                "property": "scale",
                "offset": 0,
                "value": {"x": start_scale_val, "y": start_scale_val},
                "easing": "ease_in_out",
                "created_at": now,
                "updated_at": now,
            })
            result.append({
                "id": str(uuid4()),
                "clip_id": clip_id,
                "property": "scale",
                "offset": 1,
                "value": {"x": end_scale_val, "y": end_scale_val},
                "easing": self.easing.value,
                "created_at": now,
                "updated_at": now,
            })
        
        # position: 只在有位移变化时生成
        if has_position_change:
            result.append({
                "id": str(uuid4()),
                "clip_id": clip_id,
                "property": "position",
                "offset": 0,
                "value": {"x": 0, "y": 0},
                "easing": "ease_in_out",
                "created_at": now,
                "updated_at": now,
            })
            result.append({
                "id": str(uuid4()),
                "clip_id": clip_id,
                "property": "position",
                "offset": 1,
                "value": {"x": position_x_val, "y": position_y_val},
                "easing": self.easing.value,
                "created_at": now,
                "updated_at": now,
            })
        
        # rotation: 只在有旋转变化时生成
        if has_rotation_change:
            result.append({
                "id": str(uuid4()),
                "clip_id": clip_id,
                "property": "rotation",
                "offset": 0,
                "value": 0,
                "easing": "ease_in_out",
                "created_at": now,
                "updated_at": now,
            })
            result.append({
                "id": str(uuid4()),
                "clip_id": clip_id,
                "property": "rotation",
                "offset": 1,
                "value": self.rotation,
                "easing": self.easing.value,
                "created_at": now,
                "updated_at": now,
            })
        
        return result


@dataclass
class SegmentContext:
    """
    片段上下文（规则引擎输入）
    
    整合视觉分析和语义分析的结果，作为规则判断的依据。
    """
    # 基础信息
    segment_id: str
    duration_ms: float
    text: str = ""
    
    # 视觉特征
    has_face: bool = False
    face_center_x: float = 0.5
    face_center_y: float = 0.5
    face_ratio: float = 0.0  # 人脸占画面比例
    
    # 语义特征（来自 LLM）
    emotion: EmotionType = EmotionType.NEUTRAL
    importance: ImportanceLevel = ImportanceLevel.MEDIUM
    keywords: List[str] = field(default_factory=list)
    
    # 元数据
    is_breath: bool = False  # 是否为换气片段
    metadata: Dict = field(default_factory=dict)
    
    @property
    def is_emphasis(self) -> bool:
        """是否为强调片段（Sudden Zoom）"""
        return self.metadata.get("is_emphasis", False)
    
    @property
    def duration_seconds(self) -> float:
        return self.duration_ms / 1000.0


# ============================================
# 规则基类（策略模式）
# ============================================

class TransformRule(ABC):
    """
    运镜规则基类
    
    所有规则必须实现：
    - match(): 判断是否适用于当前片段
    - apply(): 生成运镜参数
    """
    
    # 规则名称
    name: str = "base_rule"
    
    # 规则优先级（数字越小优先级越高）
    priority: int = 100
    
    @abstractmethod
    def match(self, context: SegmentContext) -> bool:
        """判断规则是否匹配当前片段"""
        pass
    
    @abstractmethod
    def apply(self, context: SegmentContext) -> TransformParams:
        """生成运镜参数"""
        pass


# ============================================
# 缩放规则实现（本阶段核心）
# ============================================

class EmotionZoomRule(TransformRule):
    """
    情绪驱动的缩放规则
    
    核心逻辑：根据情绪类型和重要性级别，映射到不同的缩放策略和参数。
    
    策略映射：
    ┌─────────┬───────────┬──────────┬──────────────┬─────────────┐
    │ 情绪     │ 重要性    │ 策略      │ 缩放比例      │ 缓动        │
    ├─────────┼───────────┼──────────┼──────────────┼─────────────┤
    │ excited │ high      │ INSTANT  │ 1.35         │ -           │
    │ excited │ medium    │ KEYFRAME │ 1.10 → 1.25  │ ease-out    │
    │ excited │ low       │ KEYFRAME │ 1.05 → 1.15  │ ease-out    │
    │ serious │ high      │ KEYFRAME │ 1.08 → 1.25  │ linear      │
    │ serious │ medium    │ KEYFRAME │ 1.05 → 1.18  │ linear      │
    │ serious │ low       │ KEYFRAME │ 1.00 → 1.10  │ linear      │
    │ happy   │ high      │ KEYFRAME │ 1.00 → 1.15  │ ease-in-out │
    │ happy   │ medium    │ KEYFRAME │ 1.00 → 1.10  │ ease-in-out │
    │ happy   │ low       │ STATIC   │ 1.0          │ -           │
    │ sad     │ high      │ KEYFRAME │ 1.05 → 1.00  │ ease-in     │
    │ sad     │ medium    │ STATIC   │ 1.0          │ -           │
    │ sad     │ low       │ STATIC   │ 1.0          │ -           │
    │ neutral │ high      │ KEYFRAME │ 1.05 → 1.18  │ linear      │
    │ neutral │ medium    │ KEYFRAME │ 1.00 → 1.08  │ linear      │
    │ neutral │ low       │ STATIC   │ 1.0          │ -           │
    └─────────┴───────────┴──────────┴──────────────┴─────────────┘
    
    策略说明：
    - INSTANT: 适合突然强调、惊讶、高潮点
    - KEYFRAME: 适合情绪递进、推进感
    - STATIC: 适合平淡叙述、不需要强调的内容
    """
    
    name = "emotion_zoom"
    priority = 10
    
    # 情绪-重要性 → (策略, start_scale, end_scale, easing)
    # 2026-01-20: 提升缩放幅度，确保效果可见
    ZOOM_MAPPING = {
        # excited: 高潮直接放大，中低用渐变
        (EmotionType.EXCITED, ImportanceLevel.HIGH): (ZoomStrategy.INSTANT, 1.0, 1.25, EasingType.EASE_OUT),
        (EmotionType.EXCITED, ImportanceLevel.MEDIUM): (ZoomStrategy.KEYFRAME, 1.0, 1.18, EasingType.EASE_OUT),
        (EmotionType.EXCITED, ImportanceLevel.LOW): (ZoomStrategy.KEYFRAME, 1.0, 1.12, EasingType.EASE_OUT),
        
        # serious: 严肃渐进，更有力量感
        (EmotionType.SERIOUS, ImportanceLevel.HIGH): (ZoomStrategy.KEYFRAME, 1.0, 1.18, EasingType.LINEAR),
        (EmotionType.SERIOUS, ImportanceLevel.MEDIUM): (ZoomStrategy.KEYFRAME, 1.0, 1.12, EasingType.LINEAR),
        (EmotionType.SERIOUS, ImportanceLevel.LOW): (ZoomStrategy.KEYFRAME, 1.0, 1.08, EasingType.LINEAR),
        
        # happy: 轻快，低重要性不放大
        (EmotionType.HAPPY, ImportanceLevel.HIGH): (ZoomStrategy.KEYFRAME, 1.0, 1.15, EasingType.EASE_IN_OUT),
        (EmotionType.HAPPY, ImportanceLevel.MEDIUM): (ZoomStrategy.KEYFRAME, 1.0, 1.10, EasingType.EASE_IN_OUT),
        (EmotionType.HAPPY, ImportanceLevel.LOW): (ZoomStrategy.STATIC, 1.0, 1.0, EasingType.LINEAR),
        
        # sad: 收缩感，或静止
        (EmotionType.SAD, ImportanceLevel.HIGH): (ZoomStrategy.KEYFRAME, 1.08, 1.0, EasingType.EASE_IN),
        (EmotionType.SAD, ImportanceLevel.MEDIUM): (ZoomStrategy.STATIC, 1.0, 1.0, EasingType.LINEAR),
        (EmotionType.SAD, ImportanceLevel.LOW): (ZoomStrategy.STATIC, 1.0, 1.0, EasingType.LINEAR),
        
        # neutral: 常见情绪，需要明显的推镜效果
        (EmotionType.NEUTRAL, ImportanceLevel.HIGH): (ZoomStrategy.KEYFRAME, 1.0, 1.15, EasingType.LINEAR),
        (EmotionType.NEUTRAL, ImportanceLevel.MEDIUM): (ZoomStrategy.KEYFRAME, 1.0, 1.10, EasingType.LINEAR),
        (EmotionType.NEUTRAL, ImportanceLevel.LOW): (ZoomStrategy.STATIC, 1.0, 1.0, EasingType.LINEAR),
    }
    
    # 默认参数（无匹配时使用）
    DEFAULT_PARAMS = (ZoomStrategy.KEYFRAME, 1.0, 1.10, EasingType.LINEAR)
    
    def match(self, context: SegmentContext) -> bool:
        """
        匹配条件：
        1. 有人脸的片段优先使用此规则
        2. 时长 > MIN_DURATION_FOR_FACE_ZOOM 秒的片段
        """
        if context.is_breath:
            return False
        return context.has_face and context.duration_seconds > MIN_DURATION_FOR_FACE_ZOOM
    
    def apply(self, context: SegmentContext) -> TransformParams:
        """根据情绪和重要性生成缩放参数"""
        key = (context.emotion, context.importance)
        strategy, start_scale, end_scale, easing = self.ZOOM_MAPPING.get(key, self.DEFAULT_PARAMS)
        
        # 计算位移补偿（基于人脸位置）
        # 使用 end_scale 计算，因为这是最大放大倍数
        max_scale = max(start_scale, end_scale)
        position_x, position_y = TransformParams.calculate_position_offset(
            context.face_center_x,
            context.face_center_y,
            max_scale
        )
        
        return TransformParams(
            strategy=strategy,
            start_scale=start_scale,
            end_scale=end_scale,
            position_x=position_x,
            position_y=position_y,
            easing=easing,
            rule_applied=f"{self.name}:{context.emotion.value}+{context.importance.value}:{strategy.value}"
        )


class NoFaceZoomRule(TransformRule):
    """
    无人脸时的缩放规则
    
    当画面中没有人脸时，使用轻微缩放，打破静态感。
    注意：不做平移，只做缩放，避免画面跑出边界。
    """
    
    name = "no_face_zoom"
    priority = 20
    
    def match(self, context: SegmentContext) -> bool:
        """匹配条件：无人脸 + 时长 > MIN_DURATION_FOR_NO_FACE_ZOOM 秒"""
        if context.is_breath:
            return False
        return not context.has_face and context.duration_seconds > MIN_DURATION_FOR_NO_FACE_ZOOM
    
    def apply(self, context: SegmentContext) -> TransformParams:
        """生成缩放效果参数（不做平移）"""
        # 2026-01-17: 降低缩放幅度，让效果更柔和
        # 根据情绪调整策略
        if context.emotion == EmotionType.EXCITED:
            return TransformParams(
                strategy=ZoomStrategy.KEYFRAME,
                start_scale=1.0,
                end_scale=1.08,
                position_x=0,
                position_y=0,
                easing=EasingType.EASE_OUT,
                rule_applied=f"{self.name}:zoom_excited"
            )
        elif context.emotion == EmotionType.SAD:
            return TransformParams(
                strategy=ZoomStrategy.KEYFRAME,
                start_scale=1.03,
                end_scale=1.0,
                position_x=0,
                position_y=0,
                easing=EasingType.EASE_IN,
                rule_applied=f"{self.name}:zoom_sad"
            )
        else:
            return TransformParams(
                strategy=ZoomStrategy.KEYFRAME,
                start_scale=1.0,
                end_scale=1.05,
                position_x=0,
                position_y=0,
                easing=EasingType.LINEAR,
                rule_applied=f"{self.name}:zoom_default"
            )


class ShortClipRule(TransformRule):
    """
    短片段规则
    
    对于很短的片段（< SHORT_CLIP_THRESHOLD秒），使用非常轻微的动态效果或保持静止。
    """
    
    name = "short_clip"
    priority = 5  # 高优先级，优先匹配
    
    def match(self, context: SegmentContext) -> bool:
        """匹配条件：时长 < SHORT_CLIP_THRESHOLD秒"""
        if context.is_breath:
            return False
        return context.duration_seconds < SHORT_CLIP_THRESHOLD
    
    def apply(self, context: SegmentContext) -> TransformParams:
        """短片段使用轻微效果"""
        # 即使是短片段，高重要性也给一点推进感
        if context.importance == ImportanceLevel.HIGH:
            return TransformParams(
                strategy=ZoomStrategy.INSTANT,  # 短片段直接放大更有效
                start_scale=1.0,
                end_scale=1.10,
                easing=EasingType.EASE_OUT,
                rule_applied=f"{self.name}:instant_zoom"
            )
        
        # 普通短片段保持静止
        return TransformParams(
            strategy=ZoomStrategy.STATIC,
            start_scale=1.0,
            end_scale=1.0,
            easing=EasingType.LINEAR,
            rule_applied=f"{self.name}:static"
        )


class BreathClipRule(TransformRule):
    """
    换气片段规则
    
    换气片段保持当前状态，不做额外动画。
    """
    
    name = "breath_clip"
    priority = 1  # 最高优先级
    
    def match(self, context: SegmentContext) -> bool:
        return context.is_breath
    
    def apply(self, context: SegmentContext) -> TransformParams:
        return TransformParams(
            strategy=ZoomStrategy.STATIC,
            start_scale=1.0,
            end_scale=1.0,
            easing=EasingType.LINEAR,
            rule_applied=f"{self.name}:hold"
        )


class SuddenEmphasisRule(TransformRule):
    """
    突然强调规则 (Sudden Emphasis)
    
    适用场景：语气强烈的关键词（如"但是"、"哇"），或 LLM 标记的高重要性短片段。
    效果：瞬间跳切到特写（Sudden Zoom），不使用缓动，制造视觉冲击。
    """
    name = "sudden_emphasis_rule"
    priority = 2  # 非常高优先级，仅次于 Breath/Trim
    
    def match(self, context: SegmentContext) -> bool:
        return context.is_emphasis
    
    def apply(self, context: SegmentContext) -> TransformParams:
        # 2026-01-17: 降低缩放幅度，让效果更柔和
        # 如果有 emotion，可以微调 scale
        target_scale = 1.15
        if context.emotion == EmotionType.EXCITED:
            target_scale = 1.20
        elif context.emotion == EmotionType.SERIOUS:
            target_scale = 1.18
            
        # 计算位移（向人脸推进）
        pos_x, pos_y = TransformParams.calculate_position_offset(
            context.face_center_x, 
            context.face_center_y, 
            target_scale
        )
        
        return TransformParams(
            strategy=ZoomStrategy.INSTANT, # 瞬间切换
            start_scale=target_scale,
            end_scale=target_scale,        # 保持该比例(无渐变)
            position_x=pos_x,
            position_y=pos_y,
            easing=EasingType.LINEAR,
            rule_applied=f"{self.name}:{context.metadata.get('focus_word', '')}"
        )


# ============================================
# 规则引擎
# ============================================

class TransformRuleEngine:
    """
    运镜规则引擎
    
    管理所有规则，按优先级匹配并应用。
    
    使用示例：
        engine = TransformRuleEngine()
        params = engine.process(segment_context)
        
        # 获取元信息（存入 clip.transform）
        meta = params.get_meta()
        
        # 获取关键帧记录（存入 keyframes 表）
        keyframes = params.get_keyframes_for_db(clip_id, duration_ms)
    
    扩展方式：
        engine.register_rule(MyCustomRule())
    """
    
    def __init__(self) -> None:
        self._rules: List[TransformRule] = []
        self._register_default_rules()
    
    def _register_default_rules(self) -> None:
        """注册默认规则集"""
        self._rules = [
            BreathClipRule(),      # 优先级 1
            SuddenEmphasisRule(),  # 优先级 2 (New)
            ShortClipRule(),       # 优先级 5
            EmotionZoomRule(),     # 优先级 10
            NoFaceZoomRule(),      # 优先级 20
        ]
        self._sort_rules()
    
    def _sort_rules(self) -> None:
        """按优先级排序"""
        self._rules.sort(key=lambda r: r.priority)
    
    def register_rule(self, rule: TransformRule) -> None:
        """注册新规则"""
        self._rules.append(rule)
        self._sort_rules()
        logger.info(f"Registered rule: {rule.name} (priority={rule.priority})")
    
    def process(self, context: SegmentContext) -> TransformParams:
        """
        处理片段，返回运镜参数
        
        遍历规则链，返回第一个匹配的规则结果。
        如果没有规则匹配，返回默认静态参数。
        """
        for rule in self._rules:
            if rule.match(context):
                params = rule.apply(context)
                logger.debug(f"Segment {context.segment_id}: matched rule '{rule.name}' -> {params.rule_applied}")
                return params
        
        # 没有规则匹配，返回默认
        logger.debug(f"Segment {context.segment_id}: no rule matched, using default")
        return TransformParams(
            start_scale=1.0,
            end_scale=1.05,
            easing=EasingType.LINEAR,
            rule_applied="default"
        )
    
    def list_rules(self) -> List[Dict]:
        """列出所有注册的规则"""
        return [
            {"name": r.name, "priority": r.priority}
            for r in self._rules
        ]


# ============================================
# 序列感知后处理器（解决连续片段单调问题）
# ============================================

class SequenceAwarePostProcessor:
    """
    序列感知后处理器
    
    解决问题：连续多个片段应用相同的运镜效果，导致观感单调
    
    核心策略：
    1. 缩放方向交替：推进(zoom-in) ↔ 后拉(zoom-out) ↔ 静止(static)
    2. 高潮后呼吸：高重要性片段后强制插入静止片段
    3. 位移方向多样：避免连续同向位移
    4. 节奏波动：大幅 → 小幅 → 静止 → 大幅
    
    短视频黄金法则：
    - 每2-3秒要有视觉变化
    - 连续3个以上相同效果会产生疲劳
    - 高潮后需要"呼吸"空间
    """
    
    # 连续相同效果的最大允许次数
    MAX_CONSECUTIVE_SAME = 2
    
    # 高潮后需要的静止片段数
    POST_CLIMAX_REST_COUNT = 1
    
    def __init__(self) -> None:
        self._effect_history: List[str] = []  # 效果历史: "zoom_in", "zoom_out", "static"
        self._last_importance: ImportanceLevel = ImportanceLevel.MEDIUM
        self._consecutive_same_count: int = 0
        self._post_climax_rest_needed: int = 0  # 高潮后需要的静止片段计数
    
    def reset(self) -> None:
        """重置状态（新视频时调用）"""
        self._effect_history = []
        self._last_importance = ImportanceLevel.MEDIUM
        self._consecutive_same_count = 0
        self._post_climax_rest_needed = 0
    
    def _classify_effect(self, params: TransformParams) -> str:
        """分类运镜效果类型"""
        if params.strategy == ZoomStrategy.STATIC:
            return "static"
        
        # 判断缩放方向
        scale_delta = params.end_scale - params.start_scale
        if abs(scale_delta) < 0.03:  # 变化小于3%认为是静止
            return "static"
        elif scale_delta > 0:
            return "zoom_in"
        else:
            return "zoom_out"
    
    def _get_alternative_effect(self, current_effect: str, context: SegmentContext) -> str:
        """获取替代效果（打破单调）"""
        # 定义效果循环顺序
        effect_cycle = ["zoom_in", "static", "zoom_out", "static"]
        
        # 根据当前效果找下一个
        if current_effect == "zoom_in":
            return "static" if len(self._effect_history) % 3 == 0 else "zoom_out"
        elif current_effect == "zoom_out":
            return "static" if len(self._effect_history) % 3 == 0 else "zoom_in"
        else:  # static
            # 静止后应该给一个动态效果
            return "zoom_in" if len(self._effect_history) % 2 == 0 else "zoom_out"
    
    def _create_alternative_params(
        self, 
        original: TransformParams, 
        target_effect: str,
        context: SegmentContext
    ) -> TransformParams:
        """创建替代运镜参数"""
        # 2026-01-17: 降低缩放幅度，让效果更柔和
        
        if target_effect == "static":
            return TransformParams(
                strategy=ZoomStrategy.STATIC,
                start_scale=1.0,
                end_scale=1.0,
                position_x=0,
                position_y=0,
                easing=EasingType.LINEAR,
                rule_applied=f"sequence_aware:force_static"
            )
        
        elif target_effect == "zoom_out":
            # 后拉效果：从放大状态回到正常
            # 使用较小的幅度，产生"呼吸"感
            return TransformParams(
                strategy=ZoomStrategy.KEYFRAME,
                start_scale=1.05,
                end_scale=1.0,
                position_x=original.position_x * 0.5,  # 减小位移
                position_y=original.position_y * 0.5,
                easing=EasingType.EASE_IN,
                rule_applied=f"sequence_aware:force_zoom_out"
            )
        
        else:  # zoom_in
            # 推进效果：根据情绪调整幅度
            if context.emotion == EmotionType.EXCITED:
                scale_range = (1.0, 1.08)
            elif context.emotion == EmotionType.SERIOUS:
                scale_range = (1.0, 1.06)
            else:
                scale_range = (1.0, 1.05)
            
            return TransformParams(
                strategy=ZoomStrategy.KEYFRAME,
                start_scale=scale_range[0],
                end_scale=scale_range[1],
                position_x=original.position_x,
                position_y=original.position_y,
                easing=EasingType.EASE_OUT,
                rule_applied=f"sequence_aware:force_zoom_in"
            )
    
    def process(
        self, 
        params: TransformParams, 
        context: SegmentContext
    ) -> TransformParams:
        """
        后处理单个片段的运镜参数
        
        根据历史效果和当前上下文，决定是否需要调整运镜效果
        """
        # 换气片段不参与多样性处理
        if context.is_breath:
            return params
        
        current_effect = self._classify_effect(params)
        
        # === 规则1: 高潮后强制休息 ===
        if self._post_climax_rest_needed > 0:
            self._post_climax_rest_needed -= 1
            if current_effect != "static":
                logger.debug(f"Segment {context.segment_id}: 高潮后休息，强制静止")
                params = self._create_alternative_params(params, "static", context)
                current_effect = "static"
        
        # === 规则2: 检测连续相同效果 ===
        if self._effect_history and self._effect_history[-1] == current_effect:
            self._consecutive_same_count += 1
        else:
            self._consecutive_same_count = 1
        
        # 连续相同效果超过阈值，强制切换
        if self._consecutive_same_count > self.MAX_CONSECUTIVE_SAME:
            alternative = self._get_alternative_effect(current_effect, context)
            logger.debug(
                f"Segment {context.segment_id}: 连续{self._consecutive_same_count}个'{current_effect}'，"
                f"切换为'{alternative}'"
            )
            params = self._create_alternative_params(params, alternative, context)
            current_effect = alternative
            self._consecutive_same_count = 1
        
        # === 规则2.5: 避免同向连续缩放（优化版）===
        # ★ 只在【同向】连续缩放时才强制静止，不同向的 zoom 可以连续
        # 例如：zoom_in → zoom_in 会变成 static，但 zoom_in → zoom_out 是允许的（呼吸感）
        if self._effect_history:
            last_effect = self._effect_history[-1]
            last_is_zoom = last_effect in ("zoom_in", "zoom_out")
            current_is_zoom = current_effect in ("zoom_in", "zoom_out")
            
            # ★ 只有同向连续 zoom 才强制静止
            if last_is_zoom and current_is_zoom and last_effect == current_effect:
                logger.debug(
                    f"Segment {context.segment_id}: 同向连续缩放({last_effect}→{current_effect})，"
                    f"强制切换为 static"
                )
                params = self._create_alternative_params(params, "static", context)
                current_effect = "static"
        
        # === 规则3: 高潮检测（下一轮需要休息）===
        if context.importance == ImportanceLevel.HIGH and context.emotion == EmotionType.EXCITED:
            self._post_climax_rest_needed = self.POST_CLIMAX_REST_COUNT
        
        # 记录历史
        self._effect_history.append(current_effect)
        self._last_importance = context.importance
        
        return params
    
    def process_batch(
        self, 
        segments_params: List[Tuple[TransformParams, SegmentContext]]
    ) -> List[TransformParams]:
        """
        批量处理多个片段（推荐用法）
        
        可以进行全局优化，如：
        - 整体节奏分析
        - 高潮点定位
        - 效果分布均衡化
        - ★ scale 连续性保证
        """
        self.reset()
        
        results = []
        for params, context in segments_params:
            processed = self.process(params, context)
            results.append(processed)
        
        # ★★★ 后处理：确保相邻 clip 的 scale 过渡连续 ★★★
        # 解决问题：clip A 结束时 scale=1.05，clip B 开始时 scale=1.0，产生视觉跳变
        # 策略：让后一个 clip 的 start_scale = 前一个 clip 的 end_scale
        for i in range(1, len(results)):
            prev_params = results[i - 1]
            curr_params = results[i]
            
            # 只处理有动画的 clip
            if curr_params.strategy == ZoomStrategy.STATIC:
                continue
            
            # 如果前一个 clip 的 end_scale 和当前 clip 的 start_scale 差距过大，调整
            scale_diff = abs(prev_params.end_scale - curr_params.start_scale)
            if scale_diff > 0.02:  # 差距超过 2% 才调整
                old_start = curr_params.start_scale
                curr_params.start_scale = prev_params.end_scale
                logger.debug(
                    f"Scale 平滑: clip[{i}] start_scale {old_start:.3f} → {curr_params.start_scale:.3f}"
                )
        
        # 统计效果分布
        effect_counts = {}
        for params in results:
            effect = self._classify_effect(params)
            effect_counts[effect] = effect_counts.get(effect, 0) + 1
        
        logger.info(f"📊 序列感知后处理完成，效果分布: {effect_counts}")
        
        return results


# ============================================
# 全局实例
# ============================================

# 创建全局规则引擎实例
transform_engine = TransformRuleEngine()

# 创建全局序列感知后处理器
sequence_processor = SequenceAwarePostProcessor()
