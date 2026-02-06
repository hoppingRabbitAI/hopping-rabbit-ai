"""
标杆视频拆解服务 (Benchmark Video Analyzer)

使用豆包多模态模型分析标杆视频:
1. 视频结构分析 (开场/主体/结尾)
2. B-Roll 出现时机和类型识别
3. 视觉元素提取 (数据图表/关键词卡片/流程图等)
4. 剪辑节奏分析

技术栈:
- 火山方舟 Responses API (视频理解)
- 模型: doubao-seed-1-8-251228 (支持视频输入)
"""

import os
import json
import time
import asyncio
import logging
from typing import Optional, List, Dict, Any
from pathlib import Path
from dataclasses import dataclass, asdict
from enum import Enum

import httpx

from app.config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()


# ============================================
# 数据结构定义
# ============================================

class ContentType(str, Enum):
    """内容类型"""
    HOOK = "hook"                    # 开场钩子
    POINT = "point"                  # 核心要点
    DATA = "data"                    # 数据展示
    STORY = "story"                  # 故事/案例
    COMPARISON = "comparison"        # 对比分析
    CONCEPT = "concept"              # 概念解释
    TRANSITION = "transition"        # 过渡
    SUMMARY = "summary"              # 总结
    CTA = "cta"                      # 行动号召
    OTHER = "other"


class VisualElementType(str, Enum):
    """视觉元素类型"""
    TALKING_HEAD = "talking_head"    # 口播画面
    BROLL = "broll"                  # B-Roll 素材
    SCREEN_RECORD = "screen_record"  # 屏幕录制
    DATA_CHART = "data_chart"        # 数据图表
    KEYWORD_CARD = "keyword_card"    # 关键词卡片
    PROCESS_FLOW = "process_flow"    # 流程图
    COMPARISON_TABLE = "comparison"  # 对比表格
    QUOTE_BLOCK = "quote_block"      # 引用块
    TITLE_CARD = "title_card"        # 标题卡
    LOWER_THIRD = "lower_third"      # 下方字幕条
    ANIMATION = "animation"          # 动画
    IMAGE = "image"                  # 静态图片
    OTHER = "other"


@dataclass
class VisualElement:
    """视觉元素"""
    type: str                        # 视觉元素类型
    start_time: str                  # 开始时间 (HH:mm:ss)
    end_time: str                    # 结束时间
    description: str                 # 描述
    position: Optional[str] = None   # 位置 (全屏/左侧/右侧/画中画等)
    animation: Optional[str] = None  # 动画效果


@dataclass
class VideoSegment:
    """视频片段分析结果"""
    segment_id: int
    start_time: str                  # 开始时间 (HH:mm:ss)
    end_time: str                    # 结束时间
    duration_seconds: int            # 时长(秒)
    
    # 内容分析
    content_type: str                # 内容类型
    spoken_text: str                 # 口播内容 (如果有)
    key_points: List[str]            # 关键要点
    
    # 视觉分析
    visual_elements: List[Dict]      # 视觉元素列表
    main_visual: str                 # 主要视觉形式
    has_broll: bool                  # 是否有 B-Roll
    broll_description: Optional[str] = None  # B-Roll 描述
    
    # 数据提取
    extracted_data: Optional[Dict] = None  # 提取的数据 (数字/百分比等)
    
    # 剪辑分析
    cut_count: int = 0               # 该片段内的镜头切换次数
    pacing: str = "normal"           # 节奏 (fast/normal/slow)


@dataclass
class BenchmarkAnalysis:
    """标杆视频完整分析结果"""
    video_id: str
    video_path: str
    total_duration: str              # 总时长
    
    # 整体风格
    template_type: str               # 模版类型 (mixed-media/talking-head/whiteboard等)
    overall_style: str               # 整体风格描述
    target_audience: str             # 目标受众
    
    # 结构分析
    structure_summary: str           # 结构概述
    segments: List[Dict]             # 分段详情
    
    # B-Roll 统计
    broll_percentage: float          # B-Roll 占比
    broll_scenes: List[Dict]         # B-Roll 场景列表
    
    # 视觉元素统计
    visual_element_stats: Dict[str, int]  # 各类视觉元素数量
    
    # 剪辑节奏
    average_shot_duration: float     # 平均镜头时长(秒)
    total_cuts: int                  # 总镜头切换次数
    pacing_analysis: str             # 节奏分析


# ============================================
# 豆包视频理解客户端
# ============================================

class DoubaoVisionClient:
    """
    豆包视频理解客户端
    
    使用火山方舟 Responses API 进行视频分析
    """
    
    def __init__(self):
        self.api_key = settings.volcengine_ark_api_key
        self.base_url = "https://ark.cn-beijing.volces.com/api/v3"
        self.model = "doubao-seed-1-8-251228"  # 支持视频理解的模型
        self.timeout = 300.0  # 视频处理需要更长时间
        
        if not self.api_key:
            raise ValueError("缺少 volcengine_ark_api_key 配置")
    
    async def upload_video(self, video_path: str, fps: float = 0.5) -> str:
        """
        上传视频文件到火山方舟
        
        Args:
            video_path: 本地视频文件路径
            fps: 视频采样帧率 (默认 0.5, 即每2秒取1帧)
        
        Returns:
            file_id: 上传后的文件ID
        """
        logger.info(f"[DoubaoVision] 开始上传视频: {video_path}")
        
        if not os.path.exists(video_path):
            raise FileNotFoundError(f"视频文件不存在: {video_path}")
        
        # 使用更长的超时时间进行上传
        upload_timeout = httpx.Timeout(timeout=600.0, connect=30.0)
        
        async with httpx.AsyncClient(timeout=upload_timeout) as client:
            # 1. 上传文件
            with open(video_path, "rb") as f:
                file_content = f.read()
            
            # 使用 multipart/form-data 格式
            files = {
                "file": (os.path.basename(video_path), file_content, "video/mp4"),
            }
            data = {
                "purpose": "user_data",
                "preprocess_configs[video][fps]": str(fps)
            }
            
            response = await client.post(
                f"{self.base_url}/files",
                headers={"Authorization": f"Bearer {self.api_key}"},
                files=files,
                data=data
            )
            
            if response.status_code != 200:
                logger.error(f"[DoubaoVision] 上传失败: {response.status_code} - {response.text}")
                response.raise_for_status()
            
            result = response.json()
            file_id = result["id"]
            status = result.get("status", "processing")
            
            logger.info(f"[DoubaoVision] 文件已上传, file_id={file_id}, status={status}")
            
            # 2. 等待处理完成 (轮询文件状态)
            max_wait_time = 300  # 最多等待5分钟
            waited = 0
            while status == "processing" and waited < max_wait_time:
                await asyncio.sleep(3)
                waited += 3
                response = await client.get(
                    f"{self.base_url}/files/{file_id}",
                    headers={"Authorization": f"Bearer {self.api_key}"}
                )
                response.raise_for_status()
                result = response.json()
                status = result.get("status", "processing")
                logger.info(f"[DoubaoVision] 文件处理中... status={status}, waited={waited}s")
            
            if status == "error":
                raise Exception(f"视频处理失败: {result}")
            
            if status == "processing":
                raise Exception(f"视频处理超时: {file_id}")
            
            logger.info(f"[DoubaoVision] 视频处理完成, file_id={file_id}")
            return file_id
    
    async def analyze_video(
        self, 
        file_id: str, 
        prompt: str,
        temperature: float = 0.3
    ) -> str:
        """
        分析视频内容
        
        Args:
            file_id: 上传后的文件ID
            prompt: 分析提示词
            temperature: 温度参数
        
        Returns:
            分析结果文本
        """
        logger.info(f"[DoubaoVision] 开始分析视频, file_id={file_id}")
        
        # 根据火山方舟官方文档格式
        payload = {
            "model": self.model,
            "input": [
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "input_video",
                            "file_id": file_id
                        },
                        {
                            "type": "input_text",
                            "text": prompt
                        }
                    ]
                }
            ]
        }
        
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            response = await client.post(
                f"{self.base_url}/responses",
                headers={
                    "Authorization": f"Bearer {self.api_key}",
                    "Content-Type": "application/json"
                },
                json=payload
            )
            
            # 详细记录错误信息
            if response.status_code != 200:
                logger.error(f"[DoubaoVision] Responses API 错误: {response.status_code}")
                logger.error(f"[DoubaoVision] 响应内容: {response.text}")
                response.raise_for_status()
            
            result = response.json()
            # 打印完整响应以便调试
            logger.info(f"[DoubaoVision] API 状态: {result.get('status')}, tokens: {result.get('usage', {}).get('total_tokens')}")
            
            # 提取输出文本 - 火山方舟 Responses API 格式
            # output 数组中: type="reasoning" 是推理过程, type="message" 是最终答案
            output = result.get("output", [])
            for item in output:
                if item.get("type") == "message":
                    content = item.get("content", [])
                    for c in content:
                        # 字段类型是 output_text
                        if c.get("type") == "output_text":
                            text = c.get("text", "")
                            if text:
                                logger.info(f"[DoubaoVision] 分析完成, 输出长度: {len(text)}")
                                return text
            
            # 兼容旧格式: output[].content[].text
            if output and len(output) > 0:
                content = output[0].get("content", [])
                if content and len(content) > 0:
                    text = content[0].get("text", "")
                    if text:
                        logger.info(f"[DoubaoVision] 分析完成(旧格式), 输出长度: {len(text)}")
                        return text
            
            # 格式2: choices[].message.content
            choices = result.get("choices", [])
            if choices and len(choices) > 0:
                message = choices[0].get("message", {})
                text = message.get("content", "")
                if text:
                    logger.info(f"[DoubaoVision] 分析完成(choices格式), 输出长度: {len(text)}")
                    return text
            
            # 格式3: 直接返回 text
            if "text" in result:
                text = result["text"]
                logger.info(f"[DoubaoVision] 分析完成(text格式), 输出长度: {len(text)}")
                return text
            
            # 返回完整响应供调试
            logger.warning(f"[DoubaoVision] 未识别的响应格式，返回完整响应")
            return json.dumps(result, ensure_ascii=False)
    
    async def delete_file(self, file_id: str):
        """删除已上传的文件"""
        try:
            async with httpx.AsyncClient(timeout=30) as client:
                response = await client.delete(
                    f"{self.base_url}/files/{file_id}",
                    headers={"Authorization": f"Bearer {self.api_key}"}
                )
                response.raise_for_status()
                logger.info(f"[DoubaoVision] 文件已删除: {file_id}")
        except Exception as e:
            logger.warning(f"[DoubaoVision] 删除文件失败: {e}")


# ============================================
# 标杆视频分析服务
# ============================================

class BenchmarkAnalyzerService:
    """
    标杆视频分析服务
    
    负责调用豆包视频理解 API 进行完整的视频拆解
    """
    
    def __init__(self):
        self.vision_client = DoubaoVisionClient()
    
    async def analyze_benchmark_video(
        self,
        video_path: str,
        video_id: Optional[str] = None,
        creator_name: Optional[str] = None,
        fps: float = 0.5
    ) -> BenchmarkAnalysis:
        """
        完整分析一个标杆视频
        
        Args:
            video_path: 视频文件路径
            video_id: 视频ID (可选, 用于标识)
            creator_name: 创作者名称 (可选)
            fps: 采样帧率
        
        Returns:
            BenchmarkAnalysis 完整分析结果
        """
        if not video_id:
            video_id = Path(video_path).stem
        
        logger.info(f"[BenchmarkAnalyzer] 开始分析视频: {video_id}")
        
        # 1. 上传视频
        file_id = await self.vision_client.upload_video(video_path, fps=fps)
        
        try:
            # 2. 执行多轮分析
            
            # 2.1 整体风格和结构分析
            structure_result = await self._analyze_structure(file_id)
            
            # 2.2 详细分段分析 (B-Roll, 视觉元素等)
            segments_result = await self._analyze_segments(file_id)
            
            # 2.3 剪辑节奏分析
            pacing_result = await self._analyze_pacing(file_id)
            
            # 3. 整合分析结果
            analysis = self._merge_results(
                video_id=video_id,
                video_path=video_path,
                structure=structure_result,
                segments=segments_result,
                pacing=pacing_result
            )
            
            logger.info(f"[BenchmarkAnalyzer] 视频分析完成: {video_id}")
            return analysis
            
        finally:
            # 4. 清理上传的文件
            await self.vision_client.delete_file(file_id)
    
    async def _analyze_structure(self, file_id: str) -> Dict[str, Any]:
        """分析视频整体结构和风格"""
        
        prompt = """
请分析这个知识类视频的整体结构和风格。输出 JSON 格式:

{
    "template_type": "模版类型，从以下选择: mixed-media(混合媒体)/talking-head(口播主导)/whiteboard(白板讲解)/screencast(屏幕录制)/videographic(数据可视化)/slideshow(幻灯片)",
    "overall_style": "整体风格描述 (如: 快节奏、信息密集、轻松活泼等)",
    "target_audience": "目标受众 (如: 职场人士、学生、创业者等)",
    "total_duration": "视频总时长 (格式 mm:ss)",
    "structure_summary": "视频结构概述 (如: 开场提问-3个要点展开-总结回顾)",
    "main_sections": [
        {
            "section_name": "章节名称 (如: 开场/要点1/总结)",
            "start_time": "开始时间 (HH:mm:ss)",
            "end_time": "结束时间",
            "section_type": "类型: hook/point/data/story/comparison/concept/summary/cta"
        }
    ]
}

请仔细观察视频内容，准确识别各个章节的边界和类型。
"""
        
        result_text = await self.vision_client.analyze_video(file_id, prompt)
        return self._parse_json_response(result_text)
    
    async def _analyze_segments(self, file_id: str) -> Dict[str, Any]:
        """分析视频各片段的详细内容"""
        
        prompt = """
请逐段分析这个视频的内容和视觉元素。重点关注:
1. B-Roll (素材画面) 的出现时机和内容
2. 数据图表、关键词卡片等视觉元素
3. 口播内容和画面的配合

输出 JSON 格式:

{
    "segments": [
        {
            "segment_id": 1,
            "start_time": "00:00:00",
            "end_time": "00:00:15",
            "duration_seconds": 15,
            "content_type": "内容类型: hook/point/data/story/comparison/concept/transition/summary/cta",
            "spoken_text": "这段的口播内容概要",
            "key_points": ["关键要点1", "关键要点2"],
            "visual_elements": [
                {
                    "type": "视觉元素类型: talking_head/broll/screen_record/data_chart/keyword_card/process_flow/comparison/quote_block/title_card/lower_third/animation/image",
                    "start_time": "00:00:00",
                    "end_time": "00:00:05",
                    "description": "具体描述",
                    "position": "位置: fullscreen/left/right/pip_bottom_right/overlay_center等"
                }
            ],
            "main_visual": "主要视觉形式",
            "has_broll": true,
            "broll_description": "B-Roll 内容描述 (如果有)",
            "extracted_data": {
                "numbers": ["300%", "5倍"],
                "keywords": ["MVP", "增长"]
            }
        }
    ],
    "broll_scenes": [
        {
            "start_time": "00:00:30",
            "end_time": "00:00:35",
            "description": "B-Roll 内容描述",
            "related_speech": "对应的口播内容"
        }
    ]
}

请仔细观察每一帧，准确标注各种视觉元素的出现时间。
"""
        
        result_text = await self.vision_client.analyze_video(file_id, prompt)
        return self._parse_json_response(result_text)
    
    async def _analyze_pacing(self, file_id: str) -> Dict[str, Any]:
        """分析视频剪辑节奏"""
        
        prompt = """
请分析这个视频的剪辑节奏。统计镜头切换、画面变化等。

输出 JSON 格式:

{
    "total_cuts": 镜头切换总次数,
    "average_shot_duration": 平均每个镜头持续秒数,
    "pacing_analysis": "节奏分析描述 (如: 快节奏，平均每3秒切换一次画面，数据展示时会放慢节奏)",
    "visual_rhythm": {
        "fast_sections": ["00:00:00-00:00:30", "00:02:00-00:02:30"],
        "slow_sections": ["00:01:00-00:01:30"]
    },
    "transition_types": {
        "cut": 直切次数,
        "fade": 淡入淡出次数,
        "zoom": 缩放次数,
        "slide": 滑动次数
    }
}

请准确计数镜头切换次数，并分析不同部分的节奏变化。
"""
        
        result_text = await self.vision_client.analyze_video(file_id, prompt)
        return self._parse_json_response(result_text)
    
    def _parse_json_response(self, text: str) -> Dict[str, Any]:
        """解析 JSON 响应"""
        try:
            # 尝试直接解析
            return json.loads(text)
        except json.JSONDecodeError:
            # 尝试提取 JSON 块
            import re
            json_match = re.search(r'```json\s*([\s\S]*?)\s*```', text)
            if json_match:
                return json.loads(json_match.group(1))
            
            # 尝试找到 { 开始的 JSON
            start = text.find('{')
            end = text.rfind('}') + 1
            if start >= 0 and end > start:
                return json.loads(text[start:end])
            
            logger.warning(f"无法解析 JSON 响应: {text[:200]}...")
            return {}
    
    def _merge_results(
        self,
        video_id: str,
        video_path: str,
        structure: Dict,
        segments: Dict,
        pacing: Dict
    ) -> BenchmarkAnalysis:
        """整合所有分析结果"""
        
        # 计算 B-Roll 占比
        segment_list = segments.get("segments", [])
        broll_duration = 0
        total_duration = 0
        visual_stats = {}
        
        for seg in segment_list:
            duration = seg.get("duration_seconds", 0)
            total_duration += duration
            
            for ve in seg.get("visual_elements", []):
                ve_type = ve.get("type", "other")
                visual_stats[ve_type] = visual_stats.get(ve_type, 0) + 1
                
                if ve_type == "broll":
                    # 估算 B-Roll 时长
                    broll_duration += duration * 0.5  # 简化估算
        
        broll_percentage = (broll_duration / total_duration * 100) if total_duration > 0 else 0
        
        return BenchmarkAnalysis(
            video_id=video_id,
            video_path=video_path,
            total_duration=structure.get("total_duration", "00:00"),
            template_type=structure.get("template_type", "mixed-media"),
            overall_style=structure.get("overall_style", ""),
            target_audience=structure.get("target_audience", ""),
            structure_summary=structure.get("structure_summary", ""),
            segments=segment_list,
            broll_percentage=round(broll_percentage, 1),
            broll_scenes=segments.get("broll_scenes", []),
            visual_element_stats=visual_stats,
            average_shot_duration=pacing.get("average_shot_duration", 0),
            total_cuts=pacing.get("total_cuts", 0),
            pacing_analysis=pacing.get("pacing_analysis", "")
        )


# ============================================
# 快速分析接口 (单次调用)
# ============================================

async def quick_analyze_video(video_path: str) -> Dict[str, Any]:
    """
    快速分析视频 (单次 API 调用，成本更低)
    
    适用于快速了解视频概况，不需要详细分段
    """
    
    client = DoubaoVisionClient()
    file_id = await client.upload_video(video_path, fps=0.3)
    
    try:
        prompt = """
请分析这个知识类视频，输出 JSON 格式:

{
    "template_type": "模版类型: mixed-media/talking-head/whiteboard/screencast/videographic/slideshow",
    "total_duration": "总时长 (mm:ss)",
    "structure": {
        "hook": "开场方式描述",
        "main_points": ["要点1", "要点2", "要点3"],
        "ending": "结尾方式"
    },
    "visual_style": {
        "main_visual": "主要视觉形式 (口播为主/B-Roll为主/图文为主)",
        "broll_usage": "B-Roll 使用情况描述",
        "graphics": "图形元素使用 (数据图表/关键词卡片等)"
    },
    "pacing": {
        "overall": "整体节奏 (快/中/慢)",
        "avg_shot_seconds": 预估平均镜头时长秒数
    },
    "key_timestamps": [
        {"time": "00:00:00", "event": "事件描述"}
    ]
}
"""
        
        result_text = await client.analyze_video(file_id, prompt)
        
        logger.info(f"[QuickAnalyze] 原始返回: {result_text[:500] if result_text else 'EMPTY'}")
        
        # 解析结果
        if not result_text:
            return {"error": "API 返回空结果", "file_id": file_id}
        
        try:
            return json.loads(result_text)
        except:
            import re
            json_match = re.search(r'\{[\s\S]*\}', result_text)
            if json_match:
                return json.loads(json_match.group())
            return {"raw_response": result_text}
    
    finally:
        await client.delete_file(file_id)


async def detailed_visual_analyze(video_path: str) -> Dict[str, Any]:
    """
    精细视觉样式分析 - 获取画面布局、人物占比、字幕位置等详细信息
    """
    
    client = DoubaoVisionClient()
    file_id = await client.upload_video(video_path, fps=0.5)  # 更高帧率获取更多细节
    
    try:
        prompt = """
请对这个视频进行【精细视觉样式分析】，重点关注画面布局、人物位置、元素占比等细节。

输出 JSON 格式:

{
    "video_duration": "视频总时长 mm:ss",
    
    "主体人物样式": {
        "人物类型": "真人口播/虚拟形象/无人物",
        "人物位置": "全屏居中/左下角/右下角/左侧/右侧/画中画",
        "人物占画面比例": "100%/70%/50%/30%/20%等",
        "人物朝向": "面向镜头/侧面/45度角",
        "背景类型": "实景户外/实景室内/虚拟背景/纯色背景/模糊背景",
        "背景描述": "具体背景内容描述"
    },
    
    "画面布局模式": {
        "主要布局": "人物全屏/人物+侧边信息区/画中画/纯素材/分屏",
        "信息区位置": "无/右侧/左侧/底部/顶部",
        "信息区占比": "0%/30%/40%/50%",
        "是否有固定UI框架": true/false,
        "UI框架描述": "描述固定的视觉框架元素"
    },
    
    "字幕样式": {
        "是否有字幕": true/false,
        "字幕位置": "底部居中/底部偏下/画面中央/顶部",
        "字幕样式": "白字黑边/黄字/白底黑字/渐变背景",
        "字幕字号": "大/中/小",
        "是否逐字高亮": true/false,
        "高亮颜色": "黄色/红色/无"
    },
    
    "关键词卡片样式": {
        "是否使用关键词卡片": true/false,
        "卡片位置": "画面中央/右下角/左下角/跟随人物",
        "卡片背景": "无背景/半透明黑/纯色块/渐变",
        "卡片字体颜色": "白色/黄色/彩色",
        "卡片动画": "弹入/淡入/滑入/无动画",
        "示例文字": ["示例1", "示例2"]
    },
    
    "B-Roll插入样式": {
        "插入方式": "全屏替换/画中画/叠加在人物上/分屏并列",
        "画中画位置": "右下/左下/右上/左上/无",
        "画中画占比": "20%/30%/40%/无",
        "转场效果": "直切/淡入淡出/滑动/缩放",
        "B-Roll时是否保留人物": true/false
    },
    
    "分段视觉详情": [
        {
            "时间段": "00:00:00-00:00:10",
            "画面类型": "口播/B-Roll/图文",
            "人物可见": true/false,
            "人物位置": "全屏/左下/右下/无",
            "人物占比": "100%/50%/30%/0%",
            "背景内容": "描述",
            "叠加元素": ["字幕", "关键词卡片", "Logo"],
            "叠加元素位置": ["底部", "右下", "右上"],
            "画面描述": "详细描述这段的视觉呈现"
        }
    ],
    
    "整体视觉风格总结": {
        "主色调": "描述主要颜色",
        "风格标签": ["科技感/轻松/专业/活泼"],
        "参考模版": "这个视频最像哪种常见模版风格"
    }
}

请仔细观察视频的每一帧，准确描述各元素的位置和占比。特别注意：
1. 人物在画面中的精确位置（是占满全屏还是只在角落）
2. 字幕的具体位置和样式
3. B-Roll出现时人物是消失还是变成画中画
4. 是否有固定的视觉框架贯穿全片
"""
        
        result_text = await client.analyze_video(file_id, prompt)
        
        if not result_text:
            return {"error": "API 返回空结果", "file_id": file_id}
        
        try:
            return json.loads(result_text)
        except:
            import re
            json_match = re.search(r'\{[\s\S]*\}', result_text)
            if json_match:
                return json.loads(json_match.group())
            return {"raw_response": result_text}
    
    finally:
        await client.delete_file(file_id)


async def full_benchmark_analyze(video_path: str) -> Dict[str, Any]:
    """
    综合分析 - 一次调用获取全部信息（内容结构 + 精细视觉样式）
    
    上传一次视频，进行两轮分析：
    1. 内容结构分析（结构、要点、B-Roll时机）
    2. 精细视觉分析（布局、人物占比、字幕位置）
    """
    
    client = DoubaoVisionClient()
    file_id = await client.upload_video(video_path, fps=0.5)
    
    try:
        # === 第一轮：内容结构分析 ===
        content_prompt = """
请分析这个知识类视频的内容结构，输出 JSON 格式:

{
    "video_duration": "视频总时长 mm:ss",
    "template_type": "模版类型: mixed-media/talking-head/whiteboard/screencast",
    "target_audience": "目标受众",
    "overall_style": "整体风格描述",
    
    "structure": {
        "hook": "开场方式描述（0-10秒如何抓住注意力）",
        "main_points": [
            {"point": "要点1内容", "time_range": "00:10-00:30"},
            {"point": "要点2内容", "time_range": "00:30-00:50"},
            {"point": "要点3内容", "time_range": "00:50-01:10"}
        ],
        "ending": "结尾方式（CTA/总结/引导）"
    },
    
    "broll_timeline": [
        {
            "time": "00:00:05",
            "duration_seconds": 3,
            "trigger_speech": "触发B-Roll的口播内容",
            "broll_content": "B-Roll画面内容描述",
            "broll_type": "人物/技术演示/场景/概念动画/情绪画面"
        }
    ],
    
    "pacing": {
        "total_cuts": 镜头切换总次数,
        "avg_shot_seconds": 平均镜头时长,
        "rhythm_description": "节奏描述"
    }
}
"""
        
        content_result = await client.analyze_video(file_id, content_prompt)
        content_data = {}
        if content_result:
            try:
                content_data = json.loads(content_result)
            except:
                import re
                json_match = re.search(r'\{[\s\S]*\}', content_result)
                if json_match:
                    content_data = json.loads(json_match.group())
        
        # === 第二轮：精细视觉分析 ===
        visual_prompt = """
请对这个视频进行精细视觉样式分析，输出 JSON 格式:

{
    "layout": {
        "main_layout": "人物全屏/人物+侧边栏/画中画/纯素材",
        "person_position": "全屏居中/左下角/右下角/左侧/右侧",
        "person_ratio": "人物占画面比例 (如70%/50%/30%)",
        "pip_position": "画中画位置: 下方中央/右下/左下/无",
        "pip_ratio": "画中画占比 (如30%/20%/无)",
        "has_fixed_ui": true/false,
        "ui_description": "固定UI框架描述"
    },
    
    "person_style": {
        "type": "真人口播/虚拟形象/无人物",
        "facing": "面向镜头/侧面/45度角",
        "equipment": "手持麦克风/领夹麦/无设备",
        "clothing": "穿着描述",
        "accessories": "配饰(眼镜等)",
        "background_type": "实景户外/实景室内/虚拟背景/纯色",
        "background_detail": "背景具体内容"
    },
    
    "subtitle_style": {
        "has_subtitle": true/false,
        "position": "画面中央/中央偏下/底部/顶部",
        "style": "白字黑边/黄字/白底黑字",
        "font_size": "大/中/小",
        "highlight": true/false,
        "highlight_color": "蓝色/黄色/无"
    },
    
    "keyword_card_style": {
        "has_cards": true/false,
        "position": "中央/右下/左下",
        "background": "无背景/半透明/纯色块",
        "font_color": "白色/黄色",
        "animation": "弹入/淡入/无",
        "examples": ["示例文字1", "示例文字2"]
    },
    
    "broll_style": {
        "insert_mode": "画中画/全屏替换/混合",
        "keep_person_visible": true/false,
        "transition": "直切/淡入淡出/滑动"
    },
    
    "color_scheme": {
        "primary_colors": ["主色1", "主色2"],
        "style_tags": ["科技感", "专业", "轻松"]
    },
    
    "segment_details": [
        {
            "time_range": "00:00-00:10",
            "type": "口播/B-Roll/口播+画中画",
            "person_visible": true/false,
            "person_position": "全屏/画中画/无",
            "overlays": ["字幕", "关键词卡片", "UI框架"],
            "description": "画面详细描述"
        }
    ]
}
"""
        
        visual_result = await client.analyze_video(file_id, visual_prompt)
        visual_data = {}
        if visual_result:
            try:
                visual_data = json.loads(visual_result)
            except:
                import re
                json_match = re.search(r'\{[\s\S]*\}', visual_result)
                if json_match:
                    try:
                        visual_data = json.loads(json_match.group())
                    except:
                        # JSON解析失败，保留原始文本
                        visual_data = {"raw_analysis": visual_result}
        
        # === 合并结果 ===
        return {
            "video_path": video_path,
            "video_id": Path(video_path).stem,
            "content_analysis": content_data,
            "visual_analysis": visual_data
        }
    
    finally:
        await client.delete_file(file_id)


# ============================================
# 服务实例
# ============================================

def get_benchmark_analyzer() -> BenchmarkAnalyzerService:
    """获取标杆分析服务实例"""
    return BenchmarkAnalyzerService()
