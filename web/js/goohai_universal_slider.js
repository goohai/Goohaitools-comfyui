import { app } from "../../../scripts/app.js";
import { installNativeNodePointerBridge } from "./goohai_dom_native_interaction.js";

// ═══════════════════════════════════════════════
//  孤海万能滑条 · Goohai Universal Slider
//  DOM 组件版：Legacy 与 Nodes 2.0 共用同一套控件
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
.ghs-dom{position:relative;width:100%;height:60px;min-height:60px;max-height:60px;flex:0 0 60px!important;box-sizing:border-box;display:flex;flex-direction:column;justify-content:center;gap:7px;padding:3px 14px 4px;transform:translateY(-8px);user-select:none;pointer-events:auto;overflow:hidden}
.ghs-dom-value{position:relative;z-index:1;display:flex;align-items:center;justify-content:center;min-height:29px;line-height:1;white-space:nowrap;overflow:visible}
.ghs-dom-label{font:16px 'Segoe UI','PingFang SC','Microsoft YaHei',sans-serif;color:#b2b7bd;line-height:29px;transform:translateY(-1px);text-shadow:2px 0 0.3px rgba(0,0,0,.6);overflow:visible;text-overflow:clip}
.ghs-dom-number{font:bold 24px 'Segoe UI','PingFang SC','Microsoft Ya Hei',sans-serif;color:var(--gs-c);line-height:29px;margin-left:7px;transform:translateY(-3px);text-shadow:2px 0 0.3px rgba(0,0,0,.6)}
.ghs-dom-hit{position:absolute;left:14px;right:14px;top:27px;bottom:0;z-index:3;cursor:pointer}
.ghs-dom-range{position:relative;z-index:0;display:block;width:100%;height:18px;margin:0;padding:0;appearance:none;-webkit-appearance:none;background:transparent;cursor:pointer;touch-action:none;outline:none}
.ghs-dom-range::-webkit-slider-runnable-track{height:10px;border-radius:5px;background:linear-gradient(to right,var(--gs-c) 0 var(--gs-pct),#1a1a1a var(--gs-pct) 100%);box-shadow:0 1px 2px rgba(0,0,0,.45)}
.ghs-dom-range::-webkit-slider-thumb{appearance:none;-webkit-appearance:none;width:18px;height:18px;border-radius:50%;margin-top:-4px;background:#f5f0e8;border:2px solid var(--gs-c);box-shadow:0 1px 4px rgba(0,0,0,.45)}
.ghs-dom-range::-moz-range-track{height:10px;border-radius:5px;background:#1a1a1a;box-shadow:0 1px 2px rgba(0,0,0,.45)}
.ghs-dom-range::-moz-range-progress{height:10px;border-radius:5px;background:var(--gs-c)}
.ghs-dom-range::-moz-range-thumb{width:16px;height:16px;border-radius:50%;background:#f5f0e8;border:2px solid var(--gs-c);box-shadow:0 1px 4px rgba(0,0,0,.45)}
    `;
    document.head.appendChild(s);
})();

// ── 工具函数 ──────────────────────────────────
const pct   = (v, mn, mx) => { const r = mx - mn; return r > 0 ? ((v - mn) / r) * 100 : 0; };
const clamp = (v, mn, mx) => Math.max(mn, Math.min(mx, v));
const snap  = (v, mn, step) => step > 0 ? Math.round((v - mn) / step) * step + mn : v;
const fmt   = (v, isInt) => isInt ? String(Math.round(v)) : v.toFixed(2);
const GOOHAI_NODE_WIDTH = 350;
const GOOHAI_NODE_HEIGHT = 100;
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

// ── updateVis ────────────────────────────────
function updateVis(node, surface = "both") {
    const g = node._gs;
    if (!g) return;
    g.syncDom?.();

    if (surface === "both") g._redrawSurface = "both";
    else if (!g._redrawSurface) g._redrawSurface = surface;
    if (g._redrawPending) return;

    g._redrawPending = true;
    requestAnimationFrame(() => {
        g._redrawPending = false;
        const target = g._redrawSurface || "both";
        g._redrawSurface = null;
        if (target !== "dom") node.setDirtyCanvas(true, false);
    });
}

function setSliderValue(node, value, { notify = true, oldValue, surface = "both" } = {}) {
    const g = node._gs;
    const widget = g?.widget;
    if (!widget) return;

    const previousValue = oldValue ?? widget.value;
    if (widget.value === value && (!notify || previousValue === value)) return;
    widget.value = value;
    g.syncDom?.();

    if (notify && previousValue !== value) {
        widget.callback?.(value, app.canvas, node);
        node.onWidgetChanged?.(widget.name, value, previousValue, widget);
        node.graph?.incrementVersion?.();
    }

    updateVis(node, surface);
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

// ── showSettings ─────────────────────────────
function showSettings(node) {
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
            setSliderValue(node, calcValue(w.value, mn, mx, step, type === "int"));
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

// ── Legacy / Nodes 2.0 共用 DOM 组件 ─────────
function setupSliderDom(node) {
    if (typeof node.addDOMWidget !== "function") return null;

    const root = document.createElement("div");
    root.className = "ghs-dom";
    root.addEventListener("contextmenu", (event) => {
        event.preventDefault();
        event.stopPropagation();
        showSettings(node);
    });

    const valueRow = document.createElement("div");
    valueRow.className = "ghs-dom-value";
    const label = document.createElement("span");
    label.className = "ghs-dom-label";
    const number = document.createElement("span");
    number.className = "ghs-dom-number";
    valueRow.append(label, number);

    const range = document.createElement("input");
    range.className = "ghs-dom-range";
    range.type = "range";
    range.style.height = "60px";
    range.style.marginTop = "-21px";
    range.style.marginBottom = "-21px";
    root.append(valueRow, range);

    const sliderHit = document.createElement("div");
    sliderHit.className = "ghs-dom-hit";
    root.appendChild(sliderHit);

    installNativeNodePointerBridge(root, {
        getWidget: () => domWidget,
        shouldForwardLeft: (event) => valueRow.contains(event.target),
    });

    let startValue;
    let expandedDragging = false;
    const sync = () => {
        const g = node._gs;
        if (!g?.widget) return;
        const p = node.properties;
        const isInt = p.sliderType === "int";
        const value = calcValue(g.widget.value, p.sliderMin, p.sliderMax, p.sliderStep, isInt);
        label.textContent = p.sliderLabel;
        number.textContent = fmt(value, isInt);
        range.min = String(p.sliderMin);
        range.max = String(p.sliderMax);
        range.step = String(p.sliderStep);
        range.value = String(value);
        root.style.setProperty("--gs-c", p.sliderColor);
        root.style.setProperty("--gs-pct", `${clamp(pct(value, p.sliderMin, p.sliderMax), 0, 100)}%`);
    };

    const begin = () => {
        if (startValue === undefined) startValue = node._gs?.widget?.value;
    };
    const commit = () => {
        if (startValue === undefined || !node._gs?.widget) return;
        const oldValue = startValue;
        startValue = undefined;
        setSliderValue(node, node._gs.widget.value, {
            notify: true,
            oldValue,
            surface: "dom",
        });
    };

    range.addEventListener("pointerdown", begin);
    range.addEventListener("keydown", begin);
    range.addEventListener("input", () => {
        begin();
        const p = node.properties;
        const value = calcValue(
            Number(range.value),
            p.sliderMin,
            p.sliderMax,
            p.sliderStep,
            p.sliderType === "int"
        );
        setSliderValue(node, value, { notify: false, surface: "dom" });
    });
    range.addEventListener("pointerup", commit);
    range.addEventListener("pointercancel", commit);
    range.addEventListener("change", commit);
    range.addEventListener("blur", commit);

    const setValueFromPointer = (event) => {
        const rect = root.getBoundingClientRect();
        const padding = 14;
        const usableWidth = Math.max(1, rect.width - padding * 2);
        const ratio = clamp((event.clientX - rect.left - padding) / usableWidth, 0, 1);
        const p = node.properties;
        const value = calcValue(
            p.sliderMin + ratio * (p.sliderMax - p.sliderMin),
            p.sliderMin,
            p.sliderMax,
            p.sliderStep,
            p.sliderType === "int"
        );
        range.value = String(value);
        range.dispatchEvent(new Event("input", { bubbles: true }));
    };

    root.addEventListener("pointerdown", (event) => {
        if (event.button !== 0 || (event.target !== sliderHit && event.target !== range)) return;
        expandedDragging = true;
        begin();
        setValueFromPointer(event);
        root.setPointerCapture?.(event.pointerId);
        event.preventDefault();
        event.stopPropagation();
    });
    root.addEventListener("pointermove", (event) => {
        if (!expandedDragging) return;
        setValueFromPointer(event);
        event.preventDefault();
    });
    const finishExpandedDrag = (event) => {
        if (!expandedDragging) return;
        expandedDragging = false;
        root.releasePointerCapture?.(event.pointerId);
        commit();
    };
    root.addEventListener("pointerup", finishExpandedDrag);
    root.addEventListener("pointercancel", finishExpandedDrag);

    const domWidget = node.addDOMWidget("ghs_dom", "goohai_slider_dom", root, {
        getValue: () => String(node._gs?.widget?.value ?? ""),
        setValue: (value) => {
            const numeric = Number(value);
            if (!Number.isNaN(numeric) && node._gs?.widget) {
                setSliderValue(node, numeric, { notify: false, surface: "dom" });
            }
        },
        getHeight: () => 60,
        getMinHeight: () => 60,
        getMaxHeight: () => 60,
        hideOnZoom: false,
    });
    domWidget.serialize = false;
    if (domWidget.visibility?.surfaces) {
        domWidget.visibility.surfaces.canvas = "never";
        domWidget.visibility.surfaces.panel = "never";
        domWidget.visibility.surfaces.vueNode = "shown";
    }

    node._gs.syncDom = sync;
    sync();
    return domWidget;
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

    node._gs = {
        widget: dw,
        outputTypeWidget: outputTypeWidget,
        _redrawPending: false,
        _redrawSurface: null,
        syncDom: null,
        domWidget: null,
    };

    syncWidgetType(node);
    syncOutputType(node);

    node._gs.domWidget = setupSliderDom(node);

    /* 监听外部值变化 */
    const origCB = node.onWidgetChanged;
    node.onWidgetChanged = function (name, value, oldValue, widget) {
        if (origCB) origCB.call(this, name, value, oldValue, widget);
        if (name === "值") updateVis(this);
    };

    /* 节点宽度 */
    node.size[0] = GOOHAI_NODE_WIDTH;
    node.size[1] = GOOHAI_NODE_HEIGHT;
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
                setSliderValue(this, calcValue(w.value, p.sliderMin, p.sliderMax, p.sliderStep, isInt), { notify: false });
            }

            syncWidgetType(this);
            syncOutputType(this);
            updateVis(this);
            this._gs.syncDom?.();
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
