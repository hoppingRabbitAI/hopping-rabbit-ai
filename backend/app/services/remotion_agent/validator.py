"""
视觉配置验证器

验证生成的 VisualConfig 是否符合最佳实践规则

验证内容:
1. 节奏验证 - 静止时长、元素间隔
2. 位置验证 - 元素冲突检测
3. 时长验证 - 元素显示时长
4. 布局验证 - 画中画与叠加层冲突
"""

from typing import List, Optional, Dict, Any
from pydantic import BaseModel, Field
from enum import Enum


class ValidationSeverity(str, Enum):
    """验证问题严重程度"""
    ERROR = "error"      # 必须修复
    WARNING = "warning"  # 建议修复
    INFO = "info"        # 信息提示


class ValidationIssue(BaseModel):
    """验证问题"""
    code: str = Field(..., description="问题代码")
    severity: ValidationSeverity = Field(..., description="严重程度")
    message: str = Field(..., description="问题描述")
    field: Optional[str] = Field(None, description="相关字段路径")
    suggestion: Optional[str] = Field(None, description="修复建议")
    context: Optional[Dict[str, Any]] = Field(None, description="上下文信息")


class ValidationResult(BaseModel):
    """验证结果"""
    is_valid: bool = Field(..., description="是否通过验证")
    errors: List[ValidationIssue] = Field(default_factory=list)
    warnings: List[ValidationIssue] = Field(default_factory=list)
    infos: List[ValidationIssue] = Field(default_factory=list)
    
    @property
    def error_count(self) -> int:
        return len(self.errors)
    
    @property
    def warning_count(self) -> int:
        return len(self.warnings)


# ============================================
# 验证规则常量
# ============================================

class PacingRules:
    """节奏规则"""
    # 静止画面最大时长 (毫秒)
    MAX_STATIC_DURATION_MS = 5000
    
    # 两个视觉元素之间的最小间隔 (毫秒)
    MIN_ELEMENT_GAP_MS = 500
    
    # 元素最短显示时长 (毫秒)
    MIN_ELEMENT_DURATION_MS = 1000
    
    # 元素最长显示时长 (毫秒)
    MAX_ELEMENT_DURATION_MS = 15000
    
    # 每 10 秒最大叠加层数量
    MAX_OVERLAYS_PER_10S = 3
    
    # 关键词卡片最短持续时间
    MIN_KEYWORD_CARD_DURATION_MS = 1500
    
    # 数据数字最短持续时间
    MIN_DATA_NUMBER_DURATION_MS = 2000


class PositionRules:
    """位置规则"""
    # 安全边距 (像素)
    SAFE_MARGIN = 20
    
    # 字幕区域高度 (像素)
    SUBTITLE_ZONE_HEIGHT = 100
    
    # PiP 冲突检测阈值 (像素)
    PIP_CONFLICT_THRESHOLD = 50
    
    # 叠加层位置冲突区域
    CONFLICT_ZONES = {
        "bottom-right": ["bottom-right", "bottom-center"],
        "bottom-left": ["bottom-left", "bottom-center"],
        "top-right": ["top-right"],
        "top-left": ["top-left"],
        "center": ["center", "top", "bottom"],
    }


# ============================================
# 验证器类
# ============================================

class VisualConfigValidator:
    """视觉配置验证器"""
    
    def __init__(self):
        self.pacing = PacingRules()
        self.position = PositionRules()
    
    def validate(self, config: Dict[str, Any]) -> ValidationResult:
        """
        验证视觉配置
        
        Args:
            config: VisualConfig 的字典表示
            
        Returns:
            ValidationResult
        """
        issues = []
        
        # 1. 节奏验证
        issues.extend(self._validate_pacing(config))
        
        # 2. 位置验证
        issues.extend(self._validate_positions(config))
        
        # 3. 时长验证
        issues.extend(self._validate_durations(config))
        
        # 4. 布局验证
        issues.extend(self._validate_layout(config))
        
        # 5. 完整性验证
        issues.extend(self._validate_completeness(config))
        
        # 分类问题
        errors = [i for i in issues if i.severity == ValidationSeverity.ERROR]
        warnings = [i for i in issues if i.severity == ValidationSeverity.WARNING]
        infos = [i for i in issues if i.severity == ValidationSeverity.INFO]
        
        return ValidationResult(
            is_valid=len(errors) == 0,
            errors=errors,
            warnings=warnings,
            infos=infos,
        )
    
    def _validate_pacing(self, config: Dict[str, Any]) -> List[ValidationIssue]:
        """验证节奏"""
        issues = []
        
        overlays = config.get("overlays", [])
        canvas_list = config.get("canvas", [])
        duration_ms = config.get("duration_ms", 0)
        
        # 检查叠加层密度
        if duration_ms > 0:
            # 按 10 秒窗口检查密度
            window_size = 10000  # 10 秒
            for window_start in range(0, duration_ms, window_size):
                window_end = window_start + window_size
                overlays_in_window = [
                    o for o in overlays
                    if o.get("start_ms", 0) >= window_start and 
                       o.get("start_ms", 0) < window_end
                ]
                if len(overlays_in_window) > self.pacing.MAX_OVERLAYS_PER_10S:
                    issues.append(ValidationIssue(
                        code="PACING_TOO_DENSE",
                        severity=ValidationSeverity.WARNING,
                        message=f"时间 {window_start//1000}-{window_end//1000}s 内叠加层过多 ({len(overlays_in_window)} 个)",
                        suggestion=f"建议每 10 秒最多 {self.pacing.MAX_OVERLAYS_PER_10S} 个叠加层",
                        context={"window_start": window_start, "count": len(overlays_in_window)},
                    ))
        
        # 检查元素间隔
        all_elements = sorted(
            overlays + canvas_list,
            key=lambda x: x.get("start_ms", 0)
        )
        for i in range(1, len(all_elements)):
            prev_end = all_elements[i-1].get("end_ms", 0)
            curr_start = all_elements[i].get("start_ms", 0)
            gap = curr_start - prev_end
            
            if 0 < gap < self.pacing.MIN_ELEMENT_GAP_MS:
                issues.append(ValidationIssue(
                    code="PACING_GAP_TOO_SHORT",
                    severity=ValidationSeverity.INFO,
                    message=f"元素间隔过短 ({gap}ms)，可能显得仓促",
                    suggestion=f"建议元素间隔至少 {self.pacing.MIN_ELEMENT_GAP_MS}ms",
                    context={"gap_ms": gap},
                ))
        
        return issues
    
    def _validate_positions(self, config: Dict[str, Any]) -> List[ValidationIssue]:
        """验证位置冲突"""
        issues = []
        
        overlays = config.get("overlays", [])
        pip_config = config.get("pip", {})
        pip_position = pip_config.get("position", "bottom-right")
        pip_visible = pip_config.get("visible", True)
        
        if not pip_visible:
            return issues
        
        # 检查叠加层与 PiP 位置冲突
        conflict_positions = self.position.CONFLICT_ZONES.get(pip_position, [])
        
        for overlay in overlays:
            overlay_pos = overlay.get("position", "center")
            if overlay_pos in conflict_positions:
                issues.append(ValidationIssue(
                    code="POSITION_CONFLICT_PIP",
                    severity=ValidationSeverity.WARNING,
                    message=f"叠加层位置 '{overlay_pos}' 可能与 PiP ({pip_position}) 冲突",
                    field=f"overlays[{overlay.get('id', '?')}].position",
                    suggestion=f"建议将叠加层移至其他位置避开 PiP 区域",
                    context={"overlay_id": overlay.get("id"), "pip_position": pip_position},
                ))
        
        # 检查叠加层之间的重叠
        for i, o1 in enumerate(overlays):
            for j, o2 in enumerate(overlays[i+1:], i+1):
                # 检查时间重叠
                time_overlap = (
                    o1.get("start_ms", 0) < o2.get("end_ms", 0) and
                    o1.get("end_ms", 0) > o2.get("start_ms", 0)
                )
                # 检查位置重叠
                pos_overlap = o1.get("position") == o2.get("position")
                
                if time_overlap and pos_overlap:
                    issues.append(ValidationIssue(
                        code="POSITION_CONFLICT_OVERLAY",
                        severity=ValidationSeverity.ERROR,
                        message=f"叠加层 '{o1.get('id')}' 和 '{o2.get('id')}' 在相同位置时间重叠",
                        suggestion="调整其中一个叠加层的位置或时间",
                        context={
                            "overlay1": o1.get("id"),
                            "overlay2": o2.get("id"),
                            "position": o1.get("position"),
                        },
                    ))
        
        return issues
    
    def _validate_durations(self, config: Dict[str, Any]) -> List[ValidationIssue]:
        """验证时长"""
        issues = []
        
        overlays = config.get("overlays", [])
        
        for overlay in overlays:
            start_ms = overlay.get("start_ms", 0)
            end_ms = overlay.get("end_ms", 0)
            duration = end_ms - start_ms
            overlay_type = overlay.get("type", "")
            
            # 检查最短时长
            min_duration = self.pacing.MIN_ELEMENT_DURATION_MS
            if overlay_type == "keyword-card":
                min_duration = self.pacing.MIN_KEYWORD_CARD_DURATION_MS
            elif overlay_type == "data-number":
                min_duration = self.pacing.MIN_DATA_NUMBER_DURATION_MS
            
            if duration < min_duration:
                issues.append(ValidationIssue(
                    code="DURATION_TOO_SHORT",
                    severity=ValidationSeverity.WARNING,
                    message=f"叠加层 '{overlay.get('id')}' 显示时长过短 ({duration}ms)",
                    field=f"overlays[{overlay.get('id', '?')}]",
                    suggestion=f"{overlay_type} 建议至少显示 {min_duration}ms",
                    context={"duration_ms": duration, "min_duration_ms": min_duration},
                ))
            
            # 检查最长时长
            if duration > self.pacing.MAX_ELEMENT_DURATION_MS:
                issues.append(ValidationIssue(
                    code="DURATION_TOO_LONG",
                    severity=ValidationSeverity.INFO,
                    message=f"叠加层 '{overlay.get('id')}' 显示时长较长 ({duration}ms)",
                    suggestion="考虑是否需要拆分或提前结束",
                    context={"duration_ms": duration},
                ))
        
        return issues
    
    def _validate_layout(self, config: Dict[str, Any]) -> List[ValidationIssue]:
        """验证布局"""
        issues = []
        
        # 检查画布与叠加层的协调
        canvas_list = config.get("canvas", [])
        overlays = config.get("overlays", [])
        
        for canvas in canvas_list:
            canvas_start = canvas.get("start_ms", 0)
            canvas_end = canvas.get("end_ms", 0)
            
            # 检查画布期间的叠加层数量
            overlays_during_canvas = [
                o for o in overlays
                if o.get("start_ms", 0) >= canvas_start and
                   o.get("end_ms", 0) <= canvas_end
            ]
            
            if len(overlays_during_canvas) > 2:
                issues.append(ValidationIssue(
                    code="LAYOUT_CANVAS_OVERLAY_CONFLICT",
                    severity=ValidationSeverity.WARNING,
                    message=f"画布期间叠加层过多 ({len(overlays_during_canvas)} 个)",
                    suggestion="画布显示时建议减少叠加层，避免视觉混乱",
                    context={"canvas_id": canvas.get("segment_id")},
                ))
        
        return issues
    
    def _validate_completeness(self, config: Dict[str, Any]) -> List[ValidationIssue]:
        """验证完整性"""
        issues = []
        
        # 检查必要字段
        required_fields = ["version", "template", "duration_ms"]
        for field in required_fields:
            if field not in config:
                issues.append(ValidationIssue(
                    code="MISSING_REQUIRED_FIELD",
                    severity=ValidationSeverity.ERROR,
                    message=f"缺少必要字段: {field}",
                    field=field,
                ))
        
        # 检查 duration_ms 是否合理
        duration_ms = config.get("duration_ms", 0)
        if duration_ms <= 0:
            issues.append(ValidationIssue(
                code="INVALID_DURATION",
                severity=ValidationSeverity.ERROR,
                message="duration_ms 必须大于 0",
                field="duration_ms",
            ))
        
        # 检查是否有视觉内容
        has_canvas = len(config.get("canvas", [])) > 0
        has_overlays = len(config.get("overlays", [])) > 0
        
        if not has_canvas and not has_overlays:
            issues.append(ValidationIssue(
                code="NO_VISUAL_CONTENT",
                severity=ValidationSeverity.WARNING,
                message="配置中没有任何视觉增强内容",
                suggestion="考虑添加画布或叠加层来增强视觉效果",
            ))
        
        return issues


# ============================================
# 便捷函数
# ============================================

_validator: Optional[VisualConfigValidator] = None


def get_validator() -> VisualConfigValidator:
    """获取验证器单例"""
    global _validator
    if _validator is None:
        _validator = VisualConfigValidator()
    return _validator


def validate_visual_config(config: Dict[str, Any]) -> ValidationResult:
    """验证视觉配置"""
    return get_validator().validate(config)


def is_valid_config(config: Dict[str, Any]) -> bool:
    """快速检查配置是否有效"""
    return get_validator().validate(config).is_valid
