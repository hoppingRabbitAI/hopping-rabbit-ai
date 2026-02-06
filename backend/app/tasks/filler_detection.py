"""
HoppingRabbit AI - 填充词检测
识别口头禅、语气词并支持批量删除
"""
import re
import logging
from typing import List, Dict, Optional, Set
from dataclasses import dataclass

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


# ============================================
# 填充词库
# ============================================

FILLER_WORDS_ZH = {
    # 语气词
    "嗯", "啊", "呃", "额", "哦", "噢", "唉", "哎", "嘿", "喂",
    "呢", "吧", "啦", "呀", "哇", "诶", "欸",
    
    # 口头禅
    "那个", "这个", "就是", "然后", "所以", "因为", "但是",
    "就是说", "所以说", "然后呢", "怎么说", "怎么讲",
    "对吧", "对不对", "是吧", "是不是", "知道吧", "懂吧",
    "你知道", "你懂的", "我觉得", "我感觉", "我认为",
    "基本上", "大概", "可能", "应该", "好像", "似乎",
    "其实", "实际上", "事实上", "说实话", "老实说",
    "总之", "反正", "anyway",
    
    # 重复词
    "就就", "然然后", "那那个", "这这个",
    
    # 停顿
    "....", "。。。",
}

FILLER_WORDS_EN = {
    # Hesitation sounds
    "um", "uh", "er", "ah", "oh", "hmm", "hm", "mm",
    "umm", "uhh", "err", "ahh", "ohh", "hmmm",
    
    # Filler phrases
    "like", "you know", "i mean", "basically", "actually",
    "literally", "honestly", "seriously", "obviously",
    "right", "okay", "so", "well", "anyway", "anyways",
    "kind of", "sort of", "kinda", "sorta",
    "you see", "you understand", "know what i mean",
    "at the end of the day", "to be honest", "tbh",
    "i think", "i guess", "i suppose", "i believe",
    "it's like", "that's like",
    
    # Repeated words (patterns)
    "the the", "a a", "i i", "we we", "it it",
}

# 合并词库
ALL_FILLER_WORDS = FILLER_WORDS_ZH | FILLER_WORDS_EN


@dataclass
class FillerWord:
    """填充词检测结果"""
    text: str           # 填充词文本
    start: float        # 开始时间
    end: float          # 结束时间
    confidence: float   # 置信度
    category: str       # 类别: hesitation, filler, repetition
    language: str       # 语言: zh, en
    
    def to_dict(self) -> dict:
        return {
            "text": self.text,
            "start": round(self.start, 3),
            "end": round(self.end, 3),
            "duration": round(self.end - self.start, 3),
            "confidence": round(self.confidence, 2),
            "category": self.category,
            "language": self.language
        }


# ============================================
# 填充词检测器
# ============================================

class FillerWordDetector:
    """
    填充词检测器
    
    基于 ASR 转录结果检测填充词
    """
    
    def __init__(
        self,
        custom_words: Optional[Set[str]] = None,
        min_confidence: float = 0.7,
        languages: Optional[List[str]] = None
    ):
        """
        Args:
            custom_words: 自定义填充词列表
            min_confidence: 最小置信度阈值
            languages: 检测语言 ["zh", "en"]
        """
        self.min_confidence = min_confidence
        self.languages = languages or ["zh", "en"]
        
        # 构建词库
        self.filler_words = set()
        if "zh" in self.languages:
            self.filler_words |= FILLER_WORDS_ZH
        if "en" in self.languages:
            self.filler_words |= FILLER_WORDS_EN
        
        if custom_words:
            self.filler_words |= custom_words
        
        # 构建正则模式
        self._build_patterns()
    
    def _build_patterns(self):
        """构建正则匹配模式"""
        # 中文语气词模式
        self.zh_hesitation_pattern = re.compile(
            r'[嗯啊呃额哦噢唉哎嘿喂呢吧啦呀哇诶欸]{1,3}'
        )
        
        # 英文语气词模式
        self.en_hesitation_pattern = re.compile(
            r'\b(u+m+|u+h+|e+r+|a+h+|o+h+|h+m+)\b',
            re.IGNORECASE
        )
        
        # 重复词模式
        self.repetition_pattern = re.compile(
            r'\b(\w+)\s+\1\b',
            re.IGNORECASE
        )
    
    def _categorize_word(self, word: str) -> tuple:
        """分类填充词"""
        word_lower = word.lower().strip()
        
        # 判断语言
        if any('\u4e00' <= c <= '\u9fff' for c in word):
            language = "zh"
        else:
            language = "en"
        
        # 判断类别
        if language == "zh":
            if self.zh_hesitation_pattern.fullmatch(word):
                return "hesitation", language
        else:
            if self.en_hesitation_pattern.fullmatch(word_lower):
                return "hesitation", language
        
        if self.repetition_pattern.search(word_lower):
            return "repetition", language
        
        return "filler", language
    
    def detect(self, transcript: Dict) -> Dict:
        """
        检测转录结果中的填充词
        
        Args:
            transcript: ASR 转录结果，包含 words 数组
                {
                    "text": "...",
                    "words": [
                        {"word": "嗯", "start": 0.5, "end": 0.8, "confidence": 0.9},
                        ...
                    ]
                }
        
        Returns:
            {
                "fillers": [...],
                "stats": {...},
                "suggestions": [...]
            }
        """
        words = transcript.get("words", [])
        if not words:
            # 如果没有词级时间戳，尝试解析文本
            return self._detect_from_text(transcript.get("text", ""))
        
        fillers = []
        
        for i, word_info in enumerate(words):
            word = word_info.get("word", "").strip()
            word_lower = word.lower()
            
            # 检查是否为填充词
            is_filler = False
            
            # 精确匹配
            if word_lower in self.filler_words or word in self.filler_words:
                is_filler = True
            
            # 正则匹配
            if not is_filler:
                if self.zh_hesitation_pattern.fullmatch(word):
                    is_filler = True
                elif self.en_hesitation_pattern.fullmatch(word_lower):
                    is_filler = True
            
            # 检测重复词
            if not is_filler and i > 0:
                prev_word = words[i-1].get("word", "").strip().lower()
                if prev_word == word_lower and len(word) > 1:
                    is_filler = True
            
            if is_filler:
                confidence = word_info.get("confidence", 0.8)
                if confidence >= self.min_confidence:
                    category, language = self._categorize_word(word)
                    fillers.append(FillerWord(
                        text=word,
                        start=word_info.get("start", 0),
                        end=word_info.get("end", 0),
                        confidence=confidence,
                        category=category,
                        language=language
                    ))
        
        return self._build_result(fillers, transcript)
    
    def _detect_from_text(self, text: str) -> Dict:
        """从纯文本检测填充词（无时间戳）"""
        fillers = []
        
        for word in self.filler_words:
            if word in text.lower():
                # 找到所有出现位置
                pattern = re.compile(re.escape(word), re.IGNORECASE)
                for match in pattern.finditer(text):
                    category, language = self._categorize_word(word)
                    fillers.append(FillerWord(
                        text=match.group(),
                        start=0,  # 无时间戳
                        end=0,
                        confidence=0.8,
                        category=category,
                        language=language
                    ))
        
        return {
            "fillers": [f.to_dict() for f in fillers],
            "stats": {
                "total_count": len(fillers),
                "has_timestamps": False
            },
            "suggestions": []
        }
    
    def _build_result(self, fillers: List[FillerWord], transcript: Dict) -> Dict:
        """构建检测结果"""
        # 按类别统计
        category_counts = {}
        language_counts = {}
        word_counts = {}
        
        total_duration = 0
        
        for f in fillers:
            category_counts[f.category] = category_counts.get(f.category, 0) + 1
            language_counts[f.language] = language_counts.get(f.language, 0) + 1
            word_counts[f.text.lower()] = word_counts.get(f.text.lower(), 0) + 1
            total_duration += f.end - f.start
        
        # 获取最常见的填充词
        top_fillers = sorted(
            word_counts.items(),
            key=lambda x: x[1],
            reverse=True
        )[:10]
        
        # 生成建议
        suggestions = []
        if len(fillers) > 10:
            suggestions.append({
                "type": "high_filler_count",
                "message": f"检测到 {len(fillers)} 个填充词，建议审核删除",
                "severity": "warning"
            })
        
        if total_duration > 10:
            suggestions.append({
                "type": "long_filler_duration",
                "message": f"填充词总时长 {total_duration:.1f}秒，可节省视频时长",
                "severity": "info"
            })
        
        # 高频词建议
        for word, count in top_fillers[:3]:
            if count >= 5:
                suggestions.append({
                    "type": "frequent_filler",
                    "message": f'"{word}" 出现 {count} 次，建议批量删除',
                    "word": word,
                    "count": count,
                    "severity": "info"
                })
        
        return {
            "fillers": [f.to_dict() for f in fillers],
            "stats": {
                "total_count": len(fillers),
                "total_duration": round(total_duration, 3),
                "by_category": category_counts,
                "by_language": language_counts,
                "top_fillers": top_fillers,
                "has_timestamps": True
            },
            "suggestions": suggestions
        }
    
    def get_removal_edits(
        self,
        fillers: List[Dict],
        mode: str = "cut"
    ) -> List[Dict]:
        """
        生成删除编辑操作
        
        Args:
            fillers: 填充词列表
            mode: 删除模式
                - "cut": 直接剪切
                - "mute": 静音替换
                - "speed": 加速跳过
        
        Returns:
            编辑操作列表
        """
        edits = []
        
        # 合并相邻的填充词
        merged = []
        for f in sorted(fillers, key=lambda x: x["start"]):
            if merged and f["start"] - merged[-1]["end"] < 0.1:
                # 合并
                merged[-1]["end"] = f["end"]
                merged[-1]["texts"].append(f["text"])
            else:
                merged.append({
                    "start": f["start"],
                    "end": f["end"],
                    "texts": [f["text"]]
                })
        
        for m in merged:
            if mode == "cut":
                edits.append({
                    "type": "cut",
                    "start": m["start"],
                    "end": m["end"],
                    "reason": f"删除填充词: {', '.join(m['texts'])}"
                })
            elif mode == "mute":
                edits.append({
                    "type": "mute",
                    "start": m["start"],
                    "end": m["end"],
                    "reason": f"静音填充词: {', '.join(m['texts'])}"
                })
            elif mode == "speed":
                edits.append({
                    "type": "speed",
                    "start": m["start"],
                    "end": m["end"],
                    "speed": 8.0,  # 8倍速快进
                    "reason": f"加速跳过: {', '.join(m['texts'])}"
                })
        
        return edits


# ============================================
# Celery 任务
# ============================================

try:
    from ..celery_config import celery_app, update_task_progress, update_task_status
    from ..services.supabase_client import supabase
    
    @celery_app.task(bind=True, queue="cpu_low")
    def detect_filler_words_task(
        self,
        task_id: str,
        project_id: str,
        transcript: Dict,
        custom_words: Optional[List[str]] = None,
        min_confidence: float = 0.7,
        languages: Optional[List[str]] = None
    ):
        """Celery 填充词检测任务"""
        try:
            update_task_status(task_id, "processing")
            update_task_progress(task_id, 20, "分析转录文本")
            
            detector = FillerWordDetector(
                custom_words=set(custom_words) if custom_words else None,
                min_confidence=min_confidence,
                languages=languages
            )
            
            update_task_progress(task_id, 50, "检测填充词")
            result = detector.detect(transcript)
            
            update_task_progress(task_id, 90, "保存结果")
            
            supabase.table("tasks").update({
                "status": "completed",
                "result": result,
                "progress": 100,
                "progress_step": "完成"
            }).eq("id", task_id).execute()
            
            return result
            
        except Exception as e:
            logger.error(f"填充词检测失败: {e}")
            update_task_status(task_id, "failed", error=str(e))
            raise

except ImportError:
    logger.info("Celery 未配置，使用同步模式")


# ============================================
# API 辅助函数
# ============================================

def detect_fillers(
    transcript: Dict,
    custom_words: Optional[List[str]] = None,
    min_confidence: float = 0.7,
    languages: Optional[List[str]] = None
) -> Dict:
    """
    检测填充词
    
    Args:
        transcript: ASR 转录结果
        custom_words: 自定义填充词
        min_confidence: 最小置信度
        languages: 检测语言
    
    Returns:
        检测结果
    """
    detector = FillerWordDetector(
        custom_words=set(custom_words) if custom_words else None,
        min_confidence=min_confidence,
        languages=languages
    )
    return detector.detect(transcript)
