import { app } from "../../../scripts/app.js";

/* ═══════════════════════════════════════════════════════════
 *  布尔开关  —  替换 "布尔 孤海" 节点原生 checkbox
 * ═══════════════════════════════════════════════════════════ */

app.registerExtension({
    name: "goohaitools.bool_switch",

    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name !== "布尔孤海") return;

        const origOnCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            origOnCreated?.apply(this, arguments);

            /* ── 设置默认节点颜色（仅首次创建时） ── */
            this.color = "#4F4047";
            this.bgcolor = "#493C42";  
            buildCustomSwitch(this);
        };

        const origOnConfigure = nodeType.prototype.onConfigure;
        nodeType.prototype.onConfigure = function (info) {
            origOnConfigure?.apply(this, arguments);
            if (this._guhaiSyncUI) this._guhaiSyncUI();
        };
    },
});


/* ────────────────────────────────────────────────────────────
 *  构建自定义开关（Canvas 绘制，非 DOM）
 * ──────────────────────────────────────────────────────────── */
function buildCustomSwitch(node) {
    const boolWidget = node.widgets?.find((w) => w.name === "开关");
    if (!boolWidget) return;

    boolWidget.hidden = true;

    let isOn = !!boolWidget.value;
    let labelText = (node.properties && node.properties.guhai_label) || "开关";
    let lastClickTime = 0;
    let activeInput = null;
    let _w = 200, _y = 0, _h = 44;

    /* ── 圆角矩形辅助 ── */
    function rrect(ctx, x, y, w, h, r) {
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.arcTo(x + w, y, x + w, y + h, r);
        ctx.arcTo(x + w, y + h, x, y + h, r);
        ctx.arcTo(x, y + h, x, y, r);
        ctx.arcTo(x, y, x + w, y, r);
        ctx.closePath();
    }

    /* ── 文本截断辅助 ── */
    function ellipsis(ctx, text, maxW) {
        if (ctx.measureText(text).width <= maxW) return text;
        let t = text;
        while (t.length > 1 && ctx.measureText(t + "…").width > maxW) {
            t = t.slice(0, -1);
        }
        return t + "…";
    }

    /* ── 结束标签编辑 ── */
    function finishEdit() {
        if (!activeInput) return;
        labelText = activeInput.value.trim() || "开关";
        activeInput.remove();
        activeInput = null;
        try {
            node.properties = node.properties || {};
            node.properties.guhai_label = labelText;
        } catch (_) {}
    }

    /* ── 开始标签编辑 ── */
    function startLabelEdit(clientX, clientY) {
        if (activeInput) return;

        const scale = app.canvas?.ds?.scale ?? 1;
        const input = document.createElement("input");
        input.type = "text";
        input.value = labelText;
        Object.assign(input.style, {
            position: "fixed",
            left: clientX + "px",
            top: (clientY - 14 * scale) + "px",
            fontSize: Math.max(12, Math.round(20 * scale)) + "px",
            fontWeight: "bold",
            color: "#e0e0e0",
            background: "#2a2a2a",
            border: "1px solid #555",
            borderRadius: "4px",
            padding: "2px 6px",
            outline: "none",
            zIndex: "99999",
            minWidth: "80px",
        });

        document.body.appendChild(input);
        activeInput = input;

        requestAnimationFrame(() => {
            input.focus();
            input.select();
        });

        input.addEventListener("keydown", (ev) => {
            if (ev.key === "Enter" || ev.key === "Escape") {
                ev.preventDefault();
                ev.stopImmediatePropagation();
                finishEdit();
            }
        }, true);

        input.addEventListener("blur", () => {
            setTimeout(finishEdit, 50);
        });
    }

    /* ════════════════════════════════════════════════════════
     *  注册 Canvas 自定义 Widget
     * ════════════════════════════════════════════════════════ */
    node.addCustomWidget({
        name: "guhai_toggle",
        type: "toggle_custom",
        value: isOn,

        /* ── 每帧绘制 ── */
        draw(ctx, node, widgetWidth, y, H) {
            _w = widgetWidth;
            _y = y;
            _h = H;

            const m = 10;
            const yOff = 6;
            const xOff = 6;

            /* ─ 开关轨道 ─ */
            const tw = 72, th = 28;
            const tx = widgetWidth - tw - m - xOff;
            const ty = y + yOff + (H - th) / 2;

            /* ─ 标签文字：在按钮左侧区域内水平居中 ─ */
            const textAreaRight = tx - m;
            const textAreaCenter = (m + textAreaRight) / 2;
            const maxTextW = textAreaRight - m;

            ctx.font = "bold 24px sans-serif";
            ctx.fillStyle = "#e0e0e0";
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText(
                ellipsis(ctx, labelText, maxTextW),
                textAreaCenter,
                y + yOff + H / 2
            );

            /* ─ 开关轨道绘制 ─ */
            ctx.save();
            if (isOn) {
                ctx.shadowColor = "rgba(76,175,80,0.4)";
                ctx.shadowBlur = 10;
                ctx.fillStyle = "#4CAF50";
            } else {
                ctx.fillStyle = "#606060";
            }
            rrect(ctx, tx, ty, tw, th, th / 2);
            ctx.fill();
            ctx.restore();

            /* ─ 圆形旋钮 ─ */
            const kr = 11;
            const kx = isOn ? tx + tw - kr - 3 : tx + kr + 3;
            const ky = ty + th / 2;

            ctx.save();
            ctx.shadowColor = "rgba(0,0,0,0.3)";
            ctx.shadowBlur = 4;
            ctx.fillStyle = isOn ? "#ffffff" : "#999999";
            ctx.beginPath();
            ctx.arc(kx, ky, kr, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
        },

        /* ── 鼠标事件 ── */
        mouse(event, pos, node) {
            if (event.type !== "pointerdown" && event.type !== "mousedown") {
                return false;
            }

            const now = Date.now();
            const dbl = (now - lastClickTime) < 350;
            lastClickTime = now;

            /* 双击 → 编辑标签 */
            if (dbl) {
                startLabelEdit(event.clientX, event.clientY);
                return true;
            }

            /* 单击 → 切换开关 */
            const toggleStartX = _w - 72 - 10 - 20;
            if (pos[0] > toggleStartX) {
                isOn = !isOn;
                boolWidget.value = isOn;
                this.value = isOn;
                return true;
            }

            return false;
        },

        computeSize(width) {
            return [width, 44];
        },
    });

    /* ── 工作流加载后同步 UI ── */
    node._guhaiSyncUI = () => {
        isOn = !!boolWidget.value;
        labelText = (node.properties && node.properties.guhai_label) || "开关";
        if (activeInput) finishEdit();
    };
}
