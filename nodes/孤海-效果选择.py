import random
import time
import comfy

class GH_EffectSwitcher:
    """
    孤海-效果切换节点 - 14-15位随机种版 (带缓存优化)
    新增"固定此效果"功能，可复用上一次的输出值
    """
    def __init__(self):
        self.last_output = None
        self.last_choice = None
        self.last_effect = None  # 跟踪上次使用的效果类型
        self.last_used_cache = False  # 跟踪上次是否使用了缓存

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "效果选择": (["相似度较高", "面部微美颜", "随机效果"], 
                          {"default": "相似度较高"}),
                "固定此效果": ("BOOLEAN", {"default": False}),  # 新增布尔开关
            }
        }

    RETURN_TYPES = ("INT",)
    RETURN_NAMES = ("整数",)
    FUNCTION = "switch_effect"
    CATEGORY = "孤海工具箱"

    def generate_14_15_seed(self):
        """生成14-15位的随机种子"""
        if random.random() < 0.5:
            min_val = 10**13
            max_val = 10**14 - 1
        else:
            min_val = 10**14
            max_val = 10**15 - 1
        
        return random.randint(min_val, max_val)

    def switch_effect(self, 效果选择, 固定此效果):
        # 如果启用"固定此效果"且有缓存值，直接返回缓存值
        if 固定此效果 and self.last_output is not None:
            self.last_used_cache = True
            return (self.last_output,)
            
        self.last_used_cache = False
        
        # 处理三种效果模式
        if 效果选择 == "相似度较高":
            output_value = 970755074317040
        elif 效果选择 == "面部微美颜":
            output_value = 1077796217562309
        else:  # 随机效果
            output_value = self.generate_14_15_seed()
        
        # 更新缓存
        self.last_output = output_value
        self.last_choice = 效果选择
        self.last_effect = 效果选择
        
        return (output_value,)

    def IS_CHANGED(self, 效果选择, 固定此效果, **kwargs):
        """实现缓存机制的核心方法"""
        # 如果启用"固定此效果"且有缓存值，视为无变化
        if 固定此效果 and self.last_output is not None:
            return getattr(self, "_unchanged_token", None) or "unchanged"
            
        # 随机效果总是需要重新执行
        if 效果选择 == "随机效果":
            return float(time.time())
        
        # 固定效果：当与上次选择不同时才需要执行
        if 效果选择 != self.last_effect:
            return 效果选择
        
        # 返回特殊标记表示使用缓存
        return getattr(self, "_unchanged_token", None) or "unchanged"

    def display(self):
        """在节点界面显示效果值和输出值"""
        if self.last_choice is None or self.last_output is None:
            return "未执行"
            
        num_str = str(self.last_output)
        digits = len(num_str)
        digit_info = f"{digits}位"
        
        # 使用成员变量而非参数
        if self.last_choice == "相似度较高":
            type_info = "(固定值)"
        elif self.last_choice == "面部微美颜":
            type_info = "(固定值)"
        else:
            type_info = "(随机值)"
        
        # 增加缓存使用标记
        cache_info = " [使用缓存]" if self.last_used_cache else ""
        
        return {
            "效果选择": self.last_choice,
            "整数值": f"{self.last_output} {digit_info} {type_info}{cache_info}"
        }

# 节点注册
NODE_CLASS_MAPPINGS = {"GH_EffectSwitcher": GH_EffectSwitcher}
NODE_DISPLAY_NAME_MAPPINGS = {"GH_EffectSwitcher": "孤海-效果切换"}