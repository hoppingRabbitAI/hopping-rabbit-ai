"""
Lepus AI - Pydantic Models
适配新表结构 (2026-01-07)

变化说明：
- Track: layer → order_index, muted → is_muted, locked → is_locked
- Clip: 移除 type/name/effects, muted → is_muted, start → start_time
- Asset: type → file_type, 移除 url/subtype/metadata
- Task: type → task_type, error → error_message, 移除 current_step
- Project: 移除 timeline/segments/version/duration，使用 resolution/fps
"""
from pydantic import BaseModel, Field
from typing import Optional, List, Any
from datetime import datetime


# ============================================
# 通用类型
# ============================================

class Resolution(BaseModel):
    width: int = 1920
    height: int = 1080


# ============================================
# 时间轴相关（适配新表）
# ============================================

class Track(BaseModel):
    """轨道模型
    
    Track 是通用容器，不区分类型
    素材类型由 Clip.clip_type 决定（video/audio/subtitle 等）
    任何类型的 Clip 都可以放在任意轨道上
    """
    id: str
    project_id: Optional[str] = None
    name: str = "Track"
    order_index: int = 0
    is_visible: bool = True
    is_locked: bool = False
    is_muted: bool = False
    adjustment_params: Optional[dict] = None


class Clip(BaseModel):
    """片段模型
    
    核心概念：所有类型的内容都是 Clip
    
    类型层级关系：
    - video: 主视频片段（必须连续，不允许有间隙）
    - broll: B-Roll 覆盖视频（video 的子类型，可以有间隙）
    - audio: 音频片段
    - text: 文案片段（可被AI切分）
    - subtitle: 字幕片段（text 的子类型，可以有间隙）
    - voice: 配音片段（TTS/录制）
    - image: 图片片段
    - effect: 特效片段
    - filter: 滤镜片段
    - sticker: 贴纸片段
    - transition: 转场片段
    """
    id: str
    track_id: str
    asset_id: Optional[str] = None
    
    # 片段类型 (核心字段)
    clip_type: str = "video"
    
    # 时间信息 (毫秒 - 数据库 / 秒 - API)
    start_time: float = 0
    end_time: float = 0
    source_start: float = 0
    source_end: Optional[float] = None
    
    # 音频属性 (video, audio, voice)
    volume: float = 1.0
    is_muted: bool = False
    
    # 视觉变换 (video, text, sticker, effect)
    transform: Optional[dict] = None
    
    # 转场效果
    transition_in: Optional[dict] = None
    transition_out: Optional[dict] = None
    
    # 播放控制
    speed: float = 1.0
    
    # 分割追溯
    parent_clip_id: Optional[str] = None
    
    # 文本内容 (text, subtitle)
    content_text: Optional[str] = None
    text_style: Optional[dict] = None
    
    # 特效/滤镜参数 (effect, filter)
    effect_type: Optional[str] = None
    effect_params: Optional[dict] = None
    
    # 配音参数 (voice)
    voice_params: Optional[dict] = None
    
    # 贴纸 (sticker)
    sticker_id: Optional[str] = None
    
    # 元数据
    name: Optional[str] = None
    color: Optional[str] = None
    metadata: Optional[dict] = None
    
    # 缓存
    cached_url: Optional[str] = None
    
    # 兼容旧字段
    subtitle_text: Optional[str] = None
    subtitle_style: Optional[dict] = None


class Timeline(BaseModel):
    """时间轴模型 - 用于前端兼容"""
    tracks: list[Track] = []
    clips: list[Clip] = []
    duration: float = 0


# ============================================
# 转写相关
# ============================================

class TranscriptWord(BaseModel):
    word: str
    start: float
    end: float
    confidence: float = 0.0


class TranscriptSegment(BaseModel):
    id: str
    text: str
    start: float
    end: float
    words: list[TranscriptWord] = []
    speaker: Optional[str] = None
    deleted: bool = False


# ============================================
# 项目相关（适配新表）
# ============================================

class ProjectSettings(BaseModel):
    """项目设置 - 用于前端兼容"""
    resolution: Resolution = Resolution()
    fps: int = 30


class Project(BaseModel):
    """项目模型"""
    id: str
    user_id: Optional[str] = None
    name: str
    description: Optional[str] = None
    thumbnail_url: Optional[str] = None
    resolution: dict = {"width": 1920, "height": 1080}
    fps: int = 30
    status: str = "draft"
    created_at: datetime
    updated_at: datetime


class ProjectCreate(BaseModel):
    name: str
    description: Optional[str] = None
    resolution: Optional[dict] = None
    fps: Optional[int] = None


class ProjectUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    thumbnail_url: Optional[str] = None
    resolution: Optional[dict] = None
    fps: Optional[int] = None
    status: Optional[str] = None
    wizard_completed: Optional[bool] = None


# ============================================
# 资源相关
# ============================================

class Asset(BaseModel):
    """资源模型"""
    id: str
    user_id: Optional[str] = None
    project_id: Optional[str] = None
    file_type: str
    storage_path: str
    original_filename: str
    file_size: int = 0
    mime_type: Optional[str] = None
    duration: Optional[float] = None
    width: Optional[int] = None
    height: Optional[int] = None
    fps: Optional[float] = None
    sample_rate: Optional[int] = None
    channels: Optional[int] = None
    thumbnail_path: Optional[str] = None
    waveform_path: Optional[str] = None
    parent_id: Optional[str] = None
    status: str = "uploading"
    created_at: datetime
    updated_at: datetime


class PresignUploadRequest(BaseModel):
    project_id: str
    file_name: str
    file_size: int
    content_type: str


class PresignUploadResponse(BaseModel):
    asset_id: str
    upload_url: str
    storage_path: str
    expires_at: str


class ConfirmUploadRequest(BaseModel):
    asset_id: str
    project_id: str
    file_name: str
    file_size: int
    content_type: str
    storage_path: str
    duration: Optional[float] = None  # 视频/音频时长（毫秒），前端本地提取


class ProcessAdditionsRequest(BaseModel):
    """处理新添加素材的请求"""
    project_id: str
    asset_ids: List[str]  # 需要处理的 asset ID 列表
    enable_asr: bool = True  # 是否执行 ASR 转写
    enable_smart_camera: bool = False  # 是否执行智能运镜


class ProcessAdditionsStatus(BaseModel):
    """处理新添加素材的状态"""
    task_id: str
    project_id: str
    status: str = "pending"  # pending, processing, completed, failed
    current_step: Optional[str] = None
    progress: int = 0
    total_assets: int = 0
    processed_assets: int = 0
    created_clips: int = 0
    error: Optional[str] = None


# ============================================
# 任务相关
# ============================================

class TaskStatus(BaseModel):
    """任务状态模型"""
    id: str
    task_type: str
    status: str = "pending"
    progress: int = 0
    result: Optional[dict] = None
    error_message: Optional[str] = None


class ASRRequest(BaseModel):
    """对整个 asset（原始视频）进行 ASR"""
    asset_id: str
    language: str = "zh"
    model: str = "large-v3"


class ASRClipRequest(BaseModel):
    """对特定 clip（片段）进行 ASR，只转写 clip 对应的时间范围"""
    clip_id: str
    language: str = "zh"
    model: str = "large-v3"


class ExtractAudioRequest(BaseModel):
    """从视频中提取音频轨道"""
    asset_id: str
    format: str = "wav"  # wav, mp3, aac
    source_start: Optional[float] = None  # 殥秒，从原视频的哪个位置开始
    duration: Optional[float] = None  # 殥秒，截取多长


# ============================================
# 导出相关
# ============================================

class ExportSettings(BaseModel):
    """导出设置"""
    resolution: Optional[str] = None  # 分辨率 ID: 480p, 720p, 1080p, 2k, 4k, 8k, original
    fps: Optional[float] = 30  # 帧率: 24, 25, 29.97, 30, 50, 59.94, 60
    format: Optional[str] = "mp4"  # 格式: mp4 (H.264) 适合社交媒体, mov (ProRes) 专业剪辑
    title: Optional[str] = None  # 导出文件名
    video_codec: Optional[str] = None  # 自动根据 format 选择
    video_bitrate: Optional[str] = None
    audio_codec: Optional[str] = None  # 自动根据 format 选择
    audio_bitrate: Optional[str] = None


class ExportRequest(BaseModel):
    project_id: str
    preset: Optional[str] = None  # 分辨率预设
    custom_settings: Optional[ExportSettings] = None  # 自定义设置


class ExportStatus(BaseModel):
    id: str
    project_id: str
    status: str = "queued"
    progress: int = 0
    output_url: Optional[str] = None
    error_message: Optional[str] = None  # 新字段名


# ============================================
# 错误响应
# ============================================

class ErrorResponse(BaseModel):
    code: str
    message: str
    details: Optional[dict] = None


class VersionConflictError(BaseModel):
    error: str = "version_conflict"
    message: str
    server_version: int


# ============================================
# Lepus AI — PRD v1.1 模型
# ============================================

class RouteStep(BaseModel):
    """路由步骤 — 单个 AI 能力节点"""
    capability: str
    params: dict = {}
    prompt_template: str = ""
    reason: Optional[str] = None
    estimated_credits: Optional[int] = None


class GoldenPreset(BaseModel):
    """黄金预设 — 验证过的效果组合"""
    id: str
    name: str
    description: Optional[str] = None


class RouteResult(BaseModel):
    """路由结果 — IntentRouter 输出"""
    route: List[RouteStep] = []
    overall_description: str = ""
    suggested_golden_preset: Optional[str] = None
    suggested_output_duration: float = 0.0
    total_estimated_credits: int = 0
    confidence: float = 0.0


class TrendTemplateModel(BaseModel):
    """热门模板 (PRD §6 — 对应 trend_templates 表)"""
    id: str
    name: str
    description: Optional[str] = None
    thumbnail_url: Optional[str] = None
    preview_video_url: Optional[str] = None
    before_url: Optional[str] = None
    after_url: Optional[str] = None
    category: str
    route: List[RouteStep] = []
    golden_preset: Optional[dict] = None
    output_duration: float = 0
    output_aspect_ratio: str = "1:1"
    author_type: str = "official"
    tags: List[str] = []
    usage_count: int = 0
    trending_score: int = 0
    status: str = "draft"
    created_by: Optional[str] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


class TrendTemplateCreate(BaseModel):
    """创建热门模板"""
    name: str
    description: Optional[str] = None
    thumbnail_url: Optional[str] = None
    preview_video_url: Optional[str] = None
    category: str
    route: List[RouteStep] = []
    golden_preset: Optional[dict] = None
    output_duration: float = 0
    output_aspect_ratio: str = "1:1"
    author_type: str = "official"
    tags: List[str] = []


class CanvasSessionModel(BaseModel):
    """画布会话 (PRD §7 — 对应 canvas_sessions 表)"""
    id: str
    user_id: str
    template_id: Optional[str] = None
    state: dict = {}
    status: str = "draft"
    title: Optional[str] = None
    thumbnail_url: Optional[str] = None
    route_result: Optional[dict] = None
    subject_url: Optional[str] = None
    reference_url: Optional[str] = None
    text_input: Optional[str] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


class CapabilityRegistryModel(BaseModel):
    """能力注册表 (PRD §5 — 对应 capability_registry 表)"""
    type: str
    name: str
    description: Optional[str] = None
    param_schema: dict = {}
    requires_face: bool = False
    estimated_time: int = 30
    credit_cost: int = 1
    sort_order: int = 0
    enabled: bool = True


class CapabilityExecutionModel(BaseModel):
    """能力执行记录 (对应 capability_executions 表)"""
    id: str
    session_id: str
    user_id: str
    capability_type: str
    input_urls: List[str] = []
    params: dict = {}
    status: str = "queued"
    result_url: Optional[str] = None
    error: Optional[str] = None
    credits_used: int = 0
    duration_ms: Optional[int] = None
    chain_id: Optional[str] = None
    chain_order: int = 0
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
