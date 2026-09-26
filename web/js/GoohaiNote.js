import { app } from "../../../scripts/app.js";

const _URL_CHARS = "a-zA-Z0-9._~:/?#\\[\\]@!$&'()*+,;=%\\-";

const LINK_REGEX = new RegExp(
    "(\\[\\[(.+?)\\]\\])" +
    "|(https?:\\/\\/[" + _URL_CHARS + "]+)" +
    "|(www\\.[" + _URL_CHARS + "]+)",
    "g"
);

const isChinese = (ch) => /[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff]/.test(ch);
const isBreakPoint = (ch) => /[\s\p{P}\p{S}]/u.test(ch);
const isPunct = (ch) => /\p{P}|\p{S}/.test(ch);

const CJK_PUNCT_SET = new Set(
    '，。、！？：；「」『』【】《》（）\u201C\u201D\u2018\u2019—…～．'.split('')
);
const isCJKPunct = (ch) => CJK_PUNCT_SET.has(ch);
const isCJKLike = (ch) => isChinese(ch) || isCJKPunct(ch);

const LINE_START_FORBIDDEN = new Set([
    ',', '，', '.', '。', ';', '；', '!', '！',
    '\u201D', '\u2019', '」', '』',
]);
const isLineStartForbidden = (ch) => LINE_START_FORBIDDEN.has(ch);

const _FIXED_FONT = 'Inter, Arial, sans-serif';

let _cachedComfyFont = null;
let _cachedFontTime = 0;
const FONT_CACHE_TTL = 3000;

function getComfyUIFont() {
    const now = Date.now();
    if (_cachedComfyFont && (now - _cachedFontTime) < FONT_CACHE_TTL) return _cachedComfyFont;
    _cachedComfyFont = _FIXED_FONT;
    _cachedFontTime = now;
    return _cachedComfyFont;
}

function parseSegments(text) {
    LINK_REGEX.lastIndex = 0;
    const segments = [];
    let match, last = 0;
    while ((match = LINK_REGEX.exec(text)) !== null) {
        if (match.index > last)
            segments.push({ type: 'text', content: text.substring(last, match.index), url: null });
        if (match[1] !== undefined) {
            segments.push({ type: 'link', content: match[2], url: match[2] });
        } else if (match[3] !== undefined) {
            segments.push({ type: 'link', content: match[3], url: match[3] });
        } else if (match[4] !== undefined) {
            segments.push({ type: 'link', content: match[4], url: match[4] });
        }
        last = match.index + match[0].length;
    }
    if (last < text.length)
        segments.push({ type: 'text', content: text.substring(last), url: null });
    return segments;
}

function buildCharList(segments) {
    const list = [];
    for (const seg of segments) {
        for (const ch of seg.content) {
            list.push({ ch, type: seg.type, url: seg.url });
        }
    }
    return list;
}

function wrapCharList(ctx, charList, maxWidth) {
    if (!charList || charList.length === 0) return [[]];

    const lines = [];
    let line = [];
    let lineStr = '';

    const rebuild = () => { lineStr = line.map(c => c.ch).join(''); };

    for (let i = 0; i < charList.length; i++) {
        const c = charList[i];

        if (c.ch === '\n') {
            lines.push(line);
            line = [];
            lineStr = '';
            continue;
        }

        const test = lineStr + c.ch;

        if (ctx.measureText(test).width > maxWidth && line.length > 0) {

            if (isCJKLike(c.ch)) {
                lines.push(line);
                line = [c];
                lineStr = c.ch;
            } else {
                let lastCJK = -1;
                for (let k = line.length - 1; k >= 0; k--) {
                    if (isCJKLike(line[k].ch)) { lastCJK = k; break; }
                }

                if (lastCJK >= 0) {
                    lines.push(line.slice(0, lastCJK + 1));
                    line = [...line.slice(lastCJK + 1), c];
                    rebuild();
                } else {
                    const limit = Math.min(20, line.length);
                    let bp = -1;
                    for (let j = line.length - 1; j >= line.length - limit; j--) {
                        if (isBreakPoint(line[j].ch)) { bp = j; break; }
                    }

                    if (bp >= 0) {
                        lines.push(line.slice(0, bp + 1));
                        line = [...line.slice(bp + 1), c];
                        rebuild();
                        if (line.length > 0 && isPunct(line[0].ch)) {
                            let pEnd = 0;
                            while (pEnd < line.length && isPunct(line[pEnd].ch)) pEnd++;
                            lines[lines.length - 1] = [...lines[lines.length - 1], ...line.slice(0, pEnd)];
                            line = line.slice(pEnd);
                            rebuild();
                        }
                    } else if (isPunct(c.ch)) {
                        lines.push([...line, c]);
                        line = [];
                        lineStr = '';
                    } else {
                        lines.push(line);
                        line = [c];
                        lineStr = c.ch;
                    }
                }
            }

            let fix = 0;
            while (fix++ < 20 && line.length > 0 && isLineStartForbidden(line[0].ch) && lines.length > 0) {
                const prev = lines[lines.length - 1];
                if (!prev || prev.length <= 1) break;
                const last = prev[prev.length - 1];
                if (isCJKLike(last.ch)) {
                    line = [last, ...line];
                    lines[lines.length - 1] = prev.slice(0, -1);
                } else if (!isBreakPoint(last.ch)) {
                    let ws = prev.length - 1;
                    while (ws > 0 && !isBreakPoint(prev[ws - 1].ch)) ws--;
                    if (ws === 0) {
                        line = [last, ...line];
                        lines[lines.length - 1] = prev.slice(0, -1);
                    } else {
                        line = [...prev.slice(ws), ...line];
                        lines[lines.length - 1] = prev.slice(0, ws);
                    }
                } else break;
                rebuild();
            }
        } else {
            line.push(c);
            lineStr = test;
        }
    }

    if (line.length > 0) lines.push(line);
    return lines.length > 0 ? lines : [[]];
}

class TextEditorBaseNode extends LGraphNode {
    constructor(title) {
        super(title);
        this.serialize_widgets = true;
        this.isVirtualNode = true;
        this.class_type = this.constructor.type;
        this.type = this.constructor.type;
        this.pos = [0, 0];
    }

    static setUp() {
        if (!this.registered) {
            LiteGraph.registerNodeType(this.type, this);
            this.registered = true;
        }
    }

    configure(info) {
        if (info.properties) Object.assign(this.properties, info.properties);
        if (info.pos) this.pos = info.pos;
        if (info.size) this.size = info.size;
        if (info.flags) this.flags = info.flags;
    }

    serialize() {
        const data = super.serialize();
        if (!data.id && this.id) data.id = this.id;
        if (!data.order && this.order !== undefined) data.order = this.order;
        if (!data.mode && this.mode !== undefined) data.mode = this.mode;
        data.properties = { ...this.properties };
        if (!data.pos && this.pos) data.pos = [...this.pos];
        if (!data.size && this.size) data.size = [...this.size];
        if (!data.flags && this.flags) data.flags = { ...this.flags };
        return data;
    }
}

class TextEditorNode extends TextEditorBaseNode {

    constructor(title) {
        super(title);
        this.flags = this.flags || {};
        this.flags.allow_interaction = !this.flags.pinned;
        this.properties = {
            text: "双击编辑文本，右键滑动调整大小...",
            fontSize: 24,
            fontColor: "#C8C8C8",
            backgroundColor: "#1B4669",
            backgroundAlpha: 0.25,
            borderRadius: 20,
            padding: 12,
            lineHeight: 1.4,
            textAlign: "center",
            stroke: true
        };
        this.resizable = true;
        this.size = [700, 80];
        this.color = "#fff0";
        this.bgcolor = "transparent";
        this.isEditing = false;
        this.editTextarea = null;
        this.linkAreas = [];
    }

    drawMultilineText(ctx, text, maxWidth, lineHeight) {
        this.linkAreas = [];

        const processed = text
            .replace(/\\n/g, "\n")
            .replace(/\r\n/g, "\n")
            .replace(/\r/g, "\n");

        const segments = parseSegments(processed);
        const chars = buildCharList(segments);
        const lines = wrapCharList(ctx, chars, maxWidth);

        if (lines.length === 0) return;

        const totalHeight = (lines.length - 1) * lineHeight + this.properties.fontSize;
        const startY = (this.size[1] - totalHeight) / 2 + this.properties.fontSize / 10;
        ctx.textBaseline = "top";

        for (let idx = 0; idx < lines.length; idx++) {
            const lineChars = lines[idx];
            if (lineChars.length === 0) continue;
            const y = startY + idx * lineHeight;

            const groups = [];
            let gi = 0;
            while (gi < lineChars.length) {
                const { type, url } = lineChars[gi];
                let gj = gi;
                while (gj < lineChars.length && lineChars[gj].type === type && lineChars[gj].url === url) gj++;
                groups.push({
                    type, url,
                    text: lineChars.slice(gi, gj).map(c => c.ch).join('')
                });
                gi = gj;
            }

            const totalW = groups.reduce((s, g) => s + ctx.measureText(g.text).width, 0);
            let startX;
            if (this.properties.textAlign === "left") {
                startX = this.properties.padding;
            } else if (this.properties.textAlign === "right") {
                startX = this.size[0] - this.properties.padding - totalW;
            } else {
                startX = (this.size[0] - totalW) / 2;
            }

            ctx.textAlign = "left";
            let dx = startX;

            for (const g of groups) {
                const w = ctx.measureText(g.text).width;
                if (g.type === 'link') {
                    this.linkAreas.push({ x: dx, y, width: w, height: lineHeight, url: g.url });
                    ctx.fillStyle = "#1976D2";
                    ctx.fillText(g.text, dx, y);
                    const uy = y + this.properties.fontSize;
                    ctx.beginPath();
                    ctx.moveTo(dx, uy + 1);
                    ctx.lineTo(dx + w, uy + 1);
                    ctx.strokeStyle = "#1976D2";
                    ctx.lineWidth = 1;
                    ctx.stroke();
                } else {
                    ctx.fillStyle = this.properties.fontColor;
                    ctx.fillText(g.text, dx, y);
                }
                dx += w;
            }
        }
    }

    createTextEditor() {
        if (this.editTextarea) this.removeTextEditor();

        _cachedFontTime = 0;

        const canvas = LGraphCanvas.active_canvas;
        const rect = canvas.canvas.getBoundingClientRect();
        const ox = (this.pos[0] + canvas.ds.offset[0]) * canvas.ds.scale;
        const oy = (this.pos[1] + canvas.ds.offset[1]) * canvas.ds.scale;

        const TOOLBAR_OFFSET = 210;

        this.editToolbar = document.createElement("div");
        this.editToolbar.className = "goohai-note-toolbar";
        Object.assign(this.editToolbar.style, {
            position: "absolute",
            left: rect.left + ox + "px",
            top: rect.top + oy - TOOLBAR_OFFSET + "px",
            width: "373px", display: "flex", flexDirection: "column",
            gap: "8px", zIndex: "999", fontSize: "12px", color: "#ffffff",
            backgroundColor: "rgba(24, 48, 55, 0.5)", border: "1px solid rgba(91, 190, 199, 0.48)",
            borderRadius: "10px", padding: "10px 12px", boxSizing: "border-box",
            boxShadow: "0 8px 24px rgba(0, 0, 0, 0.42)",
            backdropFilter: "blur(24px) saturate(150%)", WebkitBackdropFilter: "blur(24px) saturate(150%)",
            visibility: "hidden"
        });

        if (!document.getElementById("goohai-note-toolbar-style")) {
            const toolbarStyle = document.createElement("style");
            toolbarStyle.id = "goohai-note-toolbar-style";
            toolbarStyle.textContent = `
                .goohai-note-toolbar button {
                    border: 0 !important;
                    box-shadow: none !important;
                    outline: none !important;
                    background: rgba(255,255,255,.12) !important;
                    transition: background-color .12s ease, transform .12s ease;
                }
                .goohai-note-toolbar button:hover { background: rgba(91,190,199,.34) !important; }
                .goohai-note-toolbar button:active { transform: translateY(1px); }
                .goohai-note-toolbar button.is-active {
                    background: rgba(83,183,195,.34) !important;
                    color: #6ed2dc !important;
                    box-shadow: 0 0 0 1px rgba(137,225,232,.46) inset !important;
                }
                .goohai-note-toolbar button.is-active:hover {
                    background: rgba(83,183,195,.48) !important;
                }
                .goohai-note-toolbar input[type="color"] {
                    appearance: none;
                    -webkit-appearance: none;
                    width: 56px;
                    height: 24px;
                    padding: 0;
                    border: 0 !important;
                    border-radius: 4px;
                    background: transparent !important;
                    box-shadow: none !important;
                    overflow: hidden;
                    cursor: pointer;
                }
                .goohai-note-toolbar input[type="color"]::-webkit-color-swatch-wrapper {
                    padding: 0;
                }
                .goohai-note-toolbar input[type="color"]::-webkit-color-swatch {
                    border: 0;
                    border-radius: 4px;
                    box-shadow: inset 0 0 0 1px rgba(255,255,255,.24);
                }
                .goohai-note-toolbar input[type="color"]::-moz-color-swatch {
                    border: 0;
                    border-radius: 4px;
                    box-shadow: inset 0 0 0 1px rgba(255,255,255,.24);
                }
                .goohai-note-toolbar input[type="range"] {
                    appearance: none;
                    -webkit-appearance: none;
                    border: 0 !important;
                    outline: none !important;
                    box-shadow: none !important;
                    background: transparent !important;
                    height: 18px;
                }
                .goohai-note-toolbar input[type="range"]::-webkit-slider-runnable-track {
                    height: 4px;
                    border: 0;
                    border-radius: 999px;
                    background: rgba(214,236,239,.28);
                }
                .goohai-note-toolbar input[type="range"]::-webkit-slider-thumb {
                    appearance: none;
                    -webkit-appearance: none;
                    width: 15px;
                    height: 15px;
                    margin-top: -5.5px;
                    border: 0;
                    border-radius: 50%;
                    background: #53b7c3;
                    box-shadow: 0 1px 5px rgba(0,0,0,.28);
                }
                .goohai-note-toolbar input[type="range"]::-moz-range-track {
                    height: 4px;
                    border: 0;
                    border-radius: 999px;
                    background: rgba(214,236,239,.28);
                }
                .goohai-note-toolbar input[type="range"]::-moz-range-thumb {
                    width: 15px;
                    height: 15px;
                    border: 0;
                    border-radius: 50%;
                    background: #53b7c3;
                    box-shadow: 0 1px 5px rgba(0,0,0,.28);
                }
            `;
            document.head.appendChild(toolbarStyle);
        }

        const alignRow = document.createElement("div");
        Object.assign(alignRow.style, { display: "flex", alignItems: "center", gap: "8px" });
        const alignLabel = document.createElement("span");
        alignLabel.textContent = "对齐:";
        alignLabel.style.minWidth = "32px";
        alignLabel.style.fontSize = "13px";
        alignRow.appendChild(alignLabel);

        this.alignButtons = {};
        [
            { key: "left", symbol: "⬅" },
            { key: "center", symbol: "⬌" },
            { key: "right", symbol: "➡" }
        ].forEach((opt) => {
            const btn = document.createElement("button");
            btn.textContent = opt.symbol;
            Object.assign(btn.style, {
                width: "28px", height: "24px", border: "1px solid #666",
                borderRadius: "3px", cursor: "pointer", fontSize: "12px",
                backgroundColor: this.properties.textAlign === opt.key ? "#459BAC" : "#444",
                color: "#fff", display: "flex", alignItems: "center", justifyContent: "center"
            });
            btn.addEventListener("click", () => {
                this.properties.textAlign = opt.key;
                this.updateAlignButtons();
                app.graph.setDirtyCanvas(true);
            });
            this.alignButtons[opt.key] = btn;
            alignRow.appendChild(btn);
        });
        this.updateAlignButtons();

        const strokeCtrl = document.createElement("div");
        Object.assign(strokeCtrl.style, {
            display: "flex", alignItems: "center", gap: "4px",
            marginLeft: "auto",
            marginRight: "2px"
        });

        this.strokeCheckbox = document.createElement("input");
        this.strokeCheckbox.type = "checkbox";
        this.strokeCheckbox.checked = !!this.properties.stroke;
        Object.assign(this.strokeCheckbox.style, {
            width: "19.5px",
            height: "19.5px",
            cursor: "pointer",
            accentColor: "#459BAC"
        });
        this.strokeCheckbox.addEventListener("change", (e) => {
            this.properties.stroke = e.target.checked;
            app.graph.setDirtyCanvas(true);
        });
        strokeCtrl.appendChild(this.strokeCheckbox);

        const strokeLabel = document.createElement("span");
        strokeLabel.textContent = "：描边";
        Object.assign(strokeLabel.style, { fontSize: "13px", userSelect: "none", cursor: "pointer" });
        strokeLabel.addEventListener("click", () => {
            this.strokeCheckbox.checked = !this.strokeCheckbox.checked;
            this.properties.stroke = this.strokeCheckbox.checked;
            app.graph.setDirtyCanvas(true);
        });
        strokeCtrl.appendChild(strokeLabel);

        alignRow.appendChild(strokeCtrl);
        this.editToolbar.appendChild(alignRow);

        const textRow = document.createElement("div");
        Object.assign(textRow.style, { display: "flex", alignItems: "center", gap: "8px" });

        const txtLbl = document.createElement("span");
        txtLbl.textContent = "文本:";
        txtLbl.style.minWidth = "32px";
        txtLbl.style.fontSize = "13px";
        textRow.appendChild(txtLbl);

        this.textColorPicker = document.createElement("input");
        this.textColorPicker.type = "color";
        this.textColorPicker.value = this.properties.fontColor;
        Object.assign(this.textColorPicker.style, { width: "56px", height: "24px", border: "0", borderRadius: "4px", padding: "0", cursor: "pointer" });
        this.textColorPicker.addEventListener("input", (e) => {
            this.properties.fontColor = e.target.value;
            this.updateTextareaStyle();
            app.graph.setDirtyCanvas(true);
        });
        textRow.appendChild(this.textColorPicker);

        const textSpacer = document.createElement("div");
        Object.assign(textSpacer.style, { width: "28px", flexShrink: "0", flexGrow: "0" });
        textRow.appendChild(textSpacer);

        const sizeLbl = document.createElement("span");
        sizeLbl.textContent = "大小:";
        sizeLbl.style.fontSize = "13px";
        textRow.appendChild(sizeLbl);

        this.fontSizeSlider = document.createElement("input");
        this.fontSizeSlider.type = "range";
        this.fontSizeSlider.min = "8";
        this.fontSizeSlider.max = "200";
        this.fontSizeSlider.step = "1";
        this.fontSizeSlider.value = Math.round(this.properties.fontSize);
        Object.assign(this.fontSizeSlider.style, { flex: "1", height: "20px" });
        this.fontSizeSlider.addEventListener("input", (e) => {
            this.properties.fontSize = parseInt(e.target.value, 10);
            this.fontSizeValue.textContent = String(Math.round(this.properties.fontSize));
            this.ensureTextFitsBackground();
            this.updateTextareaStyle();
            this.updateEditorsPosition?.();
            app.graph.setDirtyCanvas(true);
        });
        textRow.appendChild(this.fontSizeSlider);

        this.fontSizeValue = document.createElement("span");
        this.fontSizeValue.textContent = String(Math.round(this.properties.fontSize));
        Object.assign(this.fontSizeValue.style, { fontSize: "12px", minWidth: "25px", textAlign: "right" });
        textRow.appendChild(this.fontSizeValue);
        this.editToolbar.appendChild(textRow);

        const bgRow = document.createElement("div");
        Object.assign(bgRow.style, { display: "flex", alignItems: "center", gap: "8px" });

        const bgLbl = document.createElement("span");
        bgLbl.textContent = "背景:";
        bgLbl.style.minWidth = "32px";
        bgLbl.style.fontSize = "13px";
        bgRow.appendChild(bgLbl);

        this.bgColorPicker = document.createElement("input");
        this.bgColorPicker.type = "color";
        this.bgColorPicker.value = this.properties.backgroundColor;
        Object.assign(this.bgColorPicker.style, { width: "56px", height: "24px", border: "0", borderRadius: "4px", padding: "0", cursor: "pointer" });
        this.bgColorPicker.addEventListener("input", (e) => {
            this.properties.backgroundColor = e.target.value;
            this.updateTextareaStyle();
            app.graph.setDirtyCanvas(true);
        });
        bgRow.appendChild(this.bgColorPicker);

        const bgSpacer = document.createElement("div");
        Object.assign(bgSpacer.style, { width: "28px", flexShrink: "0", flexGrow: "0" });
        bgRow.appendChild(bgSpacer);

        const alphaLbl = document.createElement("span");
        alphaLbl.textContent = "透明:";
        alphaLbl.style.fontSize = "13px";
        bgRow.appendChild(alphaLbl);

        this.alphaSlider = document.createElement("input");
        this.alphaSlider.type = "range";
        this.alphaSlider.min = "0";
        this.alphaSlider.max = "1";
        this.alphaSlider.step = "0.05";
        this.alphaSlider.value = this.properties.backgroundAlpha;
        Object.assign(this.alphaSlider.style, { flex: "1", height: "20px" });
        this.alphaSlider.addEventListener("input", (e) => {
            this.properties.backgroundAlpha = parseFloat(e.target.value);
            this.alphaValue.textContent = Math.round(100 * this.properties.backgroundAlpha) + "%";
            this.updateTextareaStyle();
            app.graph.setDirtyCanvas(true);
        });
        bgRow.appendChild(this.alphaSlider);

        this.alphaValue = document.createElement("span");
        this.alphaValue.textContent = Math.round(100 * this.properties.backgroundAlpha) + "%";
        Object.assign(this.alphaValue.style, { fontSize: "12px", minWidth: "25px", textAlign: "right" });
        bgRow.appendChild(this.alphaValue);
        this.editToolbar.appendChild(bgRow);

        const radiusRow = document.createElement("div");
        Object.assign(radiusRow.style, { display: "flex", alignItems: "center", gap: "8px" });
        const radiusLbl = document.createElement("span");
        radiusLbl.textContent = "圆角:";
        radiusLbl.style.minWidth = "32px";
        radiusLbl.style.fontSize = "13px";
        radiusRow.appendChild(radiusLbl);

        this.borderRadiusSlider = document.createElement("input");
        this.borderRadiusSlider.type = "range";
        this.borderRadiusSlider.min = "0";
        this.borderRadiusSlider.max = "300";
        this.borderRadiusSlider.value = this.properties.borderRadius;
        Object.assign(this.borderRadiusSlider.style, { flex: "1", height: "20px" });
        this.borderRadiusSlider.addEventListener("input", (e) => {
            this.properties.borderRadius = parseInt(e.target.value);
            this.borderRadiusValue.textContent = this.properties.borderRadius;
            app.graph.setDirtyCanvas(true);
        });
        radiusRow.appendChild(this.borderRadiusSlider);

        this.borderRadiusValue = document.createElement("span");
        this.borderRadiusValue.textContent = this.properties.borderRadius;
        Object.assign(this.borderRadiusValue.style, { fontSize: "12px", minWidth: "25px", textAlign: "right" });
        radiusRow.appendChild(this.borderRadiusValue);
        this.editToolbar.appendChild(radiusRow);

        const lhRow = document.createElement("div");
        Object.assign(lhRow.style, { display: "flex", alignItems: "center", gap: "8px" });
        const lhLbl = document.createElement("span");
        lhLbl.textContent = "行距:";
        lhLbl.style.minWidth = "32px";
        lhLbl.style.fontSize = "13px";
        lhRow.appendChild(lhLbl);

        this.lineHeightSlider = document.createElement("input");
        this.lineHeightSlider.type = "range";
        this.lineHeightSlider.min = "0.8";
        this.lineHeightSlider.max = "3.0";
        this.lineHeightSlider.step = "0.1";
        this.lineHeightSlider.value = this.properties.lineHeight;
        Object.assign(this.lineHeightSlider.style, { flex: "1", height: "20px" });
        this.lineHeightSlider.addEventListener("input", (e) => {
            this.properties.lineHeight = parseFloat(e.target.value);
            this.lineHeightValue.textContent = this.properties.lineHeight.toFixed(1);
            app.graph.setDirtyCanvas(true);
        });
        lhRow.appendChild(this.lineHeightSlider);

        this.lineHeightValue = document.createElement("span");
        this.lineHeightValue.textContent = this.properties.lineHeight.toFixed(1);
        Object.assign(this.lineHeightValue.style, { fontSize: "12px", minWidth: "25px", textAlign: "right" });
        lhRow.appendChild(this.lineHeightValue);
        this.editToolbar.appendChild(lhRow);

        document.body.appendChild(this.editToolbar);

        this.editTextarea = document.createElement("textarea");
        this.editTextarea.value = this.properties.text;
        Object.assign(this.editTextarea.style, {
            position: "absolute",
            left: rect.left + ox + this.properties.padding * canvas.ds.scale + "px",
            top: rect.top + oy + 10 * canvas.ds.scale + "px",
            width: (this.size[0] - 2 * this.properties.padding) * canvas.ds.scale + "px",
            height: (this.size[1] - 20) * canvas.ds.scale + "px",
            fontFamily: getComfyUIFont(),
            border: "none", borderRadius: "0px", outline: "none",
            background: "transparent", backgroundColor: "transparent",
            resize: "none", padding: "0px", boxSizing: "border-box",
            zIndex: "1000", textAlign: this.properties.textAlign,
            caretColor: this.properties.fontColor,
            appearance: "none", WebkitAppearance: "none"
        });
        this.updateTextareaStyle();
        this.editTextarea.style.setProperty("background", "transparent", "important");
        this.editTextarea.style.setProperty("background-color", "transparent", "important");
        this.editTextarea.style.setProperty("box-shadow", "none", "important");
        document.body.appendChild(this.editTextarea);
        this.editTextarea.focus();
        this.editTextarea.select();

        const positionEditToolbar = () => {
            if (!this.editToolbar) return;
            const toolbarWidth = this.editToolbar.offsetWidth || 373;
            const toolbarHeight = this.editToolbar.offsetHeight || 210;
            const gap = 8;
            const viewportWidth = window.innerWidth;
            const viewportHeight = window.innerHeight;
            const c = LGraphCanvas.active_canvas;
            const canvasRect = c.canvas.getBoundingClientRect();
            const scale = c.ds.scale;
            const nodeLeft = canvasRect.left + (this.pos[0] + c.ds.offset[0]) * scale;
            const nodeTop = canvasRect.top + (this.pos[1] + c.ds.offset[1]) * scale;
            const nodeRight = nodeLeft + this.size[0] * scale;
            const nodeBottom = nodeTop + this.size[1] * scale;

            const candidates = [
                [nodeLeft, nodeTop - toolbarHeight - gap],
                [nodeLeft, nodeBottom + gap],
                [nodeRight + gap, nodeTop],
                [nodeLeft - toolbarWidth - gap, nodeTop]
            ];
            let chosen = candidates.find(([left, top]) =>
                left >= 0 && top >= 0 &&
                left + toolbarWidth <= viewportWidth &&
                top + toolbarHeight <= viewportHeight &&
                !(left < nodeRight && left + toolbarWidth > nodeLeft &&
                    top < nodeBottom && top + toolbarHeight > nodeTop)
            );
            if (!chosen) chosen = candidates[1];
            const left = Math.max(4, Math.min(chosen[0], viewportWidth - toolbarWidth - 4));
            const top = Math.max(4, Math.min(chosen[1], viewportHeight - toolbarHeight - 4));
            Object.assign(this.editToolbar.style, {
                left: left + "px",
                top: top + "px",
                visibility: "visible"
            });
        };

        this.positionEditToolbar = positionEditToolbar;
        this.positionEditToolbar();

        const saveAndClose = () => {
            this.properties.text = this.editTextarea.value;
            this.removeTextEditor();
            this.setDirtyCanvas(true, true);
            app.graph.setDirtyCanvas(true);
        };

        this.updateEditorsPosition = () => {
            if (!this.editTextarea || !this.editToolbar) return;
            const c = LGraphCanvas.active_canvas;
            const r = c.canvas.getBoundingClientRect();
            const ox2 = (this.pos[0] + c.ds.offset[0]) * c.ds.scale;
            const oy2 = (this.pos[1] + c.ds.offset[1]) * c.ds.scale;
            Object.assign(this.editTextarea.style, {
                left: r.left + ox2 + this.properties.padding * c.ds.scale + "px",
                top: r.top + oy2 + 10 * c.ds.scale + "px",
                width: (this.size[0] - 2 * this.properties.padding) * c.ds.scale + "px",
                height: (this.size[1] - 20) * c.ds.scale + "px"
            });
            this.positionEditToolbar();
            this.updateTextareaStyle();
        };

        const origOCC = canvas.onCanvasChanged;
        canvas.onCanvasChanged = (evt) => {
            origOCC && origOCC.call(canvas, evt);
            this.updateEditorsPosition();
        };
        this.canvasUpdateInterval = setInterval(() => this.updateEditorsPosition(), 16);

        this.editTextarea.addEventListener("keydown", (e) => {
            if ("Escape" === e.key) {
                this.removeTextEditor();
            } else if ("Enter" === e.key && (e.ctrlKey || e.metaKey)) {
                saveAndClose();
            }
            e.stopPropagation();
        });

        this.clickCount = 0;
        this.documentClickHandler = (e) => {
            this.clickCount++;
            setTimeout(() => {
                this.clickCount--;
                if (this.clickCount === 0 && this.editTextarea && this.editToolbar &&
                    !this.editTextarea.contains(e.target) &&
                    !this.editToolbar.contains(e.target) && this.isEditing) {
                    saveAndClose();
                }
            }, 300);
        };
        setTimeout(() => {
            if (this.isEditing) document.addEventListener("click", this.documentClickHandler, true);
        }, 200);

        this.editTextarea.addEventListener("blur", () => {
            setTimeout(() => {
                if (this.editToolbar && this.editTextarea &&
                    !this.editToolbar.contains(document.activeElement) &&
                    document.activeElement !== this.editTextarea) {
                    saveAndClose();
                }
            }, 100);
        });

        this.editTextarea.addEventListener("input", () => {
            this.ensureTextFitsBackground();
            this.updateEditorsPosition();
            app.graph.setDirtyCanvas(true);
        });

        this.isEditing = true;
    }

    updateTextareaStyle() {
        if (!this.editTextarea) return;
        const s = LGraphCanvas.active_canvas.ds.scale;
        Object.assign(this.editTextarea.style, {
            fontSize: this.properties.fontSize * s + "px",
            fontFamily: getComfyUIFont(),
            color: this.properties.fontColor,
            background: "transparent",
            backgroundColor: "transparent",
            caretColor: this.properties.fontColor,
            textAlign: this.properties.textAlign,
            lineHeight: this.properties.lineHeight,
            paddingTop: "2px", paddingLeft: "0px", paddingRight: "0px", paddingBottom: "0px",
            boxSizing: "border-box"
        });
    }

    ensureTextFitsBackground() {
        if (!this.editTextarea) return;
        const canvas = LGraphCanvas.active_canvas;
        const ctx = canvas?.canvas?.getContext?.("2d");
        if (!ctx) return;
        ctx.font = this.properties.fontSize + "px " + getComfyUIFont();
        const processed = this.editTextarea.value
            .replace(/\\n/g, "\n")
            .replace(/\r\n/g, "\n")
            .replace(/\r/g, "\n");
        const lines = wrapCharList(ctx, buildCharList(parseSegments(processed)),
            Math.max(1, this.size[0] - 2 * this.properties.padding));
        const lineHeight = this.properties.fontSize * this.properties.lineHeight;
        const requiredHeight = Math.ceil((Math.max(1, lines.length) - 1) * lineHeight + this.properties.fontSize + 20);
        if (requiredHeight > this.size[1]) {
            this.size[1] = requiredHeight;
        }
    }

    updateAlignButtons() {
        Object.keys(this.alignButtons).forEach((k) => {
            const active = this.properties.textAlign === k;
            this.alignButtons[k].classList.toggle("is-active", active);
            this.alignButtons[k].setAttribute("aria-pressed", active ? "true" : "false");
        });
    }

    removeTextEditor() {
        if (this.editTextarea) { document.body.removeChild(this.editTextarea); this.editTextarea = null; }
        if (this.editToolbar) { document.body.removeChild(this.editToolbar); this.editToolbar = null; }
        if (this.canvasUpdateInterval) { clearInterval(this.canvasUpdateInterval); this.canvasUpdateInterval = null; }
        if (this.documentClickHandler) { document.removeEventListener("click", this.documentClickHandler, true); this.documentClickHandler = null; }
        this.positionEditToolbar = null;
        this.isEditing = false;
    }

    onDrawBackground(ctx) {
        ctx.save();
        ctx.imageSmoothingEnabled = true;

        const r = this.properties.borderRadius;

        ctx.beginPath();
        ctx.roundRect(0, 0, this.size[0], this.size[1], r);
        ctx.fillStyle = this.hexToRGBA(this.properties.backgroundColor, this.properties.backgroundAlpha);
        ctx.fill();

        const isSelected = !!this.selected;
        const showStrongBorder = isSelected || this.isEditing;
        if (this.properties.stroke || showStrongBorder) {
            const bgHex = this.properties.backgroundColor;
            const sr = Math.min(parseInt(bgHex.slice(1, 3), 16) + 80, 255);
            const sg = Math.min(parseInt(bgHex.slice(3, 5), 16) + 80, 255);
            const sb = Math.min(parseInt(bgHex.slice(5, 7), 16) + 80, 255);

            ctx.beginPath();
            ctx.roundRect(0.5, 0.5, this.size[0] - 1, this.size[1] - 1, Math.max(r - 0.5, 0));
            ctx.strokeStyle = "rgba(" + sr + "," + sg + "," + sb + "," + (showStrongBorder ? 1 : this.properties.backgroundAlpha) + ")";
            ctx.lineWidth = 1;
            ctx.stroke();
        }

        if (!this.isEditing) {
            ctx.fillStyle = this.properties.fontColor;
            ctx.font = this.properties.fontSize + "px " + getComfyUIFont();
            const lh = this.properties.fontSize * this.properties.lineHeight;
            const mw = this.size[0] - 2 * this.properties.padding;
            this.drawMultilineText(ctx, this.properties.text, mw, lh);
        }

        ctx.restore();
    }

    hexToRGBA(hex, alpha) {
        return "rgba(" +
            parseInt(hex.slice(1, 3), 16) + ", " +
            parseInt(hex.slice(3, 5), 16) + ", " +
            parseInt(hex.slice(5, 7), 16) + ", " +
            alpha + ")";
    }

    draw(ctx) {
        this.flags = this.flags || {};
        this.flags.allow_interaction = !this.flags.pinned;
        this.onDrawBackground(ctx);
    }

    onPropertyChanged(name, value) {
        if (this.isEditing) {
            if ("fontSize" === name && this.fontSizeSlider) {
                this.fontSizeSlider.value = Math.round(value);
                this.fontSizeValue.textContent = String(Math.round(value));
                this.ensureTextFitsBackground();
            } else if ("fontColor" === name && this.textColorPicker) {
                this.textColorPicker.value = value;
            } else if ("backgroundColor" === name && this.bgColorPicker) {
                this.bgColorPicker.value = value;
            } else if ("backgroundAlpha" === name && this.alphaSlider) {
                this.alphaSlider.value = value;
                this.alphaValue.textContent = Math.round(100 * value) + "%";
            } else if ("lineHeight" === name && this.lineHeightSlider) {
                this.lineHeightSlider.value = value;
                this.lineHeightValue.textContent = value.toFixed(1);
            } else if ("textAlign" === name && this.alignButtons) {
                this.updateAlignButtons();
            } else if ("borderRadius" === name && this.borderRadiusSlider) {
                this.borderRadiusSlider.value = value;
                this.borderRadiusValue.textContent = value;
            } else if ("stroke" === name && this.strokeCheckbox) {
                this.strokeCheckbox.checked = !!value;
            }
            this.updateTextareaStyle();
        }
        this.setDirtyCanvas(true, true);
        app.graph.setDirtyCanvas(true);
    }

    onMouseDown(evt, pos) {
        if (!this.isEditing && evt?.button === 2) {
            beginFontResize(this, evt, pos);
        }
        if (!this.isEditing && this.linkAreas && this.linkAreas.length > 0) {
            const lp = [pos[0] - this.pos[0], pos[1] - this.pos[1]];
            for (const a of this.linkAreas) {
                if (lp[0] >= a.x && lp[0] <= a.x + a.width && lp[1] >= a.y && lp[1] <= a.y + a.height) {
                    this.openLink(a.url);
                    return true;
                }
            }
        }
        return false;
    }

    openLink(url) {
        try {
            if (!url.match(/^https?:\/\//) && !url.match(/^www\./)) {
                url = "https://" + url;
            }
            window.open(url, "_blank");
        } catch (err) {
            console.error("打开链接失败:", err);
        }
    }

    onDblClick() {
        if (!this.isEditing) this.createTextEditor();
    }

    onResize(size) {
        if (size && Array.isArray(size) && size.length >= 2) {
            this.size[0] = Math.max(size[0], 5);
            this.size[1] = Math.max(size[1], 5);
            app.graph.setDirtyCanvas(true);
        }
    }

    getExtraMenuOptions(node, options) {
        options.unshift({
            content: "编辑文本",
            callback: () => this.createTextEditor()
        });
        options.push({
            content: "固定节点",
            callback: () => {
                this.flags.pinned = !this.flags.pinned;
                this.flags.allow_interaction = !this.flags.pinned;
            }
        });
    }

    onShowCustomPanelInfo(panel) {
        panel.querySelector('div.property[data-property="Mode"]')?.remove();
        panel.querySelector('div.property[data-property="Color"]')?.remove();
    }

    onRemoved() {
        this.removeTextEditor();
    }
}

TextEditorNode.type = "孤海注释";
TextEditorNode.title = "孤海注释";
TextEditorNode.title_mode = LiteGraph.NO_TITLE;
TextEditorNode.collapsable = false;

TextEditorNode["@text"] = { type: "string", title: "文本内容", default: "双击编辑文本，右键滑动调整大小...", multiline: true };
TextEditorNode["@fontSize"] = { type: "number", title: "字体大小", default: 24, min: 8, max: 200, step: 1, round: 1 };
TextEditorNode["@fontColor"] = { type: "color", title: "字体颜色", default: "#C8C8C8" };
TextEditorNode["@backgroundColor"] = { type: "color", title: "背景颜色", default: "#1B4669" };
TextEditorNode["@backgroundAlpha"] = { type: "number", title: "背景透明度", default: 0.25, min: 0, max: 1, step: 0.05 };
TextEditorNode["@borderRadius"] = { type: "number", title: "圆角", default: 20, min: 0, max: 300, step: 1 };
TextEditorNode["@padding"] = { type: "number", title: "内边距", default: 12, min: 0, max: 50, step: 1 };
TextEditorNode["@lineHeight"] = { type: "number", title: "行距", default: 1.4, min: 0.8, max: 3, step: 0.1 };
TextEditorNode["@textAlign"] = { type: "combo", title: "对齐方式", values: ["left", "center", "right"], default: "center" };
TextEditorNode["@stroke"] = { type: "boolean", title: "描边", default: true };

const _origDrawNode = LGraphCanvas.prototype.drawNode;
LGraphCanvas.prototype.drawNode = function (node, ctx) {
    if (node.constructor === TextEditorNode) {
        node.bgcolor = "transparent";
        node.color = "#fff0";
        const wasSelected = !!node.selected;
        // LiteGraph's default selection outline is drawn outside the node.
        // Hide it temporarily; the node draws its own selected border instead.
        if (wasSelected) node.selected = false;
        const result = _origDrawNode.apply(this, arguments);
        if (wasSelected) node.selected = true;
        node.onDrawBackground(ctx);
        return result;
    }
    return _origDrawNode.apply(this, arguments);
};

const _origPMDown = LGraphCanvas.prototype.processMouseDown;
LGraphCanvas.prototype.processMouseDown = function (e) {
    if (!this.graph) return;
    const canvasPos = this.convertEventToCanvasOffset(e);
    const node = this.graph.getNodeOnPos(canvasPos[0], canvasPos[1], this.visible_nodes);
    if (node && node.constructor === TextEditorNode && !node.isEditing) {
        const lp = [canvasPos[0] - node.pos[0], canvasPos[1] - node.pos[1]];
        if (e.button === 2 && beginFontResize(node, e, canvasPos)) {
            // Keep LiteGraph's normal right-click menu for a click; the move
            // handler below takes over only after the pointer actually moves.
            this._goohaiFontResizeStarted = true;
        }
        if (node.linkAreas && node.linkAreas.length > 0) {
            for (const a of node.linkAreas) {
                if (lp[0] >= a.x && lp[0] <= a.x + a.width &&
                    lp[1] >= a.y && lp[1] <= a.y + a.height) {
                    node.openLink(a.url);
                    e.preventDefault();
                    e.stopPropagation();
                    return false;
                }
            }
        }
    }
    return _origPMDown.call(this, e);
};

const mouseState = { processingMouseDown: false, lastMouseEvent: null };

const _origGNOP = LGraph.prototype.getNodeOnPos;
LGraph.prototype.getNodeOnPos = function (x, y, nodes, margin) {
    if (nodes) {
        const recent = LiteGraph.getTime() -
            (LGraphCanvas.active_canvas && LGraphCanvas.active_canvas.last_mouseclick
                ? LGraphCanvas.active_canvas.last_mouseclick : 0) < 300;
        if (mouseState.processingMouseDown && mouseState.lastMouseEvent &&
            mouseState.lastMouseEvent.type.includes("down") &&
            mouseState.lastMouseEvent.which === 1 && !recent) {
            nodes = [...nodes].filter(n => !(n instanceof TextEditorNode && n.flags.pinned));
        }
    }
    return _origGNOP.apply(this, [x, y, nodes, margin]);
};

document.addEventListener("mousedown", function (e) {
    mouseState.processingMouseDown = true;
    mouseState.lastMouseEvent = e;
}, true);

document.addEventListener("mouseup", function () {
    mouseState.processingMouseDown = false;
}, true);

// 非编辑状态下，按住右键左右滑动可快速等比缩放文字与背景框。
// 右下角仍交给 LiteGraph 原生 resize 逻辑，只调整背景框尺寸。
let fontResizeState = null;
let suppressNoteContextMenuUntil = 0;

function getTextNodeAtMouseEvent(e) {
    const canvas = LGraphCanvas.active_canvas;
    if (!canvas || !canvas.graph || !canvas.canvas) return null;
    const rect = canvas.canvas.getBoundingClientRect();
    const scale = canvas.ds?.scale || 1;
    const offset = canvas.ds?.offset || [0, 0];
    const canvasPos = [
        (e.clientX - rect.left) / scale - offset[0],
        (e.clientY - rect.top) / scale - offset[1]
    ];
    const nodes = canvas.visible_nodes || canvas.graph._nodes || [];
    let node = canvas.graph.getNodeOnPos(canvasPos[0], canvasPos[1], nodes);
    if (!node && Array.isArray(nodes)) {
        for (let i = nodes.length - 1; i >= 0; i--) {
            const candidate = nodes[i];
            if (candidate?.constructor === TextEditorNode &&
                canvasPos[0] >= candidate.pos[0] && canvasPos[0] <= candidate.pos[0] + candidate.size[0] &&
                canvasPos[1] >= candidate.pos[1] && canvasPos[1] <= candidate.pos[1] + candidate.size[1]) {
                node = candidate;
                break;
            }
        }
    }
    if (!node || node.constructor !== TextEditorNode || node.isEditing) return null;
    return { canvas, node, localX: canvasPos[0] - node.pos[0], localY: canvasPos[1] - node.pos[1] };
}

function beginFontResize(node, e, pos) {
    if (!node || node.isEditing || e?.button !== 2) return false;
    const localX = Array.isArray(pos) ? pos[0] - node.pos[0] : 0;
    const localY = Array.isArray(pos) ? pos[1] - node.pos[1] : 0;
    const resizeHandle = 22;
    if (localX >= node.size[0] - resizeHandle && localY >= node.size[1] - resizeHandle) return false;
    fontResizeState = {
        node,
        startX: e.clientX,
        startFontSize: node.properties.fontSize,
        startSize: [node.size[0], node.size[1]],
        moved: false
    };
    return true;
}

document.addEventListener("mousedown", function (e) {
    if (e.button !== 2) return;
    const hit = getTextNodeAtMouseEvent(e);
    if (!hit) return;

    // Preserve the existing lower-right corner resize behavior.
    if (!beginFontResize(hit.node, e, [hit.node.pos[0] + hit.localX, hit.node.pos[1] + hit.localY])) return;
    if (LGraphCanvas.active_canvas?.canvas?.setPointerCapture && e.pointerId !== undefined) {
        try { LGraphCanvas.active_canvas.canvas.setPointerCapture(e.pointerId); } catch (_) { }
    }
}, true);

document.addEventListener("pointerdown", function (e) {
    if (e.button !== 2 || fontResizeState) return;
    const hit = getTextNodeAtMouseEvent(e);
    if (!hit || !beginFontResize(hit.node, e, [hit.node.pos[0] + hit.localX, hit.node.pos[1] + hit.localY])) return;
    if (LGraphCanvas.active_canvas?.canvas?.setPointerCapture && e.pointerId !== undefined) {
        try { LGraphCanvas.active_canvas.canvas.setPointerCapture(e.pointerId); } catch (_) { }
    }
}, true);

document.addEventListener("mousemove", function (e) {
    updateFontResize(e);
}, true);

document.addEventListener("pointermove", function (e) {
    if (fontResizeState && (e.buttons & 2)) updateFontResize(e);
}, true);

function updateFontResize(e) {
    if (!fontResizeState) return false;
    const state = fontResizeState;
    const node = state.node;
    if (!node || node.isEditing) {
        fontResizeState = null;
        return false;
    }

    const delta = e.clientX - state.startX;
    if (Math.abs(delta) < 1) return false;
    state.moved = true;

    const nextFontSize = Math.max(8, Math.min(200, state.startFontSize + delta / 4));
    const scale = nextFontSize / state.startFontSize;
    node.properties.fontSize = nextFontSize;
    node.size[0] = Math.max(5, state.startSize[0] * scale);
    node.size[1] = Math.max(5, state.startSize[1] * scale);
    node.setDirtyCanvas(true, true);
    app.graph.setDirtyCanvas(true);
    e.preventDefault();
    e.stopPropagation();
    return true;
}

const _origPMMove = LGraphCanvas.prototype.processMouseMove;
if (typeof _origPMMove === "function") {
    LGraphCanvas.prototype.processMouseMove = function (e) {
        if (fontResizeState && updateFontResize(e)) return false;
        return _origPMMove.apply(this, arguments);
    };
}

const _origPMUp = LGraphCanvas.prototype.processMouseUp;
if (typeof _origPMUp === "function") {
    LGraphCanvas.prototype.processMouseUp = function (e) {
        if (fontResizeState) {
            if (fontResizeState.moved) suppressNoteContextMenuUntil = Date.now() + 300;
            fontResizeState = null;
            return false;
        }
        return _origPMUp.apply(this, arguments);
    };
}

document.addEventListener("mouseup", function (e) {
    if (fontResizeState?.moved) suppressNoteContextMenuUntil = Date.now() + 300;
    if (fontResizeState && LGraphCanvas.active_canvas?.canvas?.releasePointerCapture) {
        try { LGraphCanvas.active_canvas.canvas.releasePointerCapture(e.pointerId); } catch (_) { }
    }
    fontResizeState = null;
}, true);

document.addEventListener("pointerup", function () {
    if (fontResizeState?.moved) suppressNoteContextMenuUntil = Date.now() + 300;
    fontResizeState = null;
}, true);

document.addEventListener("contextmenu", function (e) {
    if (Date.now() < suppressNoteContextMenuUntil || fontResizeState?.moved) {
        e.preventDefault();
        e.stopPropagation();
    }
    suppressNoteContextMenuUntil = 0;
    fontResizeState = null;
}, true);

// Nodes 2.0 HTML VUE覆盖层双击穿透
document.addEventListener("dblclick", function (e) {
    const nodeBody = e.target.closest('[data-testid^="node-body-"]');
    if (!nodeBody) return;

    if (e.target.closest(
        "input, textarea, select, [contenteditable], button, a, " +
        "[role='button'], [role='slider'], [role='combobox'], " +
        ".comfy-multiline-input, .comfy-input"
    )) {
        return;
    }


    const testId = nodeBody.getAttribute("data-testid");
    const match = testId.match(/node-body-(\d+)/);
    if (!match) return;

    const nodeId = parseInt(match[1]);
    const node = app.graph?.getNodeById(nodeId);
    if (!node) return;


    if (typeof node.onDblClick === "function") {
        node.onDblClick(e);
    }
}, true);


const _dblclickFixStyle = document.createElement("style");
_dblclickFixStyle.id = "goohaitools-fix-dblclick-style";
_dblclickFixStyle.textContent = `
    [data-testid^="node-body-"] { cursor: default !important; }
    [data-testid^="node-header-"] { cursor: grab !important; }
`;
document.head.appendChild(_dblclickFixStyle);

// ============================================

app.registerExtension({
    name: "孤海注释",
    registerCustomNodes() {
        TextEditorNode.setUp();
    }
});
