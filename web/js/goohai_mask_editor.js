import { app } from "../../../scripts/app.js";
import { api } from "../../../scripts/api.js";

const MAX_EDIT_LONG_SIDE = 2000;
const EXT_NAME = "goohaitools.load_image_mask_editor";
const pendingMaskSaves = new Set();
const imageLoadCache = new Map();
const editorImageCache = new Map();

function clamp(v, min, max) {
    return Math.max(min, Math.min(max, v));
}

function nextFrame() {
    return new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));
}

function cacheKeyForUrl(src) {
    try {
        const url = new URL(src, location.href);
        url.searchParams.delete("rand");
        return url.toString();
    } catch (_) {
        return String(src || "").replace(/([?&])rand=\d+(&?)/, (m, sep, tail) => tail ? sep : "");
    }
}

function loadImage(src) {
    const cacheable = src && !String(src).startsWith("data:");
    const key = cacheable ? cacheKeyForUrl(src) : src;
    if (cacheable && imageLoadCache.has(key)) return imageLoadCache.get(key);
    const promise = new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = (err) => {
            if (cacheable) imageLoadCache.delete(key);
            reject(err);
        };
        img.src = src;
    });
    if (cacheable) imageLoadCache.set(key, promise);
    return promise;
}

function canvasToBlob(canvas) {
    return new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
}

function canvasToObjectUrl(canvas, type = "image/jpeg", quality = 0.88) {
    return new Promise((resolve, reject) => {
        canvas.toBlob((blob) => {
            if (!blob) reject(new Error("Cannot create preview blob"));
            else resolve(URL.createObjectURL(blob));
        }, type, quality);
    });
}

const pngCrcTable = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
        table[n] = c >>> 0;
    }
    return table;
})();

function pngCrc(bytes) {
    let c = 0xffffffff;
    for (const b of bytes) c = pngCrcTable[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
}

function writeU32(out, offset, value) {
    out[offset] = (value >>> 24) & 0xff;
    out[offset + 1] = (value >>> 16) & 0xff;
    out[offset + 2] = (value >>> 8) & 0xff;
    out[offset + 3] = value & 0xff;
}

function pngChunk(type, data = new Uint8Array()) {
    const typeBytes = new TextEncoder().encode(type);
    const out = new Uint8Array(12 + data.length);
    writeU32(out, 0, data.length);
    out.set(typeBytes, 4);
    out.set(data, 8);
    const crcInput = new Uint8Array(typeBytes.length + data.length);
    crcInput.set(typeBytes, 0);
    crcInput.set(data, typeBytes.length);
    writeU32(out, 8 + data.length, pngCrc(crcInput));
    return out;
}

function concatBytes(parts) {
    const total = parts.reduce((sum, p) => sum + p.length, 0);
    const out = new Uint8Array(total);
    let offset = 0;
    for (const p of parts) {
        out.set(p, offset);
        offset += p.length;
    }
    return out;
}

async function deflateBytes(bytes) {
    if (typeof CompressionStream !== "function") {
        throw new Error("\u5f53\u524d\u6d4f\u89c8\u5668\u4e0d\u652f\u6301 PNG \u65e0\u9884\u4e58\u7f16\u7801");
    }
    const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream("deflate"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function rgbaToPngBlob(rgba, width, height) {
    const stride = width * 4;
    const raw = new Uint8Array((stride + 1) * height);
    for (let y = 0; y < height; y++) {
        const rawOffset = y * (stride + 1);
        raw[rawOffset] = 0;
        raw.set(rgba.subarray(y * stride, (y + 1) * stride), rawOffset + 1);
    }
    const ihdr = new Uint8Array(13);
    writeU32(ihdr, 0, width);
    writeU32(ihdr, 4, height);
    ihdr[8] = 8;
    ihdr[9] = 6;
    ihdr[10] = 0;
    ihdr[11] = 0;
    ihdr[12] = 0;
    const png = concatBytes([
        new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
        pngChunk("IHDR", ihdr),
        pngChunk("IDAT", await deflateBytes(raw)),
        pngChunk("IEND"),
    ]);
    return new Blob([png], { type: "image/png" });
}

function parseImageValue(value) {
    let raw = String(value || "").trim();
    let type = "input";
    const annotated = raw.match(/\[(input|output|temp)\]\s*$/);
    if (annotated) {
        type = annotated[1];
        raw = raw.slice(0, annotated.index).trim();
    }
    raw = raw.replaceAll("\\", "/");
    const parts = raw.split("/");
    const filename = parts.pop() || raw;
    const subfolder = parts.join("/");
    return { filename, subfolder, type };
}

function imageUrlFromParts(p) {
    const qs = new URLSearchParams({
        filename: p.filename,
        type: p.type || "input",
        rand: String(Date.now()),
    });
    if (p.subfolder) qs.set("subfolder", p.subfolder);
    return api.apiURL(`/view?${qs.toString()}`);
}

function getEditorSources(value) {
    const parsed = parseImageValue(value);
    const isClipMask = parsed.filename.includes("painted-masked");
    const isOfficialClipMask = parsed.filename.startsWith("clipspace-mask-");
    if (!isClipMask && !isOfficialClipMask) {
        return {
            imageUrl: imageUrlFromParts(parsed),
            maskUrl: imageUrlFromParts(parsed),
            maskMode: "alpha",
        };
    }
    const original = {
        ...parsed,
        filename: isOfficialClipMask
            ? parsed.filename.replace("clipspace-mask-", "clipspace-painted-")
            : parsed.filename.replace("painted-masked", "painted"),
    };
    return {
        imageUrl: imageUrlFromParts(original),
        maskUrl: imageUrlFromParts(parsed),
        maskMode: "clipspace-alpha",
    };
}

async function uploadCanvas(canvas, name, subfolder = "clipspace") {
    const blob = await canvasToBlob(canvas);
    if (!blob) throw new Error("\u65e0\u6cd5\u751f\u6210 PNG \u6570\u636e");
    const file = new File([blob], name, { type: "image/png" });
    const body = new FormData();
    body.append("image", file);
    body.append("type", "input");
    body.append("subfolder", subfolder);
    body.append("overwrite", "true");
    const res = await api.fetchApi("/upload/image", { method: "POST", body });
    if (!res.ok) throw new Error(`\u4e0a\u4f20\u5931\u8d25: HTTP ${res.status}`);
    return await res.json();
}

async function uploadBlob(blob, name, subfolder = "clipspace") {
    const file = new File([blob], name, { type: blob.type || "image/png" });
    const body = new FormData();
    body.append("image", file);
    body.append("type", "input");
    body.append("subfolder", subfolder);
    body.append("overwrite", "true");
    const res = await api.fetchApi("/upload/image", { method: "POST", body });
    if (!res.ok) throw new Error(`\u4e0a\u4f20\u5931\u8d25: HTTP ${res.status}`);
    return await res.json();
}

async function uploadImageUrl(url, name, subfolder = "clipspace") {
    const res = await fetch(url, { cache: "force-cache" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return uploadBlob(await res.blob(), name, subfolder);
}

async function prepareEditorImage(imageUrl) {
    if (!imageUrl) return null;
    const cacheKey = cacheKeyForUrl(imageUrl);
    if (editorImageCache.has(cacheKey)) return editorImageCache.get(cacheKey);
    const promise = (async () => {
        const srcImg = await loadImage(imageUrl);
        const natural = {
            w: srcImg.naturalWidth || srcImg.width,
            h: srcImg.naturalHeight || srcImg.height,
            sf: 1,
        };
        const longSide = Math.max(natural.w, natural.h);
        natural.sf = longSide > MAX_EDIT_LONG_SIDE ? MAX_EDIT_LONG_SIDE / longSide : 1;
        const editW = Math.max(1, Math.round(natural.w * natural.sf));
        const editH = Math.max(1, Math.round(natural.h * natural.sf));
        const display = document.createElement("canvas");
        display.width = editW;
        display.height = editH;
        display.getContext("2d").drawImage(srcImg, 0, 0, editW, editH);
        return {
            sourceImage: srcImg,
            natural,
            editCanvas: display,
            dataUrl: await canvasToObjectUrl(display, "image/png"),
        };
    })();
    editorImageCache.set(cacheKey, promise);
    if (editorImageCache.size > 6) {
        const first = editorImageCache.keys().next().value;
        editorImageCache.delete(first);
    }
    promise.catch(() => editorImageCache.delete(cacheKey));
    return promise;
}

function prewarmEditorForNode(node) {
    const imageWidget = findImageWidget(node);
    if (!imageWidget?.value) return;
    try {
        const sources = getEditorSources(imageWidget.value);
        prepareEditorImage(sources.imageUrl).catch(() => {});
        loadImage(sources.maskUrl).catch(() => {});
    } catch (_) {}
}

function installImageWidgetPrewarm(node) {
    const imageWidget = findImageWidget(node);
    if (!imageWidget || imageWidget._guhaiPrewarmWrapped) return;
    const origCallback = imageWidget.callback;
    imageWidget.callback = function () {
        const result = origCallback?.apply(this, arguments);
        setTimeout(() => prewarmEditorForNode(node), 0);
        return result;
    };
    imageWidget._guhaiPrewarmWrapped = true;
}

function injectStyles() {
    if (document.getElementById("guhai-mask-editor-style")) return;
    const style = document.createElement("style");
    style.id = "guhai-mask-editor-style";
    style.textContent = `
.guhai-mask-root{position:fixed;inset:0;z-index:100000;background:#15171b;color:#f0f2f5;font-family:"PingFang SC","Microsoft YaHei",Arial,sans-serif;display:flex;flex-direction:column}
.guhai-mask-keyboard-sink{position:fixed;left:-10000px;top:-10000px;width:1px;height:1px;opacity:0;pointer-events:none}
.guhai-mask-toolbar{min-height:48px;display:flex;align-items:center;gap:14px;padding:8px 12px;background:#202329;border-bottom:1px solid #353a43;box-shadow:0 8px 24px rgba(0,0,0,.26);position:relative}
.guhai-mask-tools-left,.guhai-mask-tools-right{display:flex;align-items:center;gap:10px;flex:1;min-width:0}
.guhai-mask-tools-left{justify-content:flex-end;padding-right:220px}
.guhai-mask-tools-right{justify-content:flex-start;padding-left:220px}
.guhai-mask-brush-hint{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);font-size:12px;font-weight:700;color:#487d7d;white-space:nowrap;pointer-events:none}
.guhai-mask-segment{display:flex;overflow:hidden;border:1px solid #454b56;border-radius:999px;background:#181a1f}
.guhai-mask-btn{border:0;background:transparent;color:#c6cbd3;font-size:12px;font-weight:700;padding:7px 12px;cursor:pointer;line-height:1;white-space:nowrap}
.guhai-mask-btn:hover{background:#2b3038;color:#fff}
.guhai-mask-btn.active{background:#45c7bf;color:white}
.guhai-mask-icon-btn{width:30px;height:30px;border-radius:999px;border:1px solid transparent;background:transparent;color:#c6cbd3;display:inline-flex;align-items:center;justify-content:center;cursor:pointer;font-weight:800}
.guhai-mask-icon-btn:hover{background:#2b3038;color:#fff}
.guhai-mask-icon-btn:disabled{opacity:.35;cursor:default}
.guhai-mask-action{height:30px;border-radius:999px;border:1px solid #4a5260;background:transparent;color:#d7dbe2;font-size:12px;font-weight:700;padding:0 12px;cursor:pointer}
.guhai-mask-action:hover{background:#2b3038;color:#fff}
.guhai-mask-primary{height:30px;border-radius:999px;border:0;background:#45c7bf;color:white;font-size:12px;font-weight:800;padding:0 16px;cursor:pointer;box-shadow:0 3px 12px rgba(69,199,191,.35)}
.guhai-mask-primary:hover{background:#55d8d0}
.guhai-mask-swatch{width:20px;height:20px;border-radius:50%;border:1px solid #626a78;cursor:pointer;opacity:.75}
.guhai-mask-swatch.active{outline:2px solid #45c7bf;outline-offset:2px;opacity:1;transform:scale(1.06)}
.guhai-mask-stage{position:relative;flex:1;overflow:hidden;display:flex;align-items:center;justify-content:center;background:#111318;cursor:none}
.guhai-mask-frame{position:relative;display:none;box-shadow:0 10px 32px rgba(0,0,0,.45);transform-origin:center center}
.guhai-mask-frame img{display:block;max-width:90vw;max-height:calc(100vh - 110px);user-select:none;-webkit-user-drag:none}
.guhai-mask-frame canvas.guhai-mask-paint{position:absolute;inset:0;width:100%;height:100%;opacity:.5;touch-action:none;pointer-events:none}
.guhai-mask-marquee{position:absolute;inset:0;pointer-events:none;z-index:5}
.guhai-mask-cursor{position:absolute;pointer-events:none;z-index:20;border:2px solid #f5f7fb;box-shadow:0 0 0 1px #111318;border-radius:50%;display:none}
.guhai-mask-size{font-size:12px;color:#aeb5c0;font-family:"JetBrains Mono",Consolas,monospace;min-width:52px;text-align:right}
.guhai-mask-dims{position:absolute;left:0;right:0;top:100%;margin-top:6px;text-align:center;font-size:12px;color:#c8ccd3;font-family:"JetBrains Mono",Consolas,monospace;pointer-events:none}
.guhai-mask-loading{position:absolute;color:#c6cbd3;font-size:14px}
.guhai-mask-error{position:absolute;color:#ff9a9a;font-size:14px;max-width:70vw;text-align:center}
.guhai-mask-node-widget{display:flex;align-items:center;justify-content:center;gap:8px;color:#dfe6f3}
.guhai-mask-menu-entry{color:#18f0f0!important;background:rgba(0,184,184,.18)!important;font-weight:400!important}
.litecontextmenu .guhai-mask-menu-entry:hover,.litemenu-entry.guhai-mask-menu-entry:hover{background:rgba(0,184,184,.18)!important;color:#18f0f0!important}
@media (max-width:920px){
    .guhai-mask-toolbar{gap:8px}
    .guhai-mask-tools-left{padding-right:0;justify-content:flex-start}
    .guhai-mask-tools-right{padding-left:0;justify-content:flex-end}
    .guhai-mask-brush-hint{display:none}
}
`;
    document.head.appendChild(style);
    installNodes2MaskPreviewObserver();
}

class GoohaiMaskEditor {
    constructor({ imageUrl, maskUrl, maskMode, preserveRgbUnderMask = false, onSave, onClose }) {
        injectStyles();
        this.imageUrl = imageUrl;
        this.maskUrl = maskUrl;
        this.maskMode = maskMode;
        this.preserveRgbUnderMask = preserveRgbUnderMask;
        this.onSave = onSave;
        this.onClose = onClose;
        this.tool = "brush";
        this.brushColor = "green";
        this.brushSize = 60;
        this.scale = 1;
        this.offset = { x: 0, y: 0 };
        this.isDrawing = false;
        this.isPanning = false;
        this.spaceDown = false;
        this.altDown = false;
        this.shiftDown = false;
        this.shiftTemp = false;
        this.prevToolBeforeShift = null;
        this.shiftTempDrew = false;
        this.rightResize = null;
        this.lastPos = null;
        this.lastMouse = null;
        this.history = [];
        this.redo = [];
        this.marqueeRects = [];
        this.marqueeDraft = null;
        this.marqueeAction = "none";
        this.marqueeStart = null;
        this.marqueeMove = null;
        this.dashOffset = 0;
        this.marqueeEdgeCache = null;
        this.marqueeEdgeDirty = true;
        this.lastMoveRedrawAt = 0;
        this.natural = { w: 0, h: 0, sf: 1 };
        this.colors = {
            green: "hsl(142 71% 45%)",
            white: "#fff",
            black: "#000",
        };
        window._guhaiActiveMaskEditor = this;
        this.build();
        this.bind();
        this.init();
    }

    build() {
        this.root = document.createElement("div");
        this.root.className = "guhai-mask-root";
        this.root.tabIndex = -1;
        this.root.innerHTML = `
            <textarea class="guhai-mask-keyboard-sink" aria-hidden="true"></textarea>
            <div class="guhai-mask-toolbar">
                <div class="guhai-mask-tools-left">
                    <div class="guhai-mask-segment">
                        <button class="guhai-mask-btn active" data-tool="brush" title="B">\u753b\u7b14</button>
                        <button class="guhai-mask-btn" data-tool="eraser" title="E">\u6a61\u76ae\u64e6</button>
                        <button class="guhai-mask-btn" data-tool="marquee" title="M">\u9009\u6846</button>
                    </div>
                    <button class="guhai-mask-swatch active" data-color="green" title="\u7eff\u8272"></button>
                    <button class="guhai-mask-swatch" data-color="white" title="\u767d\u8272"></button>
                    <button class="guhai-mask-swatch" data-color="black" title="\u9ed1\u8272"></button>
                    <span class="guhai-mask-size">60px</span>
                </div>
                <div class="guhai-mask-brush-hint">\u9f20\u6807\u53f3\u952e\u5de6\u53f3\u62d6\u52a8\u8c03\u6574\u753b\u7b14\u5927\u5c0f</div>
                <div class="guhai-mask-tools-right">
                    <button class="guhai-mask-icon-btn" data-act="undo" title="Ctrl+Z">\u21b6</button>
                    <button class="guhai-mask-icon-btn" data-act="redo" title="Ctrl+Shift+Z">\u21b7</button>
                    <button class="guhai-mask-action" data-act="invert" title="Ctrl+I">\u53cd\u8f6c</button>
                    <button class="guhai-mask-action" data-act="clear" title="X">\u6e05\u7a7a</button>
                    <button class="guhai-mask-action" data-act="cancel" title="Esc">\u53d6\u6d88</button>
                    <button class="guhai-mask-primary" data-act="save" title="Enter">\u4fdd\u5b58\u906e\u7f69</button>
                </div>
            </div>
            <div class="guhai-mask-stage">
                <div class="guhai-mask-loading">\u52a0\u8f7d\u4e2d...</div>
                <div class="guhai-mask-frame">
                    <img draggable="false" />
                    <canvas class="guhai-mask-paint"></canvas>
                    <div class="guhai-mask-dims"></div>
                </div>
                <canvas class="guhai-mask-marquee"></canvas>
                <div class="guhai-mask-cursor"></div>
            </div>`;
        document.body.appendChild(this.root);
        this.keyboardSink = this.root.querySelector(".guhai-mask-keyboard-sink");
        this.stage = this.root.querySelector(".guhai-mask-stage");
        this.frame = this.root.querySelector(".guhai-mask-frame");
        this.img = this.root.querySelector("img");
        this.paint = this.root.querySelector(".guhai-mask-paint");
        this.marquee = this.root.querySelector(".guhai-mask-marquee");
        this.cursor = this.root.querySelector(".guhai-mask-cursor");
        this.loading = this.root.querySelector(".guhai-mask-loading");
        this.sizeText = this.root.querySelector(".guhai-mask-size");
        this.hint = this.root.querySelector(".guhai-mask-brush-hint");
        this.dims = this.root.querySelector(".guhai-mask-dims");
        this.shapeMask = document.createElement("canvas");
        for (const sw of this.root.querySelectorAll(".guhai-mask-swatch")) {
            sw.style.background = this.colors[sw.dataset.color];
        }
        this.keyboardSink.focus({ preventScroll: true });
    }

    bind() {
        // Keep keyboard focus on an editable element. ComfyUI deliberately
        // ignores workflow shortcuts originating from text editors.
        this.root.addEventListener("mousedown", (e) => {
            if (e.button !== 0 || e.target === this.keyboardSink) return;
            e.preventDefault();
            this.keyboardSink.focus({ preventScroll: true });
        }, true);
        this.root.addEventListener("click", (e) => {
            const toolBtn = e.target.closest("[data-tool]");
            if (toolBtn) this.setTool(toolBtn.dataset.tool);
            const colorBtn = e.target.closest("[data-color]");
            if (colorBtn) this.setColor(colorBtn.dataset.color);
            const act = e.target.closest("[data-act]")?.dataset.act;
            if (act === "undo") this.undo();
            if (act === "redo") this.redoAction();
            if (act === "invert") this.invert();
            if (act === "clear") this.clear();
            if (act === "cancel") this.close();
            if (act === "save") this.save();
            this.keyboardSink.focus({ preventScroll: true });
        });
        this.stage.addEventListener("mousedown", (e) => this.pointerDown(e));
        window.addEventListener("mousemove", this._move = (e) => this.pointerMove(e), true);
        window.addEventListener("mouseup", this._up = (e) => this.pointerUp(e), true);
        this.stage.addEventListener("mouseleave", () => { this.cursor.style.display = "none"; });
        this.stage.addEventListener("contextmenu", (e) => e.preventDefault());
        this.stage.addEventListener("wheel", this._wheel = (e) => this.wheel(e), { passive: false });
        // Keyboard shortcuts are routed by installMaskEditorHotkey(). Keeping
        // a second window keydown listener here would apply Ctrl+Z twice.
        window.addEventListener("keyup", this._keyUp = (e) => this.keyUp(e), true);
        window.addEventListener("resize", this._resize = () => this.redrawMarquee());
    }

    async init() {
        try {
            const prepared = await prepareEditorImage(this.imageUrl);
            this.sourceImage = prepared.sourceImage;
            this.natural = { ...prepared.natural };
            const editW = prepared.editCanvas.width;
            const editH = prepared.editCanvas.height;
            this.editImageCanvas = prepared.editCanvas;
            this.img.src = prepared.dataUrl;
            this.paint.width = editW;
            this.paint.height = editH;
            this.shapeMask.width = editW;
            this.shapeMask.height = editH;
            this.buildBaseAlphaPaint(editW, editH);
            await this.loadInitialMask(editW, editH);
            this.dims.textContent = `${editW} \u00d7 ${editH}${this.natural.sf < 1 ? `  (\u539f\u56fe ${this.natural.w} \u00d7 ${this.natural.h})` : ""}`;
            this.frame.style.display = "inline-block";
            this.loading.style.display = "none";
            this.pushHistory();
            this.startMarqueeAnimation();
            this.updateToolbar();
        } catch (err) {
            this.loading.className = "guhai-mask-error";
            this.loading.textContent = `\u56fe\u7247\u52a0\u8f7d\u5931\u8d25: ${err?.message || err}`;
        }
    }

    buildBaseAlphaPaint(editW, editH) {
        if (!this.editImageCanvas) return;
        try {
            const data = this.editImageCanvas.getContext("2d").getImageData(0, 0, editW, editH);
            let hasTransparent = false;
            for (let i = 3; i < data.data.length; i += 4) {
                if (data.data[i] < 250) {
                    hasTransparent = true;
                    break;
                }
            }
            if (!hasTransparent) return;
            const base = document.createElement("canvas");
            base.width = editW;
            base.height = editH;
            const out = base.getContext("2d").createImageData(editW, editH);
            const [r, g, b] = this.colorRgb();
            for (let i = 0; i < data.data.length; i += 4) {
                if (data.data[i + 3] < 250) {
                    out.data[i] = r;
                    out.data[i + 1] = g;
                    out.data[i + 2] = b;
                    out.data[i + 3] = 255;
                }
            }
            base.getContext("2d").putImageData(out, 0, 0);
            this.baseAlphaPaint = base;
        } catch (_) {}
    }

    restoreBaseAlphaPaint() {
        if (!this.baseAlphaPaint) return;
        const ctx = this.paint.getContext("2d");
        ctx.drawImage(this.baseAlphaPaint, 0, 0);
    }

    async loadInitialMask(editW, editH) {
        if (!this.maskUrl) return;
        try {
            const maskImg = await loadImage(this.maskUrl);
            const tmp = document.createElement("canvas");
            tmp.width = editW;
            tmp.height = editH;
            const tctx = tmp.getContext("2d");
            tctx.imageSmoothingEnabled = false;
            tctx.drawImage(maskImg, 0, 0, editW, editH);
            const data = tctx.getImageData(0, 0, editW, editH);
            const isLumaMask = this.maskMode === "mask-luma";
            let hasTransparent = false;
            let hasOpaque = false;
            if (!isLumaMask) {
                for (let i = 3; i < data.data.length; i += 4) {
                    if (data.data[i] < 250) hasTransparent = true;
                    if (data.data[i] > 5) hasOpaque = true;
                    if (hasTransparent && hasOpaque) break;
                }
                if (!hasTransparent) return;
            }
            const out = this.paint.getContext("2d").createImageData(editW, editH);
            const [r, g, b] = this.colorRgb();
            for (let i = 0; i < data.data.length; i += 4) {
                const a = data.data[i + 3];
                const masked = isLumaMask
                    ? data.data[i] > 127
                    : a < 250;
                if (masked) {
                    out.data[i] = r;
                    out.data[i + 1] = g;
                    out.data[i + 2] = b;
                    out.data[i + 3] = 255;
                }
            }
            this.paint.getContext("2d").putImageData(out, 0, 0);
        } catch (_) {
            // Existing mask restore is best-effort; the editor can still open blank.
        }
    }

    setTool(tool) {
        if (tool !== "marquee" && this.marqueeRects.length) {
            this.fillMarqueeIntoMask();
        }
        this.tool = tool;
        this.updateToolbar();
    }

    setColor(color) {
        this.brushColor = color;
        this.root.querySelectorAll("[data-color]").forEach((b) => b.classList.toggle("active", b.dataset.color === color));
        this.recolorMask();
        this.updateCursor();
    }

    updateToolbar() {
        this.root.querySelectorAll("[data-tool]").forEach((b) => b.classList.toggle("active", b.dataset.tool === this.tool));
        const marquee = this.tool === "marquee";
        this.sizeText.style.visibility = marquee ? "hidden" : "";
        this.hint.textContent = marquee
            ? "Shift=1:1/\u52a0\u9009\u533a \u00b7 Alt=\u51cf\u9009\u533a \u00b7 \u6846\u5185\u62d6\u52a8\u79fb\u52a8 \u00b7 \u5916\u90e8\u5355\u51fb\u53d6\u6d88"
            : "\u9f20\u6807\u53f3\u952e\u5de6\u53f3\u62d6\u52a8\u8c03\u6574\u753b\u7b14\u5927\u5c0f";
        this.updateCursor();
    }

    keyDown(e) {
        if (this.isEditable(e.target) && e.target !== this.keyboardSink) return;
        const ctrl = e.ctrlKey || e.metaKey;
        const key = e.key;
        const consume = () => {
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation?.();
        };
        if (ctrl && !e.shiftKey && key.toLowerCase() === "z") { consume(); this.undo(); return; }
        if (ctrl && e.shiftKey && (key.toLowerCase() === "z" || key.toLowerCase() === "y")) { consume(); this.redoAction(); return; }
        if (ctrl && !e.shiftKey && key.toLowerCase() === "i") { consume(); this.invert(); return; }
        if (!ctrl && key.toLowerCase() === "b") { consume(); this.setTool("brush"); return; }
        if (!ctrl && key.toLowerCase() === "e") { consume(); this.setTool("eraser"); return; }
        if (!ctrl && key.toLowerCase() === "m") { consume(); this.setTool("marquee"); return; }
        if (!ctrl && key.toLowerCase() === "x") { consume(); this.clear(); return; }
        if (!ctrl && key === "Enter") { consume(); this.save(); return; }
        if (!ctrl && key === "Escape") { consume(); this.close(); return; }
        if (!ctrl && (key === "[" || key === "\u3010")) { consume(); this.setBrushSize(this.brushSize - 5); return; }
        if (!ctrl && (key === "]" || key === "\u3011")) { consume(); this.setBrushSize(this.brushSize + 5); return; }
        if (key === " ") { consume(); this.spaceDown = true; this.updateCursor(); }
        if (key === "Alt") { consume(); this.altDown = true; this.updateCursor(); }
        if (key === "Shift" && !this.shiftDown) {
            this.shiftDown = true;
            if (this.tool !== "marquee") {
                this.prevToolBeforeShift = this.tool;
                this.shiftTemp = true;
                this.shiftTempDrew = false;
                this.tool = "marquee";
                this.updateToolbar();
            }
        }
    }

    keyUp(e) {
        if (this.isEditable(e.target) && e.target !== this.keyboardSink) return;
        if (e.key === " ") { this.spaceDown = false; this.updateCursor(); }
        if (e.key === "Alt") { this.altDown = false; this.updateCursor(); }
        if (e.key === "Shift") {
            this.shiftDown = false;
            if (this.shiftTemp) {
                if (!this.shiftTempDrew && this.prevToolBeforeShift) {
                    this.tool = this.prevToolBeforeShift;
                }
                this.shiftTemp = false;
                this.prevToolBeforeShift = null;
                this.updateToolbar();
            }
        }
    }

    isEditable(t) {
        return t instanceof HTMLElement && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);
    }

    setBrushSize(v) {
        this.brushSize = clamp(v, 2, 300);
        this.sizeText.textContent = `${this.brushSize}px`;
        this.updateCursor();
    }

    wheel(e) {
        e.preventDefault();
        const factor = e.deltaY < 0 ? 1.12 : 0.89;
        const next = clamp(this.scale * factor, 0.05, 12);
        const rect = this.stage.getBoundingClientRect();
        const mx = e.clientX - rect.left - rect.width / 2;
        const my = e.clientY - rect.top - rect.height / 2;
        const ratio = next / this.scale;
        this.offset = {
            x: mx + (this.offset.x - mx) * ratio,
            y: my + (this.offset.y - my) * ratio,
        };
        this.scale = next;
        this.applyTransform();
    }

    applyTransform() {
        this.frame.style.transform = `translate(${this.offset.x}px, ${this.offset.y}px) scale(${this.scale})`;
        this.updateCursor();
        this.redrawMarquee();
    }

    canvasPos(e) {
        const r = this.paint.getBoundingClientRect();
        return {
            x: (e.clientX - r.left) * this.paint.width / r.width,
            y: (e.clientY - r.top) * this.paint.height / r.height,
        };
    }

    pointerDown(e) {
        if (!this.paint.width) return;
        this.lastMouse = { x: e.clientX, y: e.clientY };
        if (e.button === 2 && this.tool !== "marquee") {
            e.preventDefault();
            this.rightResize = { x: e.clientX, size: this.brushSize };
            return;
        }
        if (this.spaceDown || e.button === 1) {
            this.isPanning = true;
            this.panStart = { x: e.clientX, y: e.clientY, ox: this.offset.x, oy: this.offset.y };
            return;
        }
        if (this.tool === "marquee") {
            this.marqueeDown(e);
            return;
        }
        if (e.button !== 0) return;
        if (this.marqueeRects.length) this.fillMarqueeIntoMask();
        this.isDrawing = true;
        this.lastPos = this.canvasPos(e);
        const ctx = this.paint.getContext("2d");
        this.applyBrush(ctx);
        ctx.beginPath();
        ctx.arc(this.lastPos.x, this.lastPos.y, this.brushSize / 2, 0, Math.PI * 2);
        ctx.fill();
    }

    pointerMove(e) {
        this.lastMouse = { x: e.clientX, y: e.clientY };
        if (this.rightResize) {
            e.preventDefault();
            this.setBrushSize(this.rightResize.size + Math.round((e.clientX - this.rightResize.x) / 2));
            return;
        }
        this.updateCursor(e);
        if (this.isPanning && this.panStart) {
            this.offset = {
                x: this.panStart.ox + e.clientX - this.panStart.x,
                y: this.panStart.oy + e.clientY - this.panStart.y,
            };
            this.applyTransform();
            return;
        }
        if (this.tool === "marquee" && this.marqueeAction !== "none") {
            this.marqueeMoveAction(e);
            return;
        }
        if (!this.isDrawing || !this.lastPos) return;
        const pos = this.canvasPos(e);
        const ctx = this.paint.getContext("2d");
        this.applyBrush(ctx);
        ctx.beginPath();
        ctx.moveTo(this.lastPos.x, this.lastPos.y);
        ctx.lineTo(pos.x, pos.y);
        ctx.stroke();
        this.lastPos = pos;
    }

    pointerUp() {
        if (this.rightResize) {
            this.rightResize = null;
            return;
        }
        if (this.isPanning) {
            this.isPanning = false;
            return;
        }
        if (this.tool === "marquee" && this.marqueeAction !== "none") {
            this.marqueeUp();
            return;
        }
        if (this.isDrawing) {
            this.isDrawing = false;
            this.pushHistory();
        }
    }

    applyBrush(ctx) {
        const eraser = this.tool === "eraser" || this.altDown;
        ctx.lineWidth = this.brushSize;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.globalCompositeOperation = eraser ? "destination-out" : "source-over";
        ctx.strokeStyle = eraser ? "#fff" : this.colors[this.brushColor];
        ctx.fillStyle = eraser ? "#fff" : this.colors[this.brushColor];
    }

    updateCursor(e) {
        if (!this.lastMouse && !e) return;
        const p = e ? { x: e.clientX, y: e.clientY } : this.lastMouse;
        if (!p) return;
        if (this.spaceDown) {
            this.cursor.style.display = "none";
            this.stage.style.cursor = "grab";
            return;
        }
        if (this.tool === "marquee") {
            this.cursor.style.display = "none";
            this.stage.style.cursor = "crosshair";
            return;
        }
        this.stage.style.cursor = "none";
        const r = this.stage.getBoundingClientRect();
        const displayScale = (this.img.clientWidth || this.paint.getBoundingClientRect().width) / Math.max(1, this.paint.width);
        const size = Math.max(4, this.brushSize * this.scale * displayScale);
        Object.assign(this.cursor.style, {
            display: "block",
            width: `${size}px`,
            height: `${size}px`,
            left: `${p.x - r.left - size / 2}px`,
            top: `${p.y - r.top - size / 2}px`,
        });
    }

    pushHistory() {
        const ctx = this.paint.getContext("2d");
        this.history.push(ctx.getImageData(0, 0, this.paint.width, this.paint.height));
        if (this.history.length > 50) this.history.shift();
        this.redo = [];
    }

    undo() {
        if (this.history.length <= 1) return;
        const ctx = this.paint.getContext("2d");
        this.redo.push(this.history.pop());
        ctx.putImageData(this.history[this.history.length - 1], 0, 0);
        this.clearMarquee();
    }

    redoAction() {
        if (!this.redo.length) return;
        const snap = this.redo.pop();
        this.history.push(snap);
        this.paint.getContext("2d").putImageData(snap, 0, 0);
        this.clearMarquee();
    }

    clear() {
        const ctx = this.paint.getContext("2d");
        ctx.clearRect(0, 0, this.paint.width, this.paint.height);
        this.clearMarquee();
        this.pushHistory();
    }

    invert() {
        this.fillMarqueeIntoMask();
        const ctx = this.paint.getContext("2d");
        const data = ctx.getImageData(0, 0, this.paint.width, this.paint.height);
        const [r, g, b] = this.colorRgb();
        for (let i = 0; i < data.data.length; i += 4) {
            if (data.data[i + 3] > 0) data.data[i + 3] = 0;
            else {
                data.data[i] = r; data.data[i + 1] = g; data.data[i + 2] = b; data.data[i + 3] = 255;
            }
        }
        ctx.putImageData(data, 0, 0);
        this.clearMarquee();
        this.pushHistory();
    }

    colorRgb() {
        const c = document.createElement("canvas");
        c.width = 1; c.height = 1;
        const ctx = c.getContext("2d");
        ctx.fillStyle = this.colors[this.brushColor];
        ctx.fillRect(0, 0, 1, 1);
        return Array.from(ctx.getImageData(0, 0, 1, 1).data);
    }

    recolorMask() {
        if (!this.paint.width) return;
        const ctx = this.paint.getContext("2d");
        const data = ctx.getImageData(0, 0, this.paint.width, this.paint.height);
        const [r, g, b] = this.colorRgb();
        let changed = false;
        for (let i = 0; i < data.data.length; i += 4) {
            if (data.data[i + 3] > 0) {
                data.data[i] = r;
                data.data[i + 1] = g;
                data.data[i + 2] = b;
                changed = true;
            }
        }
        if (changed) ctx.putImageData(data, 0, 0);
    }

    clearMarquee() {
        this.marqueeRects = [];
        this.marqueeDraft = null;
        this.shapeMask.getContext("2d").clearRect(0, 0, this.shapeMask.width, this.shapeMask.height);
        this.marqueeEdgeDirty = true;
        this.redrawMarquee();
    }

    marqueeDown(e) {
        if (e.button !== 0) return;
        const pos = this.canvasPos(e);
        const inside = this.pointInShape(pos.x, pos.y);
        if (!this.shiftDown && !this.altDown && inside && this.marqueeRects.length) {
            this.marqueeAction = "move";
            this.marqueeMove = {
                start: pos,
                snap: this.cloneShape(),
                bbox: this.maskBBox(),
                rects: this.marqueeRects.map((r) => ({ ...r })),
                edgeCache: this.marqueeEdgeCache || this.buildMarqueeEdgeCache(),
            };
            return;
        }
        if (!this.shiftDown && !this.altDown) this.clearMarquee();
        this.marqueeAction = "draw";
        const square = this.shiftDown && !this.shiftTemp && !this.altDown && this.marqueeRects.length === 0;
        const mode = this.altDown ? "subtract" : (this.shiftDown && this.marqueeRects.length > 0 ? "add" : "new");
        this.marqueeStart = { x: pos.x, y: pos.y, mode, square };
        this.marqueeDraft = { x: pos.x, y: pos.y, w: 0, h: 0 };
        this.marqueeEdgeDirty = true;
        this.redrawMarquee();
    }

    marqueeMoveAction(e) {
        const pos = this.canvasPos(e);
        if (this.marqueeAction === "draw" && this.marqueeStart) {
            let w = pos.x - this.marqueeStart.x;
            let h = pos.y - this.marqueeStart.y;
            if (this.marqueeStart.square) {
                const s = Math.max(Math.abs(w), Math.abs(h));
                w = Math.sign(w || 1) * s;
                h = Math.sign(h || 1) * s;
            }
            this.marqueeDraft = this.normalizeRect(this.marqueeStart.x, this.marqueeStart.y, w, h);
            this.marqueeEdgeDirty = true;
            this.redrawMarquee();
        }
        if (this.marqueeAction === "move" && this.marqueeMove) {
            const bbox = this.marqueeMove.bbox;
            let dx = Math.round(pos.x - this.marqueeMove.start.x);
            let dy = Math.round(pos.y - this.marqueeMove.start.y);
            if (bbox) {
                if (bbox.minX + dx < 0) dx = -bbox.minX;
                if (bbox.minY + dy < 0) dy = -bbox.minY;
                if (bbox.maxX + dx + 1 > this.paint.width) dx = this.paint.width - bbox.maxX - 1;
                if (bbox.maxY + dy + 1 > this.paint.height) dy = this.paint.height - bbox.maxY - 1;
            }
            this.marqueeMove.dx = dx;
            this.marqueeMove.dy = dy;
            this.marqueeEdgeDirty = false;
            const now = performance.now();
            if (now - this.lastMoveRedrawAt > 33) {
                this.lastMoveRedrawAt = now;
                this.redrawMarquee();
            }
        }
    }

    marqueeUp() {
        if (this.marqueeAction === "draw" && this.marqueeDraft && this.marqueeDraft.w > 1 && this.marqueeDraft.h > 1) {
            const r = this.clipRect(this.marqueeDraft);
            if (r.w > 0 && r.h > 0) {
                this.addRectToShape(r, this.marqueeStart?.mode === "subtract");
                if (this.marqueeStart?.mode === "subtract") {
                    this.marqueeRects = this.rectsFromShape();
                } else {
                    this.marqueeRects.push(r);
                }
                this.marqueeEdgeDirty = true;
                if (this.shiftTemp) {
                    this.shiftTempDrew = true;
                    this.tool = "marquee";
                    this.shiftTemp = false;
                    this.prevToolBeforeShift = null;
                }
            }
        }
        if (this.marqueeAction === "move" && this.marqueeMove) {
            const ctx = this.shapeMask.getContext("2d");
            ctx.clearRect(0, 0, this.shapeMask.width, this.shapeMask.height);
            ctx.drawImage(this.marqueeMove.snap, this.marqueeMove.dx || 0, this.marqueeMove.dy || 0);
            this.marqueeRects = this.marqueeMove.rects.map((r) => ({
                x: r.x + (this.marqueeMove.dx || 0),
                y: r.y + (this.marqueeMove.dy || 0),
                w: r.w,
                h: r.h,
            }));
            this.marqueeEdgeDirty = true;
        }
        this.marqueeAction = "none";
        this.marqueeDraft = null;
        this.marqueeStart = null;
        this.marqueeMove = null;
        this.redrawMarquee();
        this.updateToolbar();
    }

    normalizeRect(x, y, w, h) {
        if (w < 0) { x += w; w = -w; }
        if (h < 0) { y += h; h = -h; }
        return { x, y, w, h };
    }

    clipRect(r) {
        const x = clamp(r.x, 0, this.paint.width);
        const y = clamp(r.y, 0, this.paint.height);
        const x2 = clamp(r.x + r.w, 0, this.paint.width);
        const y2 = clamp(r.y + r.h, 0, this.paint.height);
        return { x, y, w: x2 - x, h: y2 - y };
    }

    addRectToShape(r, subtract) {
        const ctx = this.shapeMask.getContext("2d");
        ctx.save();
        ctx.globalCompositeOperation = subtract ? "destination-out" : "source-over";
        ctx.fillStyle = "#fff";
        ctx.fillRect(Math.round(r.x), Math.round(r.y), Math.round(r.w), Math.round(r.h));
        ctx.restore();
    }

    pointInShape(x, y) {
        if (x < 0 || y < 0 || x >= this.shapeMask.width || y >= this.shapeMask.height) return false;
        return this.shapeMask.getContext("2d").getImageData(Math.floor(x), Math.floor(y), 1, 1).data[3] > 0;
    }

    cloneShape() {
        const c = document.createElement("canvas");
        c.width = this.shapeMask.width;
        c.height = this.shapeMask.height;
        c.getContext("2d").drawImage(this.shapeMask, 0, 0);
        return c;
    }

    maskBBox() {
        const d = this.shapeMask.getContext("2d").getImageData(0, 0, this.shapeMask.width, this.shapeMask.height).data;
        let minX = this.shapeMask.width, minY = this.shapeMask.height, maxX = -1, maxY = -1;
        for (let y = 0; y < this.shapeMask.height; y++) {
            for (let x = 0; x < this.shapeMask.width; x++) {
                if (d[(y * this.shapeMask.width + x) * 4 + 3] > 0) {
                    minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
                }
            }
        }
        return maxX < minX ? null : { minX, minY, maxX, maxY };
    }

    rectsFromShape() {
        const bb = this.maskBBox();
        return bb ? [{ x: bb.minX, y: bb.minY, w: bb.maxX - bb.minX + 1, h: bb.maxY - bb.minY + 1 }] : [];
    }

    fillMarqueeIntoMask() {
        if (!this.maskBBox()) return;
        const ctx = this.paint.getContext("2d");
        const layer = document.createElement("canvas");
        layer.width = this.paint.width;
        layer.height = this.paint.height;
        const lctx = layer.getContext("2d");
        lctx.fillStyle = this.colors[this.brushColor];
        lctx.fillRect(0, 0, layer.width, layer.height);
        lctx.globalCompositeOperation = "destination-in";
        lctx.drawImage(this.shapeMask, 0, 0);
        ctx.globalCompositeOperation = this.altDown || this.tool === "eraser" ? "destination-out" : "source-over";
        ctx.drawImage(layer, 0, 0);
        ctx.globalCompositeOperation = "source-over";
        this.clearMarquee();
        this.pushHistory();
    }

    startMarqueeAnimation() {
        let last = performance.now();
        const tick = (now) => {
            if (!document.hidden) {
                this.dashOffset = (this.dashOffset + (now - last) * 0.03) % 8;
                this.redrawMarquee();
            }
            last = now;
            this.raf = requestAnimationFrame(tick);
        };
        this.raf = requestAnimationFrame(tick);
    }

    buildMarqueeEdgeCache() {
        if (!this.paint.width) return null;
        const mask = document.createElement("canvas");
        mask.width = this.paint.width;
        mask.height = this.paint.height;
        const mctx = mask.getContext("2d");
        if (this.marqueeMove?.snap) {
            mctx.drawImage(this.marqueeMove.snap, this.marqueeMove.dx || 0, this.marqueeMove.dy || 0);
        } else {
            mctx.drawImage(this.shapeMask, 0, 0);
        }
        if (this.marqueeDraft) {
            mctx.save();
            mctx.globalCompositeOperation = this.marqueeStart?.mode === "subtract" ? "destination-out" : "source-over";
            mctx.fillStyle = "#fff";
            mctx.fillRect(
                Math.round(this.marqueeDraft.x),
                Math.round(this.marqueeDraft.y),
                Math.round(this.marqueeDraft.w),
                Math.round(this.marqueeDraft.h),
            );
            mctx.restore();
        }
        const boundRects = this.marqueeMove?.rects
            ? this.marqueeMove.rects.map((r) => ({ x: r.x + (this.marqueeMove.dx || 0), y: r.y + (this.marqueeMove.dy || 0), w: r.w, h: r.h }))
            : this.marqueeRects.slice();
        if (this.marqueeDraft) boundRects.push(this.marqueeDraft);
        if (!boundRects.length) return { points: [] };
        const x0 = clamp(Math.floor(Math.min(...boundRects.map((r) => r.x))) - 2, 0, mask.width);
        const y0 = clamp(Math.floor(Math.min(...boundRects.map((r) => r.y))) - 2, 0, mask.height);
        const x1 = clamp(Math.ceil(Math.max(...boundRects.map((r) => r.x + r.w))) + 2, 0, mask.width);
        const y1 = clamp(Math.ceil(Math.max(...boundRects.map((r) => r.y + r.h))) + 2, 0, mask.height);
        const data = mctx.getImageData(x0, y0, x1 - x0, y1 - y0).data;
        const ww = x1 - x0;
        const hh = y1 - y0;
        const has = (x, y) => x >= 0 && y >= 0 && x < ww && y < hh && data[(y * ww + x) * 4 + 3] > 0;
        const points = [];
        for (let y = 0; y < hh; y++) {
            for (let x = 0; x < ww; x++) {
                if (!has(x, y)) continue;
                if (has(x - 1, y) && has(x + 1, y) && has(x, y - 1) && has(x, y + 1)) continue;
                points.push([x + x0, y + y0]);
            }
        }
        if (points.length > 12000) {
            const step = Math.ceil(points.length / 12000);
            return { points: points.filter((_, i) => i % step === 0) };
        }
        return { points };
    }

    redrawMarquee() {
        if (!this.marquee) return;
        const rect = this.stage.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        const w = Math.round(rect.width * dpr);
        const h = Math.round(rect.height * dpr);
        if (this.marquee.width !== w || this.marquee.height !== h) {
            this.marquee.width = w; this.marquee.height = h;
            this.marquee.style.width = `${rect.width}px`; this.marquee.style.height = `${rect.height}px`;
        }
        const ctx = this.marquee.getContext("2d");
        ctx.clearRect(0, 0, w, h);
        if (!this.paint.width) return;
        const pr = this.paint.getBoundingClientRect();
        const sr = this.stage.getBoundingClientRect();
        const ox = (pr.left - sr.left) * dpr;
        const oy = (pr.top - sr.top) * dpr;
        const sx = pr.width / this.paint.width * dpr;
        const sy = pr.height / this.paint.height * dpr;

        if (this.marqueeMove?.edgeCache) {
            this.marqueeEdgeCache = this.marqueeMove.edgeCache;
            this.marqueeEdgeDirty = false;
        } else if (this.marqueeEdgeDirty || !this.marqueeEdgeCache) {
            this.marqueeEdgeCache = this.buildMarqueeEdgeCache();
            this.marqueeEdgeDirty = false;
        }
        const points = this.marqueeEdgeCache?.points || [];
        if (!points.length) return;
        const phase = this.dashOffset % 8;
        ctx.save();
        const mdx = this.marqueeMove?.edgeCache ? (this.marqueeMove.dx || 0) : 0;
        const mdy = this.marqueeMove?.edgeCache ? (this.marqueeMove.dy || 0) : 0;
        for (const [x, y] of points) {
            const px = x + mdx;
            const py = y + mdy;
            const on = (((px + py - phase) % 8 + 8) % 8) < 4;
            ctx.fillStyle = on ? "#fff" : "#000";
            ctx.fillRect(ox + px * sx, oy + py * sy, Math.max(1, sx), Math.max(1, sy));
        }
        ctx.restore();
    }

    save() {
        try {
            this.fillMarqueeIntoMask();
            const sourceImage = this.sourceImage || this.img;
            const editImage = this.editImageCanvas || this.img;
            const sourceUrl = this.imageUrl;
            // Freeze the exact editor result before starting any async upload.
            // This prevents a workflow undo/configure event from changing the
            // canvas or node state while the save task is being prepared.
            const paint = document.createElement("canvas");
            paint.width = this.paint.width;
            paint.height = this.paint.height;
            paint.getContext("2d").drawImage(this.paint, 0, 0);
            const savePaint = document.createElement("canvas");
            savePaint.width = paint.width;
            savePaint.height = paint.height;
            const savePaintCtx = savePaint.getContext("2d");
            savePaintCtx.drawImage(paint, 0, 0);
            // For the official loader, preserve transparent source pixels.
            // The Goohai loader's mask is editor state and must never be
            // reintroduced after Ctrl+Z/Clear.
            if (this.preserveRgbUnderMask && this.baseAlphaPaint) {
                savePaintCtx.drawImage(this.baseAlphaPaint, 0, 0);
            }
            const natW = this.natural.w || savePaint.width;
            const natH = this.natural.h || savePaint.height;
            // Build the green composite immediately, independently of the
            // uploads. The legacy canvas can display this before the image
            // widget points at the black alpha-mask file.
            const previewTask = (async () => {
                await nextFrame();
                const preview = document.createElement("canvas");
                preview.width = natW;
                preview.height = natH;
                const pctx = preview.getContext("2d");
                pctx.drawImage(sourceImage || editImage, 0, 0, natW, natH);
                const green = document.createElement("canvas");
                green.width = natW;
                green.height = natH;
                const gctx = green.getContext("2d");
                gctx.imageSmoothingEnabled = false;
                gctx.drawImage(savePaint, 0, 0, natW, natH);
                gctx.globalCompositeOperation = "source-in";
                gctx.fillStyle = "#2ad270";
                gctx.fillRect(0, 0, natW, natH);
                pctx.globalAlpha = 0.5;
                pctx.drawImage(green, 0, 0);
                pctx.globalAlpha = 1;
                return await canvasToObjectUrl(preview, "image/jpeg", 0.88);
            })();
            const task = (async () => {
                await nextFrame();
                const ts = Date.now();

                const masked = document.createElement("canvas");
                masked.width = natW;
                masked.height = natH;
                const mctx = masked.getContext("2d");
                mctx.drawImage(sourceImage, 0, 0, natW, natH);
                let officialMaskedBlob = null;
                if (this.preserveRgbUnderMask) {
                    const maskCanvas = document.createElement("canvas");
                    maskCanvas.width = natW;
                    maskCanvas.height = natH;
                    const maskCtx = maskCanvas.getContext("2d");
                    maskCtx.imageSmoothingEnabled = false;
                    maskCtx.drawImage(savePaint, 0, 0, natW, natH);
                    const imageData = mctx.getImageData(0, 0, natW, natH);
                    const maskData = maskCtx.getImageData(0, 0, natW, natH).data;
                    for (let i = 0; i < imageData.data.length; i += 4) {
                        const originalAlpha = imageData.data[i + 3];
                        if (originalAlpha < 250) {
                            imageData.data[i] = 255;
                            imageData.data[i + 1] = 255;
                            imageData.data[i + 2] = 255;
                        }
                        if (maskData[i + 3] > 5) imageData.data[i + 3] = 1;
                    }
                    officialMaskedBlob = await rgbaToPngBlob(imageData.data, natW, natH);
                } else {
                    mctx.globalCompositeOperation = "destination-out";
                    mctx.imageSmoothingEnabled = false;
                    mctx.drawImage(savePaint, 0, 0, natW, natH);
                    mctx.globalCompositeOperation = "source-over";
                }

                const uploads = [
                    uploadImageUrl(sourceUrl, `clipspace-painted-${ts}.png`).catch(async () => {
                        const original = document.createElement("canvas");
                        original.width = natW;
                        original.height = natH;
                        original.getContext("2d").drawImage(sourceImage, 0, 0, natW, natH);
                        return uploadCanvas(original, `clipspace-painted-${ts}.png`);
                    }),
                    officialMaskedBlob
                        ? uploadBlob(officialMaskedBlob, `clipspace-painted-masked-${ts}.png`, "clipspace")
                        : uploadCanvas(masked, `clipspace-painted-masked-${ts}.png`),
                ];
                const [, uploadedMasked] = await Promise.all(uploads);

                const uploadedName = uploadedMasked.name || uploadedMasked.filename || `clipspace-painted-masked-${ts}.png`;
                const uploadedPath = `${uploadedMasked.subfolder ? `${uploadedMasked.subfolder}/` : ""}${uploadedName} [input]`;
                return { value: uploadedPath, previewTask };
            })();
            this.onSave(task, previewTask);
            this.close();
        } catch (err) {
            alert(`\u4fdd\u5b58\u906e\u7f69\u5931\u8d25: ${err?.message || err}`);
        }
    }

    close() {
        if (this.raf) cancelAnimationFrame(this.raf);
        if (window._guhaiActiveMaskEditor === this) window._guhaiActiveMaskEditor = null;
        window.removeEventListener("mousemove", this._move, true);
        window.removeEventListener("mouseup", this._up, true);
        window.removeEventListener("keyup", this._keyUp, true);
        window.removeEventListener("resize", this._resize);
        this.root.remove();
        this.onClose?.();
    }
}

function hideBulkyWidgets(node) {
    for (const w of node.widgets || []) {
        const type = String(w.type || "").toLowerCase();
        const isTransparentToggle = w.name !== "guhai_mask_icon_controls"
            && w.name !== "image"
            && (type === "toggle" || type === "boolean" || type.includes("boolean"));
        if (w.name === "upload" || w.name === "guhai_mask_editor" || isTransparentToggle) {
            w.hidden = true;
            w.computeSize = () => [0, -4];
            if (!isTransparentToggle) w.serialize = false;
        }
    }
}

function findImageWidget(node) {
    return node.widgets?.find((w) => w.name === "image");
}

function isEmptyImageValue(value) {
    const normalized = String(value ?? "").trim();
    return !normalized || normalized === "无";
}

function keepEmptyLoadImageNodeInteractive(node) {
    const imageWidget = findImageWidget(node);
    if (!imageWidget || !isEmptyImageValue(imageWidget.value)) return;
    node.imgs = null;
    node.imageIndex = null;
    const width = Math.max(350, Number(node.size?.[0]) || 0);
    const height = Math.max(500, Number(node.size?.[1]) || 0);
    if (node.size?.[0] !== width || node.size?.[1] !== height) {
        node.setSize?.([width, height]);
        node.size = [width, height];
    }
    node.setDirtyCanvas(true, true);
    app.graph?.setDirtyCanvas?.(true, true);
}

function protectNodeValueDuringMaskEdit(node, configure) {
    const imageWidget = findImageWidget(node);
    const editingValue = node?._guhaiMaskEditorActive && imageWidget
        ? imageWidget.value
        : undefined;
    const editingProperty = node?._guhaiMaskEditorActive
        ? node.properties?.guhaiImageValue
        : undefined;
    configure?.();
    if (editingValue !== undefined && node._guhaiMaskEditorActive && imageWidget) {
        // LiteGraph workflow undo can call configure() while the editor is
        // open. Keep that operation from replacing the value being edited.
        imageWidget.value = editingValue;
        node.properties ||= {};
        node.properties.guhaiImageValue = editingProperty ?? String(editingValue);
    }
}

function persistLoadImageState(node) {
    const imageWidget = findImageWidget(node);
    if (!imageWidget) return;
    node.properties ||= {};
    if (imageWidget.value !== undefined && imageWidget.value !== null) {
        node.properties.guhaiImageValue = String(imageWidget.value);
    }
    const transparentWidget = findTransparentWidget(node);
    if (transparentWidget) {
        node.properties.guhaiPreserveAlpha = !!transparentWidget.value;
    }
    if (imageWidget.value && imageWidget.options?.values && !imageWidget.options.values.includes(imageWidget.value)) {
        imageWidget.options.values.push(imageWidget.value);
    }
}

function restoreLoadImageState(node) {
    // Do not let ComfyUI's workflow undo/configure cycle overwrite the value
    // while the mask editor is open. The editor owns the pending result until
    // its save callback finishes.
    if (node?._guhaiMaskEditorActive) return;
    const imageWidget = findImageWidget(node);
    if (!imageWidget) return;
    const saved = node.properties?.guhaiImageValue;
    if (saved && (!imageWidget.value || imageWidget.value === "无")) imageWidget.value = saved;
    const transparentWidget = findTransparentWidget(node);
    if (transparentWidget) {
        const hasSavedMode = Object.prototype.hasOwnProperty.call(node.properties || {}, "guhaiPreserveAlpha");
        transparentWidget.value = hasSavedMode ? !!node.properties.guhaiPreserveAlpha : false;
    }
    persistLoadImageState(node);
}

function installLoadImagePersistence(node) {
    const imageWidget = findImageWidget(node);
    if (!imageWidget || imageWidget._guhaiPersistWrapped) return;
    const originalCallback = imageWidget.callback;
    imageWidget.callback = function () {
        const skipOriginalPreview = !!node._guhaiSkipOriginalImageCallback;
        const result = skipOriginalPreview ? undefined : originalCallback?.apply(this, arguments);
        persistLoadImageState(node);
        if (isEmptyImageValue(imageWidget.value)) {
            keepEmptyLoadImageNodeInteractive(node);
            // The stock image widget can finish clearing its preview after the
            // callback returns. Re-assert the empty interactive state after
            // those asynchronous preview updates have settled.
            requestAnimationFrame(() => keepEmptyLoadImageNodeInteractive(node));
            setTimeout(() => keepEmptyLoadImageNodeInteractive(node), 100);
            setTimeout(() => keepEmptyLoadImageNodeInteractive(node), 500);
        }
        return result;
    };
    imageWidget._guhaiPersistWrapped = true;
    persistLoadImageState(node);
}

function nodeHasMask(node) {
    const imageWidget = findImageWidget(node);
    const value = String(imageWidget?.value || "");
    return !!node?._guhaiMaskSaving || value.includes("painted-masked") || value.includes("clipspace-mask-");
}

function findTransparentWidget(node) {
    return node.widgets?.find((w) => {
        const type = String(w.type || "").toLowerCase();
        return w.name !== "guhai_mask_icon_controls"
            && w.name !== "image"
            && (type === "toggle" || type === "boolean" || type.includes("boolean"));
    });
}

function getPreviewButtonY(node) {
    let y = 96;
    for (const w of node.widgets || []) {
        if (w.hidden || w.name === "$$canvas-image-preview") continue;
        const wy = Number(w.last_y ?? w.y ?? 0);
        const wh = Number(w.last_h ?? w.height ?? 30);
        if (wy > 0) y = Math.max(y, wy + wh + 20);
    }
    return Math.min(Math.max(y, 92), Math.max(92, node.size[1] - 72));
}

function getPreviewRect(node) {
    const img = node.imgs?.[node.imageIndex ?? 0] || node.imgs?.[0];
    const widgetsBottom = getPreviewButtonY(node) - 12;
    const top = Math.max(92, widgetsBottom + 8);
    const bottomPad = 22;
    const maxW = Math.max(80, node.size[0] - 64);
    const maxH = Math.max(80, node.size[1] - top - bottomPad);
    if (!img) {
        return { x: 32, y: top, w: maxW, h: maxH };
    }
    const iw = img.naturalWidth || img.width || 1;
    const ih = img.naturalHeight || img.height || 1;
    const s = Math.min(maxW / iw, maxH / ih);
    const w = iw * s;
    const h = ih * s;
    return {
        x: (node.size[0] - w) / 2,
        y: top + (maxH - h) / 2,
        w,
        h,
    };
}

function drawCircleIcon(ctx, x, y, label, hover) {
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.45)";
    ctx.shadowBlur = hover ? 8 : 5;
    ctx.fillStyle = hover ? "#45c7bf" : "rgba(35, 40, 49, 0.88)";
    ctx.strokeStyle = hover ? "#b6fffb" : "rgba(160, 175, 196, 0.7)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(x, y, 9, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.fillStyle = "#f3f7ff";
    ctx.font = "bold 10px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(label, x, y + 0.5);
    ctx.restore();
}

function getNodeButtonFill(node) {
    return node?.bgcolor || node?.color || "rgba(39, 45, 55, 0.94)";
}

function drawToolbarIcon(ctx, x, y, label, hover, active = true, fillColor) {
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.28)";
    ctx.shadowBlur = hover ? 7 : 4;
    ctx.fillStyle = active ? "rgba(31, 111, 108, 0.94)" : (fillColor || "rgba(39, 45, 55, 0.94)");
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(x, y, 18, 0, Math.PI * 2);
    ctx.fill();
    if (hover) {
        const alpha = active ? 0.14 : 0.08;
        ctx.fillStyle = `rgba(255,255,255,${alpha})`;
        ctx.fill();
    }
    ctx.strokeStyle = active ? "#72aaa8" : "#788391";
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.fillStyle = "#c1c5cd";
    ctx.shadowColor = "rgba(0,0,0,0.42)";
    ctx.shadowBlur = 1.5;
    ctx.font = label.length > 3 ? "bold 9px sans-serif" : "bold 11px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(label, x, y + 0.5);
    ctx.restore();
}

function setNodeButtonRects(node, width, cy) {
    const xs = [width * 0.18, width * 0.35, width * 0.52];
    node._guhaiMaskButtons = [
        { x: xs[0], y: cy, r: 19, kind: "upload" },
        { x: xs[1], y: cy, r: 19, kind: "transparent" },
        { x: xs[2], y: cy, r: 19, kind: "mask" },
    ];
    return xs;
}

function drawNodeMaskButtons(ctx, node, width, cy, hover) {
    const xs = setNodeButtonRects(node, width, cy);
    const transparentWidget = findTransparentWidget(node);
    const transparentOn = !!transparentWidget?.value;
    const hasMask = nodeHasMask(node);
    const fillColor = getNodeButtonFill(node);
    drawToolbarIcon(ctx, xs[0], cy, "\u4e0a\u4f20", hover === "upload", false, fillColor);
    drawToolbarIcon(ctx, xs[1], cy, transparentOn ? "RGBA" : "RGB", hover === "transparent", transparentOn, fillColor);
    drawToolbarIcon(ctx, xs[2], cy, "\u906e\u7f69", hover === "mask", hasMask, fillColor);
}

function showNodeTooltip(text, event) {
    let tip = document.getElementById("guhai-mask-node-tooltip");
    if (!text) {
        tip?.remove();
        return;
    }
    if (!tip) {
        tip = document.createElement("div");
        tip.id = "guhai-mask-node-tooltip";
        Object.assign(tip.style, {
            position: "fixed",
            zIndex: "100001",
            pointerEvents: "none",
            padding: "3px 7px",
            borderRadius: "5px",
            background: "rgba(18,20,24,0.92)",
            color: "#eef3ff",
            font: "12px sans-serif",
            boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
            whiteSpace: "nowrap",
        });
        document.body.appendChild(tip);
    }
    tip.textContent = text;
    tip.style.left = `${event.clientX + 12}px`;
    tip.style.top = `${event.clientY + 12}px`;
}

function getNodeScreenPoint(node, x, y) {
    const canvas = app.canvas;
    const rect = canvas?.canvas?.getBoundingClientRect?.();
    const ds = canvas?.ds;
    if (!rect || !ds) return null;
    return {
        x: rect.left + (node.pos[0] + x) * ds.scale + ds.offset[0],
        y: rect.top + (node.pos[1] + y) * ds.scale + ds.offset[1],
        scale: ds.scale,
    };
}

function ensureNodeToolbar(node) {
    removeNodeToolbar(node);
    return null;
}

function updateNodeToolbar(node) {
    removeNodeToolbar(node);
}

function removeNodeToolbar(node) {
    node._guhaiDomToolbar?.remove();
    node._guhaiDomToolbar = null;
}

function setNodePreview(node, dataUrl) {
    const apply = () => loadImage(dataUrl).then((img) => {
        node.imgs = [img];
        node.imageIndex = null;
        node.setDirtyCanvas(true, true);
        app.graph?.setDirtyCanvas?.(true, true);
    }).catch(() => {});
    apply();
    setTimeout(apply, 250);
    setTimeout(apply, 900);
    setTimeout(() => refreshNodes2MaskPreviews(), 100);
    setTimeout(() => refreshNodes2MaskPreviews(), 1000);
}

function waitForPreviewImage(img) {
    if (img.complete && img.naturalWidth > 0) return Promise.resolve();
    return new Promise((resolve, reject) => {
        img.addEventListener("load", resolve, { once: true });
        img.addEventListener("error", reject, { once: true });
    });
}

function refreshNodes2MaskPreviews(root = document) {
    const images = root.querySelectorAll?.('img[data-testid="main-image"]') || [];
    for (const img of images) {
        const parent = img.parentElement;
        if (!parent) continue;

        // Nodes 2.0 keeps the Vue preview on the original image even after the
        // underlying widget has changed to a painted-masked clipspace value.
        // Resolve the real widget through the DOM node id instead of trusting
        // the main image src, which is only reliable in the legacy renderer.
        const nodeId = img.closest?.("[data-node-id]")?.dataset?.nodeId;
        const node = nodeId != null
            ? (app.graph?.getNodeById?.(nodeId) || app.graph?.getNodeById?.(Number(nodeId)))
            : null;
        const widgetRoot = img.closest?.("[data-node-id]")?.querySelector?.('[data-testid="node-widgets"]');
        const renderedMaskedValue = [...(widgetRoot?.querySelectorAll?.("button, span") || [])]
            .map((element) => String(element.textContent || "").trim())
            .find((value) => value.includes("painted-masked") || value.includes("clipspace-mask-")) || "";
        const widgetValue = String(findImageWidget(node)?.value || renderedMaskedValue);
        const src = img.currentSrc || img.src || "";
        const maskedValue = widgetValue.includes("painted-masked") || widgetValue.includes("clipspace-mask-")
            ? widgetValue
            : (src.includes("painted-masked") || src.includes("clipspace-mask-") ? src : "");

        if (!maskedValue) {
            parent.querySelector(':scope > img[data-guhai-nodes2-original="true"]')?.remove();
            parent.querySelector(':scope > img[data-guhai-nodes2-green="true"]')?.remove();
            parent.querySelector(':scope > img[data-guhai-nodes2-masked="true"]')?.remove();
            img.style.removeProperty("z-index");
            img._guhaiNodes2MaskKey = null;
            continue;
        }

        let maskedUrl;
        let originalUrl;
        if (maskedValue === widgetValue) {
            const sources = getEditorSources(maskedValue);
            maskedUrl = imageUrlFromParts(parseImageValue(maskedValue));
            originalUrl = sources.imageUrl;
        } else {
            maskedUrl = new URL(src, location.href).toString();
            const parsedUrl = new URL(maskedUrl, location.href);
            const maskedName = parsedUrl.searchParams.get("filename") || "";
            parsedUrl.searchParams.set("filename", maskedName
                .replace("painted-masked", "painted")
                .replace("clipspace-mask-", "clipspace-painted-"));
            originalUrl = parsedUrl.toString();
        }

        const key = `${cacheKeyForUrl(maskedUrl)}|${cacheKeyForUrl(originalUrl)}`;
        if (img._guhaiNodes2MaskKey === key
            && parent.querySelector(':scope > img[data-guhai-nodes2-masked="true"]')) continue;
        img._guhaiNodes2MaskKey = key;

        let original = parent.querySelector(':scope > img[data-guhai-nodes2-original="true"]');
        if (!original) {
            original = document.createElement("img");
            original.dataset.guhaiNodes2Original = "true";
            original.alt = "遮罩原图预览";
            original.draggable = false;
            original.className = img.className;
            parent.insertBefore(original, img);
        }
        original.style.visibility = "hidden";
        original.src = originalUrl;
        let green = parent.querySelector(':scope > img[data-guhai-nodes2-green="true"]');
        if (!green) {
            green = document.createElement("img");
            green.dataset.guhaiNodes2Green = "true";
            green.alt = "遮罩绿色叠加";
            green.draggable = false;
            green.className = img.className;
            green.style.filter = "brightness(0) saturate(100%) invert(72%) sepia(64%) saturate(550%) hue-rotate(93deg) brightness(92%) contrast(91%)";
            green.style.opacity = "0.5";
            green.style.zIndex = "1";
            parent.insertBefore(green, img);
        }
        green.style.visibility = "hidden";
        green.src = originalUrl;
        let masked = parent.querySelector(':scope > img[data-guhai-nodes2-masked="true"]');
        if (!masked) {
            masked = document.createElement("img");
            masked.dataset.guhaiNodes2Masked = "true";
            masked.alt = "遮罩透明预览";
            masked.draggable = false;
            masked.className = img.className;
            masked.style.zIndex = "2";
            parent.insertBefore(masked, img);
        }
        masked.style.visibility = "hidden";
        masked.src = maskedUrl;
        original.style.zIndex = "0";
        img.style.removeProperty("z-index");

        // Do not expose the layers one by one. The green-tinted original often
        // finishes before the transparent mask and otherwise appears as a
        // brief full green rectangle, especially while Nodes 2.0 remounts.
        Promise.all([
            waitForPreviewImage(original),
            waitForPreviewImage(green),
            waitForPreviewImage(masked),
        ]).then(() => {
            if (img._guhaiNodes2MaskKey !== key || !img.isConnected) return;
            requestAnimationFrame(() => {
                if (img._guhaiNodes2MaskKey !== key || !img.isConnected) return;
                original.style.removeProperty("visibility");
                green.style.removeProperty("visibility");
                masked.style.removeProperty("visibility");
                img.style.zIndex = "-1";
            });
        }).catch(() => {
            if (img._guhaiNodes2MaskKey !== key) return;
            img._guhaiNodes2MaskKey = null;
            img.style.removeProperty("z-index");
        });
    }
}

function installNodes2MaskPreviewObserver() {
    if (window._guhaiNodes2MaskPreviewObserver) return;
    let scheduled = false;
    const refresh = () => {
        if (scheduled) return;
        scheduled = true;
        requestAnimationFrame(() => {
            scheduled = false;
            refreshNodes2MaskPreviews();
        });
    };
    const observer = new MutationObserver(refresh);
    observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["src"],
    });
    window._guhaiNodes2MaskPreviewObserver = observer;
    refresh();
    // Nodes 2.0 may reuse Vue component instances without mutating the img
    // element itself. A lightweight periodic scan covers those updates.
    window._guhaiNodes2MaskPreviewTimer = setInterval(refresh, 1500);
}

// Install independently of ComfyUI's extension lifecycle. Nodes 2.0 can skip
// duplicate extension init hooks while hot-reloading custom-node modules.
installNodes2MaskPreviewObserver();

async function waitForPendingMaskSaves() {
    const tasks = [...pendingMaskSaves];
    if (!tasks.length) return;
    await Promise.allSettled(tasks);
}

function installQueueWaiter() {
    if (!api._guhaiMaskFetchWaiterInstalled && typeof api.fetchApi === "function") {
        const origFetchApi = api.fetchApi;
        api.fetchApi = async function (route) {
            const path = String(route || "");
            if (path.includes("/prompt") || path.endsWith("prompt")) {
                await waitForPendingMaskSaves();
            }
            return origFetchApi.apply(this, arguments);
        };
        api._guhaiMaskFetchWaiterInstalled = true;
    }
    if (app._guhaiMaskQueueWaiterInstalled) return;
    if (typeof app.queuePrompt !== "function") {
        setTimeout(installQueueWaiter, 250);
        return;
    }
    const origQueuePrompt = app.queuePrompt;
    app.queuePrompt = async function () {
        await waitForPendingMaskSaves();
        return origQueuePrompt.apply(this, arguments);
    };
    app._guhaiMaskQueueWaiterInstalled = true;
}

function isLoadImageGoohaiNode(node) {
    return node && (
        node.comfyClass === "LoadImageGoohai"
        || node.type === "LoadImageGoohai"
        || node.constructor?.type === "LoadImageGoohai"
        || node.title === "\u52a0\u8f7d\u56fe\u50cf \u5b64\u6d77"
    );
}

function isOfficialLoadImageNode(node) {
    return node && (
        node.comfyClass === "LoadImage"
        || node.type === "LoadImage"
        || node.constructor?.type === "LoadImage"
    );
}

function isSupportedLoadImageNode(node) {
    return isLoadImageGoohaiNode(node) || isOfficialLoadImageNode(node);
}

function selectedLoadImageNode() {
    const selected = app.canvas?.selected_nodes;
    if (selected) {
        const nodes = Array.isArray(selected) ? selected : Object.values(selected);
        const match = nodes.find(isSupportedLoadImageNode);
        if (match) return match;
    }
    const selectedItems = app.canvas?.selectedItems;
    if (selectedItems) {
        const nodes = Array.isArray(selectedItems) ? selectedItems : Object.values(selectedItems);
        const match = nodes.find(isSupportedLoadImageNode);
        if (match) return match;
    }
    return app.graph?._nodes?.find((node) => node?.selected && isSupportedLoadImageNode(node)) || null;
}

function isZKeyEvent(e) {
    if (e.ctrlKey || e.altKey || e.metaKey) return false;
    const key = String(e.key || "");
    const code = key.length === 1 ? key.charCodeAt(0) : 0;
    return e.code === "KeyZ" || e.keyCode === 90 || key === "z" || key === "Z" || code === 0xff5a || code === 0xff3a;
}

function isXKeyEvent(e) {
    if (e.ctrlKey || e.altKey || e.metaKey) return false;
    const key = String(e.key || "");
    const code = key.length === 1 ? key.charCodeAt(0) : 0;
    return e.code === "KeyX" || e.keyCode === 88 || key === "x" || key === "X" || code === 0xff58 || code === 0xff38;
}

function originalValueFromMaskValue(value) {
    const parsed = parseImageValue(value);
    const isPaintedMasked = parsed.filename.includes("painted-masked");
    const isOfficialClipMask = parsed.filename.startsWith("clipspace-mask-");
    if (!isPaintedMasked && !isOfficialClipMask) return null;
    const filename = isOfficialClipMask
        ? parsed.filename.replace("clipspace-mask-", "clipspace-painted-")
        : parsed.filename.replace("painted-masked", "painted");
    return `${parsed.subfolder ? `${parsed.subfolder}/` : ""}${filename} [${parsed.type || "input"}]`;
}

function clearMaskForNode(node) {
    const imageWidget = findImageWidget(node);
    if (!imageWidget?.value) return false;
    const originalValue = originalValueFromMaskValue(imageWidget.value);
    if (!originalValue) return false;
    imageWidget.value = originalValue;
    if (imageWidget.options?.values && !imageWidget.options.values.includes(originalValue)) {
        imageWidget.options.values.push(originalValue);
    }
    if (typeof imageWidget.callback === "function") imageWidget.callback(originalValue);
    try {
        setNodePreview(node, imageUrlFromParts(parseImageValue(originalValue)));
    } catch (_) {}
    prewarmEditorForNode(node);
    node.setDirtyCanvas(true, true);
    app.graph?.change?.();
    return true;
}

function installMaskEditorHotkey() {
    if (window._guhaiMaskEditorHotkeyInstalled) return;
    document.addEventListener("keydown", async (e) => {
        const activeEditor = window._guhaiActiveMaskEditor;
        if (activeEditor) {
            const key = String(e.key || "").toLowerCase();
            const ctrl = e.ctrlKey || e.metaKey;
            const isUndo = ctrl && !e.shiftKey && (key === "z" || e.keyCode === 90);
            const isRedo = ctrl && e.shiftKey && (key === "z" || key === "y" || e.keyCode === 90 || e.keyCode === 89);
            if (isUndo || isRedo) {
                e.preventDefault();
                e.stopPropagation();
                e.stopImmediatePropagation?.();
                if (isUndo) activeEditor.undo();
                else activeEditor.redoAction();
                return;
            }
            activeEditor.keyDown(e);
            return;
        }
        if (e.repeat) return;
        const isZ = isZKeyEvent(e);
        const isX = isXKeyEvent(e);
        if (!isZ && !isX) return;
        const node = selectedLoadImageNode();
        if (!node) return;
        e.preventDefault();
        e.stopPropagation();
        if (isX) {
            await waitForPendingMaskSaves();
            clearMaskForNode(node);
        } else {
            openEditorForNode(node);
        }
    }, { capture: true, passive: false });
    window._guhaiMaskEditorHotkeyInstalled = true;
}

async function uploadSelectedImageForNode(node, file) {
    const body = new FormData();
    body.append("image", file);
    body.append("type", "input");
    body.append("overwrite", "false");
    const res = await api.fetchApi("/upload/image", { method: "POST", body });
    if (!res.ok) throw new Error(`\u4e0a\u4f20\u5931\u8d25: HTTP ${res.status}`);
    const item = await res.json();
    const value = `${item.subfolder ? `${item.subfolder}/` : ""}${item.name || item.filename} [input]`;
    const imageWidget = findImageWidget(node);
    if (!imageWidget) return;
    imageWidget.value = value;
    persistLoadImageState(node);
    if (imageWidget.options?.values && !imageWidget.options.values.includes(value)) {
        imageWidget.options.values.push(value);
    }
    if (typeof imageWidget.callback === "function") imageWidget.callback(value);
    try {
        setNodePreview(node, imageUrlFromParts(parseImageValue(value)));
    } catch (_) {}
    prewarmEditorForNode(node);
    node.setDirtyCanvas(true, true);
    app.graph?.change?.();
}

function isImageDropFile(file) {
    if (!file) return false;
    if (String(file.type || "").toLowerCase().startsWith("image/")) return true;
    return /\.(?:avif|bmp|gif|heic|heif|jpe?g|png|tiff?|webp)$/i.test(String(file.name || ""));
}

function getLoadImageGoohaiAtDropEvent(event) {
    try {
        const canvas = app.canvas;
        if (!canvas?.graph || typeof canvas.adjustMouseEvent !== "function") return null;
        canvas.adjustMouseEvent(event);
        const node = canvas.graph.getNodeOnPos?.(event.canvasX, event.canvasY);
        return isLoadImageGoohaiNode(node) ? node : null;
    } catch (_) {
        return null;
    }
}

function installCanvasImageDropFallback() {
    if (window._guhaiCanvasImageDropFallbackInstalled) return;

    const isFileDrag = (dataTransfer) => {
        const items = [...(dataTransfer?.items || [])];
        const types = [...(dataTransfer?.types || [])].map((type) => String(type).toLowerCase());
        return items.some((item) => item.kind === "file")
            || (dataTransfer?.files?.length || 0) > 0
            || types.includes("files");
    };

    document.addEventListener("dragover", (event) => {
        if (!isFileDrag(event.dataTransfer)) return;
        if (!getLoadImageGoohaiAtDropEvent(event)) return;
        event.preventDefault();
        if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
    }, { capture: true, passive: false });

    document.addEventListener("drop", (event) => {
        const node = getLoadImageGoohaiAtDropEvent(event);
        if (!node) return;
        const file = event.dataTransfer?.files?.[0];
        if (!isImageDropFile(file)) return;
        // Own the drop only for our node. This bypasses node callback races
        // while leaving ComfyUI's official LoadImage behavior untouched.
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation?.();
        uploadSelectedImageForNode(node, file).catch((err) => {
            alert(`\u4e0a\u4f20\u56fe\u50cf\u5931\u8d25: ${err?.message || err}`);
        });
    }, { capture: true, passive: false });

    window._guhaiCanvasImageDropFallbackInstalled = true;
}

function openUploadForNode(node) {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.style.display = "none";
    document.body.appendChild(input);
    input.addEventListener("change", async () => {
        const file = input.files?.[0];
        input.remove();
        if (!file) return;
        try {
            await uploadSelectedImageForNode(node, file);
        } catch (err) {
            alert(`\u4e0a\u4f20\u56fe\u50cf\u5931\u8d25: ${err?.message || err}`);
        }
    }, { once: true });
    input.click();
}

function installFloatingButtons(node) {
    if (node._guhaiMaskEditorBuilt) return;
    node._guhaiMaskEditorBuilt = true;
    document.querySelectorAll(".guhai-load-toolbar").forEach((el) => el.remove());
    hideBulkyWidgets(node);

    // Keep a real node hit area even when the image widget has no preview.
    // This also prevents an empty "无" selection from collapsing the node.
    const ensureInteractiveSize = () => keepEmptyLoadImageNodeInteractive(node);
    ensureInteractiveSize();

    const controlsWidget = node.addCustomWidget({
        name: "guhai_mask_icon_controls",
        type: "guhai_mask_icon_controls",
        serialize: false,
        draw(ctx, node, width, y, height) {
            const cy = y - 23;
            const xs = [width * 0.18, width * 0.35, width * 0.52];
            const transparentWidget = findTransparentWidget(node);
            const transparentOn = !!transparentWidget?.value;
            this._buttons = [
                { x: xs[0], y: cy, r: 19, kind: "upload" },
                { x: xs[1], y: cy, r: 19, kind: "transparent" },
                { x: xs[2], y: cy, r: 19, kind: "mask" },
            ];
            node._guhaiMaskButtons = this._buttons;
            node._guhaiControlsWidgetDrawAt = performance.now();
            const fillColor = getNodeButtonFill(node);
            drawToolbarIcon(ctx, xs[0], cy, "\u4e0a\u4f20", this._hover === "upload", false, fillColor);
            drawToolbarIcon(ctx, xs[1], cy, transparentOn ? "RGBA" : "RGB", this._hover === "transparent", transparentOn, fillColor);
            drawToolbarIcon(ctx, xs[2], cy, "\u906e\u7f69", this._hover === "mask", nodeHasMask(node), fillColor);
        },
        mouse(event, pos, node) {
            let hit = null;
            for (const b of this._buttons || []) {
                if (Math.hypot(pos[0] - b.x, pos[1] - b.y) <= b.r) hit = b.kind;
            }
            // Do not consume right-clicks; LiteGraph must open the node menu.
            if (event?.button === 2 || event?.which === 3) return false;
            const tooltip = hit ? (hit === "upload" ? "\u4e0a\u4f20\u56fe\u50cf" : hit === "transparent" ? "\u4fdd\u7559\u900f\u660e\u901a\u9053" : "\u906e\u7f69\u7f16\u8f91") : "";
            showNodeTooltip(tooltip, event);
            if (event.type === "pointermove" || event.type === "mousemove") {
                if (hit !== this._hover) {
                    this._hover = hit;
                    node.setDirtyCanvas(true, true);
                }
                return !!hit;
            }
            if ((event.type === "pointerdown" || event.type === "mousedown") && hit) {
                event.preventDefault?.();
                event.stopPropagation?.();
                if (hit === "upload") openUploadForNode(node);
                else if (hit === "transparent") {
                    const transparentWidget = findTransparentWidget(node);
                    if (transparentWidget) {
                        transparentWidget.value = !transparentWidget.value;
                        transparentWidget.callback?.(transparentWidget.value);
                        persistLoadImageState(node);
                        node.setDirtyCanvas(true, true);
                        app.graph?.change?.();
                    }
                }
                else openEditorForNode(node);
                return true;
            }
            return false;
        },
        computeSize(width) {
            return [width, 12];
        },
    });
    controlsWidget.serialize = false;
    const imageIndex = node.widgets.findIndex((w) => w.name === "image");
    const controlsIndex = node.widgets.indexOf(controlsWidget);
    if (imageIndex >= 0 && controlsIndex > imageIndex) {
        node.widgets.splice(controlsIndex, 1);
        node.widgets.splice(imageIndex, 0, controlsWidget);
    }

    const origDrawForeground = node.onDrawForeground;
    node.onDrawForeground = function (ctx) {
        ensureInteractiveSize();
        origDrawForeground?.apply(this, arguments);
        hideBulkyWidgets(this);
    };

    const origMouseMove = node.onMouseMove;
    node.onMouseMove = function (event, pos) {
        let hit = null;
        for (const b of this._guhaiMaskButtons || []) {
            if (Math.hypot(pos[0] - b.x, pos[1] - b.y) <= b.r) hit = b.kind;
        }
        const controls = this.widgets?.find((w) => w.name === "guhai_mask_icon_controls");
        if (hit !== this._guhaiHoverButton) {
            this._guhaiHoverButton = hit;
            if (controls) controls._hover = hit;
            this.setDirtyCanvas(true, true);
        }
        const tooltip = hit ? (hit === "upload" ? "\u4e0a\u4f20\u56fe\u50cf" : hit === "transparent" ? "\u4fdd\u7559\u900f\u660e\u901a\u9053" : "\u906e\u7f69\u7f16\u8f91") : "";
        showNodeTooltip(tooltip, event);
        if (origMouseMove) return origMouseMove.apply(this, arguments);
    };

    const origMouseLeave = node.onMouseLeave;
    node.onMouseLeave = function () {
        this._guhaiHoverButton = null;
        showNodeTooltip("", {});
        return origMouseLeave?.apply(this, arguments);
    };

    const origMouseDown = node.onMouseDown;
    node.onMouseDown = function (event, pos) {
        // The node's context menu belongs to LiteGraph, not the custom buttons.
        if (event?.button === 2) return origMouseDown?.apply(this, arguments);
        let hit = null;
        for (const b of this._guhaiMaskButtons || []) {
            if (Math.hypot(pos[0] - b.x, pos[1] - b.y) <= b.r) hit = b.kind;
        }
        if (hit) {
            event.preventDefault?.();
            event.stopPropagation?.();
            if (hit === "upload") openUploadForNode(this);
            else if (hit === "transparent") {
                const transparentWidget = findTransparentWidget(this);
                if (transparentWidget) {
                    transparentWidget.value = !transparentWidget.value;
                    transparentWidget.callback?.(transparentWidget.value);
                    persistLoadImageState(this);
                    this.setDirtyCanvas(true, true);
                    app.graph?.change?.();
                }
            } else {
                openEditorForNode(this);
            }
            return true;
        }
        return origMouseDown?.apply(this, arguments);
    };

    removeNodeToolbar(node);
}

function initializeLoadImageNode(node, { floating = false } = {}) {
    let attempts = 0;
    const run = () => {
        attempts += 1;
        const imageWidget = findImageWidget(node);
        if (!imageWidget && attempts < 20) {
            setTimeout(run, 100);
            return;
        }
        if (!imageWidget) return;
        restoreLoadImageState(node);
        installLoadImagePersistence(node);
        installImageWidgetPrewarm(node);
        if (floating) {
            hideBulkyWidgets(node);
            installFloatingButtons(node);
        }
        prewarmEditorForNode(node);
        refreshClipspacePreview(node);
        setTimeout(() => refreshNodes2MaskPreviews(), 100);
        setTimeout(() => refreshNodes2MaskPreviews(), 1200);
        node.setDirtyCanvas(true, true);
    };
    requestAnimationFrame(run);
}

function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
}

function openEditorForNode(node) {
    const imageWidget = findImageWidget(node);
    if (!imageWidget?.value) {
        alert("\u8bf7\u5148\u5728\u52a0\u8f7d\u56fe\u50cf\u8282\u70b9\u4e2d\u9009\u62e9\u6216\u4e0a\u4f20\u56fe\u50cf\u3002");
        return;
    }
    const sources = getEditorSources(imageWidget.value);
    const nodeId = node.id;
    const currentNode = () => app.graph?.getNodeById?.(nodeId) || node;
    // Mark the node before constructing the editor. A workflow undo/configure
    // event must not restore the old painted-masked value while editing.
    node._guhaiMaskEditorActive = true;
    let editor;
    editor = new GoohaiMaskEditor({
        imageUrl: sources.imageUrl,
        maskUrl: sources.maskUrl,
        maskMode: sources.maskMode,
        preserveRgbUnderMask: isOfficialLoadImageNode(node),
        onSave(saveTask, immediatePreviewTask) {
            let targetNode = currentNode();
            targetNode._guhaiMaskEditorSavePending = true;
            targetNode._guhaiMaskSaving = true;
            targetNode.setDirtyCanvas(true, true);
            // Prime the legacy preview while uploads are still running. By the
            // time the widget callback updates its value, this image is loaded
            // and can be restored in the same frame, avoiding a black flash.
            if (immediatePreviewTask) {
                Promise.resolve(immediatePreviewTask)
                    .then((url) => {
                        targetNode = currentNode();
                        if (url) setNodePreview(targetNode, url);
                    })
                    .catch(() => {});
            }
            const pending = Promise.resolve(saveTask).then(({ value, previewDataUrl, previewTask }) => {
                targetNode = currentNode();
                const targetWidget = findImageWidget(targetNode);
                if (!targetWidget) throw new Error("加载图像节点已不存在");
                targetWidget.value = value;
                persistLoadImageState(targetNode);
                if (targetWidget.options?.values && !targetWidget.options.values.includes(value)) {
                    targetWidget.options.values.push(value);
                }
                // Persist the saved value without asking the stock legacy
                // image widget to load the black alpha-mask as a preview.
                targetNode._guhaiSkipOriginalImageCallback = true;
                try {
                    if (typeof targetWidget.callback === "function") targetWidget.callback(value);
                } finally {
                    targetNode._guhaiSkipOriginalImageCallback = false;
                }
                if (previewDataUrl) setNodePreview(targetNode, previewDataUrl);
                if (previewTask) {
                    Promise.resolve(previewTask)
                        .then((url) => url && setNodePreview(targetNode, url))
                        .catch(() => {});
                }
                prewarmEditorForNode(targetNode);
                app.graph?.change?.();
                setTimeout(() => refreshNodes2MaskPreviews(), 100);
                setTimeout(() => refreshNodes2MaskPreviews(), 1200);
            }).catch((err) => {
                alert(`\u4fdd\u5b58\u906e\u7f69\u5931\u8d25: ${err?.message || err}`);
            }).finally(() => {
                targetNode = currentNode();
                targetNode._guhaiMaskEditorSavePending = false;
                targetNode._guhaiMaskEditorActive = null;
                targetNode._guhaiMaskSaving = false;
                pendingMaskSaves.delete(pending);
                targetNode.setDirtyCanvas(true, true);
                app.graph?.setDirtyCanvas?.(true, true);
            });
            pendingMaskSaves.add(pending);
        },
        onClose() {
            if (!node._guhaiMaskEditorSavePending) node._guhaiMaskEditorActive = null;
        },
    });
    node._guhaiMaskEditorActive = editor;
}

async function refreshClipspacePreview(node) {
    const imageWidget = findImageWidget(node);
    const value = String(imageWidget?.value || "");
    if (!value || (!value.includes("painted-masked") && !value.includes("clipspace-mask-"))) return;
    try {
        const sources = getEditorSources(imageWidget.value);
        const img = await loadImage(sources.imageUrl);
        const mask = await loadImage(sources.maskUrl);
        const canvas = document.createElement("canvas");
        canvas.width = img.naturalWidth || img.width;
        canvas.height = img.naturalHeight || img.height;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        const tmp = document.createElement("canvas");
        tmp.width = canvas.width;
        tmp.height = canvas.height;
        const tctx = tmp.getContext("2d");
        tctx.drawImage(mask, 0, 0, tmp.width, tmp.height);
        const md = tctx.getImageData(0, 0, tmp.width, tmp.height).data;
        const overlay = ctx.createImageData(canvas.width, canvas.height);
        for (let i = 0; i < md.length; i += 4) {
            overlay.data[i] = 42;
            overlay.data[i + 1] = 210;
            overlay.data[i + 2] = 112;
            overlay.data[i + 3] = md[i + 3] < 250 ? 128 : 0;
        }
        tmp.getContext("2d").putImageData(overlay, 0, 0);
        ctx.drawImage(tmp, 0, 0);
        setNodePreview(node, await canvasToObjectUrl(canvas, "image/png"));
    } catch (_) {}
}

function installMaskEditorMenu(nodeType) {
    if (nodeType.prototype._guhaiMaskMenuInstalled) return;
    const origMenu = nodeType.prototype.getExtraMenuOptions;
    nodeType.prototype.getExtraMenuOptions = function (canvas, options) {
        origMenu?.apply(this, arguments);
        options.splice(2, 0, {
            content: "\uD83D\uDD8C \u906e\u7f69\u7f16\u8f91\u5668",
            className: "guhai-mask-menu-entry",
            callback: () => openEditorForNode(this),
        });
    };
    nodeType.prototype._guhaiMaskMenuInstalled = true;
}

app.registerExtension({
    name: EXT_NAME,
    init() {
        injectStyles();
        installMaskEditorHotkey();
        installNodes2MaskPreviewObserver();
        installCanvasImageDropFallback();
        // Nodes 2.0 initializes the graph after extensions. Queue hooks must
        // not prevent the independent preview/keyboard features from loading.
        setTimeout(() => {
            try { installQueueWaiter(); } catch (_) {
                setTimeout(() => {
                    try { installQueueWaiter(); } catch (_) {}
                }, 1000);
            }
        }, 0);
    },
    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name !== "LoadImageGoohai" && nodeData.name !== "LoadImage") return;
        if (nodeData.name === "LoadImageGoohai") {
            // Initial size for newly-created nodes; users can still resize
            // them freely and imported workflow dimensions remain untouched.
            nodeData.size = [350, 500];
        }
        installMaskEditorMenu(nodeType);
        if (nodeData.name === "LoadImage") {
            const origCreated = nodeType.prototype.onNodeCreated;
            const origConfigure = nodeType.prototype.onConfigure;
            nodeType.prototype.onConfigure = function () {
                protectNodeValueDuringMaskEdit(this, () => origConfigure?.apply(this, arguments));
                restoreLoadImageState(this);
            };
            nodeType.prototype.onNodeCreated = function () {
                origCreated?.apply(this, arguments);
                initializeLoadImageNode(this);
            };
            return;
        }

        const origCreated = nodeType.prototype.onNodeCreated;
        const origConfigure = nodeType.prototype.onConfigure;
        nodeType.prototype.onConfigure = function () {
            const config = arguments[0];
            this._guhaiConfiguredFromWorkflow = !!(config && Array.isArray(config.size));
            protectNodeValueDuringMaskEdit(this, () => origConfigure?.apply(this, arguments));
            restoreLoadImageState(this);
        };
        nodeType.prototype.onNodeCreated = function () {
            origCreated?.apply(this, arguments);
            initializeLoadImageNode(this, { floating: true });
            requestAnimationFrame(() => {
                if (!this._guhaiConfiguredFromWorkflow) {
                    this.setSize?.([350, 500]);
                    this.size = [350, 500];
                }
                this.setDirtyCanvas(true, true);
            });
        };
    },
});
