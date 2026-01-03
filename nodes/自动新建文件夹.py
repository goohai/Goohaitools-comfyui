import os
from pathlib import Path
import comfy

class GuHaiCreateAutoFolder:
    def __init__(self):
        pass

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "图片路径": ("STRING", {"default": ""}),
                "输入路径": ("STRING", {"default": ""}),
                "输出路径": ("STRING", {"default": ""}),
            }
        }

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("output_path",)
    FUNCTION = "create_folder"
    CATEGORY = "孤海工具箱"

    def get_separator(self, path_str):
        """根据路径字符串确定分隔符"""
        return '\\' if '\\' in path_str else '/'

    def normalize_path(self, path_str, separator):
        """统一路径分隔符并处理空值"""
        if not path_str:
            return ""
        return path_str.replace('/', separator).replace('\\', separator).rstrip(separator)

    def create_folder(self, 图片路径, 输入路径, 输出路径):
        # 确定使用的分隔符
        sep = self.get_separator(图片路径) if 图片路径 else self.get_separator(输入路径)

        # 标准化所有路径
        a = self.normalize_path(图片路径, sep)
        b = self.normalize_path(输入路径, sep)
        c = self.normalize_path(输出路径, sep)

        # 处理边界情况
        if not a or not b or not c:
            return (c + sep,)

        # 构造比较路径
        compare_b = b + sep if b and not b.endswith(sep) else b
        
        # 计算相对路径
        if a.startswith(compare_b):
            relative_path = a[len(compare_b):]
        elif a == b:
            relative_path = ""
        else:
            return (c + sep,)

        # 构造完整输出路径
        final_path = sep.join([c, relative_path]) if relative_path else c

        # 转换系统路径格式并创建目录
        system_path = final_path.replace(sep, os.sep)
        Path(system_path).mkdir(parents=True, exist_ok=True)

        # 统一输出路径格式
        formatted_path = final_path.replace('/', sep).replace('\\', sep)
        return (formatted_path + (sep if not formatted_path else ""), )

# 节点注册
NODE_CLASS_MAPPINGS = {
    "GuHaiCreateAutoFolder": GuHaiCreateAutoFolder
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "GuHaiCreateAutoFolder": "孤海自动新建文件夹"
}