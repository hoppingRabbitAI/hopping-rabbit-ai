"""
HoppingRabbit AI - Smart Clean Task (VAD + LLM)
"""
import logging
from typing import Optional

from app.config import get_settings
from app.services.supabase_client import get_supabase

# 配置日志
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

settings = get_settings()

# 常见的中文口癖词
FILLER_WORDS = [
    "嗯", "呃", "啊", "那个", "就是", "然后", "其实", "所以说",
    "怎么说呢", "你知道吗", "对吧", "是不是", "额",
]


# ============================================
# 同步模式（无 Celery）
# ============================================

async def smart_clean_async(
    project_id: str, 
    segments: list[dict],
    on_progress: Optional[callable] = None
) -> dict:
    """
    智能清洗（异步版本）
    
    1. 检测静音片段（基于 segments 的 gap）
    2. 识别口癖词
    3. 使用 LLM 识别重复/NG 片段
    """
    try:
        if on_progress:
            on_progress(10, "正在分析音频...")
        
        silence_ids = []
        disfluency_ids = []
        
        # 1. 检测片段间的静音间隙
        for i in range(1, len(segments)):
            prev_end = segments[i - 1]["end"]
            curr_start = segments[i]["start"]
            gap = curr_start - prev_end
            
            # 如果间隙超过 0.8 秒，标记为静音
            if gap > 0.8:
                pass
        
        if on_progress:
            on_progress(30, "正在识别口癖词...")
        
        # 2. 识别口癖词
        for seg in segments:
            text = seg.get("text", "").strip()
            if text in FILLER_WORDS or len(text) <= 2 and any(f in text for f in FILLER_WORDS):
                disfluency_ids.append(seg["id"])
        
        if on_progress:
            on_progress(50, "正在识别重复片段...")
        
        # 3. 使用 LLM 识别重复/NG 片段
        if settings.openai_api_key:
            ng_ids = detect_ng_segments_with_llm(segments)
            disfluency_ids.extend(ng_ids)
        
        if on_progress:
            on_progress(80, "正在应用清洗...")
        
        # 4. 更新 segments
        updated_segments = []
        total_removed = 0.0
        
        for seg in segments:
            if seg["id"] in silence_ids:
                seg["is_deleted"] = True
                seg["delete_reason"] = "silence"
                total_removed += seg["end"] - seg["start"]
            elif seg["id"] in disfluency_ids:
                seg["is_deleted"] = True
                seg["delete_reason"] = "disfluency"
                total_removed += seg["end"] - seg["start"]
            updated_segments.append(seg)
        
        # 5. 保存到数据库
        supabase = get_supabase()
        supabase.table("projects").update({
            "segments": updated_segments,
        }).eq("id", project_id).execute()
        
        if on_progress:
            on_progress(100, "清洗完成")
        
        return {
            "success": True,
            "silence_segments": silence_ids,
            "disfluency_segments": disfluency_ids,
            "total_removed_duration": round(total_removed, 2),
            "segments": updated_segments,
        }
        
    except Exception as e:
        logger.error(f"智能清洗失败: {e}")
        raise


def detect_ng_segments_with_llm(segments: list[dict]) -> list[str]:
    """
    使用 LLM 检测 NG 镜头（重复说的句子）
    
    思路：将连续的几句话发给 GPT，让它判断是否有"说错重录"的情况
    """
    from openai import OpenAI
    
    client = OpenAI(api_key=settings.openai_api_key)
    ng_ids = []
    
    # 分批处理，每批 10 个片段
    batch_size = 10
    for i in range(0, len(segments), batch_size):
        batch = segments[i:i + batch_size]
        
        # 构建 prompt
        texts = "\n".join([f"{j+1}. [{s['id']}] {s['text']}" for j, s in enumerate(batch)])
        
        prompt = f"""你是一个视频剪辑助手。以下是一段口播视频的逐句文稿，请分析哪些句子是"说错后重录"的废片（NG镜头）。

特征：
1. 连续两句话意思几乎相同，后一句是对前一句的重说
2. 句子说到一半停顿后重新开始
3. 明显的口误后纠正

文稿：
{texts}

请返回应该删除的句子 ID（方括号内的 ID），用逗号分隔。如果没有需要删除的，返回"无"。
只返回 ID 列表，不要其他解释。"""

        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[{"role": "user", "content": prompt}],
            temperature=0,
            max_tokens=200,
        )
        
        result = response.choices[0].message.content.strip()
        
        if result and result != "无":
            # 解析返回的 ID
            for seg_id in result.split(","):
                seg_id = seg_id.strip()
                if seg_id.startswith("seg_"):
                    ng_ids.append(seg_id)
    
    return ng_ids


# ============================================
# Celery 任务（延迟导入避免循环依赖）
# ============================================

try:
    from ..celery_config import celery_app, update_task_progress, update_task_status
    CELERY_AVAILABLE = True
except ImportError:
    CELERY_AVAILABLE = False
    logger.info("Celery 未配置，使用同步模式")


if CELERY_AVAILABLE:
    @celery_app.task(bind=True, queue="cpu_low")
    def smart_clean_task(self, project_id: str, segments: list[dict]):
        """
        智能清洗 Celery 任务
        """
        import asyncio
        
        def progress_callback(progress: int, message: str):
            update_task_progress(self, progress, message)
        
        try:
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
            result = loop.run_until_complete(
                smart_clean_async(project_id, segments, on_progress=progress_callback)
            )
            loop.close()
            return result
        except Exception as e:
            update_task_status(self, "FAILURE", error=str(e))
            raise
