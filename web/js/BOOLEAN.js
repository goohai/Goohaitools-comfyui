import { app } from "../../../scripts/app.js";

/* ═══════════════════════════════════════════════════════════
 *  布尔开关  —  替换 "布尔 孤海" 节点原生 checkbox
 *  仿手机 APP 胶囊开关，左侧可双击编辑名称
 * ═══════════════════════════════════════════════════════════ */

app.registerExtension({
    name: "goohaitools.bool_switch",

    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name !== "布尔孤海") return;

        const origOnCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            origOnCreated?.apply(this, arguments);
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
 *  构建自定义开关 DOM
 * ──────────────────────────────────────────────────────────── */
function buildCustomSwitch(node) {
    const boolWidget = node.widgets?.find((w) => w.name === "开关");
    if (!boolWidget) return;

    boolWidget.hidden = true;

    let isOn = !!boolWidget.value;

    // 从 node.properties 恢复持久化的标签文本（刷新后不丢失）
    let labelText = (node.properties && node.properties.guhai_label) || "开关";
    let activeInput = null; // 追踪当前编辑中的 input 实例

    /* ── 根容器 ── */
    const root = document.createElement("div");
    Object.assign(root.style, {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        width: "100%",
        padding: "4px 8px",
        boxSizing: "border-box",
    });

    /* ════════════════════════════════════════════════════════
     *  左侧 — 可编辑标签
     * ════════════════════════════════════════════════════════ */
    const label = document.createElement("span");
    label.textContent = labelText;
    Object.assign(label.style, {
        fontSize: "20px",
        fontWeight: "bold",
        fontFamily: "inherit",
        color: "#e0e0e0",
        cursor: "default",
        userSelect: "none",
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
        flex: "1",
        marginRight: "10px",
        lineHeight: "28px",
    });
    root.appendChild(label);

    /* ════════════════════════════════════════════════════════
     *  右侧 — 椭圆拨动开关
     * ════════════════════════════════════════════════════════ */
    const track = document.createElement("div");
    Object.assign(track.style, {
        position: "relative",
        width: "72px",
        height: "28px",
        borderRadius: "14px",
        cursor: "pointer",
        transition:
            "background 0.3s cubic-bezier(.4,0,.2,1), box-shadow 0.3s ease",
        flexShrink: "0",
    });

    const knob = document.createElement("div");
    Object.assign(knob.style, {
        position: "absolute",
        top: "3px",
        width: "22px",
        height: "22px",
        borderRadius: "50%",
        background: "#999999",
        transition: "left 0.3s cubic-bezier(.4,0,.2,1), background 0.3s ease",
        boxShadow: "0 1px 4px rgba(0,0,0,0.35)",
    });
    track.appendChild(knob);
    root.appendChild(track);

    /* ════════════════════════════════════════════════════════
     *  全局键盘监听（仅编辑期间生效）
     *  注册在 document 的 capturing 阶段，确保在 ComfyUI
     *  等框架拦截键盘事件之前就能捕获 Enter / Escape
     * ════════════════════════════════════════════════════════ */
    function onGlobalKeyDown(ev) {
        if (!activeInput) return;          // 非编辑状态，不拦截
        if (ev.key === "Enter" || ev.key === "Escape") {
            ev.stopImmediatePropagation();
            ev.preventDefault();
            finishEdit();
        }
    }

    /* ── 结束编辑（统一出口） ── */
    function finishEdit() {
        if (!activeInput) return;          // 防止重复调用

        // 1. 保存文本
        labelText = activeInput.value.trim() || "开关";
        label.textContent = labelText;

        // 2. 持久化到节点属性（工作流保存/刷新后可恢复）
        try {
            node.properties = node.properties || {};
            node.properties.guhai_label = labelText;
        } catch (_) { /* 忽略 */ }

        // 3. 移除 input、恢复 label
        activeInput.remove();
        activeInput = null;
        label.style.display = "";

        // 4. 解绑全局键盘监听
        document.removeEventListener("keydown", onGlobalKeyDown, true);
    }

    /* ── 双击编辑标签 ── */
    label.addEventListener("dblclick", (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (activeInput) return;           // 已在编辑中，忽略

        const input = document.createElement("input");
        input.type = "text";
        input.value = labelText;
        Object.assign(input.style, {
            fontSize: "20px",
            fontWeight: "bold",
            fontFamily: "inherit",
            color: "#e0e0e0",
            background: "#2a2a2a",
            border: "1px solid #555",
            borderRadius: "4px",
            padding: "1px 6px",
            outline: "none",
            width: "138px",
            boxSizing: "border-box",
            lineHeight: "28px",
        });

        activeInput = input;
        label.style.display = "none";
        root.insertBefore(input, track);

        // 等 DOM 更新完毕后再聚焦，避免与 mousedown 事件冲突
        requestAnimationFrame(() => {
            input.focus();
            input.select();
        });

        // 注册全局键盘监听（capturing 阶段）
        document.addEventListener("keydown", onGlobalKeyDown, true);

        // 失焦 = 点击了其他地方 → 自动确认
        input.addEventListener("blur", () => {
            // 延迟 50ms：让 click 等事件先处理完毕，避免竞态
            setTimeout(finishEdit, 50);
        });
    });

    /* ── 同步视觉状态 ── */
    function updateUI() {
        if (isOn) {
            track.style.background = "#4CAF50";
            track.style.boxShadow =
                "inset 0 1px 3px rgba(0,0,0,0.1), 0 0 10px rgba(76,175,80,0.35)";
            knob.style.left = "47px";
            knob.style.background = "#ffffff";
        } else {
            track.style.background = "#606060";
            track.style.boxShadow = "inset 0 1px 3px rgba(0,0,0,0.2)";
            knob.style.left = "3px";
            knob.style.background = "#999999";
        }
    }
    updateUI();

    /* ── 点击切换开关 ── */
    track.addEventListener("click", (e) => {
        e.stopPropagation();
        finishEdit();                      // 先结束可能存在的编辑
        isOn = !isOn;
        boolWidget.value = isOn;
        updateUI();
    });

    /* ════════════════════════════════════════════════════════
     *  注册 DOM Widget & 同步钩子
     *  锁定 widget 高度，防止节点拉高时开关跟随下移
     * ════════════════════════════════════════════════════════ */
    const toggleWidget = node.addDOMWidget("guhai_toggle", "guhai_toggle", root, {
        serialize: false,
    });

    // 节点拉高时，多余空间分配给底部空白，开关位置不变
    toggleWidget.computeSize = function () {
        return [this.width || 200, 36];
    };

    // 工作流加载后同步 UI（含标签文本恢复）
    node._guhaiSyncUI = () => {
        isOn = !!boolWidget.value;
        labelText = (node.properties && node.properties.guhai_label) || "开关";
        label.textContent = labelText;
        if (activeInput) finishEdit();     // 加载新工作流时清理残留编辑
        updateUI();
    };
}
