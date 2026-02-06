#!/usr/bin/env python3
"""
简化版 Remotion Agent 测试 - 仅测试语法和导入
"""

print("=" * 60)
print("Remotion Agent 模块检查")
print("=" * 60)

# 检查模型定义
print("\n1. 检查 models.py 语法...")
with open("app/services/remotion_agent/models.py") as f:
    code = f.read()
    compile(code, "models.py", "exec")
print("   ✅ models.py 语法正确")

# 检查 stage2_structure.py 语法
print("\n2. 检查 stage2_structure.py 语法...")
with open("app/services/remotion_agent/stage2_structure.py") as f:
    code = f.read()
    compile(code, "stage2_structure.py", "exec")
print("   ✅ stage2_structure.py 语法正确")

# 检查 stage3_visual.py 语法
print("\n3. 检查 stage3_visual.py 语法...")
with open("app/services/remotion_agent/stage3_visual.py") as f:
    code = f.read()
    compile(code, "stage3_visual.py", "exec")
print("   ✅ stage3_visual.py 语法正确")

# 检查模板文件
print("\n4. 检查模板文件语法...")
templates = ["base.py", "whiteboard.py", "talking_head.py"]
for t in templates:
    with open(f"app/services/remotion_agent/templates/{t}") as f:
        code = f.read()
        compile(code, t, "exec")
    print(f"   ✅ templates/{t} 语法正确")

# 检查 prompts
print("\n5. 检查 prompts 语法...")
with open("app/services/remotion_agent/prompts/structure.py") as f:
    code = f.read()
    compile(code, "structure.py", "exec")
print("   ✅ prompts/structure.py 语法正确")

print("\n" + "=" * 60)
print("✅ 所有后端模块语法检查通过!")
print("=" * 60)

# 统计代码行数
print("\n代码统计:")
import os
total_lines = 0
files = [
    "app/services/remotion_agent/models.py",
    "app/services/remotion_agent/stage2_structure.py",
    "app/services/remotion_agent/stage3_visual.py",
    "app/services/remotion_agent/templates/base.py",
    "app/services/remotion_agent/templates/whiteboard.py",
    "app/services/remotion_agent/templates/talking_head.py",
    "app/services/remotion_agent/prompts/structure.py",
]
for f_path in files:
    with open(f_path) as f:
        lines = len(f.readlines())
        total_lines += lines
        print(f"  {f_path.split('/')[-1]}: {lines} 行")
print(f"\n  总计: {total_lines} 行后端代码")
