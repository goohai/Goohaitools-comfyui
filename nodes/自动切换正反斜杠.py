import os
from platform import system
import comfy

class SlashConverter:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "folder_path": ("STRING", {"default": "", "multiline": False}),
            }
        }
    
    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("路径",)
    FUNCTION = "convert_slash"
    CATEGORY = "孤海工具箱"

    def convert_slash(self, folder_path):
        # 空路径直接返回
        if not folder_path:
            return (folder_path,)
        
        # 检查路径是否包含任何斜杠
        has_slash = '/' in folder_path
        has_backslash = '\\' in folder_path
        
        # 无斜杠则原样返回
        if not (has_slash or has_backslash):
            return (folder_path,)
        
        # 获取操作系统类型
        os_name = system().lower()
        
        # 根据系统类型处理路径
        if 'win' in os_name:  # Windows系统
            # 替换正斜杠为反斜杠
            converted_path = folder_path.replace('/', '\\')
            # 处理可能的双反斜杠情况
            converted_path = converted_path.replace('\\\\', '\\')
        else:  # Linux/Mac系统
            # 替换反斜杠为正斜杠
            converted_path = folder_path.replace('\\', '/')
            # 处理可能的双斜杠情况
            converted_path = converted_path.replace('//', '/')
        
        return (converted_path,)

# 节点描述
NODE_CLASS_MAPPINGS = {"SlashConverter": SlashConverter}
NODE_DISPLAY_NAME_MAPPINGS = {"SlashConverter": "孤海-自动切换正反斜杠"}

