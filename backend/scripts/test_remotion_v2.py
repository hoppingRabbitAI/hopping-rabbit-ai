"""
测试 Remotion V2 两阶段生成器

运行方式:
cd /Users/hexiangyang/rabbit-ai/lepus-ai/backend
python -m scripts.test_remotion_v2
"""

import asyncio
import json
import logging

# 配置日志
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


# 模拟的 clips 数据（约 90 秒的视频）
MOCK_CLIPS = [
    {"id": "clip_1", "content_text": "今天给大家介绍一个非常好用的手机摄影技巧", "start_time": 0, "end_time": 5000, "metadata": {}},
    {"id": "clip_2", "content_text": "很多人拍照的时候总是找不到好的角度", "start_time": 5000, "end_time": 10000, "metadata": {}},
    {"id": "clip_3", "content_text": "其实秘诀就在于学会利用自然光", "start_time": 10000, "end_time": 15000, "metadata": {}},
    {"id": "clip_4", "content_text": "比如说早晨的金色阳光特别适合拍人像", "start_time": 15000, "end_time": 20000, "metadata": {}},
    {"id": "clip_5", "content_text": "你看这个照片就是用早晨的阳光拍的", "start_time": 20000, "end_time": 25000, "metadata": {}},
    {"id": "clip_6", "content_text": "第二个技巧是要学会构图", "start_time": 25000, "end_time": 30000, "metadata": {}},
    {"id": "clip_7", "content_text": "三分法则是最基础也是最实用的", "start_time": 30000, "end_time": 35000, "metadata": {}},
    {"id": "clip_8", "content_text": "把画面分成三等分", "start_time": 35000, "end_time": 40000, "metadata": {}},
    {"id": "clip_9", "content_text": "然后把主体放在交叉点上", "start_time": 40000, "end_time": 45000, "metadata": {}},
    {"id": "clip_10", "content_text": "这样拍出来的照片就会很有层次感", "start_time": 45000, "end_time": 50000, "metadata": {}},
    {"id": "clip_11", "content_text": "第三个技巧是善用手机的专业模式", "start_time": 50000, "end_time": 55000, "metadata": {}},
    {"id": "clip_12", "content_text": "现在很多手机都有专业模式", "start_time": 55000, "end_time": 60000, "metadata": {}},
    {"id": "clip_13", "content_text": "你可以手动调节曝光快门ISO", "start_time": 60000, "end_time": 65000, "metadata": {}},
    {"id": "clip_14", "content_text": "特别是拍夜景的时候非常有用", "start_time": 65000, "end_time": 70000, "metadata": {}},
    {"id": "clip_15", "content_text": "好了今天的分享就到这里", "start_time": 70000, "end_time": 75000, "metadata": {}},
    {"id": "clip_16", "content_text": "如果觉得有用记得点赞收藏", "start_time": 75000, "end_time": 80000, "metadata": {}},
    {"id": "clip_17", "content_text": "我们下期再见", "start_time": 80000, "end_time": 85000, "metadata": {}},
]

TOTAL_DURATION_MS = 85000


async def test_v2_generator():
    """测试 V2 生成器"""
    from app.services.remotion_generator_v2 import get_remotion_generator_v2
    
    logger.info("=" * 60)
    logger.info("测试 Remotion V2 两阶段生成器")
    logger.info("=" * 60)
    
    generator = get_remotion_generator_v2()
    
    logger.info(f"\n输入:")
    logger.info(f"  - clips 数量: {len(MOCK_CLIPS)}")
    logger.info(f"  - 总时长: {TOTAL_DURATION_MS}ms ({TOTAL_DURATION_MS/1000}秒)")
    
    config = await generator.generate(
        clips=MOCK_CLIPS,
        total_duration_ms=TOTAL_DURATION_MS,
        target_aspect_ratio="9:16",
        default_display_mode="fullscreen",
    )
    
    logger.info(f"\n输出:")
    logger.info(f"  - theme: {config.theme}")
    logger.info(f"  - text_components: {config.text_count}")
    logger.info(f"  - broll_components: {config.broll_count}")
    logger.info(f"  - chapter_components: {len(config.chapter_components)}")
    
    logger.info(f"\n章节:")
    for ch in config.chapter_components:
        logger.info(f"  [{ch.id}] {ch.start_ms}-{ch.end_ms}ms: {ch.title}")
    
    logger.info(f"\n文字动画:")
    for tc in config.text_components:
        logger.info(f"  [{tc.id}] {tc.start_ms}-{tc.end_ms}ms: {tc.animation} - {tc.text[:30]}...")
    
    logger.info(f"\nB-Roll:")
    for bc in config.broll_components:
        logger.info(f"  [{bc.id}] {bc.start_ms}-{bc.end_ms}ms: {bc.display_mode} - {bc.search_keywords}")
    
    # 保存完整配置到文件
    output_file = "/tmp/remotion_v2_test_output.json"
    with open(output_file, "w", encoding="utf-8") as f:
        json.dump(config.model_dump(), f, ensure_ascii=False, indent=2)
    logger.info(f"\n完整配置已保存到: {output_file}")
    
    return config


async def compare_v1_v2():
    """对比 V1 和 V2 的生成结果"""
    import time
    
    logger.info("=" * 60)
    logger.info("对比 V1 vs V2 性能")
    logger.info("=" * 60)
    
    # V1
    from app.services.remotion_generator import get_remotion_generator
    v1_generator = get_remotion_generator()
    
    logger.info("\n--- V1 单次调用 ---")
    start = time.time()
    try:
        v1_config = await asyncio.wait_for(
            v1_generator.generate(
                clips=MOCK_CLIPS,
                total_duration_ms=TOTAL_DURATION_MS,
            ),
            timeout=60  # 60秒超时
        )
        v1_time = time.time() - start
        logger.info(f"V1 完成: {v1_time:.2f}秒, text={v1_config.text_count}, broll={v1_config.broll_count}")
    except asyncio.TimeoutError:
        logger.warning("V1 超时 (>60s)")
        v1_time = -1
    except Exception as e:
        logger.error(f"V1 失败: {e}")
        v1_time = -1
    
    # V2
    from app.services.remotion_generator_v2 import get_remotion_generator_v2
    v2_generator = get_remotion_generator_v2()
    
    logger.info("\n--- V2 两阶段 ---")
    start = time.time()
    try:
        v2_config = await asyncio.wait_for(
            v2_generator.generate(
                clips=MOCK_CLIPS,
                total_duration_ms=TOTAL_DURATION_MS,
            ),
            timeout=120  # 120秒超时
        )
        v2_time = time.time() - start
        logger.info(f"V2 完成: {v2_time:.2f}秒, text={v2_config.text_count}, broll={v2_config.broll_count}")
    except asyncio.TimeoutError:
        logger.warning("V2 超时 (>120s)")
        v2_time = -1
    except Exception as e:
        logger.error(f"V2 失败: {e}")
        v2_time = -1
    
    logger.info("\n--- 对比结果 ---")
    if v1_time > 0:
        logger.info(f"V1: {v1_time:.2f}秒")
    else:
        logger.info("V1: 失败/超时")
    if v2_time > 0:
        logger.info(f"V2: {v2_time:.2f}秒")
    else:
        logger.info("V2: 失败/超时")


if __name__ == "__main__":
    import sys
    
    if len(sys.argv) > 1 and sys.argv[1] == "--compare":
        asyncio.run(compare_v1_v2())
    else:
        asyncio.run(test_v2_generator())
