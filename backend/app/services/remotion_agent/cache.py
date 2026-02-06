"""
Remotion Agent 缓存模块

提供 LLM 响应缓存和结果缓存，减少重复计算
"""

import hashlib
import json
import time
import logging
from typing import Dict, Any, Optional, Callable, TypeVar
from functools import wraps
from dataclasses import dataclass, field

logger = logging.getLogger(__name__)

T = TypeVar('T')


@dataclass
class CacheEntry:
    """缓存条目"""
    value: Any
    created_at: float
    ttl_seconds: int
    hit_count: int = 0
    
    @property
    def is_expired(self) -> bool:
        return time.time() - self.created_at > self.ttl_seconds


class MemoryCache:
    """
    内存缓存
    
    用于缓存 LLM 响应和中间计算结果
    """
    
    def __init__(self, max_size: int = 100, default_ttl: int = 3600):
        """
        Args:
            max_size: 最大缓存条目数
            default_ttl: 默认过期时间（秒）
        """
        self._cache: Dict[str, CacheEntry] = {}
        self._max_size = max_size
        self._default_ttl = default_ttl
        self._hits = 0
        self._misses = 0
    
    def _generate_key(self, *args, **kwargs) -> str:
        """生成缓存键"""
        key_data = json.dumps({
            'args': [str(a) for a in args],
            'kwargs': {k: str(v) for k, v in sorted(kwargs.items())}
        }, sort_keys=True)
        return hashlib.md5(key_data.encode()).hexdigest()
    
    def get(self, key: str) -> Optional[Any]:
        """获取缓存"""
        entry = self._cache.get(key)
        if entry is None:
            self._misses += 1
            return None
        
        if entry.is_expired:
            del self._cache[key]
            self._misses += 1
            return None
        
        entry.hit_count += 1
        self._hits += 1
        return entry.value
    
    def set(self, key: str, value: Any, ttl: Optional[int] = None):
        """设置缓存"""
        # 如果超出大小限制，清理最旧的条目
        if len(self._cache) >= self._max_size:
            self._evict_oldest()
        
        self._cache[key] = CacheEntry(
            value=value,
            created_at=time.time(),
            ttl_seconds=ttl or self._default_ttl,
        )
    
    def _evict_oldest(self):
        """清理最旧的缓存条目"""
        if not self._cache:
            return
        
        # 按创建时间排序，删除最旧的 10%
        sorted_keys = sorted(
            self._cache.keys(),
            key=lambda k: self._cache[k].created_at
        )
        num_to_evict = max(1, len(sorted_keys) // 10)
        
        for key in sorted_keys[:num_to_evict]:
            del self._cache[key]
    
    def clear(self):
        """清空缓存"""
        self._cache.clear()
        self._hits = 0
        self._misses = 0
    
    @property
    def stats(self) -> Dict[str, Any]:
        """缓存统计"""
        total = self._hits + self._misses
        hit_rate = self._hits / total if total > 0 else 0
        return {
            'size': len(self._cache),
            'max_size': self._max_size,
            'hits': self._hits,
            'misses': self._misses,
            'hit_rate': f"{hit_rate:.2%}",
        }


# 全局缓存实例
_structure_cache = MemoryCache(max_size=50, default_ttl=1800)  # 30 分钟
_broll_trigger_cache = MemoryCache(max_size=200, default_ttl=3600)  # 1 小时


def get_structure_cache() -> MemoryCache:
    """获取结构分析缓存"""
    return _structure_cache


def get_broll_trigger_cache() -> MemoryCache:
    """获取 B-Roll 触发检测缓存"""
    return _broll_trigger_cache


def cached_broll_detection(func: Callable) -> Callable:
    """
    B-Roll 触发检测缓存装饰器
    
    使用方法:
        @cached_broll_detection
        def detect_broll_triggers(text: str) -> List[BrollTrigger]:
            ...
    """
    cache = get_broll_trigger_cache()
    
    @wraps(func)
    def wrapper(text: str, *args, **kwargs):
        cache_key = cache._generate_key(text)
        
        # 尝试从缓存获取
        cached = cache.get(cache_key)
        if cached is not None:
            return cached
        
        # 执行函数
        result = func(text, *args, **kwargs)
        
        # 存入缓存
        cache.set(cache_key, result)
        
        return result
    
    return wrapper


def cache_key_for_segments(segments: list) -> str:
    """为片段列表生成缓存键"""
    texts = [s.get('text', '') for s in segments]
    combined = '|'.join(texts)
    return hashlib.md5(combined.encode()).hexdigest()


# ============================================
# 性能监控
# ============================================

@dataclass
class PerformanceMetrics:
    """性能指标"""
    operation: str
    start_time: float = field(default_factory=time.time)
    end_time: Optional[float] = None
    success: bool = True
    error: Optional[str] = None
    
    def complete(self, success: bool = True, error: Optional[str] = None):
        self.end_time = time.time()
        self.success = success
        self.error = error
    
    @property
    def duration_ms(self) -> float:
        if self.end_time is None:
            return (time.time() - self.start_time) * 1000
        return (self.end_time - self.start_time) * 1000


class PerformanceTracker:
    """性能追踪器"""
    
    def __init__(self):
        self._metrics: Dict[str, list] = {}
    
    def track(self, operation: str) -> PerformanceMetrics:
        """开始追踪操作"""
        metrics = PerformanceMetrics(operation=operation)
        if operation not in self._metrics:
            self._metrics[operation] = []
        return metrics
    
    def record(self, metrics: PerformanceMetrics):
        """记录完成的指标"""
        if metrics.operation not in self._metrics:
            self._metrics[metrics.operation] = []
        self._metrics[metrics.operation].append(metrics)
    
    def get_stats(self, operation: str) -> Dict[str, Any]:
        """获取操作统计"""
        metrics_list = self._metrics.get(operation, [])
        if not metrics_list:
            return {'count': 0}
        
        durations = [m.duration_ms for m in metrics_list]
        success_count = sum(1 for m in metrics_list if m.success)
        
        return {
            'count': len(metrics_list),
            'success_rate': f"{success_count / len(metrics_list):.2%}",
            'avg_ms': sum(durations) / len(durations),
            'min_ms': min(durations),
            'max_ms': max(durations),
        }
    
    def get_all_stats(self) -> Dict[str, Dict[str, Any]]:
        """获取所有操作统计"""
        return {op: self.get_stats(op) for op in self._metrics}


# 全局性能追踪器
_performance_tracker = PerformanceTracker()


def get_performance_tracker() -> PerformanceTracker:
    """获取性能追踪器"""
    return _performance_tracker
