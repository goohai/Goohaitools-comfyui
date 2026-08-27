import re
import os
import urllib.parse
import sys

class GuhaiCustomChildrenStickerRound:
    """
    孤海定制-儿童贴模板-长
    根据两个下拉菜单选择输出对应的图像路径和尺寸
    """
    
    # 使用原始字符串避免转义问题
    TEMPLATE_STYLES = r"""
【01. 粉色圆形】{image_display\PNG圆\粉色圆形.png}
【02. 蓝色圆形】{image_display\PNG圆\蓝色圆形.png}
【03. 绿色圆形】{image_display\PNG圆\绿色圆形.png}
【04. 圆形冰激凌】{image_display\PNG圆\圆形冰激凌.png}
【05. 圆形星球】{image_display\PNG圆\圆形星球.png}
【06. 圆形独角兽】{image_display\PNG圆\圆形独角兽.png}
【07. 圆形飞机】{image_display\PNG圆\圆形飞机.png}
【08. 圆形飞心】{image_display\PNG圆\圆形飞心.png}
【09. 圆形花朵】{image_display\PNG圆\圆形花朵.png}
【10. 圆形热气球】{image_display\PNG圆\圆形热气球.png}
【11. 圆形小怪兽】{image_display\PNG圆\圆形小怪兽.png}
    """
    
    # 尺寸清单同样使用原始字符串
    LAYOUT_SIZES = r"""
【2.5cm 63贴】{2.5cm 63贴}
【3.0cm 42贴】{3.0cm 42贴}
【3.5cm 35贴】{3.5cm 35贴}
【4.0cm 24贴】{4.0cm 24贴}
【5.0cm 15贴】{5.0cm 15贴}
【2.5cm 10贴】{2.5cm 10贴}
    """
    
    # 预解析的列表
    _parsed_templates = None
    _parsed_sizes = None
    
    @classmethod
    def _parse_list(cls, text):
        """解析清单文本，返回(显示文本, 对应值)的列表"""
        parsed = []
        pattern = r"【(.+?)】{([^}]+)}"
        for line in text.splitlines():
            line = line.strip()
            if not line:
                continue
            match = re.match(pattern, line)
            if match:
                display = match.group(1).strip()
                value = match.group(2).strip()
                parsed.append((display, value))
            else:
                print(f"[孤海定制] 忽略无法解析的行: {line}")
        return parsed
    
    @classmethod
    def get_template_styles(cls):
        """获取解析后的模板样式列表"""
        if cls._parsed_templates is None:
            cls._parsed_templates = cls._parse_list(cls.TEMPLATE_STYLES)
        return cls._parsed_templates
    
    @classmethod
    def get_layout_sizes(cls):
        """获取解析后的拼版尺寸列表"""
        if cls._parsed_sizes is None:
            cls._parsed_sizes = cls._parse_list(cls.LAYOUT_SIZES)
        return cls._parsed_sizes
    
    @classmethod
    def INPUT_TYPES(cls):
        """定义输入类型"""
        templates = cls.get_template_styles()
        sizes = cls.get_layout_sizes()
        
        # 创建下拉菜单选项
        template_choices = [display for display, _ in templates]
        size_choices = [display for display, _ in sizes]
        
        return {
            "required": {
                "模板样式": (template_choices, {"default": template_choices[0] if template_choices else ""}),
                "拼版尺寸": (size_choices, {"default": size_choices[0] if size_choices else ""}),
            }
        }
    
    RETURN_TYPES = ("STRING", "STRING")
    RETURN_NAMES = ("图像路径", "尺寸")
    FUNCTION = "get_selected"
    CATEGORY = "孤海定制"
    
    def get_selected(self, 模板样式, 拼版尺寸):
        """根据选择输出对应的图像路径（自动转换路径分隔符）和尺寸"""
        # 获取选中的模板路径
        selected_path = ""
        for display, path in self.get_template_styles():
            if display == 模板样式:
                # 直接使用原始路径，不再进行任何转义处理
                selected_path = path
                
                # 检查是否为URL，URL不转换路径分隔符
                if not urllib.parse.urlparse(path).scheme:  # 仅处理本地路径
                    # 关键优化：根据操作系统自动转换路径分隔符
                    if sys.platform.startswith('win'):
                        # Windows系统保持反斜杠
                        selected_path = path.replace('/', '\\')
                    else:
                        # Linux/macOS系统使用正斜杠
                        selected_path = path.replace('\\', '/')
                break
        
        # 获取选中的尺寸
        selected_size = ""
        for display, size in self.get_layout_sizes():
            if display == 拼版尺寸:
                selected_size = size
                break
        
        return (selected_path, selected_size)

# 节点注册映射
NODE_CLASS_MAPPINGS = {
    "GuhaiCustomChildrenStickerRound": GuhaiCustomChildrenStickerRound
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "GuhaiCustomChildrenStickerRound": "孤海定制-儿童贴模板-圆"
}