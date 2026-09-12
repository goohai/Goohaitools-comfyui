import os
import json
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
    _file_index = {}
    _initialized = False

    @classmethod
    def _scan_templates(cls):
        """扫描 image/ID_Photo 下的所有子文件夹和模板图片，从JSON加载提示词"""
        if cls._initialized:
            return

        node_dir = Path(__file__).parent.parent
        image_dir = node_dir / "image" / "ID_Photo"

        categories = []
        templates = {}
        prompt_map = {}
        file_index = {}  # {category: {stem_lower: actual_filename}}

        # 加载提示词数据
        data_json = image_dir / "id_photo_data.json"
        if data_json.exists():
            try:
                with open(data_json, "r", encoding="utf-8") as f:
                    data = json.load(f)
                prompt_map = data.get("prompts", {})
            except Exception:
                prompt_map = {}

        if image_dir.exists():
            for d in sorted(image_dir.iterdir()):
                if d.is_dir() and not d.name.startswith("."):
                    categories.append(d.name)
                    templates[d.name] = []
                    cat_prompts = prompt_map.get(d.name, {})
                    cat_index = {}
                    
                    for img_file in sorted(d.iterdir()):
                        if img_file.suffix.lower() in ('.jpg', '.jpeg', '.png', '.webp'):
                            stem = img_file.stem
                            filename = img_file.name
                            ext = img_file.suffix
                            
                            # 建立短标题索引，用于旧文件名兼容
                            cat_index[stem.lower()] = filename
                            
                            # 从JSON映射获取提示词，兼容旧版从文件名解析
                            if stem in cat_prompts:
                                prompt = cat_prompts[stem]
                                title = stem
                            elif "-" in stem:
                                title, prompt = stem.split("-", 1)
                                title = title.strip()
                                prompt = prompt.strip()
                            else:
                                title = stem
                                prompt = ""
                            
                            templates[d.name].append({
                                "title": title,
                                "prompt": prompt,
                                "filename": filename,
                                "category": d.name,
                            })
                    
                    file_index[d.name] = cat_index

        if not categories:
            categories = ["无数据"]

        cls._categories = categories
        cls._templates_data = templates
        cls._file_index = file_index
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

def _resolve_image(img_dir, category, filename, file_index):
    """兼容旧长文件名：旧文件名格式为「短标题-提示词.扩展名」，自动解析短标题匹配新文件"""
    img_path = img_dir / filename
    if img_path.is_file():
        return img_path
    
    cat_idx = file_index.get(category, {})
    stem = Path(filename).stem
    
    # 旧格式：短标题-提示词
    if "-" in stem:
        short_title = stem.split("-", 1)[0].strip()
        target = cat_idx.get(short_title.lower())
        if target:
            candidate = img_dir / target
            if candidate.is_file():
                return candidate
    
    return None


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
        """按分类和文件名返回模板图片，兼容旧长文件名"""
        from urllib.parse import unquote
        category = unquote(request.match_info["category"])
        filename = unquote(request.match_info["filename"])
        node_dir = Path(__file__).parent.parent
        img_dir = node_dir / "image" / "ID_Photo" / category
        
        img_path = _resolve_image(img_dir, category, filename, IDPhotoClothingSelector_孤海._file_index)
        
        if img_path and img_path.is_file():
            return web.FileResponse(img_path)
        return web.Response(status=404, text="Not found")


# ============ 节点注册映射 ============

NODE_CLASS_MAPPINGS = {
    "IDPhotoClothingSelector_孤海": IDPhotoClothingSelector_孤海,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "IDPhotoClothingSelector_孤海": "证件照服装发型_孤海",
}
