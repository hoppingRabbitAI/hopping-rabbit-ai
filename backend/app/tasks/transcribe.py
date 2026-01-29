"""
HoppingRabbit AI - ASR 转写任务
使用豆包大模型录音文件识别 API（火山引擎）

API 文档: https://www.volcengine.com/docs/6561/1354868
- 提交任务: https://openspeech.bytedance.com/api/v3/auc/bigmodel/submit
- 查询结果: https://openspeech.bytedance.com/api/v3/auc/bigmodel/query
- 支持格式: mp3, wav, ogg, mp4 等
- 返回: 句子级和词级时间戳
"""
import os
import asyncio
import logging
from typing import Optional, Callable
from uuid import uuid4
import httpx

# 配置日志
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# ============================================
# 豆包 ASR API 配置（火山引擎）
# ============================================

DOUBAO_SUBMIT_URL = "https://openspeech.bytedance.com/api/v3/auc/bigmodel/submit"
DOUBAO_QUERY_URL = "https://openspeech.bytedance.com/api/v3/auc/bigmodel/query"

# API 凭证
DOUBAO_APP_ID = os.getenv("DOUBAO_APP_ID", "7577147936")
DOUBAO_ACCESS_TOKEN = os.getenv("DOUBAO_ACCESS_TOKEN", "7jf8Bu2MpCiNDLxTbcOrqr4lHGudocja")

# 资源 ID: 1.0模型 volc.bigasr.auc, 2.0模型 volc.seedasr.auc
DOUBAO_RESOURCE_ID = os.getenv("DOUBAO_RESOURCE_ID", "volc.bigasr.auc")

# 支持的音频格式
SUPPORTED_FORMATS = ["mp3", "wav", "ogg", "mp4", "m4a", "flac", "webm", "aac"]

# 兼容旧代码
DEFAULT_MODEL = "doubao-asr"


# ============================================
# 核心转写函数
# ============================================

async def transcribe_audio(
    audio_url: str,
    language: str = "zh",
    model_name: str = DEFAULT_MODEL,
    model: str = None,  # 兼容旧参数名
    audio_format: str = None,  # 显式指定音频格式，优先于 URL 推断
    enable_word_timestamps: bool = True,
    word_timestamps: bool = True,  # 兼容旧参数名
    enable_diarization: bool = False,
    enable_ddc: bool = True,  # ★ 语义顺滑（去除语气词）- 口癖检测时应关闭
    hotwords: list[str] = None,
    on_progress: Optional[Callable[[int, str], None]] = None,
    task_id: str = None,  # 用于检查任务是否被取消
) -> dict:
    """
    使用豆包大模型录音文件识别 API 转写音频
    
    Args:
        audio_url: 音频文件 URL（必须是公网可访问的）
        language: 语言代码（豆包支持自动检测）
        audio_format: 显式指定音频格式（mp3, wav, mp4 等），优先于 URL 推断
        enable_word_timestamps: 是否启用逐词时间戳
        enable_diarization: 是否启用说话人分离
        enable_ddc: 是否启用语义顺滑（DDC）- 会删除"嗯"、"啊"等语气词
                    ★ 口癖检测时应设为 False 以保留原始语气词
        hotwords: 热词列表
        on_progress: 进度回调函数 (progress: int, step: str)
        task_id: 任务 ID，用于检查任务是否被取消
    
    Returns:
        dict: 包含 segments（带精确时间戳）, language, duration, word_count
    """
    
    logger.info(f"[ASR] ========== 开始转写 ==========")
    logger.info(f"[ASR] audio_url: {audio_url}")
    
    if on_progress:
        on_progress(5, "准备提交转写任务")
    
    # 1. 推断音频格式（优先使用显式指定的格式）
    if audio_format:
        final_format = audio_format.lower().lstrip('.')
        logger.info(f"[ASR] 使用显式指定格式: {final_format}")
    else:
        final_format = _get_audio_format(audio_url)
        logger.info(f"[ASR] 从 URL 推断格式: {final_format}")
    
    # 2. 提交转写任务
    if on_progress:
        on_progress(10, "提交豆包 ASR 任务")
    
    request_id = str(uuid4())
    logger.info(f"[ASR] 生成 request_id: {request_id}")
    
    submit_result = await _submit_asr_task(
        audio_url=audio_url,
        audio_format=final_format,
        request_id=request_id,
        enable_diarization=enable_diarization,
        enable_ddc=enable_ddc,  # ★ 传递语义顺滑开关
        hotwords=hotwords
    )
    
    if not submit_result["success"]:
        logger.error(f"[ASR] ❌ 提交任务失败: {submit_result.get('error', '未知错误')}")
        raise Exception(f"提交任务失败: {submit_result.get('error', '未知错误')}")
    
    logger.info(f"[ASR] ✅ 任务提交成功, request_id: {request_id}")
    
    # 3. 轮询查询结果
    if on_progress:
        on_progress(20, "等待转写处理中...")
    
    result = await _poll_asr_result(
        request_id=request_id,
        on_progress=on_progress,
        task_id=task_id,  # 传递 task_id 用于取消检查
    )
    
    if on_progress:
        on_progress(95, "解析转写结果")
    
    # 4. 解析结果
    segments = _parse_doubao_result(result)
    
    # 计算统计信息
    full_text = result.get("result", {}).get("text", "")
    word_count = len(full_text.replace(" ", ""))
    duration = result.get("audio_info", {}).get("duration", 0) / 1000.0  # 毫秒转秒
    
    if on_progress:
        on_progress(100, "转写完成")
    
    logger.info(f"[ASR] ✅ 转写完成: {len(segments)} 个片段, {word_count} 字, 时长 {duration:.2f}s")
    logger.info(f"[ASR] ========== 转写结束 ==========")
    
    return {
        "segments": segments,
        "language": language,
        "duration": duration,
        "word_count": word_count,
        "raw_text": full_text
    }


async def _submit_asr_task(
    audio_url: str,
    audio_format: str,
    request_id: str,
    enable_diarization: bool = False,
    enable_ddc: bool = True,  # ★ 语义顺滑开关
    hotwords: list[str] = None
) -> dict:
    """
    提交 ASR 任务到豆包 API
    """
    headers = {
        "Content-Type": "application/json",
        "X-Api-App-Key": DOUBAO_APP_ID,
        "X-Api-Access-Key": DOUBAO_ACCESS_TOKEN,
        "X-Api-Resource-Id": DOUBAO_RESOURCE_ID,
        "X-Api-Request-Id": request_id,
        "X-Api-Sequence": "-1"
    }
    
    # 构建请求体
    body = {
        "user": {
            "uid": "hoppingrabbit-user"
        },
        "audio": {
            "format": audio_format,
            "url": audio_url
        },
        "request": {
            "model_name": "bigmodel",
            "enable_itn": True,           # 文本规范化（数字、日期等）
            "enable_punc": True,          # 启用标点
            "show_utterances": True,      # 输出分句信息（带时间戳）
            "enable_ddc": enable_ddc,     # ★ 语义顺滑（去除语气词）- 可配置
        }
    }
    
    # 启用说话人分离
    if enable_diarization:
        body["request"]["enable_speaker_info"] = True
    
    # 添加热词
    if hotwords:
        import json
        body["request"]["corpus"] = {
            "context": json.dumps({"hotwords": [{"word": w} for w in hotwords]}, ensure_ascii=False)
        }
    
    logger.info(f"提交任务: {DOUBAO_SUBMIT_URL}")
    logger.info(f"Headers: X-Api-App-Key={DOUBAO_APP_ID}, X-Api-Resource-Id={DOUBAO_RESOURCE_ID}")
    
    async with httpx.AsyncClient(timeout=60.0) as client:
        response = await client.post(
            DOUBAO_SUBMIT_URL,
            headers=headers,
            json=body
        )
        
        status_code = response.headers.get("X-Api-Status-Code", "")
        message = response.headers.get("X-Api-Message", "")
        
        logger.info(f"提交响应: status_code={status_code}, message={message}")
        
        if status_code == "20000000":
            return {"success": True}
        else:
            return {"success": False, "error": f"{status_code}: {message}"}


async def _poll_asr_result(
    request_id: str,
    max_retries: int = 900,  # 最多等待 15 分钟（大文件/长视频需要更多时间）
    interval: float = 1.0,
    on_progress: Optional[Callable[[int, str], None]] = None,
    task_id: str = None,  # 用于检查任务是否被取消
) -> dict:
    """
    轮询查询 ASR 结果
    """
    headers = {
        "Content-Type": "application/json",
        "X-Api-App-Key": DOUBAO_APP_ID,
        "X-Api-Access-Key": DOUBAO_ACCESS_TOKEN,
        "X-Api-Resource-Id": DOUBAO_RESOURCE_ID,
        "X-Api-Request-Id": request_id,
    }
    
    logger.info(f"[ASR] 开始轮询 request_id={request_id}, max_retries={max_retries}, task_id={task_id}")
    
    # 用于检查任务是否被取消的辅助函数
    async def is_task_cancelled() -> bool:
        if not task_id:
            return False
        try:
            from ..services.supabase_client import supabase
            result = supabase.table("tasks").select("status").eq("id", task_id).single().execute()
            if result.data:
                status = result.data.get("status", "")
                # 如果任务已被标记为 cancelled、completed 或 failed，则停止轮询
                if status in ["cancelled", "completed", "failed"]:
                    logger.info(f"[ASR] 🛑 任务已被取消或完成 (status={status})，停止轮询")
                    return True
        except Exception as e:
            logger.warning(f"[ASR] 检查任务状态失败: {e}")
        return False
    
    for i in range(max_retries):
        # 每 30 秒检查一次任务是否被取消
        if i > 0 and i % 30 == 0:
            if await is_task_cancelled():
                raise Exception("任务已被取消")
        
        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await client.post(
                    DOUBAO_QUERY_URL,
                    headers=headers,
                    json={}
                )
                
                status_code = response.headers.get("X-Api-Status-Code", "")
                message = response.headers.get("X-Api-Message", "")
                
                if status_code == "20000000":
                    # 任务完成
                    logger.info(f"[ASR] ✅ 任务完成，耗时 {i} 秒")
                    return response.json()
                
                elif status_code in ["20000001", "20000002"]:
                    # 20000001: 正在处理中, 20000002: 队列中
                    if i % 30 == 0:  # 每 30 秒打印一次日志
                        logger.info(f"[ASR] ⏳ 等待中... ({i}s) status={status_code}")
                    
                    if on_progress:
                        progress = 20 + int((i / max_retries) * 70)  # 20% ~ 90%
                        on_progress(min(progress, 90), f"转写处理中... ({i}s)")
                    
                    await asyncio.sleep(interval)
                    continue
                
                elif status_code == "20000003":
                    # 20000003: 音频中没有检测到有效语音（静音、纯音乐等）
                    logger.warning(f"[ASR] ⚠️ 音频无有效语音: {message}")
                    # 返回空结果而不是抛异常
                    return {"result": {"text": "", "utterances": []}, "audio_info": {"duration": 0}}
                
                else:
                    # 其他错误
                    logger.error(f"[ASR] ❌ 查询失败: {status_code} - {message}")
                    raise Exception(f"查询失败: {status_code} - {message}")
        except httpx.TimeoutException:
            logger.warning(f"[ASR] ⚠️ 轮询超时 ({i}s)，重试...")
            await asyncio.sleep(interval)
            continue
        except Exception as e:
            if "查询失败" in str(e):
                raise
            logger.warning(f"[ASR] ⚠️ 轮询异常 ({i}s): {e}，重试...")
            await asyncio.sleep(interval)
            continue
    
    logger.error(f"[ASR] ❌ 转写超时，已等待 {max_retries} 秒")
    raise Exception(f"转写超时（已等待 {max_retries} 秒），请稍后重试")


def _parse_doubao_result(result: dict) -> list[dict]:
    """
    解析豆包 API 返回的结果为标准 segment 格式
    
    时间单位：毫秒 (ms)，与前端 Clip 保持一致
    
    处理流程:
    1. 解析语音片段 (speech segments)，保留 words 数组用于精确时间截取
    2. 分析片段间的静音 (silence analysis)
    3. 插入静音片段并分级标记
    """
    segments = []
    
    utterances = result.get("result", {}).get("utterances", [])
    
    for utt in utterances:
        text = utt.get("text", "").strip()
        if not text:
            continue
        
        # 豆包返回的时间本身就是毫秒，直接使用
        start_time = utt.get("start_time", 0)  # 毫秒
        end_time = utt.get("end_time", 0)      # 毫秒
        
        # 获取逐字时间戳（用于精确截取）
        words = utt.get("words", [])
        
        # 说话人信息
        speaker = None
        additions = utt.get("additions", {})
        if "speaker_id" in additions:
            speaker = f"speaker_{additions['speaker_id']}"
        
        segment = {
            "id": str(uuid4()),
            "text": text,
            "start": start_time,   # 毫秒，适配 Clip
            "end": end_time,       # 毫秒，适配 Clip
            "words": words,        # 逐字时间戳，用于精确截取
            "speaker": speaker,
            "is_deleted": False,
            "auto_zoom": False,
            "silence_info": None,  # 语音片段无静音信息
        }
        
        segments.append(segment)
    
    logger.info(f"解析出 {len(segments)} 个语音分句")
    
    # ==========================================
    # 静音分析：在语音片段之间插入静音片段
    # ==========================================
    segments_with_silence = _insert_silence_segments(segments)
    
    return segments_with_silence


def _insert_silence_segments(speech_segments: list[dict]) -> list[dict]:
    """
    在语音片段之间插入静音片段，并进行智能分级
    
    分级策略 (基于时长 + 语义完整性):
    - Level 1 (micro): < 200ms -> 忽略，不插入
    - Level 2 (hesitation): 句中长停顿 (无标点 + > 500ms) 或 极长停顿 (> 3000ms) -> 默认删除
    - Level 3 (breath): 句末自然停顿 (有标点 + < 2000ms) -> 保留
    
    Returns:
        合并了语音和静音片段的完整列表，按时间排序
    """
    if not speech_segments or len(speech_segments) < 2:
        return speech_segments
    
    # 按时间排序
    speech_segments.sort(key=lambda x: x.get("start", 0))
    
    result = []
    
    # 中英文句末标点
    SENTENCE_END_PUNCTUATION = set("。！？；…….?!;")
    
    # 阈值定义 (毫秒)
    MICRO_PAUSE_THRESHOLD = 200      # < 200ms: 忽略
    HESITATION_THRESHOLD = 500       # > 500ms 句中停顿: 卡顿
    BREATH_MAX_THRESHOLD = 3500      # < 3500ms 句末停顿: 气口（包含较长换气）
    DEAD_AIR_THRESHOLD = 4000        # > 4000ms: 无论如何都是死寂
    
    for i in range(len(speech_segments)):
        current_seg = speech_segments[i]
        result.append(current_seg)
        
        # 最后一个片段后面不需要插入静音
        if i >= len(speech_segments) - 1:
            continue
        
        next_seg = speech_segments[i + 1]
        
        # 计算间隙
        gap_start = current_seg["end"]
        gap_end = next_seg["start"]
        gap_duration = gap_end - gap_start  # 毫秒
        
        # Level 1: 微停顿，忽略
        if gap_duration < MICRO_PAUSE_THRESHOLD:
            continue
        
        # 判断前一个片段是否以句末标点结尾
        prev_text = current_seg.get("text", "").strip()
        ends_with_punctuation = prev_text and prev_text[-1] in SENTENCE_END_PUNCTUATION
        
        # 分级判定
        # ★ 调整策略：较长的停顿（1.5-3.5秒）更可能是换气而不是卡顿
        LONG_BREATH_THRESHOLD = 1500  # 超过 1.5 秒的停顿，倾向于是换气
        
        if gap_duration >= DEAD_AIR_THRESHOLD:
            # Level 2: 死寂 (> 4s)
            classification = "dead_air"
            is_deleted = True
            reason = "超长静音 (>4秒)"
        elif gap_duration >= LONG_BREATH_THRESHOLD and gap_duration <= BREATH_MAX_THRESHOLD:
            # ★ 中长停顿 (1.5s ~ 3.5s): 优先识别为换气
            # 无论是否有标点，这个时长的停顿更可能是自然换气
            classification = "breath"
            is_deleted = False
            reason = "换气停顿"
        elif not ends_with_punctuation and gap_duration >= HESITATION_THRESHOLD:
            # Level 2: 句中卡顿 (无标点 + 500ms~1.5s)
            classification = "hesitation"
            is_deleted = True
            reason = "句中卡顿"
        elif ends_with_punctuation and gap_duration <= BREATH_MAX_THRESHOLD:
            # Level 3: 气口 (有标点 + < 3.5s)
            classification = "breath"
            is_deleted = False
            reason = "句末换气"
        elif ends_with_punctuation and gap_duration > BREATH_MAX_THRESHOLD:
            # 句末但是太长了
            classification = "long_pause"
            is_deleted = True
            reason = "句末长停顿 (>3.5秒)"
        else:
            # 其他情况：保守处理，保留让用户决定
            classification = "uncertain"
            is_deleted = False
            reason = "待确认"
        
        # 创建静音片段
        silence_segment = {
            "id": str(uuid4()),
            "text": "",
            "start": gap_start,
            "end": gap_end,
            "speaker": current_seg.get("speaker"),  # 继承前一个片段的说话人
            "is_deleted": is_deleted,
            "auto_zoom": False,
            "silence_info": {
                "classification": classification,  # breath | hesitation | dead_air | long_pause | uncertain
                "duration_ms": gap_duration,
                "reason": reason,
                "prev_ends_with_punct": ends_with_punctuation,
            }
        }
        
        result.append(silence_segment)
    
    # 统计日志
    silence_count = len([s for s in result if s.get("silence_info")])
    auto_deleted = len([s for s in result if s.get("silence_info") and s.get("is_deleted")])
    logger.info(f"插入 {silence_count} 个静音片段，其中 {auto_deleted} 个自动标记删除")
    
    return result


def _get_audio_format(url: str) -> str:
    """
    根据 URL 推断音频格式
    """
    url_lower = url.lower()
    
    if ".mp3" in url_lower:
        return "mp3"
    elif ".wav" in url_lower:
        return "wav"
    elif ".m4a" in url_lower:
        return "m4a"
    elif ".mp4" in url_lower:
        return "mp4"
    elif ".flac" in url_lower:
        return "flac"
    elif ".ogg" in url_lower:
        return "ogg"
    elif ".webm" in url_lower:
        return "webm"
    elif ".aac" in url_lower:
        return "aac"
    else:
        return "mp3"  # 默认


# ============================================
# Celery 任务（可选，用于异步处理）
# ============================================

try:
    from ..celery_config import celery_app, update_task_progress, update_task_status
    
    @celery_app.task(bind=True, queue="cpu")
    def transcribe_task(
        self,
        task_id: str,
        audio_url: str,
        language: str = "zh",
        model_name: str = DEFAULT_MODEL,
        enable_word_timestamps: bool = True,
        enable_diarization: bool = False,
        hotwords: list[str] = None
    ):
        """Celery ASR 任务 (豆包 API)"""
        
        # 节流：只在进度变化时才更新数据库
        last_progress_reported = {"value": -1}
        
        def on_progress(progress: int, step: str):
            if progress != last_progress_reported["value"]:
                last_progress_reported["value"] = progress
                update_task_progress(task_id, progress, step)
        
        try:
            update_task_status(task_id, "processing")
            
            # 运行异步转写（传递 task_id 用于取消检查）
            result = asyncio.run(transcribe_audio(
                audio_url=audio_url,
                language=language,
                enable_diarization=enable_diarization,
                hotwords=hotwords,
                on_progress=on_progress,
                task_id=task_id,  # 用于轮询时检查任务是否被取消
            ))
            
            update_task_status(task_id, "completed", result=result)
            return result
            
        except Exception as e:
            error_msg = str(e)
            if "任务已被取消" in error_msg:
                logger.info(f"[ASR] 任务被取消: {task_id}")
                update_task_status(task_id, "cancelled", error=error_msg)
            else:
                logger.error(f"转写任务失败: {e}")
                update_task_status(task_id, "failed", error=error_msg)
            raise

except ImportError:
    logger.info("Celery 未配置，使用同步模式")


# ============================================
# 同步版本（用于非异步环境）
# ============================================

def transcribe_audio_sync(
    audio_url: str,
    language: str = "zh",
    hotwords: list[str] = None,
    on_progress = None
) -> dict:
    """
    同步版本的转写函数
    """
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    
    try:
        return loop.run_until_complete(
            transcribe_audio(
                audio_url=audio_url,
                language=language,
                hotwords=hotwords,
                on_progress=on_progress
            )
        )
    finally:
        loop.close()


# ============================================
# 工具函数
# ============================================

def get_supported_languages() -> list[str]:
    """
    获取支持的语言列表
    豆包支持：中英文、上海话、闽南语、四川话、陕西话、粤语
    """
    return [
        "zh", "en", "ja-JP", "ko-KR", "es-MX", "pt-BR", 
        "de-DE", "fr-FR", "id-ID", "th-TH", "auto"
    ]


def estimate_transcription_time(duration_seconds: float, model_name: str = DEFAULT_MODEL) -> float:
    """
    估计转写时间（秒）- 豆包 API 通常很快
    """
    # 豆包 API 大约 5-10 秒处理 1 分钟音频
    return duration_seconds * 0.15


# ============================================
# 兼容旧版接口
# ============================================

async def transcribe_video(video_url: str) -> list:
    """
    兼容旧版接口
    """
    result = await transcribe_audio(
        audio_url=video_url,
        language="zh"
    )
    return result["segments"]
