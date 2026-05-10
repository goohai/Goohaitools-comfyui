/**
 * 孤海注释 - ComfyUI 自定义文本编辑器节点
 *
 * 功能：
 * - 双击编辑文本，支持自动换行
 * - 支持自动检测网址链接
 * - 字体大小、颜色、背景色、透明度、行高、对齐方式、圆角可调
 * - 固定（pinned）模式：节点不可交互，点击穿透
 * - 文本垂直居中显示，允许溢出背景框
 */

import { app } from "../../../scripts/app.js";

// ==================== 国际化辅助 ====================
const getText = function (key) {
    return window.CyberpunkI18n && window.CyberpunkI18n.getText
        ? window.CyberpunkI18n.getText(key)
        : window.getText && typeof window.getText === "function"
            ? window.getText(key)
            : key;
};

// ==================== 模块级工具常量与函数 ====================
const LINK_REGEX = /#([^#]+)#|(https?:\/\/\S+)|(www\.\S+)/g;
const isChinese = (ch) => /[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff]/.test(ch);
const isBreakPoint = (ch) => /[\s\p{P}\p{S}]/u.test(ch);
const isPunct = (ch) => /\p{P}|\p{S}/.test(ch);

// CJK/全角标点集合（用于换行决策，将全角标点视为中文语境字符）
const CJK_PUNCT = new Set(
    '，。、！？：；「」『』【】《》（）\u201C\u201D\u2018\u2019—…～．'.split('')
);
const isCJKPunct = (ch) => CJK_PUNCT.has(ch);
const isCJKLike = (ch) => isChinese(ch) || isCJKPunct(ch);

// 行首禁则字符集合（逗号、句号、分号、感叹号、右引号）
const LINE_START_FORBIDDEN = new Set([
    ',', '，',           // 逗号
    '.', '。',           // 句号
    ';', '；',           // 分号
    '!', '！',           // 感叹号
    '\u201D', '\u2019',  // " ' 右双/单引号
    '」', '』',          // 右角引号
]);
const isLineStartForbidden = (ch) => LINE_START_FORBIDDEN.has(ch);

// ==================== ComfyUI 字体获取工具 ====================
let _cachedComfyFont = null;
function getComfyUIFont() {
    if (_cachedComfyFont) return _cachedComfyFont;

    // ---- 策略1：从 CSS 自定义变量中读取 ----
    const rootStyle = getComputedStyle(document.documentElement);
    const cssVarNames = [
        '--font-family', '--fontFamily', '--p-font-family',
        '--ui-font-family', '--body-font-family'
    ];
    for (const varName of cssVarNames) {
        const val = rootStyle.getPropertyValue(varName).trim();
        if (val && val !== '' && val !== 'inherit' && val !== 'initial') {
            _cachedComfyFont = val;
            return _cachedComfyFont;
        }
    }

    // ---- 策略2：从 ComfyUI 关键 DOM 节点读取计算后的 font-family ----
    const selectors = [
        '.p-panelmenu .p-panelmenu-item-content',
        '.p-panelmenu',
        '.comfy-multiline-input',
        '.litegraph .dialog',
        '.p-button',
        '.p-menubar',
        '.p-sidebar',
        '#vue-app',
        '#app',
        '.graph-canvas-container',
    ];

    for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (el) {
            const ff = getComputedStyle(el).fontFamily;
            if (ff && ff.trim() !== '' && !ff.includes('serif')) {
                if (!/^["']?serif/i.test(ff.trim()) && ff.trim().toLowerCase() !== 'serif') {
                    _cachedComfyFont = ff;
                    return _cachedComfyFont;
                }
            }
        }
    }

    // ---- 策略3：遍历页面上可见的文本元素，取第一个非 serif 字体 ----
    const walkTargets = document.querySelectorAll(
        'button, label, span, p, h1, h2, h3, h4, a, li, .p-component'
    );
    for (const el of walkTargets) {
        const ff = getComputedStyle(el).fontFamily;
        if (ff && ff.trim() !== '') {
            const lower = ff.trim().toLowerCase();
            if (lower !== 'serif' && !lower.startsWith('serif,')) {
                _cachedComfyFont = ff;
                return _cachedComfyFont;
            }
        }
    }

    // ---- 策略4：硬编码 ComfyUI 前端默认字体栈（最终兜底） ----
    _cachedComfyFont = [
        '-apple-system',
        'BlinkMacSystemFont',
        '"Segoe UI"',
        'Roboto',
        '"Helvetica Neue"',
        '"Noto Sans"',
        '"Microsoft YaHei"',
        '"PingFang SC"',
        'sans-serif'
    ].join(', ');

    return _cachedComfyFont;
}

// ==================== 基础节点类 ====================
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

// ==================== 文本编辑器节点 ====================
class TextEditorNode extends TextEditorBaseNode {

    constructor(title) {
        super(title);
        this.flags = this.flags || {};
        this.flags.allow_interaction = !this.flags.pinned;
        this.properties = {
            text: "双击编辑文本内容...",
            fontSize: 24,
            fontColor: "#E3E3E3",
            backgroundColor: "#1B4669",
            backgroundAlpha: 0.8,
            borderRadius: 30,
            padding: 12,
            lineHeight: 1.4,
            textAlign: "center"
        };
        this.resizable = true;
        this.size = [360, 100];
        this.color = "#fff0";
        this.bgcolor = "transparent";
        this.isEditing = false;
        this.editTextarea = null;
        this.linkAreas = [];
    }

    /* ---------- 文本处理 ---------- */

    wrapText(ctx, text, maxWidth) {
        if (!text || text.trim() === "") return [""];

        const lines = [];
        let currentLine = "";

        for (let i = 0; i < text.length; i++) {
            const ch = text[i];
            const testLine = currentLine + ch;

            if (ctx.measureText(testLine).width > maxWidth && currentLine.length > 0) {

                if (isCJKLike(ch)) {
                    lines.push(currentLine);
                    currentLine = ch;
                } else {
                    let lastCJKIdx = -1;
                    for (let k = currentLine.length - 1; k >= 0; k--) {
                        if (isCJKLike(currentLine[k])) {
                            lastCJKIdx = k;
                            break;
                        }
                    }

                    if (lastCJKIdx >= 0) {
                        lines.push(currentLine.substring(0, lastCJKIdx + 1));
                        currentLine = currentLine.substring(lastCJKIdx + 1) + ch;
                    } else {
                        const searchLimit = Math.min(20, currentLine.length);
                        let breakIndex = -1;
                        for (let j = currentLine.length - 1; j >= currentLine.length - searchLimit; j--) {
                            if (isBreakPoint(currentLine[j])) {
                                breakIndex = j;
                                break;
                            }
                        }

                        if (breakIndex >= 0) {
                            lines.push(currentLine.substring(0, breakIndex + 1));
                            currentLine = currentLine.substring(breakIndex + 1) + ch;
                            if (currentLine.length > 0 && isPunct(currentLine[0])) {
                                let pEnd = 0;
                                while (pEnd < currentLine.length && isPunct(currentLine[pEnd])) pEnd++;
                                lines[lines.length - 1] += currentLine.substring(0, pEnd);
                                currentLine = currentLine.substring(pEnd);
                            }
                        } else {
                            if (isPunct(ch)) {
                                lines.push(currentLine + ch);
                                currentLine = "";
                            } else {
                                lines.push(currentLine);
                                currentLine = ch;
                            }
                        }
                    }
                }

                // ====== 行首禁则处理 ======
                let fixCount = 0;
                while (fixCount < 20 && currentLine.length > 0 &&
                       isLineStartForbidden(currentLine[0]) && lines.length > 0) {
                    fixCount++;
                    const lastLine = lines[lines.length - 1];
                    if (!lastLine || lastLine.length <= 1) break;

                    const lastChar = lastLine[lastLine.length - 1];
                    if (isCJKLike(lastChar)) {
                        currentLine = lastChar + currentLine;
                        lines[lines.length - 1] = lastLine.substring(0, lastLine.length - 1);
                    } else if (!isBreakPoint(lastChar)) {
                        let wordStart = lastLine.length - 1;
                        while (wordStart > 0 && !isBreakPoint(lastLine[wordStart - 1])) {
                            wordStart--;
                        }
                        if (wordStart === 0) {
                            currentLine = lastChar + currentLine;
                            lines[lines.length - 1] = lastLine.substring(0, lastLine.length - 1);
                        } else {
                            const pulled = lastLine.substring(wordStart);
                            currentLine = pulled + currentLine;
                            lines[lines.length - 1] = lastLine.substring(0, wordStart);
                        }
                    } else {
                        break;
                    }
                }
            } else {
                currentLine = testLine;
            }
        }

        if (currentLine) lines.push(currentLine);
        return lines.length > 0 ? lines : [""];
    }

    parseTextWithLinks(text) {
        LINK_REGEX.lastIndex = 0;
        const segments = [];
        let match, last = 0;
        while ((match = LINK_REGEX.exec(text)) !== null) {
            if (match.index > last)
                segments.push({ type: "text", content: text.substring(last, match.index) });
            if (match[1] !== undefined) {
                segments.push({ type: "link", content: match[1], fullMatch: match[0] });
            } else {
                segments.push({ type: "link", content: match[0], fullMatch: match[0] });
            }
            last = match.index + match[0].length;
        }
        if (last < text.length)
            segments.push({ type: "text", content: text.substring(last) });
        return segments;
    }

    processTextLines(ctx, text, maxWidth) {
        const raw = text.replace(/\\n/g, "\n").replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
        let result = [];
        for (const line of raw) {
            if (line.trim() === "") {
                result.push("");
            } else {
                result = result.concat(this.wrapText(ctx, line, maxWidth));
            }
        }
        return result;
    }

    drawMultilineText(ctx, text, maxWidth, lineHeight) {
        this.linkAreas = [];
        const lines = this.processTextLines(ctx, text, maxWidth);
        const totalTextHeight = (lines.length - 1) * lineHeight + this.properties.fontSize;
        const startY = (this.size[1] - totalTextHeight) / 2 + this.properties.fontSize / 10;
        ctx.textBaseline = "top";

        lines.forEach((line, idx) => {
            const y = startY + idx * lineHeight;
            let x;
            if ("left" === this.properties.textAlign) {
                ctx.textAlign = "left"; x = this.properties.padding;
            } else if ("right" === this.properties.textAlign) {
                ctx.textAlign = "right"; x = this.size[0] - this.properties.padding;
            } else {
                ctx.textAlign = "center"; x = this.size[0] / 2;
            }

            const segs = this.parseTextWithLinks(line);
            let dx = x;

            if ("center" === this.properties.textAlign || "right" === this.properties.textAlign) {
                const tw = segs.reduce((s, seg) => s + ctx.measureText(seg.content).width, 0);
                dx = "center" === this.properties.textAlign
                    ? (this.size[0] - tw) / 2
                    : this.size[0] - this.properties.padding - tw;
                ctx.textAlign = "left";
            }

            segs.forEach((seg) => {
                if ("link" === seg.type) {
                    const w = ctx.measureText(seg.content).width;
                    this.linkAreas.push({ x: dx, y, width: w, height: lineHeight, url: seg.content });
                    ctx.fillStyle = "#1976D2";
                    ctx.fillText(seg.content, dx, y);
                    const uy = y + this.properties.fontSize;
                    ctx.beginPath();
                    ctx.moveTo(dx, uy + 1);
                    ctx.lineTo(dx + w, uy + 1);
                    ctx.strokeStyle = "#1976D2";
                    ctx.lineWidth = 1;
                    ctx.stroke();
                    ctx.fillStyle = this.properties.fontColor;
                    dx += w;
                } else {
                    ctx.fillText(seg.content, dx, y);
                    dx += ctx.measureText(seg.content).width;
                }
            });
        });
    }

    /* ---------- 编辑器管理 ---------- */

    createTextEditor() {
        if (this.editTextarea) this.removeTextEditor();

        const canvas = LGraphCanvas.active_canvas;
        const rect = canvas.canvas.getBoundingClientRect();
        const ox = (this.pos[0] + canvas.ds.offset[0]) * canvas.ds.scale;
        const oy = (this.pos[1] + canvas.ds.offset[1]) * canvas.ds.scale;

        // ---- 工具栏 ----
        this.editToolbar = document.createElement("div");
        Object.assign(this.editToolbar.style, {
            position: "absolute",
            left: rect.left + ox + "px",
            top: rect.top + oy - 240 + "px",
            width: "373px", display: "flex", flexDirection: "column",
            gap: "8px", zIndex: "1001", fontSize: "12px", color: "#ffffff"
        });

        // 对齐按钮
        const alignRow = document.createElement("div");
        Object.assign(alignRow.style, { display: "flex", alignItems: "center", gap: "8px" });
        const alignLabel = document.createElement("span");
        alignLabel.textContent = getText("textEditorAlignment");
        alignLabel.style.minWidth = "32px";
        alignLabel.style.fontSize = "14px";
        alignRow.appendChild(alignLabel);

        this.alignButtons = {};
        [
            { key: "left", symbol: getText("textEditorAlignLeftBtn"), title: getText("textEditorAlignLeft") },
            { key: "center", symbol: getText("textEditorAlignCenterBtn"), title: getText("textEditorAlignCenter") },
            { key: "right", symbol: getText("textEditorAlignRightBtn"), title: getText("textEditorAlignRight") }
        ].forEach((opt) => {
            const btn = document.createElement("button");
            btn.textContent = opt.symbol;
            btn.title = opt.title;
            Object.assign(btn.style, {
                width: "28px", height: "24px", border: "1px solid #666",
                borderRadius: "3px", cursor: "pointer", fontSize: "10px",
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
        this.editToolbar.appendChild(alignRow);

        // 颜色选择器
        const colorRow = document.createElement("div");
        Object.assign(colorRow.style, { display: "flex", alignItems: "center", gap: "10px" });

        const bgLbl = document.createElement("span");
        bgLbl.textContent = getText("textEditorBackground");
        bgLbl.style.minWidth = "32px";
        bgLbl.style.fontSize = "14px";
        colorRow.appendChild(bgLbl);

        this.bgColorPicker = document.createElement("input");
        this.bgColorPicker.type = "color";
        this.bgColorPicker.value = this.properties.backgroundColor;
        Object.assign(this.bgColorPicker.style, { width: "56px", height: "24px", border: "none", borderRadius: "3px", cursor: "pointer" });
        this.bgColorPicker.addEventListener("change", (e) => {
            this.properties.backgroundColor = e.target.value;
            this.updateTextareaStyle();
            app.graph.setDirtyCanvas(true);
        });
        colorRow.appendChild(this.bgColorPicker);

        const txtLbl = document.createElement("span");
        txtLbl.textContent = getText("textEditorText");
        txtLbl.style.fontSize = "14px";
        txtLbl.style.marginLeft = "30px";
        colorRow.appendChild(txtLbl);

        this.textColorPicker = document.createElement("input");
        this.textColorPicker.type = "color";
        this.textColorPicker.value = this.properties.fontColor;
        Object.assign(this.textColorPicker.style, { width: "56px", height: "24px", border: "none", borderRadius: "3px", cursor: "pointer" });
        this.textColorPicker.addEventListener("change", (e) => {
            this.properties.fontColor = e.target.value;
            this.updateTextareaStyle();
            app.graph.setDirtyCanvas(true);
        });
        colorRow.appendChild(this.textColorPicker);
        this.editToolbar.appendChild(colorRow);

        // 字体大小
        const sizeRow = document.createElement("div");
        Object.assign(sizeRow.style, { display: "flex", alignItems: "center", gap: "8px" });
        const sizeLbl = document.createElement("span");
        sizeLbl.textContent = getText("textEditorSize");
        sizeLbl.style.minWidth = "32px";
        sizeLbl.style.fontSize = "14px";
        sizeRow.appendChild(sizeLbl);

        this.fontSizeSlider = document.createElement("input");
        this.fontSizeSlider.type = "range";
        this.fontSizeSlider.min = "8";
        this.fontSizeSlider.max = "200";
        this.fontSizeSlider.value = this.properties.fontSize;
        Object.assign(this.fontSizeSlider.style, { flex: "1", height: "20px" });
        this.fontSizeSlider.addEventListener("input", (e) => {
            this.properties.fontSize = parseInt(e.target.value);
            this.fontSizeValue.textContent = this.properties.fontSize;
            this.updateTextareaStyle();
            app.graph.setDirtyCanvas(true);
        });
        sizeRow.appendChild(this.fontSizeSlider);

        this.fontSizeValue = document.createElement("span");
        this.fontSizeValue.textContent = this.properties.fontSize;
        Object.assign(this.fontSizeValue.style, { fontSize: "12px", minWidth: "25px", textAlign: "right" });
        sizeRow.appendChild(this.fontSizeValue);
        this.editToolbar.appendChild(sizeRow);

        // 透明度
        const alphaRow = document.createElement("div");
        Object.assign(alphaRow.style, { display: "flex", alignItems: "center", gap: "8px" });
        const alphaLbl = document.createElement("span");
        alphaLbl.textContent = getText("textEditorTransparency");
        alphaLbl.style.minWidth = "25px";
        alphaLbl.style.fontSize = "14px";
        alphaRow.appendChild(alphaLbl);

        this.alphaSlider = document.createElement("input");
        this.alphaSlider.type = "range";
        this.alphaSlider.min = "0";
        this.alphaSlider.max = "1";
        this.alphaSlider.step = "0.1";
        this.alphaSlider.value = this.properties.backgroundAlpha;
        Object.assign(this.alphaSlider.style, { flex: "1", height: "20px" });
        this.alphaSlider.addEventListener("input", (e) => {
            this.properties.backgroundAlpha = parseFloat(e.target.value);
            this.alphaValue.textContent = Math.round(100 * this.properties.backgroundAlpha) + "%";
            this.updateTextareaStyle();
            app.graph.setDirtyCanvas(true);
        });
        alphaRow.appendChild(this.alphaSlider);

        this.alphaValue = document.createElement("span");
        this.alphaValue.textContent = Math.round(100 * this.properties.backgroundAlpha) + "%";
        Object.assign(this.alphaValue.style, { fontSize: "12px", minWidth: "25px", textAlign: "right" });
        alphaRow.appendChild(this.alphaValue);
        this.editToolbar.appendChild(alphaRow);

        // 圆角大小滑条
        const radiusRow = document.createElement("div");
        Object.assign(radiusRow.style, { display: "flex", alignItems: "center", gap: "8px" });
        const radiusLbl = document.createElement("span");
        radiusLbl.textContent = "圆角";
        radiusLbl.style.minWidth = "32px";
        radiusLbl.style.fontSize = "14px";
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

        // 行高
        const lhRow = document.createElement("div");
        Object.assign(lhRow.style, { display: "flex", alignItems: "center", gap: "8px" });
        const lhLbl = document.createElement("span");
        lhLbl.textContent = getText("textEditorLineHeight");
        lhLbl.style.minWidth = "25px";
        lhLbl.style.fontSize = "14px";
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

        // ---- 文本编辑区 ----
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
            resize: "none", padding: "0px", boxSizing: "border-box",
            zIndex: "1000", textAlign: this.properties.textAlign
        });
        this.updateTextareaStyle();
        document.body.appendChild(this.editTextarea);
        this.editTextarea.focus();
        this.editTextarea.select();

        // 保存并关闭
        const saveAndClose = () => {
            this.properties.text = this.editTextarea.value;
            this.removeTextEditor();
            this.setDirtyCanvas(true, true);
            app.graph.setDirtyCanvas(true);
        };

        // 位置同步
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
            Object.assign(this.editToolbar.style, {
                left: r.left + ox2 + "px",
                top: r.top + oy2 - 240 + "px"
            });
            this.updateTextareaStyle();
        };

        const origOCC = canvas.onCanvasChanged;
        canvas.onCanvasChanged = (evt) => {
            origOCC && origOCC.call(canvas, evt);
            this.updateEditorsPosition();
        };
        this.canvasUpdateInterval = setInterval(() => this.updateEditorsPosition(), 16);

        // 键盘：Esc 关闭，Ctrl/Cmd+Enter 保存
        this.editTextarea.addEventListener("keydown", (e) => {
            if ("Escape" === e.key) {
                this.removeTextEditor();
            } else if ("Enter" === e.key && (e.ctrlKey || e.metaKey)) {
                saveAndClose();
            }
            e.stopPropagation();
        });

        // 点击外部自动保存
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

        // 失去焦点
        this.editTextarea.addEventListener("blur", () => {
            setTimeout(() => {
                if (this.editToolbar && this.editTextarea &&
                    !this.editToolbar.contains(document.activeElement) &&
                    document.activeElement !== this.editTextarea) {
                    saveAndClose();
                }
            }, 100);
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
            backgroundColor: this.hexToRGBA(this.properties.backgroundColor, this.properties.backgroundAlpha),
            textAlign: this.properties.textAlign,
            lineHeight: this.properties.lineHeight,
            paddingTop: "2px", paddingLeft: "0px", paddingRight: "0px", paddingBottom: "0px",
            boxSizing: "border-box"
        });
    }

    updateAlignButtons() {
        Object.keys(this.alignButtons).forEach((k) => {
            this.alignButtons[k].style.backgroundColor = this.properties.textAlign === k ? "#459BAC" : "#444";
        });
    }

    removeTextEditor() {
        if (this.editTextarea) { document.body.removeChild(this.editTextarea); this.editTextarea = null; }
        if (this.editToolbar) { document.body.removeChild(this.editToolbar); this.editToolbar = null; }
        if (this.canvasUpdateInterval) { clearInterval(this.canvasUpdateInterval); this.canvasUpdateInterval = null; }
        if (this.documentClickHandler) { document.removeEventListener("click", this.documentClickHandler, true); this.documentClickHandler = null; }
        this.isEditing = false;
    }

    /* ---------- 渲染 ---------- */

    onDrawBackground(ctx) {
        ctx.save();

        ctx.imageSmoothingEnabled = true;

        // 绘制圆角背景
        const r = this.properties.borderRadius;
        ctx.beginPath();
        ctx.roundRect(0, 0, this.size[0], this.size[1], r);
        ctx.fillStyle = this.hexToRGBA(this.properties.backgroundColor, this.properties.backgroundAlpha);
        ctx.fill();

        // 编辑中显示绿色边框
        if (this.isEditing) {
            ctx.strokeStyle = "#4CAF50";
            ctx.lineWidth = 2;
            ctx.stroke();
        }

        // 绘制文本（不裁剪，允许上下溢出背景框，左右由换行逻辑保证不溢出）
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

    /* ---------- 属性变更 ---------- */

    onPropertyChanged(name, value) {
        if (this.isEditing) {
            if ("fontSize" === name && this.fontSizeSlider) {
                this.fontSizeSlider.value = value;
                this.fontSizeValue.textContent = value;
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
            }
            this.updateTextareaStyle();
        }
        this.setDirtyCanvas(true, true);
        app.graph.setDirtyCanvas(true);
    }

    /* ---------- 交互事件 ---------- */

    onMouseDown(evt, pos) {
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
            if (!url.match(/^https?:\/\//)) url = "https://" + url;
            const msg = getText("linkOpenConfirm") + "\n\n" + getText("linkOpenUrl") + url;
            if (confirm(msg)) {
                if (typeof window !== "undefined" && window.open) {
                    window.open(url, "_blank");
                } else {
                    console.log("Opening: " + url);
                }
            }
        } catch (err) {
            console.error(getText("linkOpenError") + ":", err);
            alert(getText("linkOpenError") + ": " + url);
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
            content: getText("textEditorEdit"),
            callback: () => this.createTextEditor()
        });
        options.push({
            content: getText("textEditorPin"),
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

// ==================== 静态属性与控件定义 ====================
TextEditorNode.type = "孤海注释";
TextEditorNode.title = getText("textEditorTitle");
TextEditorNode.title_mode = LiteGraph.NO_TITLE;
TextEditorNode.collapsable = false;

TextEditorNode["@text"] = { type: "string", title: getText("textEditorContent"), default: "双击编辑文本内容...", multiline: true };
TextEditorNode["@fontSize"] = { type: "number", title: getText("textEditorFontSize"), default: 24, min: 8, max: 32, step: 1 };
TextEditorNode["@fontColor"] = { type: "color", title: getText("textEditorFontColor"), default: "#E3E3E3" };
TextEditorNode["@backgroundColor"] = { type: "color", title: getText("textEditorBackgroundColor"), default: "#1B4669" };
TextEditorNode["@backgroundAlpha"] = { type: "number", title: getText("textEditorBackgroundAlpha"), default: 0.8, min: 0, max: 1, step: 0.1 };
TextEditorNode["@borderRadius"] = { type: "number", title: "圆角", default: 30, min: 0, max: 300, step: 1 };
TextEditorNode["@padding"] = { type: "number", title: getText("textEditorPadding"), default: 10, min: 0, max: 50, step: 1 };
TextEditorNode["@lineHeight"] = { type: "number", title: getText("textEditorLineSpacing"), default: 1.4, min: 0.8, max: 3, step: 0.1 };
TextEditorNode["@textAlign"] = { type: "combo", title: getText("textEditorTextAlign"), values: ["left", "center", "right"], default: "center" };

// ==================== 画布事件补丁 ====================

// drawNode 补丁：运行时动态设置 bgcolor 为 transparent，阻止 LiteGraph 绘制默认背景
const _origDrawNode = LGraphCanvas.prototype.drawNode;
LGraphCanvas.prototype.drawNode = function (node, ctx) {
    if (node.constructor === TextEditorNode) {
        node.bgcolor = "transparent";
        node.color = "#fff0";
        const result = _origDrawNode.apply(this, arguments);
        node.onDrawBackground(ctx);
        return result;
    }
    return _origDrawNode.apply(this, arguments);
};

// processMouseDown：拦截链接点击
const _origPMDown = LGraphCanvas.prototype.processMouseDown;
LGraphCanvas.prototype.processMouseDown = function (e) {
    if (!this.graph) return;
    const canvasPos = this.convertEventToCanvasOffset(e);
    const node = this.graph.getNodeOnPos(canvasPos[0], canvasPos[1], this.visible_nodes);
    if (node && node.constructor === TextEditorNode && !node.isEditing) {
        const lp = [canvasPos[0] - node.pos[0], canvasPos[1] - node.pos[1]];
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

// ==================== pinned 节点点击穿透 ====================
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

// ==================== 注册 ComfyUI 扩展 ====================
app.registerExtension({
    name: "孤海注释",
    registerCustomNodes() {
        TextEditorNode.setUp();
    }
});
