"""
Stage 2: 结构分析 Prompt

分析知识类视频的内容结构，识别：
- 内容角色 (hook, point, explanation, data, summary 等)
- 内容类型 (列表项、数据、关键词、概念定义等)
- 结构化数据 (数字、关键词、引用)
"""

STRUCTURE_ANALYSIS_PROMPT = '''你是一个专业的知识类视频内容分析师。你需要分析视频转写文本的结构，为每个片段标注其角色和类型。

## 任务
分析以下视频片段，输出结构化的 JSON 结果。

{context_hint}

## 片段列表
{segments_text}

## 分析规则

### 1. 内容角色 (role)
判断每个片段在视频中的作用：
- `hook`: 开场钩子 - 抛出问题、痛点、吸引注意力的内容
- `point`: 核心要点 - 主要观点、论点
- `explanation`: 解释说明 - 对观点的展开解释
- `example`: 举例论证 - "比如说"、"举个例子"
- `data`: 数据支撑 - 包含具体数字、百分比的内容
- `transition`: 过渡连接 - "接下来"、"那么"等过渡语
- `summary`: 总结回顾 - "总结一下"、"所以"
- `cta`: 行动号召 - "点赞"、"关注"、"留言"
- `filler`: 填充内容 - 口头禅、无实质内容

### 2. 内容类型 (content_type)
决定使用什么视觉组件：
- `title-display`: 适合大字标题展示 (开场问题、标题)
- `data-highlight`: 包含数字，适合数字动画 (300%、5倍、100万)
- `keyword-emphasis`: 强调关键词 ("重要的是"、"关键是"、"核心是")
- `list-item`: 列表项 (第一、第二、首先、然后)
- `process-step`: 流程步骤 (先做A、再做B、最后C)
- `comparison`: 对比内容 (A vs B、比起、相比)
- `concept-define`: 概念定义 (什么是X、X是指、所谓X)
- `story-scene`: 故事场景，适合切B-Roll (我之前、有一次)
- `quote`: 引用名言 (XX说过、名言)
- `direct-talk`: 直接对话，需要看到人 (你们觉得呢、对吧)
- `none`: 无需特殊视觉增强

### 3. 列表结构识别 (list_context)
当检测到列表结构时，需要追踪：
- 识别"第一/首先/1."这样的开始
- 追踪整个列表有多少项
- 为每一项填写 list_context

例如：
"第一，要保持专注" → list_context: {{"list_id": "list_1", "item_index": 1, "total_items": 3, "item_title": "保持专注"}}

### 4. 流程结构识别 (process_context)
当检测到递进/流程关系时：
- 识别"首先...然后...最后..."的模式
- 或"先做A → 再做B → 最后C"的逻辑关系

### 5. 数据提取 (extracted_data)
从文本中提取：
- numbers: 数字及其含义 {{"value": "300%", "label": "增长率", "trend": "up"}}
- keywords: 关键词 {{"word": "MVP", "importance": "primary"}}
- quote: 引用 {{"text": "...", "source": "XX"}}

### 6. 重要程度 (importance)
- `critical`: 核心论点、重要数据、必看内容
- `high`: 要点内容、关键概念
- `medium`: 解释说明、一般案例
- `low`: 过渡、填充

## 输出格式

严格输出以下 JSON 格式：

```json
{{
  "segments": [
    {{
      "id": "片段ID",
      "role": "hook|point|explanation|example|data|transition|summary|cta|filler",
      "content_type": "title-display|data-highlight|keyword-emphasis|list-item|process-step|comparison|concept-define|story-scene|quote|direct-talk|none",
      "importance": "critical|high|medium|low",
      "list_context": null 或 {{"list_id": "list_1", "item_index": 1, "total_items": 3, "item_title": "要点标题"}},
      "process_context": null 或 {{"process_id": "proc_1", "step_index": 1, "total_steps": 4, "step_title": "步骤标题"}},
      "extracted_data": {{
        "numbers": [{{"value": "20%", "label": "投入", "trend": "neutral"}}],
        "keywords": [{{"word": "MVP", "importance": "primary"}}],
        "quote": null 或 {{"text": "引用内容", "source": "来源"}}
      }},
      "needs_broll": false,
      "broll_keywords": []
    }}
  ],
  "global_structure": {{
    "has_point_list": true/false,
    "point_list_count": null 或 数字,
    "has_process": true/false,
    "process_step_count": null 或 数字,
    "has_comparison": true/false,
    "chapters": [
      {{"title": "开场", "start_segment_id": "seg_1", "end_segment_id": "seg_3"}}
    ]
  }}
}}
```

## 注意事项
1. 每个片段都必须分析，不要遗漏
2. ID 必须与输入的片段 ID 对应
3. 列表/流程结构需要完整追踪（total_items/total_steps 要准确）
4. 只输出 JSON，不要添加其他解释
'''
