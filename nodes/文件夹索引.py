import os
import platform
import comfy

class 孤海_文件夹索引:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "文件夹路径": ("STRING", {"default": ""}),
                "起始索引": ("INT", {"default": 0, "min": 0, "step": 1}),
                "处理总数": ("INT", {"default": 0, "min": 0, "step": 1}),
            }
        }

    RETURN_TYPES = ("STRING", "INT", "STRING")
    RETURN_NAMES = ("子目录", "目录总数", "路径")
    FUNCTION = "获取目录信息"
    CATEGORY = "孤海工具箱"

    def 获取目录信息(self, 文件夹路径, 起始索引, 处理总数):
        # 检查文件夹路径有效性
        if not os.path.exists(文件夹路径):
            raise ValueError(f"路径不存在: {文件夹路径}")
        if not os.path.isdir(文件夹路径):
            raise ValueError(f"不是有效目录: {文件夹路径}")
        
        # 获取所有直接子目录
        所有子目录 = []
        for item in os.listdir(文件夹路径):
            item_path = os.path.join(文件夹路径, item)
            if os.path.isdir(item_path):
                所有子目录.append(item)
        
        所有子目录.sort()  # 按名称排序
        
        # 计算实际目录总数
        实际目录数 = len(所有子目录)
        目录总数 = 实际目录数 if 处理总数 == 0 else 处理总数
        
        # 获取指定索引的子目录（支持循环索引）
        子目录名 = ""
        完整路径 = ""
        if 所有子目录:
            循环索引 = 起始索引 % 实际目录数  # 超出范围时循环
            子目录名 = 所有子目录[循环索引]
            
            # 构建完整路径并根据操作系统调整分隔符
            路径 = os.path.join(文件夹路径, 子目录名)
            if platform.system() == "Windows":
                # Windows使用反斜杠
                完整路径 = 路径.replace("/", "\\")
            else:
                # Linux/Mac使用正斜杠
                完整路径 = 路径.replace("\\", "/")
        elif 起始索引 == 0:
            # 空文件夹且索引为0时允许继续
            子目录名 = ""
            完整路径 = ""
        else:
            # 索引超出范围且文件夹为空时给出警告
            print(f"⚠️ 警告: 索引 {起始索引} 超出范围 (目录为空)")
            
        return (子目录名, 目录总数, 完整路径)

NODE_CLASS_MAPPINGS = {"孤海-文件夹索引": 孤海_文件夹索引}
NODE_DISPLAY_NAME_MAPPINGS = {"孤海-文件夹索引": "孤海-文件夹索引"}