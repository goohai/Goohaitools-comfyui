import { app } from "../../../scripts/app.js";

app.registerExtension({
    name: "goohaitools.ignore_groups",

    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name !== "忽略多组孤海") return;

        const origCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            origCreated?.apply(this, arguments);
            this.size = [400, this.size[1]];
            buildIgnoreGroupsUI(this);
        };

        const origConfigure = nodeType.prototype.onConfigure;
        nodeType.prototype.onConfigure = function (info) {
            origConfigure?.apply(this, arguments);
            if (this._guhaiSyncGroups) this._guhaiSyncGroups();
        };

        /* 右键上下文菜单 —— 优先级最高（第一位） */
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

    /* ═══════════════════ 状态 ═══════════════════ */
    let filter    = "";
    let mode      = "default";
    let active    = null;
    let activeSet = null;
    let nameColor = null;

    if (node.properties) {
        if (node.properties.guhai_ig_filter     != null) filter    = node.properties.guhai_ig_filter;
        if (node.properties.guhai_ig_mode       != null) mode      = node.properties.guhai_ig_mode;
        if (node.properties.guhai_ig_active     != null) active    = node.properties.guhai_ig_active;
        if (node.properties.guhai_ig_active_set != null) activeSet = node.properties.guhai_ig_active_set;
        if (node.properties.guhai_ig_name_color != null) nameColor = node.properties.guhai_ig_name_color;
    }

    function save() {
        node.properties = node.properties || {};
        node.properties.guhai_ig_filter     = filter;
        node.properties.guhai_ig_mode       = mode;
        node.properties.guhai_ig_active     = active;
        node.properties.guhai_ig_active_set = activeSet;
        node.properties.guhai_ig_name_color = nameColor;
    }


    /* ═══════════════════ Canvas 布局常量 ═══════════════════ */
    const HEADER_H  = 14;    /* 齿轮图标区域高度  */
    const ROW_H     = 34;   /* 每行高度          */
    const ROW_GAP   = 15;   /* 行间距            */
    const PAD_X     = 16;   /* 水平内边距（左右各缩进量） */
    const ROW_PAD_L = 26;   /* 行内左边距        */
    const ROW_PAD_R = 16;   /* 行内右边距        */
    const TOGGLE_W  = 67;   /* 开关轨道宽度      */
    const TOGGLE_H  = 26;   /* 开关轨道高度      */
    const KNOB_R    = 11;   /* 旋钮半径          */


    /* ═══════════════════ 几何工具 ═══════════════════ */
    function gBounds(g) {
        if (g._bounding) return [...g._bounding];
        if (g.bounding)  return [...g.bounding];
        const p = g.pos || [0, 0], s = g.size || [0, 0];
        return [p[0], p[1], s[0], s[1]];
    }

    function nBounds(n) {
        const p = n.pos || [0, 0], s = n.size || [100, 60];
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


    /* ═══════════════════ 组数据 ═══════════════════ */
    function rawGroups() {
        const g = app.graph;
        if (!g || !g._groups) return [];
        return g._groups.map(gr => ({
            title:  (gr.title || "").trim() || "Unnamed",
            bounds: gBounds(gr),
            ref:    gr,
        }));
    }

    function visible() {
        let list = rawGroups();
        if (filter.trim()) {
            const kw = filter.trim().toLowerCase();
            list = list.filter(g => g.title.toLowerCase().includes(kw));
        }
        list.sort((a, b) =>
            a.title.localeCompare(b.title, undefined, { sensitivity: "base" })
        );
        return list;
    }

    function collectNodes(grp) {
        const g = app.graph;
        if (!g || !g._nodes) return [];
        const all  = rawGroups();
        const pb   = grp.bounds;
        const rects = [pb];
        all.forEach(ag => {
            if (ag.ref !== grp.ref && inside(ag.bounds, pb)) {
                rects.push(ag.bounds);
            }
        });
        return g._nodes.filter(n => {
            const nb = nBounds(n);
            return rects.some(r => hit(nb, r));
        });
    }


    /* 递归获取所有完全嵌套的子组 */
    function getAllNestedGroups(parentGroup) {
        const all = rawGroups();
        const result = [];
        const visited = new Set();
        visited.add(parentGroup.ref);

        function findNested(parent) {
            all.forEach(ag => {
                if (!visited.has(ag.ref) && inside(ag.bounds, parent.bounds)) {
                    visited.add(ag.ref);
                    result.push(ag);
                    findNested(ag);
                }
            });
        }

        findNested(parentGroup);
        return result;
    }


    /* ═══════════════════ 旁路 / 恢复 ═══════════════════ */
    function bypassGroup(grp)  { collectNodes(grp).forEach(n => { n.mode = 4; }); }
    function restoreGroup(grp) { collectNodes(grp).forEach(n => { n.mode = 0; }); }

    function isNodeActive(n) {
        return n.mode !== 4 && n.mode !== 2 && !n.flags?.disabled;
    }


    /* ═══════════════════ Canvas 绘图辅助 ═══════════════════ */

    function rrect(ctx, x, y, w, h, r) {
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.arcTo(x + w, y, x + w, y + h, r);
        ctx.arcTo(x + w, y + h, x, y + h, r);
        ctx.arcTo(x, y + h, x, y, r);
        ctx.arcTo(x, y, x + w, y, r);
        ctx.closePath();
    }

    function ellipsis(ctx, text, maxW) {
        if (ctx.measureText(text).width <= maxW) return text;
        let t = text;
        while (t.length > 1 && ctx.measureText(t + "…").width > maxW) {
            t = t.slice(0, -1);
        }
        return t + "…";
    }

    /* 齿轮图标 */
    function drawGear(ctx, cx, cy, r) {
        const teeth  = 8;
        const outerR = r;
        const innerR = r * 0.65;
        const holeR  = r * 0.3;
        const step   = (Math.PI * 2) / teeth;
        const q      = step * 0.25;

        ctx.save();
        ctx.beginPath();
        for (let i = 0; i < teeth; i++) {
            const a = i * step - Math.PI / 2;
            if (i === 0) {
                ctx.moveTo(cx + outerR * Math.cos(a - q), cy + outerR * Math.sin(a - q));
            } else {
                ctx.lineTo(cx + outerR * Math.cos(a - q), cy + outerR * Math.sin(a - q));
            }
            ctx.lineTo(cx + outerR * Math.cos(a + q), cy + outerR * Math.sin(a + q));
            const va = a + step / 2;
            ctx.lineTo(cx + innerR * Math.cos(va - q), cy + innerR * Math.sin(va - q));
            ctx.lineTo(cx + innerR * Math.cos(va + q), cy + innerR * Math.sin(va + q));
        }
        ctx.closePath();
        ctx.fillStyle = "rgba(120,120,120,0.15)";
        ctx.fill();
        ctx.strokeStyle = "rgba(120,120,120,0.4)";
        ctx.lineWidth = 1.2;
        ctx.stroke();

        /* 中心孔 */
        ctx.beginPath();
        ctx.arc(cx, cy, holeR, 0, Math.PI * 2);
        ctx.fillStyle = "#2a2a2a";
        ctx.fill();
        ctx.strokeStyle = "rgba(153,153,153,0.6)";
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.restore();
    }


    /* ═══════════════════ 核心刷新 ═══════════════════ */
    let lastSig = "";

    function refresh(forceApply) {
        const list = visible();
        const sig  = list.map(g => g.title).join("\x00");
        const listChanged = (sig !== lastSig);
        lastSig = sig;

        let stateChanged = false;

        if (mode === "default") {
            if (!Array.isArray(activeSet)) {
                activeSet = list.map(g => g.title);
                stateChanged = true;
            } else {
                const titles = new Set(list.map(g => g.title));
                const before = activeSet.length;
                activeSet = activeSet.filter(t => titles.has(t));
                if (activeSet.length !== before) stateChanged = true;
            }
        } else {
            if (active && !list.find(g => g.title === active)) {
                active = (mode === "always_one" && list.length) ? list[0].title : null;
                stateChanged = true;
            }
            if (mode === "always_one" && !active && list.length) {
                active = list[0].title;
                stateChanged = true;
            }
        }

        if (stateChanged) save();

        if (forceApply || stateChanged || listChanged) {
            list.forEach(g => {
                let isOn;
                if (mode === "default") {
                    isOn = activeSet.includes(g.title);
                } else {
                    isOn = (g.title === active);
                }
                if (isOn) restoreGroup(g);
                else      bypassGroup(g);
            });
            try { app.graph.change(); } catch (_) { /* ignore */ }
        }
    }


    /* ═══════════════════ 切换逻辑 ═══════════════════ */
    function handleToggle(title) {
        if (mode === "default") {
            if (!Array.isArray(activeSet)) activeSet = [];

            const list = visible();
            const grp  = list.find(g => g.title === title);
            const idx  = activeSet.indexOf(title);
            const turnOn = idx < 0;

            if (turnOn) {
                if (!activeSet.includes(title)) activeSet.push(title);
                if (grp) {
                    getAllNestedGroups(grp).forEach(ng => {
                        if (!activeSet.includes(ng.title)) activeSet.push(ng.title);
                    });
                }
            } else {
                const offSet = new Set();
                offSet.add(title);
                if (grp) {
                    getAllNestedGroups(grp).forEach(ng => offSet.add(ng.title));
                }
                activeSet = activeSet.filter(t => !offSet.has(t));
            }
        } else if (mode === "always_one") {
            if (active === title) return;
            active = title;
        } else {
            if (active === title) {
                active = null;
            } else {
                active = title;
            }
        }
        save();
        refresh(true);
    }


    /* ═══════════════════ 设置弹窗 ═══════════════════ */
    function showSettings(x, y) {
        const old = document.getElementById("guhai_ig_pop");
        if (old) old.remove();

        const pop = document.createElement("div");
        pop.id = "guhai_ig_pop";
        Object.assign(pop.style, {
            position: "fixed",
            left: Math.min(x, innerWidth  - 280) + "px",
            top:  Math.min(y, innerHeight - 420) + "px",
            background: "#2a2a2a",
            border: "1px solid #555",
            borderRadius: "8px",
            padding: "14px 18px",
            zIndex: "99999",
            minWidth: "250px",
            boxShadow: "0 4px 24px rgba(0,0,0,0.6)",
            color: "#e0e0e0",
            fontFamily: "inherit",
        });

        /* ── 标题 ── */
        const titleEl = document.createElement("div");
        titleEl.textContent = "🎮  忽略多组_孤海 设置";
        Object.assign(titleEl.style, {
            fontSize: "15px", fontWeight: "bold", marginBottom: "14px",
            color: "#e0e0e0",
            borderBottom: "1px solid #444", paddingBottom: "8px",
        });
        pop.appendChild(titleEl);

        /* ── 匹配标题关键词 ── */
        const fLabel = document.createElement("div");
        fLabel.textContent = "匹配标题关键词";
        Object.assign(fLabel.style, {
            fontSize: "13px", fontWeight: "bold", marginBottom: "4px",
        });
        pop.appendChild(fLabel);

        const fInput = document.createElement("input");
        fInput.type = "text";
        fInput.value = filter;
        fInput.placeholder = "留空 = 显示所有组";
        Object.assign(fInput.style, {
            width: "100%", padding: "5px 8px", fontSize: "13px",
            background: "#1a1a1a", border: "1px solid #555", borderRadius: "4px",
            color: "#e0e0e0", outline: "none", boxSizing: "border-box",
            marginBottom: "14px",
        });
        pop.appendChild(fInput);

        /* ── 切换模式 ── */
        const mLabel = document.createElement("div");
        mLabel.textContent = "切换模式";
        Object.assign(mLabel.style, {
            fontSize: "13px", fontWeight: "bold", marginBottom: "4px",
        });
        pop.appendChild(mLabel);

        const mSelect = document.createElement("select");
        Object.assign(mSelect.style, {
            width: "100%", padding: "5px 8px", fontSize: "13px",
            background: "#1a1a1a", border: "1px solid #555", borderRadius: "4px",
            color: "#e0e0e0", outline: "none", boxSizing: "border-box",
            marginBottom: "14px",
        });
        [
            ["default",     "默认"],
            ["always_one",  "始终开启1个"],
            ["at_most_one", "最多开启1个"],
        ].forEach(([val, txt]) => {
            const opt = document.createElement("option");
            opt.value = val;
            opt.textContent = txt;
            mSelect.appendChild(opt);
        });
        mSelect.value = mode;
        pop.appendChild(mSelect);

        /* ── 组名颜色 ── */
        const cLabel = document.createElement("div");
        cLabel.textContent = "组名颜色";
        Object.assign(cLabel.style, {
            fontSize: "13px", fontWeight: "bold", marginBottom: "4px",
        });
        pop.appendChild(cLabel);

        const colorRow = document.createElement("div");
        Object.assign(colorRow.style, {
            display: "flex", alignItems: "center", gap: "8px",
            marginBottom: "16px",
        });

        const cInput = document.createElement("input");
        cInput.type = "color";
        cInput.value = nameColor || "#e0e0e0";
        Object.assign(cInput.style, {
            width: "36px", height: "28px", padding: "0",
            border: "1px solid #555", borderRadius: "4px",
            background: "#1a1a1a", cursor: "pointer",
        });
        colorRow.appendChild(cInput);

        const cHex = document.createElement("input");
        cHex.type = "text";
        cHex.value = nameColor || "#e0e0e0";
        Object.assign(cHex.style, {
            flex: "1", padding: "5px 8px", fontSize: "13px",
            background: "#1a1a1a", border: "1px solid #555", borderRadius: "4px",
            color: "#e0e0e0", outline: "none", boxSizing: "border-box",
        });
        colorRow.appendChild(cHex);

        cInput.addEventListener("input", () => { cHex.value = cInput.value; });
        cHex.addEventListener("input", () => {
            if (/^#[0-9a-fA-F]{6}$/.test(cHex.value)) cInput.value = cHex.value;
        });
        pop.appendChild(colorRow);

        /* ── 按钮 ── */
        const btnRow = document.createElement("div");
        Object.assign(btnRow.style, {
            display: "flex", justifyContent: "flex-end", gap: "8px",
        });

        function makeBtn(text, bg, onClick) {
            const btn = document.createElement("button");
            btn.textContent = text;
            Object.assign(btn.style, {
                padding: "6px 22px", fontSize: "15.6px", background: bg,
                border: "none", borderRadius: "4px", color: "#fff",
                cursor: "pointer",
            });
            btn.addEventListener("click", onClick);
            return btn;
        }

        btnRow.appendChild(makeBtn("关闭", "#606060", () => pop.remove()));
        btnRow.appendChild(makeBtn("应用", "#4CAF50", () => {
            filter    = fInput.value;
            const newMode = mSelect.value;
            nameColor = cInput.value || null;

            if (newMode !== mode) {
                if (newMode === "default") {
                    activeSet = visible().map(g => g.title);
                } else if (newMode === "always_one") {
                    const list = visible();
                    if (activeSet && activeSet.length) {
                        active = activeSet[0];
                    } else if (list.length) {
                        active = list[0].title;
                    } else {
                        active = null;
                    }
                    activeSet = null;
                } else {
                    const list = visible();
                    if (activeSet && activeSet.length) {
                        active = activeSet[0];
                    } else if (mode === "always_one" && active) {
                        /* keep */
                    } else {
                        active = null;
                    }
                    activeSet = null;
                }
                mode = newMode;
            } else {
                mode = newMode;
                if (mode === "always_one" && !active) {
                    const list = visible();
                    if (list.length) active = list[0].title;
                }
            }

            save();
            refresh(true);
            pop.remove();
        }));
        pop.appendChild(btnRow);

        document.body.appendChild(pop);
        fInput.focus();

        setTimeout(() => {
            const handler = (e) => {
                if (!pop.contains(e.target)) {
                    pop.remove();
                    document.removeEventListener("mousedown", handler);
                }
            };
            document.addEventListener("mousedown", handler);
        }, 50);

        pop.addEventListener("contextmenu", (e) => {
            e.preventDefault();
            e.stopPropagation();
        });
    }

    /* 暴露设置函数供右键菜单调用 */
    node._guhaiShowSettings = showSettings;


    /* ═══════════════════ Canvas 自定义 Widget ═══════════════════ */
    let _w = 400, _y = 0;

    node.addCustomWidget({
        name: "guhai_ig",
        type: "ig_custom",

        /* ── 每帧绘制 ── */
        draw(ctx, node, widgetWidth, y, H) {
            _w = widgetWidth;
            _y = y;

            /* ── 齿轮图标（半径 5，宽高各 10 像素） ── */
            const gearCX = widgetWidth - 18;
            const gearCY = y + HEADER_H / 2;
            drawGear(ctx, gearCX, gearCY, 5);

            /* ── 组列表 ── */
            const list = visible();

            if (!list.length) {
                ctx.font = "13px sans-serif";
                ctx.fillStyle = "#888";
                ctx.textAlign = "center";
                ctx.textBaseline = "middle";
                ctx.fillText(
                    filter.trim() ? "无匹配的组" : "工作流中无编组",
                    widgetWidth / 2,
                    y + HEADER_H + 20
                );
                return;
            }

            const effectiveColor = nameColor || "#e0e0e0";

            list.forEach((g, i) => {
                const rowX = PAD_X;
                const rowY = y + HEADER_H + i * (ROW_H + ROW_GAP);
                const rowW = widgetWidth - PAD_X * 2;
                const isOn = mode === "default"
                    ? activeSet.includes(g.title)
                    : g.title === active;

                /* 胶囊背景填充 */
                rrect(ctx, rowX, rowY, rowW, ROW_H, ROW_H / 2);
                ctx.fillStyle = "#2B2F38";
                ctx.fill();

                /* 胶囊边框描边 */
                rrect(ctx, rowX, rowY, rowW, ROW_H, ROW_H / 2);
                ctx.strokeStyle = "#6E7581";
                ctx.lineWidth = 1;
                ctx.stroke();

                /* 开关轨道 */
                const tx = rowX + rowW - ROW_PAD_R - TOGGLE_W;
                const ty = rowY + (ROW_H - TOGGLE_H) / 2;

                ctx.save();
                if (isOn) {
                    ctx.shadowColor = "rgba(76,175,80,0.35)";
                    ctx.shadowBlur = 10;
                    ctx.fillStyle = "#4CAF50";
                } else {
                    ctx.shadowColor = "transparent";
                    ctx.shadowBlur = 0;
                    ctx.fillStyle = "#606060";
                }
                rrect(ctx, tx, ty, TOGGLE_W, TOGGLE_H, TOGGLE_H / 2);
                ctx.fill();
                ctx.restore();

                /* 旋钮 */
                const kx = isOn ? tx + TOGGLE_W - KNOB_R - 3 : tx + KNOB_R + 3;
                const ky = ty + TOGGLE_H / 2;

                ctx.save();
                ctx.shadowColor = "rgba(0,0,0,0.3)";
                ctx.shadowBlur = 4;
                ctx.fillStyle = isOn ? "#ffffff" : "#999999";
                ctx.beginPath();
                ctx.arc(kx, ky, KNOB_R, 0, Math.PI * 2);
                ctx.fill();
                ctx.restore();

                /* 标签文字 —— 开关关闭时标题不透明度变为 50% */
                const textX = rowX + ROW_PAD_L;
                const maxTextW = tx - textX - 10;
                ctx.save();
                ctx.globalAlpha = isOn ? 1.0 : 0.5;
                ctx.font = "bold 20px sans-serif";
                ctx.fillStyle = effectiveColor;
                ctx.textAlign = "left";
                ctx.textBaseline = "middle";
                ctx.fillText(
                    ellipsis(ctx, g.title, maxTextW),
                    textX,
                    rowY + ROW_H / 2
                );
                ctx.restore();
            });
        },

        /* ── 鼠标事件 ── */
        mouse(event, pos, node) {
            if (event.type !== "pointerdown" && event.type !== "mousedown") {
                return false;
            }

            /* pos 为节点局部坐标，转为 widget 内部坐标 */
            const localX = pos[0];
            const localY = pos[1] - _y;

            /* ── 齿轮图标点击（检测半径 7，略大于绘制半径方便点击） ── */
            const gearCX = _w - 18;
            const gearCY = HEADER_H / 2;
            const gdx = localX - gearCX;
            const gdy = localY - gearCY;
            if (gdx * gdx + gdy * gdy < 7 * 7) {
                showSettings(event.clientX, event.clientY);
                return true;
            }

            /* ── 整行点击开关 ── */
            const list = visible();
            for (let i = 0; i < list.length; i++) {
                const rowX = PAD_X;
                const rowY = HEADER_H + i * (ROW_H + ROW_GAP);
                const rowW = _w - PAD_X * 2;

                if (localX >= rowX && localX <= rowX + rowW &&
                    localY >= rowY && localY <= rowY + ROW_H) {
                    handleToggle(list[i].title);
                    return true;
                }
            }

            return false;
        },

        computeSize(width) {
            const cnt = Math.max(visible().length, 1);
            return [400, HEADER_H + cnt * (ROW_H + ROW_GAP) - ROW_GAP + 10];
        },
    });


    /* ═══════════════════ 定时同步 ═══════════════════ */
    let pageVisible = !document.hidden;
    function onVisibilityChange() {
        const nowVisible = !document.hidden;
        if (nowVisible && !pageVisible) {
            pageVisible = true;
            refresh(true);
        } else {
            pageVisible = nowVisible;
        }
    }
    document.addEventListener("visibilitychange", onVisibilityChange);

    const timer = setInterval(() => {
        if (!node.graph) {
            clearInterval(timer);
            document.removeEventListener("visibilitychange", onVisibilityChange);
            return;
        }

        if (!pageVisible) return;

        const list = visible();
        let stateChanged = false;

        if (mode === "default" && Array.isArray(activeSet)) {
            const newSet = [];
            list.forEach(g => {
                const nodes = collectNodes(g);
                if (nodes.length === 0) {
                    if (activeSet.includes(g.title)) newSet.push(g.title);
                    return;
                }

                const wasOn = activeSet.includes(g.title);
                if (wasOn) {
                    const anyActive = nodes.some(n => isNodeActive(n));
                    if (anyActive) {
                        newSet.push(g.title);
                    }
                } else {
                    const allActive = nodes.every(n => isNodeActive(n));
                    if (allActive) {
                        newSet.push(g.title);
                    }
                }
            });

            const oldSorted = [...activeSet].sort().join("\x00");
            const newSorted = [...newSet].sort().join("\x00");
            if (oldSorted !== newSorted) {
                activeSet = newSet;
                stateChanged = true;
            }
        } else if (mode === "always_one" || mode === "at_most_one") {
            let foundActive = null;

            if (active) {
                const currentGrp = list.find(g => g.title === active);
                if (currentGrp) {
                    const nodes = collectNodes(currentGrp);
                    if (nodes.length === 0 || nodes.some(n => isNodeActive(n))) {
                        foundActive = currentGrp.title;
                    }
                }
            }

            if (!foundActive) {
                for (const g of list) {
                    const nodes = collectNodes(g);
                    if (nodes.length > 0 && nodes.every(n => isNodeActive(n))) {
                        foundActive = g.title;
                        break;
                    }
                }
            }

            if (mode === "always_one") {
                if (!foundActive) {
                    foundActive = list.length ? list[0].title : null;
                }
            }
            if (foundActive !== active) {
                active = foundActive;
                stateChanged = true;
            }
        }

        const sig = list.map(g => g.title).join("\x00");
        const listChanged = (sig !== lastSig);

        if (stateChanged) {
            save();
            refresh(true);
        } else if (listChanged) {
            refresh(false);
        }
    }, 3000);


    /* ═══════════════════ 工作流加载后同步 ═══════════════════ */
    node._guhaiSyncGroups = () => {
        filter    = (node.properties && node.properties.guhai_ig_filter)     || "";
        mode      = (node.properties && node.properties.guhai_ig_mode)       || "default";
        active    = (node.properties && node.properties.guhai_ig_active)     || null;
        activeSet = (node.properties && node.properties.guhai_ig_active_set) || null;
        nameColor = (node.properties && node.properties.guhai_ig_name_color) || null;
        lastSig = "";
        refresh(true);
    };


    /* ═══════════════════ 初始构建 ═══════════════════ */
    refresh(false);
}
