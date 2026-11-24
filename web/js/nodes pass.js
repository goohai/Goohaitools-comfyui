import { app } from "../../../scripts/app.js";

const DEFAULT_ACCENT_COLOR = "#4c758a";

let _globalIgCounter = 0;
const _graphChangeListeners = new WeakMap();

function watchGraphChanges(graph, listener) {
    let entry = _graphChangeListeners.get(graph);
    if (!entry) {
        const original = graph.change;
        const listeners = new Set();
        const wrapped = function () {
            const result = original.apply(this, arguments);
            listeners.forEach(callback => callback());
            return result;
        };
        entry = { original, wrapped, listeners };
        _graphChangeListeners.set(graph, entry);
        graph.change = wrapped;
    }
    entry.listeners.add(listener);
    return () => {
        entry.listeners.delete(listener);
        if (!entry.listeners.size && graph.change === entry.wrapped) {
            graph.change = entry.original;
            _graphChangeListeners.delete(graph);
        }
    };
}


app.registerExtension({
    name: "goohaitools.ignore_groups",

    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name !== "忽略多组孤海") return;

        const origCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            origCreated?.apply(this, arguments);
            // ComfyUI applies its native light-theme adjustment to node colors.
            this.color   = this.color   || "#4d6574";
            this.bgcolor = this.bgcolor || "#395160";
            this.properties = this.properties || {};
            this.properties.guhai_ig_name_color ??= DEFAULT_ACCENT_COLOR;
            this.properties.guhai_ig_theme_mode ??= "dark";
            this.size = [400, this.size[1]];
            buildIgnoreGroupsUI(this);
        };

        const origConfigure = nodeType.prototype.onConfigure;
        nodeType.prototype.onConfigure = function (info) {
            origConfigure?.apply(this, arguments);
            if (this._guhaiSyncGroups) this._guhaiSyncGroups();
        };

        const origGetExtra = nodeType.prototype.getExtraMenuOptions;
        nodeType.prototype.getExtraMenuOptions = function (canvas, options) {
            if (origGetExtra) origGetExtra.apply(this, arguments);
            options.unshift({
                content: "🎮  忽略多组_孤海 设置",
                callback: () => {
                    if (this._guhaiShowSettings) {
                        this._guhaiShowSettings(
                            Math.round(innerWidth  / 2 - 130),
                            Math.round(innerHeight / 2 - 200)
                        );
                    }
                }
            });
        };
    },
});


function buildIgnoreGroupsUI(node) {

    const _uid = "gig_" + (++_globalIgCounter);
    const _styleId = "guhai-ig-dyn-" + _uid;


    let filter    = "";
    let mode      = "default";
    let active    = null;
    let activeSet = null;
    let nameColor = node.properties?.guhai_ig_name_color || DEFAULT_ACCENT_COLOR;
    let themeMode = node.properties?.guhai_ig_theme_mode === "light" ? "light" : "dark";
    let igDisable = false;
    let sortOrder     = "position";
    let selectedGroups = node.properties?.guhai_ig_selected_groups == null
        ? null : new Set(node.properties.guhai_ig_selected_groups);
    let updateQuickFilter = null;
    let uiScale       = 1.0;
    let childSelections = node.properties?.guhai_ig_child_selections || {};

    if (node.properties) {
        if (node.properties.guhai_ig_filter      != null) filter    = node.properties.guhai_ig_filter;
        if (node.properties.guhai_ig_mode        != null) mode      = node.properties.guhai_ig_mode;
        if (node.properties.guhai_ig_active      != null) active    = node.properties.guhai_ig_active;
        if (node.properties.guhai_ig_active_set  != null) activeSet = node.properties.guhai_ig_active_set;
        if (node.properties.guhai_ig_name_color  != null) nameColor = node.properties.guhai_ig_name_color;
        if (node.properties.guhai_ig_disable     != null) igDisable = !!node.properties.guhai_ig_disable;
        if (node.properties.guhai_ig_sort_order  != null) sortOrder   = node.properties.guhai_ig_sort_order;
        if (node.properties.guhai_ig_ui_scale    != null) uiScale    = Number(node.properties.guhai_ig_ui_scale) || 1.0;
    }

    function save() {
        node.properties = node.properties || {};
        node.properties.guhai_ig_filter      = filter;
        node.properties.guhai_ig_mode        = mode;
        node.properties.guhai_ig_active      = active;
        node.properties.guhai_ig_active_set  = activeSet;
        node.properties.guhai_ig_name_color  = nameColor;
        node.properties.guhai_ig_theme_mode  = themeMode;
        node.properties.guhai_ig_disable     = igDisable;
        node.properties.guhai_ig_sort_order  = sortOrder;
        delete node.properties.guhai_ig_color_filter;
        if (selectedGroups !== null) node.properties.guhai_ig_selected_groups = [...selectedGroups];
        node.properties.guhai_ig_ui_scale    = uiScale;
        delete node.properties.guhai_ig_paused_groups;
        node.properties.guhai_ig_child_selections = childSelections;
    }

    function _guhaiSyncGroups() {
        filter     = (node.properties && node.properties.guhai_ig_filter)      || "";
        mode       = (node.properties && node.properties.guhai_ig_mode)        || "default";
        active     = (node.properties && node.properties.guhai_ig_active)      || null;
        activeSet  = (node.properties && node.properties.guhai_ig_active_set)  || null;
        nameColor  = (node.properties && node.properties.guhai_ig_name_color)  || DEFAULT_ACCENT_COLOR;
        node.properties.guhai_ig_name_color = nameColor;
        themeMode = node.properties?.guhai_ig_theme_mode === "light" ? "light" : "dark";
        igDisable  = (node.properties && node.properties.guhai_ig_disable)     || false;
        sortOrder  = (node.properties && node.properties.guhai_ig_sort_order)  || "position";
        selectedGroups = node.properties?.guhai_ig_selected_groups == null
            ? null : new Set(node.properties.guhai_ig_selected_groups);
        uiScale    = (node.properties && node.properties.guhai_ig_ui_scale)    || 1.0;
        childSelections = node.properties?.guhai_ig_child_selections || {};
        lastSig = "";
        lastStateSig = "";
        _lastAppliedScale = -1;
        refresh(true);
        scheduleStateSync();
    }


    const BASE_ROW_H     = 34;
    const BASE_PAD_X     = 16;
    const BASE_ROW_PAD_L = 26;
    const BASE_ROW_PAD_R = 16;
    const BASE_TOGGLE_W  = 67;
    const BASE_TOGGLE_H  = 26;
    const BASE_KNOB_R    = 8.8;
    const BASE_FONT_SIZE = 20;
    const BASE_BORDER_R  = 13;

    const HEADER_H = 14;
    const ROW_GAP  = 15;

    function S(base) { return Math.round(base * uiScale); }


    function calcWidth() {
        const fS  = S(BASE_FONT_SIZE);
        const pX  = S(BASE_PAD_X);
        const rPL = S(BASE_ROW_PAD_L);
        const rPR = S(BASE_ROW_PAD_R);
        const tW  = S(BASE_TOGGLE_W);
        const w = pX * 2 + rPL + rPR + 10 + tW + 2 + 8 * fS;
        return Math.max(350, Math.round(w));
    }


    let _lastAppliedScale = -1;
    let _lastAppliedTheme = null;

    function buildScopedCSS() {
        const rH  = S(BASE_ROW_H);
        const pX  = S(BASE_PAD_X);
        const rPL = S(BASE_ROW_PAD_L);
        const rPR = S(BASE_ROW_PAD_R);
        const tW  = S(BASE_TOGGLE_W);
        const tH  = S(BASE_TOGGLE_H);
        const kR  = S(BASE_KNOB_R);
        const kD  = kR * 2;
        const fS  = S(BASE_FONT_SIZE);
        const bR  = S(BASE_BORDER_R);

        const knobPad  = Math.max(0, Math.round((tH - kD) / 2));
        const knobOffL = knobPad + 3;
        const knobOnL  = Math.max(knobOffL, tW - kD - knobPad - 3);

        return `
            .${_uid}, .${_uid}-settings {
                --guhai-ig-toggle-off: ${themeMode === "light" ? "#c9c9c9" : "#606060"};
                --guhai-ig-knob-off: ${themeMode === "light" ? "#f2f2f2" : "#808080"};
            }
            .${_uid} {
                position: relative; width: 100%; box-sizing: border-box;
                overflow: hidden; user-select: none;
                pointer-events: auto;
                margin-top: -10px;
                padding-bottom: 10px;
            }
            .${_uid} .guhai-ig-header {
                height: ${HEADER_H}px; display: flex;
                justify-content: flex-end; align-items: center;
                padding: 0 6px;
            }
            .${_uid} .guhai-ig-gear {
                width: 16px; height: 16px; cursor: pointer;
                opacity: 0.6; transition: opacity .15s;
                display: flex; align-items: center; justify-content: center;
                pointer-events: auto;
            }
            .${_uid} .guhai-ig-gear:hover { opacity: 1; }
            .${_uid} .guhai-ig-gear svg { width: 13px; height: 13px; }
            .${_uid} .guhai-ig-empty {
                color: #888; text-align: center;
                padding: 20px 16px; font-size: 13px;
            }
            .${_uid} .guhai-ig-row {
                display: flex; align-items: center; justify-content: space-between;
                height: ${rH}px;
                margin: 0 ${pX}px ${ROW_GAP}px;
                padding: 0 ${rPR}px 0 ${rPL}px;
                background: var(--component-node-widget-background, var(--comfy-input-bg));
                border: 1px solid var(--border-color);
                border-radius: ${bR}px;
                cursor: pointer; box-sizing: border-box;
                transition: border-color .15s;
                pointer-events: auto;
            }
            .${_uid} .guhai-ig-row:hover { border-color: var(--input-text); }
            .${_uid} .guhai-ig-row:last-child { margin-bottom: 5px; }
            .${_uid} .guhai-ig-label {
                font-weight: bold; font-size: ${fS}px; flex: 1;
                overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
                margin-right: 10px; transition: opacity .15s;
            }
            .${_uid} .guhai-ig-toggle {
                width: ${tW}px; height: ${tH}px; border-radius: ${tH / 2}px;
                background: var(--guhai-ig-toggle-off); position: relative; flex-shrink: 0;
                transition: background .2s ease, box-shadow .2s ease;
            }
            .${_uid} .guhai-ig-knob {
                width: ${kD}px; height: ${kD}px; border-radius: 50%;
                background: var(--guhai-ig-knob-off);
                position: absolute; top: ${knobPad}px; left: ${knobOffL}px;
                transition: left .2s ease, background .2s ease;
                box-shadow: 0 1px 4px rgba(0,0,0,0.3);
            }
            .${_uid} .guhai-ig-toggle.on .guhai-ig-knob {
                left: ${knobOnL}px;
                background: rgb(230,230,230);
            }
            .${_uid}-settings {
                color-scheme: ${themeMode};
                --guhai-ig-menu-bg: ${themeMode === "light" ? "rgba(209,181,210,0.5)" : "rgba(42,42,42,0.5)"};
                --guhai-ig-select-all-bg: ${themeMode === "light" ? "#c3dce0" : "#263f48"};
                --guhai-ig-list-hover: ${themeMode === "light" ? "#d4e6e9" : "#20333b"};
                --guhai-ig-list-divider: ${themeMode === "light" ? "#98bec5" : "#3b6570"};
                --comfy-input-bg: ${themeMode === "light" ? "#c9c9c9" : "#1a1a1a"};
                --input-text: ${themeMode === "light" ? "#222" : "#e0e0e0"};
                --border-color: ${themeMode === "light" ? "#888" : "#555"};
                --descrip-text: ${themeMode === "light" ? "#666" : "#aaa"};
            }
            .${_uid}-settings input::placeholder { color: var(--descrip-text); }
        `;
    }

    function updateDynamicStyles() {
        let s = document.getElementById(_styleId);
        if (s && Math.abs(_lastAppliedScale - uiScale) < 0.001 && _lastAppliedTheme === themeMode) return;
        _lastAppliedScale = uiScale;
        _lastAppliedTheme = themeMode;
        if (!s) {
            s = document.createElement("style");
            s.id = _styleId;
            document.head.appendChild(s);
        }
        s.textContent = buildScopedCSS();
    }


    function forwardWheelToCanvas(e) {
        e.preventDefault();
        e.stopPropagation();
        try {
            const canvasEl = (app.canvas && app.canvas.canvas) || document.querySelector("canvas");
            if (canvasEl) {
                canvasEl.dispatchEvent(new WheelEvent("wheel", {
                    clientX: e.clientX, clientY: e.clientY,
                    deltaY: e.deltaY, deltaX: e.deltaX,
                    deltaMode: e.deltaMode, bubbles: true, cancelable: true,
                }));
            }
        } catch (_) {}
    }


    function gBounds(g) {
        if (g._bounding) return [...g._bounding];
        if (g.bounding)  return [...g.bounding];
        const p = g.pos || [0, 0], s = g.size || [0, 0];
        return [p[0], p[1], s[0], s[1]];
    }

    function nBounds(n) {
        const p = n.pos || [0, 0];
        const s = n.size || [100, 60];
        if (n.collapsed || n._collapsed) {
            const titleH = (typeof LiteGraph !== "undefined" && LiteGraph.NODE_TITLE_HEIGHT) || 30;
            let collapsedW = n._collapsed_width;
            if (!collapsedW || collapsedW <= 0) {
                const title = (typeof n.getTitle === "function" ? n.getTitle() : n.title) || "";
                collapsedW = Math.max(80, title.length * 7 + 50);
            }
            return [p[0], p[1], collapsedW, titleH];
        }
        return [p[0], p[1], s[0], s[1]];
    }

    function hit(a, b) {
        return !(a[0] + a[2] <= b[0] || a[0] >= b[0] + b[2] ||
                 a[1] + a[3] <= b[1] || a[1] >= b[1] + b[3]);
    }

    function inside(inner, outer) {
        return inner[0] >= outer[0] && inner[1] >= outer[1] &&
               inner[0] + inner[2] <= outer[0] + outer[2] &&
               inner[1] + inner[3] <= outer[1] + outer[3];
    }


    /* ── 优化：rawGroups 缓存机制 ── */
    let _rgCache = null;
    let subscribed = false;
    const graphWatchers = new Map();

    function rawGroups(invalidate) {
        if (invalidate) { _rgCache = null; }
        if (_rgCache) return _rgCache;
        const root = node.graph || app.graph;
        const graphs = new Set();
        _rgCache = [];
        function visit(graph) {
            if (!graph || graphs.has(graph)) return;
            graphs.add(graph);
            for (const gr of graph._groups || []) {
                const title = (gr.title || "").trim() || "Unnamed";
                _rgCache.push({
                    title,
                    key: graph === app.graph ? title : graph.id + ":" + title,
                    selectionKey: gr.id == null
                        ? (graph === app.graph ? title : graph.id + ":" + title)
                        : graph.id + ":group:" + gr.id,
                    graph,
                    bounds: gBounds(gr),
                    ref: gr,
                });
            }
            for (const child of graph._nodes || []) {
                if (child.isSubgraphNode?.()) visit(child.subgraph);
            }
        }
        visit(root);
        if (subscribed) {
            for (const [graph, stop] of graphWatchers) {
                if (!graphs.has(graph)) {
                    stop();
                    graphWatchers.delete(graph);
                }
            }
            for (const graph of graphs) {
                if (!graphWatchers.has(graph) && typeof graph.change === "function") {
                    graphWatchers.set(graph, watchGraphChanges(graph, scheduleStateSync));
                }
            }
        }
        return _rgCache;
    }

    function matchingGroups(cachedAll) {
        let list = cachedAll || rawGroups();
        list = list.slice();
        if (filter.trim()) {
            const kw = filter.trim().toLowerCase();
            list = list.filter(g => g.title.toLowerCase().includes(kw));
        }
        list.sort((a, b) => {
            const graphOrder = Number(a.graph !== app.graph) - Number(b.graph !== app.graph);
            if (graphOrder) return graphOrder;
            if (sortOrder === "position") {
                const ax = a.bounds[0], ay = a.bounds[1];
                const bx = b.bounds[0], by = b.bounds[1];
                if (ay !== by) return ay - by;
                return ax - bx;
            }
            return a.title.localeCompare(b.title, undefined, { sensitivity: "base" });
        });
        return list;
    }

    function visible(cachedAll) {
        const all = cachedAll || rawGroups();
        return matchingGroups(all).filter(g =>
            (selectedGroups === null || selectedGroups.has(g.selectionKey)) &&
            collectNodes(g, all, all).length > 0
        );
    }

    function collectNodes(grp, allGroups, cachedAll) {
        const g = grp.graph;
        if (!g || !g._nodes) return [];
        const all  = allGroups || cachedAll || rawGroups();
        const pb   = grp.bounds;
        const rects = [pb];
        all.forEach(ag => {
            if (ag.graph === g && ag.ref !== grp.ref && inside(ag.bounds, pb)) {
                rects.push(ag.bounds);
            }
        });
        return g._nodes.filter(n => {
            const nb = nBounds(n);
            return rects.some(r => hit(nb, r));
        });
    }

    function getChildSelections(grp, cachedAll) {
        const selections = [];
        for (const controller of grp.graph._nodes) {
            if (controller === node || !controller._guhaiSingleGroups) continue;
            const selection = controller._guhaiSingleGroups(grp, cachedAll);
            if (selection) selections.push({ controller, ...selection });
        }
        return selections;
    }

    function bypassGroup(grp, cachedAll) {
        // 只记住单选子控制器的选择，普通子组和散节点不保存状态。
        const selections = getChildSelections(grp, cachedAll);
        if (getGroupState(grp, cachedAll) !== false) {
            childSelections["group:" + grp.key] = Object.fromEntries(
                selections.map(s => [String(s.controller.id), s.active])
            );
        }
        collectNodes(grp, null, cachedAll).forEach(n => {
            n.mode = igDisable ? 2 : 4;
        });
    }

    function restoreGroup(grp, cachedAll) {
        const key = "group:" + grp.key;
        const saved = childSelections[key] || {};
        const selections = getChildSelections(grp, cachedAll);
        collectNodes(grp, null, cachedAll).forEach(n => {
            n.mode = 0;
            if (n.flags) n.flags.disabled = false;
        });
        for (const selection of selections) {
            const id = String(selection.controller.id);
            const requested = Object.hasOwn(saved, id) ? saved[id] : selection.active;
            const selected = selection.groups.find(g => g.key === requested)
                || (selection.mode === "always_one" ? selection.groups[0] : null);
            for (const g of selection.groups) {
                if (g === selected) continue;
                collectNodes(g, null, cachedAll).forEach(n => {
                    n.mode = selection.disable ? 2 : 4;
                });
            }
        }
        delete childSelections[key];
    }

    function singleGroupsIn(parent, cachedAll) {
        if (mode !== "always_one" && mode !== "at_most_one") return null;
        const groups = visible(cachedAll).filter(g =>
            g.graph === parent.graph && g.ref !== parent.ref && inside(g.bounds, parent.bounds)
        );
        if (!groups.length) return null;
        const onList = groups.filter(g => getGroupState(g, cachedAll) !== false);
        const selected = onList.find(g => g.key === active) || onList[0];
        return { groups, mode, disable: igDisable, active: selected?.key || null };
    }

    function isNodeActive(n) {
        return n.mode !== 4 && n.mode !== 2 && !n.flags?.disabled;
    }


    function getGroupState(grp, cachedAll) {
        const nodes = collectNodes(grp, null, cachedAll);
        if (nodes.length === 0) return true;
        const allActive   = nodes.every(n => isNodeActive(n));
        const allInactive = nodes.every(n => !isNodeActive(n));
        if (allActive)   return true;
        if (allInactive) return false;
        return null;
    }

    function computeStateSig(list, cachedAll) {
        return list.map(g => {
            const s = getGroupState(g, cachedAll);
            return g.key + ":" + (s === true ? "1" : s === false ? "0" : "m");
        }).join("\x00");
    }


    function syncExternalState(cachedAll) {
        if (!node.graph?._nodes?.includes(node)) return false;

        const all = cachedAll || rawGroups();
        let changed = false;
        if (mode === "default") {
            const next = all.filter(g => getGroupState(g, all) !== false).map(g => g.key);
            if (JSON.stringify(next) !== JSON.stringify(activeSet)) {
                activeSet = next;
                changed = true;
            }
        } else {
            const onList = visible(all).filter(g => getGroupState(g, all) !== false);
            const next = onList.some(g => g.key === active) ? active : (onList[0]?.key || null);
            if (next !== active) {
                active = next;
                changed = true;
            }
        }
        if (changed) save();
        return changed;
    }


    const gearSVG = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle cx="12" cy="12" r="3" fill="rgba(120,120,120,0.3)" stroke="rgba(153,153,153,0.6)" stroke-width="1"/>
        <path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.07.62-.07.94s.02.64.07.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58z"
            fill="rgba(120,120,120,0.25)" stroke="rgba(120,120,120,0.4)" stroke-width="1.2"/>
    </svg>`;

    const rootEl = document.createElement("div");
    rootEl.className = "guhai-ig " + _uid;
    rootEl.style.visibility = "hidden";

    /* ── 优化：wheel 监听器只绑定一次，不再在 buildDom 中重复添加 ── */
    rootEl.addEventListener("wheel", forwardWheelToCanvas, { passive: false });

    // Nodes 2.0 may reuse the Vue widget container after undo recreates the node.
    // Mount this instance's DOM so its styles and handlers follow the live node.
    let mountFrame = null;
    function scheduleDomMount() {
        if (mountFrame !== null) return;
        mountFrame = requestAnimationFrame(() => {
            mountFrame = null;
            if (rootEl.isConnected || !node.graph?._nodes?.includes(node)) return;
            const vueNode = document.querySelector(
                `.lg-node[data-node-id="${CSS.escape(String(node.id))}"]`
            );
            const staleRoot = vueNode?.querySelector(".guhai-ig");
            if (staleRoot && staleRoot !== rootEl) {
                updateDynamicStyles();
                staleRoot.replaceWith(rootEl);
            }
        });
    }
    const mountObserver = new MutationObserver(() => {
        if (!rootEl.isConnected) scheduleDomMount();
    });
    mountObserver.observe(document.getElementById("graph-canvas-container") || document.body, {
        childList: true,
        subtree: true,
    });
    scheduleDomMount();

    let _lastBuildSig = "";

    function calcHeight() {
        const rowH = S(BASE_ROW_H);
        const cnt = Math.max(visible().length, 1);
        return HEADER_H + cnt * (rowH + ROW_GAP) - ROW_GAP + 10;
    }

    function buildStatefulSig() {
        const list = visible();
        const effectiveColor = nameColor;
        let sig = list.map(g => {
            const isOn = getGroupState(g) !== false;
            return g.key + (isOn ? ":1" : ":0");
        }).join("\x00");
        sig += "|" + effectiveColor + "|" + (mode || "") + "|" + uiScale;
        return sig;
    }

    function buildDom(force) {
        const sig = buildStatefulSig();
        if (sig === _lastBuildSig && !force) return;
        _lastBuildSig = sig;

        const list = visible();
        const effectiveColor = nameColor;

        rootEl.innerHTML = "";
        /* ── 优化：移除了此处的 wheel 监听器重复绑定 ── */

        const header = document.createElement("div");
        header.className = "guhai-ig-header";
        const gear = document.createElement("div");
        gear.className = "guhai-ig-gear";
        gear.innerHTML = gearSVG;
        gear.title = "设置";
        gear.addEventListener("mousedown", (e) => {
            e.preventDefault(); e.stopPropagation();
            showSettings(e.clientX, e.clientY);
        });
        gear.addEventListener("pointerdown", (e) => e.stopPropagation());
        gear.addEventListener("wheel", forwardWheelToCanvas, { passive: false });
        header.appendChild(gear);
        rootEl.appendChild(header);

        if (!list.length) {
            const empty = document.createElement("div");
            empty.className = "guhai-ig-empty";
            empty.textContent = "无匹配的非空组，请检查筛选设置";
            rootEl.appendChild(empty);
        } else {
            const h = calcHeight();
            rootEl.style.minHeight = h + "px";
            rootEl.style.height    = h + "px";

            list.forEach((g) => {
                const isOn = getGroupState(g) !== false;

                const row = document.createElement("div");
                row.className = "guhai-ig-row";

                const label = document.createElement("div");
                label.className = "guhai-ig-label";
                label.style.color = effectiveColor;
                if (g.graph !== app.graph) {
                    const arrow = document.createElement("span");
                    arrow.style.color = "var(--guhai-ig-toggle-off)";
                    arrow.style.fontSize = "0.67em";
                    arrow.textContent = "↳ ";
                    label.appendChild(arrow);
                }
                const title = document.createElement("span");
                title.style.opacity = isOn ? "1" : "0.5";
                title.textContent = g.title;
                label.appendChild(title);

                const toggle = document.createElement("div");
                toggle.className = "guhai-ig-toggle" + (isOn ? " on" : "");
                if (isOn) toggle.style.background = effectiveColor;
                toggle.style.boxShadow = isOn ? `0 0 8px color-mix(in srgb, ${effectiveColor} 35%, transparent)` : "none";

                const knob = document.createElement("div");
                knob.className = "guhai-ig-knob";
                toggle.appendChild(knob);
                row.appendChild(label);
                row.appendChild(toggle);

                row.addEventListener("mousedown", (e) => {
                    e.preventDefault(); e.stopPropagation();
                    handleToggle(g.key);
                });
                row.addEventListener("pointerdown", (e) => e.stopPropagation());
                row.addEventListener("wheel", forwardWheelToCanvas, { passive: false });

                rootEl.appendChild(row);
            });
        }
    }


    const domWidget = node.addDOMWidget("guhai_ig", "ig_custom", rootEl, {
        serialize: false,
        hideOnZoom: false,
        surfaces: { canvas: "shown", vueNode: "shown", panel: "never" },
    });

    if (domWidget?.visibility?.surfaces) {
        domWidget.visibility.surfaces.canvas = "shown";
        domWidget.visibility.surfaces.panel = "never";
        domWidget.visibility.surfaces.vueNode = "shown";
    }

    if (domWidget) {
        domWidget.computeSize = function () {
            return [calcWidth(), calcHeight()];
        };
    }

    node.computeSize = function () {
        return [calcWidth(), calcHeight()];
    };


    let lastSig = "";
    let lastStateSig = "";

    function refresh(forceApply) {
        const cachedAll = rawGroups(true);
        const list = visible(cachedAll);
        const sig = list.map(g => g.key).join("\x00");
        const listChanged = sig !== lastSig;
        lastSig = sig;
        const stateChanged = syncExternalState(cachedAll);

        // 刷新只同步界面；节点状态只由明确的开关操作修改。
        updateDynamicStyles();
        buildDom(forceApply || stateChanged || listChanged);
        updateQuickFilter?.();
    }


    function handleToggle(key) {
        const cachedAll = rawGroups(true);
        const list = visible(cachedAll);
        const grp = list.find(g => g.key === key);
        if (!grp) return;
        const isOn = getGroupState(grp, cachedAll) !== false;

        const onList = mode === "default" ? []
            : list.filter(g => getGroupState(g, cachedAll) !== false);
        // 外部操作导致多组同时开启时，点击任一组即可重新选中它。
        if (isOn && (mode === "default" || onList.length === 1)) {
            if (mode === "always_one") return;
            bypassGroup(grp, cachedAll);
        } else {
            if (mode !== "default") {
                list.forEach(g => {
                    if (g !== grp && getGroupState(g, cachedAll) !== false) {
                        bypassGroup(g, cachedAll);
                    }
                });
            }
            restoreGroup(grp, cachedAll);
        }
        syncExternalState(cachedAll);
        save();
        try { app.graph.change(); } catch (_) {}
        refresh(true);
    }


    let _settingsCleanup = null;

    function showSettings(x, y) {
        if (_settingsCleanup) { _settingsCleanup(); _settingsCleanup = null; }

        let _initialSettingsScale = uiScale;
        let _needsNodeHeightRefresh = false;

        const overlay = document.createElement("div");
        overlay.id = "guhai_ig_overlay";
        Object.assign(overlay.style, {
            position: "fixed", inset: "0", zIndex: "99998",
            background: "transparent", cursor: "default",
        });
        overlay.addEventListener("wheel", forwardWheelToCanvas, { passive: false });
        document.body.appendChild(overlay);

        const pop = document.createElement("div");
        pop.id = "guhai_ig_pop";
        pop.className = _uid + "-settings";
        Object.assign(pop.style, {
            position: "fixed",
            left: Math.min(x, innerWidth  - 280) + "px",
            top:  Math.min(y, innerHeight - 620) + "px",
            background: "var(--guhai-ig-menu-bg)", border: "1px solid var(--border-color)",
            borderRadius: "8px", padding: "14px 18px",
            zIndex: "99999", minWidth: "250px",
            boxShadow: "0 4px 24px rgba(0,0,0,0.6)",
            backdropFilter: "blur(24px) saturate(150%)",
            WebkitBackdropFilter: "blur(24px) saturate(150%)",
            color: "var(--input-text)", fontFamily: "inherit",
        });
        pop.addEventListener("wheel", forwardWheelToCanvas, { passive: false });

        function closePopup() {
            if (overlay.parentNode) overlay.remove();
            if (pop.parentNode)     pop.remove();
            document.removeEventListener("keydown", onEsc);
            document.removeEventListener("mousedown", closeQuickPanel);
            if (filterTimer !== null) clearTimeout(filterTimer);
            updateQuickFilter = null;
            _settingsCleanup = null;
            if (_needsNodeHeightRefresh) {
                _needsNodeHeightRefresh = false;
                node.size = [calcWidth(), calcHeight()];
                app.graph.change();
            }
        }
        _settingsCleanup = closePopup;

        overlay.addEventListener("mousedown", (e) => {
            e.preventDefault(); e.stopPropagation(); closePopup();
        });
        function onEsc(e) { if (e.key === "Escape") closePopup(); }
        document.addEventListener("keydown", onEsc);

        function applyAll() {
            const routeChanged = igDisable !== dRadioDisable.checked;
            filter      = fInput.value;
            igDisable   = dRadioDisable.checked;
            sortOrder   = sSelect.value;
            themeMode   = themeLight.checked ? "light" : "dark";
            const newMode = mSelect.value;
            const newScale = parseFloat(scaleInput.value) || 1.0;

            uiScale = newScale;
            updateDynamicStyles();

            if (Math.abs(newScale - _initialSettingsScale) > 0.001) {
                _needsNodeHeightRefresh = true;
            }

            if (routeChanged) {
                const cachedAll = rawGroups(true);
                visible(cachedAll).filter(g => getGroupState(g, cachedAll) === false)
                    .forEach(g => bypassGroup(g, cachedAll));
            }

            const modeChanged = newMode !== mode;
            if (modeChanged) {
                if (newMode === "default") {
                    activeSet = visible().map(g => g.key);
                } else if (newMode === "always_one") {
                    const fl = visible();
                    const ft = new Set(fl.map(g => g.key));
                    if (activeSet && activeSet.length) {
                        const match = activeSet.find(t => ft.has(t));
                        active = match || (fl.length ? fl[0].key : null);
                    } else {
                        active = fl.length ? fl[0].key : null;
                    }
                    activeSet = null;
                } else {
                    const fl = visible();
                    const ft = new Set(fl.map(g => g.key));
                    if (activeSet && activeSet.length) {
                        const match = activeSet.find(t => ft.has(t));
                        active = match || null;
                    } else if (mode === "always_one" && active && ft.has(active)) {
                        /* keep */
                    } else {
                        active = null;
                    }
                    activeSet = null;
                }
                mode = newMode;
            } else {
                if (mode === "always_one" && !active) {
                    const list = visible();
                    if (list.length) active = list[0].key;
                }
            }
            if (modeChanged && mode !== "default") {
                const cachedAll = rawGroups(true);
                const list = visible(cachedAll);
                list.forEach(g => {
                    if (g.key !== active && getGroupState(g, cachedAll) !== false) {
                        bypassGroup(g, cachedAll);
                    }
                });
                const selected = list.find(g => g.key === active);
                if (selected && getGroupState(selected, cachedAll) === false) {
                    restoreGroup(selected, cachedAll);
                }
            }
            save();
            try { app.graph.change(); } catch (_) {}
            refresh(true);
        }

        const titleEl = document.createElement("div");
        titleEl.textContent = "🎮  忽略多组_孤海 设置";
        Object.assign(titleEl.style, {
            fontSize: "15px", fontWeight: "bold", marginBottom: "14px",
            color: "var(--input-text)", borderBottom: "1px solid var(--border-color)", paddingBottom: "8px",
        });
        pop.appendChild(titleEl);

        const dLabel = document.createElement("div");
        dLabel.textContent = "路由控制";
        Object.assign(dLabel.style, { fontSize: "13px", fontWeight: "bold", marginBottom: "6px" });
        pop.appendChild(dLabel);

        const dRow = document.createElement("div");
        Object.assign(dRow.style, { display: "flex", alignItems: "center", gap: "20px", marginBottom: "14px" });

        const dRadioBypass = document.createElement("input");
        dRadioBypass.type = "radio"; dRadioBypass.name = "guhai_ig_close_mode";
        dRadioBypass.value = "bypass"; dRadioBypass.checked = !igDisable; dRadioBypass.style.cursor = "pointer";
        const dLblBypass = document.createElement("label");
        dLblBypass.style.cursor = "pointer"; dLblBypass.style.fontSize = "13px";
        dLblBypass.appendChild(dRadioBypass); dLblBypass.appendChild(document.createTextNode(" 绕过（ctrl+b）"));

        const dRadioDisable = document.createElement("input");
        dRadioDisable.type = "radio"; dRadioDisable.name = "guhai_ig_close_mode";
        dRadioDisable.value = "disable"; dRadioDisable.checked = !!igDisable; dRadioDisable.style.cursor = "pointer";
        const dLblDisable = document.createElement("label");
        dLblDisable.style.cursor = "pointer"; dLblDisable.style.fontSize = "13px";
        dLblDisable.appendChild(dRadioDisable); dLblDisable.appendChild(document.createTextNode(" 禁用（ctrl+m）"));

        dRow.appendChild(dLblBypass); dRow.appendChild(dLblDisable); pop.appendChild(dRow);
        dRadioBypass.addEventListener("change", applyAll);
        dRadioDisable.addEventListener("change", applyAll);

        const fLabel = document.createElement("div");
        fLabel.textContent = "关键词筛选";
        Object.assign(fLabel.style, { fontSize: "13px", fontWeight: "bold", marginBottom: "4px" });
        pop.appendChild(fLabel);

        const fInput = document.createElement("input");
        fInput.type = "text"; fInput.value = filter; fInput.placeholder = "留空 = 不限关键词";
        Object.assign(fInput.style, {
            width: "100%", padding: "5px 8px", fontSize: "13px",
            background: "var(--comfy-input-bg)", border: "1px solid var(--border-color)", borderRadius: "4px",
            color: "var(--input-text)", outline: "none", boxSizing: "border-box", marginBottom: "14px",
        });
        pop.appendChild(fInput);
        let filterTimer = null;
        fInput.addEventListener("input", () => {
            if (filterTimer) clearTimeout(filterTimer);
            filterTimer = setTimeout(applyAll, 200);
        });

        const quickLabel = document.createElement("div");
        quickLabel.textContent = "快速筛选";
        Object.assign(quickLabel.style, { fontSize: "13px", fontWeight: "bold", marginBottom: "4px" });
        pop.appendChild(quickLabel);

        const quickContainer = document.createElement("div");
        Object.assign(quickContainer.style, { position: "relative", width: "100%", marginBottom: "14px" });

        const quickTrigger = document.createElement("div");
        Object.assign(quickTrigger.style, {
            width: "100%", padding: "5px 8px", fontSize: "13px",
            background: "var(--comfy-input-bg)", border: "1px solid var(--border-color)", borderRadius: "4px",
            color: "var(--input-text)", boxSizing: "border-box",
            cursor: "pointer", display: "flex", alignItems: "center", gap: "6px", userSelect: "none",
        });
        const quickText = document.createElement("span");
        quickText.style.flex = "1";
        const quickArrow = document.createElement("span");
        quickArrow.textContent = "\u25BE";
        Object.assign(quickArrow.style, { marginLeft: "auto", fontSize: "11px", color: "var(--descrip-text)" });
        quickTrigger.appendChild(quickText);
        quickTrigger.appendChild(quickArrow);
        quickContainer.appendChild(quickTrigger);

        let quickPanel = null;
        let quickPanelSig = "";
        updateQuickFilter = () => {
            const groups = matchingGroups();
            const count = groups.filter(g => selectedGroups === null || selectedGroups.has(g.selectionKey)).length;
            quickText.textContent = `已选 ${count} / ${groups.length} 个组`;
            if (!quickPanel) return;
            const sig = JSON.stringify(groups.map(g => [g.selectionKey, g.title, selectedGroups?.has(g.selectionKey)]));
            if (sig === quickPanelSig) return;
            quickPanelSig = sig;
            const scrollTop = quickPanel.scrollTop;
            quickPanel.innerHTML = "";
            const selectAllRow = document.createElement("label");
            Object.assign(selectAllRow.style, {
                position: "sticky", top: "0", zIndex: "1",
                display: "flex", alignItems: "center", gap: "8px",
                padding: "9px 8px", marginBottom: "4px", fontSize: "13px", fontWeight: "bold",
                background: "var(--guhai-ig-select-all-bg)", color: "var(--input-text)",
                borderBottom: "1px solid var(--guhai-ig-list-divider)", cursor: "pointer",
            });
            const selectAll = document.createElement("input");
            selectAll.type = "checkbox";
            selectAll.checked = groups.length > 0 && count === groups.length;
            selectAll.indeterminate = count > 0 && count < groups.length;
            selectAll.disabled = groups.length === 0;
            Object.assign(selectAll.style, { margin: "0", flexShrink: "0", cursor: "pointer" });
            selectAllRow.appendChild(selectAll);
            selectAllRow.appendChild(document.createTextNode("全选"));
            selectAll.addEventListener("change", () => {
                if (selectedGroups === null) selectedGroups = new Set(rawGroups().map(g => g.selectionKey));
                for (const g of groups) {
                    if (selectAll.checked) selectedGroups.add(g.selectionKey);
                    else selectedGroups.delete(g.selectionKey);
                }
                applyAll();
                node.size = [calcWidth(), calcHeight()];
            });
            quickPanel.appendChild(selectAllRow);
            for (const g of groups) {
                const item = document.createElement("label");
                Object.assign(item.style, {
                    display: "flex", alignItems: "center", gap: "8px",
                    padding: "5px 8px", cursor: "pointer", fontSize: "13px",
                });
                item.addEventListener("mouseenter", () => { item.style.background = "var(--guhai-ig-list-hover)"; });
                item.addEventListener("mouseleave", () => { item.style.background = "transparent"; });
                const checkbox = document.createElement("input");
                checkbox.type = "checkbox";
                checkbox.checked = selectedGroups === null || selectedGroups.has(g.selectionKey);
                Object.assign(checkbox.style, { margin: "0", flexShrink: "0", cursor: "pointer" });
                item.appendChild(checkbox);
                const text = document.createElement("span");
                text.style.color = "var(--input-text)";
                if (g.graph !== app.graph) {
                    const arrow = document.createElement("span");
                    arrow.style.color = "var(--guhai-ig-toggle-off)";
                    arrow.style.fontSize = "0.67em";
                    arrow.textContent = "↳ ";
                    text.appendChild(arrow);
                }
                text.appendChild(document.createTextNode(g.title));
                item.appendChild(text);
                checkbox.addEventListener("change", () => {
                    if (selectedGroups === null) selectedGroups = new Set(rawGroups().map(g => g.selectionKey));
                    if (checkbox.checked) selectedGroups.add(g.selectionKey);
                    else selectedGroups.delete(g.selectionKey);
                    applyAll();
                    node.size = [calcWidth(), calcHeight()];
                });
                quickPanel.appendChild(item);
            }
            if (!groups.length) {
                const empty = document.createElement("div");
                empty.textContent = "无匹配的组";
                Object.assign(empty.style, { padding: "8px", fontSize: "13px", color: "var(--descrip-text)" });
                quickPanel.appendChild(empty);
            }
            quickPanel.scrollTop = scrollTop;
        };
        quickTrigger.addEventListener("click", (e) => {
            e.stopPropagation();
            if (quickPanel) {
                quickPanel.remove();
                quickPanel = null;
                return;
            }
            rawGroups(true);
            quickPanel = document.createElement("div");
            Object.assign(quickPanel.style, {
                position: "absolute", left: "18px", right: "18px",
                top: quickContainer.offsetTop + quickContainer.offsetHeight + 2 + "px", bottom: "14px",
                background: "var(--comfy-input-bg)", border: "1px solid var(--border-color)", borderRadius: "4px",
                zIndex: "100001", overflowY: "auto", overscrollBehavior: "contain",
                boxShadow: "0 4px 16px rgba(0,0,0,0.5)",
            });
            quickPanel.addEventListener("wheel", (e) => e.stopPropagation());
            pop.appendChild(quickPanel);
            quickPanelSig = "";
            updateQuickFilter();
        });
        updateQuickFilter();
        pop.appendChild(quickContainer);

        const closeQuickPanel = (e) => {
            if (quickPanel && !quickContainer.contains(e.target) && !quickPanel.contains(e.target)) {
                quickPanel.remove();
                quickPanel = null;
            }
        };
        document.addEventListener("mousedown", closeQuickPanel);

        const mLabel = document.createElement("div");
        mLabel.textContent = "切换模式";
        Object.assign(mLabel.style, { fontSize: "13px", fontWeight: "bold", marginBottom: "4px" });
        pop.appendChild(mLabel);

        const mSelect = document.createElement("select");
        Object.assign(mSelect.style, {
            width: "100%", padding: "5px 8px", fontSize: "13px",
            background: "var(--comfy-input-bg)", border: "1px solid var(--border-color)", borderRadius: "4px",
            color: "var(--input-text)", outline: "none", boxSizing: "border-box", marginBottom: "14px",
        });
        [["default","默认"],["always_one","始终开启1个"],["at_most_one","最多开启1个"]].forEach(([val, txt]) => {
            const opt = document.createElement("option"); opt.value = val; opt.textContent = txt; mSelect.appendChild(opt);
        });
        mSelect.value = mode; pop.appendChild(mSelect);
        mSelect.addEventListener("change", applyAll);

        const sLabel = document.createElement("div");
        sLabel.textContent = "排序";
        Object.assign(sLabel.style, { fontSize: "13px", fontWeight: "bold", marginBottom: "4px" });
        pop.appendChild(sLabel);

        const sSelect = document.createElement("select");
        Object.assign(sSelect.style, {
            width: "100%", padding: "5px 8px", fontSize: "13px",
            background: "var(--comfy-input-bg)", border: "1px solid var(--border-color)", borderRadius: "4px",
            color: "var(--input-text)", outline: "none", boxSizing: "border-box", marginBottom: "14px",
        });
        [["position","按位置"],["alphabet","按首字母"]].forEach(([val, txt]) => {
            const opt = document.createElement("option"); opt.value = val; opt.textContent = txt; sSelect.appendChild(opt);
        });
        sSelect.value = sortOrder; pop.appendChild(sSelect);
        sSelect.addEventListener("change", applyAll);

        const scaleLabel = document.createElement("div");
        scaleLabel.textContent = "UI组件大小";
        Object.assign(scaleLabel.style, { fontSize: "13px", fontWeight: "bold", marginBottom: "4px" });
        pop.appendChild(scaleLabel);

        const scaleRow = document.createElement("div");
        Object.assign(scaleRow.style, { display: "flex", alignItems: "center", gap: "10px", marginBottom: "14px" });

        const scaleInput = document.createElement("input");
        scaleInput.type = "range";
        scaleInput.min = "0.5";
        scaleInput.max = "5.0";
        scaleInput.step = "0.1";
        scaleInput.value = String(uiScale);
        Object.assign(scaleInput.style, {
            flex: "1", height: "4px", appearance: "none", background: "var(--border-color)",
            borderRadius: "2px", outline: "none", cursor: "pointer",
        });
        const scaleVal = document.createElement("span");
        scaleVal.textContent = uiScale.toFixed(1) + "x";
        Object.assign(scaleVal.style, { minWidth: "36px", fontSize: "12px", color: "var(--descrip-text)", textAlign: "right" });
        scaleRow.appendChild(scaleInput);
        scaleRow.appendChild(scaleVal);
        pop.appendChild(scaleRow);

        scaleInput.addEventListener("input", () => {
            scaleVal.textContent = (parseFloat(scaleInput.value) || 1.0).toFixed(1) + "x";
            applyAll();
        });

        const tcLabel = document.createElement("div");
        tcLabel.textContent = "主题颜色";
        Object.assign(tcLabel.style, {
            display: "flex", alignItems: "center", gap: "12px",
            fontSize: "13px", fontWeight: "bold", marginBottom: "4px",
        });
        const themeDark = document.createElement("input");
        const themeLight = document.createElement("input");
        [[themeDark, "dark", "深色"], [themeLight, "light", "浅色"]].forEach(([radio, value, text]) => {
            radio.type = "radio";
            radio.name = _uid + "_theme_mode";
            radio.value = value;
            radio.checked = themeMode === value;
            radio.style.cursor = "pointer";
            const label = document.createElement("label");
            Object.assign(label.style, {
                display: "flex", alignItems: "center", gap: "4px",
                fontWeight: "normal", cursor: "pointer",
            });
            label.appendChild(radio);
            label.appendChild(document.createTextNode(text));
            tcLabel.appendChild(label);
            radio.addEventListener("change", applyAll);
        });
        pop.appendChild(tcLabel);

        const colorRow = document.createElement("div");
        Object.assign(colorRow.style, { display: "flex", alignItems: "center", gap: "8px", marginBottom: "16px" });

        const cInput = document.createElement("input");
        const initialColor = nameColor;
        cInput.type = "color"; cInput.value = initialColor;
        Object.assign(cInput.style, {
            width: "36px", height: "28px", padding: "0",
            border: "1px solid var(--border-color)", borderRadius: "4px", background: "var(--comfy-input-bg)", cursor: "pointer",
        });
        colorRow.appendChild(cInput);

        const cHex = document.createElement("input");
        cHex.type = "text"; cHex.value = initialColor;
        Object.assign(cHex.style, {
            flex: "1", padding: "5px 8px", fontSize: "13px",
            background: "var(--comfy-input-bg)", border: "1px solid var(--border-color)", borderRadius: "4px",
            color: "var(--input-text)", outline: "none", boxSizing: "border-box",
        });
        colorRow.appendChild(cHex);

        cInput.addEventListener("input", () => { nameColor = cInput.value; cHex.value = cInput.value; applyAll(); });
        cHex.addEventListener("input", () => {
            if (/^#[0-9a-fA-F]{6}$/.test(cHex.value)) { nameColor = cHex.value; cInput.value = cHex.value; applyAll(); }
        });
        pop.appendChild(colorRow);

        document.body.appendChild(pop);
        fInput.focus();
        pop.addEventListener("contextmenu", (e) => { e.preventDefault(); e.stopPropagation(); });
    }

    node._guhaiShowSettings = showSettings;
    node._guhaiSyncGroups   = _guhaiSyncGroups;
    node._guhaiSingleGroups = singleGroupsIn;


    let syncTimer = null;

    function scheduleStateSync() {
        if (!subscribed || document.hidden || syncTimer !== null) return;
        // 仅由事件安排一次同步，同一批操作共用一个回调。
        syncTimer = setTimeout(() => {
            syncTimer = null;
            if (!node.graph || document.hidden) return;
            const cachedAll = rawGroups(true);
            if (selectedGroups === null) {
                selectedGroups = new Set(cachedAll.map(g => g.selectionKey));
                save();
            }
            const list = visible(cachedAll);
            const sig = list.map(g => g.key).join("\x00");
            const stateSig = computeStateSig(list, cachedAll);
            const listChanged = sig !== lastSig;
            const stateChanged = stateSig !== lastStateSig;
            if (listChanged || stateChanged) {
                lastStateSig = stateSig;
                syncExternalState(cachedAll);
                lastSig = sig;
                updateDynamicStyles();
                buildDom(true);
            }
            updateQuickFilter?.();
        }, 30);
    }

    function onKeyDown(e) {
        if ((e.ctrlKey || e.metaKey) &&
            (e.key === "m" || e.key === "b" || e.key === "M" || e.key === "B")) {
            scheduleStateSync();
        }
    }

    function subscribeStateSync() {
        if (subscribed) return;
        subscribed = true;
        rawGroups(true);
        document.addEventListener("keydown", onKeyDown, true);
        // rgthree 等扩展可能只修改 mode 并重绘，在操作结束后读取最终状态。
        document.addEventListener("pointerup", scheduleStateSync, true);
        document.addEventListener("click", scheduleStateSync, true);
        document.addEventListener("visibilitychange", scheduleStateSync);
        scheduleStateSync();
    }

    function unsubscribeStateSync() {
        subscribed = false;
        if (syncTimer !== null) {
            clearTimeout(syncTimer);
            syncTimer = null;
        }
        graphWatchers.forEach(stop => stop());
        graphWatchers.clear();
        document.removeEventListener("keydown", onKeyDown, true);
        document.removeEventListener("pointerup", scheduleStateSync, true);
        document.removeEventListener("click", scheduleStateSync, true);
        document.removeEventListener("visibilitychange", scheduleStateSync);
        mountObserver.disconnect();
        if (mountFrame !== null) {
            cancelAnimationFrame(mountFrame);
            mountFrame = null;
        }
        if (_settingsCleanup) _settingsCleanup();
        document.getElementById(_styleId)?.remove();
    }

    const origAdded = node.onAdded;
    node.onAdded = function () {
        const result = origAdded?.apply(this, arguments);
        mountObserver.observe(document.getElementById("graph-canvas-container") || document.body, {
            childList: true,
            subtree: true,
        });
        subscribeStateSync();
        updateDynamicStyles();
        scheduleDomMount();
        return result;
    };
    const origRemoved = node.onRemoved;
    node.onRemoved = function () {
        unsubscribeStateSync();
        return origRemoved?.apply(this, arguments);
    };
    subscribeStateSync();


    updateDynamicStyles();
    refresh(false);
    lastStateSig = computeStateSig(visible());

    node.size = [calcWidth(), calcHeight()];

    requestAnimationFrame(() => { rootEl.style.visibility = "visible"; });
}
