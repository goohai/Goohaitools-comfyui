import numpy as np
import torch
from PIL import Image, ImageDraw
from nodes import PreviewImage
import comfy.utils
import matplotlib.colors as mcolors

class 孤海取色器:
    """
    孤海-取色器节点 - 输出颜色模式和颜色值
    """
    
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "模式": (["纯色", "上下渐变", "中心渐变"], {"default": "纯色"}),
                "主色": ("COLOR", {"default": "#3498db"}),
                "辅色": ("COLOR", {"default": "#e74c3c"})
            }
        }
    
    RETURN_TYPES = ("STRING", "STRING", "STRING")
    RETURN_NAMES = ("模式", "主色", "辅色")
    FUNCTION = "取色"
    CATEGORY = "孤海工具箱"
    
    def 取色(self, 模式, 主色, 辅色):
        # 标准化颜色格式为#RRGGBB
        主色 = 孤海取色器.标准化颜色(主色)
        辅色 = 孤海取色器.标准化颜色(辅色)
        
        # 直接返回模式字符串和颜色值
        return (模式, 主色, 辅色)
    
    @staticmethod
    def 标准化颜色(color):
        """确保颜色格式为#RRGGBB"""
        if isinstance(color, tuple):  # 如果输入是RGB元组
            return f"#{color[0]:02x}{color[1]:02x}{color[2]:02x}"
        
        color = str(color).lower().strip()
        
        # 处理不带#前缀的情况
        if not color.startswith("#"):
            color = f"#{color}"
        
        # 处理简写颜色格式
        if len(color) == 4:  # 例如 #abc
            return f"#{color[1]*2}{color[2]*2}{color[3]*2}"
        
        return color[:7]  # 确保长度不超过7个字符

# 节点注册映射
NODE_CLASS_MAPPINGS = {"孤海-取色器": 孤海取色器}
NODE_DISPLAY_NAME_MAPPINGS = {"孤海-取色器": "孤海-取色器"}