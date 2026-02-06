"""
人脸检测服务

使用 MediaPipe 进行轻量级人脸检测，用于 PiP B-Roll 位置计算
"""

import cv2
import numpy as np
import logging
from dataclasses import dataclass
from typing import List, Optional, Tuple, Dict, Any
from pathlib import Path

import mediapipe as mp

logger = logging.getLogger(__name__)


# ============================================
# 数据类
# ============================================

@dataclass
class FaceRegion:
    """人脸区域"""
    x: float          # 左上角 X（0-1 归一化）
    y: float          # 左上角 Y（0-1 归一化）
    width: float      # 宽度（0-1 归一化）
    height: float     # 高度（0-1 归一化）
    confidence: float # 置信度
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "x": self.x,
            "y": self.y,
            "width": self.width,
            "height": self.height,
            "confidence": self.confidence,
        }
    
    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "FaceRegion":
        return cls(
            x=data["x"],
            y=data["y"],
            width=data["width"],
            height=data["height"],
            confidence=data["confidence"],
        )


@dataclass
class FaceDetectionFrameResult:
    """单帧检测结果"""
    faces: List[FaceRegion]
    frame_width: int
    frame_height: int
    timestamp_ms: int


@dataclass
class FaceDetectionVideoResult:
    """视频检测结果"""
    frames: List[FaceDetectionFrameResult]
    dominant_region: Optional[FaceRegion]  # 主要人脸区域
    safe_pip_positions: List[str]          # 安全的 PiP 位置


# ============================================
# PiP 位置定义
# ============================================

def get_pip_position_coords(
    position: str,
    pip_size: float,
    margin: float = 0.02,
) -> Tuple[float, float]:
    """
    获取 PiP 位置的坐标
    
    Args:
        position: 位置名称
        pip_size: PiP 大小（相对于画面宽度的比例）
        margin: 边距
        
    Returns:
        (x, y) 左上角坐标
    """
    positions = {
        "top-left": (margin, margin),
        "top-right": (1 - pip_size - margin, margin),
        "bottom-left": (margin, 1 - pip_size - margin),
        "bottom-right": (1 - pip_size - margin, 1 - pip_size - margin),
    }
    return positions.get(position, positions["bottom-right"])


# ============================================
# 人脸检测器
# ============================================

class FaceDetector:
    """人脸检测器 - 使用 MediaPipe"""
    
    def __init__(self, min_confidence: float = 0.7):
        """
        初始化人脸检测器
        
        Args:
            min_confidence: 最小置信度阈值
        """
        self.min_confidence = min_confidence
        self.mp_face_detection = mp.solutions.face_detection
        self.detector = self.mp_face_detection.FaceDetection(
            model_selection=0,  # 0=近距离（2米内）
            min_detection_confidence=min_confidence,
        )
        logger.info("[FaceDetector] MediaPipe 人脸检测器初始化成功")
    
    def detect_from_frame(
        self, 
        frame: np.ndarray,
        timestamp_ms: int = 0
    ) -> FaceDetectionFrameResult:
        """
        从单帧图像检测人脸
        
        Args:
            frame: BGR 格式的图像（OpenCV 格式）
            timestamp_ms: 帧时间戳
            
        Returns:
            FaceDetectionFrameResult: 检测结果
        """
        height, width = frame.shape[:2]
        faces = []
        
        # 使用 MediaPipe
        rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        results = self.detector.process(rgb_frame)
        
        if results.detections:
            for detection in results.detections:
                bbox = detection.location_data.relative_bounding_box
                faces.append(FaceRegion(
                    x=max(0, bbox.xmin),
                    y=max(0, bbox.ymin),
                    width=min(1 - max(0, bbox.xmin), bbox.width),
                    height=min(1 - max(0, bbox.ymin), bbox.height),
                    confidence=detection.score[0],
                ))
        
        return FaceDetectionFrameResult(
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
    ) -> FaceDetectionVideoResult:
        """
        从视频中采样检测人脸
        
        Args:
            video_path: 视频文件路径
            sample_interval_ms: 采样间隔（毫秒）
            max_samples: 最大采样数
            
        Returns:
            FaceDetectionVideoResult: 检测结果
        """
        if not Path(video_path).exists():
            logger.error(f"[FaceDetector] 视频文件不存在: {video_path}")
            return FaceDetectionVideoResult(
                frames=[],
                dominant_region=None,
                safe_pip_positions=["top-left", "top-right", "bottom-left", "bottom-right"],
            )
        
        cap = cv2.VideoCapture(video_path)
        if not cap.isOpened():
            logger.error(f"[FaceDetector] 无法打开视频: {video_path}")
            return FaceDetectionVideoResult(
                frames=[],
                dominant_region=None,
                safe_pip_positions=["top-left", "top-right", "bottom-left", "bottom-right"],
            )
        
        fps = cap.get(cv2.CAP_PROP_FPS) or 30
        frame_interval = max(1, int(fps * sample_interval_ms / 1000))
        
        frames: List[FaceDetectionFrameResult] = []
        frame_idx = 0
        sample_count = 0
        
        logger.info(f"[FaceDetector] 开始检测视频: {video_path}, 间隔={sample_interval_ms}ms, 最大采样={max_samples}")
        
        while cap.isOpened() and sample_count < max_samples:
            ret, frame = cap.read()
            if not ret:
                break
            
            if frame_idx % frame_interval == 0:
                timestamp_ms = int(frame_idx / fps * 1000)
                result = self.detect_from_frame(frame, timestamp_ms)
                frames.append(result)
                sample_count += 1
                
                if result.faces:
                    logger.debug(f"[FaceDetector] 帧 {frame_idx}: 检测到 {len(result.faces)} 个人脸")
            
            frame_idx += 1
        
        cap.release()
        
        # 计算主要人脸区域
        dominant_region = self._calculate_dominant_region(frames)
        
        # 计算安全的 PiP 位置
        safe_positions = self._calculate_safe_pip_positions(dominant_region)
        
        logger.info(f"[FaceDetector] 检测完成: {len(frames)} 帧, 主要区域={dominant_region is not None}, 安全位置={safe_positions}")
        
        return FaceDetectionVideoResult(
            frames=frames,
            dominant_region=dominant_region,
            safe_pip_positions=safe_positions,
        )
    
    def _calculate_dominant_region(
        self, 
        frames: List[FaceDetectionFrameResult]
    ) -> Optional[FaceRegion]:
        """
        计算主要人脸区域（合并所有帧中的人脸位置）
        """
        all_faces: List[FaceRegion] = []
        for frame in frames:
            all_faces.extend(frame.faces)
        
        if not all_faces:
            return None
        
        # 计算边界框的并集（包含所有人脸的最小矩形）
        min_x = min(f.x for f in all_faces)
        min_y = min(f.y for f in all_faces)
        max_x = max(f.x + f.width for f in all_faces)
        max_y = max(f.y + f.height for f in all_faces)
        
        # 稍微扩大区域（留出安全边距）
        padding = 0.05
        min_x = max(0, min_x - padding)
        min_y = max(0, min_y - padding)
        max_x = min(1, max_x + padding)
        max_y = min(1, max_y + padding)
        
        # 计算平均置信度
        avg_confidence = sum(f.confidence for f in all_faces) / len(all_faces)
        
        return FaceRegion(
            x=min_x,
            y=min_y,
            width=max_x - min_x,
            height=max_y - min_y,
            confidence=avg_confidence,
        )
    
    def _calculate_safe_pip_positions(
        self, 
        dominant_region: Optional[FaceRegion],
        pip_size: float = 0.3,
        margin: float = 0.02,
    ) -> List[str]:
        """
        计算安全的 PiP 位置（不与人脸重叠）
        """
        if dominant_region is None:
            # 没有检测到人脸，所有位置都安全
            return ["top-left", "top-right", "bottom-left", "bottom-right"]
        
        safe_positions = []
        
        for position_name in ["top-left", "top-right", "bottom-left", "bottom-right"]:
            pip_x, pip_y = get_pip_position_coords(position_name, pip_size, margin)
            
            # 检查是否与人脸区域重叠
            overlap = self._calculate_overlap(
                pip_x, pip_y, pip_size, pip_size,
                dominant_region.x, dominant_region.y, 
                dominant_region.width, dominant_region.height,
            )
            
            # 重叠面积小于 PiP 面积的 20% 认为是安全的
            if overlap < pip_size * pip_size * 0.2:
                safe_positions.append(position_name)
        
        # 如果所有位置都不安全，返回重叠最少的
        if not safe_positions:
            safe_positions = ["top-left"]  # 默认返回一个
        
        return safe_positions
    
    def _calculate_overlap(
        self,
        x1: float, y1: float, w1: float, h1: float,
        x2: float, y2: float, w2: float, h2: float,
    ) -> float:
        """计算两个矩形的重叠面积"""
        inter_x1 = max(x1, x2)
        inter_y1 = max(y1, y2)
        inter_x2 = min(x1 + w1, x2 + w2)
        inter_y2 = min(y1 + h1, y2 + h2)
        
        if inter_x2 > inter_x1 and inter_y2 > inter_y1:
            return (inter_x2 - inter_x1) * (inter_y2 - inter_y1)
        return 0
    
    def get_safe_pip_position(
        self,
        faces: List[FaceRegion],
        pip_size: float = 0.3,
        margin: float = 0.02,
        preferred_position: str = "bottom-right",
    ) -> Tuple[float, float, str]:
        """
        计算 PiP 窗口的安全位置（避开人脸）
        
        Args:
            faces: 检测到的人脸列表
            pip_size: PiP 窗口大小
            margin: 边距
            preferred_position: 首选位置
            
        Returns:
            (x, y, position_name): PiP 左上角位置和位置名称
        """
        positions = {
            "top-left": get_pip_position_coords("top-left", pip_size, margin),
            "top-right": get_pip_position_coords("top-right", pip_size, margin),
            "bottom-left": get_pip_position_coords("bottom-left", pip_size, margin),
            "bottom-right": get_pip_position_coords("bottom-right", pip_size, margin),
        }
        
        # 如果没有人脸，返回首选位置
        if not faces:
            pos = positions.get(preferred_position, positions["bottom-right"])
            return pos[0], pos[1], preferred_position
        
        # 计算每个位置与人脸的重叠度
        position_overlaps = []
        for name, (px, py) in positions.items():
            total_overlap = 0
            for face in faces:
                overlap = self._calculate_overlap(
                    px, py, pip_size, pip_size,
                    face.x, face.y, face.width, face.height,
                )
                total_overlap += overlap
            position_overlaps.append((name, px, py, total_overlap))
        
        # 按重叠度排序
        position_overlaps.sort(key=lambda x: x[3])
        
        # 优先选择无重叠且是首选位置的
        for name, px, py, overlap in position_overlaps:
            if overlap == 0 and name == preferred_position:
                return px, py, name
        
        # 选择重叠最少的
        best = position_overlaps[0]
        return best[1], best[2], best[0]
    
    def close(self):
        """释放资源"""
        if self.detector:
            self.detector.close()


# ============================================
# 单例实例
# ============================================

_detector_instance: Optional[FaceDetector] = None


def get_face_detector() -> FaceDetector:
    """获取人脸检测器单例"""
    global _detector_instance
    if _detector_instance is None:
        _detector_instance = FaceDetector()
    return _detector_instance
