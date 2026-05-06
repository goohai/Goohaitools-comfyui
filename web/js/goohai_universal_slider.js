import { app } from "../../../scripts/app.js";

// ═══════════════════════════════════════════════
//  孤海万能滑条 · Goohai Universal Slider
// ═══════════════════════════════════════════════

// ── 注入 CSS ──────────────────────────────────
(function () {
    const ID = "goohai-us-css";
    if (document.getElementById(ID)) return;
    const s = document.createElement("style");
    s.id = ID;
    s.textContent = /* css */ `
/* ── 滑条主体 ── */
.ghs-wrap{
    position:relative;
    padding:14px 14px 0;box-sizing:border-box;
    margin-bottom:-3px;
    user-select:none;-webkit-user-select:none;
    --gs-c:#e8c547;
    margin-top:-16px;
}

/* ── 固定居中标签容器 ── */
.ghs-lbl-center{
    position:absolute;
    top:0;left:50%;transform:translateX(-50%);
    font-family:'Segoe UI','Helvetica Neue',Arial,'PingFang SC','Microsoft YaHei',sans-serif;
    white-space:nowrap;
    pointer-events:none;
    z-index:3;
    text-shadow:0 1px 3px rgba(0,0,0,.6);
}
/* 名称部分：16px，固定颜色，不加粗 */
.ghs-lbl-name{
    font-size:16px;
    color:#B2B7BD;
    font-weight:400;
}
/* 数值部分：20px，使用滑条颜色，加粗 */
.ghs-lbl-val{
    font-size:20px;
    color:var(--gs-c);
    font-weight:700;
}

/* ── 轨道 10px ── */
.ghs-track{
    position:relative;height:10px;background:#1a1a1a;
    border-radius:6px;cursor:pointer;
    box-shadow:inset 0 1px 2px rgba(0,0,0,.5);
    margin-top:22px;
}
.ghs-track::after{content:'';position:absolute;inset:-20px 0}

.ghs-glow{
    position:absolute;inset:0;border-radius:3px;
    background:var(--gs-c);opacity:.2;filter:blur(5px);
    pointer-events:none;
}
.ghs-fill{
    position:absolute;left:0;top:0;bottom:0;border-radius:6px;
    background:var(--gs-c);pointer-events:none;
}
/* ── 圆点 16px ── */
.ghs-thumb{
    position:absolute;top:50%;width:16px;height:16px;
    background:#f5f0e8;border:2px solid var(--gs-c);border-radius:50%;
    transform:translate(-50%,-50%);cursor:grab;
    box-shadow:0 1px 4px rgba(0,0,0,.4);
    transition:box-shadow .12s ease;z-index:2;
}
.ghs-thumb:hover{
    box-shadow:0 2px 8px rgba(0,0,0,.5);
}
.ghs-thumb._drag{
    cursor:grabbing;
    box-shadow:0 0 0 5px rgba(232,197,71,.12),0 2px 8px rgba(0,0,0,.5);
}

/* ── 设置窗口 ── */
.ghs-overlay{
    position:fixed;inset:0;background:rgba(0,0,0,.55);
    backdrop-filter:blur(3px);z-index:100000;
    display:flex;justify-content:center;align-items:center;
    animation:ghsIn .15s ease;
}
@keyframes ghsIn{from{opacity:0}to{opacity:1}}
@keyframes ghsPop{
    from{opacity:0;transform:translateY(-8px) scale(.97)}
    to{opacity:1;transform:translateY(0) scale(1)}
}
.ghs-panel{
    background:#1c1c1e;border:1px solid #333;border-radius:14px;
    padding:28px 32px;min-width:380px;
    box-shadow:0 24px 80px rgba(0,0,0,.6);
    animation:ghsPop .2s ease;
    font-family:'Segoe UI',system-ui,-apple-system,sans-serif;
    --gs-c:#e8c547;
}
.ghs-ptitle{font-size:16px;font-weight:700;color:#eee;margin-bottom:22px}
.ghs-row{display:flex;align-items:center;margin-bottom:14px}
.ghs-rlbl{width:72px;font-size:12.5px;color:#999;flex-shrink:0}
.ghs-inp{
    flex:1;background:#2a2a2c;border:1px solid #3a3a3c;border-radius:8px;
    padding:8px 12px;color:#eee;font-size:13px;outline:none;
    transition:border-color .2s;font-family:inherit;
}
.ghs-inp:focus{border-color:var(--gs-c)}
.ghs-sel{
    flex:1;background:#2a2a2c;border:1px solid #3a3a3c;border-radius:8px;
    padding:8px 12px;color:#eee;font-size:13px;outline:none;cursor:pointer;
    transition:border-color .2s;
}
.ghs-sel:focus{border-color:var(--gs-c)}
.ghs-sel option{background:#2a2a2c;color:#eee}
.ghs-clr{
    width:48px;height:34px;padding:2px;border-radius:8px;
    border:1px solid #3a3a3c;background:#2a2a2c;cursor:pointer;
}
.ghs-btns{display:flex;justify-content:flex-end;gap:10px;margin-top:22px}
.ghs-btn{
    padding:8px 22px;border-radius:8px;border:none;cursor:pointer;
    font-size:13px;font-weight:500;transition:all .15s;font-family:inherit;
}
.ghs-bx{background:#2a2a2c;color:#aaa;border:1px solid #3a3a3c}
.ghs-bx:hover{background:#333;color:#ccc}
.ghs-bok{background:var(--gs-c);color:#111;font-weight:600}
.ghs-bok:hover{filter:brightness(1.12)}

/* ── Radio 按钮样式 ── */
.ghs-radio-wrap{
    flex:1;display:flex;gap:20px;align-items:center;
}
.ghs-radio-label{
    display:flex;align-items:center;gap:6px;
    cursor:pointer;color:#eee;font-size:13px;
    padding:6px 12px;border-radius:6px;
    background:#2a2a2c;border:1px solid #3a3a3c;
    transition:all .15s;
}
.ghs-radio-label:hover{
    border-color:var(--gs-c);
}
.ghs-radio-label input[type="radio"]{
    appearance:none;-webkit-appearance:none;
    width:16px;height:16px;border:2px solid #555;
    border-radius:50%;cursor:pointer;
    transition:all .15s;position:relative;
}
.ghs-radio-label input[type="radio"]:checked{
    border-color:var(--gs-c);
}
.ghs-radio-label input[type="radio"]:checked::after{
    content:'';position:absolute;
    top:50%;left:50%;transform:translate(-50%,-50%);
    width:8px;height:8px;border-radius:50%;
    background:var(--gs-c);
}
    `;
    document.head.appendChild(s);
})();

// ── 工具函数 ──────────────────────────────────
const pct   = (v, mn, mx) => { const r = mx - mn; return r > 0 ? ((v - mn) / r) * 100 : 0; };
const clamp = (v, mn, mx) => Math.max(mn, Math.min(mx, v));
const snap  = (v, mn, step) => step > 0 ? Math.round((v - mn) / step) * step + mn : v;
const fmt   = (v, isInt) => isInt ? String(Math.round(v)) : v.toFixed(2);

/**
 * 将值按类型转换：整数模式返回纯整数，浮点模式返回两位小数浮点数
 * 确保序列化到 Python 侧时类型正确
 */
function castVal(v, isInt) {
    if (isInt) {
        return parseInt(Math.round(v), 10);
    }
    return parseFloat(v.toFixed(2));
}

// ── 刷新滑条视觉 ─────────────────────────────
function updateVis(n) {
    const g = n._gs;
    if (!g) return;
    const p     = n.properties;
    const v     = g.widget ? g.widget.value : 0;
    const isInt = p.sliderType === "int";
    const w     = clamp(pct(v, p.sliderMin, p.sliderMax), 0, 100);

    g.fill.style.width  = w + "%";
    g.glow.style.width  = w + "%";
    g.thumb.style.left  = w + "%";

    g.nameEl.textContent    = p.sliderLabel;
    g.valTextEl.textContent = " " + fmt(v, isInt);
}

/**
 * 同步 widget 的类型标记与当前值
 * 使 ComfyUI 序列化时按正确类型输出
 */
function syncWidgetType(node) {
    const g = node._gs;
    if (!g || !g.widget) return;
    const p     = node.properties;
    const isInt = p.sliderType === "int";

    /* 修改 widget 类型标记，影响序列化行为 */
    g.widget.type = isInt ? "INT" : "FLOAT";

    /* 确保当前值也是正确的类型 */
    let v = g.widget.value;
    v = clamp(v, p.sliderMin, p.sliderMax);
    v = isInt ? Math.round(v) : parseFloat(v.toFixed(2));
    g.widget.value = v;
}

/**
 * 同步隐藏的 output_type widget，使 Python 端收到正确的输出类型
 */
function syncOutputType(node) {
    const g = node._gs;
    if (!g || !g.outputTypeWidget) return;
    const isInt = node.properties.sliderType === "int";
    g.outputTypeWidget.value = isInt ? "int" : "float";
}

// ── 设置选项 ─────────────────────────────────
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
    title.textContent = "滑条设置";
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

    // ========== 滑条颜色 ==========
    const clrI = document.createElement("input");
    clrI.className = "ghs-clr";
    clrI.type = "color";
    clrI.value = p.sliderColor;
    addRow("滑条颜色", clrI);

    // ========== 数值类型 ==========
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

        radio.addEventListener("change", () => {
            if (radio.checked) {
                selectedType = opt.v;
            }
        });

        const text = document.createTextNode(opt.t);
        label.append(radio, text);
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
        let type  = selectedType;  // 使用 radio 选中的值
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

        /* 不修改输出端类型，保持 Python 节点原始的 * 任意类型 */
        node._gs.container.style.setProperty("--gs-c", color);

        /* 钳制并转换当前值 */
        const w = node._gs.widget;
        if (w) {
            let v = clamp(w.value, mn, mx);
            v = type === "int" ? Math.round(v) : snap(v, mn, step);
            v = clamp(v, mn, mx);
            w.value = v;
        }

        /* 同步 widget 类型标记 */
        syncWidgetType(node);

        /* 同步 output_type 隐藏 widget */
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

// ── 初始化滑条 ────────────────────────────────
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

    /* ── 关键：主动创建 output_type 隐藏 widget ── */
    let outputTypeWidget = node.widgets
        ? node.widgets.find((w) => w.name === "output_type")
        : null;
    if (!outputTypeWidget) {
        node.addWidget(
            "combo",
            "output_type",
            isInt ? "int" : "float",
            function () {},
            { values: ["float", "int"] }
        );
        outputTypeWidget = node.widgets
            ? node.widgets.find((w) => w.name === "output_type")
            : null;
    }
    if (outputTypeWidget) {
        outputTypeWidget.value       = isInt ? "int" : "float";
        outputTypeWidget.type        = "hidden";
        outputTypeWidget.hidden      = true;
        outputTypeWidget.computeSize = () => [0, 0];
        outputTypeWidget.draw        = function () {};
        outputTypeWidget.mouse       = function () { return false; };
    }

    /* ── 节点外观 ── */
    node.color   = "#2D384D";
    node.bgcolor = "#2D384D";

    /* ── 覆盖标题渲染 ── */
    const origFG = node.onDrawForeground;
    node.onDrawForeground = function (ctx) {
        const th = (typeof LiteGraph !== "undefined" && LiteGraph.NODE_TITLE_HEIGHT) || 30;
        const r  = (typeof LiteGraph !== "undefined" && LiteGraph.NODE_ROUND_RADIUS) || 24;
        const w  = this.size[0];
        const x  = 0;
        const y  = -th;
        const fw = w;
        const fh = th + 2;

        /* 使用带圆角的路径（仅上方两角圆角，下方直角）来覆盖标题区域 */
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
        ctx.fillStyle = "#2D384D";
        ctx.fill();
        ctx.restore();

        ctx.save();
        ctx.font         = "20px 'Segoe UI','PingFang SC','Microsoft YaHei',sans-serif";
        ctx.fillStyle    = "#E3E3E3";
        ctx.textAlign    = "center";
        ctx.textBaseline = "top";
        ctx.fillText(this.title || "", w / 2, -th + 12);
        ctx.restore();
        if (origFG) origFG.call(this, ctx);
    };

    /* ── 构建 DOM ── */
    const wrap = document.createElement("div");
    wrap.className = "ghs-wrap";
    wrap.style.setProperty("--gs-c", p.sliderColor);

    const lblEl = document.createElement("div");
    lblEl.className = "ghs-lbl-center";

    const nameEl = document.createElement("span");
    nameEl.className = "ghs-lbl-name";
    nameEl.textContent = p.sliderLabel;

    const valTextEl = document.createElement("span");
    valTextEl.className = "ghs-lbl-val";
    const initVal = dw ? dw.value : 0.5;
    valTextEl.textContent = " " + fmt(initVal, isInt);

    lblEl.append(nameEl, valTextEl);
    wrap.appendChild(lblEl);

    const track   = document.createElement("div");
    track.className = "ghs-track";
    const initPct = pct(initVal, p.sliderMin, p.sliderMax);

    const glow  = document.createElement("div");
    glow.className = "ghs-glow";
    glow.style.width = initPct + "%";

    const fill  = document.createElement("div");
    fill.className = "ghs-fill";
    fill.style.width = initPct + "%";

    const thumb = document.createElement("div");
    thumb.className = "ghs-thumb";
    thumb.style.left = initPct + "%";

    track.append(glow, fill, thumb);
    wrap.appendChild(track);

    node._gs = {
        container: wrap, widget: dw, outputTypeWidget: outputTypeWidget,
        fill, glow, thumb, nameEl, valTextEl, track,
        dragging: false,
    };

    /* 同步 widget 类型标记 */
    syncWidgetType(node);

    /* 同步 output_type 隐藏 widget */
    syncOutputType(node);

    /* ── 交互逻辑 ── */
    function valFromEvt(e) {
        const rect = track.getBoundingClientRect();
        const x = clamp((e.clientX - rect.left) / rect.width, 0, 1);
        let v = p.sliderMin + x * (p.sliderMax - p.sliderMin);
        v = isInt ? Math.round(v) : snap(v, p.sliderMin, p.sliderStep);
        return clamp(v, p.sliderMin, p.sliderMax);
    }

    function setVal(v) {
        if (dw) {
            v = castVal(v, isInt);
            dw.value = v;
        }
        updateVis(node);
        node.setDirtyCanvas(true, false);
    }

    /* 拖拽 —— 仅左键触发 */
    track.addEventListener("mousedown", (e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        node._gs.dragging = true;
        thumb.classList.add("_drag");
        glow.style.filter = "none";
        setVal(valFromEvt(e));

        function onMove(e2) {
            if (!node._gs.dragging) return;
            setVal(valFromEvt(e2));
        }
        function onUp() {
            node._gs.dragging = false;
            thumb.classList.remove("_drag");
            glow.style.filter = "blur(5px)";
            document.removeEventListener("mousemove", onMove);
            document.removeEventListener("mouseup", onUp);
            node.setDirtyCanvas(true, true);
        }
        document.addEventListener("mousemove", onMove);
        document.addEventListener("mouseup", onUp);
    });

    /* 双击打开设置 */
    wrap.addEventListener("dblclick", (e) => {
        e.preventDefault();
        e.stopPropagation();
        showSettings(node);
    });

    /* 右键打开设置 */
    wrap.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        e.stopPropagation();
        showSettings(node);
    });

    track.addEventListener("contextmenu", (e) => e.preventDefault());

    /* 挂载 DOM Widget */
    node.addDOMWidget("ghs_ui", "goohai_slider", wrap, { serialize: false });

    /* 监听外部值变化 */
    const origCB = node.onWidgetChanged;
    node.onWidgetChanged = function (name, value, widget) {
        if (origCB) origCB.call(this, name, value, widget);
        if (name === "值") updateVis(this);
    };

    // ── 宽度和高度各增加 10% ──
    const newWidth  = Math.round(Math.max(node.size[0], 220) * 1.1);
    const newHeight = Math.round(node.size[1] * 1.1);
    node.setSize([newWidth, newHeight]);
}

// ── 注册扩展 ──────────────────────────────────
app.registerExtension({
    name: "goohai.universal.slider",

    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name !== "GoohaiUniversalSlider") return;

        /* ── 圆角 24 ── */
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
                    LiteGraph.NODE_ROUND_RADIUS = 24;
                    origDrawNode.call(this, node, ctx, ...args);
                    LiteGraph.NODE_ROUND_RADIUS = origR;
                } else {
                    origDrawNode.call(this, node, ctx, ...args);
                }
            };
        }

        /* 节点创建 */
        const onCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            const r = onCreated ? onCreated.apply(this, arguments) : undefined;
            setupSlider(this);
            return r;
        };

        /* 加载存档后恢复 */
        const onConfigure = nodeType.prototype.configure;
        nodeType.prototype.configure = function (info) {
            if (onConfigure) onConfigure.apply(this, arguments);
            if (!this._gs) return;
            const p = this.properties;

            this.color   = "#2D384D";
            this.bgcolor = "#2D384D";

            this._gs.container.style.setProperty("--gs-c", p.sliderColor);

            /* 不修改输出端类型 */
            const w = this._gs.widget;
            if (w) {
                let v = clamp(w.value, p.sliderMin, p.sliderMax);
                v = p.sliderType === "int"
                    ? Math.round(v)
                    : snap(v, p.sliderMin, p.sliderStep);
                w.value = clamp(v, p.sliderMin, p.sliderMax);
            }

            /* 同步 widget 类型标记 */
            syncWidgetType(this);

            /* 同步 output_type 隐藏 widget */
            syncOutputType(this);

            updateVis(this);
        };

        /* 双击打开设置 */
        const onDblClick = nodeType.prototype.onDblClick;
        nodeType.prototype.onDblClick = function (e, pos) {
            if (pos && pos[1] > (this.titleHeight || 30)) {
                showSettings(this);
                return true;
            }
            if (onDblClick) return onDblClick.apply(this, arguments);
        };

        /* 右键打开设置 */
        const onContextMenu = nodeType.prototype.onContextMenu;
        nodeType.prototype.onContextMenu = function (e, pos) {
            if (pos && pos[1] > (this.titleHeight || 30)) {
                showSettings(this);
                e.preventDefault();
                return true;
            }
            if (onContextMenu) return onContextMenu.apply(this, arguments);
        };
    },
});
