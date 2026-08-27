import re
import os
import urllib.parse
import sys

class GuhaiCustomChildrenStickerQuadrate:
    """
    孤海定制-儿童贴模板-方
    根据两个下拉菜单选择输出对应的图像路径和尺寸
    """
    
    # 使用原始字符串避免转义问题
    TEMPLATE_STYLES = r"""
【01. 爱心黄色】{image_display\PNG方\爱心黄色.png}
【02. 白底彩球】{image_display\PNG方\白底彩球.png}
【03. 纯白色】{image_display\PNG方\纯白色.png}
【04. 纯粉色】{image_display\PNG方\纯粉色.png}
【05. 纯蓝色】{image_display\PNG方\纯蓝色.png}
【06. 纯绿色】{image_display\PNG方\纯绿色.png}
【07. 大巴车】{image_display\PNG方\大巴车.png}
【08. 独角兽】{image_display\PNG方\独角兽.png}
【09. 飞机】{image_display\PNG方\飞机.png}
【10. 粉色草莓】{image_display\PNG方\粉色草莓.png}
【11. 粉色女孩】{image_display\PNG方\粉色女孩.png}
【12. 黄色主图】{image_display\PNG方\黄色主图.png}
【13. 蓝格子男孩】{image_display\PNG方\蓝格子男孩.png}
【14. 绿色男孩】{image_display\PNG方\绿色男孩.png}
【15. 泡泡女孩】{image_display\PNG方\泡泡女孩.png}
【16. 紫钻女孩】{image_display\PNG方\紫钻女孩.png}
    """
    
    # 尺寸清单同样使用原始字符串
    LAYOUT_SIZES = r"""
【1寸 42张】{1寸 42张}
【1寸 49张】{1寸 49张}
【2寸 25张】{2寸 25张}
【3寸 9张】{3寸 9张}
【1寸 18张 + 2寸 15张】{1寸 18张 + 2寸 15张}
【（小份）1寸 14张】{（小份）1寸 14张}
【（小份）1寸 21张】{（小份）1寸 21张}
【（小份）2寸 10张】{（小份）2寸 10张}
【（小份）1寸 7张+2寸 5张】{（小份）1寸 7张+2寸 5张}
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
    "GuhaiCustomChildrenStickerQuadrate": GuhaiCustomChildrenStickerQuadrate
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "GuhaiCustomChildrenStickerQuadrate": "孤海定制-儿童贴模板-方"
}