"""
B-Roll 配置模型

定义 B-Roll 显示模式、PiP 配置等数据结构
"""

from enum import Enum
from pydantic import BaseModel, Field
from typing import Optional, List


class BRollDisplayMode(str, Enum):
    """B-Roll 显示模式"""
    FULLSCREEN = "fullscreen"  # 全屏覆盖
    PIP = "pip"                # 画中画
    MIXED = "mixed"            # 混合模式（AI 自动选择）


class PipSize(str, Enum):
    """PiP 窗口大小"""
    SMALL = "small"    # 20% of screen width
    MEDIUM = "medium"  # 30% of screen width
    LARGE = "large"    # 40% of screen width
    
    def to_ratio(self) -> float:
        """转换为比例值"""
        mapping = {
            PipSize.SMALL: 0.20,
            PipSize.MEDIUM: 0.30,
            PipSize.LARGE: 0.40,
        }
        return mapping.get(self, 0.30)


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
    margin: int = Field(default=20, ge=0, le=100, description="边距像素")
    border_radius: int = Field(default=12, ge=0, le=50, description="圆角半径")


class MixedConfig(BaseModel):
    """混合模式配置"""
    fullscreen_min_duration: int = Field(
        default=3000, 
        ge=1000, 
        description="全屏 B-Roll 最小时长（毫秒）"
    )
    pip_min_duration: int = Field(
        default=1500, 
        ge=500, 
        description="PiP B-Roll 最小时长（毫秒）"
    )
    pip_ratio: float = Field(
        default=0.4, 
        ge=0.0, 
        le=1.0, 
        description="使用 PiP 的比例"
    )


class BRollConfig(BaseModel):
    """B-Roll 完整配置"""
    enabled: bool = True
    display_mode: BRollDisplayMode = BRollDisplayMode.FULLSCREEN
    pip_config: Optional[PipConfig] = None
    mixed_config: Optional[MixedConfig] = None
    
    def get_pip_size_ratio(self) -> float:
        """获取 PiP 大小比例"""
        if self.pip_config:
            return self.pip_config.size.to_ratio()
        return PipSize.MEDIUM.to_ratio()
    
    def get_default_pip_position(self) -> str:
        """获取默认 PiP 位置"""
        if self.pip_config:
            return self.pip_config.default_position.value
        return PipPosition.BOTTOM_RIGHT.value


# ============================================
# 人脸检测相关模型
# ============================================

class FaceRegion(BaseModel):
    """人脸区域（归一化坐标 0-1）"""
    x: float = Field(ge=0, le=1, description="左上角 X 坐标")
    y: float = Field(ge=0, le=1, description="左上角 Y 坐标")
    width: float = Field(ge=0, le=1, description="宽度")
    height: float = Field(ge=0, le=1, description="高度")
    confidence: float = Field(ge=0, le=1, description="检测置信度")


class FaceDetectionFrame(BaseModel):
    """单帧人脸检测结果"""
    timestamp_ms: int = Field(description="帧时间戳（毫秒）")
    faces: List[FaceRegion] = Field(default_factory=list, description="检测到的人脸")


class FaceDetectionResult(BaseModel):
    """视频人脸检测完整结果"""
    asset_id: str
    frame_width: int
    frame_height: int
    frames: List[FaceDetectionFrame] = Field(default_factory=list)
    dominant_region: Optional[FaceRegion] = Field(
        default=None, 
        description="主要人脸区域（合并所有帧）"
    )
    safe_pip_positions: List[str] = Field(
        default_factory=list,
        description="安全的 PiP 位置"
    )


# ============================================
# PiP 位置计算结果
# ============================================

class PipPositionResult(BaseModel):
    """PiP 位置计算结果"""
    x: float = Field(ge=0, le=1, description="PiP 左上角 X 坐标")
    y: float = Field(ge=0, le=1, description="PiP 左上角 Y 坐标")
    position_name: str = Field(description="位置名称")
    has_overlap: bool = Field(description="是否与人脸重叠")
    overlap_ratio: float = Field(default=0, description="重叠比例")


# ============================================
# API 请求/响应模型
# ============================================

class DetectFacesRequest(BaseModel):
    """人脸检测请求"""
    asset_id: str
    sample_interval_ms: int = Field(default=1000, ge=100, le=5000)
    max_samples: int = Field(default=20, ge=1, le=100)


class DetectFacesResponse(BaseModel):
    """人脸检测响应"""
    status: str
    asset_id: str
    frames: List[FaceDetectionFrame]
    dominant_region: Optional[FaceRegion]
    safe_pip_positions: List[str]


class BRollGenerateRequest(BaseModel):
    """B-Roll 生成请求（增强版）"""
    display_mode: BRollDisplayMode = BRollDisplayMode.FULLSCREEN
    pip_config: Optional[PipConfig] = None
    mixed_config: Optional[MixedConfig] = None
    # 人脸检测结果（可选，如果未提供则自动检测）
    face_detection: Optional[FaceDetectionResult] = None
