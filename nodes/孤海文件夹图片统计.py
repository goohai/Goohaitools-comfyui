# -*- coding: utf-8 -*-
# 孤海文件夹图片统计节点 - 随机种子刷新版
import os
import random

IMAGE_EXTS = {'.jpg', '.jpeg', '.png', '.webp', '.bmp', '.tiff','.tif', '.gif'}

class LoneSeaImageCounter:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "folder_path": ("STRING", {"default": "", "multiline": False}),
                "include_subdirs": ("BOOLEAN", {"default": False,
                     "label_on": "包含子文件夹",
                     "label_off": "包含子文件夹"
               }),
                "seed": ("INT", {"default": 0, "min": 0, "max": 0xffffffffffffffff}),
            },
        }

    RETURN_TYPES = ("INT",)
    RETURN_NAMES = ("图片数量",)
    FUNCTION = "count_images"
    CATEGORY = "孤海工具箱"

    def count_images(self, folder_path, include_subdirs, seed):
        # 随机种子不参与实际计算，仅用于触发刷新
        # 实际统计逻辑开始
        clean_path = folder_path.strip()
        if not clean_path:
            return (0,)

        try:
            count = 0
            if include_subdirs:
                for root, _, files in os.walk(clean_path):
                    count += sum(1 for f in files if os.path.splitext(f)[1].lower() in IMAGE_EXTS)
            else:
                with os.scandir(clean_path) as entries:
                    count = sum(1 for entry in entries if entry.is_file() 
                                and os.path.splitext(entry.name)[1].lower() in IMAGE_EXTS)
        except Exception as e:
            print(f"【孤海统计】路径错误: {str(e)}")
            return (0,)

        return (count,)

NODE_CLASS_MAPPINGS = {
    "LoneSeaImageCounter": LoneSeaImageCounter
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "LoneSeaImageCounter": "📁孤海文件夹图片统计"
}