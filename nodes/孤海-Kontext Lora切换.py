import re
import os

class KontextLoraSwitch:
    """
    孤海-Kontext_lora切换节点
    根据下拉菜单选择输出对应的Lora文件名和Prompt
    """
    
    # 使用多行字符串定义选项列表，按照《》【】{}格式
    OPTIONS_STR = """
《无》【Kontext\ZOEY-kontext角度编辑器_Beta.safetensors】{ }
《01. 一键去水印》【Kontext\移除kontext_remove.safetensors】{Remove all watermarks}
《02. 老照片修复》【Kontext\ZOEY-kontext-老照片修复_Alpha.safetensors】{Restore and colorize the photo while maintaining the same facial features, hairstyle, and expression，while keeping the person in the exact same position, scale, and pose}
《03. 改变角度》【Kontext\ZOEY-kontext角度编辑器_Beta.safetensors】{ATurn to the front}
《04. 留衣去人》【Kontext\获取衣物KontextLoRA_1.0.safetensors】{Remove the characters, keep the clothing,Remove the facial features and hair of the character.}
《05. 人像精修》【Kontext\kontext-专业级人像精修_1.0.safetensors】{Adjust the color of the picture, beautify the skin and posture of the characters while keeping the person in the exact same position, scale, and pose}
《06. 万物精修》【Kontext\ZOEY-kontext-万物精修、修复、高清_Alpha.safetensors】{Enhance the details of this damaged item and restore it to high resolution ,making it look like new while keeping the original style.}
《07. 万物迁移》【Kontext\put it here_kontext—万能贴—万物迁移_V_0.1.safetensors】{put it here}
《08. 脱吧脱吧》【Kontext\脱衣kontext-clothes_remover_v0.safetensors】{Take off the character's clothes}
《09. 去灰调色》【Kontext\kontexe人物摄影打光调色———阿牛_1.safetensors】{Adjust the overall color and lighting of the image to match the quality of the photographic film}
《10. 外墙翻新》【Kontext\kontext-建筑设计-外立面改造-新中式_1.0.safetensors】{Decorate this building in a Chinese style}
《11. 印花图案提取》【Kontext\kontext图案提取最终版.safetensors】{Just extract the patterns and text on the carpet or clothes. Convert the pattern into a vector and stretch it to cover the entire canvas seamlessly}
《12. 孤海-产品图案提取》【Kontext\孤海-产品图案提取-kontext.safetensors】{Just extract the patterns and text on the product.  stretch it to cover the entire canvas seamlessly}
《13. 提取服装到白背景》【Kontext\kontext _ 提取服装LoRA_V1.0.safetensors】{Extract the clothes from the image and til them flat on a white background, product photography style, keep the clothes style and details unchanged, high-end texture}
《14. 修容瘦身》【Kontext\ZOEY-kontext-摄影瘦身修容_Alpha.safetensors】{The person becomes thinner. Retain the original facial expression and outfit,Make the character's body slimmer while keeping the original pose and background while preserving facial features}
《15. 粒子转绘》【Kontext\KC-Kontext一键粒子转绘_V1.safetensors】{Convert this image into a sketch style composed of luminescent particles. The background is black,while maintaining consistency in character images and similarity in appearance.,}
《16. 世界杯_亚洲审美》【Kontext\胸部增强-亚洲审美_kontext .safetensors】{Change to large breasts while adjusting the clothing to reveal more cleavage,}
《17. 世界末日_电影风》【Kontext\Kontext-世界末日.safetensors】{remove people, Transform the scene into a P0stAp0calyptic scene while preserving the original composition, proportions and viewing angle. damaged building}
《18. 破损照片效果》【Kontext\kontext-破损照片效果-lora.safetensors】{make it an old and damaged photo}
《19. 可爱毛绒绒》【Kontext\星梦｜Kontext｜毛绒绒｜Fluffy_v1.safetensors】{make this object fluffy}
《20. 西瓜雕刻》【Kontext\QY_F.1-Kontext 万物西瓜雕刻风格_V1.0.safetensors】{Transform to Watermelon carving}
《21. 手绘三视图》【Kontext\Kontext-三视图.safetensors】{Generate four different perspectives of hand-drawn sketches, including front, side, back, and top views, and annotate dimensions to show their size. Keep the main information unchanged.}
《22. 摄影三视图》【Kontext\Kontext-三视图.safetensors】{Generate four different perspectives  including front, side, back, and top views,  Keep the main information unchanged.}
《23. 万物毛毡》【Kontext\幻象绘影万物毛毡-FeltKontextLoRA.safetensors】{Convert to felt style}
《24. 服装去褶皱》【Kontext\kontext-服装除皱精修 _V1.0.safetensors】{Clothing refinement, removing wrinkles, retaining fabric texture and details, improving clothing surface smoothness, and natural transition of light and shadow}
《25. 真实系细节加强》【Kontext\kontext真实系女生摄影细节加强_V1.safetensors】{Make the photo more detailed}
《26. 可爱像素风》【Kontext\ZOEY-kontext-万物可爱像素风图片编辑_V1.safetensors】{Convert this image into a pixel}
《27. Q版转动漫写实》【Kontext\Kontext-Q版转动漫写实_2750步.safetensors】{converted to a real anime style}
《28. 照片转绘_日式插画》【Kontext\Kontext 日式插画Irasutoya_日式插画Irasutoya.safetensors】{Turn this image into a Irasutoya style}
《29. 照片转绘_卡通》【Kontext\Kontext-照片转绘简约卡通人物插画_1.0.safetensors】{turn photos into minimalist cartoon character illustrations}
《30. 照片转绘_油画》【Kontext\KC-Kontrxt转绘油画_V1.safetensors】{convert this image into an oil painting style}
《31. 照片转绘_国画》【Kontext\Kontext_国画_风格转换_Kontext.safetensors】{Convert the image into Chinese painting style}
《32. 3D吉卜力》【Kontext\Kontext-3D Chibi风格转绘_v1.safetensors】{transform to 3D Chibi style}
《33. 胶片颗粒滤镜》【Kontext\F1-胶片颗粒感滤镜_kontext版V3.safetensors】{Transform the picture to film grain，vintage photo，film texture}
《34. 真实照片加噪》【Kontext\Dtpr_RealisticPhoto_Kontext_V1.0.safetensors】{dtpr,trans the images and character into dtpr_photorealistic style,emotional atmosphere, high noise}
《35. 人像精修V2》【Kontext\绘梦Kontext 人像后期精修 _美颜亮眼_ 瘦脸美白 __V1.safetensors】{A professional portrait, with a slimmer face, sharper jawline, fair and smooth skin, larger and brighter eyes, and refined facial features, while keeping the same pose, expression, hairstyle, and accessories. -- Beauty Retouch style}
《36. 多彩活力插画》【Kontext\Kontext_多彩活力插画_1.0.safetensors】{Keep the main subject and structure unchanged and transform the image into a vibrant vector-style illustration}
《37. 万物冰霜》【Kontext\Kontext-万物皆可冰霜_1.0.safetensors】{Change the image into a frozen state like ice while keeping the main part in the exact same position and scale. In the picture,a [main part] is covered by a thin layer of white frosty mist. It is dotted with ice crystals, as if wrapped in a translucent velvet.The frosty mist accumulates on the outline of the subject, adding a touch of the coldness of winter. Surrounding the subject are plants covered with frost and snow, and the background is a soft light blue, creating a serene and chilly atmosphere. The combination of the subject with the ice and snow elements fully showcases the wonderful visual contrast and the natural elegance.}
《38. 刺绣》【Kontext\kontext-刺绣e-4-400.safetensors】{Transform into a cartoon embroidery style，Turn the picture into an embroidery style}
《39. 万物溶图place it》【Kontext\place_it.safetensors】{place it}
《40. 照片转绘_吉卜力》【Kontext\吉卜力_kontext_byJaneB.safetensors】{Convert to Ghibli style}
《41. 机械万物》【Kontext\机械万物-kontext.safetensors】{convert the subject to a robot with white translucent panels and exposed red and black wiring and golden accented metal bits}
《42. 照片转铜像》【Kontext\kontext-铜像.safetensors】{Convert this image into bronze version}
《43. 照片转绘_铅笔画》【Kontext\kontext-铅笔画.safetensors】{Convert this image into pencil_drawing art style}
《44. 金属质感》【Kontext\kontext-金属质感.safetensors】{Make it metallic with a black background and a 3D perspective}
《45. 线稿转真实》【Kontext\kontext-线稿转真实.safetensors】{Convert this sketch into real life version, }
《46. 孤海-徽章贴》【Kontext\孤海-徽章贴-kontext.safetensors】{Change the image to an enamel fridge magnet badge.A high-quality enamel refrigerator sticker with the [main pattern] printed on it.The main part is surrounded by exquisite decorative elements, such as flowers, clouds, grass, waves and other cartoon ornaments.The lustrous and brightly colored enamel color blocks, with gold metal wire cutting edges, have a jewel-like detail. The smooth polished surface.An artistic, harmonious and balanced picture with a simple and soft gradient background.All elements are seamlessly integrated, with a high sense of reality and great visual appeal.Best quality, masterpiece, high-definition image, single viewing angle.Modern culture and creative style, perfect for use as souvenirs or collector's stickers.}
《47. 孤海-冰晶玻璃》【Kontext\孤海-冰晶玻璃-kontext.safetensors】{Change the image style to the frosted ice glass effect，An ice glass artwork created a beautiful reflection on the ice surface.}
《48. 孤海-一键逆光》【Kontext\孤海-自动打光-逆光-kontext.safetensors】{Just change the lighting of the picture to backlighting while keeping the facial features and composition of the characters unchanged.}
《49. 孤海-自动打光-轮廓光加强》【Kontext\孤海-自动打光-轮廓光加强-kontext.safetensors】{Just change the lighting of the picture to backlighting while keeping the facial features and composition of the characters unchanged.}

"""
    
    # 预解析的选项列表
    OPTION_LIST = None
    
    @classmethod
    def get_options(cls):
        """获取解析后的选项列表，只解析一次"""
        if cls.OPTION_LIST is None:
            cls.OPTION_LIST = []
            pattern = r"《(.+?)》【(.+?)】{([^}]+)}"
            for line in cls.OPTIONS_STR.splitlines():
                line = line.strip()
                if not line:
                    continue
                match = re.match(pattern, line)
                if match:
                    display = match.group(1).strip()
                    lora = match.group(2).strip()
                    prompt = match.group(3).strip()
                    cls.OPTION_LIST.append((display, lora, prompt))
                else:
                    print(f"[孤海工具] 忽略无法解析的行: {line}")
        return cls.OPTION_LIST
    
    @classmethod
    def INPUT_TYPES(cls):
        """定义输入类型"""
        options = cls.get_options()
        
        # 创建下拉菜单选项 - ComfyUI标准方式
        choices = []
        for display, _, _ in options:
            choices.append(display)
        
        return {
            "required": {
                # 标准下拉菜单定义
                "功能切换": (choices, {"default": choices[0] if choices else ""}),
            }
        }
    
    RETURN_TYPES = ("STRING", "STRING")
    RETURN_NAMES = ("lora", "prompt")
    FUNCTION = "switch"
    CATEGORY = "孤海工具箱"
    
    def switch(self, 功能切换):
        """根据选择输出对应的lora和prompt"""
        options = self.get_options()
        for name, lora, prompt in options:
            if name == 功能切换:
                return (lora, prompt)
        
        # 未找到匹配项时返回第一个选项
        if options:
            return (options[0][1], options[0][2])
        
        return ("", "")  # 默认返回空字符串

# 节点注册映射
NODE_CLASS_MAPPINGS = {
    "KontextLoraSwitch": KontextLoraSwitch
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "KontextLoraSwitch": "孤海-Kontext_lora切换"
}