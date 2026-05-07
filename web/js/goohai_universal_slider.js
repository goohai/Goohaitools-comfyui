import { app } from "../../../scripts/app.js";

// ═══════════════════════════════════════════════
//  孤海万能滑条 · Goohai Universal Slider
//  Canvas 绘制版：缩放到任意大小都始终可见
// ═══════════════════════════════════════════════


(function () {
    const ID = "goohai-us-css";
    if (document.getElementById(ID)) return;
    const s = document.createElement("style");
    s.id = ID;
    s.textContent = `
.ghs-overlay{position:fixed;inset:0;background:rgba(0,0,0,.55);backdrop-filter:blur(3px);z-index:100000;display:flex;justify-content:center;align-items:center;animation:ghsIn .15s ease}
@keyframes ghsIn{from{opacity:0}to{opacity:1}}
@keyframes ghsPop{from{opacity:0;transform:translateY(-8px) scale(.97)}to{opacity:1;transform:translateY(0) scale(1)}}
.ghs-panel{background:#1c1c1e;border:1px solid #333;border-radius:14px;padding:28px 32px;min-width:380px;box-shadow:0 24px 80px rgba(0,0,0,.6);animation:ghsPop .2s ease;font-family:'Segoe UI',system-ui,-apple-system,sans-serif;--gs-c:#e8c547}
.ghs-ptitle{font-size:16px;font-weight:700;color:#eee;margin-bottom:22px}
.ghs-row{display:flex;align-items:center;margin-bottom:14px}
.ghs-rlbl{width:72px;font-size:12.5px;color:#999;flex-shrink:0}
.ghs-inp{flex:1;background:#2a2a2c;border:1px solid #3a3a3c;border-radius:8px;padding:8px 12px;color:#eee;font-size:13px;outline:none;transition:border-color .2s;font-family:inherit}
.ghs-inp:focus{border-color:var(--gs-c)}
.ghs-clr{width:48px;height:34px;padding:2px;border-radius:8px;border:1px solid #3a3a3c;background:#2a2a2c;cursor:pointer}
.ghs-btns{display:flex;justify-content:flex-end;gap:10px;margin-top:22px}
.ghs-btn{padding:8px 22px;border-radius:8px;border:none;cursor:pointer;font-size:13px;font-weight:500;transition:all .15s;font-family:inherit}
.ghs-bx{background:#2a2a2c;color:#aaa;border:1px solid #3a3a3c}
.ghs-bx:hover{background:#333;color:#ccc}
.ghs-bok{background:var(--gs-c);color:#111;font-weight:600}
.ghs-bok:hover{filter:brightness(1.12)}
.ghs-radio-wrap{flex:1;display:flex;gap:20px;align-items:center}
.ghs-radio-label{display:flex;align-items:center;gap:6px;cursor:pointer;color:#eee;font-size:13px;padding:6px 12px;border-radius:6px;background:#2a2a2c;border:1px solid #3a3a3c;transition:all .15s}
.ghs-radio-label:hover{border-color:var(--gs-c)}
.ghs-radio-label input[type="radio"]{appearance:none;-webkit-appearance:none;width:16px;height:16px;border:2px solid #555;border-radius:50%;cursor:pointer;transition:all .15s;position:relative}
.ghs-radio-label input[type="radio"]:checked{border-color:var(--gs-c)}
.ghs-radio-label input[type="radio"]:checked::after{content:'';position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:8px;height:8px;border-radius:50%;background:var(--gs-c)}
    `;
    document.head.appendChild(s);
})();

// ── 工具函数 ──────────────────────────────────
const pct   = (v, mn, mx) => { const r = mx - mn; return r > 0 ? ((v - mn) / r) * 100 : 0; };
const clamp = (v, mn, mx) => Math.max(mn, Math.min(mx, v));
const snap  = (v, mn, step) => step > 0 ? Math.round((v - mn) / step) * step + mn : v;
const fmt   = (v, isInt) => isInt ? String(Math.round(v)) : v.toFixed(2);
function castVal(v, isInt) {
    if (isInt) return parseInt(Math.round(v), 10);
    return parseFloat(v.toFixed(2));
}

// ── 统一的值计算函数，先 snap 再按类型取整 ──
function calcValue(v, mn, mx, step, isInt) {
    v = snap(v, mn, step);
    v = clamp(v, mn, mx);
    return castVal(v, isInt);
}

// ── Canvas 圆角矩形 ──────────────────────────
function rrect(ctx, x, y, w, h, r) {
    if (w < 0) w = 0;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
}

// ── updateVis ────────────────────────────────
function updateVis(n) {
    n.setDirtyCanvas(true, true);
}

// ── syncWidgetType ───────────────────────────
function syncWidgetType(node) {
    const g = node._gs;
    if (!g || !g.widget) return;
    const p     = node.properties;
    const isInt = p.sliderType === "int";
    g.widget.type = isInt ? "INT" : "FLOAT";
    let v = g.widget.value;
    v = clamp(v, p.sliderMin, p.sliderMax);
    v = isInt ? Math.round(v) : parseFloat(v.toFixed(2));
    g.widget.value = v;
}

// ── syncOutputType ───────────────────────────
function syncOutputType(node) {
    const g = node._gs;
    if (!g || !g.outputTypeWidget) return;
    const isInt = node.properties.sliderType === "int";
    g.outputTypeWidget.value = isInt ? "int" : "float";
}

// ── 清理拖拽状态 ─────────────────────────────
function cleanupDrag(node) {
    const g = node._gs;
    if (!g) return;
    g._dragging = false;
    if (g._docCleanup) {
        g._docCleanup();
        g._docCleanup = null;
    }
}

// ── showSettings ─────────────────────────────
function showSettings(node) {
    cleanupDrag(node);
    document.querySelectorAll(".ghs-overlay").forEach((e) => e.remove());
    const p = node.properties;

    const ov = document.createElement("div");
    ov.className = "ghs-overlay";
    ov.setAttribute("tabindex", "-1");

    const pl = document.createElement("div");
    pl.className = "ghs-panel";
    pl.style.setProperty("--gs-c", p.sliderColor);

    const title = document.createElement("div");
    title.className = "ghs-ptitle";
    title.textContent = "🎮  孤海滑条 设置";
    pl.appendChild(title);

    function addRow(labelText, el) {
        const r = document.createElement("div");
        r.className = "ghs-row";
        const l = document.createElement("label");
        l.className = "ghs-rlbl";
        l.textContent = labelText;
        r.append(l, el);
        pl.appendChild(r);
    }
    function mkInp(type, value, attrs) {
        const i = document.createElement("input");
        i.className = "ghs-inp";
        i.type = type;
        i.value = value;
        if (attrs) Object.entries(attrs).forEach(([k, v]) => i.setAttribute(k, v));
        return i;
    }

    const clrI = document.createElement("input");
    clrI.className = "ghs-clr";
    clrI.type = "color";
    clrI.value = p.sliderColor;
    addRow("滑条颜色", clrI);

    const radioWrap = document.createElement("div");
    radioWrap.className = "ghs-radio-wrap";
    const types = [
        { v: "float", t: "浮点 (Float)" },
        { v: "int",   t: "整数 (Integer)" },
    ];
    let selectedType = p.sliderType;
    types.forEach((opt) => {
        const label = document.createElement("label");
        label.className = "ghs-radio-label";
        const radio = document.createElement("input");
        radio.type = "radio";
        radio.name = "ghs-slider-type";
        radio.value = opt.v;
        radio.checked = (p.sliderType === opt.v);
        radio.addEventListener("change", () => { if (radio.checked) selectedType = opt.v; });
        label.append(radio, document.createTextNode(opt.t));
        radioWrap.appendChild(label);
    });
    addRow("类型", radioWrap);

    const minI = mkInp("number", p.sliderMin, { step: "any" });
    addRow("最小值", minI);
    const maxI = mkInp("number", p.sliderMax, { step: "any" });
    addRow("最大值", maxI);
    const stepI = mkInp("number", p.sliderStep, { step: "any", min: "0.0001" });
    addRow("步长", stepI);
    const lblI = mkInp("text", p.sliderLabel);
    addRow("显示名称", lblI);

    const btns = document.createElement("div");
    btns.className = "ghs-btns";
    const bCancel = document.createElement("button");
    bCancel.className = "ghs-btn ghs-bx";
    bCancel.textContent = "取消";
    bCancel.onclick = () => ov.remove();
    const bOk = document.createElement("button");
    bOk.className = "ghs-btn ghs-bok";
    bOk.textContent = "确定";
    bOk.onclick = () => {
        let type  = selectedType;
        let mn    = parseFloat(minI.value);
        let mx    = parseFloat(maxI.value);
        let step  = parseFloat(stepI.value);
        let label = (lblI.value || "").trim() || "值";
        let color = clrI.value;

        if (isNaN(mn)) mn = 0;
        if (isNaN(mx)) mx = 1;
        if (mn > mx) { const t = mn; mn = mx; mx = t; }
        if (isNaN(step) || step <= 0) step = type === "int" ? 1 : 0.01;
        if (type === "int") {
            mn   = Math.round(mn);
            mx   = Math.round(mx);
            step = Math.max(1, Math.round(step));
        }

        p.sliderType  = type;
        p.sliderMin   = mn;
        p.sliderMax   = mx;
        p.sliderStep  = step;
        p.sliderLabel = label;
        p.sliderColor = color;

        const w = node._gs.widget;
        if (w) {
            w.value = calcValue(w.value, mn, mx, step, type === "int");
        }

        syncWidgetType(node);
        syncOutputType(node);
        updateVis(node);
        node.setDirtyCanvas(true, true);
        ov.remove();
    };

    btns.append(bCancel, bOk);
    pl.appendChild(btns);
    ov.appendChild(pl);

    ov.addEventListener("click", (e) => { if (e.target === ov) ov.remove(); });
    ov.addEventListener("keydown", (e) => {
        if (e.key === "Escape") ov.remove();
        if (e.key === "Enter")  bOk.click();
    });

    document.body.appendChild(ov);
    ov.focus();
}

// ── setupSlider ──────────────────────────────
function setupSlider(node) {
    const D = {
        sliderType: "float", sliderMin: 0, sliderMax: 1,
        sliderStep: 0.01, sliderLabel: "值", sliderColor: "#e8c547",
    };
    if (!node.properties) node.properties = {};
    for (const [k, v] of Object.entries(D)) {
        if (node.properties[k] === undefined) node.properties[k] = v;
    }
    const p     = node.properties;
    const isInt = p.sliderType === "int";

    /* 隐藏 PY 自带滑条 */
    const dw = node.widgets ? node.widgets.find((w) => w.name === "值") : null;
    if (dw) {
        dw.hidden = true;
        dw.computeSize = () => [0, 0];
    }

    /* output_type 隐藏 widget */
    let outputTypeWidget = node.widgets
        ? node.widgets.find((w) => w.name === "output_type")
        : null;
    if (!outputTypeWidget) {
        node.addWidget("combo", "output_type", isInt ? "int" : "float", function () {}, { values: ["float", "int"] });
        outputTypeWidget = node.widgets ? node.widgets.find((w) => w.name === "output_type") : null;
    }
    if (outputTypeWidget) {
        outputTypeWidget.value       = isInt ? "int" : "float";
        outputTypeWidget.type        = "hidden";
        outputTypeWidget.hidden      = true;
        outputTypeWidget.computeSize = () => [0, 0];
        outputTypeWidget.draw        = function () {};
        outputTypeWidget.mouse       = function () {};
    }

    /* 节点外观 */
    node.color   = "#2D384D";
    node.bgcolor = "#2D384D";

    /* 覆盖标题渲染 */
    const origFG = node.onDrawForeground;
    node.onDrawForeground = function (ctx) {
        const th = (typeof LiteGraph !== "undefined" && LiteGraph.NODE_TITLE_HEIGHT) || 30;
        const r  = (typeof LiteGraph !== "undefined" && LiteGraph.NODE_ROUND_RADIUS) || 8;
        const w  = this.size[0];
        const x  = 0, y = -th, fw = w, fh = th + 2;

        ctx.save();
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.lineTo(x + fw - r, y);
        ctx.arcTo(x + fw, y, x + fw, y + r, r);
        ctx.lineTo(x + fw, y + fh);
        ctx.lineTo(x, y + fh);
        ctx.lineTo(x, y + r);
        ctx.arcTo(x, y, x + r, y, r);
        ctx.closePath();
        ctx.fillStyle = this.color || "#2D384D";
        ctx.fill();
        ctx.restore();

        ctx.save();
        ctx.font         = "20px 'Segoe UI','PingFang SC','Microsoft YaHei',sans-serif";
        ctx.fillStyle    = "#E3E3E3";
        ctx.textAlign    = "center";
        ctx.textBaseline = "top";
        ctx.fillText(this.title || "", w / 2, -th + 10);
        ctx.restore();
        if (origFG) origFG.call(this, ctx);
    };

    /* ── 绘制状态缓存 ── */
    const ds = { trackLeft: 14, trackW: 192 };

    node._gs = {
        widget: dw,
        outputTypeWidget: outputTypeWidget,
        _dragging: false,
        _docCleanup: null,
    };

    syncWidgetType(node);
    syncOutputType(node);

    /* ══════════════════════════════════════════
     *  注册 Canvas 自定义 Widget
     * ══════════════════════════════════════════ */
    node.addCustomWidget({
        name: "ghs_ui",
        type: "goohai_slider",

        draw(ctx, node, W, y, H) {
            const g = node._gs;
            if (!g) return;
            const p     = node.properties;
            const v     = g.widget ? g.widget.value : 0;
            const isInt = p.sliderType === "int";
            const ratio = clamp(pct(v, p.sliderMin, p.sliderMax), 0, 100);
            const color = p.sliderColor;


            const ml = 14;
            const mr = 24;
            ds.trackLeft = ml;
            ds.trackW    = W - ml - mr;

            /* ── 居中标签（名称 16px + 数值 20px bold） ── */
            ctx.save();
            ctx.textBaseline = "middle";
            ctx.textAlign    = "left";

            const nameFont = "16px 'Segoe UI','PingFang SC','Microsoft YaHei',sans-serif";
            const valFont  = "bold 24px 'Segoe UI','PingFang SC','Microsoft YaHei',sans-serif";

            ctx.font = nameFont;
            const nameText = p.sliderLabel;
            const nameW    = ctx.measureText(nameText).width;

            ctx.font = valFont;
            const valText = " " + fmt(v, isInt);
            const valW    = ctx.measureText(valText).width;

            const lx = (W - nameW - valW) / 2;
            const ly = y + 6;

            ctx.shadowColor   = "rgba(0,0,0,0.6)";
            ctx.shadowBlur    = 3;
            ctx.shadowOffsetY = 1;

            ctx.font      = nameFont;
            ctx.fillStyle = "#B2B7BD";
            ctx.fillText(nameText, lx, ly);

            ctx.font      = valFont;
            ctx.fillStyle = color;
            ctx.fillText(valText, lx + nameW, ly);
            ctx.restore();

            /* ── 轨道背景（10px 高，圆角 5） */
            const trackY = y + 34;
            const trackH = 10;
            const trackR = 5;

            ctx.save();
            ctx.shadowColor   = "rgba(0,0,0,0.5)";
            ctx.shadowBlur    = 2;
            ctx.shadowOffsetY = 1;
            rrect(ctx, ml, trackY, ds.trackW, trackH, trackR);
            ctx.fillStyle = "#1a1a1a";
            ctx.fill();
            ctx.restore();

            const fillW = ds.trackW * ratio / 100;

            /* ── 发光层 ── */
            if (fillW > 0) {
                ctx.save();
                ctx.globalAlpha = 0.2;
                ctx.shadowColor = color;
                ctx.shadowBlur  = 10;
                rrect(ctx, ml, trackY + 2, fillW, trackH - 4, 5);
                ctx.fillStyle = color;
                ctx.fill();
                ctx.restore();
            }

            /* ── 填充条 ── */
            if (fillW > 0) {
                ctx.save();
                rrect(ctx, ml, trackY, fillW, trackH, trackR);
                ctx.fillStyle = color;
                ctx.fill();
                ctx.restore();
            }

            /* ── 圆形旋钮（16px 直径） ── */
            const thumbX = ml + fillW;
            const thumbY = trackY + trackH / 2;
            const thumbR = 8;

            ctx.save();
            if (g._dragging) {
                ctx.shadowColor = "rgba(232,197,71,0.12)";
                ctx.shadowBlur  = 5;
            } else {
                ctx.shadowColor = "rgba(0,0,0,0.4)";
                ctx.shadowBlur  = 4;
            }
            ctx.fillStyle   = "#f5f0e8";
            ctx.strokeStyle = color;
            ctx.lineWidth   = 2;
            ctx.beginPath();
            ctx.arc(thumbX, thumbY, thumbR, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
            ctx.restore();
        },

        mouse(event, pos, node) {
            const g = node._gs;
            if (!g) return;
            const p = node.properties;

            /* ── mouseup / pointerup：结束拖拽 ── */
            if (event.type === "mouseup" || event.type === "pointerup") {
                if (g._dragging) {
                    g._dragging = false;
                    if (g._docCleanup) { g._docCleanup(); g._docCleanup = null; }
                    node.setDirtyCanvas(true, true);
                    return true;
                }
                return;
            }

            /* ── mousemove / pointermove：拖拽中实时更新 ── */
            if ((event.type === "mousemove" || event.type === "pointermove") && g._dragging) {
                const isInt = p.sliderType === "int";
                const ratio = clamp((pos[0] - ds.trackLeft) / ds.trackW, 0, 1);
                let v = p.sliderMin + ratio * (p.sliderMax - p.sliderMin);
                v = calcValue(v, p.sliderMin, p.sliderMax, p.sliderStep, isInt);
                if (g.widget) g.widget.value = v;
                node.setDirtyCanvas(true, false);
                return true;
            }

            /* ── 仅处理左键 mousedown / pointerdown ── */
            if (event.type !== "mousedown" && event.type !== "pointerdown") return;
            if (event.button !== 0) return;

            /* ── 清理可能残留的拖拽状态 ── */
            if (g._dragging) {
                g._dragging = false;
                if (g._docCleanup) { g._docCleanup(); g._docCleanup = null; }
            }

            /* ── 左键：跳到点击位置并开始拖拽 ── */
            const isInt = p.sliderType === "int";
            const ratio = clamp((pos[0] - ds.trackLeft) / ds.trackW, 0, 1);
            let v = p.sliderMin + ratio * (p.sliderMax - p.sliderMin);
            v = calcValue(v, p.sliderMin, p.sliderMax, p.sliderStep, isInt);

            if (g.widget) g.widget.value = v;
            node.setDirtyCanvas(true, false);

            g._dragging = true;

            /* ── document 备用监听（防止 LiteGraph 不转发后续事件时的保底） ── */
            const startCX  = event.clientX;
            const startVal = v;

            function onDocMove(e2) {
                if (!g._dragging) return;
                const dx       = e2.clientX - startCX;
                const scale    = app.canvas.ds.scale || 1;
                const graphDx  = dx / scale;
                const ratioD   = graphDx / ds.trackW;
                const valDelta = ratioD * (p.sliderMax - p.sliderMin);
                let nv = startVal + valDelta;
                nv = calcValue(nv, p.sliderMin, p.sliderMax, p.sliderStep, isInt);
                if (g.widget) g.widget.value = nv;
                node.setDirtyCanvas(true, false);
            }

            function onDocUp() {
                if (!g._dragging) return;
                g._dragging = false;
                g._docCleanup = null;
                document.removeEventListener("mousemove", onDocMove);
                document.removeEventListener("mouseup", onDocUp);
                node.setDirtyCanvas(true, true);
            }

            g._docCleanup = function () {
                document.removeEventListener("mousemove", onDocMove);
                document.removeEventListener("mouseup", onDocUp);
            };
            document.addEventListener("mousemove", onDocMove);
            document.addEventListener("mouseup", onDocUp);

            return true;
        },

        computeSize(width) {
            return [width, 60];
        },
    });

    /* 监听外部值变化 */
    const origCB = node.onWidgetChanged;
    node.onWidgetChanged = function (name, value, widget) {
        if (origCB) origCB.call(this, name, value, widget);
        if (name === "值") updateVis(this);
    };

    /* 节点宽度 */
    node.size[0] = Math.max(node.size[0], 300);
}

// ── 注册扩展 ────────────────────────────────
app.registerExtension({
    name: "goohai.universal.slider",

    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name !== "GoohaiUniversalSlider") return;

        /* ── 圆角标题补丁 ── */
        if (
            typeof LGraphCanvas !== "undefined" &&
            LGraphCanvas.prototype.drawNode &&
            typeof LiteGraph !== "undefined" &&
            !LGraphCanvas.prototype._ghsRadiusPatched
        ) {
            LGraphCanvas.prototype._ghsRadiusPatched = true;
            const origDrawNode = LGraphCanvas.prototype.drawNode;
            LGraphCanvas.prototype.drawNode = function (node, ctx, ...args) {
                if (node.type === "GoohaiUniversalSlider") {
                    const origR = LiteGraph.NODE_ROUND_RADIUS;
                    LiteGraph.NODE_ROUND_RADIUS = 8;
                    origDrawNode.call(this, node, ctx, ...args);
                    LiteGraph.NODE_ROUND_RADIUS = origR;
                } else {
                    origDrawNode.call(this, node, ctx, ...args);
                }
            };
        }

        /* ── onNodeCreated ── */
        const onCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            const r = onCreated ? onCreated.apply(this, arguments) : undefined;
            setupSlider(this);
            return r;
        };

        /* ── configure（加载已保存的节点时恢复状态） ── */
        const onConfigure = nodeType.prototype.configure;
        nodeType.prototype.configure = function (info) {
            if (onConfigure) onConfigure.apply(this, arguments);
            if (!this._gs) return;
            const p = this.properties;


            const w = this._gs.widget;
            if (w) {
                const isInt = p.sliderType === "int";
                w.value = calcValue(w.value, p.sliderMin, p.sliderMax, p.sliderStep, isInt);
            }

            syncWidgetType(this);
            syncOutputType(this);
            updateVis(this);
        };

        /* ── 右键上下文菜单 ── */
        const origExtra = nodeType.prototype.getExtraMenuOptions;
        nodeType.prototype.getExtraMenuOptions = function (canvas, options) {
            let r;
            try {
                if (typeof origExtra === "function") {
                    r = origExtra.apply(this, arguments);
                }
            } catch (e) {
                console.warn("[GoohaiSlider] getExtraMenuOptions:", e);
            }
            if (Array.isArray(options)) {
                options.splice(0, 0, null, {
                    content: "🎮  孤海滑条 设置",
                    callback: () => showSettings(this),
                });
            }
            return r;
        };
    },
});
