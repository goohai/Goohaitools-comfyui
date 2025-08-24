import random

class SimpleIDPhotoPrompts:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "构图": (["无", "随机", "人像面部特写", "上半身近景特写", "中近景构图", "半身构图", "七分身构图"], {"default": "人像面部特写"}),
                "国籍": (["无", "随机", "中国", "日本", "韩国", "东南亚", "印度", "中东", "俄罗斯", "北欧", "西欧", "南欧", "北美", "南美", "非洲", "原住民", "混血"], {"default": "中国"}),
                "性别": (["无", "随机", "女孩", "男孩", "女人", "男人", "老人", "老奶奶", "老爷爷", "小女孩", "小男孩", "女婴儿", "男婴儿"], {"default": "女孩"}),
                "体型": (["无", "随机", "纤细的", "苗条的", "丰满的", "肌肉发达的", "娇小的", "高挑的", "肥胖的"], {"default": "丰满的"}),
                "发色": (["无", "随机", "黑色", "蓝黑色", "茶黑色", "深棕色", "巧克力棕", "亚麻棕", "青木棕", "香槟金", "酒红色", "莓果红", "橘红色", "奶奶灰", "雾霾灰", "灰紫色", "蓝灰色", "孔雀蓝", "樱花粉", "玫瑰粉", "粉紫色", "奶茶色", "薰衣草紫", "珊瑚橙", "渐变色"], {"default": "亚麻棕"}),
                "发型": (["无", "随机", "飘逸长发", "波波头", "精灵短发", "露耳短发", "空气刘海", "中长发", "锁骨发", "波浪卷", "法式刘海", "齐刘海", "长发", "大波浪", "黑长直", "公主切", "高马尾", "复古背头", "复古卷发", "单马尾辫", "双马尾辫", "脏辫（Dreadlocks）", "丸子头发","头包脸发型"], {"default": "随机"}),
                "服装颜色": (["无", "随机", "中性色", "黑色", "白色", "灰色", "米色", "卡其色", "驼色", "冷色", "藏青色", "天蓝色", "宝蓝色", "浅蓝色", "墨绿色", "军绿色", "浅绿色", "暖色", "红色", "酒红色", "浅红色", "粉色", "玫粉色", "浅粉色", "橙色", "黄色", "浅黄色", "紫色", "浅紫色", "深紫色", "棕色", "咖啡色", "牛仔蓝", "荧光色", "荧光黄", "荧光绿", "金色", "银色"], {"default": "无"}),
                "服装款式": (["无", "随机", "V领T恤", "圆领T恤", "衬衫", "V领衬衫", "POLO衫", "泡泡袖", "毛衣", "卫衣", "夹克", "西装外套", "V领正装", "风衣", "皮衣", "羽绒服", "高档婚纱", "高档礼服", "马甲", "连衣裙", "牛仔衣", "军装", "警服", "护士服", "厨师服", "校服", "白大褂", "睡衣", "旗袍", "包臀裙", "背带裤", "春装", "夏装", "秋装", "冬装"], {"default": "随机"}),
                "服饰佩饰": (["无", "随机", "领带", "格子领带", "斜纹领带", "领结", "蝴蝶结", "腰带", "围巾"], {"default": "随机"}),
                "妆容": (["无", "随机", "素颜", "淡妆", "日常妆", "清新妆", "素颜妆", "职场妆", "烟熏妆", "晚晏妆", "新娘妆", "舞台妆", "韩系妆", "日系妆", "中式古典妆", "复古妆", "欧美妆", "纯欲妆"], {"default": "随机"}),
                "表情": (["无", "随机", "微笑", "大笑", "抿嘴笑", "甜甜的笑容和洁白的牙齿", "冷漠的表情", "冷笑"], {"default": "随机"}),
                "背景色": (["无", "随机", "简单背景", "中性色", "黑色", "白色", "灰色", "米色", "卡其色", "驼色", "冷色", "藏青色", "天蓝色", "宝蓝色", "浅蓝色", "墨绿色", "军绿色", "浅绿色", "暖色", "红色", "酒红色", "浅红色", "粉色", "玫粉色", "浅粉色", "橙色", "黄色", "浅黄色", "紫色", "浅紫色", "深紫色", "棕色", "咖啡色", "牛仔蓝", "荧光色", "荧光黄", "荧光绿", "金色", "银色"], {"default": "简单背景"}),
                "其他佩饰": (["无", "随机", "帽子", "眼镜", "细框眼镜", "粗框眼镜", "耳环", "耳钉", "项链", "头花", "发箍"], {"default": "无"}),
                "seed": ("INT", {"default": 0, "min": 0, "max": 0xffffffffffffffff}),  # 新增随机种子
            }
        }

    RETURN_TYPES = ("STRING",)
    FUNCTION = "generate_prompt"
    CATEGORY = "孤海工具箱"

    def generate_prompt(self, **kwargs):
        # 设置随机种子
        seed = kwargs.get("seed", 0)
        random.seed(seed)

        def process_param(param_name):
            value = kwargs[param_name]
            options = self.INPUT_TYPES()["required"][param_name][0]
            
            if value == "无":
                return ""
            if value == "随机":
                valid_options = [opt for opt in options if opt not in ("无", "随机")]
                return random.choice(valid_options) if valid_options else ""
            return value

        prompt_parts = []

        # 处理基础描述（体型+国籍+性别）
        base_descs = []
        for param in ["体型","国籍","性别"]:
            value = process_param(param)
            if value:
                base_descs.append(value)
        if base_descs:
            prompt_parts.append(f"一个{' '.join(base_descs)}")

        # 处理组合参数
        combo_params = [
            ("构图", ""),
            ("发色", "发型", " "),
            ("服装颜色", "服装款式", " "),
            ("服饰佩饰", ""),
            ("表情", ""),
            ("妆容", ""),
            ("其他佩饰", ""),
        ]

        for item in combo_params:
            if len(item) == 3:
                param1, param2, sep = item
                val1 = process_param(param1)
                val2 = process_param(param2)
                if val1 or val2:
                    combined = sep.join(filter(None, [val1, val2]))
                    prompt_parts.append(combined)
            else:
                param, _ = item
                value = process_param(param)
                if value:
                    prompt_parts.append(value)

        # 处理背景色
        background = process_param("背景色")
        if background:
            prompt_parts.append(f"{background}简单背景")

        final_prompt = ", ".join(filter(None, prompt_parts))
        return (final_prompt,)

NODE_CLASS_MAPPINGS = {
    "SimpleIDPhotoPrompts": SimpleIDPhotoPrompts
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "SimpleIDPhotoPrompts": "孤海-证件照简易提示词"
}