import { app } from "../../../scripts/app.js";
import { installNativeNodePointerBridge } from "./goohai_dom_native_interaction.js";

const BOOL_WIDGET_HEIGHT = 48;
const GOOHAI_NODE_WIDTH = 350;
const GOOHAI_NODE_HEIGHT = 100;

(function () {
    const ID = "goohai-bool-dom-css";
    if (document.getElementById(ID)) return;
    const style = document.createElement("style");
    style.id = ID;
    style.textContent = `
.ghb-dom{width:100%;height:48px;min-height:48px;max-height:48px;flex:0 0 48px!important;box-sizing:border-box;display:flex;align-items:center;gap:16px;padding:4px 14px;transform:translateY(-8px);user-select:none;pointer-events:auto;overflow:hidden}
.ghb-dom-label{flex:1;min-width:0;text-align:center;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font:bold 24px 'Segoe UI','PingFang SC','Microsoft YaHei',sans-serif;color:#e0e0e0;line-height:1}
.ghb-dom-toggle{position:relative;flex:0 0 auto;width:72px;height:28px;padding:0;border:0;border-radius:14px;background:#606060;box-shadow:none;cursor:pointer;outline:none;transition:background-color .12s ease,box-shadow .12s ease}
.ghb-dom-toggle[data-on="true"]{background:#4caf50;box-shadow:0 0 10px rgba(76,175,80,.35)}
.ghb-dom-knob{position:absolute;top:3px;left:3px;width:22px;height:22px;border-radius:50%;background:#999;box-shadow:0 1px 4px rgba(0,0,0,.35);transition:transform .12s ease,background-color .12s ease}
.ghb-dom-toggle[data-on="true"] .ghb-dom-knob{transform:translateX(44px);background:#fff}
.ghb-dom-edit{flex:1;min-width:0;height:32px;box-sizing:border-box;border:1px solid #777;border-radius:6px;background:#2a2a2a;color:#eee;text-align:center;font:bold 20px 'Segoe UI','PingFang SC','Microsoft YaHei',sans-serif;outline:none}
    `;
    document.head.appendChild(style);
})();

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
 *  构建 Legacy / Nodes 2.0 共用的 DOM 开关
 * ──────────────────────────────────────────────────────────── */
function buildCustomSwitch(node) {
    const boolWidget = node.widgets?.find((w) => w.name === "开关");
    if (!boolWidget) return;

    boolWidget.hidden = true;

    let isOn = !!boolWidget.value;
    let labelText = (node.properties && node.properties.guhai_label) || "开关";
    let domWidget = null;
    let domLabel = null;
    let domToggle = null;
    let redrawPending = false;

    function redraw(surface = "both") {
        if (redrawPending) return;
        redrawPending = true;
        requestAnimationFrame(() => {
            redrawPending = false;
            if (surface !== "dom") node.setDirtyCanvas(true, false);
        });
    }

    function syncDom() {
        if (!domLabel || !domToggle) return;
        domLabel.textContent = labelText;
        domToggle.dataset.on = String(isOn);
        domToggle.setAttribute("aria-checked", String(isOn));
    }

    function setBoolValue(value, notify = true, surface = "both") {
        const nextValue = !!value;
        const oldValue = boolWidget.value;
        isOn = nextValue;
        boolWidget.value = nextValue;
        syncDom();

        if (notify && oldValue !== nextValue) {
            boolWidget.callback?.(nextValue, app.canvas, node);
            node.onWidgetChanged?.(boolWidget.name, nextValue, oldValue, boolWidget);
            node.graph?.incrementVersion?.();
        }
        redraw(surface);
    }

    if (typeof node.addDOMWidget === "function") {
        const root = document.createElement("div");
        root.className = "ghb-dom";
        root.addEventListener("contextmenu", (event) => {
            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation();
            app.canvas?.adjustMouseEvent?.(event);
            app.canvas?.processContextMenu?.(node, event);
        }, true);
        domLabel = document.createElement("span");
        domLabel.className = "ghb-dom-label";
        domToggle = document.createElement("button");
        domToggle.className = "ghb-dom-toggle";
        domToggle.type = "button";
        domToggle.setAttribute("role", "switch");
        const knob = document.createElement("span");
        knob.className = "ghb-dom-knob";
        domToggle.appendChild(knob);
        root.append(domLabel, domToggle);

        installNativeNodePointerBridge(root, {
            getWidget: () => domWidget,
            shouldForwardLeft: (event) => !event.target.closest?.(".ghb-dom-toggle,.ghb-dom-edit"),
        });

        domToggle.addEventListener("click", () => setBoolValue(!isOn, true, "dom"));
        domLabel.addEventListener("dblclick", (event) => {
            event.preventDefault();
            event.stopPropagation();
            const input = document.createElement("input");
            input.className = "ghb-dom-edit";
            input.value = labelText;
            domLabel.replaceWith(input);
            input.focus();
            input.select();
            const finish = () => {
                if (!input.isConnected) return;
                labelText = input.value.trim() || "开关";
                node.properties = node.properties || {};
                node.properties.guhai_label = labelText;
                input.replaceWith(domLabel);
                syncDom();
            };
            input.addEventListener("keydown", (event) => {
                if (event.key === "Enter" || event.key === "Escape") {
                    event.preventDefault();
                    finish();
                }
            });
            input.addEventListener("blur", finish);
        });

        domWidget = node.addDOMWidget("guhai_toggle_dom", "toggle_custom_dom", root, {
            getValue: () => String(boolWidget.value),
            setValue: (value) => setBoolValue(value === true || value === "true", false, "dom"),
            getHeight: () => BOOL_WIDGET_HEIGHT,
            getMinHeight: () => BOOL_WIDGET_HEIGHT,
            getMaxHeight: () => BOOL_WIDGET_HEIGHT,
            hideOnZoom: false,
        });
        domWidget.serialize = false;
        if (domWidget.visibility?.surfaces) {
            domWidget.visibility.surfaces.canvas = "never";
            domWidget.visibility.surfaces.panel = "never";
            domWidget.visibility.surfaces.vueNode = "shown";
        }
        syncDom();
    }

    node.size[0] = GOOHAI_NODE_WIDTH;
    node.size[1] = GOOHAI_NODE_HEIGHT;

    /* ── 工作流加载后同步 UI ── */
    node._guhaiSyncUI = () => {
        setBoolValue(boolWidget.value, false);
        labelText = (node.properties && node.properties.guhai_label) || "开关";
        redraw();
        syncDom();
    };
}
