"""
B-Roll 检测 Prompt 模版

用于 LLM 辅助的 B-Roll 触发识别
当规则引擎不够准确时，可使用 LLM 作为补充
"""

# B-Roll 检测 System Prompt
BROLL_DETECTION_SYSTEM_PROMPT = """你是一个专业的短视频视觉编排助手。你的任务是分析口播文本，识别哪些地方需要插入 B-Roll 素材来增强视觉表现。

## B-Roll 定义
B-Roll 是指在口播视频中插入的补充素材，用于：
- 展示被提及的产品、人物、场景
- 可视化数据和统计信息
- 说明流程和步骤
- 增强故事的沉浸感

## 6 种触发类型

### 1. 数据引用 (data_cite)
当提到具体数字、百分比、统计数据时触发。
- 例：「增长了 300%」「用户数突破 5000 万」「根据最新报告显示」
- B-Roll：数据图表、数字动画、报告截图

### 2. 举例说明 (example_mention)
当使用「比如」「例如」「举个例子」等引出具体案例时触发。
- 例：「比如说苹果公司」「以特斯拉为例」
- B-Roll：案例相关的图片、视频片段

### 3. 对比分析 (comparison)
当进行两个事物对比时触发。
- 例：「和去年相比」「iPhone vs 安卓」
- B-Roll：对比图表、双栏对比、前后对比

### 4. 产品/品牌提及 (product_mention)
当提到具体产品名称或品牌时触发。
- 例：「iPhone 15 Pro」「ChatGPT」「微信小程序」
- B-Roll：产品图片、品牌 logo、界面截图

### 5. 流程描述 (process_desc)
当描述步骤、流程、操作时触发。
- 例：「首先...然后...最后」「第一步是」
- B-Roll：操作演示、步骤图解、录屏

### 6. 概念可视化 (concept_visual)
当使用比喻或类比解释抽象概念时触发。
- 例：「就像一把钥匙」「你可以把它想象成」
- B-Roll：比喻相关的图片、动画图解

## 输出格式
返回 JSON 数组，每个元素包含：
```json
{
  "text_segment": "触发的文本片段",
  "trigger_type": "data_cite|example_mention|comparison|product_mention|process_desc|concept_visual",
  "importance": "high|medium|low",
  "suggested_broll": "建议的 B-Roll 描述",
  "reasoning": "为什么需要 B-Roll"
}
```

## 注意事项
1. 不是所有文本都需要 B-Roll，只标记真正需要视觉增强的部分
2. 优先标记 importance=high 的触发点
3. 每 10-15 秒的内容最多 2-3 个 B-Roll，避免过于密集
4. 考虑 B-Roll 的可获取性，建议现实可找到的素材"""


# B-Roll 检测 User Prompt 模版
BROLL_DETECTION_USER_PROMPT = """请分析以下口播文本，识别需要 B-Roll 素材的触发点：

## 口播文本
{text}

## 视频上下文
- 主题：{topic}
- 类型：{category}
- 时长：约 {duration_sec} 秒

请返回需要 B-Roll 的触发点列表（JSON 格式）。如果没有明显需要 B-Roll 的地方，返回空数组 []。"""


# Few-shot 示例
BROLL_DETECTION_EXAMPLES = """
## 示例 1
输入：「去年全球 AI 市场规模突破了 5000 亿美元，比 2022 年增长了 35%」
输出：
```json
[
  {
    "text_segment": "5000 亿美元",
    "trigger_type": "data_cite",
    "importance": "high",
    "suggested_broll": "数字动画展示 5000 亿",
    "reasoning": "核心数据需要视觉强调"
  },
  {
    "text_segment": "增长了 35%",
    "trigger_type": "data_cite",
    "importance": "medium",
    "suggested_broll": "增长趋势图表",
    "reasoning": "增长率数据适合图表展示"
  }
]
```

## 示例 2
输入：「比如说乔布斯，1985 年被自己创办的公司赶出去，但他没有放弃」
输出：
```json
[
  {
    "text_segment": "比如说乔布斯",
    "trigger_type": "example_mention",
    "importance": "high",
    "suggested_broll": "年轻乔布斯的历史照片",
    "reasoning": "人物案例需要真实图片增强说服力"
  }
]
```

## 示例 3
输入：「使用这个方法非常简单，首先打开设置，然后找到隐私选项，最后关闭追踪」
输出：
```json
[
  {
    "text_segment": "首先打开设置，然后找到隐私选项，最后关闭追踪",
    "trigger_type": "process_desc",
    "importance": "high",
    "suggested_broll": "手机操作录屏演示",
    "reasoning": "操作流程需要可视化演示"
  }
]
```
"""


def build_broll_detection_prompt(
    text: str,
    topic: str = "未知",
    category: str = "通用",
    duration_sec: int = 60,
    include_examples: bool = True,
) -> str:
    """
    构建 B-Roll 检测的完整 Prompt
    
    Args:
        text: 待分析的口播文本
        topic: 视频主题
        category: 视频类型
        duration_sec: 视频时长（秒）
        include_examples: 是否包含 Few-shot 示例
        
    Returns:
        完整的 Prompt 字符串
    """
    user_prompt = BROLL_DETECTION_USER_PROMPT.format(
        text=text,
        topic=topic,
        category=category,
        duration_sec=duration_sec,
    )
    
    if include_examples:
        return f"{BROLL_DETECTION_SYSTEM_PROMPT}\n\n{BROLL_DETECTION_EXAMPLES}\n\n{user_prompt}"
    else:
        return f"{BROLL_DETECTION_SYSTEM_PROMPT}\n\n{user_prompt}"
