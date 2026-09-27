import { app } from "../../../scripts/app.js";
import { api } from "../../../scripts/api.js";

const MAX_EDIT_LONG_SIDE = 1536;
const EXT_NAME = "goohaitools.load_image_mask_editor";
const pendingMaskSaves = new Set();
const imageLoadCache = new Map();
const editorImageCache = new Map();
const colorPreviewCache = new Map();

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

async function inflateBytes(bytes) {
    if (typeof DecompressionStream !== "function") throw new Error("当前浏览器不支持颜色层解码");
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function colorLayersPngChunk(layers, order, width, height) {
    const bits = new Uint8Array(width * height);
    for (let layerIndex = 0; layerIndex < order.length; layerIndex++) {
        const canvas = layers.get(order[layerIndex]);
        if (!canvas) continue;
        const alpha = canvas.getContext("2d").getImageData(0, 0, width, height).data;
        const bit = 1 << layerIndex;
        for (let index = 0; index < bits.length; index++) if (alpha[index * 4 + 3] > 5) bits[index] |= bit;
    }
    const compressed = await deflateBytes(bits);
    const payload = new Uint8Array(8 + compressed.length);
    writeU32(payload, 0, width); writeU32(payload, 4, height); payload.set(compressed, 8);
    return pngChunk("ghCL", payload);
}

async function readColorLayersChunk(url) {
    if (!url) return null;
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) return null;
    const bytes = new Uint8Array(await response.arrayBuffer());
    let offset = 8;
    while (offset + 12 <= bytes.length) {
        const length = ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0;
        const type = new TextDecoder().decode(bytes.subarray(offset + 4, offset + 8));
        if (type === "ghCL" && length >= 8) {
            const data = bytes.subarray(offset + 8, offset + 8 + length);
            const width = ((data[0] << 24) | (data[1] << 16) | (data[2] << 8) | data[3]) >>> 0;
            const height = ((data[4] << 24) | (data[5] << 16) | (data[6] << 8) | data[7]) >>> 0;
            const bits = await inflateBytes(data.subarray(8));
            return bits.length === width * height ? { width, height, bits } : null;
        }
        offset += 12 + length;
    }
    return null;
}

async function rgbaToPngBlob(rgba, width, height, extraChunks = []) {
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
        ...extraChunks,
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


function outputStateFromFilename(filename) {
    const match = String(filename || "").match(/__ghm-(original|color)-([a-z]+)-(\d{1,3})-([01])(?:-([01]))?(?:-goohai)?(?:\.[^.]+)?$/i);
    if (!match) return null;
    return {
        mode: match[1].toLowerCase() === "color" ? "color" : "original",
        color: match[2].toLowerCase(),
        opacity: clamp(Number(match[3]), 0, 100),
        fill: match[4] === "1",
        inverted: match[5] === "1",
    };
}

function getEditorSources(value) {
    const parsed = parseImageValue(value);
    const isClipMask = parsed.filename.includes("painted-masked");
    const isSavedOutput = parsed.filename.includes("painted-output-");
    const isOfficialClipMask = parsed.filename.startsWith("clipspace-mask-");
    if (!isClipMask && !isSavedOutput && !isOfficialClipMask) {
        return {
            imageUrl: imageUrlFromParts(parsed),
            maskUrl: imageUrlFromParts(parsed),
            maskMode: "alpha",
            outputState: outputStateFromFilename(parsed.filename),
        };
    }
    const original = {
        ...parsed,
        filename: isOfficialClipMask
            ? parsed.filename.replace("clipspace-mask-", "clipspace-painted-")
            : isSavedOutput
                ? parsed.filename.split("__ghm-", 1)[0].replace("painted-output-", "painted-") + ".png"
                : parsed.filename.replace("painted-masked", "painted"),
    };
    const mask = isSavedOutput
        ? { ...parsed, filename: parsed.filename.split("__ghm-", 1)[0].replace("painted-output-", "painted-masked-") + ".png" }
        : parsed;
    return {
        imageUrl: imageUrlFromParts(original),
        maskUrl: imageUrlFromParts(mask),
        colorUrl: isSavedOutput
            ? imageUrlFromParts({ ...parsed, filename: parsed.filename.split("__ghm-", 1)[0].replace("painted-output-", "painted-masked-") + ".png" })
            : isClipMask ? imageUrlFromParts(parsed) : null,
        maskMode: "clipspace-alpha",
        outputState: outputStateFromFilename(parsed.filename),
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
.guhai-mask-btn{border:0;background:transparent;color:#c6cbd3;font-size:14px;font-weight:700;padding:7px 12px;cursor:pointer;line-height:1;white-space:nowrap}
.guhai-mask-btn:hover{background:#2b3038;color:#fff}
.guhai-mask-btn.active{background:#45c7bf;color:white}
.guhai-mask-icon-btn{width:30px;height:30px;border-radius:999px;border:1px solid transparent;background:transparent;color:#c6cbd3;display:inline-flex;align-items:center;justify-content:center;cursor:pointer;font-weight:800}
.guhai-mask-icon-btn:hover{background:#2b3038;color:#fff}
.guhai-mask-icon-btn:disabled{opacity:.35;cursor:default}
.guhai-mask-action{height:30px;border-radius:999px;border:1px solid #4a5260;background:transparent;color:#d7dbe2;font-size:14px;font-weight:700;padding:0 12px;cursor:pointer}
.guhai-mask-action:hover{background:#2b3038;color:#fff}
.guhai-mask-primary{height:30px;border-radius:999px;border:0;background:#45c7bf;color:white;font-size:14px;font-weight:800;padding:0 16px;cursor:pointer;box-shadow:0 3px 12px rgba(69,199,191,.35)}
.guhai-mask-primary:hover{background:#55d8d0}
.guhai-mask-swatch{width:20px;height:20px;border-radius:50%;border:1px solid #626a78;cursor:pointer;opacity:.75}
.guhai-mask-swatch.active{outline:2px solid #45c7bf;outline-offset:2px;opacity:1;transform:scale(1.06)}
.guhai-mask-stage{position:relative;flex:1;overflow:hidden;display:flex;align-items:center;justify-content:center;background:#111318;cursor:none}
.guhai-mask-output-panel{position:absolute;left:14px;top:14px;z-index:12;display:flex;flex-direction:column;gap:12px;width:222px;padding:10px;color:#dce2ea;font-size:14px;user-select:none;cursor:pointer;background:rgba(8,58,62,.4);border:1px solid rgba(77,174,177,.2);border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,.28),0 2px 8px rgba(0,0,0,.18);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px)}
.guhai-mask-output-row{display:flex;align-items:center;width:100%;min-height:24px}
.guhai-mask-output-label{font-size:14px;font-weight:700;color:#b9c2ce;white-space:nowrap}
.guhai-mask-output-segment{display:flex;width:100%;overflow:hidden;border:1px solid rgba(130,145,160,.65);border-radius:999px;background:rgba(18,22,28,.28)}
.guhai-mask-output-btn{flex:1;border:0;background:transparent;color:#c7d0da;font-size:14px;padding:5px 9px;cursor:pointer;white-space:nowrap}
.guhai-mask-output-btn.active{background:rgba(69,199,191,.78);color:#fff}
.guhai-mask-output-swatches{display:flex;align-items:center;justify-content:space-between;width:100%}
.guhai-mask-output-swatch{width:17px;height:17px;border-radius:50%;border:1px solid rgba(255,255,255,.7);cursor:pointer;opacity:.72;box-shadow:0 0 0 1px rgba(0,0,0,.25)}
.guhai-mask-output-swatch.active{outline:2px solid #45c7bf;outline-offset:2px;opacity:1}
.guhai-mask-output-opacity-row{flex-direction:column;align-items:stretch;gap:3px}
.guhai-mask-output-opacity-head{display:flex;align-items:center;justify-content:space-between;width:100%}
.guhai-mask-output-range{display:block;width:100%;height:16px;margin:0;accent-color:#45c7bf;cursor:pointer}
.guhai-mask-output-value{font-size:14px;color:#c8d1dc;font-family:Consolas,monospace;text-align:right}
.guhai-mask-output-check{display:grid;grid-template-columns:max-content minmax(0,1fr);align-items:center;width:100%;min-height:24px;cursor:pointer;color:#c7d0da;font-size:14px}
.guhai-mask-output-check input{position:absolute;opacity:0;pointer-events:none}
.guhai-mask-output-toggle{position:relative;width:46px;height:18px;justify-self:center;border-radius:999px;background:rgba(91,101,114,.72);box-shadow:inset 0 0 0 1px rgba(255,255,255,.2);transition:background .16s ease}
.guhai-mask-output-toggle::after{content:"";position:absolute;left:2px;top:2px;width:14px;height:14px;border-radius:50%;background:#d9dee5;box-shadow:0 1px 3px rgba(0,0,0,.45);transition:transform .16s ease,background .16s ease}
.guhai-mask-output-check input:checked+.guhai-mask-output-toggle{background:#45c7bf}
.guhai-mask-output-check input:checked+.guhai-mask-output-toggle::after{transform:translateX(28px);background:#fff}
.guhai-mask-frame{position:relative;display:none;box-shadow:0 10px 32px rgba(0,0,0,.45);transform-origin:center center}
.guhai-mask-frame img{display:block;max-width:90vw;max-height:calc(100vh - 110px);user-select:none;-webkit-user-drag:none}
.guhai-mask-frame canvas.guhai-mask-paint{position:absolute;inset:0;width:100%;height:100%;opacity:.5;touch-action:none;pointer-events:none}
.guhai-mask-marquee{position:absolute;inset:0;pointer-events:none;z-index:5}
.guhai-mask-cursor{position:absolute;pointer-events:none;z-index:20;border:2px solid #f5f7fb;box-shadow:0 0 0 1px #111318;border-radius:50%;display:none}
.guhai-mask-size{font-size:12px;color:#aeb5c0;font-family:"JetBrains Mono",Consolas,monospace;min-width:52px;text-align:right}
.guhai-mask-dims{position:absolute;left:0;right:0;top:100%;margin-top:6px;text-align:center;font-size:12px;color:#c8ccd3;font-family:"JetBrains Mono",Consolas,monospace;pointer-events:none}
.guhai-mask-loading{position:absolute;color:#c6cbd3;font-size:14px}
.guhai-mask-error{position:absolute;color:#ff9a9a;font-size:14px;max-width:70vw;text-align:center}
.guhai-mask-color-menu{position:fixed;z-index:100000;display:flex;gap:5px;padding:7px;border:1px solid rgba(255,255,255,.22);border-radius:8px;background:rgba(18,22,28,.95);box-shadow:0 8px 24px rgba(0,0,0,.45)}
.guhai-mask-color-menu button{width:22px;height:22px;padding:0;border:1px solid rgba(255,255,255,.6);border-radius:50%;cursor:pointer;color:#fff;font-size:16px;line-height:18px}
.guhai-mask-node-widget{display:flex;align-items:center;justify-content:center;gap:8px;color:#dfe6f3}
.guhai-nodes2-load-toolbar{position:absolute;z-index:20;left:0;right:0;top:54px;width:auto;height:38px;box-sizing:border-box;display:block;pointer-events:none}
.guhai-nodes2-load-toolbar button{flex:0 0 38px;width:38px;height:38px;padding:0;border:1.2px solid #788391;border-radius:50%;background:var(--guhai-node-button-bg,rgba(39,45,55,.94));box-shadow:0 2px 5px rgba(0,0,0,.28);color:#c1c5cd;font:700 11px/1 sans-serif;text-align:center;cursor:pointer;touch-action:none}
.guhai-nodes2-load-toolbar button{position:absolute;top:0;transform:translateX(-50%);pointer-events:auto}
.guhai-nodes2-load-toolbar button[data-action="upload"]{left:18%}
.guhai-nodes2-load-toolbar button[data-action="transparent"]{left:35%}
.guhai-nodes2-load-toolbar button[data-action="mask"]{left:52%}
.guhai-nodes2-load-toolbar button[data-action="transparent"]{font-size:9px}
.guhai-nodes2-load-toolbar button[data-action="transparent"]::before{content:"RGBA"}
.guhai-nodes2-load-toolbar button:hover{border-color:#b6fffb;filter:brightness(1.14)}
.guhai-nodes2-load-toolbar button.active{border-color:#72aaa8;background:rgba(31,111,108,.94)}
[data-guhai-image-widget-row="true"]{display:flex!important;align-items:center!important;width:100%!important;max-width:none!important;gap:0!important}
[data-guhai-image-widget-label="true"]{display:none!important}
[data-guhai-image-widget-control="true"]{flex:1 1 100%!important;width:100%!important;max-width:none!important;min-width:0!important;margin-left:0!important}
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
    constructor({ imageUrl, maskUrl, colorUrl = null, maskMode, preserveRgbUnderMask = false, outputState = null, onSave, onClose }) {
        injectStyles();
        this.imageUrl = imageUrl;
        this.maskUrl = maskUrl;
        this.colorUrl = colorUrl;
        this.maskMode = maskMode;
        this.preserveRgbUnderMask = preserveRgbUnderMask;
        this.outputMode = outputState?.mode === "color" ? "color" : "original";
        this.outputColor = outputState?.color || "red";
        this.outputOpacity = clamp(Number(outputState?.opacity ?? 50), 0, 100);
        this.autoFillHoles = !!outputState?.fill;
        this.maskInverted = !!outputState?.inverted;
        this.onSave = onSave;
        this.onClose = onClose;
        this.tool = "brush";
        this.maskBrushColor = "green";
        this.brushColor = this.outputMode === "color" ? (this.outputColor || "red") : this.maskBrushColor;
        this.brushSize = 30;
        this.activePaintColor = this.brushColor;
        this.maskModePaint = null;
        this.colorModePaint = null;
        this.colorModeInitialized = false;
        this.maskModeBasePaint = null;
        this.maskModeChangesDirty = false;
        this.fillRevision = 0;
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
        this.lastDrawClient = null;
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
            <textarea class="guhai-mask-keyboard-sink" aria-hidden="true" readonly spellcheck="false" inputmode="none"></textarea>
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
                     <span class="guhai-mask-size">30px</span>
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
                <div class="guhai-mask-output-panel">
                    <div class="guhai-mask-output-row">
                        <div class="guhai-mask-output-segment">
                            <button class="guhai-mask-output-btn" data-output-mode="original">仅遮罩</button>
                            <button class="guhai-mask-output-btn" data-output-mode="color">颜色叠加</button>
                        </div>
                    </div>
                    <div class="guhai-mask-output-row guhai-mask-output-color-row">
                        <div class="guhai-mask-output-swatches">
                            <button class="guhai-mask-output-swatch" data-output-color="white" title="白"></button>
                            <button class="guhai-mask-output-swatch" data-output-color="red" title="红"></button>
                            <button class="guhai-mask-output-swatch" data-output-color="orange" title="橙"></button>
                            <button class="guhai-mask-output-swatch" data-output-color="yellow" title="黄"></button>
                            <button class="guhai-mask-output-swatch" data-output-color="green" title="绿"></button>
                            <button class="guhai-mask-output-swatch" data-output-color="cyan" title="青"></button>
                            <button class="guhai-mask-output-swatch" data-output-color="blue" title="蓝"></button>
                            <button class="guhai-mask-output-swatch" data-output-color="purple" title="紫"></button>
                        </div>
                    </div>
                    <div class="guhai-mask-output-row guhai-mask-output-opacity-row">
                        <div class="guhai-mask-output-opacity-head">
                            <span class="guhai-mask-output-label">透明度</span>
                            <span class="guhai-mask-output-value" data-output-opacity-value></span>
                        </div>
                        <input class="guhai-mask-output-range" data-output-opacity type="range" min="0" max="100" step="5" />
                    </div>
                    <label class="guhai-mask-output-check">
                        <span>自动填充漏洞</span>
                        <input data-output-fill type="checkbox" />
                        <span class="guhai-mask-output-toggle" aria-hidden="true"></span>
                    </label>
                </div>
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
        this.rawPaint = document.createElement("canvas");
        // Keep the hand-painted mask as the source of truth. This in-memory
        // canvas is only a display/save view for optional hole filling.
        this.filledPaint = document.createElement("canvas");
        this.filledPaintValid = false;
        this.drawingPreviewPaint = null;
        this.drawingPreviewRaf = 0;
        this.outputOpacityInput = this.root.querySelector("[data-output-opacity]");
        this.outputOpacityValue = this.root.querySelector("[data-output-opacity-value]");
        this.outputPanel = this.root.querySelector(".guhai-mask-output-panel");
        this.outputColorRow = this.root.querySelector(".guhai-mask-output-color-row");
        this.outputOpacityRow = this.outputOpacityInput?.closest(".guhai-mask-output-row");
        this.outputFillInput = this.root.querySelector("[data-output-fill]");
        for (const sw of this.root.querySelectorAll(".guhai-mask-swatch")) {
            sw.style.background = this.colors[sw.dataset.color];
        }
        this.outputColors = {
            white: "#ffffff", red: "#ff3030", orange: "#ff8c20", yellow: "#ffe52e",
            green: "#28d66f", cyan: "#24d9d1", blue: "#347cff", purple: "#b04cff",
        };
        this.colorOrder = Object.keys(this.outputColors);
        this.colorLayers = new Map();
        this.filledColorLayers = new Map();
        this.dirtyFilledColors = new Set(this.colorOrder);
        if (this.outputMode === "color") this.brushColor = this.outputColor;
        for (const [name, value] of Object.entries(this.outputColors)) this.colors[name] = value;
        for (const sw of this.root.querySelectorAll("[data-output-color]")) {
            sw.style.background = this.outputColors[sw.dataset.outputColor];
        }
        this.outputOpacityInput.value = String(this.outputOpacity);
        this.outputFillInput.checked = this.autoFillHoles;
        this.updateOutputControls();
        this.keyboardSink.focus({ preventScroll: true });
    }

    bind() {
        // Keep keyboard focus on an editable element. ComfyUI deliberately
        // ignores workflow shortcuts originating from text editors.
        this.root.addEventListener("mousedown", (e) => {
            if (e.button !== 0 || e.target === this.keyboardSink) return;
            if (e.target.closest?.("button, input, textarea, select, option")) return;
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
            const outputMode = e.target.closest("[data-output-mode]")?.dataset.outputMode;
            if (outputMode) this.switchOutputMode(outputMode);
            const outputColor = e.target.closest("[data-output-color]")?.dataset.outputColor;
            if (outputColor) {
                this.outputColor = outputColor;
                this.brushColor = outputColor;
                this.activePaintColor = outputColor;
                this.updateOutputControls();
                this.refreshMaskDisplay();
            }
            this.keyboardSink.focus({ preventScroll: true });
        });
        this.outputOpacityInput.addEventListener("input", () => {
            this.outputOpacity = clamp(Number(this.outputOpacityInput.value), 0, 100);
            this.updateOutputControls();
            this.refreshMaskDisplay();
        });
        this.outputFillInput.addEventListener("change", () => {
            this.autoFillHoles = !!this.outputFillInput.checked;
            this.filledPaintValid = false;
            this.refreshMaskDisplay();
        });
        this.stage.addEventListener("mousedown", (e) => this.pointerDown(e));
        window.addEventListener("mousemove", this._move = (e) => this.pointerMove(e), true);
        window.addEventListener("mouseup", this._up = (e) => this.pointerUp(e), true);
        this.stage.addEventListener("mouseleave", () => { this.cursor.style.display = "none"; });
        this.stage.addEventListener("contextmenu", (e) => e.preventDefault());
        this.root.addEventListener("contextmenu", (e) => {
            const swatch = e.target.closest("[data-output-color]");
            if (!swatch || this.outputMode !== "color") return;
            e.preventDefault();
            this.setColor(swatch.dataset.outputColor);
        });
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
            this.rawPaint.width = editW;
            this.rawPaint.height = editH;
            this.filledPaint.width = editW;
            this.filledPaint.height = editH;
            this.buildBaseAlphaPaint(editW, editH);
            await this.loadInitialMask(editW, editH);
            await this.loadInitialColors(editW, editH);
            await this.initializeColorLayers(editW, editH);
            this.colorModePaint = this.cloneCanvas(this.rawPaint);
            if (this.outputMode === "original") {
                this.maskModeBasePaint = this.cloneCanvas(this.rawPaint);
                this.maskModeChangesDirty = false;
                this.brushColor = this.maskBrushColor;
                this.activePaintColor = this.maskBrushColor;
                this.recolorMask();
            }
            this.maskModePaint = this.cloneCanvas(this.rawPaint);
            this.refreshMaskDisplay();
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
        const ctx = this.rawPaint.getContext("2d");
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
            const out = this.rawPaint.getContext("2d").createImageData(editW, editH);
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
            this.rawPaint.getContext("2d").putImageData(out, 0, 0);
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
        this.filledPaintValid = false;
        this.refreshMaskDisplay();
    }

    setColor(color) {
        this.maskBrushColor = color;
        this.root.querySelectorAll("[data-color]").forEach((b) => b.classList.toggle("active", b.dataset.color === color));
        if (this.outputMode !== "color") {
            this.brushColor = color;
            this.activePaintColor = color;
            this.recolorMask();
        }
        this.refreshMaskDisplay();
        this.updateCursor();
    }

    async loadInitialColors(editW, editH) {
        if (!this.colorUrl) return;
        try {
            const colorImg = await loadImage(this.colorUrl);
            const tmp = document.createElement("canvas");
            tmp.width = editW; tmp.height = editH;
            const ctx = tmp.getContext("2d");
            ctx.imageSmoothingEnabled = false;
            ctx.drawImage(colorImg, 0, 0, editW, editH);
            const colors = ctx.getImageData(0, 0, editW, editH).data;
            const mask = this.rawPaint.getContext("2d").getImageData(0, 0, editW, editH);
            for (let i = 0; i < mask.data.length; i += 4) {
                // rawPaint contains the restored mask area as opaque pixels;
                // copy the saved RGB layer into those pixels.
                if (mask.data[i + 3] > 5) {
                    mask.data[i] = colors[i];
                    mask.data[i + 1] = colors[i + 1];
                    mask.data[i + 2] = colors[i + 2];
                }
            }
            this.rawPaint.getContext("2d").putImageData(mask, 0, 0);
        } catch (_) {}
    }

    async initializeColorLayers(editW, editH) {
        this.colorLayers.clear();
        for (const name of this.colorOrder) {
            const canvas = document.createElement("canvas");
            canvas.width = editW; canvas.height = editH;
            this.colorLayers.set(name, canvas);
            const filled = document.createElement("canvas");
            filled.width = editW; filled.height = editH;
            this.filledColorLayers.set(name, filled);
        }
        let restored = null;
        try { restored = await readColorLayersChunk(this.colorUrl); } catch (_) {}
        if (restored && restored.width === editW && restored.height === editH) {
            for (let ci = 0; ci < this.colorOrder.length; ci++) {
                const name = this.colorOrder[ci], canvas = this.colorLayers.get(name);
                const image = canvas.getContext("2d").createImageData(editW, editH);
                const rgb = this.hexRgb(this.outputColors[name]);
                for (let index = 0; index < restored.bits.length; index++) if (restored.bits[index] & (1 << ci)) {
                    const off = index * 4;
                    image.data[off] = rgb[0]; image.data[off + 1] = rgb[1]; image.data[off + 2] = rgb[2]; image.data[off + 3] = 255;
                }
                canvas.getContext("2d").putImageData(image, 0, 0);
            }
        } else {
            const colorName = this.outputColor || "red";
            const target = this.colorLayers.get(colorName) || this.colorLayers.get("red");
            const source = this.rawPaint.getContext("2d").getImageData(0, 0, editW, editH);
            const rgb = this.hexRgb(this.outputColors[colorName] || this.outputColors.red);
            for (let i = 0; i < source.data.length; i += 4) {
                if (source.data[i + 3] <= 5) continue;
                source.data[i] = rgb[0];
                source.data[i + 1] = rgb[1];
                source.data[i + 2] = rgb[2];
            }
            target.getContext("2d").putImageData(source, 0, 0);
        }
        this.composeColorLayers();
        this.dirtyFilledColors = new Set(this.colorOrder);
    }

    composeColorLayers() {
        if (!this.colorLayers?.size || !this.rawPaint.width) return;
        const ctx = this.rawPaint.getContext("2d");
        ctx.clearRect(0, 0, this.rawPaint.width, this.rawPaint.height);
        for (const name of this.colorOrder) ctx.drawImage(this.colorLayers.get(name), 0, 0);
        this.filledPaintValid = false;
    }

    syncColorLayersFromRawPaint() {
        if (!this.colorLayers?.size || !this.rawPaint.width) return;
        const w = this.rawPaint.width, h = this.rawPaint.height;
        const source = this.rawPaint.getContext("2d").getImageData(0, 0, w, h).data;
        const layerImages = new Map();
        const palette = this.colorOrder.map((name) => ({
            name,
            rgb: this.hexRgb(this.outputColors[name]),
        }));
        for (const name of this.colorOrder) {
            const layer = this.colorLayers.get(name);
            layerImages.set(name, layer.getContext("2d").createImageData(w, h));
        }
        for (let offset = 0; offset < source.length; offset += 4) {
            if (source[offset + 3] <= 5) continue;
            let best = palette[0], bestDistance = Infinity;
            for (const entry of palette) {
                const dr = source[offset] - entry.rgb[0];
                const dg = source[offset + 1] - entry.rgb[1];
                const db = source[offset + 2] - entry.rgb[2];
                const distance = dr * dr + dg * dg + db * db;
                if (distance < bestDistance) {
                    best = entry;
                    bestDistance = distance;
                }
            }
            const target = layerImages.get(best.name).data;
            target[offset] = best.rgb[0];
            target[offset + 1] = best.rgb[1];
            target[offset + 2] = best.rgb[2];
            target[offset + 3] = source[offset + 3];
        }
        for (const [name, image] of layerImages) {
            this.colorLayers.get(name).getContext("2d").putImageData(image, 0, 0);
        }
        this.dirtyFilledColors = new Set(this.colorOrder);
        this.colorModePaint = this.cloneCanvas(this.rawPaint);
        this.filledPaintValid = false;
    }

    invalidateFillAfterHistoryChange() {
        this.fillRevision++;
        this.filledPaintValid = false;
        if (this.outputMode === "color") this.syncColorLayersFromRawPaint();
        else this.maskModeChangesDirty = true;
    }

    activeColorLayer() {
        return this.colorLayers?.get(this.outputColor) || this.colorLayers?.get("red") || this.rawPaint;
    }

    switchOutputMode(mode) {
        mode = mode === "color" ? "color" : "original";
        if (mode === this.outputMode) return;
        if (mode === "original") {
            this.composeColorLayers();
            this.maskModeBasePaint = this.cloneCanvas(this.rawPaint);
            this.maskModeChangesDirty = false;
            this.colorModePaint = this.cloneCanvas(this.rawPaint);
            this.outputMode = mode;
            this.brushColor = this.maskBrushColor;
            this.activePaintColor = this.maskBrushColor;
            this.recolorMask();
        } else {
            this.mergeMaskModeChanges();
            this.outputMode = mode;
            this.brushColor = this.outputColor || "red";
            this.activePaintColor = this.brushColor;
            this.composeColorLayers();
        }
        this.filledPaintValid = false;
        this.updateOutputControls();
        this.refreshMaskDisplay();
    }

    cloneCanvas(source) {
        const target = document.createElement("canvas");
        target.width = source.width;
        target.height = source.height;
        target.getContext("2d").drawImage(source, 0, 0);
        return target;
    }

    updateOutputControls() {
        this.root.querySelectorAll("[data-output-mode]").forEach((button) => {
            button.classList.toggle("active", button.dataset.outputMode === this.outputMode);
        });
        this.root.querySelectorAll("[data-output-color]").forEach((button) => {
            button.classList.toggle("active", button.dataset.outputColor === this.outputColor);
        });
        this.outputOpacityInput.value = String(this.outputOpacity);
        this.outputOpacityValue.textContent = `${this.outputOpacity}%`;
        const colorMode = this.outputMode === "color";
        if (colorMode && this.outputColor) {
            this.brushColor = this.outputColor;
            this.activePaintColor = this.outputColor;
        } else if (!colorMode) {
            this.brushColor = this.maskBrushColor;
            this.activePaintColor = this.maskBrushColor;
        }
        this.outputColorRow.style.display = colorMode ? "flex" : "none";
        if (this.outputOpacityRow) this.outputOpacityRow.style.display = colorMode ? "flex" : "none";
    }

    rebuildFilledPaint() {
        if (!this.rawPaint.width || this.tool === "marquee") {
            this.filledPaintValid = false;
            return;
        }
        // Mask-only mode always contains one display color. Reuse the compact
        // single-layer flood fill instead of repeatedly classifying every
        // painted pixel against all eight overlay colors.
        this.rebuildSingleColorFill(this.rawPaint, this.filledPaint, this.colorRgb());
        this.filledPaintValid = true;
    }

    rebuildSingleColorFill(layer, target, rgb) {
        const w = layer.width, h = layer.height;
        const source = layer.getContext("2d").getImageData(0, 0, w, h);
        const result = target.getContext("2d").createImageData(w, h);
        const wall = new Uint8Array(w * h);
        let minX = w, minY = h, maxX = -1, maxY = -1;
        for (let index = 0; index < wall.length; index++) {
            if (source.data[index * 4 + 3] <= 5) continue;
            wall[index] = 1;
            const x = index % w, y = (index / w) | 0;
            if (x < minX) minX = x; if (x > maxX) maxX = x;
            if (y < minY) minY = y; if (y > maxY) maxY = y;
        }
        if (maxX < 0) { target.getContext("2d").clearRect(0, 0, w, h); return; }
        minX = Math.max(0, minX - 1); minY = Math.max(0, minY - 1);
        maxX = Math.min(w - 1, maxX + 1); maxY = Math.min(h - 1, maxY + 1);
        const outside = new Uint8Array(w * h);
        const queue = new Int32Array((maxX - minX + 1) * (maxY - minY + 1));
        let head = 0, tail = 0;
        const visit = (x, y) => {
            if (x < minX || y < minY || x > maxX || y > maxY) return;
            const index = y * w + x;
            if (wall[index] || outside[index]) return;
            outside[index] = 1; queue[tail++] = index;
        };
        for (let x = minX; x <= maxX; x++) { visit(x, minY); visit(x, maxY); }
        for (let y = minY; y <= maxY; y++) { visit(minX, y); visit(maxX, y); }
        while (head < tail) {
            const index = queue[head++], x = index % w, y = (index / w) | 0;
            visit(x - 1, y); visit(x + 1, y); visit(x, y - 1); visit(x, y + 1);
        }
        for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
            const index = y * w + x;
            if (!wall[index] && outside[index]) continue;
            const off = index * 4;
            result.data[off] = rgb[0]; result.data[off + 1] = rgb[1]; result.data[off + 2] = rgb[2]; result.data[off + 3] = 255;
        }
        target.getContext("2d").putImageData(result, 0, 0);
    }

    rebuildFilledColorLayers(names = null) {
        if (!this.colorLayers?.size) { this.rebuildFilledPaint(); return; }
        const rebuildNames = names || [...this.dirtyFilledColors];
        for (const name of rebuildNames) {
            const layer = this.colorLayers.get(name);
            const filledLayer = this.filledColorLayers.get(name);
            if (!layer || !filledLayer) continue;
            this.rebuildSingleColorFill(layer, filledLayer, this.hexRgb(this.outputColors[name]));
            this.dirtyFilledColors.delete(name);
        }
        const output = this.filledPaint.getContext("2d");
        output.clearRect(0, 0, this.filledPaint.width, this.filledPaint.height);
        for (const name of this.colorOrder) output.drawImage(this.filledColorLayers.get(name), 0, 0);
        this.filledPaintValid = true;
    }

    effectiveMaskImageData() {
        const source = this.autoFillHoles && this.tool !== "marquee" && this.filledPaintValid
            ? this.filledPaint
            : this.rawPaint;
        const data = source.getContext("2d").getImageData(0, 0, source.width, source.height);
        if (!this.maskInverted) return data;
        const [r, g, b] = this.outputMode === "color" ? this.outputColorRgb() : this.colorRgb();
        for (let i = 0; i < data.data.length; i += 4) {
            if (data.data[i + 3] > 5) {
                data.data[i] = 0;
                data.data[i + 1] = 0;
                data.data[i + 2] = 0;
                data.data[i + 3] = 0;
            } else {
                data.data[i] = r;
                data.data[i + 1] = g;
                data.data[i + 2] = b;
                data.data[i + 3] = 255;
            }
        }
        return data;
    }

    saveMaskImageData() {
        if (this.autoFillHoles && this.tool !== "marquee" && !this.filledPaintValid) {
            if (this.outputMode === "color") this.rebuildFilledColorLayers();
            else this.rebuildFilledPaint();
        }
        return this.effectiveMaskImageData();
    }

    outputColorRgb() {
        const hex = String(this.outputColors?.[this.outputColor] || "#fff").replace("#", "");
        const value = hex.length === 3 ? hex.split("").map((part) => part + part).join("") : hex;
        return [0, 1, 2].map((index) => {
            const channel = parseInt(value.slice(index * 2, index * 2 + 2), 16);
            return Number.isFinite(channel) ? channel : 255;
        });
    }

    refreshMaskDisplay(rebuildFill = true) {
        if (!this.rawPaint.width) return;
        if (rebuildFill && this.autoFillHoles && this.tool !== "marquee" && !this.filledPaintValid) {
            if (this.outputMode === "color") this.rebuildFilledColorLayers();
            else this.rebuildFilledPaint();
        }
        const source = !rebuildFill && this.tool !== "marquee" && this.drawingPreviewPaint
            ? this.drawingPreviewPaint
            : rebuildFill && this.autoFillHoles && this.tool !== "marquee" && this.filledPaintValid
                ? this.filledPaint
            : this.rawPaint;
        // rawPaint, filledPaint and the color layers already contain their
        // final display RGB values. Copy the canvas directly instead of doing
        // a full getImageData/loop/putImageData pass after every brush stroke.
        const ctx = this.paint.getContext("2d");
        ctx.clearRect(0, 0, this.paint.width, this.paint.height);
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = "source-over";
        if (this.maskInverted) {
            ctx.putImageData(this.effectiveMaskImageData(), 0, 0);
        } else {
            ctx.drawImage(source, 0, 0);
        }
        this.paint.style.opacity = this.outputMode === "color"
            ? String(this.outputOpacity / 100)
            : ".5";
        this.paint.style.filter = "none";
    }

    refreshDrawingPreview() {
        if (this.drawingPreviewRaf) return;
        this.drawingPreviewRaf = requestAnimationFrame(() => {
            this.drawingPreviewRaf = 0;
            if (!this.isDrawing || !this.drawingPreviewPaint) return;
            const ctx = this.paint.getContext("2d");
            ctx.clearRect(0, 0, this.paint.width, this.paint.height);
            ctx.globalAlpha = 1;
            ctx.globalCompositeOperation = "source-over";
            if (this.maskInverted) {
                const data = this.drawingPreviewPaint.getContext("2d").getImageData(0, 0, this.paint.width, this.paint.height);
                const [r, g, b] = this.outputMode === "color" ? this.outputColorRgb() : this.colorRgb();
                for (let i = 0; i < data.data.length; i += 4) {
                    if (data.data[i + 3] > 5) data.data[i + 3] = 0;
                    else {
                        data.data[i] = r; data.data[i + 1] = g; data.data[i + 2] = b; data.data[i + 3] = 255;
                    }
                }
                ctx.putImageData(data, 0, 0);
            } else {
                ctx.drawImage(this.drawingPreviewPaint, 0, 0);
            }
            this.paint.style.opacity = this.outputMode === "color"
                ? String(this.outputOpacity / 100)
                : ".5";
            this.paint.style.filter = "none";
        });
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
        const key = String(e.key || "");
        const code = String(e.code || "");
        const consume = () => {
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation?.();
        };
        if (ctrl && !e.shiftKey && (code === "KeyZ" || key.toLowerCase() === "z")) { consume(); this.undo(); return; }
        if (ctrl && e.shiftKey && (code === "KeyZ" || code === "KeyY" || key.toLowerCase() === "z" || key.toLowerCase() === "y")) { consume(); this.redoAction(); return; }
        if (ctrl && !e.shiftKey && (code === "KeyI" || key.toLowerCase() === "i")) { consume(); this.invert(); return; }
        if (!ctrl && code === "KeyB") { consume(); this.setTool("brush"); return; }
        if (!ctrl && code === "KeyE") { consume(); this.setTool("eraser"); return; }
        if (!ctrl && code === "KeyM") { consume(); this.setTool("marquee"); return; }
        if (!ctrl && code === "KeyX") { consume(); this.clear(); return; }
        if (!ctrl && code === "KeyF") {
            consume();
            this.autoFillHoles = !this.autoFillHoles;
            this.outputFillInput.checked = this.autoFillHoles;
            this.filledPaintValid = false;
            this.refreshMaskDisplay();
            return;
        }
        if (!ctrl && (code === "Enter" || code === "NumpadEnter" || key === "Enter")) { consume(); this.save(); return; }
        if (!ctrl && (code === "Escape" || key === "Escape")) { consume(); this.close(); return; }
        if (!ctrl && (code === "BracketLeft" || key === "[" || key === "\u3010")) { consume(); this.setBrushSize(this.brushSize - 5); return; }
        if (!ctrl && (code === "BracketRight" || key === "]" || key === "\u3011")) { consume(); this.setBrushSize(this.brushSize + 5); return; }
        if (code === "Space" || key === " ") { consume(); this.spaceDown = true; this.updateCursor(); return; }
        if (code === "AltLeft" || code === "AltRight" || key === "Alt") { consume(); this.altDown = true; this.updateCursor(); return; }
        if ((code === "ShiftLeft" || code === "ShiftRight" || key === "Shift") && !this.shiftDown) {
            consume();
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
        const code = String(e.code || "");
        if (code === "Space" || e.key === " ") { this.spaceDown = false; this.updateCursor(); }
        if (code === "AltLeft" || code === "AltRight" || e.key === "Alt") { this.altDown = false; this.updateCursor(); }
        if (code === "ShiftLeft" || code === "ShiftRight" || e.key === "Shift") {
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
        if (e.target.closest?.(".guhai-mask-output-panel")) {
            this.cursor.style.display = "none";
            return;
        }
        if (!this.paint.width) return;
        this.lastMouse = { x: e.clientX, y: e.clientY };
        let colorContext = null;
        if (e.button === 2 && this.outputMode === "color" && this.tool !== "marquee") {
            const pos = this.canvasPos(e);
            if (!this.filledPaintValid || this.dirtyFilledColors.size) {
                this.rebuildFilledColorLayers([...this.dirtyFilledColors]);
            }
            let hit = null;
            for (let i = this.colorOrder.length - 1; i >= 0; i--) {
                const name = this.colorOrder[i];
                const layer = this.filledColorLayers.get(name);
                const pixel = layer.getContext("2d").getImageData(Math.floor(pos.x), Math.floor(pos.y), 1, 1).data;
                if (pixel[3] > 5) { hit = { name, pixel }; break; }
            }
            if (hit) {
                colorContext = {
                    x: e.clientX,
                    y: e.clientY,
                    rgb: this.hexRgb(this.outputColors[hit.name]),
                    pos,
                    sourceName: hit.name,
                };
            }
        }
        if (e.button === 2 && this.tool !== "marquee") {
            e.preventDefault();
            this.closeColorContextMenu();
            this.rightResize = {
                x: e.clientX,
                y: e.clientY,
                size: this.brushSize,
                moved: false,
                colorContext,
            };
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
        if (this.tool !== "marquee") {
            if (!this.filledPaintValid) {
                if (this.autoFillHoles) {
                    if (this.outputMode === "color") this.rebuildFilledColorLayers([...this.dirtyFilledColors]);
                    else this.rebuildFilledPaint();
                }
            }
            this.drawingPreviewPaint = document.createElement("canvas");
            this.drawingPreviewPaint.width = this.rawPaint.width;
            this.drawingPreviewPaint.height = this.rawPaint.height;
            this.drawingPreviewPaint.getContext("2d").drawImage(
                this.autoFillHoles ? this.filledPaint : this.rawPaint,
                0,
                0,
            );
        } else {
            this.drawingPreviewPaint = null;
        }
        this.isDrawing = true;
        this.lastDrawClient = { x: e.clientX, y: e.clientY };
        this.drawingColor = this.outputColor;
        if (this.outputMode === "color") this.dirtyFilledColors.add(this.drawingColor);
        this.filledPaintValid = false;
        this.lastPos = this.canvasPos(e);
        const ctx = this.outputMode === "color" ? this.activeColorLayer().getContext("2d") : this.rawPaint.getContext("2d");
        this.applyBrush(ctx);
        ctx.beginPath();
        ctx.arc(this.lastPos.x, this.lastPos.y, this.brushSize / 2, 0, Math.PI * 2);
        ctx.fill();
        if (this.drawingPreviewPaint) {
            const previewCtx = this.drawingPreviewPaint.getContext("2d");
            this.applyBrush(previewCtx);
            previewCtx.beginPath();
            previewCtx.arc(this.lastPos.x, this.lastPos.y, this.brushSize / 2, 0, Math.PI * 2);
            previewCtx.fill();
        }
        this.refreshDrawingPreview();
    }

    pointerMove(e) {
        this.lastMouse = { x: e.clientX, y: e.clientY };
        if (this.rightResize) {
            e.preventDefault();
            const dx = e.clientX - this.rightResize.x;
            const dy = e.clientY - this.rightResize.y;
            if (!this.rightResize.moved && Math.hypot(dx, dy) >= 5) {
                this.rightResize.moved = true;
                this.rightResize.colorContext = null;
            }
            if (this.rightResize.moved) {
                this.setBrushSize(this.rightResize.size + Math.round(dx / 2));
            }
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
        if (this.lastDrawClient
            && Math.hypot(e.clientX - this.lastDrawClient.x, e.clientY - this.lastDrawClient.y) < 2.5) return;
        this.lastDrawClient = { x: e.clientX, y: e.clientY };
        const pos = this.canvasPos(e);
        const ctx = this.outputMode === "color" ? this.activeColorLayer().getContext("2d") : this.rawPaint.getContext("2d");
        this.filledPaintValid = false;
        this.applyBrush(ctx);
        ctx.beginPath();
        ctx.moveTo(this.lastPos.x, this.lastPos.y);
        ctx.lineTo(pos.x, pos.y);
        ctx.stroke();
        if (this.drawingPreviewPaint) {
            const previewCtx = this.drawingPreviewPaint.getContext("2d");
            this.applyBrush(previewCtx);
            previewCtx.beginPath();
            previewCtx.moveTo(this.lastPos.x, this.lastPos.y);
            previewCtx.lineTo(pos.x, pos.y);
            previewCtx.stroke();
        }
        this.lastPos = pos;
        this.refreshDrawingPreview();
    }

    pointerUp() {
        if (this.rightResize) {
            const gesture = this.rightResize;
            this.rightResize = null;
            if (!gesture.moved && gesture.colorContext) {
                const hit = gesture.colorContext;
                this.openColorContextMenu(hit.x, hit.y, hit.rgb, hit.pos, hit.sourceName);
            }
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
            this.lastDrawClient = null;
            if (this.drawingPreviewRaf) {
                cancelAnimationFrame(this.drawingPreviewRaf);
                this.drawingPreviewRaf = 0;
            }
            this.drawingPreviewPaint = null;
            if (this.outputMode === "color") this.composeColorLayers();
            this.pushHistory();
            if (this.outputMode === "color") this.colorModePaint = this.cloneCanvas(this.rawPaint);
            else this.maskModeChangesDirty = true;
            if (this.autoFillHoles && this.outputMode === "color") {
                const color = this.drawingColor;
                const revision = ++this.fillRevision;
                setTimeout(() => {
                    if (revision !== this.fillRevision || !this.autoFillHoles) return;
                    this.rebuildFilledColorLayers([color]);
                    this.refreshMaskDisplay(true);
                }, 0);
            } else if (this.autoFillHoles) {
                const revision = ++this.fillRevision;
                setTimeout(() => {
                    if (revision !== this.fillRevision || !this.autoFillHoles) return;
                    this.rebuildFilledPaint();
                    this.refreshMaskDisplay(true);
                }, 0);
            } else {
                this.refreshMaskDisplay();
            }
            this.drawingColor = null;
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

    colorComponent(rgb, forcedSourceName = null, useFilled = false) {
        const w = this.rawPaint.width, h = this.rawPaint.height;
        const sourceName = forcedSourceName || this.colorOrder?.find((name) => {
            const c = this.hexRgb(this.outputColors[name]);
            return (c[0] - rgb[0]) ** 2 + (c[1] - rgb[1]) ** 2 + (c[2] - rgb[2]) ** 2 <= 55 * 55;
        });
        const source = sourceName
            ? (useFilled ? this.filledColorLayers?.get(sourceName) : this.colorLayers?.get(sourceName))
            : null;
        const data = (source || this.rawPaint).getContext("2d").getImageData(0, 0, w, h).data;
        const same = (index) => {
            if (data[index * 4 + 3] <= 5) return false;
            const dr = data[index * 4] - rgb[0], dg = data[index * 4 + 1] - rgb[1], db = data[index * 4 + 2] - rgb[2];
            return dr * dr + dg * dg + db * db <= 55 * 55;
        };
        const components = [];
        const visited = new Uint8Array(w * h);
        for (let i = 0; i < w * h; i++) {
            if (!same(i) || visited[i]) continue;
            const queue = [i], cells = [];
            visited[i] = 1;
            for (let head = 0; head < queue.length; head++) {
                const index = queue[head]; cells.push(index);
                const x = index % w, y = Math.floor(index / w);
                for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) {
                    if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
                    const ni = ny * w + nx;
                    if (!visited[ni] && same(ni)) { visited[ni] = 1; queue.push(ni); }
                }
            }
            components.push(cells);
        }
        return components;
    }

    openColorContextMenu(x, y, rgb, point = null, sourceName = null) {
        this.closeColorContextMenu();
        const menu = document.createElement("div");
        menu.className = "guhai-mask-color-menu";
        menu.style.left = `${x}px`; menu.style.top = `${y}px`;
        for (const [name, color] of Object.entries(this.outputColors)) {
            const button = document.createElement("button");
            button.title = name; button.style.background = color;
            button.addEventListener("click", () => { this.modifyColorComponent(rgb, name, point, sourceName); this.closeColorContextMenu(); });
            menu.appendChild(button);
        }
        const del = document.createElement("button");
        del.textContent = "×"; del.title = "删除连续区域";
        del.addEventListener("click", () => { this.modifyColorComponent(rgb, null, point, sourceName); this.closeColorContextMenu(); });
        menu.appendChild(del);
        document.body.appendChild(menu);
        this._colorMenu = menu;
        setTimeout(() => window.addEventListener("mousedown", this._colorMenuOutside = (e) => { if (!menu.contains(e.target)) this.closeColorContextMenu(); }, true), 0);
    }

    closeColorContextMenu() {
        this._colorMenu?.remove(); this._colorMenu = null;
        if (this._colorMenuOutside) window.removeEventListener("mousedown", this._colorMenuOutside, true);
        this._colorMenuOutside = null;
    }

    modifyColorComponent(rgb, colorName, point = null, forcedSourceName = null) {
        const components = this.colorComponent(rgb, forcedSourceName, !!forcedSourceName);
        const pos = point;
        let target = components[0];
        if (pos) {
            const index = Math.floor(pos.y) * this.rawPaint.width + Math.floor(pos.x);
            target = components.find((cells) => cells.includes(index)) || target;
        }
        if (!target) return;
        const sourceName = forcedSourceName || this.colorOrder.find((name) => {
            const c = this.hexRgb(this.outputColors[name]);
            return (c[0] - rgb[0]) ** 2 + (c[1] - rgb[1]) ** 2 + (c[2] - rgb[2]) ** 2 <= 55 * 55;
        }) || this.outputColor;
        const source = this.colorLayers?.get(sourceName);
        const targetLayer = colorName ? this.colorLayers?.get(colorName) : null;
        const ctx = source ? source.getContext("2d") : this.rawPaint.getContext("2d");
        const data = ctx.getImageData(0, 0, this.rawPaint.width, this.rawPaint.height);
        const targetData = targetLayer && targetLayer !== source
            ? targetLayer.getContext("2d").getImageData(0, 0, this.rawPaint.width, this.rawPaint.height)
            : null;
        const rgb2 = colorName ? this.hexRgb(this.outputColors[colorName]) : [0, 0, 0];
        for (const index of target) {
            const off = index * 4;
            // A filled component also contains its generated interior. Only
            // move/delete pixels that were actually painted in the source
            // layer, so disabling auto-fill still restores the real strokes.
            if (data.data[off + 3] <= 5) continue;
            if (targetData) {
                targetData.data[off] = rgb2[0]; targetData.data[off + 1] = rgb2[1]; targetData.data[off + 2] = rgb2[2]; targetData.data[off + 3] = data.data[off + 3];
            } else if (colorName) {
                data.data[off] = rgb2[0]; data.data[off + 1] = rgb2[1]; data.data[off + 2] = rgb2[2];
            }
            if (!colorName || targetData) { data.data[off] = 0; data.data[off + 1] = 0; data.data[off + 2] = 0; data.data[off + 3] = 0; }
        }
        ctx.putImageData(data, 0, 0);
        if (targetData) targetLayer.getContext("2d").putImageData(targetData, 0, 0);
        if (this.colorLayers?.size) {
            this.dirtyFilledColors.add(sourceName);
            if (colorName) this.dirtyFilledColors.add(colorName);
        }
        if (this.colorLayers?.size) this.composeColorLayers();
        this.filledPaintValid = false; this.pushHistory(); this.refreshMaskDisplay();
    }

    hexRgb(hex) {
        const v = String(hex).replace("#", "");
        return [0, 1, 2].map((i) => parseInt(v.slice(i * 2, i * 2 + 2), 16) || 0);
    }

    mergeMaskModeChanges() {
        if (!this.maskModeChangesDirty || !this.maskModeBasePaint || !this.colorLayers?.size) return;
        const w = this.rawPaint.width, h = this.rawPaint.height;
        const current = this.rawPaint.getContext("2d").getImageData(0, 0, w, h);
        const base = this.maskModeBasePaint.getContext("2d").getImageData(0, 0, w, h).data;
        const selectedName = this.outputColor || "red";
        const selected = this.hexRgb(this.outputColors[selectedName] || this.outputColors.red);
        const layerData = new Map();
        for (const [name, layer] of this.colorLayers) {
            layerData.set(name, layer.getContext("2d").getImageData(0, 0, w, h));
        }
        let changed = false;
        for (let i = 0; i < current.data.length; i += 4) {
            const was = base[i + 3] > 5, is = current.data[i + 3] > 5;
            if (was === is) continue;
            changed = true;
            if (!is) {
                for (const data of layerData.values()) {
                    data.data[i] = 0;
                    data.data[i + 1] = 0;
                    data.data[i + 2] = 0;
                    data.data[i + 3] = 0;
                }
            } else {
                const data = layerData.get(selectedName)
                    || [...layerData.values()][this.colorOrder.indexOf("red")]
                    || [...layerData.values()][0];
                data.data[i] = selected[0];
                data.data[i + 1] = selected[1];
                data.data[i + 2] = selected[2];
                data.data[i + 3] = current.data[i + 3];
            }
        }
        if (changed) {
            for (const [name, data] of layerData) {
                this.colorLayers.get(name).getContext("2d").putImageData(data, 0, 0);
            }
            this.dirtyFilledColors = new Set(this.colorOrder);
            this.filledPaintValid = false;
        }
        this.colorModePaint = this.cloneCanvas(this.rawPaint);
        this.maskModeBasePaint = this.cloneCanvas(this.rawPaint);
        this.maskModeChangesDirty = false;
    }

    updateCursor(e) {
        if (!this.lastMouse && !e) return;
        if (e?.target?.closest?.(".guhai-mask-output-panel")) {
            this.cursor.style.display = "none";
            this.stage.style.cursor = "";
            return;
        }
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
        const ctx = this.rawPaint.getContext("2d");
        this.history.push({
            image: ctx.getImageData(0, 0, this.paint.width, this.paint.height),
            inverted: this.maskInverted,
        });
        if (this.history.length > 50) this.history.shift();
        this.redo = [];
    }

    undo() {
        if (this.history.length <= 1) return;
        const ctx = this.rawPaint.getContext("2d");
        this.redo.push(this.history.pop());
        const snapshot = this.history[this.history.length - 1];
        ctx.putImageData(snapshot.image, 0, 0);
        this.maskInverted = !!snapshot.inverted;
        this.invalidateFillAfterHistoryChange();
        this.clearMarquee();
        this.refreshMaskDisplay();
    }

    redoAction() {
        if (!this.redo.length) return;
        const snap = this.redo.pop();
        this.history.push(snap);
        this.rawPaint.getContext("2d").putImageData(snap.image, 0, 0);
        this.maskInverted = !!snap.inverted;
        this.invalidateFillAfterHistoryChange();
        this.clearMarquee();
        this.refreshMaskDisplay();
    }

    clear() {
        this.fillRevision++;
        this.isDrawing = false;
        this.lastDrawClient = null;
        if (this.drawingPreviewRaf) {
            cancelAnimationFrame(this.drawingPreviewRaf);
            this.drawingPreviewRaf = 0;
        }
        this.drawingPreviewPaint = null;
        if (this.outputMode === "color" && this.colorLayers?.size) {
            for (const layer of this.colorLayers.values()) layer.getContext("2d").clearRect(0, 0, layer.width, layer.height);
            this.composeColorLayers();
        } else {
            this.rawPaint.getContext("2d").clearRect(0, 0, this.paint.width, this.paint.height);
        }
        this.filledPaint.getContext("2d").clearRect(0, 0, this.filledPaint.width, this.filledPaint.height);
        for (const layer of this.filledColorLayers?.values?.() || []) layer.getContext("2d").clearRect(0, 0, layer.width, layer.height);
        this.dirtyFilledColors = new Set();
        this.filledPaintValid = false;
        if (this.outputMode !== "color") this.maskModeChangesDirty = true;
        this.clearMarquee();
        this.pushHistory();
        this.refreshMaskDisplay();
    }

    invert() {
        this.fillMarqueeIntoMask();
        this.maskInverted = !this.maskInverted;
        this.clearMarquee();
        this.pushHistory();
        this.refreshMaskDisplay();
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
        const ctx = this.rawPaint.getContext("2d");
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
        if (changed) {
            ctx.putImageData(data, 0, 0);
            this.filledPaintValid = false;
        }
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
        const ctx = this.rawPaint.getContext("2d");
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
        if (this.outputMode !== "color") this.maskModeChangesDirty = true;
        this.clearMarquee();
        this.pushHistory();
        this.refreshMaskDisplay();
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
            if (this.outputMode !== "color") this.mergeMaskModeChanges();
            const sourceImage = this.sourceImage || this.img;
            const editImage = this.editImageCanvas || this.img;
            const sourceUrl = this.imageUrl;
            // Freeze the exact editor result before starting any async upload.
            // This prevents a workflow undo/configure event from changing the
            // canvas or node state while the save task is being prepared.
            const paint = document.createElement("canvas");
            paint.width = this.rawPaint.width;
            paint.height = this.rawPaint.height;
            paint.getContext("2d").putImageData(this.saveMaskImageData(), 0, 0);
            // Keep the hand-painted mask separate from the optional filled
            // display/save view. The paired painted-masked file must always
            // contain the raw strokes so the editor can toggle filling again
            // when it is reopened.
            const rawMask = document.createElement("canvas");
            rawMask.width = this.rawPaint.width;
            rawMask.height = this.rawPaint.height;
            rawMask.getContext("2d").drawImage(this.rawPaint, 0, 0);
            const colorChunkTask = this.colorLayers?.size
                ? colorLayersPngChunk(this.colorLayers, this.colorOrder, this.rawPaint.width, this.rawPaint.height)
                : Promise.resolve(null);
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
            const loaderTag = this.preserveRgbUnderMask ? "" : "-goohai";
            const stateTag = `__ghm-${this.outputMode}-${this.outputColor}-${this.outputOpacity}-${this.autoFillHoles ? 1 : 0}-${this.maskInverted ? 1 : 0}${loaderTag}`;
            const outputCanvas = document.createElement("canvas");
            outputCanvas.width = natW;
            outputCanvas.height = natH;
            const outputCtx = outputCanvas.getContext("2d");
            outputCtx.drawImage(sourceImage || editImage, 0, 0, natW, natH);
             if (this.outputMode === "color" && this.outputOpacity > 0) {
                 const colorLayer = document.createElement("canvas");
                 colorLayer.width = natW;
                 colorLayer.height = natH;
                 const colorCtx = colorLayer.getContext("2d");
                 colorCtx.imageSmoothingEnabled = false;
                 colorCtx.drawImage(paint, 0, 0, natW, natH);
                 const colorData = colorCtx.getImageData(0, 0, natW, natH);
                 const factor = this.outputOpacity / 100;
                 for (let i = 3; i < colorData.data.length; i += 4) colorData.data[i] = Math.round(colorData.data[i] * factor);
                 colorCtx.putImageData(colorData, 0, 0);
                 outputCtx.drawImage(colorLayer, 0, 0);
            }
            const outputData = outputCtx.getImageData(0, 0, natW, natH);
            const outputMask = document.createElement("canvas");
            outputMask.width = natW;
            outputMask.height = natH;
            const outputMaskCtx = outputMask.getContext("2d");
            outputMaskCtx.imageSmoothingEnabled = false;
            outputMaskCtx.drawImage(savePaint, 0, 0, natW, natH);
            const outputMaskData = outputMaskCtx.getImageData(0, 0, natW, natH).data;
            // The official loader reads its mask from this PNG's alpha. The
            // Goohai loader already reads the separate painted-masked file, so
            // its painted-output can keep the complete RGBA composite without
            // creating another image file.
            // Store the effective (possibly hole-filled) mask in the existing
            // output PNG alpha channel for both loaders. The source image is
            // restored from the paired original file when it is read, so this
            // does not require an additional mask file.
            for (let i = 0; i < outputData.data.length; i += 4) {
                if (outputMaskData[i + 3] > 5) outputData.data[i + 3] = 0;
            }
            const outputBlobTask = rgbaToPngBlob(outputData.data, natW, natH);
            // The saved image remains the requested output. Only the editor
            // preview gets the legacy green mask overlay in original mode.
            if (this.outputMode === "original") {
                const previewOverlay = outputCtx.createImageData(natW, natH);
                for (let i = 0; i < outputMaskData.length; i += 4) {
                    previewOverlay.data[i] = 42;
                    previewOverlay.data[i + 1] = 210;
                    previewOverlay.data[i + 2] = 112;
                    previewOverlay.data[i + 3] = outputMaskData[i + 3] > 5 ? 128 : 0;
                }
                const previewLayer = document.createElement("canvas");
                previewLayer.width = natW;
                previewLayer.height = natH;
                previewLayer.getContext("2d").putImageData(previewOverlay, 0, 0);
                outputCtx.drawImage(previewLayer, 0, 0);
            }
            // Build the preview independently of the uploads. The legacy
            // canvas can display it before the image widget is updated.
            const previewTask = (async () => {
                await nextFrame();
                // Keep the node preview's original alpha. JPEG would turn
                // transparent PNG pixels into a black background.
                return await canvasToObjectUrl(outputCanvas, "image/png");
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
                let maskedBlob = null;
                const colorChunk = await colorChunkTask;
                if (this.preserveRgbUnderMask) {
                    const maskCanvas = document.createElement("canvas");
                    maskCanvas.width = natW;
                    maskCanvas.height = natH;
                    const maskCtx = maskCanvas.getContext("2d");
                    maskCtx.imageSmoothingEnabled = false;
                    maskCtx.drawImage(rawMask, 0, 0, natW, natH);
                    const imageData = mctx.getImageData(0, 0, natW, natH);
                    const maskData = maskCtx.getImageData(0, 0, natW, natH).data;
                    const rawData = rawMask.getContext("2d").getImageData(0, 0, rawMask.width, rawMask.height).data;
                    const sx = rawMask.width / natW, sy = rawMask.height / natH;
                    for (let i = 0; i < imageData.data.length; i += 4) {
                        const originalAlpha = imageData.data[i + 3];
                        if (originalAlpha < 250) {
                            imageData.data[i] = 255;
                            imageData.data[i + 1] = 255;
                            imageData.data[i + 2] = 255;
                        }
                        if (maskData[i + 3] > 5) {
                            imageData.data[i + 3] = 1;
                            const x = (i / 4) % natW, y = Math.floor((i / 4) / natW);
                            const ri = (Math.min(rawMask.height - 1, Math.floor(y * sy)) * rawMask.width + Math.min(rawMask.width - 1, Math.floor(x * sx))) * 4;
                            imageData.data[i] = rawData[ri];
                            imageData.data[i + 1] = rawData[ri + 1];
                            imageData.data[i + 2] = rawData[ri + 2];
                        }
                    }
                    officialMaskedBlob = await rgbaToPngBlob(imageData.data, natW, natH, colorChunk ? [colorChunk] : []);
                } else {
                    mctx.globalCompositeOperation = "destination-out";
                    mctx.imageSmoothingEnabled = false;
                    mctx.drawImage(rawMask, 0, 0, natW, natH);
                    mctx.globalCompositeOperation = "source-over";
                    // Preserve the per-pixel paint colors under the transparent
                    // mask pixels. The alpha remains the mask, while RGB is
                    // used to restore color layers when reopening the editor.
                    const maskedData = mctx.getImageData(0, 0, natW, natH);
                    const rawData = rawMask.getContext("2d").getImageData(0, 0, rawMask.width, rawMask.height).data;
                    const sx = rawMask.width / natW, sy = rawMask.height / natH;
                    for (let y = 0; y < natH; y++) for (let x = 0; x < natW; x++) {
                        const oi = (y * natW + x) * 4;
                        const ri = (Math.min(rawMask.height - 1, Math.floor(y * sy)) * rawMask.width + Math.min(rawMask.width - 1, Math.floor(x * sx))) * 4;
                        if (rawData[ri + 3] > 5) {
                            maskedData.data[oi] = rawData[ri];
                            maskedData.data[oi + 1] = rawData[ri + 1];
                            maskedData.data[oi + 2] = rawData[ri + 2];
                            // Keep a non-zero alpha so browser PNG decoding
                            // preserves the RGB color for editor reopening.
                            // The loader still treats this as a masked pixel.
                            maskedData.data[oi + 3] = 1;
                        }
                    }
                    mctx.putImageData(maskedData, 0, 0);
                    maskedBlob = await rgbaToPngBlob(maskedData.data, natW, natH, colorChunk ? [colorChunk] : []);
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
                        : uploadBlob(maskedBlob, `clipspace-painted-masked-${ts}.png`, "clipspace"),
                    uploadBlob(await outputBlobTask, `clipspace-painted-output-${ts}${stateTag}.png`, "clipspace"),
                ];
                const [, uploadedMasked, uploadedOutput] = await Promise.all(uploads);

                const uploadedName = uploadedOutput.name || uploadedOutput.filename || `clipspace-painted-output-${ts}${stateTag}.png`;
                const uploadedPath = `${uploadedMasked.subfolder ? `${uploadedMasked.subfolder}/` : ""}${uploadedName} [input]`;
                return {
                    value: uploadedPath,
                    previewTask,
                    outputState: {
                        mode: this.outputMode,
                        color: this.outputColor,
                        opacity: this.outputOpacity,
                        fill: this.autoFillHoles,
                        inverted: this.maskInverted,
                    },
                };
            })();
            this.onSave(task, previewTask);
            this.close();
        } catch (err) {
            alert(`\u4fdd\u5b58\u906e\u7f69\u5931\u8d25: ${err?.message || err}`);
        }
    }

    close() {
        if (this.raf) cancelAnimationFrame(this.raf);
        if (this.drawingPreviewRaf) cancelAnimationFrame(this.drawingPreviewRaf);
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
    return !!node?._guhaiMaskSaving
        || value.includes("painted-masked")
        || value.includes("painted-output-")
        || value.includes("clipspace-mask-");
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

function ensureNodeToolbar(node, nodeRoot = null) {
    if (!isLoadImageGoohaiNode(node)) return null;
    const root = nodeRoot || node._guhaiDomToolbar?.closest?.("[data-node-id]");
    if (!root?.isConnected) return null;
    let toolbar = root.querySelector?.(".guhai-nodes2-load-toolbar");
    if (!toolbar) {
        toolbar = document.createElement("div");
        toolbar.className = "guhai-nodes2-load-toolbar";
        toolbar.innerHTML = `
            <button type="button" data-action="upload" title="上传图像">上传</button>
            <button type="button" data-action="transparent" title="保留透明通道" aria-label="RGBA"></button>
            <button type="button" data-action="mask" title="遮罩编辑">遮罩</button>
        `;
        toolbar.addEventListener("pointerdown", (event) => {
            event.stopPropagation();
        });
        toolbar.addEventListener("click", (event) => {
            const button = event.target?.closest?.("button[data-action]");
            if (!button) return;
            event.preventDefault();
            event.stopPropagation();
            const action = button.dataset.action;
            if (action === "upload") {
                openUploadForNode(node);
            } else if (action === "transparent") {
                const transparentWidget = findTransparentWidget(node);
                if (transparentWidget) {
                    transparentWidget.value = !transparentWidget.value;
                    transparentWidget.callback?.(transparentWidget.value);
                    persistLoadImageState(node);
                    node.setDirtyCanvas(true, true);
                    app.graph?.change?.();
                }
            } else if (action === "mask") {
                openEditorForNode(node);
            }
            updateNodeToolbar(node);
        });
    }
    // Keep the controls outside node-widgets. Nodes 2.0 lays that container
    // out as regular content, so inserting the toolbar there both narrows the
    // button row and pushes the image selector/preview down.
    if (toolbar.parentElement !== root) root.appendChild(toolbar);
    toolbar.style.setProperty("--guhai-node-button-bg", getNodeButtonFill(node));
    node._guhaiDomToolbar = toolbar;
    updateNodeToolbar(node);
    return toolbar;
}

function updateNodeToolbar(node) {
    const toolbar = node?._guhaiDomToolbar;
    if (!toolbar?.isConnected) return;
    const transparentOn = !!findTransparentWidget(node)?.value;
    const transparent = toolbar.querySelector('[data-action="transparent"]');
    if (transparent) {
        // Nodes 2.0's localization layer can translate the RGBA text node into
        // the boolean widget label (for example "Alpha图像"). Keep the button
        // text-free and render the fixed label through CSS instead.
        if (transparent.textContent) transparent.textContent = "";
        transparent.classList.toggle("active", transparentOn);
    }
    toolbar.querySelector('[data-action="mask"]')?.classList.toggle("active", nodeHasMask(node));
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

function alignNodes2ImageWidget(nodeRoot) {
    const widgetRoot = nodeRoot.querySelector?.('[data-testid="node-widgets"]');
    if (!widgetRoot) return;
    const label = [...widgetRoot.querySelectorAll("label, span, div")].find((element) =>
        element.childElementCount === 0 && String(element.textContent || "").trim() === "画布图像"
    );
    if (!label) return;
    let row = label.parentElement;
    while (row && row !== widgetRoot && !row.querySelector("button, input, select, [role='combobox']")) {
        row = row.parentElement;
    }
    if (!row || row === widgetRoot) return;
    const control = row.querySelector("button, input, select, [role='combobox']");
    if (!control) return;
    let controlGroup = control;
    while (controlGroup.parentElement && controlGroup.parentElement !== row) controlGroup = controlGroup.parentElement;
    row.dataset.guhaiImageWidgetRow = "true";
    label.dataset.guhaiImageWidgetLabel = "true";
    controlGroup.dataset.guhaiImageWidgetControl = "true";
}

function refreshNodes2LoadImageToolbars(root = document) {
    const roots = root.matches?.("[data-node-id]")
        ? [root]
        : [...(root.querySelectorAll?.("[data-node-id]") || [])];
    for (const nodeRoot of roots) {
        const nodeId = nodeRoot.dataset?.nodeId;
        const node = nodeId != null
            ? (app.graph?.getNodeById?.(nodeId) || app.graph?.getNodeById?.(Number(nodeId)))
            : null;
        const existing = nodeRoot.querySelector?.(".guhai-nodes2-load-toolbar");
        if (isLoadImageGoohaiNode(node)) {
            ensureNodeToolbar(node, nodeRoot);
            alignNodes2ImageWidget(nodeRoot);
        }
        else existing?.remove();
    }
}

function filledColorLayer(bits, bit, width, height) {
    const total = width * height;
    const layer = new Uint8Array(total);
    let minX = width, minY = height, maxX = -1, maxY = -1;
    for (let index = 0; index < total; index++) {
        if (!(bits[index] & bit)) continue;
        layer[index] = 1;
        const x = index % width, y = (index / width) | 0;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
    }
    if (maxX < 0) return layer;

    minX = Math.max(0, minX - 1);
    minY = Math.max(0, minY - 1);
    maxX = Math.min(width - 1, maxX + 1);
    maxY = Math.min(height - 1, maxY + 1);
    const outside = new Uint8Array(total);
    const queue = new Int32Array((maxX - minX + 1) * (maxY - minY + 1));
    let head = 0, tail = 0;
    const visit = (x, y) => {
        if (x < minX || y < minY || x > maxX || y > maxY) return;
        const index = y * width + x;
        if (layer[index] || outside[index]) return;
        outside[index] = 1;
        queue[tail++] = index;
    };
    for (let x = minX; x <= maxX; x++) {
        visit(x, minY);
        visit(x, maxY);
    }
    for (let y = minY; y <= maxY; y++) {
        visit(minX, y);
        visit(maxX, y);
    }
    while (head < tail) {
        const index = queue[head++], x = index % width, y = (index / width) | 0;
        visit(x - 1, y);
        visit(x + 1, y);
        visit(x, y - 1);
        visit(x, y + 1);
    }
    for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
        const index = y * width + x;
        if (!outside[index]) layer[index] = 1;
    }
    return layer;
}

function colorOutputPreviewUrl(sources, outputState) {
    if (!sources?.imageUrl || !sources?.colorUrl || outputState?.mode !== "color") return Promise.resolve(null);
    const key = [
        cacheKeyForUrl(sources.imageUrl),
        cacheKeyForUrl(sources.colorUrl),
        clamp(Number(outputState.opacity ?? 50), 0, 100),
        outputState.fill ? 1 : 0,
        outputState.inverted ? 1 : 0,
    ].join("|");
    if (colorPreviewCache.has(key)) return colorPreviewCache.get(key);

    const promise = Promise.all([
        loadImage(sources.imageUrl),
        readColorLayersChunk(sources.colorUrl),
    ]).then(async ([original, savedLayers]) => {
        if (!savedLayers) return null;
        const colors = [
            [255, 255, 255], [255, 48, 48], [255, 140, 32], [255, 229, 46],
            [40, 214, 111], [36, 217, 209], [52, 124, 255], [176, 76, 255],
        ];
        const layerCanvas = document.createElement("canvas");
        layerCanvas.width = savedLayers.width;
        layerCanvas.height = savedLayers.height;
        const layerCtx = layerCanvas.getContext("2d");
        const layerImage = layerCtx.createImageData(savedLayers.width, savedLayers.height);
        const alpha = Math.round(255 * clamp(Number(outputState.opacity ?? 50), 0, 100) / 100);
        for (let colorIndex = 0; colorIndex < colors.length; colorIndex++) {
            const bit = 1 << colorIndex;
            const pixels = outputState.fill
                ? filledColorLayer(savedLayers.bits, bit, savedLayers.width, savedLayers.height)
                : null;
            const rgb = colors[colorIndex];
            for (let index = 0; index < savedLayers.bits.length; index++) {
                if (pixels ? !pixels[index] : !(savedLayers.bits[index] & bit)) continue;
                const offset = index * 4;
                layerImage.data[offset] = rgb[0];
                layerImage.data[offset + 1] = rgb[1];
                layerImage.data[offset + 2] = rgb[2];
                layerImage.data[offset + 3] = alpha;
            }
        }
        if (outputState.inverted) {
            const colorNames = ["white", "red", "orange", "yellow", "green", "cyan", "blue", "purple"];
            const fallback = colors[Math.max(0, colorNames.indexOf(outputState.color))] || colors[1];
            const source = new Uint8ClampedArray(layerImage.data);
            for (let index = 0; index < savedLayers.bits.length; index++) {
                const offset = index * 4;
                if (source[offset + 3] > 5) {
                    layerImage.data[offset] = 0;
                    layerImage.data[offset + 1] = 0;
                    layerImage.data[offset + 2] = 0;
                    layerImage.data[offset + 3] = 0;
                } else {
                    layerImage.data[offset] = fallback[0];
                    layerImage.data[offset + 1] = fallback[1];
                    layerImage.data[offset + 2] = fallback[2];
                    layerImage.data[offset + 3] = alpha;
                }
            }
        }
        layerCtx.putImageData(layerImage, 0, 0);

        const canvas = document.createElement("canvas");
        canvas.width = original.naturalWidth || original.width;
        canvas.height = original.naturalHeight || original.height;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(original, 0, 0, canvas.width, canvas.height);
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(layerCanvas, 0, 0, canvas.width, canvas.height);
        return await canvasToObjectUrl(canvas, "image/png");
    }).catch(() => null);
    colorPreviewCache.set(key, promise);
    return promise;
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
            .find((value) => value.includes("painted-masked") || value.includes("painted-output-") || value.includes("clipspace-mask-")) || "";
        const widgetValue = String(findImageWidget(node)?.value || renderedMaskedValue);
        const src = img.currentSrc || img.src || "";
        const maskedValue = widgetValue.includes("painted-masked") || widgetValue.includes("painted-output-") || widgetValue.includes("clipspace-mask-")
            ? widgetValue
            : (src.includes("painted-masked") || src.includes("painted-output-") || src.includes("clipspace-mask-") ? src : "");

        if (!maskedValue) {
            parent.querySelector(':scope > img[data-guhai-nodes2-original="true"]')?.remove();
            parent.querySelector(':scope > img[data-guhai-nodes2-green="true"]')?.remove();
            parent.querySelector(':scope > img[data-guhai-nodes2-masked="true"]')?.remove();
            parent.querySelector(':scope > img[data-guhai-nodes2-color="true"]')?.remove();
            img.style.removeProperty("z-index");
            img._guhaiNodes2MaskKey = null;
            continue;
        }

        let maskedUrl;
        let originalUrl;
        let sources = null;
        if (maskedValue === widgetValue) {
            sources = getEditorSources(maskedValue);
            maskedUrl = imageUrlFromParts(parseImageValue(maskedValue));
            originalUrl = sources.imageUrl;
        } else {
            maskedUrl = new URL(src, location.href).toString();
            const parsedUrl = new URL(maskedUrl, location.href);
            const maskedName = parsedUrl.searchParams.get("filename") || "";
            parsedUrl.searchParams.set("filename", maskedName
                .replace("painted-masked", "painted")
                .replace("painted-output-", "painted-")
                .replace("clipspace-mask-", "clipspace-painted-"));
            originalUrl = parsedUrl.toString();
        }

        const outputState = outputStateFromFilename(parseImageValue(widgetValue).filename)
            || node?.properties?.guhaiMaskOutputState
            || sources?.outputState;
        if (outputState?.mode === "color" && sources?.colorUrl) {
            const key = `color|${cacheKeyForUrl(sources.imageUrl)}|${cacheKeyForUrl(sources.colorUrl)}|${outputState.opacity}|${outputState.fill ? 1 : 0}|${outputState.inverted ? 1 : 0}`;
            if (img._guhaiNodes2MaskKey === key
                && parent.querySelector(':scope > img[data-guhai-nodes2-color="true"]')) continue;
            img._guhaiNodes2MaskKey = key;
            parent.querySelector(':scope > img[data-guhai-nodes2-original="true"]')?.remove();
            parent.querySelector(':scope > img[data-guhai-nodes2-green="true"]')?.remove();
            parent.querySelector(':scope > img[data-guhai-nodes2-masked="true"]')?.remove();
            let color = parent.querySelector(':scope > img[data-guhai-nodes2-color="true"]');
            if (!color) {
                color = document.createElement("img");
                color.dataset.guhaiNodes2Color = "true";
                color.alt = "遮罩颜色叠加预览";
                color.draggable = false;
                color.className = img.className;
                color.style.zIndex = "2";
                parent.insertBefore(color, img);
            }
            color.style.visibility = "hidden";
            colorOutputPreviewUrl(sources, outputState).then((url) => {
                if (!url || img._guhaiNodes2MaskKey !== key || !img.isConnected) return;
                color.src = url;
                return waitForPreviewImage(color).then(() => {
                    if (img._guhaiNodes2MaskKey !== key || !img.isConnected) return;
                    color.style.removeProperty("visibility");
                    img.style.zIndex = "-1";
                });
            }).catch(() => {
                if (img._guhaiNodes2MaskKey !== key) return;
                img._guhaiNodes2MaskKey = null;
                img.style.removeProperty("z-index");
            });
            continue;
        }
        parent.querySelector(':scope > img[data-guhai-nodes2-color="true"]')?.remove();

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
            refreshNodes2LoadImageToolbars();
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

function isTextEditingTarget(target) {
    if (!(target instanceof HTMLElement)) return false;
    return target.matches(
        "input, textarea, [contenteditable='true'], " +
        "[data-testid='node-title-input'], .node-title-input, .node-title-editor, " +
        ".group-title-editor input, .group-title-editor textarea"
    ) || Boolean(target.closest?.(
        "[contenteditable='true'], [data-testid='node-title-input'], " +
        ".node-title-editor, .group-title-editor"
    ));
}

function isTextEditingEvent(e) {
    // The hotkey listener runs in capture phase, so check both the original
    // event target and the focused editor before handling Z/X globally.
    return isTextEditingTarget(e?.target) || isTextEditingTarget(document.activeElement);
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
    const isPaintedOutput = parsed.filename.includes("painted-output-");
    const isOfficialClipMask = parsed.filename.startsWith("clipspace-mask-");
    if (!isPaintedMasked && !isPaintedOutput && !isOfficialClipMask) return null;
    const filename = isOfficialClipMask
        ? parsed.filename.replace("clipspace-mask-", "clipspace-painted-")
        : isPaintedOutput
            ? parsed.filename.split("__ghm-", 1)[0].replace("painted-output-", "painted-") + ".png"
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
            const code = String(e.code || "");
            const ctrl = e.ctrlKey || e.metaKey;
            const isUndo = ctrl && !e.shiftKey && (code === "KeyZ" || key === "z" || e.keyCode === 90);
            const isRedo = ctrl && e.shiftKey && (code === "KeyZ" || code === "KeyY" || key === "z" || key === "y" || e.keyCode === 90 || e.keyCode === 89);
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
        if ((isZ || isX) && isTextEditingEvent(e)) return;
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
    const parsedValue = parseImageValue(imageWidget.value);
    const savedOutputState = node.properties?.guhaiMaskOutputState || null;
    const nodeId = node.id;
    const currentNode = () => app.graph?.getNodeById?.(nodeId) || node;
    // Mark the node before constructing the editor. A workflow undo/configure
    // event must not restore the old painted-masked value while editing.
    node._guhaiMaskEditorActive = true;
    let editor;
        editor = new GoohaiMaskEditor({
            imageUrl: sources.imageUrl,
            maskUrl: sources.maskUrl,
            colorUrl: sources.colorUrl,
        maskMode: sources.maskMode,
        preserveRgbUnderMask: isOfficialLoadImageNode(node),
        outputState: sources.outputState || savedOutputState || null,
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
            const pending = Promise.resolve(saveTask).then(({ value, previewDataUrl, previewTask, outputState }) => {
                targetNode = currentNode();
                const targetWidget = findImageWidget(targetNode);
                if (!targetWidget) throw new Error("加载图像节点已不存在");
                targetNode.properties ||= {};
                if (outputState) targetNode.properties.guhaiMaskOutputState = outputState;
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
    if (!value || (!value.includes("painted-masked") && !value.includes("painted-output-") && !value.includes("clipspace-mask-"))) return;
    try {
        const sources = getEditorSources(imageWidget.value);
        const outputState = sources.outputState || node.properties?.guhaiMaskOutputState;
        if (outputState?.mode === "color") {
            const colorPreview = await colorOutputPreviewUrl(sources, outputState);
            if (colorPreview) setNodePreview(node, colorPreview);
            return;
        }
        const img = await loadImage(sources.imageUrl);
        const parsedValue = parseImageValue(imageWidget.value);
        const effectiveMaskUrl = parsedValue.filename.includes("painted-output-")
            ? imageUrlFromParts(parsedValue)
            : sources.maskUrl;
        const mask = await loadImage(effectiveMaskUrl);
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

