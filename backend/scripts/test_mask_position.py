#!/usr/bin/env python3
"""
测试 mask 位置转换是否正确

这个脚本模拟用户在右侧画一个区域，验证：
1. 前端画的黑色区域 → 后端转换为白色区域
2. 白色区域的位置与用户画的位置一致
3. 合成后只有该区域被修改
"""

import asyncio
import sys
import os

# 添加项目路径
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from PIL import Image
import numpy as np
import io
import base64


def create_mock_frontend_mask(width: int, height: int, region: str = "right") -> str:
    """
    模拟前端画布生成的 mask
    
    前端使用 rgba(0, 0, 0, 0.7) 画笔
    未画区域是完全透明的
    
    Args:
        width: 画布宽度
        height: 画布高度
        region: 画的区域 - "left", "right", "top", "bottom", "center"
    
    Returns:
        data URL 格式的 PNG
    """
    # 创建 RGBA 图片（完全透明）
    mask = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    pixels = mask.load()
    
    # 根据 region 确定画的区域
    if region == "right":
        x_start, x_end = int(width * 0.6), int(width * 0.9)
        y_start, y_end = int(height * 0.2), int(height * 0.5)
    elif region == "left":
        x_start, x_end = int(width * 0.1), int(width * 0.4)
        y_start, y_end = int(height * 0.2), int(height * 0.5)
    elif region == "top":
        x_start, x_end = int(width * 0.3), int(width * 0.7)
        y_start, y_end = int(height * 0.1), int(height * 0.3)
    elif region == "bottom":
        x_start, x_end = int(width * 0.3), int(width * 0.7)
        y_start, y_end = int(height * 0.7), int(height * 0.9)
    else:  # center
        x_start, x_end = int(width * 0.35), int(width * 0.65)
        y_start, y_end = int(height * 0.35), int(height * 0.65)
    
    # 填充画笔区域 (rgba(0, 0, 0, 0.7) → alpha = 178)
    alpha_value = int(0.7 * 255)  # 178
    for y in range(y_start, y_end):
        for x in range(x_start, x_end):
            pixels[x, y] = (0, 0, 0, alpha_value)
    
    # 转换为 data URL
    buffer = io.BytesIO()
    mask.save(buffer, format="PNG")
    base64_data = base64.b64encode(buffer.getvalue()).decode()
    
    return f"data:image/png;base64,{base64_data}", {
        "x_range": (x_start, x_end),
        "y_range": (y_start, y_end),
        "size": (width, height)
    }


def convert_to_grayscale_mask(mask_image: Image.Image) -> Image.Image:
    """后端的转换函数"""
    if mask_image.mode == "RGBA":
        alpha = mask_image.split()[3]
        alpha_array = np.array(alpha)
        mask_array = np.where(alpha_array > 10, 255, 0).astype(np.uint8)
        return Image.fromarray(mask_array, mode="L")
    else:
        return mask_image.convert("L")


def analyze_mask(mask: Image.Image, name: str = "mask"):
    """分析 mask 图片"""
    arr = np.array(mask)
    
    # 基本统计
    if len(arr.shape) == 3:  # RGBA
        alpha = arr[:, :, 3]
        print(f"\n{name} (RGBA):")
        print(f"  尺寸: {mask.size}")
        print(f"  Alpha 范围: [{alpha.min()}, {alpha.max()}]")
        print(f"  非零 alpha 像素数: {np.sum(alpha > 0)}")
    else:  # Grayscale
        print(f"\n{name} (Grayscale):")
        print(f"  尺寸: {mask.size}")
        print(f"  值范围: [{arr.min()}, {arr.max()}]")
        white_pixels = np.sum(arr > 127)
        print(f"  白色像素数: {white_pixels} ({white_pixels / arr.size * 100:.2f}%)")
        
        # 找边界框
        white_coords = np.argwhere(arr > 127)
        if len(white_coords) > 0:
            y_min, x_min = white_coords.min(axis=0)
            y_max, x_max = white_coords.max(axis=0)
            print(f"  白色区域边界: x=[{x_min}, {x_max}], y=[{y_min}, {y_max}]")
            
            # 计算中心位置
            center_x = (x_min + x_max) / 2 / mask.size[0]
            center_y = (y_min + y_max) / 2 / mask.size[1]
            
            if center_x < 0.4:
                position = "左侧"
            elif center_x > 0.6:
                position = "右侧"
            else:
                position = "中间"
                
            print(f"  位置判定: {position} (中心 x={center_x:.2f})")
            return position
    return None


def test_mask_conversion():
    """测试 mask 转换"""
    print("=" * 60)
    print("测试 mask 位置转换")
    print("=" * 60)
    
    # 测试不同位置
    for region in ["right", "left", "center"]:
        print(f"\n\n{'=' * 60}")
        print(f"测试用户在 [{region}] 区域画图")
        print("=" * 60)
        
        # 模拟前端生成 mask
        data_url, info = create_mock_frontend_mask(1080, 1920, region)
        print(f"\n预期画图区域:")
        print(f"  X: {info['x_range']}")
        print(f"  Y: {info['y_range']}")
        
        # 解析 data URL
        base64_data = data_url.split(",")[1]
        image_bytes = base64.b64decode(base64_data)
        frontend_mask = Image.open(io.BytesIO(image_bytes))
        
        analyze_mask(frontend_mask, "前端生成的 mask")
        
        # 转换为灰度 mask
        grayscale_mask = convert_to_grayscale_mask(frontend_mask)
        detected_position = analyze_mask(grayscale_mask, "转换后的灰度 mask")
        
        # 验证位置
        if region == "right" and detected_position == "右侧":
            print("\n✅ 位置验证通过：画右侧 → 检测到右侧")
        elif region == "left" and detected_position == "左侧":
            print("\n✅ 位置验证通过：画左侧 → 检测到左侧")
        elif region == "center" and detected_position == "中间":
            print("\n✅ 位置验证通过：画中间 → 检测到中间")
        else:
            print(f"\n❌ 位置验证失败：期望 {region}，检测到 {detected_position}")
        
        # 保存调试图片
        output_dir = os.path.join(os.path.dirname(__file__), "..", "cache", "test_masks")
        os.makedirs(output_dir, exist_ok=True)
        
        frontend_mask.save(os.path.join(output_dir, f"frontend_{region}.png"))
        grayscale_mask.save(os.path.join(output_dir, f"grayscale_{region}.png"))
        print(f"\n调试图片已保存到: {output_dir}")


def test_composite():
    """测试合成逻辑"""
    print("\n\n" + "=" * 60)
    print("测试合成逻辑")
    print("=" * 60)
    
    from app.utils.image_utils import create_composite_image
    
    # 创建测试图片
    width, height = 400, 600
    
    # 背景：蓝色
    background = Image.new("RGBA", (width, height), (0, 100, 200, 255))
    
    # 前景：红色
    foreground = Image.new("RGBA", (width, height), (200, 50, 50, 255))
    
    # Mask：右侧为白色
    mask = Image.new("L", (width, height), 0)  # 全黑
    pixels = mask.load()
    for y in range(height // 4, height * 3 // 4):
        for x in range(width // 2, width):
            pixels[x, y] = 255  # 右侧白色
    
    # 合成
    result = create_composite_image(background, foreground, mask)
    
    # 验证结果
    result_arr = np.array(result)
    
    # 左上角应该是蓝色（背景）
    left_color = result_arr[height // 2, width // 4]
    print(f"\n左侧区域颜色: {left_color[:3]} (期望蓝色 [0, 100, 200])")
    
    # 右侧应该是红色（前景）
    right_color = result_arr[height // 2, width * 3 // 4]
    print(f"右侧区域颜色: {right_color[:3]} (期望红色 [200, 50, 50])")
    
    # 验证
    if left_color[2] > left_color[0]:  # 蓝 > 红
        print("✅ 左侧保持背景色（蓝色）")
    else:
        print("❌ 左侧颜色错误")
        
    if right_color[0] > right_color[2]:  # 红 > 蓝
        print("✅ 右侧使用前景色（红色）")
    else:
        print("❌ 右侧颜色错误")
    
    # 保存
    output_dir = os.path.join(os.path.dirname(__file__), "..", "cache", "test_masks")
    os.makedirs(output_dir, exist_ok=True)
    result.save(os.path.join(output_dir, "composite_result.png"))
    mask.save(os.path.join(output_dir, "composite_mask.png"))
    print(f"\n结果已保存到: {output_dir}")


if __name__ == "__main__":
    test_mask_conversion()
    test_composite()
    print("\n\n测试完成！")
