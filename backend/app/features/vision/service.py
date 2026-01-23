"""
视觉分析服务 (Computer Vision Service)
使用 MediaPipe 实现本地化的人脸与主体检测
"""

import cv2
import mediapipe as mp
import numpy as np
from typing import Dict, List, Tuple, Optional
import logging
import os

logger = logging.getLogger(__name__)

class VisionService:
    def __init__(self):
        # 初始化 MediaPipe Face Detection
        self.mp_face_detection = mp.solutions.face_detection
        self.detector = self.mp_face_detection.FaceDetection(
            model_selection=1, # 0 for short range, 1 for long range (full body shots)
            min_detection_confidence=0.5
        )
    
    def analyze_clip_region(self, video_path: str, start_time: float, end_time: float, sample_rate: float = 1.0) -> Dict:
        """
        分析视频片段的视觉焦点
        
        Args:
            video_path: 视频文件路径
            start_time: 开始时间 (秒)
            end_time: 结束时间 (秒)
            sample_rate: 每秒采样帧数 (默认 1fps)
            
        Returns:
            Dict: {
                "has_face": bool,
                "center_x": float, # 0.0-1.0
                "center_y": float, # 0.0-1.0
                "face_ratio": float # 人脸占画面比例
            }
        """
        if not os.path.exists(video_path):
            raise FileNotFoundError(f"Video file not found: {video_path}")

        cap = cv2.VideoCapture(video_path)
        fps = cap.get(cv2.CAP_PROP_FPS)
        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        duration = total_frames / fps if fps > 0 else 0
        
        start_frame = int(start_time * fps)
        end_frame = int(end_time * fps)
        
        # 限制范围
        start_frame = max(0, start_frame)
        end_frame = min(total_frames - 1, end_frame)
        
        step = int(fps / sample_rate) if sample_rate > 0 else int(fps)
        step = max(1, step)
        
        detected_centers = []
        face_areas = []
        
        cap.set(cv2.CAP_PROP_POS_FRAMES, start_frame)
        
        current_frame_idx = start_frame
        
        while current_frame_idx < end_frame:
            ret, frame = cap.read()
            if not ret:
                break
                
            # 只在采样点处理
            if (current_frame_idx - start_frame) % step == 0:
                # MediaPipe 需要 RGB
                frame_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
                results = self.detector.process(frame_rgb)
                
                if results.detections:
                    # 取置信度最高的一个人脸
                    best_detection = max(results.detections, key=lambda d: d.score[0])
                    bbox = best_detection.location_data.relative_bounding_box
                    
                    # 计算中心点
                    cx = bbox.xmin + bbox.width / 2
                    cy = bbox.ymin + bbox.height / 2
                    area = bbox.width * bbox.height
                    
                    detected_centers.append((cx, cy))
                    face_areas.append(area)
                else:
                    # 如果没人脸，默认取画面中心 (0.5, 0.5)
                    # 未来可接入显著性检测 (Saliency) 优化此处
                    pass
            
            current_frame_idx += 1
            
        cap.release()
        
        # 聚合结果
        if not detected_centers:
            return {
                "has_face": False,
                "center_x": 0.5,
                "center_y": 0.5,
                "face_ratio": 0.0
            }
            
        # 计算平均中心点 (简单的平滑处理)
        avg_x = np.mean([p[0] for p in detected_centers])
        avg_y = np.mean([p[1] for p in detected_centers])
        avg_area = np.mean(face_areas)
        
        # 边界保护
        avg_x = max(0.0, min(1.0, avg_x))
        avg_y = max(0.0, min(1.0, avg_y))
        
        return {
            "has_face": True,
            "center_x": float(avg_x),
            "center_y": float(avg_y),
            "face_ratio": float(avg_area)
        }

# 单例模式导出
vision_service = VisionService()
