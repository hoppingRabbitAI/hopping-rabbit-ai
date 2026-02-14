"""
测试视频工具函数

运行方式:
cd /Users/hexiangyang/rabbit-ai/lepus-ai/backend
python -m scripts.test_video_utils
"""

import sys
sys.path.insert(0, '/Users/hexiangyang/rabbit-ai/lepus-ai/backend')

from app.services.video_utils import (
    detect_video_orientation,
    detect_aspect_ratio,
    get_pexels_orientation,
    calculate_crop_area,
    get_ffmpeg_crop_filter,
    get_broll_fit_info,
    calculate_letterbox_params,
    get_ffmpeg_letterbox_filter,
    AspectRatio,
    VideoOrientation,
    BRollFitMode,
)


def test_orientation_detection():
    """测试方向检测"""
    print("\n=== 测试方向检测 ===")
    
    # 横屏
    assert detect_video_orientation(1920, 1080) == VideoOrientation.LANDSCAPE
    print(f"1920x1080 -> {detect_video_orientation(1920, 1080).value}")
    
    # 竖屏
    assert detect_video_orientation(1080, 1920) == VideoOrientation.PORTRAIT
    print(f"1080x1920 -> {detect_video_orientation(1080, 1920).value}")
    
    # 方形
    assert detect_video_orientation(1080, 1080) == VideoOrientation.SQUARE
    print(f"1080x1080 -> {detect_video_orientation(1080, 1080).value}")
    
    # None 值处理
    assert detect_video_orientation(None, 1080) == VideoOrientation.LANDSCAPE
    print(f"None x 1080 -> {detect_video_orientation(None, 1080).value} (默认)")


def test_aspect_ratio_detection():
    """测试宽高比检测"""
    print("\n=== 测试宽高比检测 ===")
    
    # 16:9
    assert detect_aspect_ratio(1920, 1080) == AspectRatio.RATIO_16_9
    print(f"1920x1080 -> {detect_aspect_ratio(1920, 1080).value}")
    
    # 9:16
    assert detect_aspect_ratio(1080, 1920) == AspectRatio.RATIO_9_16
    print(f"1080x1920 -> {detect_aspect_ratio(1080, 1920).value}")


def test_pexels_orientation():
    """测试 Pexels 方向参数"""
    print("\n=== 测试 Pexels 方向参数 ===")
    
    assert get_pexels_orientation(AspectRatio.RATIO_16_9) == "landscape"
    print(f"16:9 -> {get_pexels_orientation(AspectRatio.RATIO_16_9)}")
    
    assert get_pexels_orientation(AspectRatio.RATIO_9_16) == "portrait"
    print(f"9:16 -> {get_pexels_orientation(AspectRatio.RATIO_9_16)}")


def test_letterbox_calculation():
    """测试 letterbox 计算"""
    print("\n=== 测试 letterbox 计算 ===")
    
    # 场景1：横屏素材放入竖屏框 -> letterbox（上下黑边）
    params = calculate_letterbox_params(
        source_width=1920, source_height=1080,  # 16:9 横屏素材
        target_width=1080, target_height=1920,  # 9:16 竖屏目标
    )
    print(f"\n场景1: 16:9 横屏素材 -> 9:16 竖屏框")
    print(f"  模式: {params['mode']}")
    print(f"  缩放: {params['scale_factor']:.2f}x")
    print(f"  缩放后尺寸: {params['scaled_width']}x{params['scaled_height']}")
    print(f"  上下黑边: {params['pad_y']}px (各 {params['pad_y']//2}px)")
    assert params['mode'] == 'letterbox'
    
    # 场景2：竖屏素材放入横屏框 -> pillarbox（左右黑边）
    params = calculate_letterbox_params(
        source_width=1080, source_height=1920,  # 9:16 竖屏素材
        target_width=1920, target_height=1080,  # 16:9 横屏目标
    )
    print(f"\n场景2: 9:16 竖屏素材 -> 16:9 横屏框")
    print(f"  模式: {params['mode']}")
    print(f"  缩放: {params['scale_factor']:.2f}x")
    print(f"  缩放后尺寸: {params['scaled_width']}x{params['scaled_height']}")
    print(f"  左右黑边: {params['pad_x']}px (各 {params['pad_x']//2}px)")
    assert params['mode'] == 'pillarbox'
    
    # 场景3：比例相同 -> fit
    params = calculate_letterbox_params(
        source_width=1920, source_height=1080,
        target_width=1280, target_height=720,
    )
    print(f"\n场景3: 16:9 -> 16:9 (仅缩放)")
    print(f"  模式: {params['mode']}")
    assert params['mode'] == 'fit'


def test_ffmpeg_letterbox_filter():
    """测试 FFmpeg letterbox 滤镜生成"""
    print("\n=== 测试 FFmpeg letterbox 滤镜 ===")
    
    # 横屏素材放入竖屏框
    filter_str = get_ffmpeg_letterbox_filter(
        source_width=1920, source_height=1080,
        target_width=1080, target_height=1920,
    )
    print(f"\n16:9 -> 9:16 FFmpeg滤镜:")
    print(f"  {filter_str}")
    
    # 竖屏素材放入横屏框
    filter_str = get_ffmpeg_letterbox_filter(
        source_width=1080, source_height=1920,
        target_width=1920, target_height=1080,
    )
    print(f"\n9:16 -> 16:9 FFmpeg滤镜:")
    print(f"  {filter_str}")


def test_broll_fit_info():
    """★ 测试 B-Roll 适配信息（核心功能）"""
    print("\n=== ★ 测试 B-Roll 适配信息 ===")
    
    # 场景1：横屏素材 + 竖屏目标 + fullscreen 模式 -> letterbox
    print("\n场景1: 横屏素材 + 竖屏目标 + fullscreen")
    fit_info = get_broll_fit_info(
        broll_width=1920,
        broll_height=1080,
        target_aspect_ratio=AspectRatio.RATIO_9_16,
        display_mode="fullscreen",
    )
    print(f"  源: {fit_info['source_aspect_ratio']}")
    print(f"  目标: {fit_info['target_aspect_ratio']}")
    print(f"  适配模式: {fit_info['fit_mode']}")
    print(f"  需要调整: {fit_info['needs_adjustment']}")
    print(f"  FFmpeg滤镜: {fit_info['ffmpeg_filter']}")
    if fit_info['letterbox_params']:
        print(f"  上下黑边: {fit_info['letterbox_params']['pad_y']}px")
    assert fit_info['fit_mode'] == 'letterbox'
    
    # 场景2：竖屏素材 + 横屏目标 + fullscreen 模式 -> pillarbox
    print("\n场景2: 竖屏素材 + 横屏目标 + fullscreen")
    fit_info = get_broll_fit_info(
        broll_width=1080,
        broll_height=1920,
        target_aspect_ratio=AspectRatio.RATIO_16_9,
        display_mode="fullscreen",
    )
    print(f"  源: {fit_info['source_aspect_ratio']}")
    print(f"  目标: {fit_info['target_aspect_ratio']}")
    print(f"  适配模式: {fit_info['fit_mode']}")
    print(f"  FFmpeg滤镜: {fit_info['ffmpeg_filter']}")
    if fit_info['letterbox_params']:
        print(f"  左右黑边: {fit_info['letterbox_params']['pad_x']}px")
    assert fit_info['fit_mode'] == 'pillarbox'
    
    # 场景3：比例匹配 -> 无需调整
    print("\n场景3: 比例匹配 -> 无需调整")
    fit_info = get_broll_fit_info(
        broll_width=1080,
        broll_height=1920,
        target_aspect_ratio=AspectRatio.RATIO_9_16,
        display_mode="fullscreen",
    )
    print(f"  源: {fit_info['source_aspect_ratio']}")
    print(f"  目标: {fit_info['target_aspect_ratio']}")
    print(f"  适配模式: {fit_info['fit_mode']}")
    print(f"  需要调整: {fit_info['needs_adjustment']}")
    assert fit_info['fit_mode'] == 'none'
    
    # 场景4：pip 模式 + crop
    print("\n场景4: pip 模式 + crop")
    fit_info = get_broll_fit_info(
        broll_width=1920,
        broll_height=1080,
        target_aspect_ratio=AspectRatio.RATIO_9_16,
        display_mode="pip",
        fit_mode=BRollFitMode.CROP,
    )
    print(f"  源: {fit_info['source_aspect_ratio']}")
    print(f"  目标: {fit_info['target_aspect_ratio']}")
    print(f"  适配模式: {fit_info['fit_mode']}")
    print(f"  FFmpeg滤镜: {fit_info['ffmpeg_filter']}")
    assert fit_info['fit_mode'] == 'crop'


if __name__ == "__main__":
    test_orientation_detection()
    test_aspect_ratio_detection()
    test_pexels_orientation()
    test_letterbox_calculation()
    test_ffmpeg_letterbox_filter()
    test_broll_fit_info()
    
    print("\n" + "=" * 50)
    print("✅ 所有测试通过!")
    print("=" * 50)
