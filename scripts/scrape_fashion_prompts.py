#!/usr/bin/env python3
"""
Fashion Prompt 采集 & 清洗脚本

数据源：
  1. Lexica.art API — 500万+ SD prompt，按关键词搜索
  2. HuggingFace Datasets — Falah 系列 fashion prompt 数据集

输出：
  scripts/output/fashion_prompts.json — 去重+分类后的 prompt 库

用法：
  pip install requests datasets
  python scripts/scrape_fashion_prompts.py

"""

import json
import os
import re
import time
import hashlib
from pathlib import Path
from typing import Optional

# ============================================
# 配置
# ============================================

OUTPUT_DIR = Path(__file__).parent / "output"
OUTPUT_FILE = OUTPUT_DIR / "fashion_prompts.json"

# Lexica 搜索关键词（时尚垂类）
LEXICA_QUERIES = [
    "fashion photography portrait",
    "fashion editorial model",
    "outfit lookbook photography",
    "street style fashion",
    "fashion magazine cover",
    "clothing product photography white background",
    "fashion model runway",
    "fashion portrait golden hour",
    "neon fashion portrait cyberpunk",
    "vintage fashion film photography",
    "korean fashion minimalist",
    "french elegant fashion",
    "fashion flat lay outfit",
    "fashion studio lighting portrait",
    "luxury fashion editorial",
    "casual streetwear outfit",
    "fashion model walking",
    "haute couture evening gown",
    "fashion relight dramatic",
    "beauty skin retouching portrait",
    "virtual try-on outfit swap",
    "fashion video slow motion",
    "outfit transition smooth",
]

# 每个 query 最多取多少条（Lexica 每次返回 50 条）
LEXICA_MAX_PER_QUERY = 150  # 3 页

# HuggingFace 数据集
HF_DATASETS = [
    {
        "name": "Falah/fashion_photography_prompts_SDXL",
        "split": "prompts",
        "text_col": "prompts",
        "max_rows": 5000,
    },
    {
        "name": "Falah/men_fashion_prompts_SDXL",
        "split": "prompts",
        "text_col": "prompts",
        "max_rows": 3000,
    },
    {
        "name": "Falah/fashion_moodboards_prompts",
        "split": "prompts",
        "text_col": "prompts",
        "max_rows": 1000,
    },
    {
        "name": "Geonmo/deepfashion-multimodal-descriptions",
        "split": "train",
        "text_col": "caption",
        "max_rows": 5000,
    },
]

# ============================================
# 能力分类规则
# ============================================

CAPABILITY_KEYWORDS = {
    "omni_image": {
        "keywords": [
            "fashion photo", "editorial", "portrait", "magazine", "cover",
            "product photo", "lookbook", "catalog", "studio shot", "flat lay",
            "white background", "clean background",
        ],
        "label": "图像生成",
    },
    "face_swap": {
        "keywords": [
            "face swap", "face replace", "face blend", "face transfer",
            "face merge", "identity preserv",
        ],
        "label": "AI 换脸",
    },
    "skin_enhance": {
        "keywords": [
            "skin", "retouch", "beauty", "complexion", "smooth skin",
            "porcelain", "glow", "dewy", "flawless", "blemish",
        ],
        "label": "皮肤美化",
    },
    "relight": {
        "keywords": [
            "lighting", "light", "golden hour", "sunset", "neon", "studio light",
            "dramatic light", "rim light", "backlight", "chiaroscuro",
            "soft light", "window light", "ring light",
        ],
        "label": "AI 打光",
    },
    "outfit_swap": {
        "keywords": [
            "outfit swap", "try-on", "virtual try", "clothing swap",
            "garment", "wearing", "dressed in", "outfit change",
        ],
        "label": "换装",
    },
    "ai_stylist": {
        "keywords": [
            "styling", "style", "coordinate", "outfit recommend",
            "fashion advice", "wardrobe", "look", "ensemble",
            "french chic", "korean", "minimalist", "streetwear",
        ],
        "label": "AI 穿搭师",
    },
    "outfit_shot": {
        "keywords": [
            "instagram", "xiaohongshu", "social media", "content",
            "flat lay", "ootd", "street snap", "lifestyle",
            "fashion post", "influencer",
        ],
        "label": "AI 穿搭内容",
    },
    "text_to_video": {
        "keywords": [
            "video", "runway", "walking", "catwalk", "slow motion",
            "cinematic", "transition", "animation",
        ],
        "label": "文生视频",
    },
    "image_to_video": {
        "keywords": [
            "animate", "motion", "breeze", "wind blow", "hair moving",
            "fabric flow", "gentle movement",
        ],
        "label": "图生视频",
    },
}


# ============================================
# Source 1: Lexica.art
# ============================================

def fetch_lexica(query: str, offset: int = 0) -> list[dict]:
    """从 Lexica API 获取一页结果"""
    import requests

    url = "https://lexica.art/api/v1/search"
    params = {"q": query, "offset": offset}
    try:
        resp = requests.get(url, params=params, timeout=15)
        resp.raise_for_status()
        data = resp.json()
        return data.get("images", [])
    except Exception as e:
        print(f"  ⚠ Lexica error for '{query}' offset={offset}: {e}")
        return []


def scrape_lexica() -> list[str]:
    """批量搜索 Lexica"""
    import requests  # noqa: F811 — 确保 import 可用

    prompts = []
    for q in LEXICA_QUERIES:
        print(f"🔍 Lexica: '{q}'")
        offset = 0
        count = 0
        while count < LEXICA_MAX_PER_QUERY:
            images = fetch_lexica(q, offset)
            if not images:
                break
            for img in images:
                p = img.get("prompt", "").strip()
                if p and len(p) > 20:
                    prompts.append(p)
                    count += 1
            offset += len(images)
            time.sleep(0.5)  # 礼貌延迟
        print(f"  → {count} prompts")
    print(f"\n📦 Lexica total: {len(prompts)} raw prompts")
    return prompts


# ============================================
# Source 2: HuggingFace Datasets
# ============================================

def scrape_huggingface() -> list[str]:
    """从 HuggingFace 加载 fashion prompt 数据集"""
    try:
        from datasets import load_dataset
    except ImportError:
        print("⚠ `datasets` not installed. Run: pip install datasets")
        print("  Skipping HuggingFace source.")
        return []

    prompts = []
    for ds_config in HF_DATASETS:
        name = ds_config["name"]
        print(f"📥 HuggingFace: {name}")
        try:
            ds = load_dataset(name, split=ds_config["split"], streaming=True)
            count = 0
            for row in ds:
                text = row.get(ds_config["text_col"], "")
                if isinstance(text, str) and len(text.strip()) > 20:
                    prompts.append(text.strip())
                    count += 1
                if count >= ds_config["max_rows"]:
                    break
            print(f"  → {count} prompts")
        except Exception as e:
            print(f"  ⚠ Failed to load {name}: {e}")

    print(f"\n📦 HuggingFace total: {len(prompts)} raw prompts")
    return prompts


# ============================================
# 清洗 & 去重
# ============================================

def clean_prompt(text: str) -> Optional[str]:
    """清洗单条 prompt"""
    text = text.strip()

    # 过滤太短或太长
    if len(text) < 30 or len(text) > 1500:
        return None

    # 过滤非英文（我们需要英文 prompt）
    ascii_ratio = sum(1 for c in text if ord(c) < 128) / max(len(text), 1)
    if ascii_ratio < 0.7:
        return None

    # 过滤 NSFW 关键词
    nsfw_words = ["nsfw", "nude", "naked", "sexy", "erotic", "seductive", "lingerie"]
    lower = text.lower()
    if any(w in lower for w in nsfw_words):
        return None

    # 去除常见的 SD 技术标签噪音（保留有意义的部分）
    # 例如 "Steps: 20, Sampler: DPM++ 2M Karras, CFG scale: 7"
    text = re.sub(r"Steps:\s*\d+.*$", "", text, flags=re.IGNORECASE).strip()
    text = re.sub(r"Negative prompt:.*$", "", text, flags=re.IGNORECASE | re.DOTALL).strip()

    # 去尾部逗号
    text = text.rstrip(",").strip()

    if len(text) < 30:
        return None

    return text


def deduplicate(prompts: list[str]) -> list[str]:
    """基于内容哈希去重 + 近似去重（前 80 字符相同视为重复）"""
    seen_hashes = set()
    seen_prefixes = set()
    result = []

    for p in prompts:
        h = hashlib.md5(p.encode()).hexdigest()
        if h in seen_hashes:
            continue
        seen_hashes.add(h)

        # 近似去重：前 80 字符相同就跳过
        prefix = p[:80].lower().strip()
        if prefix in seen_prefixes:
            continue
        seen_prefixes.add(prefix)

        result.append(p)

    return result


# ============================================
# 分类
# ============================================

def classify_prompt(text: str) -> list[str]:
    """将 prompt 分类到一个或多个能力"""
    lower = text.lower()
    matched = []

    for cap_id, config in CAPABILITY_KEYWORDS.items():
        score = sum(1 for kw in config["keywords"] if kw in lower)
        if score >= 1:
            matched.append((cap_id, score))

    # 按匹配度排序，取 top 3
    matched.sort(key=lambda x: -x[1])
    caps = [m[0] for m in matched[:3]]

    # 没匹配到任何能力 → 默认 omni_image
    if not caps:
        caps = ["omni_image"]

    return caps


# ============================================
# 主流程
# ============================================

def main():
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    print("=" * 60)
    print("🚀 Fashion Prompt 采集开始")
    print("=" * 60)

    # 1. 采集
    all_prompts = []

    print("\n── Source 1: Lexica.art ──")
    lexica_prompts = scrape_lexica()
    all_prompts.extend(lexica_prompts)

    print("\n── Source 2: HuggingFace ──")
    hf_prompts = scrape_huggingface()
    all_prompts.extend(hf_prompts)

    print(f"\n📊 Raw total: {len(all_prompts)}")

    # 2. 清洗
    print("\n🧹 Cleaning...")
    cleaned = [p for p in (clean_prompt(t) for t in all_prompts) if p]
    print(f"  After clean: {len(cleaned)}")

    # 3. 去重
    print("🔄 Deduplicating...")
    unique = deduplicate(cleaned)
    print(f"  After dedup: {len(unique)}")

    # 4. 分类
    print("🏷️ Classifying by capability...")
    categorized: dict[str, list[str]] = {cap: [] for cap in CAPABILITY_KEYWORDS}

    for p in unique:
        caps = classify_prompt(p)
        for cap in caps:
            categorized[cap].append(p)

    # 5. 输出统计
    print("\n📋 Results by capability:")
    total_entries = 0
    for cap_id, config in CAPABILITY_KEYWORDS.items():
        count = len(categorized[cap_id])
        total_entries += count
        print(f"  {config['label']:12s} ({cap_id:20s}): {count:5d} prompts")

    # 6. 构建输出 JSON
    output = {
        "meta": {
            "total_unique_prompts": len(unique),
            "total_categorized_entries": total_entries,
            "sources": ["lexica.art", "huggingface"],
            "generated_at": time.strftime("%Y-%m-%d %H:%M:%S"),
        },
        "capabilities": {},
    }

    for cap_id, config in CAPABILITY_KEYWORDS.items():
        prompts_list = categorized[cap_id]
        output["capabilities"][cap_id] = {
            "label": config["label"],
            "count": len(prompts_list),
            "prompts": prompts_list[:500],  # 每个能力最多保留 500 条
        }

    # 7. 写文件
    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)
    print(f"\n✅ Saved to {OUTPUT_FILE}")
    print(f"   File size: {OUTPUT_FILE.stat().st_size / 1024:.1f} KB")

    # 8. 额外输出：前端可直接使用的精简版（每个能力 top 20）
    slim_file = OUTPUT_DIR / "fashion_prompts_slim.json"
    slim = {}
    for cap_id in CAPABILITY_KEYWORDS:
        # 按长度排序，优先保留信息量大的
        sorted_prompts = sorted(categorized[cap_id], key=len, reverse=True)
        slim[cap_id] = sorted_prompts[:20]
    with open(slim_file, "w", encoding="utf-8") as f:
        json.dump(slim, f, ensure_ascii=False, indent=2)
    print(f"   Slim version (top 20 per cap): {slim_file}")


if __name__ == "__main__":
    main()
