import os
import random
import torch

class 孤海_文件夹数量统计:
    
    def __init__(self):
        pass
    
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "文件夹路径": ("STRING", {"default": ""}),
                "seed": ("INT", {"default": 0, "min": 0, "max": 0xffffffffffffffff}),
            }
        }

    RETURN_TYPES = ("INT",)
    RETURN_NAMES = ("文件夹数量",)
    FUNCTION = "统计"
    CATEGORY = "孤海工具箱"
    
    def 统计(self, 文件夹路径, seed):
        # 更新随机种子（即使不使用，也确保每次运行都变化）
 
        
        # 检查路径有效性
        if not os.path.exists(文件夹路径):
            raise ValueError(f"路径不存在: {文件夹路径}")
        if not os.path.isdir(文件夹路径):
            raise ValueError(f"路径不是文件夹: {文件夹路径}")

        # 统计一级子文件夹
        文件夹数量 = 0
        for 条目 in os.listdir(文件夹路径):
            完整路径 = os.path.join(文件夹路径, 条目)
            if os.path.isdir(完整路径):
                文件夹数量 += 1
                
        return (文件夹数量,)
    
NODE_CLASS_MAPPINGS = {"孤海-文件夹数量统计": 孤海_文件夹数量统计}
NODE_DISPLAY_NAME_MAPPINGS = {"孤海-文件夹数量统计": "孤海-文件夹数量统计"}