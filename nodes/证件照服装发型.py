import os
from pathlib import Path

try:
    from server import PromptServer
    from aiohttp import web
    _HAS_SERVER = True
except ImportError:
    _HAS_SERVER = False


class IDPhotoClothingSelector_孤海:
    """证件照服装发型选择节点"""

    _templates_data = {}
    _categories = []
    _initialized = False

    @classmethod
    def _scan_templates(cls):
        """扫描 image/ID_Photo 下的所有子文件夹和模板图片，解析文件名拆分标题与提示词"""
        if cls._initialized:
            return

        node_dir = Path(__file__).parent.parent
        image_dir = node_dir / "image" / "ID_Photo"

        categories = []
        templates = {}

        if image_dir.exists():
            for d in sorted(image_dir.iterdir()):
                if d.is_dir():
                    categories.append(d.name)
                    templates[d.name] = []
                    for img_file in sorted(d.iterdir()):
                        if img_file.suffix.lower() in ('.jpg', '.jpeg', '.png', '.webp'):
                            stem = img_file.stem
                            # 文件名格式：标题-提示词
                            if "-" in stem:
                                title, prompt = stem.split("-", 1)
                            else:
                                title, prompt = stem, ""
                            templates[d.name].append({
                                "title": title,
                                "prompt": prompt,
                                "filename": img_file.name,
                                "category": d.name,
                            })

        if not categories:
            categories = ["无数据"]

        cls._categories = categories
        cls._templates_data = templates
        cls._initialized = True

    @classmethod
    def INPUT_TYPES(cls):
        cls._scan_templates()
        cats = list(cls._categories)

        return {
            "required": {
                "风格类型": (cats,),
                "提示词输出": ("STRING", {"default": "", "multiline": True}),
            },
            "hidden": {
                "unique_id": "UNIQUE_ID",
            },
        }

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("提示词",)
    FUNCTION = "execute"
    CATEGORY = "孤海工具箱"

    def execute(self, 风格类型, 提示词输出="", unique_id=None):
        return (提示词输出,)


# ============ API 路由 ============

if _HAS_SERVER:
    @PromptServer.instance.routes.get("/goohai/id_photo_templates")
    async def _api_get_templates(request):
        """返回所有分类及模板元数据（JSON）"""
        IDPhotoClothingSelector_孤海._scan_templates()
        return web.json_response({
            "categories": IDPhotoClothingSelector_孤海._categories,
            "templates": IDPhotoClothingSelector_孤海._templates_data,
        })

    @PromptServer.instance.routes.get("/goohai/id_photo_image/{category}/{filename}")
    async def _api_serve_image(request):
        """按分类和文件名返回模板图片"""
        from urllib.parse import unquote
        category = unquote(request.match_info["category"])
        filename = unquote(request.match_info["filename"])
        img_path = Path(__file__).parent.parent / "image" / "ID_Photo" / category / filename
        if img_path.is_file():
            return web.FileResponse(img_path)
        return web.Response(status=404, text="Not found")


# ============ 节点注册映射 ============

NODE_CLASS_MAPPINGS = {
    "IDPhotoClothingSelector_孤海": IDPhotoClothingSelector_孤海,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "IDPhotoClothingSelector_孤海": "证件照服装发型_孤海",
}
