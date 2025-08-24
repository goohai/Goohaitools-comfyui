# -*- coding: utf-8 -*-
import torch
import numpy as np
from PIL import Image
import cv2

class 孤海遮罩模糊生长按比例:

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "遮罩": ("MASK",),
                "生长百分比": ("FLOAT", {"default": 0.0, "min": -500.0, "max": 1000.0, "step": 0.1}),
                "模糊百分比": ("FLOAT", {"default": 0.0, "min": 0.0, "max": 500.0, "step": 0.1}),
                "填充孔洞": ("BOOLEAN", {"default": False}),
                "圆角模式": ("BOOLEAN", {"default": False}),
            }
        }

    RETURN_TYPES = ("MASK", "MASK")
    RETURN_NAMES = ("遮罩", "反转遮罩")
    FUNCTION = "处理"
    CATEGORY = "孤海工具箱"

    def 处理(self, 遮罩, 生长百分比, 模糊百分比, 填充孔洞, 圆角模式):
        # 转换张量为numpy数组
        遮罩数组 = 遮罩.cpu().numpy().squeeze() * 255
        图像 = Image.fromarray(遮罩数组.astype(np.uint8))
        宽度, 高度 = 图像.size

        # 转换为OpenCV二值图像
        opencv图像 = np.array(图像)
        _, 二值图 = cv2.threshold(opencv图像, 127, 255, cv2.THRESH_BINARY)

        # 计算白色区域实际宽度
        白色像素 = np.where(二值图 == 255)
        if len(白色像素[1]) > 0:
            最小x = np.min(白色像素[1])
            最大x = np.max(白色像素[1])
            白区宽度 = 最大x - 最小x + 1  # 包含边缘像素
        else:
            白区宽度 = 0

        # 计算实际操作像素值
        生长像素 = int(白区宽度 * abs(生长百分比) / 100)
        模糊像素 = int(白区宽度 * 模糊百分比 / 100)
        操作类型 = cv2.MORPH_DILATE if 生长百分比 > 0 else cv2.MORPH_ERODE

        # 形态学操作内核
        内核类型 = cv2.MORPH_ELLIPSE if 圆角模式 else cv2.MORPH_RECT
        if 生长像素 > 0:
            内核 = cv2.getStructuringElement(内核类型, (3, 3))
            二值图 = cv2.morphologyEx(二值图, 操作类型, 内核, iterations=生长像素)

        # 填充孔洞处理
        if 填充孔洞:
            填充内核 = cv2.getStructuringElement(内核类型, (5, 5))
            二值图 = cv2.morphologyEx(二值图, cv2.MORPH_CLOSE, 填充内核)

        # 自适应高斯模糊
        if 模糊像素 > 0:
            模糊尺寸 = 模糊像素 + 1 if 模糊像素 % 2 == 0 else 模糊像素
            二值图 = cv2.GaussianBlur(二值图, (模糊尺寸, 模糊尺寸), 0)

        # 转换回遮罩格式
        结果遮罩 = torch.from_numpy(二值图.astype(np.float32) / 255.0).unsqueeze(0)
        return (结果遮罩, 1.0 - 结果遮罩)

NODE_CLASS_MAPPINGS = {"GH_MaskGrowthBlur": 孤海遮罩模糊生长按比例}
NODE_DISPLAY_NAME_MAPPINGS = {"GH_MaskGrowthBlur": "孤海遮罩模糊生长按比例"}