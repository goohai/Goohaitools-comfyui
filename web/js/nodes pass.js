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
    },
});


function buildIgnoreGroupsUI(node) {

    /* 状态 */
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


    /* DOM 结构 */
    const root = document.createElement("div");
    Object.assign(root.style, {
        display: "flex",
        flexDirection: "column",
        width: "100%",
        padding: "4px 8px",
        boxSizing: "border-box",
    });

    const listEl = document.createElement("div");
    Object.assign(listEl.style, {
        display: "flex",
        flexDirection: "column",
        width: "100%",
        gap: "15px",
    });
    root.appendChild(listEl);


    /* 几何工具 */
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


    /* 组数据 */
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


    /* 旁路 / 恢复 */
    function bypassGroup(grp)  { collectNodes(grp).forEach(n => { n.mode = 4; }); }
    function restoreGroup(grp) { collectNodes(grp).forEach(n => { n.mode = 0; }); }


    function isNodeActive(n) {
        return n.mode !== 4 && n.mode !== 2 && !n.flags?.disabled;
    }


    /* 核心刷新 */
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

        /* 重建 UI */
        listEl.innerHTML = "";

        if (!list.length) {
            const msg = document.createElement("div");
            Object.assign(msg.style, {
                fontSize: "13px", color: "#888",
                textAlign: "center", padding: "8px 0",
            });
            msg.textContent = filter.trim() ? "无匹配的组" : "工作流中无编组";
            listEl.appendChild(msg);
            return;
        }

        list.forEach(g => {
            let isOn;
            if (mode === "default") {
                isOn = activeSet.includes(g.title);
            } else {
                isOn = (g.title === active);
            }
            listEl.appendChild(buildRow(g.title, isOn));
        });
    }


    /* 构建单个胶囊开关行 */
    function buildRow(title, isOn) {
        const row = document.createElement("div");
        Object.assign(row.style, {
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            width: "100%",
            boxSizing: "border-box",
            border: "1px solid #6E7581",
            borderRadius: "20px",
            padding: "2px 16px 2px 26px",
        });

        const label = document.createElement("span");
        label.textContent = title;
        const effectiveColor = nameColor || "#e0e0e0";
        Object.assign(label.style, {
            fontSize: "20px",
            fontWeight: "bold",
            fontFamily: "inherit",
            color: effectiveColor,
            userSelect: "none",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            flex: "1",
            marginRight: "8px",
            lineHeight: "28px",
        });
        row.appendChild(label);

        const track = document.createElement("div");
        Object.assign(track.style, {
            position: "relative",
            width: "67px",
            height: "26px",
            borderRadius: "13px",
            cursor: "pointer",
            flexShrink: "0",
            transition:
                "background 0.3s cubic-bezier(.4,0,.2,1), box-shadow 0.3s ease",
        });

        const knob = document.createElement("div");
        Object.assign(knob.style, {
            position: "absolute",
            top: "2px",
            width: "22px",
            height: "22px",
            borderRadius: "50%",
            background: "#999999",
            transition:
                "left 0.3s cubic-bezier(.4,0,.2,1), background 0.3s ease",
            boxShadow: "0 1px 4px rgba(0,0,0,0.35)",
        });
        track.appendChild(knob);
        row.appendChild(track);

        function paint(on) {
            if (on) {
                track.style.background = "#4CAF50";
                track.style.boxShadow =
                    "inset 0 1px 3px rgba(0,0,0,0.1), 0 0 10px rgba(76,175,80,0.35)";
                knob.style.left      = "42px";
                knob.style.background = "#ffffff";
            } else {
                track.style.background = "#606060";
                track.style.boxShadow  = "inset 0 1px 3px rgba(0,0,0,0.2)";
                knob.style.left        = "3px";
                knob.style.background  = "#999999";
            }
        }
        paint(isOn);

        track.addEventListener("click", (e) => {
            e.stopPropagation();
            handleToggle(title);
        });

        return row;
    }


    /* 切换逻辑 */
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


    /* 右键设置弹窗 */
    function showSettings(x, y) {
        const old = document.getElementById("guhai_ig_pop");
        if (old) old.remove();

        const pop = document.createElement("div");
        pop.id = "guhai_ig_pop";
        Object.assign(pop.style, {
            position: "fixed",
            left: Math.min(x, innerWidth  - 280) + "px",
            top:  Math.min(y, innerHeight - 380) + "px",
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

        /* 匹配标题 */
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

        /* 切换模式 */
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

        /* 组名颜色 */
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

        /* 按钮 */
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

    root.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        e.stopPropagation();
        showSettings(e.clientX, e.clientY);
    });


    /* 注册 DOM Widget */
    const widget = node.addDOMWidget("guhai_ig", "guhai_ig", root, {
        serialize: false,
    });

    widget.computeSize = function () {
        const cnt = Math.max(visible().length, 1);
        return [400, cnt * 49 + 10];
    };


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

                // ★ 非对称判断逻辑：
                //   - OFF → ON：组内所有节点都活跃时才开启（every）
                //   - ON → OFF：组内所有节点都不活跃时才关闭（!some）
                //   只要还有至少一个节点活跃，组开关就保持不变
                const wasOn = activeSet.includes(g.title);
                if (wasOn) {
                    // 组当前是开启的：只有全部节点都不活跃才关闭
                    const anyActive = nodes.some(n => isNodeActive(n));
                    if (anyActive) {
                        newSet.push(g.title);
                    }
                } else {
                    // 组当前是关闭的：只有全部节点都活跃才开启
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

            // 优先检查当前活跃组：只要还有至少一个节点活跃就保持不变
            if (active) {
                const currentGrp = list.find(g => g.title === active);
                if (currentGrp) {
                    const nodes = collectNodes(currentGrp);
                    if (nodes.length === 0 || nodes.some(n => isNodeActive(n))) {
                        foundActive = currentGrp.title;
                    }
                }
            }

            // 如果当前活跃组已全部关闭（或无活跃组），寻找全部节点都活跃的组
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


    /* 工作流加载后同步 */
    node._guhaiSyncGroups = () => {
        filter    = (node.properties && node.properties.guhai_ig_filter)     || "";
        mode      = (node.properties && node.properties.guhai_ig_mode)       || "default";
        active    = (node.properties && node.properties.guhai_ig_active)     || null;
        activeSet = (node.properties && node.properties.guhai_ig_active_set) || null;
        nameColor = (node.properties && node.properties.guhai_ig_name_color) || null;
        lastSig = "";
        refresh(true);
    };


    /* 初始构建 */
    refresh(false);
}
