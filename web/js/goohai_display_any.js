import { app } from "../../../scripts/app.js";
import { api } from "../../../scripts/api.js";
import { installNativeNodePointerBridge } from "./goohai_dom_native_interaction.js";

const NODE_TYPE = "GoohaiDisplayAny";
const CONNECTION_MENU_LABEL = "展示任意 GH";
const LABELS = {
    IMAGE: "图像", MASK: "遮罩", AUDIO: "音频", VIDEO: "视频", MODEL: "模型",
    CLIP: "CLIP", VAE: "VAE", STRING: "字符串", TEXT: "文本", CONDITIONING: "条件",
    LATENT: "Latent", INT: "整数", FLOAT: "浮点", BOOLEAN: "布尔", ANY: "Any",
};

function addStyles() {
    if (document.getElementById("gh-display-any-style")) return;
    const style = document.createElement("style");
    style.id = "gh-display-any-style";
    style.textContent = `
        .gh-display-any{position:relative;box-sizing:border-box;width:100%;height:100%;min-height:140px;display:flex;flex-direction:column;overflow:hidden;background:rgba(0,0,0,.12);border-radius:6px;font-family:var(--font-inter,Inter),"DengXian",Arial,"Microsoft YaHei",sans-serif;}
        .gh-display-toolbar{position:absolute;top:0;right:6px;z-index:2;pointer-events:none;}
        .gh-display-any [hidden]{display:none!important;}
        .gh-display-copy{opacity:0;pointer-events:none;border:1px solid #ffffff12;border-radius:4px;padding:2px 7px;background:#14141499;color:#bbb;cursor:pointer;font:12px/18px sans-serif;transition:opacity .25s ease;}
        .gh-display-any:hover .gh-display-copy,.gh-display-any.gh-hover .gh-display-copy,.lg-node:hover .gh-display-copy{opacity:.45;pointer-events:auto;}
        .gh-display-any .gh-display-copy:hover,.gh-display-copy:focus-visible{opacity:.85;pointer-events:auto;}
        .gh-display-body{flex:1;min-height:0;overflow:auto;overscroll-behavior:contain;padding:6px 8px 8px;}
        .gh-display-any.gh-has-media{background:transparent;border:0;border-radius:0;box-shadow:none;}
        .dom-widget>.gh-display-any.gh-has-media{width:calc(100% + 20px);margin:-0 -10px;}
        .lg-node .gh-display-any.gh-has-media{width:calc(100% + 28px);margin:0 -14px;}
        .gh-display-any.gh-has-media .gh-display-body{position:relative;padding:0;margin:0;overflow:hidden;}
        .gh-display-any.gh-has-media .gh-display-body{border:0!important;outline:0!important;}
        .gh-display-any.gh-has-media .gh-display-toolbar{top:0;}
        .gh-display-text{display:flex;flex-direction:column;gap:10px;margin:0;padding-right:0;white-space:pre-wrap;overflow-wrap:anywhere;user-select:text;font-family:inherit;line-height:1.5;}
        .gh-display-text.gh-display-single{display:block;}
        .gh-display-first-line{display:block;padding-right:0;}
        .gh-display-rest-line{display:block;}
        .gh-display-batch{display:block;padding:8px;border-radius:0;margin:0;background:rgba(125,137,151,.06);}
        .gh-display-media{position:absolute;inset:0;display:flex;flex-direction:column;justify-content:center;gap:0;padding:0;}
        .gh-display-media:empty{display:none;}
        .gh-display-media figure{position:absolute;inset:0;margin:auto;padding:0;min-width:0;min-height:0;display:flex;flex-direction:column;align-items:center;justify-content:flex-start;gap:0;flex:0 0 auto;-webkit-user-drag:none;user-select:none;}
        .gh-display-visual{position:relative;flex:0 0 auto;min-height:0;padding:0;margin:0;}
        .gh-display-dimensions{position:relative;box-sizing:border-box;flex:0 0 10px;width:100%;height:10px;margin:2px 0 0;padding:0;text-align:center;color:var(--descrip-text,#aaa);font:10px/10px sans-serif;}
        .gh-display-media img,.gh-display-media video{position:absolute;display:block;object-fit:fill;object-position:center;border:0;border-radius:0;background:transparent;image-rendering:-webkit-optimize-contrast;image-rendering:high-quality;image-rendering:auto;-webkit-user-drag:none;user-select:none;backface-visibility:hidden;}
        .gh-display-media img{object-fit:contain;}
        .gh-display-media,.gh-display-media figure,.gh-display-media .gh-display-visual,.gh-display-media img,.gh-display-media .gh-display-dimensions{transition:none!important;animation:none!important;}
.gh-display-media figure{-webkit-user-drag:none;user-select:none;}
        .gh-display-media.gh-gallery-grid{display:grid;gap:2px;align-content:center;justify-content:center;align-items:center;justify-items:center;}
        .gh-gallery-grid figure{position:relative;inset:auto!important;cursor:pointer;width:100%!important;height:100%!important;min-width:0;min-height:0;margin:0!important;padding:0;display:block;}
        .gh-gallery-grid .gh-display-visual{position:relative;width:100%!important;height:100%!important;min-height:0;margin:0!important;}
        .gh-gallery-grid .gh-display-visual img,.gh-gallery-grid .gh-display-visual video{position:static!important;display:block;width:100%!important;height:100%!important;transform:none!important;object-fit:contain;object-position:center;image-rendering:auto;-webkit-user-drag:none;user-select:none;}
        .gh-gallery-grid .gh-display-dimensions{display:none;}
        .gh-display-gallery-button{position:absolute;z-index:1;right:8px;border:0;border-radius:4px;background:#252525cc;color:#ddd;padding:5px 8px;cursor:pointer;font:12px sans-serif;}
        .gh-display-gallery-close{top:6px;}
        .gh-display-gallery-index{bottom:23px;}
        .gh-display-any:focus{outline:none;}
        .gh-display-media audio{width:100%;height:40px;}
        .gh-display-settings{position:fixed;z-index:10001;width:300px;box-sizing:border-box;background:var(--comfy-menu-bg,#292929);color:var(--input-text,#eee);border:0;border-radius:4px;padding:14px 16px;font:14px sans-serif;box-shadow:0 6px 18px #0006;}
        .gh-display-settings label{display:flex;align-items:center;justify-content:space-between;gap:16px;}
        .gh-display-settings label+label{margin-top:14px;}
        .gh-display-settings .gh-display-size-row{justify-content:space-between;align-items:center;}
        .gh-display-settings .gh-display-slider-row{display:block;margin:6px 0 0;}
        .gh-display-settings .gh-display-slider-row input{display:block;width:100%;margin:0;}
        .gh-display-settings input[type=number]{width:80px;border:0;background:#1d2026;color:#ddd;border-radius:3px;padding:4px 6px;font:inherit;text-align:right;outline:none;}
        .gh-display-settings input[type=number]:focus{background:#242830;}
        .gh-display-settings input[type=range]{width:100%;-webkit-appearance:none;appearance:none;height:4px;background:#3a3f48;border-radius:2px;border:0;outline:none;padding:0;cursor:pointer;}
        .gh-display-settings input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;appearance:none;width:14px;height:14px;border-radius:50%;background:#4ec9b0;border:0;cursor:pointer;}
        .gh-display-settings input[type=range]::-moz-range-thumb{width:14px;height:14px;border-radius:50%;background:#4ec9b0;border:0;cursor:pointer;}
        .gh-display-settings .gh-display-color-label{cursor:pointer;align-items:center;}
        .gh-display-settings .gh-display-color-preview{display:inline-block;width:80px;height:24px;border-radius:2px;cursor:pointer;border:0;flex:0 0 auto;}
        .gh-display-settings input[type=color]{display:block;width:100%;height:1px;margin-top:0;padding:0;border:0;opacity:.01;position:absolute;pointer-events:none;}
        .gh-display-color-input{width:80px!important;height:24px!important;opacity:0;position:absolute;right:16px;pointer-events:auto;}
        .gh-display-copy.gh-copy-done{opacity:.8!important;color:#70d890;background:#14291dcc;border-color:#70d89066;}
        .gh-menu-text-settings{color:#4ec9b0!important;}
        .gh-menu-text-settings:hover{color:#6ee0c8!important;}
        .gh-display-any.gh-copy-visible .gh-display-body{padding:20px 8px 8px;}
        .gh-display-any.gh-copy-visible .gh-display-first-line{margin-top:-6px;}
        .gh-display-any.gh-has-batch .gh-display-body{padding:0;display:flex;flex-direction:column;}
        .gh-display-any.gh-has-batch .gh-display-batch{width:100%;box-sizing:border-box;border-radius:0;}
        .gh-display-any.gh-has-batch .gh-display-text{display:flex;flex-direction:column;gap:0;flex:1;min-height:0;}
        .gh-display-any.gh-has-batch .gh-display-batch{flex:0 0 auto;}
        .gh-display-any.gh-has-batch .gh-display-batch:last-child{flex:1 1 auto;}
        .gh-display-any.gh-has-batch .gh-display-batch+.gh-display-batch{border-top:1px solid rgba(255,255,255,.05);}
    `;
    document.head.appendChild(style);
}

const DEFAULT_TEXT_FONT_SIZE = 16;
const DEFAULT_TEXT_FONT_COLOR = "#B2B7BD";
const TYPE_TEXT_STYLES = {
    INT: { size: 30, color: "#72ADE3" },
    FLOAT: { size: 30, color: "#E35990" },
    BOOLEAN: { size: 30 },
};
const BOOLEAN_TEXT_COLORS = {
    TRUE: "#78BF5F",
    FALSE: "#A8A8A8",
};

function previewTypeOf(node, type) {
    const value = String(type || node.properties?.gh_display_preview?.type || "").toUpperCase();
    if (value === "BOOL") return "BOOLEAN";
    if (["INT", "FLOAT", "BOOLEAN", "STRING", "TEXT"].includes(value)) return value;
    const input = node.inputs?.find((slot) => slot.name === "Any");
    const inputType = String(input?.type || "").toUpperCase();
    return inputType === "BOOL" ? "BOOLEAN" : inputType;
}

function isCustomTextStyle(node) {
    return node.properties?.gh_text_style_customized === true;
}

function booleanTextColor(element) {
    const value = String(element.shadowRoot?.textContent ?? element.textContent ?? "").trim().toUpperCase();
    return BOOLEAN_TEXT_COLORS[value] || null;
}

function applyTextStyle(node, type) {
    const text = node._ghDisplay?.text;
    if (!text) return;
    const detected = previewTypeOf(node, type);
    const customized = isCustomTextStyle(node);
    const typeStyle = !customized ? TYPE_TEXT_STYLES[detected] : null;
    const size = typeStyle?.size ?? Number(node.properties.gh_font_size);
    const color = typeStyle?.color ?? node.properties.gh_font_color;
    text.style.fontSize = `${Number.isFinite(size) ? Math.max(10, Math.min(100, size)) : 14}px`;
    text.style.color = typeof color === "string" && CSS.supports("color", color) ? color : "#dddddd";
    for (const element of text.children) element.style.color = "";
    if (!customized && detected === "BOOLEAN") {
        for (const element of text.children) {
            const booleanColor = booleanTextColor(element);
            if (booleanColor) element.style.color = booleanColor;
        }
    }
}

function showTextSettings(node) {
    node._ghDisplay?.closeSettings?.();
    const panel = document.createElement("div");
    panel.className = "gh-display-settings";
    const sizeLabel = document.createElement("label");
    sizeLabel.className = "gh-display-size-row";
    sizeLabel.append("文本字号");
    const size = document.createElement("input");
    size.type = "number";
    size.min = "10";
    size.max = "100";
    size.step = "2";
    size.required = true;
    size.value = String(node.properties.gh_font_size ?? 14);
    sizeLabel.append(size);
    const sizeSlider = document.createElement("input");
    sizeSlider.type = "range";
    sizeSlider.min = "10";
    sizeSlider.max = "100";
    sizeSlider.step = "2";
    sizeSlider.value = String(Math.max(10, Math.min(100, Number(node.properties.gh_font_size) || 14)));
    const sliderLabel = document.createElement("label");
    sliderLabel.className = "gh-display-slider-row";
    sliderLabel.append(sizeSlider);
    const colorLabel = document.createElement("label");
    colorLabel.className = "gh-display-color-label";
    const colorPreview = document.createElement("span");
    colorPreview.className = "gh-display-color-preview";
    colorLabel.append("文本颜色", colorPreview);
    const color = document.createElement("input");
    color.type = "color";
    color.className = "gh-display-color-input";
    color.value = /^#[\da-f]{6}$/i.test(node.properties.gh_font_color) ? node.properties.gh_font_color : "#B2B7BD";
    colorPreview.style.backgroundColor = color.value;
    colorLabel.append(color);
    const update = () => {
        const fontSize = Number(size.value);
        if (!size.value || !Number.isFinite(fontSize) || fontSize < 10 || fontSize > 100) return;
        sizeSlider.value = String(Math.max(10, Math.min(100, fontSize)));
        if (node.properties.gh_font_size === fontSize && node.properties.gh_font_color === color.value) return;
        node.graph?.beforeChange?.();
        node.properties.gh_font_size = fontSize;
        node.properties.gh_font_color = color.value;
        node.properties.gh_text_style_customized = true;
        colorPreview.style.backgroundColor = color.value;
        applyTextStyle(node);
        node.graph?.afterChange?.();
        node.setDirtyCanvas?.(true, true);
    };
    size.addEventListener("change", update);
    size.addEventListener("pointerup", update);
    sizeSlider.addEventListener("input", () => { size.value = sizeSlider.value; update(); });
    color.addEventListener("input", () => { colorPreview.style.backgroundColor = color.value; update(); });
    color.addEventListener("change", update);
    colorPreview.addEventListener("click", event => { event.stopPropagation(); color.click(); });
    panel.append(sizeLabel, sliderLabel, colorLabel);
    document.body.append(panel);
    const rect = node._ghDisplay.root.getBoundingClientRect();
    panel.style.left = `${Math.max(0, Math.min(rect.right + 8, window.innerWidth - panel.offsetWidth - 8))}px`;
    panel.style.top = `${Math.max(8, Math.min(rect.top, window.innerHeight - panel.offsetHeight - 8))}px`;
    const close = () => {
        update();
        document.removeEventListener("pointerdown", outside, true);
        document.removeEventListener("keydown", keydown, true);
        panel.remove();
        node._ghDisplay.closeSettings = null;
    };
    const outside = (event) => { if (!panel.contains(event.target)) close(); };
    const keydown = (event) => { if (event.key === "Escape") close(); };
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("keydown", keydown, true);
    node._ghDisplay.closeSettings = close;
}

// Native creation checks this type-specific list again when an entry is clicked.
function installConnectionMenuEntry(canvas) {
    const prototype = canvas?.constructor?.prototype
        || globalThis.LGraphCanvas?.prototype
        || globalThis.LiteGraph?.LGraphCanvas?.prototype;
    if (!prototype || typeof prototype.showConnectionMenu !== "function" || prototype._ghDisplayAnyConnectionMenu) return;
    const original = prototype.showConnectionMenu;
    prototype.showConnectionMenu = function (options) {
        const litegraph = globalThis.LiteGraph;
        const source = options?.nodeFrom;
        const from = options?.slotFrom;
        const slot = typeof from === "object" ? from
            : typeof from === "number" ? source?.outputs?.[from]
            : typeof from === "string" ? source?.outputs?.[source.findOutputSlot(from)] : null;
        if (!source || !slot || !litegraph?.slot_types_default_out) return original.apply(this, arguments);

        const type = slot.type === litegraph.EVENT ? "_event_" : slot.type;
        const defaults = litegraph.slot_types_default_out;
        const current = defaults[type];
        const entries = Array.isArray(current) ? current : current ? [current] : [];
        // Only the few suggestions for this output type are touched, not nodes
        // or the complete type registry. Keep every other suggestion in order.
        defaults[type] = entries.filter(entry => (typeof entry === "string" ? entry : entry.node) !== NODE_TYPE);
        defaults[type].push(NODE_TYPE);

        // Pass the actual slot also when callers supply numeric slot zero.
        const menu = original.call(this, { ...options, slotFrom: slot });
        const lastEntry = menu?.root?.lastElementChild;
        if (lastEntry?.value === NODE_TYPE) lastEntry.textContent = CONNECTION_MENU_LABEL;
        return menu;
    };
    prototype._ghDisplayAnyConnectionMenu = true;
}

async function blobFromMedia(src) {
    const response = await fetch(src, { credentials: "include" });
    if (!response.ok) throw new Error(`加载失败: ${response.status}`);
    return response.blob();
}

function filenameFromSrc(src, fallback) {
    try {
        const url = new URL(src, location.href);
        const name = url.searchParams.get("filename");
        if (name) return name;
    } catch (_) {}
    return fallback;
}

function mediaKindOf(el) {
    if (!el) return null;
    const tag = el.tagName.toLowerCase();
    if (tag === "img") return "image";
    if (tag === "video") return "video";
    if (tag === "audio") return "audio";
    return null;
}

async function copyMediaToClipboard(state) {
    const item = state.contextMedia;
    if (!item) return;
    const kind = mediaKindOf(item);
    const src = item.currentSrc || item.src;
    try {
        if (kind === "video" || kind === "audio") {
            await navigator.clipboard.writeText(src);
            state.flashContextItem?.(item, kind === "audio" ? "音频地址已复制" : "视频地址已复制");
            return;
        }
        const blob = await blobFromMedia(src);
        if (navigator.clipboard?.write) {
            const type = blob.type || "image/png";
            await navigator.clipboard.write([new ClipboardItem({ [type]: blob })]);
        } else {
            throw new Error("当前浏览器不支持剪贴板写入");
        }
        state.flashContextItem?.(item, "已复制");
    } catch (error) {
        console.warn("[GoohaiTools] 复制失败", error);
        state.flashContextItem?.(item, "复制失败", true);
    }
}

async function saveMediaToDisk(state) {
    const item = state.contextMedia;
    if (!item) return;
    try {
        const kind = mediaKindOf(item);
        const src = item.currentSrc || item.src;
        const blob = await blobFromMedia(src);
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        let ext = blob.type?.split("/")[1] || "";
        if (!ext || ext === "mpeg") ext = kind === "audio" ? "wav" : "png";
        if (kind === "video") ext = ext || "mp4";
        a.download = filenameFromSrc(src, `goohai_preview_${Date.now()}.${ext}`);
        document.body.append(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        state.flashContextItem?.(item, "已保存");
    } catch (error) {
        console.warn("[GoohaiTools] 保存失败", error);
        state.flashContextItem?.(item, "保存失败", true);
    }
}

async function copyText(state) {
    const selection = window.getSelection?.();
    const selected = selection && selection.rangeCount && state.text.contains(selection.anchorNode)
        && state.text.contains(selection.focusNode) ? selection.toString() : "";
    const text = state.selectedText || selected || state.text.textContent;
    try {
        if (navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(text);
        } else {
            const field = document.createElement("textarea");
            field.value = text;
            field.style.cssText = "position:fixed;left:-10000px;top:0";
            document.body.append(field);
            field.select();
            const copied = document.execCommand("copy");
            field.remove();
            if (!copied) throw new Error("复制未成功");
        }
        state.copy.textContent = "✓";
        state.copy.classList.add("gh-copy-done");
        clearTimeout(state.copyTimer);
        state.copyTimer = setTimeout(() => {
            state.copy.classList.remove("gh-copy-done");
            state.copy.textContent = "复制";
        }, 3000);
    } catch (error) {
        state.copy.textContent = "复制";
        console.warn("[GoohaiTools] 复制文本失败", error);
    }
}

function mediaUrl(reference) {
    return api.apiURL(`/view?${new URLSearchParams({
        filename: reference.filename,
        subfolder: reference.subfolder || "",
        type: reference.type || "temp",
    })}`);
}

function stopMedia(state) {
    for (const element of state.media.querySelectorAll("audio,video")) {
        element.pause();
        element.removeAttribute("src");
        element.load();
    }
}

function layoutGallery(state) {
    if (state.galleryIndex !== null || state.figures.length < 2) return;
    const width = state.media.clientWidth;
    const height = state.media.clientHeight;
    if (!width || !height) return;
    let imageWidth = 0;
    let imageHeight = 0;
    for (const figure of state.figures) {
        const image = figure.querySelector("img,video");
        const iw = image?.naturalWidth || image?.videoWidth;
        const ih = image?.naturalHeight || image?.videoHeight;
        if (!iw || !ih) return;
        imageWidth = Math.max(imageWidth, iw);
        imageHeight = Math.max(imageHeight, ih);
    }
    const count = state.figures.length;
    const gap = Math.min(2, width / count, height / count);
    let columns = 1;
    let bestScale = 0;
    let bestUnused = Infinity;
    // Fit the entire batch in both axes, choosing the largest complete previews.
    for (let candidate = 1; candidate <= count; candidate++) {
        const rows = Math.ceil(count / candidate);
        const cellWidth = (width - gap * (candidate - 1)) / candidate;
        const cellHeight = (height - gap * (rows - 1)) / rows;
        const scale = Math.min(cellWidth / imageWidth, cellHeight / imageHeight, 1);
        const unused = candidate * rows - count;
        if (scale > bestScale || (scale === bestScale && unused < bestUnused)) {
            bestScale = scale;
            bestUnused = unused;
            columns = candidate;
        }
    }
    const cellWidth = Math.floor(imageWidth * bestScale);
    const cellHeight = Math.floor(imageHeight * bestScale);
    state.media.style.gap = `${gap}px`;
    state.media.style.gridTemplateColumns = `repeat(${columns},${cellWidth}px)`;
    state.media.style.gridTemplateRows = `repeat(${Math.ceil(count / columns)},${cellHeight}px)`;
    state.media.style.gridAutoRows = `${cellHeight}px`;
}

function layoutDimensions(state) {
    if (state.galleryIndex === null && state.figures.length > 1) return;
    const availableWidth = Math.floor(state.media.clientWidth);
    if (!availableWidth || !state.media.clientHeight) return;
    const availableHeight = Math.max(40, Math.floor(state.media.clientHeight));
    for (const figure of state.figures) {
        if (figure.hidden) continue;
        const caption = figure.querySelector(".gh-display-dimensions");
        const visual = figure.querySelector(".gh-display-visual");
        const image = figure.querySelector("img,video");
        if (!visual || !image) continue;
        const captionShowing = caption && !caption.hidden;
        const availW = availableWidth;
        const availH = Math.max(40, availableHeight - (captionShowing ? 14 : 0));
        const iw = image.tagName === "IMG" ? image.naturalWidth : image.videoWidth || availW;
        const ih = image.tagName === "IMG" ? image.naturalHeight : image.videoHeight || availH;
        if (!iw || !ih) continue;
        const scale = Math.min(availW / iw, availH / ih, 1);
        const dw = Math.max(1, Math.floor(iw * scale));
        const dh = Math.max(1, Math.floor(ih * scale));
        figure.style.width = `${dw}px`;
        figure.style.height = captionShowing ? `${dh + 14}px` : `${dh}px`;
        figure.style.left = "0";
        figure.style.right = "0";
        figure.style.top = "0";
        figure.style.bottom = "0";
        figure.style.margin = "auto";
        visual.style.width = `${dw}px`;
        visual.style.height = `${dh}px`;
        visual.style.margin = "0 auto";
        image.style.width = `${dw}px`;
        image.style.height = `${dh}px`;
        image.style.left = "50%";
        image.style.top = "50%";
        image.style.transform = "translate(-50%, -50%)";
    }
}

function revealImagePreview(state) {
    if (!state.imagePreviewPending || state.imagePreviewFrame) return;
    const images = state.figures.map(figure => figure.querySelector("img")).filter(Boolean);
    if (!images.length || images.some(image => !image._ghPreviewReady)) return;
    // Let the DOM widget mount and settle before exposing any intermediate layout.
    state.imagePreviewFrame = requestAnimationFrame(() => {
        layoutGallery(state);
        layoutDimensions(state);
        state.imagePreviewFrame = requestAnimationFrame(() => {
            state.imagePreviewFrame = null;
            if (!state.media.clientWidth || !state.media.clientHeight) return;
            layoutGallery(state);
            layoutDimensions(state);
            for (const image of images) {
                image.style.visibility = "";
                image.closest("figure").style.visibility = "";
            }
            state.imagePreviewPending = false;
        });
    });
}

function selectGalleryItem(state, index) {
    state.galleryIndex = index;
    const grid = index === null && state.figures.length > 1;
    state.media.classList.toggle("gh-gallery-grid", grid);
    if (!grid) state.media.style.gap = "";
    state.figures.forEach((figure, position) => {
        figure.hidden = !grid && position !== (index ?? 0);
        const video = figure.querySelector("video");
        if (video) {
            video.controls = !grid;
            if (grid || figure.hidden) video.pause();
        }
    });
    state.galleryClose.hidden = state.galleryNext.hidden = grid || state.figures.length < 2;
    state.galleryNext.textContent = `${(index ?? 0) + 1}/${state.figures.length}`;
    layoutGallery(state);
    layoutDimensions(state);
}

function setPreviewText(element, value, isBoolean) {
    // Translation extensions scan light-DOM text and turn True/False into 是/否.
    if (isBoolean) element.attachShadow({ mode: "open" }).textContent = value;
    else element.textContent = value;
}

function renderPreview(node, payload) {
    const state = node._ghDisplay;
    if (!state) return;
    cancelAnimationFrame(state.imagePreviewFrame);
    state.imagePreviewFrame = null;
    state.imagePreviewPending = false;
    stopMedia(state);
    state.galleryResize.disconnect();
    state.media.replaceChildren();
    state.figures = [];
    state.galleryIndex = null;
    state.galleryClose.hidden = state.galleryNext.hidden = true;
    state.media.classList.remove("gh-gallery-grid");
    state.media.style.gridTemplateColumns = state.media.style.gridTemplateRows = "";
    state.media.style.gap = state.media.style.gridAutoRows = "";
    state.text.replaceChildren();
    state.text.classList.remove("gh-display-single");
    const hasMedia = ["images", "audio", "video"].some(key => payload?.[key]?.some(reference => reference?.filename));
    const isText = !hasMedia && ["STRING", "TEXT"].includes(payload?.type);
    let batchTexts = Array.isArray(payload?.texts) && payload.texts.length ? payload.texts : [payload?.text ?? "等待执行…"];
    if (payload?.type === "BOOLEAN") {
        batchTexts = batchTexts.map(value => {
            const text = String(value).trim();
            if (text === "是" || /^true$/i.test(text)) return "True";
            if (text === "否" || /^false$/i.test(text)) return "False";
            return value;
        });
    }
    if (batchTexts.length > 1) {
        state.toolbar.hidden = true;
        batchTexts.forEach((value, index) => {
            const block = document.createElement("span");
            block.className = "gh-display-batch";
            setPreviewText(block, value + (index < batchTexts.length - 1 ? "\n\n" : ""), payload?.type === "BOOLEAN");
            state.text.append(block);
        });
    } else {
        state.toolbar.hidden = !isText;
        const lines = String(batchTexts[0]).split("\n");
        state.text.classList.toggle("gh-display-single", true);
        const firstLine = document.createElement("span");
        firstLine.className = "gh-display-first-line";
        setPreviewText(firstLine, lines.shift() || "", payload?.type === "BOOLEAN");
        state.text.append(firstLine);
        if (lines.length) {
            const rest = document.createElement("span");
            rest.className = "gh-display-rest-line";
            rest.textContent = "\n" + lines.join("\n");
            state.text.append(rest);
        }
    }
    state.text.hidden = hasMedia;
    state.toolbar.hidden = !isText || batchTexts.length > 1;
    state.root.classList.toggle("gh-copy-visible", isText && batchTexts.length === 1);
    state.root.classList.toggle("gh-has-batch", batchTexts.length > 1);
    state.root.classList.toggle("gh-has-media", hasMedia);
    for (const [key, tag] of [["images", "img"], ["audio", "audio"], ["video", "video"]]) {
        for (const reference of payload?.[key] || []) {
            if (!reference?.filename) continue;
            const element = document.createElement(tag);
            if (tag === "img") {
                element.loading = "eager";
                element.style.visibility = "hidden";
                element.alt = payload.type === "MASK" ? "遮罩预览" : "图像预览";
            } else {
                element.controls = true;
                element.preload = "metadata";
                if (tag === "video") element.playsInline = true;
            }
            let container = element;
            let caption;
            if (tag !== "audio") {
                container = document.createElement("figure");
                if (tag === "img") {
                    container.style.visibility = "hidden";
                    state.imagePreviewPending = true;
                }
                const visual = document.createElement("div");
                visual.className = "gh-display-visual";
                visual.append(element);
                caption = document.createElement("figcaption");
                caption.className = "gh-display-dimensions";
                caption.hidden = true;
                container.append(visual, caption);
                state.figures.push(container);
                element.addEventListener(tag === "img" ? "load" : "loadedmetadata", () => {
                    const width = tag === "img" ? element.naturalWidth : element.videoWidth;
                    const height = tag === "img" ? element.naturalHeight : element.videoHeight;
                    if (width && height) {
                        caption.textContent = `${width} × ${height}`;
                        caption.hidden = false;
                    }
                    if (tag === "img") {
                        const ready = () => {
                            if (container.parentElement !== state.media) return;
                            element._ghPreviewReady = true;
                            revealImagePreview(state);
                        };
                        element.decode().then(ready, ready);
                    } else {
                        layoutGallery(state);
                        layoutDimensions(state);
                    }
                }, { once: true });
            }
            element.addEventListener("error", () => {
                const failedIndex = state.figures.indexOf(container);
                container.remove();
                if (failedIndex < 0) return;

                const selectedIndex = state.galleryIndex;
                state.figures.splice(failedIndex, 1);
                let nextIndex = selectedIndex;
                if (nextIndex !== null) {
                    if (failedIndex < nextIndex) nextIndex--;
                    else if (failedIndex === nextIndex) nextIndex = Math.min(nextIndex, state.figures.length - 1);
                }
                selectGalleryItem(state, state.figures.length > 1 ? nextIndex : state.figures.length ? 0 : null);

                if (tag !== "img") return;
                if (state.figures.some(figure => figure.querySelector("img"))) revealImagePreview(state);
                else state.imagePreviewPending = false;
            }, { once: true });
            element.src = mediaUrl(reference);
            state.media.append(container);
        }
    }
    if (state.figures.length) selectGalleryItem(state, state.figures.length > 1 ? null : 0);
    if (state.figures.length) state.galleryResize.observe(state.media);
    applyTextStyle(node, payload?.type);
    syncPorts(node);
}

function syncPorts(node, visited = new Set()) {
    if (visited.has(node)) return;
    visited.add(node);
    const input = node.inputs?.find((slot) => slot.name === "Any");
    let detected = "ANY";
    if (input?.link != null) {
        const link = node.graph?.links?.[input.link];
        const source = link && node.graph.getNodeById(link.origin_id);
        const type = source?.outputs?.[link.origin_slot]?.type;
        if (type && !["*", "COMFY_MATCHTYPE_V3"].includes(type)) detected = String(type).toUpperCase();
        else {
            const slot = source?.outputs?.[link.origin_slot];
            const name = slot?.label || slot?.localized_name || slot?.name;
            if (/^(文本|字符串|text|string)$/i.test(name || "")) detected = "STRING";
            else if (["STRING", "TEXT"].includes(node.properties?.gh_display_preview?.type)) detected = "STRING";
        }
    }
    const label = LABELS[detected] || detected;
    if (input) {
        input.type = detected === "ANY" ? "*" : detected;
        input.label = label;
    }
    const output = node.outputs?.[0];
    if (output) {
        output.type = detected === "ANY" ? "*" : detected;
        output.name = "Any";
        output.label = label;
    }
    const typeWidget = node.widgets?.find((widget) => widget.name === "gh_input_type");
    if (typeWidget) typeWidget.value = detected;
    node.setDirtyCanvas?.(true, true);
    for (const linkId of output?.links || []) {
        const link = node.graph?.links?.[linkId];
        const downstream = link && node.graph.getNodeById(link.target_id);
        if (downstream?.type === NODE_TYPE) syncPorts(downstream, visited);
    }
}

function createPreview(node) {
    if (node._ghDisplay) return;
    addStyles();
    node.properties ??= {};
    node.properties.gh_font_size ??= DEFAULT_TEXT_FONT_SIZE;
    node.properties.gh_font_color ??= DEFAULT_TEXT_FONT_COLOR;
    if (typeof node.properties.gh_text_style_customized !== "boolean") {
        const size = Number(node.properties.gh_font_size);
        const color = String(node.properties.gh_font_color || "").toUpperCase();
        node.properties.gh_text_style_customized = size !== DEFAULT_TEXT_FONT_SIZE
            || color !== DEFAULT_TEXT_FONT_COLOR;
    }
    const typeWidget = node.widgets?.find((widget) => widget.name === "gh_input_type");
    if (typeWidget) {
        typeWidget.options ??= {};
        typeWidget.options.socketless = true;
        typeWidget.type = "hidden";
        typeWidget.hidden = true;
        typeWidget.computeSize = () => [0, 0];
        typeWidget.draw = () => {};
        typeWidget.mouse = () => false;
    }
    node.serialize_widgets = true;
    const root = document.createElement("div");
    root.className = "gh-display-any";
    root.tabIndex = -1;
    const toolbar = document.createElement("div");
    toolbar.className = "gh-display-toolbar";
    const copy = document.createElement("button");
    copy.type = "button";
    copy.className = "gh-display-copy";
    copy.textContent = "复制";
    copy.title = "";
    toolbar.append(copy);
    const body = document.createElement("div");
    body.className = "gh-display-body";
    const media = document.createElement("div");
    media.className = "gh-display-media";
    const text = document.createElement("pre");
    text.className = "gh-display-text";
    const galleryClose = document.createElement("button");
    galleryClose.type = "button";
    galleryClose.className = "gh-display-gallery-button gh-display-gallery-close";
    galleryClose.textContent = "×";
    galleryClose.title = "返回缩略图";
    const galleryNext = document.createElement("button");
    galleryNext.type = "button";
    galleryNext.className = "gh-display-gallery-button gh-display-gallery-index";
    galleryNext.title = "下一张（← / → 切换）";
    body.append(media, text, galleryClose, galleryNext);
    root.append(toolbar, body);
    const widget = node.addDOMWidget("gh_display_preview", "gh_display", root, {
        serialize: false, hideOnZoom: false, getMinHeight: () => 140,
        getMaxHeight: () => undefined,
        surfaces: { canvas: "shown", vueNode: "shown", panel: "never" },
    });
    if (widget?.visibility?.surfaces) {
        widget.visibility.surfaces.canvas = "shown";
        widget.visibility.surfaces.panel = "never";
        widget.visibility.surfaces.vueNode = "shown";
    }
    widget.serialize = false;
    widget.options ??= {};
    widget.options.minNodeSize = [250, 200];
    const state = { root, toolbar, copy, body, media, text, widget, galleryClose, galleryNext, figures: [], galleryIndex: null, copyTimer: null, contextMedia: null };
    state.flashContextItem = (element, label, isError = false) => {
        if (!element) return;
        const overlay = document.createElement("div");
        overlay.textContent = label;
        overlay.style.cssText = `position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);z-index:5;padding:6px 12px;border-radius:6px;font:13px sans-serif;color:${isError ? "#ff8f8f" : "#d4f5e3"};background:${isError ? "#3b1f24" : "#1f3a2d"}cc;pointer-events:none;transition:opacity .25s;`;
        const host = element.closest("figure") || element.parentElement || state.body;
        const posHost = host === state.body ? state.body : host;
        if (getComputedStyle(posHost).position === "static") posHost.style.position = "relative";
        posHost.append(overlay);
        setTimeout(() => { overlay.style.opacity = "0"; }, 900);
        setTimeout(() => overlay.remove(), 1200);
    };
    state.galleryResize = new ResizeObserver(() => {
        layoutGallery(state);
        layoutDimensions(state);
        revealImagePreview(state);
    });
    node._ghDisplay = state;
    const openFigure = (event) => {
        if (state.galleryIndex !== null || state.figures.length < 2) return;
        const index = state.figures.indexOf(event.target.closest("figure"));
        if (index < 0) return;
        selectGalleryItem(state, index);
        root.focus({ preventScroll: true });
    };
    // Image taps use the pointer bridge so dragging a thumbnail still moves the node.
    media.addEventListener("click", (event) => { if (event.target.closest("video")) openFigure(event); });
    galleryClose.addEventListener("click", () => { selectGalleryItem(state, null); root.focus({ preventScroll: true }); });
    galleryNext.addEventListener("click", () => { selectGalleryItem(state, (state.galleryIndex + 1) % state.figures.length); root.focus({ preventScroll: true }); });
    root.addEventListener("keydown", (event) => {
        if (state.galleryIndex === null || state.figures.length < 2 || event.ctrlKey || event.metaKey || event.altKey) return;
        if (!["ArrowLeft", "ArrowRight", "Escape"].includes(event.key)) return;
        event.preventDefault();
        event.stopPropagation();
        selectGalleryItem(state, event.key === "Escape" ? null : (state.galleryIndex + (event.key === "ArrowLeft" ? -1 : 1) + state.figures.length) % state.figures.length);
    }, true);
    copy.addEventListener("pointerenter", () => {
        clearTimeout(state.copyTimer);
        copy.classList.remove("gh-copy-done");
        copy.textContent = "复制";
    });
    copy.addEventListener("pointerdown", (event) => {
        const selection = window.getSelection?.();
        state.selectedText = selection && selection.rangeCount && state.text.contains(selection.anchorNode)
            && state.text.contains(selection.focusNode) ? selection.toString() : "";
        event.stopPropagation();
    });
    copy.addEventListener("click", (event) => {
        event.stopPropagation();
        copyText(state);
    });
    const overInteractive = (event) => !!event.target.closest("button,input,textarea,select,.gh-display-settings,.gh-display-gallery-button,audio,video");
    const overMedia = (event) => !!event.target.closest(".gh-display-media,img,figure,.gh-display-visual");
    const overText = (event) => !!event.target.closest(".gh-display-text");
    root.addEventListener("wheel", (event) => {
        if (state.text.offsetParent === null) return;
        if (overMedia(event) && !overText(event)) return;
        if (body.scrollHeight <= body.clientHeight + 1) return;
        if (event.ctrlKey || event.metaKey) return;
        const atTop = body.scrollTop <= 0;
        const atBottom = body.scrollTop + body.clientHeight >= body.scrollHeight - 1;
        const goingDown = event.deltaY > 0;
        const goingUp = event.deltaY < 0;
        if ((goingDown && atBottom) || (goingUp && atTop)) return;
        event.stopImmediatePropagation();
        event.preventDefault();
        body.scrollTop += event.deltaY;
    }, { capture: true, passive: false });
    installNativeNodePointerBridge(root, {
        getWidget: () => widget,
        shouldForwardLeft: (event) => overMedia(event) || (!overInteractive(event) && !overText(event)),
        onTap: openFigure,
        forwardWheel: true,
    });
    root.addEventListener("contextmenu", (event) => {
        let mediaEl = event.target.closest("img,video,audio");
        if (!mediaEl || !state.media.contains(mediaEl)) {
            // 右键在非媒体区域时，单图预览模式下取当前正在显示的那一个
            if (state.galleryIndex !== null && state.figures[state.galleryIndex]) {
                mediaEl = state.figures[state.galleryIndex].querySelector("img,video");
            } else if (!state.figures.length) {
                mediaEl = state.media.querySelector("audio,video");
            } else {
                mediaEl = null;
            }
        }
        state.contextMedia = mediaEl;
        event.preventDefault();
        event.stopPropagation();
        app.canvas?.adjustMouseEvent?.(event);
        app.canvas?.processContextMenu?.(node, event);
    });
    for (const name of ["click", "dblclick"]) root.addEventListener(name, (event) => { if (!overMedia(event) && !overText(event)) event.stopPropagation(); });
    renderPreview(node, node.properties.gh_display_preview);
}

app.registerExtension({
    name: "goohaitools.display_any",
    async setup() {
        installConnectionMenuEntry(app.canvas);
    },
    async beforeRegisterNodeDef(nodeType, nodeData) {
        installConnectionMenuEntry(app.canvas);
        if (nodeData.name !== NODE_TYPE) return;
        // Hidden metadata must never become a second, connectable STRING input.
        nodeData.input.required.gh_input_type[1].socketless = true;
        const addInput = nodeType.prototype.addInput;
        nodeType.prototype.addInput = function (name) {
            if (name === "gh_input_type") return null;
            return addInput.apply(this, arguments);
        };
        const created = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            const result = created?.apply(this, arguments);
            createPreview(this);
            this.setSize([320, 260]);
            requestAnimationFrame(() => syncPorts(this));
            return result;
        };
        const configured = nodeType.prototype.onConfigure;
        nodeType.prototype.onConfigure = function () {
            const result = configured?.apply(this, arguments);
            for (let index = (this.inputs?.length || 0) - 1; index >= 0; index--) {
                if (this.inputs[index].name === "gh_input_type") this.removeInput(index);
            }
            createPreview(this);
            renderPreview(this, this.properties.gh_display_preview);
            requestAnimationFrame(() => syncPorts(this));
            return result;
        };
        const connected = nodeType.prototype.onConnectionsChange;
        nodeType.prototype.onConnectionsChange = function () {
            const result = connected?.apply(this, arguments);
            requestAnimationFrame(() => syncPorts(this));
            return result;
        };
        const executed = nodeType.prototype.onExecuted;
        nodeType.prototype.onExecuted = function (message) {
            const result = executed?.apply(this, arguments);
            const values = message?.gh_display;
            const payload = values?.length > 1 ? {
                type: values.every(value => value.type === values[0].type) ? values[0].type : "ANY",
                text: values.map(value => value.text).join("\n\n"),
                texts: values.map(value => value.text),
                images: values.flatMap(value => value.images || []),
                audio: values.flatMap(value => value.audio || []),
                video: values.flatMap(value => value.video || []),
            } : values?.[0];
            if (payload) {
                createPreview(this);
                this.properties.gh_display_preview = payload;
                renderPreview(this, payload);
            }
            return result;
        };
        const entered = nodeType.prototype.onMouseEnter;
        nodeType.prototype.onMouseEnter = function () {
            this._ghDisplay?.root.classList.add("gh-hover");
            return entered?.apply(this, arguments);
        };
        const left = nodeType.prototype.onMouseLeave;
        nodeType.prototype.onMouseLeave = function () {
            this._ghDisplay?.root.classList.remove("gh-hover");
            return left?.apply(this, arguments);
        };
        const menu = nodeType.prototype.getExtraMenuOptions;
        nodeType.prototype.getExtraMenuOptions = function (canvas, options) {
            const result = menu?.apply(this, arguments);
            const st = this._ghDisplay;
            options.push(null, { content: "展示文本设置…", className: "gh-menu-text-settings", callback: () => showTextSettings(this) });
            if (st?.contextMedia) {
                const kind = mediaKindOf(st.contextMedia);
                const copyLabel = kind === "image" ? "复制图像" : kind === "video" ? "复制视频地址" : "复制音频地址";
                const saveLabel = kind === "image" ? "保存图像" : kind === "video" ? "保存视频" : "保存音频";
                options.push(
                    { content: copyLabel, callback: () => copyMediaToClipboard(st) },
                    { content: saveLabel, callback: () => saveMediaToDisk(st) },
                );
            }
            return result;
        };
        const removed = nodeType.prototype.onRemoved;
        nodeType.prototype.onRemoved = function () {
            if (this._ghDisplay) {
                cancelAnimationFrame(this._ghDisplay.imagePreviewFrame);
                stopMedia(this._ghDisplay);
                clearTimeout(this._ghDisplay.copyTimer);
                this._ghDisplay.galleryResize.disconnect();
                this._ghDisplay.closeSettings?.();
                this._ghDisplay.root.remove();
                this._ghDisplay = null;
            }
            return removed?.apply(this, arguments);
        };
    },
});
