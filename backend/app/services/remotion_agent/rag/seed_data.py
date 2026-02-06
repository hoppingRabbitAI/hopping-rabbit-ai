"""
RAG 知识库种子数据

从 8 个标杆视频提取的高质量片段
用于初始化向量数据库
"""

from .schema import (
    BenchmarkSegment,
    BenchmarkSource,
    VisualConfigSnippet,
    ContentType,
    LayoutMode,
    BrollTriggerType,
    CanvasType,
    KeywordCardVariant,
)

SEED_DATA: list[BenchmarkSegment] = [
    # ========== 视频001: 商业解读类 ==========
    
    BenchmarkSegment(
        id="001-opener-01",
        source=BenchmarkSource(
            video_id="001",
            video_title="商业趋势解读",
            timestamp_start=0.0,
            timestamp_end=5.0
        ),
        input_text="你知道吗？去年全球AI市场规模突破了5000亿美元",
        input_text_clean="全球AI市场规模突破5000亿美元",
        content_type=ContentType.OPENER,
        template_id="talking-head",
        broll_trigger_type=BrollTriggerType.DATA_CITE,
        broll_trigger_pattern="5000亿美元",
        visual_config=VisualConfigSnippet(
            layout_mode=LayoutMode.MODE_A,
            keyword_card={
                "variant": KeywordCardVariant.DARK_SOLID,
                "text": "5000亿美元",
                "position": "bottom-center",
                "style": "data-highlight"
            },
            has_broll=False
        ),
        reasoning="开场使用震撼数据hook，配合数据高亮关键词卡片引起注意。保持人物全屏建立信任。",
        quality_score=0.95,
        tags=["opener", "data-hook", "business"]
    ),
    
    BenchmarkSegment(
        id="001-concept-01",
        source=BenchmarkSource(
            video_id="001",
            video_title="商业趋势解读",
            timestamp_start=15.0,
            timestamp_end=30.0
        ),
        input_text="这背后有三个核心驱动力：第一是算力成本下降，第二是数据积累，第三是算法突破",
        input_text_clean="三个核心驱动力 算力成本下降 数据积累 算法突破",
        content_type=ContentType.CONCEPT,
        template_id="talking-head",
        broll_trigger_type=None,
        visual_config=VisualConfigSnippet(
            layout_mode=LayoutMode.MODE_A,
            canvas_type=CanvasType.POINT_LIST,
            canvas_config={
                "points": [
                    {"number": 1, "text": "算力成本下降"},
                    {"number": 2, "text": "数据积累"},
                    {"number": 3, "text": "算法突破"}
                ],
                "animation": "sequential",
                "style": "numbered-list"
            },
            has_broll=False
        ),
        reasoning="列举三点用point-list画布，配合数字编号增强记忆。顺序出现配合口播节奏。",
        quality_score=0.95,
        tags=["concept", "point-list", "three-points"]
    ),
    
    # ========== 视频002: 科技评测类 ==========
    
    BenchmarkSegment(
        id="002-product-01",
        source=BenchmarkSource(
            video_id="002",
            video_title="iPhone最新功能评测",
            timestamp_start=10.0,
            timestamp_end=20.0
        ),
        input_text="iPhone 16最大的升级就是这颗A18芯片，性能提升了40%",
        input_text_clean="iPhone 16 A18芯片 性能提升40%",
        content_type=ContentType.CONCEPT,
        template_id="talking-head",
        broll_trigger_type=BrollTriggerType.PRODUCT_MENTION,
        broll_trigger_pattern="iPhone 16",
        visual_config=VisualConfigSnippet(
            layout_mode=LayoutMode.MODE_B,
            keyword_card={
                "variant": KeywordCardVariant.GRADIENT,
                "text": "性能提升40%",
                "position": "bottom-center"
            },
            has_broll=True,
            broll_description="iPhone 16产品图或A18芯片渲染图",
            pip_config={
                "type": "person",
                "position": "bottom-right",
                "size": "small"
            }
        ),
        reasoning="产品提及触发B-Roll，切换到素材全屏模式展示产品。人物缩小到画中画保持连续性。",
        quality_score=0.95,
        tags=["product", "tech", "broll", "pip"]
    ),
    
    BenchmarkSegment(
        id="002-comparison-01",
        source=BenchmarkSource(
            video_id="002",
            video_title="iPhone最新功能评测",
            timestamp_start=45.0,
            timestamp_end=60.0
        ),
        input_text="和去年的iPhone 15相比，续航从12小时提升到了15小时，充电速度从20W提升到了35W",
        input_text_clean="iPhone 15对比 续航12小时到15小时 充电20W到35W",
        content_type=ContentType.COMPARISON,
        template_id="talking-head",
        broll_trigger_type=BrollTriggerType.COMPARISON,
        broll_trigger_pattern="和.*相比",
        visual_config=VisualConfigSnippet(
            layout_mode=LayoutMode.MODE_A,
            canvas_type=CanvasType.COMPARISON,
            canvas_config={
                "left": {
                    "title": "iPhone 15",
                    "items": ["续航 12h", "充电 20W"]
                },
                "right": {
                    "title": "iPhone 16",
                    "items": ["续航 15h", "充电 35W"]
                },
                "highlight": "right"
            },
            has_broll=False
        ),
        reasoning="对比分析使用comparison画布，左右对照直观展示差异。高亮新版本列。",
        quality_score=0.95,
        tags=["comparison", "tech", "canvas"]
    ),
    
    # ========== 视频003: 知识科普类 ==========
    
    BenchmarkSegment(
        id="003-question-01",
        source=BenchmarkSource(
            video_id="003",
            video_title="为什么咖啡能提神",
            timestamp_start=0.0,
            timestamp_end=8.0
        ),
        input_text="你有没有想过，为什么喝了咖啡就不困了？",
        input_text_clean="为什么喝咖啡不困",
        content_type=ContentType.OPENER,
        template_id="whiteboard",
        broll_trigger_type=None,
        visual_config=VisualConfigSnippet(
            layout_mode=LayoutMode.MODE_A,
            keyword_card={
                "variant": KeywordCardVariant.SEMI_TRANSPARENT,
                "text": "为什么咖啡能提神？",
                "position": "center",
                "style": "question"
            },
            has_broll=False
        ),
        reasoning="疑问式开场用问题卡片引发思考，居中展示突出问题。",
        quality_score=0.90,
        tags=["opener", "question", "science"]
    ),
    
    BenchmarkSegment(
        id="003-process-01",
        source=BenchmarkSource(
            video_id="003",
            video_title="为什么咖啡能提神",
            timestamp_start=20.0,
            timestamp_end=40.0
        ),
        input_text="咖啡因进入身体后，首先通过消化系统吸收，然后进入血液，最后到达大脑",
        input_text_clean="咖啡因 消化系统吸收 进入血液 到达大脑",
        content_type=ContentType.CONCEPT,
        template_id="whiteboard",
        broll_trigger_type=BrollTriggerType.PROCESS_DESC,
        broll_trigger_pattern="首先.*然后.*最后",
        visual_config=VisualConfigSnippet(
            layout_mode=LayoutMode.MODE_C,
            canvas_type=CanvasType.PROCESS_FLOW,
            canvas_config={
                "steps": [
                    {"icon": "stomach", "text": "消化吸收"},
                    {"icon": "blood", "text": "进入血液"},
                    {"icon": "brain", "text": "到达大脑"}
                ],
                "animation": "flow",
                "connector": "arrow"
            },
            has_broll=False
        ),
        reasoning="流程描述用process-flow画布，配合流动动画展示过程。纯素材模式聚焦内容。",
        quality_score=0.95,
        tags=["process", "science", "flow"]
    ),
    
    # ========== 视频004: 教程类 ==========
    
    BenchmarkSegment(
        id="004-step-01",
        source=BenchmarkSource(
            video_id="004",
            video_title="Excel数据透视表教程",
            timestamp_start=30.0,
            timestamp_end=45.0
        ),
        input_text="第一步，选中你的数据区域，注意要包含表头",
        input_text_clean="第一步 选中数据区域 包含表头",
        content_type=ContentType.CONCEPT,
        template_id="talking-head",
        broll_trigger_type=BrollTriggerType.PROCESS_DESC,
        broll_trigger_pattern="第一步",
        visual_config=VisualConfigSnippet(
            layout_mode=LayoutMode.MODE_B,
            keyword_card={
                "variant": KeywordCardVariant.NUMBERED,
                "text": "选中数据区域",
                "number": 1,
                "position": "top-left"
            },
            has_broll=True,
            broll_description="Excel软件操作录屏",
            pip_config={
                "type": "person",
                "position": "bottom-right",
                "size": "small"
            }
        ),
        reasoning="教程步骤配合屏幕录制B-Roll，人物画中画保持讲解连续性。编号卡片强调步骤。",
        quality_score=0.95,
        tags=["tutorial", "step", "screencast"]
    ),
    
    # ========== 视频005: 故事叙事类 ==========
    
    BenchmarkSegment(
        id="005-example-01",
        source=BenchmarkSource(
            video_id="005",
            video_title="创业故事",
            timestamp_start=20.0,
            timestamp_end=35.0
        ),
        input_text="比如说乔布斯，1985年被自己创办的公司赶出去",
        input_text_clean="乔布斯 1985年 被公司赶出去",
        content_type=ContentType.EXAMPLE,
        template_id="talking-head",
        broll_trigger_type=BrollTriggerType.EXAMPLE_MENTION,
        broll_trigger_pattern="比如说",
        visual_config=VisualConfigSnippet(
            layout_mode=LayoutMode.MODE_B,
            keyword_card={
                "variant": KeywordCardVariant.LIGHT_SOLID,
                "text": "1985",
                "position": "bottom-left",
                "style": "year"
            },
            has_broll=True,
            broll_description="年轻乔布斯的历史照片",
            pip_config={
                "type": "person",
                "position": "bottom-right",
                "size": "medium"
            }
        ),
        reasoning="举例触发历史人物B-Roll，年份卡片增强时间感。人物画中画保持叙事者存在。",
        quality_score=0.90,
        tags=["example", "story", "historical"]
    ),
    
    BenchmarkSegment(
        id="005-quote-01",
        source=BenchmarkSource(
            video_id="005",
            video_title="创业故事",
            timestamp_start=60.0,
            timestamp_end=70.0
        ),
        input_text="乔布斯说过一句话：'Stay hungry, stay foolish'",
        input_text_clean="乔布斯 Stay hungry stay foolish",
        content_type=ContentType.QUOTE,
        template_id="talking-head",
        broll_trigger_type=None,
        visual_config=VisualConfigSnippet(
            layout_mode=LayoutMode.MODE_A,
            keyword_card={
                "variant": KeywordCardVariant.GRADIENT,
                "text": "Stay hungry, stay foolish",
                "position": "center",
                "style": "quote",
                "author": "Steve Jobs"
            },
            has_broll=False
        ),
        reasoning="名言引用用居中大字展示，渐变背景增加质感。保持人物全屏强调引用庄重感。",
        quality_score=0.95,
        tags=["quote", "famous-quote", "inspiration"]
    ),
    
    # ========== 视频006: 数据分析类 ==========
    
    BenchmarkSegment(
        id="006-data-01",
        source=BenchmarkSource(
            video_id="006",
            video_title="电商数据解读",
            timestamp_start=15.0,
            timestamp_end=30.0
        ),
        input_text="根据最新报告显示，2024年直播电商GMV达到了4.9万亿，同比增长35%",
        input_text_clean="2024年直播电商GMV 4.9万亿 同比增长35%",
        content_type=ContentType.DATA,
        template_id="talking-head",
        broll_trigger_type=BrollTriggerType.DATA_CITE,
        broll_trigger_pattern="万亿|增长.*%",
        visual_config=VisualConfigSnippet(
            layout_mode=LayoutMode.MODE_A,
            canvas_type=CanvasType.DATA_CHART,
            canvas_config={
                "type": "bar",
                "data": [
                    {"label": "2023", "value": 3.6},
                    {"label": "2024", "value": 4.9}
                ],
                "highlight": "2024",
                "unit": "万亿",
                "growth": "+35%"
            },
            keyword_card={
                "variant": KeywordCardVariant.DARK_SOLID,
                "text": "4.9万亿",
                "position": "top-right"
            },
            has_broll=False
        ),
        reasoning="数据引用配柱状图直观展示增长。关键数字用卡片再次强调。",
        quality_score=0.95,
        tags=["data", "chart", "growth"]
    ),
    
    # ========== 视频007: 观点评论类 ==========
    
    BenchmarkSegment(
        id="007-opinion-01",
        source=BenchmarkSource(
            video_id="007",
            video_title="AI会取代人类吗",
            timestamp_start=30.0,
            timestamp_end=45.0
        ),
        input_text="我认为，AI不会取代人类，但会取代不会用AI的人",
        input_text_clean="AI不会取代人类 会取代不会用AI的人",
        content_type=ContentType.CONCEPT,
        template_id="talking-head",
        broll_trigger_type=None,
        visual_config=VisualConfigSnippet(
            layout_mode=LayoutMode.MODE_A,
            keyword_card={
                "variant": KeywordCardVariant.GRADIENT,
                "text": "AI不会取代人类\n但会取代不会用AI的人",
                "position": "bottom-center",
                "style": "opinion",
                "multiline": True
            },
            has_broll=False
        ),
        reasoning="核心观点用醒目卡片展示，人物全屏强调个人观点的主观性。双行文字突出转折。",
        quality_score=0.90,
        tags=["opinion", "statement", "ai"]
    ),
    
    # ========== 视频008: 总结CTA类 ==========
    
    BenchmarkSegment(
        id="008-summary-01",
        source=BenchmarkSource(
            video_id="008",
            video_title="投资理财建议",
            timestamp_start=120.0,
            timestamp_end=140.0
        ),
        input_text="总结一下，投资理财要记住三点：分散投资、长期持有、定期复盘",
        input_text_clean="总结 分散投资 长期持有 定期复盘",
        content_type=ContentType.SUMMARY,
        template_id="talking-head",
        broll_trigger_type=None,
        visual_config=VisualConfigSnippet(
            layout_mode=LayoutMode.MODE_A,
            canvas_type=CanvasType.POINT_LIST,
            canvas_config={
                "points": [
                    {"icon": "chart-pie", "text": "分散投资"},
                    {"icon": "clock", "text": "长期持有"},
                    {"icon": "refresh", "text": "定期复盘"}
                ],
                "style": "summary",
                "animation": "all-at-once"
            },
            has_broll=False
        ),
        reasoning="总结用point-list一次性展示所有要点，配合图标增强记忆。",
        quality_score=0.95,
        tags=["summary", "point-list", "finance"]
    ),
    
    BenchmarkSegment(
        id="008-cta-01",
        source=BenchmarkSource(
            video_id="008",
            video_title="投资理财建议",
            timestamp_start=145.0,
            timestamp_end=155.0
        ),
        input_text="如果这个视频对你有帮助，记得点赞关注，我们下期见",
        input_text_clean="点赞关注 下期见",
        content_type=ContentType.CTA,
        template_id="talking-head",
        broll_trigger_type=None,
        visual_config=VisualConfigSnippet(
            layout_mode=LayoutMode.MODE_A,
            keyword_card={
                "variant": KeywordCardVariant.GRADIENT,
                "text": "👍 点赞 + 关注",
                "position": "bottom-center",
                "style": "cta",
                "animation": "pulse"
            },
            has_broll=False
        ),
        reasoning="CTA使用醒目渐变卡片配合脉冲动画引导用户行动。人物全屏增强亲和力。",
        quality_score=0.90,
        tags=["cta", "engagement", "outro"]
    ),
    
    # ========== 更多补充数据 ==========
    
    BenchmarkSegment(
        id="001-transition-01",
        source=BenchmarkSource(
            video_id="001",
            video_title="商业趋势解读",
            timestamp_start=60.0,
            timestamp_end=65.0
        ),
        input_text="说完了市场，我们再来看看技术层面",
        input_text_clean="说完市场 看技术层面",
        content_type=ContentType.TRANSITION,
        template_id="talking-head",
        broll_trigger_type=None,
        visual_config=VisualConfigSnippet(
            layout_mode=LayoutMode.MODE_A,
            keyword_card={
                "variant": KeywordCardVariant.SEMI_TRANSPARENT,
                "text": "技术层面",
                "position": "center",
                "style": "chapter",
                "animation": "fade-in"
            },
            has_broll=False
        ),
        reasoning="章节过渡用简洁的标题卡片提示话题切换，淡入动画平滑过渡。",
        quality_score=0.85,
        tags=["transition", "chapter", "topic-change"]
    ),
    
    BenchmarkSegment(
        id="003-concept-visual-01",
        source=BenchmarkSource(
            video_id="003",
            video_title="为什么咖啡能提神",
            timestamp_start=50.0,
            timestamp_end=65.0
        ),
        input_text="简单来说，咖啡因就像一把钥匙，锁住了让你困的那扇门",
        input_text_clean="咖啡因 钥匙 锁住 让你困的门",
        content_type=ContentType.CONCEPT,
        template_id="whiteboard",
        broll_trigger_type=BrollTriggerType.CONCEPT_VISUAL,
        broll_trigger_pattern="就像|好比|类似于",
        visual_config=VisualConfigSnippet(
            layout_mode=LayoutMode.MODE_C,
            canvas_type=CanvasType.CONCEPT_CARD,
            canvas_config={
                "metaphor": {
                    "source": "咖啡因",
                    "target": "钥匙",
                    "action": "锁住困意之门"
                },
                "illustration": "key-lock",
                "style": "metaphor-visual"
            },
            has_broll=False
        ),
        reasoning="比喻说明使用concept-card可视化，将抽象概念具象化帮助理解。",
        quality_score=0.95,
        tags=["concept", "metaphor", "visualization"]
    ),
    
    BenchmarkSegment(
        id="006-data-02",
        source=BenchmarkSource(
            video_id="006",
            video_title="电商数据解读",
            timestamp_start=50.0,
            timestamp_end=65.0
        ),
        input_text="从用户画像来看，25-35岁的女性占比最高，达到了42%",
        input_text_clean="用户画像 25-35岁女性 占比42%",
        content_type=ContentType.DATA,
        template_id="talking-head",
        broll_trigger_type=BrollTriggerType.DATA_CITE,
        broll_trigger_pattern="占比.*%|达到.*%",
        visual_config=VisualConfigSnippet(
            layout_mode=LayoutMode.MODE_A,
            canvas_type=CanvasType.DATA_CHART,
            canvas_config={
                "type": "pie",
                "data": [
                    {"label": "25-35岁女性", "value": 42, "highlight": True},
                    {"label": "其他", "value": 58}
                ],
                "center_text": "42%"
            },
            keyword_card={
                "variant": KeywordCardVariant.LIGHT_SOLID,
                "text": "核心用户: 25-35岁女性",
                "position": "bottom-center"
            },
            has_broll=False
        ),
        reasoning="占比数据用饼图展示直观。关键词卡片补充说明核心人群特征。",
        quality_score=0.95,
        tags=["data", "pie-chart", "demographics"]
    ),
    
    # ========== 视频009: 科技预测/名人观点类 ==========
    
    BenchmarkSegment(
        id="009-quote-01",
        source=BenchmarkSource(
            video_id="009",
            video_title="马斯克谈AI未来",
            timestamp_start=0.0,
            timestamp_end=10.0
        ),
        input_text="马斯克最近说，3到5年内机器人的手术技术会超过最厉害的外科医生",
        input_text_clean="马斯克 机器人 手术 超过外科医生 3-5年",
        content_type=ContentType.QUOTE,
        template_id="talking-head",
        broll_trigger_type=BrollTriggerType.PRODUCT_MENTION,
        broll_trigger_pattern="马斯克|机器人",
        visual_config=VisualConfigSnippet(
            layout_mode=LayoutMode.MODE_B,
            keyword_card={
                "variant": KeywordCardVariant.DARK_SOLID,
                "text": "🤖 3-5年超越顶级外科医生",
                "position": "bottom-center"
            },
            has_broll=True,
            broll_description="手术机器人或马斯克演讲画面",
            pip_config={
                "type": "person",
                "position": "bottom-right",
                "size": "small"
            }
        ),
        reasoning="名人观点引用配合B-Roll展示相关画面（机器人/人物），关键词卡片强调核心预测。人物画中画保持叙事连续。",
        quality_score=0.95,
        tags=["quote", "tech-prediction", "broll", "celebrity"]
    ),
    
    BenchmarkSegment(
        id="009-concept-01",
        source=BenchmarkSource(
            video_id="009",
            video_title="马斯克谈AI未来",
            timestamp_start=15.0,
            timestamp_end=25.0
        ),
        input_text="他说机器人技术是以递归式三倍指数在增长，也就是10乘10乘10等于1000倍的速度",
        input_text_clean="递归式三倍指数 10x10x10 1000倍 增长速度",
        content_type=ContentType.DATA,
        template_id="talking-head",
        broll_trigger_type=BrollTriggerType.DATA_CITE,
        broll_trigger_pattern="10.*10.*10|1000倍|指数",
        visual_config=VisualConfigSnippet(
            layout_mode=LayoutMode.MODE_A,
            keyword_card={
                "variant": KeywordCardVariant.GRADIENT,
                "text": "📈 10×10×10 = 1000倍",
                "position": "center"
            },
            canvas_type=CanvasType.DATA_CHART,
            canvas_config={
                "type": "exponential",
                "animation": "grow",
                "label": "指数增长"
            },
            has_broll=False
        ),
        reasoning="指数增长数据用动画图表展示更直观。关键词卡片用数学公式强调倍数概念。保持人物全屏建立信任。",
        quality_score=0.95,
        tags=["data", "exponential", "growth", "tech"]
    ),
    
    BenchmarkSegment(
        id="009-example-01",
        source=BenchmarkSource(
            video_id="009",
            video_title="马斯克谈AI未来",
            timestamp_start=40.0,
            timestamp_end=50.0
        ),
        input_text="就像ChatGPT一样，从发布到1亿用户只用了2个月，这就是指数增长的力量",
        input_text_clean="ChatGPT 1亿用户 2个月 指数增长",
        content_type=ContentType.EXAMPLE,
        template_id="talking-head",
        broll_trigger_type=BrollTriggerType.PRODUCT_MENTION,
        broll_trigger_pattern="ChatGPT",
        visual_config=VisualConfigSnippet(
            layout_mode=LayoutMode.MODE_B,
            keyword_card={
                "variant": KeywordCardVariant.LIGHT_SOLID,
                "text": "🚀 2个月 → 1亿用户",
                "position": "bottom-center"
            },
            has_broll=True,
            broll_description="ChatGPT界面截图或使用场景",
            pip_config={
                "type": "person",
                "position": "bottom-right",
                "size": "small"
            }
        ),
        reasoning="产品举例触发B-Roll展示产品画面。时间+数字组合卡片强调增长速度。人物画中画保持叙事。",
        quality_score=0.95,
        tags=["example", "product", "broll", "growth"]
    ),
    
    BenchmarkSegment(
        id="009-outlook-01",
        source=BenchmarkSource(
            video_id="009",
            video_title="马斯克谈AI未来",
            timestamp_start=70.0,
            timestamp_end=85.0
        ),
        input_text="所以未来5到10年，我们可能会看到AI和机器人彻底改变人类社会的方方面面",
        input_text_clean="未来5-10年 AI机器人 改变人类社会",
        content_type=ContentType.SUMMARY,
        template_id="talking-head",
        broll_trigger_type=BrollTriggerType.CONCEPT_VISUAL,
        broll_trigger_pattern="未来|改变.*社会",
        visual_config=VisualConfigSnippet(
            layout_mode=LayoutMode.MODE_B,
            keyword_card={
                "variant": KeywordCardVariant.GRADIENT,
                "text": "🌍 AI重塑人类社会",
                "position": "center"
            },
            has_broll=True,
            broll_description="未来城市或AI科技概念画面",
            pip_config={
                "type": "person",
                "position": "bottom-left",
                "size": "medium"
            }
        ),
        reasoning="未来展望用概念化B-Roll配合宏大叙事。关键词卡片总结核心观点。画中画位置变化增加视觉节奏。",
        quality_score=0.95,
        tags=["summary", "outlook", "broll", "future"]
    ),
]


def get_seed_data() -> list[BenchmarkSegment]:
    """获取种子数据"""
    return SEED_DATA


def get_seed_count() -> int:
    """获取种子数据数量"""
    return len(SEED_DATA)


def get_by_content_type(content_type: ContentType) -> list[BenchmarkSegment]:
    """按内容类型筛选"""
    return [s for s in SEED_DATA if s.content_type == content_type]


def get_by_trigger_type(trigger_type: BrollTriggerType) -> list[BenchmarkSegment]:
    """按B-Roll触发类型筛选"""
    return [s for s in SEED_DATA if s.broll_trigger_type == trigger_type]


def get_by_template(template_id: str) -> list[BenchmarkSegment]:
    """按模版筛选"""
    return [s for s in SEED_DATA if s.template_id == template_id]
