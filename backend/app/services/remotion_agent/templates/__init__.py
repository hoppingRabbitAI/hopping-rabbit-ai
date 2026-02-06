"""
模版系统

管理知识类博主的内容呈现风格模版
"""

from .base import TemplateConfig, get_template, get_all_templates
from .whiteboard import whiteboard_template
from .talking_head import talking_head_template

__all__ = [
    "TemplateConfig",
    "get_template",
    "get_all_templates",
    "whiteboard_template",
    "talking_head_template",
]
