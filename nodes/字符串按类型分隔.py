import re
from typing import Any

class 字符串按类型分隔_孤海:
    """
    将字符串按照不同类型字符的边界进行分隔
        """
    
    @classmethod
    def INPUT_TYPES(cls) -> dict:
        return {
            "required": {
                "字符串": ("STRING", {
                    "multiline": False,
                    "default": "",
                    "placeholder": "请输入字符串"
                }),
                "分隔符": ("STRING", {
                    "default": " ",
                    "placeholder": "分隔符，默认为空格"
                }),
                "分隔类型": ([
                    "中文+数字",
                    "中文+英文", 
                    "英文+数字",
                    "英文+中文",
                    "数字+中文", 
                    "数字+英文"
                ], {
                    "default": "中文+数字"
                }),
            }
        }
    
    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("字符串",)
    FUNCTION = "process"
    CATEGORY = "孤海工具箱"
    
    def process(self, 字符串: str, 分隔符: str, 分隔类型: str) -> tuple:
        """处理字符串分隔逻辑"""
        
        # 定义字符类型判断函数
        def is_chinese(char: str) -> bool:
            """判断是否为中文字符"""
            return '\u4e00' <= char <= '\u9fff' or '\u3400' <= char <= '\u4DBF'
        
        def is_english(char: str) -> bool:
            """判断是否为英文字母"""
            return 'a' <= char.lower() <= 'z'
        
        def is_digit(char: str) -> bool:
            """判断是否为数字"""
            return '0' <= char <= '9'
        
        def get_char_type(char: str) -> str:
            """获取字符类型"""
            if is_chinese(char):
                return "中文"
            elif is_english(char):
                return "英文"
            elif is_digit(char):
                return "数字"
            return "其他"
        
        # 根据分隔类型确定要分隔的类型对
        类型对 = 分隔类型.split("+")
        if len(类型对) != 2:
            return (字符串,)
        
        类型1, 类型2 = 类型对
        
        # 处理字符串
        if len(字符串) < 2:
            return (字符串,)
        
        结果 = 字符串[0]
        
        for i in range(1, len(字符串)):
            前一个字符 = 字符串[i-1]
            当前字符 = 字符串[i]
            
            # 获取前一个字符和当前字符的类型
            前类型 = get_char_type(前一个字符)
            当前类型 = get_char_type(当前字符)
            
            # 检查是否需要插入分隔符
            if (前类型 == 类型1 and 当前类型 == 类型2) or (前类型 == 类型2 and 当前类型 == 类型1):
                # 但只有当前类型=类型1且当前类型=类型2时才插入（按指定顺序）
                if 前类型 == 类型1 and 当前类型 == 类型2:
                    结果 += 分隔符 + 当前字符
                else:
                    # 如果不是指定顺序，则不插入分隔符
                    结果 += 当前字符
            else:
                结果 += 当前字符
        
        return (结果,)

# 节点注册映射
NODE_CLASS_MAPPINGS = {
    "字符串按类型分隔_孤海": 字符串按类型分隔_孤海
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "字符串按类型分隔_孤海": "字符串按类型分隔 孤海"
}