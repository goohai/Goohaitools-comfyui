/**
 * COLOR Widget for ComfyUI
 *
 * This integration script is licensed under the GNU General Public License v3.0 (GPL-3.0).
 * If you incorporate or modify this code, please credit AILab as the original source:
 * https://github.com/1038lab
 */

import { app } from "/scripts/app.js";
import { installNativeNodePointerBridge } from "./goohai_dom_native_interaction.js";

const COLOR_CONTROL_HEIGHT = 20;
const COLOR_WIDGET_GAP = 4;
const COLOR_WIDGET_HEIGHT = COLOR_CONTROL_HEIGHT + COLOR_WIDGET_GAP;
const COLOR_DOM_STYLE_ID = "goohai-color-dom-css";

if (!document.getElementById(COLOR_DOM_STYLE_ID)) {
    const style = document.createElement("style");
    style.id = COLOR_DOM_STYLE_ID;
    style.textContent = `
.gh-color-dom{position:relative;width:100%;height:24px;min-height:24px;max-height:24px;flex:0 0 24px!important;box-sizing:border-box;display:flex;align-items:flex-start;justify-content:center;padding:0 15px;overflow:hidden;user-select:none;cursor:pointer}
.gh-color-dom-preview{width:100%;height:20px;box-sizing:border-box;display:flex;align-items:center;justify-content:center;border:1px solid #555;border-radius:10px;overflow:hidden;font:12px sans-serif;white-space:nowrap;text-overflow:ellipsis;transition:filter .12s ease,border-color .12s ease}
.gh-color-dom:hover .gh-color-dom-preview{filter:brightness(1.08);border-color:#888}
.gh-color-dom-picker{position:absolute;left:50%;top:20px;transform:translateX(-50%);width:2px;height:2px;opacity:.01;pointer-events:none;border:0}
    `;
    document.head.appendChild(style);
}

const normalizeColor = (value, fallback = "#222222") =>
    typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value) ? value : fallback;

const getContrastTextColor = (hexColor) => {
    const hex = normalizeColor(hexColor).slice(1);
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return luminance > 0.5 ? "#333333" : "#cccccc";
};

const notifyColorChange = (node, name, widget, value, previousValue) => {
    if (value === previousValue) return;
    widget.value = value;
    widget.callback?.(value, app.canvas, node);
    node.onWidgetChanged?.(name, value, previousValue, widget);
    if (node.graph?.incrementVersion) node.graph.incrementVersion();
    else if (node.graph) node.graph._version = (node.graph._version || 0) + 1;
    node.setDirtyCanvas?.(true, true);
};

const createColorDomWidget = (node, inputName, inputData) => {
    const initialColor = normalizeColor(inputData?.[1]?.default || "#222222");
    let currentColor = initialColor;
    let committedColor = currentColor;

    const root = document.createElement("div");
    root.className = "gh-color-dom";
    const preview = document.createElement("div");
    preview.className = "gh-color-dom-preview";
    const picker = document.createElement("input");
    picker.className = "gh-color-dom-picker";
    picker.type = "color";
    picker.tabIndex = -1;
    root.append(preview, picker);

    const syncPreview = () => {
        currentColor = normalizeColor(currentColor, initialColor);
        picker.value = currentColor;
        preview.style.backgroundColor = currentColor;
        preview.style.color = getContrastTextColor(currentColor);
        preview.textContent = `${inputName} (${currentColor})`;
    };

    let domWidget = null;
    const getControlHeight = () => Math.max(
        COLOR_CONTROL_HEIGHT,
        Math.ceil(preview.offsetHeight || preview.scrollHeight || 0)
    );
    const getLayoutHeight = () => getControlHeight() + COLOR_WIDGET_GAP;

    const openPicker = () => {
        picker.value = currentColor;
        const rect = preview.getBoundingClientRect();
        const spaceAbove = rect.top;
        const spaceBelow = window.innerHeight - rect.bottom;
        const openAbove = spaceBelow < 320 && spaceAbove > spaceBelow;
        picker.style.top = openAbove ? "-8px" : `${rect.height}px`;
        try { picker.showPicker?.(); } catch (_) { picker.click(); }
    };
    installNativeNodePointerBridge(root, {
        getWidget: () => domWidget,
        shouldForwardLeft: () => true,
        onTap: openPicker,
    });
    root.addEventListener("contextmenu", (event) => {
        if (!app.canvas) return;
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        app.canvas.adjustMouseEvent?.(event);
        app.canvas.processContextMenu?.(node, event);
    }, true);
    picker.addEventListener("input", () => {
        const nextColor = normalizeColor(picker.value, currentColor);
        if (nextColor === currentColor) return;
        currentColor = nextColor;
        syncPreview();
        domWidget?.callback?.(currentColor, app.canvas, node);
    });
    picker.addEventListener("change", () => {
        currentColor = normalizeColor(picker.value, currentColor);
        syncPreview();
        const previousColor = committedColor;
        committedColor = currentColor;
        notifyColorChange(node, inputName, domWidget, currentColor, previousColor);
    });

    domWidget = node.addDOMWidget(inputName, "ghcolor_dom", root, {
        getValue: () => currentColor,
        setValue: (value) => {
            currentColor = normalizeColor(value, currentColor);
            committedColor = currentColor;
            syncPreview();
        },
        margin: 0,
        getHeight: getLayoutHeight,
        getMinHeight: getLayoutHeight,
        getMaxHeight: getLayoutHeight,
        hideOnZoom: false,
    });
    // Let LiteGraph place this widget in the same layout flow as native
    // widgets; each frontend version can apply its own standard widget gap.
    domWidget.computeSize = (width) => [width ?? node.size?.[0] ?? 0, getControlHeight()];
    domWidget.value = currentColor;
    if (domWidget.visibility?.surfaces) {
        domWidget.visibility.surfaces.canvas = "never";
        domWidget.visibility.surfaces.panel = "never";
        domWidget.visibility.surfaces.vueNode = "shown";
    }
    syncPreview();
    return domWidget;
};

app.registerExtension({
    name: "Goohai.colorWidget",
    getCustomWidgets() {
        return {
            GHCOLOR: (node, inputName, inputData) => ({
                widget: createColorDomWidget(node, inputName, inputData),
                minWidth: 150,
                minHeight: COLOR_WIDGET_HEIGHT,
            }),
        };
    },
});
