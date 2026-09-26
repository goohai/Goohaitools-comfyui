/**
 * COLOR Widget for ComfyUI
 *
 * This integration script is licensed under the GNU General Public License v3.0 (GPL-3.0).
 * If you incorporate or modify this code, please credit AILab as the original source:
 * https://github.com/1038lab
 */

import { app } from "/scripts/app.js";

// Nodes 2.0 can temporarily pass the whole legacy-widget canvas height to
// draw(). The color control is a single row, so never let that transient
// height consume the widgets rendered below it.
const COLOR_WIDGET_HEIGHT = 24;

const getColorWidgets = (node) =>
    (node?.widgets ?? []).filter((widget) => widget?.type === 'GHCOLOR');

const syncColorWidgetLayout = (node) => {
    const widgets = getColorWidgets(node);
    if (!widgets.length) return;

    try {
        node.arrange?.();
    } catch (error) {
        console.debug('[Goohai.colorWidget] arrange failed:', error);
    }

    for (const widget of widgets) {
        // LiteGraph adds four pixels to fixed widget heights during arrange().
        widget.computedHeight = COLOR_WIDGET_HEIGHT + 4;
        widget.triggerDraw?.();
    }

    node.graph?.setDirtyCanvas?.(true, true);
    node.setDirtyCanvas?.(true, true);
};

const scheduleColorWidgetLayout = (node) => {
    if (!getColorWidgets(node).length) return;

    let frames = 0;
    const retry = () => {
        syncColorWidgetLayout(node);
        if (++frames < 4) requestAnimationFrame(retry);
    };

    requestAnimationFrame(retry);
    setTimeout(() => syncColorWidgetLayout(node), 250);
};

const getContrastTextColor = (hexColor) => {
    if (typeof hexColor !== 'string' || !/^#?[0-9a-fA-F]{6}$/.test(hexColor)) {
        return '#cccccc'; // fallback text color
    }

    const hex = hexColor.replace('#', '');
    const r = parseInt(hex.substr(0, 2), 16);
    const g = parseInt(hex.substr(2, 2), 16);
    const b = parseInt(hex.substr(4, 2), 16);
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;

    return luminance > 0.5 ? '#333333' : '#cccccc';
};

const getPointerPosition = (event) => {
    const source = event?.originalEvent ?? event?.event ?? event;
    const clientX = Number(source?.clientX);
    const clientY = Number(source?.clientY);
    if (Number.isFinite(clientX) && Number.isFinite(clientY)) {
        return { x: clientX, y: clientY };
    }

    const canvas = app.canvas?.canvas;
    const canvasRect = canvas?.getBoundingClientRect?.();
    const transform = app.canvas?.ds;
    const canvasX = Number(event?.canvasX ?? source?.canvasX);
    const canvasY = Number(event?.canvasY ?? source?.canvasY);
    if (!canvasRect || !Number.isFinite(canvasX) || !Number.isFinite(canvasY)) return null;

    const scale = Number(transform?.scale) || 1;
    const offsetX = Number(transform?.offset?.[0]) || 0;
    const offsetY = Number(transform?.offset?.[1]) || 0;
    return {
        x: canvasRect.left + (canvasX + offsetX) * scale,
        y: canvasRect.top + (canvasY + offsetY) * scale,
    };
};

const positionColorPicker = (picker, event) => {
    const point = getPointerPosition(event);
    if (!point) return;

    // Use the pointer's viewport coordinates directly. The same widget can be
    // rendered by LiteGraph or Nodes 2.0, so graph-space transforms are not a
    // reliable way to locate the color option on screen.
    picker.style.left = `${Math.max(4, Math.min(point.x - 1, window.innerWidth - 5))}px`;
    picker.style.top = `${Math.max(4, Math.min(point.y - 1, window.innerHeight - 5))}px`;
};

const AILabColorWidget = {
    GHCOLOR: (key, val) => {
        const widget = {};
        widget.y = 0;
        widget.name = key;
        widget.type = 'GHCOLOR';
        widget.options = { default: '#222222' };
        widget.value = typeof val === 'string' ? val : '#222222';
        // Nodes 2.0 wraps this callback to redraw the legacy widget's canvas.
        // Keep it defined from creation time so that wrapper is installed
        // before the color picker is opened.
        widget.callback = () => {};

        widget.draw = function (ctx, node, widgetWidth, widgetY, height) {
            const scale = Number(app.canvas?.ds?.scale) || 1;
            const hide = this.type !== 'GHCOLOR' && scale > 0.5;
            if (hide) {
                return;
            }

            const margin = 15;
            const radius = 12;
            const width = Math.max(0, Number(widgetWidth) || 0);
            const drawHeight = COLOR_WIDGET_HEIGHT;

            ctx.fillStyle = this.value;
            ctx.beginPath();
            const x = margin;
            const y = widgetY;
            const w = Math.max(0, width - margin * 2);
            const h = drawHeight;
            ctx.moveTo(x + radius, y);
            ctx.lineTo(x + w - radius, y);
            ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
            ctx.lineTo(x + w, y + h - radius);
            ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
            ctx.lineTo(x + radius, y + h);
            ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
            ctx.lineTo(x, y + radius);
            ctx.quadraticCurveTo(x, y, x + radius, y);
            ctx.closePath();
            ctx.fill();

            ctx.strokeStyle = '#555';
            ctx.lineWidth = 1;
            ctx.stroke();

            ctx.fillStyle = getContrastTextColor(this.value);
            ctx.font = '12px sans-serif';
            ctx.textAlign = 'center';

            const text = `${this.name} (${this.value})`;
            ctx.fillText(text, width * 0.5, widgetY + drawHeight * 0.65);
        };

        widget.mouse = function (e, pos, node) {
            if (e.type === 'pointerdown') {
                const margin = 15;

                if (pos[0] >= margin && pos[0] <= node.size[0] - margin) {
                    const picker = document.createElement('input');
                    picker.type = 'color';
                    picker.value = this.value;

                    picker.style.position = 'fixed';
                    picker.style.width = '2px';
                    picker.style.height = '2px';
                    picker.style.opacity = '0.01';
                    picker.style.pointerEvents = 'auto';
                    picker.style.zIndex = '2147483647';
                    positionColorPicker(picker, e);

                    document.body.appendChild(picker);

                    let notifiedValue = this.value;
                    let refreshTimer = null;
                    let refreshFrame = null;
                    let refreshPending = false;
                    let lastRefreshAt = 0;
                    const refreshInterval = 32;

                    const refreshColor = () => {
                        refreshTimer = null;
                        if (refreshFrame !== null) {
                            cancelAnimationFrame(refreshFrame);
                            refreshFrame = null;
                        }
                        if (!refreshPending) return;

                        refreshPending = false;
                        lastRefreshAt = performance.now();
                        // Nodes 2.0 wraps callback() with triggerDraw(). Keep
                        // this on a throttled path so pointer movement remains
                        // responsive without redrawing the whole node per event.
                        this.callback?.(this.value, app.canvas, node);
                        node.setDirtyCanvas(true, true);
                    };

                    const scheduleColorRefresh = () => {
                        refreshPending = true;
                        if (refreshTimer !== null || refreshFrame !== null) return;

                        const elapsed = performance.now() - lastRefreshAt;
                        const delay = Math.max(0, refreshInterval - elapsed);
                        refreshTimer = setTimeout(() => {
                            refreshTimer = null;
                            refreshFrame = requestAnimationFrame(refreshColor);
                        }, delay);
                    };

                    const flushColorRefresh = () => {
                        if (refreshTimer !== null) {
                            clearTimeout(refreshTimer);
                            refreshTimer = null;
                        }
                        refreshColor();
                    };

                    const cleanupColorRefresh = () => {
                        if (refreshTimer !== null) clearTimeout(refreshTimer);
                        if (refreshFrame !== null) cancelAnimationFrame(refreshFrame);
                        refreshTimer = null;
                        refreshFrame = null;
                        refreshPending = false;
                    };

                    const commitColorChange = () => {
                        if (notifiedValue === this.value) return;

                        const previousValue = notifiedValue;
                        notifiedValue = this.value;
                        node.graph._version++;
                        node.setDirtyCanvas(true, true);
                        node.onWidgetChanged?.(this.name, this.value, previousValue, this);
                    };

                    const updateColor = () => {
                        if (this.value === picker.value) return;

                        this.value = picker.value;
                        scheduleColorRefresh();
                    };

                    picker.addEventListener('input', updateColor);
                    picker.addEventListener('change', () => {
                        updateColor();
                        flushColorRefresh();
                        commitColorChange();
                        cleanupColorRefresh();
                        picker.remove();
                    });

                    try {
                        picker.showPicker?.();
                    } catch {
                        picker.click();
                    }
                    return true;
                }
            }
            return false;
        };

        widget.computeSize = function (width) {
            return [width, 24];
        };

        return widget;
    }
};

app.registerExtension({
    name: "Goohai.colorWidget",

    nodeCreated(node) {
        scheduleColorWidgetLayout(node);
    },

    loadedGraphNode(node) {
        scheduleColorWidgetLayout(node);
    },

    getCustomWidgets() {
        return {
            GHCOLOR: (node, inputName, inputData) => {
                return {
                    widget: node.addCustomWidget(
                        AILabColorWidget.GHCOLOR(inputName, inputData?.[1]?.default || '#222222')
                    ),
                    minWidth: 150,
                    minHeight: 24,
                };
            }
        };
    }
});
