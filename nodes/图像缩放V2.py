from PIL import Image
import numpy as np
import torch
from collections import Counter
import math

class 图像缩放V2_孤海:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "图像": ("IMAGE",),
                "宽度": ("INT", {"default": 512, "min": 0, "max": 100000}),
                "高度": ("INT", {"default": 512, "min": 0, "max": 100000}),
                "缩放方法": (["按长边等比例", "按短边等比例", "自定义宽高"], {"default": "按长边等比例"}),
                "将边缩放到": ("INT", {"default": 1024, "min": 64, "max": 100000}),
                "缩放插值": (["双线性插值", "双三次插值", "区域", "邻近-精确", "Lanczos"], {"default": "Lanczos"}),
                "缩放模式": (["拉伸", "裁剪", "填充_自定颜色", "填充_边框颜色", "填充_边缘像素", "总像素_等比例"], {"default": "裁剪"}),
                "固定方向": (["居中", "上", "下", "左", "右"], {"default": "居中"}),
                "执行条件": (["总是", "最长边大于时", "最小边小于时"], {"default": "总是"}),
                "填充颜色": ("COLORCODE", {"default": "#364254"}),
                "整除数": ("INT", {"default": 0, "min": 0, "max": 256}),
            },
            "optional": {
                "遮罩": ("MASK",),
            }
        }

    RETURN_TYPES = ("IMAGE", "INT", "INT", "MASK")
    RETURN_NAMES = ("图像", "宽度", "高度", "遮罩")
    FUNCTION = "执行缩放"
    CATEGORY = "孤海工具箱"

    def 执行缩放(self, 图像, 缩放方法, 宽度, 高度, 将边缩放到, 缩放插值, 缩放模式, 固定方向, 执行条件, 填充颜色, 整除数, 遮罩=None):
        # 处理批次图像
        batch_size = 图像.shape[0]
        原高度, 原宽度 = 图像.shape[1], 图像.shape[2]
        
        # 处理输入遮罩
        if 遮罩 is not None:
            mask_batch_size = 遮罩.shape[0]
            # 如果遮罩批次大小与图像不匹配，调整遮罩
            if mask_batch_size != batch_size:
                if mask_batch_size == 1:
                    遮罩 = 遮罩.repeat(batch_size, 1, 1)
                else:
                    raise ValueError(f"遮罩批次大小({mask_batch_size})与图像批次大小({batch_size})不匹配")
        else:
            # 创建默认遮罩
            遮罩 = torch.zeros((batch_size, 原高度, 原宽度), dtype=torch.float32)
        
        # 存储处理后的结果
        processed_images = []
        processed_masks = []
        最终宽度, 最终高度 = 0, 0
        
        # 对批次中的每张图像单独处理
        for i in range(batch_size):
            img_tensor = 图像[i].unsqueeze(0)  # 保持4D张量格式
            mask_tensor = 遮罩[i].unsqueeze(0) if 遮罩 is not None else None
            
            # 处理单张图像
            result = self.处理单张图像(
                img_tensor, mask_tensor, 缩放方法, 宽度, 高度, 将边缩放到, 
                缩放插值, 缩放模式, 固定方向, 执行条件, 填充颜色, 整除数
            )
            
            processed_images.append(result[0])
            processed_masks.append(result[3])
            
            # 记录最终尺寸（批次中所有图像应该相同）
            if i == 0:
                最终宽度, 最终高度 = result[1], result[2]
        
        # 合并批次结果
        output_images = torch.cat(processed_images, dim=0)
        output_masks = torch.cat(processed_masks, dim=0)
        
        return (output_images, 最终宽度, 最终高度, output_masks)

    def 处理单张图像(self, 图像, 遮罩, 缩放方法, 宽度, 高度, 将边缩放到, 缩放插值, 缩放模式, 固定方向, 执行条件, 填充颜色, 整除数):
        """处理单张图像的缩放逻辑"""
        img = self.tensor2pil(图像)
        原宽度, 原高度 = img.size
        
        # 处理输入遮罩
        if 遮罩 is not None:
            mask_pil = self.tensor2mask(遮罩)
            if mask_pil.size != (原宽度, 原高度):
                mask_pil = mask_pil.resize((原宽度, 原高度), Image.NEAREST)
        else:
            mask_pil = Image.new("L", (原宽度, 原高度), 0)

        # 执行条件判断
        最长边 = max(原宽度, 原高度)
        最短边 = min(原宽度, 原高度)
        需要缩放 = True
        
        if 执行条件 == "最长边大于时" and 最长边 <= 将边缩放到:
            需要缩放 = False
        elif 执行条件 == "最小边小于时" and 最短边 >= 将边缩放到:
            需要缩放 = False
        
        # 应用整除数要求（在缩放前处理）
        def 应用整除(目标宽, 目标高):
            if 整除数 > 1:
                目标宽 = (目标宽 // 整除数) * 整除数
                目标高 = (目标高 // 整除数) * 整除数
                # 确保最小尺寸为整除数
                目标宽 = max(整除数, 目标宽)
                目标高 = max(整除数, 目标高)
            return 目标宽, 目标高
        
        if 需要缩放:
            if 缩放方法 == "按长边等比例":
                比例 = 将边缩放到 / 最长边
                新宽度 = round(原宽度 * 比例)
                新高度 = round(原高度 * 比例)
                # 应用整除数要求
                新宽度, 新高度 = 应用整除(新宽度, 新高度)
                img, mask_pil = self.调整尺寸(img, mask_pil, 新宽度, 新高度, 缩放插值)
                
            elif 缩放方法 == "按短边等比例":
                比例 = 将边缩放到 / 最短边
                新宽度 = round(原宽度 * 比例)
                新高度 = round(原高度 * 比例)
                # 应用整除数要求
                新宽度, 新高度 = 应用整除(新宽度, 新高度)
                img, mask_pil = self.调整尺寸(img, mask_pil, 新宽度, 新高度, 缩放插值)
                
            else:  # 自定义宽高模式
                # 特殊处理：当其中一个尺寸为0时，保持原始比例
                if 宽度 == 0 and 高度 != 0:
                    比例 = 高度 / 原高度
                    新宽度 = round(原宽度 * 比例)
                    新高度 = 高度
                elif 高度 == 0 and 宽度 != 0:
                    比例 = 宽度 / 原宽度
                    新宽度 = 宽度
                    新高度 = round(原高度 * 比例)
                else:
                    新宽度, 新高度 = 宽度, 高度
                
                # 应用整除数要求（在缩放操作前）
                新宽度, 新高度 = 应用整除(新宽度, 新高度)
                
                if 缩放模式 == "拉伸":
                    img, mask_pil = self.调整尺寸(img, mask_pil, 新宽度, 新高度, 缩放插值)
                elif 缩放模式 == "裁剪":
                    img, mask_pil = self.居中裁剪(img, mask_pil, 新宽度, 新高度, 缩放插值, 固定方向)
                elif 缩放模式 == "填充_自定颜色":
                    img, mask_pil = self.智能填充(img, mask_pil, 新宽度, 新高度, 缩放插值, 填充颜色, 固定方向)
                elif 缩放模式 == "填充_边框颜色":
                    img, mask_pil = self.边框颜色填充(img, mask_pil, 新宽度, 新高度, 缩放插值, 固定方向)
                elif 缩放模式 == "填充_边缘像素":
                    img, mask_pil = self.边缘像素填充(img, mask_pil, 新宽度, 新高度, 缩放插值, 固定方向)
                else:  # 总像素_等比例
                    # 检查宽度和高度是否都为0
                    if 宽度 == 0 or 高度 == 0:
                        raise ValueError("总像素_等比例模式下，在保持原始比例的前提下新图像宽x高≈自定义的宽x高，因此输入的宽高值都不能为0，请重新输入")
                    
                    img, mask_pil, 新宽度, 新高度 = self.总像素等比例(img, mask_pil, 宽度, 高度, 缩放插值, 整除数)
        else:
            # 不需要缩放时，直接应用整除数要求
            新宽度, 新高度 = 原宽度, 原高度
            if 整除数 > 1:
                整除宽度 = (原宽度 // 整除数) * 整除数
                整除高度 = (原高度 // 整除数) * 整除数
                整除宽度 = max(整除数, 整除宽度)
                整除高度 = max(整除数, 整除高度)
                
                if 整除宽度 < 原宽度 or 整除高度 < 原高度:
                    # 根据固定方向进行裁剪
                    左边, 顶边, 右边, 底边 = self.计算裁剪区域(原宽度, 原高度, 整除宽度, 整除高度, 固定方向)
                    
                    img = img.crop((左边, 顶边, 右边, 底边))
                    mask_pil = mask_pil.crop((左边, 顶边, 右边, 底边))
                    新宽度, 新高度 = 整除宽度, 整除高度

        img_tensor = self.pil2tensor(img)
        mask_tensor = self.pil2mask(mask_pil)

        return (img_tensor, 新宽度, 新高度, mask_tensor)

    def 调整尺寸(self, img, mask, 宽度, 高度, 插值方法):
        插值映射 = {
            "双线性插值": Image.BILINEAR,
            "双三次插值": Image.BICUBIC,
            "邻近-精确": Image.NEAREST,
            "Lanczos": Image.LANCZOS,
            "区域": Image.BOX
        }
        return (
            img.resize((宽度, 高度), 插值映射.get(插值方法, Image.LANCZOS)),
            mask.resize((宽度, 高度), 插值映射.get(插值方法, Image.NEAREST))
        )

    def 计算裁剪区域(self, 原宽度, 原高度, 目标宽度, 目标高度, 固定方向):
        """计算裁剪区域，根据固定方向决定裁剪位置"""
        if 固定方向 == "居中":
            左边 = (原宽度 - 目标宽度) // 2
            顶边 = (原高度 - 目标高度) // 2
        elif 固定方向 == "上":
            左边 = (原宽度 - 目标宽度) // 2
            顶边 = 0
        elif 固定方向 == "下":
            左边 = (原宽度 - 目标宽度) // 2
            顶边 = 原高度 - 目标高度
        elif 固定方向 == "左":
            左边 = 0
            顶边 = (原高度 - 目标高度) // 2
        elif 固定方向 == "右":
            左边 = 原宽度 - 目标宽度
            顶边 = (原高度 - 目标高度) // 2
        
        右边 = 左边 + 目标宽度
        底边 = 顶边 + 目标高度
        return 左边, 顶边, 右边, 底边

    def 计算填充位置(self, 目标宽度, 目标高度, 图像宽度, 图像高度, 固定方向):
        """计算填充位置，根据固定方向决定图像放置位置"""
        if 固定方向 == "居中":
            左边 = (目标宽度 - 图像宽度) // 2
            顶边 = (目标高度 - 图像高度) // 2
        elif 固定方向 == "上":
            左边 = (目标宽度 - 图像宽度) // 2
            顶边 = 0
        elif 固定方向 == "下":
            左边 = (目标宽度 - 图像宽度) // 2
            顶边 = 目标高度 - 图像高度
        elif 固定方向 == "左":
            左边 = 0
            顶边 = (目标高度 - 图像高度) // 2
        elif 固定方向 == "右":
            左边 = 目标宽度 - 图像宽度
            顶边 = (目标高度 - 图像高度) // 2
        
        return 左边, 顶边

    def 居中裁剪(self, img, mask, 目标宽度, 目标高度, 插值方法, 固定方向):
        # 计算需要缩放的尺寸以覆盖目标区域
        宽比 = 目标宽度 / img.width
        高比 = 目标高度 / img.height
        比例 = max(宽比, 高比)
        
        缩放宽度 = round(img.width * 比例)
        缩放高度 = round(img.height * 比例)
        
        img_scaled = img.resize((缩放宽度, 缩放高度), self.获取插值方法(插值方法))
        mask_scaled = mask.resize((缩放宽度, 缩放高度), self.获取插值方法(插值方法))
        
        # 根据固定方向进行裁剪
        左边, 顶边, 右边, 底边 = self.计算裁剪区域(缩放宽度, 缩放高度, 目标宽度, 目标高度, 固定方向)
        
        return (
            img_scaled.crop((左边, 顶边, 右边, 底边)),
            mask_scaled.crop((左边, 顶边, 右边, 底边))
        )

    def 智能填充(self, img, mask, 目标宽度, 目标高度, 插值方法, 颜色, 固定方向):
        # 保持原始比例缩放
        宽比 = 目标宽度 / img.width
        高比 = 目标高度 / img.height
        比例 = min(宽比, 高比)
        
        新宽度 = round(img.width * 比例)
        新高度 = round(img.height * 比例)
        
        img_scaled = img.resize((新宽度, 新高度), self.获取插值方法(插值方法))
        mask_scaled = mask.resize((新宽度, 新高度), self.获取插值方法(插值方法))
        
        # 创建新图像并放置缩放后的图像
        new_img = Image.new("RGB", (目标宽度, 目标高度), color=颜色)
        new_mask = Image.new("L", (目标宽度, 目标高度), color=0)
        
        左边, 顶边 = self.计算填充位置(目标宽度, 目标高度, 新宽度, 新高度, 固定方向)
        
        new_img.paste(img_scaled, (左边, 顶边))
        new_mask.paste(mask_scaled, (左边, 顶边))
        
        return new_img, new_mask

    def 边框颜色填充(self, img, mask, 目标宽度, 目标高度, 插值方法, 固定方向):
        # 保持原始比例缩放
        宽比 = 目标宽度 / img.width
        高比 = 目标高度 / img.height
        比例 = min(宽比, 高比)
        
        新宽度 = round(img.width * 比例)
        新高度 = round(img.height * 比例)
        
        img_scaled = img.resize((新宽度, 新高度), self.获取插值方法(插值方法))
        mask_scaled = mask.resize((新宽度, 新高度), self.获取插值方法(插值方法))
        
        # 计算需要填充的区域
        左边, 顶边 = self.计算填充位置(目标宽度, 目标高度, 新宽度, 新高度, 固定方向)
        
        # 根据固定方向确定需要填充的边
        需要填充左边 = 左边 > 0
        需要填充右边 = 左边 + 新宽度 < 目标宽度
        需要填充上边 = 顶边 > 0
        需要填充下边 = 顶边 + 新高度 < 目标高度
        
        # 计算填充颜色
        填充颜色 = self.计算边框颜色(img_scaled, 需要填充左边, 需要填充右边, 需要填充上边, 需要填充下边)
        
        # 创建新图像并放置缩放后的图像
        new_img = Image.new("RGB", (目标宽度, 目标高度), color=填充颜色)
        new_mask = Image.new("L", (目标宽度, 目标高度), color=0)
        
        new_img.paste(img_scaled, (左边, 顶边))
        new_mask.paste(mask_scaled, (左边, 顶边))
        
        return new_img, new_mask

    def 计算边框颜色(self, img, 需要填充左边, 需要填充右边, 需要填充上边, 需要填充下边):
        """计算边框颜色，取需要填充一侧的边缘颜色的平均值"""
        img_array = np.array(img)
        高度, 宽度, _ = img_array.shape
        
        # 收集边缘像素
        边缘像素 = []
        
        if 需要填充左边:
            边缘像素.extend(img_array[:, 0, :])  # 最左边一列
        if 需要填充右边:
            边缘像素.extend(img_array[:, -1, :])  # 最右边一列
        if 需要填充上边:
            边缘像素.extend(img_array[0, :, :])  # 最上边一行
        if 需要填充下边:
            边缘像素.extend(img_array[-1, :, :])  # 最下边一行
        
        if not 边缘像素:
            return "#ffffff"  # 默认白色
        
        # 转换为RGB元组
        rgb_pixels = [tuple(pixel) for pixel in 边缘像素]
        
        # 计算主要颜色（去除异常值）
        主要颜色 = self.计算主要颜色(rgb_pixels)
        
        return "#{:02x}{:02x}{:02x}".format(主要颜色[0], 主要颜色[1], 主要颜色[2])

    def 计算主要颜色(self, rgb_pixels):
        """计算主要颜色，去除异常值"""
        if not rgb_pixels:
            return (255, 255, 255)
        
        # 计算每个颜色的出现频率
        颜色计数 = Counter(rgb_pixels)
        
        # 取出现频率最高的前20%的颜色
        主要颜色数量 = max(1, len(颜色计数) // 5)
        主要颜色列表 = 颜色计数.most_common(主要颜色数量)
        
        # 计算这些主要颜色的平均值
        r_sum, g_sum, b_sum = 0, 0, 0
        total_weight = 0
        
        for (r, g, b), count in 主要颜色列表:
            r_sum += r * count
            g_sum += g * count
            b_sum += b * count
            total_weight += count
        
        if total_weight == 0:
            return (255, 255, 255)
        
        return (
            int(r_sum / total_weight),
            int(g_sum / total_weight),
            int(b_sum / total_weight)
        )

    def 边缘像素填充(self, img, mask, 目标宽度, 目标高度, 插值方法, 固定方向):
        # 保持原始比例缩放
        宽比 = 目标宽度 / img.width
        高比 = 目标高度 / img.height
        比例 = min(宽比, 高比)
        
        新宽度 = round(img.width * 比例)
        新高度 = round(img.height * 比例)
        
        img_scaled = img.resize((新宽度, 新高度), self.获取插值方法(插值方法))
        mask_scaled = mask.resize((新宽度, 新高度), self.获取插值方法(插值方法))
        
        # 计算需要填充的位置
        左边, 顶边 = self.计算填充位置(目标宽度, 目标高度, 新宽度, 新高度, 固定方向)
        
        # 创建新图像
        new_img = Image.new("RGB", (目标宽度, 目标高度))
        new_mask = Image.new("L", (目标宽度, 目标高度), color=0)
        
        # 放置缩放后的图像
        new_img.paste(img_scaled, (左边, 顶边))
        new_mask.paste(mask_scaled, (左边, 顶边))
        
        # 修复：传递正确的参数（新宽度和新高度）
        new_img = self.扩展边缘像素(new_img, 左边, 顶边, 新宽度, 新高度)
        
        return new_img, new_mask

    def 扩展边缘像素(self, img, 左边, 顶边, 图像宽度, 图像高度):
        """扩展边缘像素，将每个边缘像素向外扩展"""
        img_array = np.array(img)
        目标高度, 目标宽度, _ = img_array.shape
        
        # 创建扩展后的图像
        extended_img = img_array.copy()
        
        # 扩展左边
        if 左边 > 0:
            for x in range(左边):
                for y in range(顶边, 顶边 + 图像高度):
                    if y < 目标高度:
                        extended_img[y, x] = img_array[y, 左边]
        
        # 扩展右边
        右边 = 左边 + 图像宽度
        if 右边 < 目标宽度:
            for x in range(右边, 目标宽度):
                for y in range(顶边, 顶边 + 图像高度):
                    if y < 目标高度:
                        extended_img[y, x] = img_array[y, 右边 - 1]
        
        # 扩展上边
        if 顶边 > 0:
            for y in range(顶边):
                for x in range(左边, 左边 + 图像宽度):
                    if x < 目标宽度:
                        extended_img[y, x] = img_array[顶边, x]
        
        # 扩展下边
        底边 = 顶边 + 图像高度
        if 底边 < 目标高度:
            for y in range(底边, 目标高度):
                for x in range(左边, 左边 + 图像宽度):
                    if x < 目标宽度:
                        extended_img[y, x] = img_array[底边 - 1, x]
        
        return Image.fromarray(extended_img)

    def 总像素等比例(self, img, mask, 目标宽度, 目标高度, 插值方法, 整除数):
        """
        总像素等比例缩放模式
        缩放后的图像宽*高总像素与用户自定义设置的宽*高总像素接近
        保持原始宽高比，不拉伸变形，不填充
        """
        原宽度, 原高度 = img.size
        原比例 = 原宽度 / 原高度
        目标总像素 = 目标宽度 * 目标高度
        
        # 计算保持原始比例的目标尺寸
        # 根据原比例计算最接近目标总像素的尺寸
        新高度 = int(math.sqrt(目标总像素 / 原比例))
        新宽度 = int(新高度 * 原比例)
        
        # 检查计算出的总像素是否接近目标总像素
        计算总像素 = 新宽度 * 新高度
        
        # 如果计算出的总像素与目标总像素差异较大，尝试调整
        if abs(计算总像素 - 目标总像素) > 目标总像素 * 0.1:  # 差异超过10%
            # 尝试调整高度±1像素来找到更接近的总像素
            候选尺寸 = []
            for h_offset in [-1, 0, 1]:
                候选高度 = 新高度 + h_offset
                if 候选高度 <= 0:
                    continue
                候选宽度 = int(候选高度 * 原比例)
                if 候选宽度 <= 0:
                    continue
                候选总像素 = 候选宽度 * 候选高度
                候选尺寸.append((候选宽度, 候选高度, abs(候选总像素 - 目标总像素)))
            
            # 选择最接近目标总像素的尺寸
            候选尺寸.sort(key=lambda x: x[2])
            新宽度, 新高度, _ = 候选尺寸[0]
        
        # 应用整除数要求 - 这是关键修改部分
        if 整除数 > 1:
            # 确保宽度和高度都是整除数的整数倍
            新宽度 = (新宽度 // 整除数) * 整除数
            新高度 = (新高度 // 整除数) * 整除数
            
            # 确保最小尺寸为整除数
            新宽度 = max(整除数, 新宽度)
            新高度 = max(整除数, 新高度)
            
            # 检查调整后的比例是否接近原比例
            新比例 = 新宽度 / 新高度
            比例差异 = abs(新比例 - 原比例) / 原比例
            
            # 如果比例差异太大，尝试调整尺寸以保持更好的比例
            if 比例差异 > 0.1:  # 比例差异超过10%
                # 尝试在保持整除数的前提下找到更接近原比例的尺寸
                候选尺寸 = []
                新总像素 = 新宽度 * 新高度
                
                # 尝试不同的宽度倍数
                for w_mult in range(max(1, 新宽度 // 整除数 - 2), 新宽度 // 整除数 + 3):
                    候选宽度 = w_mult * 整除数
                    if 候选宽度 <= 0:
                        continue
                    
                    # 根据原比例计算高度
                    候选高度 = int(候选宽度 / 原比例)
                    # 对高度应用整除数
                    候选高度 = (候选高度 // 整除数) * 整除数
                    候选高度 = max(整除数, 候选高度)
                    
                    # 计算总像素和比例差异
                    候选总像素 = 候选宽度 * 候选高度
                    候选比例 = 候选宽度 / 候选高度
                    比例差异 = abs(候选比例 - 原比例) / 原比例
                    总像素差异 = abs(候选总像素 - 新总像素) / 新总像素
                    
                    # 综合评分（比例差异权重更高）
                    综合评分 = 比例差异 * 0.7 + 总像素差异 * 0.3
                    候选尺寸.append((候选宽度, 候选高度, 综合评分, 候选总像素))
                
                # 选择综合评分最好的尺寸
                if 候选尺寸:
                    候选尺寸.sort(key=lambda x: x[2])
                    新宽度, 新高度, _, _ = 候选尺寸[0]
        
        # 等比例缩放图像
        宽比 = 新宽度 / 原宽度
        高比 = 新高度 / 原高度
        比例 = min(宽比, 高比)  # 使用较小比例确保图像不被拉伸
        
        缩放宽度 = round(原宽度 * 比例)
        缩放高度 = round(原高度 * 比例)
        
        img_scaled = img.resize((缩放宽度, 缩放高度), self.获取插值方法(插值方法))
        mask_scaled = mask.resize((缩放宽度, 缩放高度), self.获取插值方法(插值方法))
        
        # 如果缩放后的尺寸与目标尺寸不一致，进行居中裁剪
        if 缩放宽度 != 新宽度 or 缩放高度 != 新高度:
            左边 = (缩放宽度 - 新宽度) // 2
            顶边 = (缩放高度 - 新高度) // 2
            右边 = 左边 + 新宽度
            底边 = 顶边 + 新高度
            
            # 确保裁剪区域在图像范围内
            左边 = max(0, 左边)
            顶边 = max(0, 顶边)
            右边 = min(缩放宽度, 右边)
            底边 = min(缩放高度, 底边)
            
            img_scaled = img_scaled.crop((左边, 顶边, 右边, 底边))
            mask_scaled = mask_scaled.crop((左边, 顶边, 右边, 底边))
        
        # 最终确保尺寸正确（以防裁剪后尺寸不匹配）
        if img_scaled.size != (新宽度, 新高度):
            img_scaled = img_scaled.resize((新宽度, 新高度), self.获取插值方法(插值方法))
            mask_scaled = mask_scaled.resize((新宽度, 新高度), self.获取插值方法(插值方法))
        
        return img_scaled, mask_scaled, 新宽度, 新高度

    def 获取插值方法(self, 插值名称):
        插值映射 = {
            "双线性插值": Image.BILINEAR,
            "双三次插值": Image.BICUBIC,
            "邻近-精确": Image.NEAREST,
            "Lanczos": Image.LANCZOS,
            "区域": Image.BOX
        }
        return 插值映射.get(插值名称, Image.LANCZOS)

    def tensor2pil(self, image):
        """处理批次和单张图像的tensor到PIL转换"""
        if len(image.shape) == 4:
            # 批次图像: (batch, height, width, channels)
            # 提取单张图像
            image = image[0]  # 取批次中的第一张
        
        # 转换为numpy数组并处理
        image_np = image.cpu().numpy()
        image_np = np.clip(255. * image_np, 0, 255).astype(np.uint8)
        return Image.fromarray(image_np)

    def tensor2mask(self, mask):
        """处理批次和单张遮罩的tensor到PIL转换"""
        if len(mask.shape) == 3:
            # 批次遮罩: (batch, height, width)
            # 提取单张遮罩
            mask = mask[0]  # 取批次中的第一张
        elif len(mask.shape) == 4:
            # 批次遮罩: (batch, 1, height, width) 或其他格式
            mask = mask[0, 0] if mask.shape[1] == 1 else mask[0]
        
        # 转换为numpy数组并处理
        mask_np = mask.cpu().numpy()
        mask_np = np.clip(255. * mask_np, 0, 255).astype(np.uint8)
        return Image.fromarray(mask_np, mode='L')

    def pil2tensor(self, image):
        """PIL图像转换为tensor"""
        image_np = np.array(image).astype(np.float32) / 255.0
        return torch.from_numpy(image_np).unsqueeze(0)  # 添加批次维度

    def pil2mask(self, image):
        """PIL遮罩转换为tensor"""
        image_np = np.array(image.convert("L")).astype(np.float32) / 255.0
        return torch.from_numpy(image_np).unsqueeze(0)  # 添加批次维度

NODE_CLASS_MAPPINGS = {"图像缩放V2_孤海": 图像缩放V2_孤海}
NODE_DISPLAY_NAME_MAPPINGS = {"图像缩放V2_孤海": "图像缩放V2 孤海"}