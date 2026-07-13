frappe.pages["document-traceability"].on_page_load = function (wrapper) {
	const page = frappe.ui.make_app_page({
		parent: wrapper,
		title: "Document Traceability",
		single_column: true,
	});
	new DocTraceView(page);
};

// ─── Dagre loader (same pattern as batch_traceability) ──────────────────────
let _dagre_loading = null;
function load_dagre() {
	if (window.dagre) return Promise.resolve();
	if (_dagre_loading) return _dagre_loading;
	_dagre_loading = frappe.require("dagre.bundle.js").then(() => {
		if (!window.dagre) throw new Error("dagre failed to load");
	});
	return _dagre_loading;
}

// ─── Doctype metadata ───────────────────────────────────────────────────────
const DOCTYPE_CFG = {
	"Sales Order":      { abbrev: "SO", color: "#2490EF" },
	"Delivery Note":    { abbrev: "DN", color: "#36B37E" },
	"Sales Invoice":    { abbrev: "SI", color: "#FF8B00" },
	"Material Request": { abbrev: "MR", color: "#6554C0" },
	"Purchase Order":   { abbrev: "PO", color: "#DE350B" },
	"Purchase Receipt": { abbrev: "PR", color: "#00B8D9" },
	"Purchase Invoice": { abbrev: "PI", color: "#FF5630" },
};

function doc_color(doctype) {
	return (DOCTYPE_CFG[doctype] || {}).color || "#888888";
}
function doc_abbrev(doctype) {
	return (DOCTYPE_CFG[doctype] || {}).abbrev || doctype.slice(0, 2).toUpperCase();
}

// ─── Main view class ────────────────────────────────────────────────────────
class DocTraceView {
	constructor(page) {
		this.page = page;
		this.current_doctype = null;
		this.current_docname = null;
		this.graph_nodes = [];  // flat array from API
		this.graph_edges = [];  // flat array from API
		this.canvas = null;
		this._suppressClick = false;

		this.inject_styles();
		this.render_layout();
		this.bind_events();

		// Auto-trace when opened via frappe.route_options (from a doctype button)
		const opts = frappe.route_options || {};
		if (opts.doctype && opts.docname) {
			this.current_doctype = opts.doctype;
			this.current_docname = opts.docname;
			frappe.route_options = {};
			this.page.set_title(`Trace: ${opts.docname}`);
			this.$doc_label.text(`${doc_abbrev(opts.doctype)} · ${opts.docname}`);
			this.run_trace();
		}
	}

	// ── Styles ───────────────────────────────────────────────────────────────
	inject_styles() {
		if (document.getElementById("dt-page-styles")) return;
		const css = `
			.dt-root {
				--dt-accent: #4f46e5;
				--dt-radius: 12px;
				--dt-gap: 16px;
				display: flex;
				flex-direction: column;
				height: calc(100vh - 142px);
				min-height: 480px;
			}
			.page-body:has(.dt-root) .container,
			.page-body:has(.dt-root) .page-wrapper .container { max-width: none; }
			.dt-card {
				background: var(--card-bg, var(--fg-color, #fff));
				border: 1px solid var(--border-color, #e5e7eb);
				border-radius: var(--dt-radius);
				box-shadow: 0 1px 2px rgba(0,0,0,.04), 0 4px 16px rgba(0,0,0,.06);
			}
			.dt-header {
				display: flex;
				align-items: center;
				gap: 12px;
				padding: 12px 18px;
				margin-bottom: var(--dt-gap);
				flex: 0 0 auto;
			}
			.dt-doc-label {
				font-weight: 600;
				font-size: 14px;
				color: var(--text-color, #1f2937);
				flex: 1;
			}
			.dt-btn {
				border: none;
				border-radius: 8px;
				padding: 7px 16px;
				font-weight: 600;
				font-size: 13px;
				background: var(--dt-accent);
				color: #fff;
				cursor: pointer;
				transition: filter .12s ease, transform .02s ease;
			}
			.dt-btn:hover { filter: brightness(1.07); }
			.dt-btn:active { transform: translateY(1px); }
			.dt-btn[disabled] { opacity: .5; cursor: not-allowed; }
			.dt-stage-wrap {
				position: relative;
				flex: 1;
				min-height: 0;
				overflow: hidden;
			}
			.dt-stage {
				position: absolute;
				inset: 0;
				color: var(--text-muted, #6b7280);
				overflow: hidden;
			}
			.dt-stage.is-empty {
				display: flex;
				align-items: center;
				justify-content: center;
				font-size: 14px;
			}
			.dt-svg { position: absolute; inset: 0; cursor: grab; user-select: none; }
			.dt-svg.is-panning { cursor: grabbing; }
			.dt-svg.is-grabbing { cursor: grabbing; }
			.dt-zoom {
				position: absolute;
				right: 14px;
				bottom: 14px;
				z-index: 5;
				display: flex;
				flex-direction: column;
				gap: 4px;
			}
			.dt-zoom button {
				width: 30px; height: 30px;
				border: 1px solid var(--border-color, #e5e7eb);
				background: var(--fg-color, #fff);
				border-radius: 8px;
				font-size: 16px; line-height: 1;
				cursor: pointer;
				box-shadow: 0 1px 2px rgba(0,0,0,.06);
			}
			.dt-zoom button:hover { background: var(--control-bg, #f3f4f6); }
			.dt-badge {
				position: absolute;
				top: 12px;
				left: 14px;
				z-index: 5;
				font-size: 12px;
				color: var(--text-muted, #6b7280);
				background: var(--fg-color, #fff);
				border: 1px solid var(--border-color, #e5e7eb);
				border-radius: 999px;
				padding: 4px 12px;
			}
			.dt-legend {
				position: absolute;
				top: 12px;
				right: 14px;
				z-index: 5;
				display: flex;
				align-items: center;
				gap: 8px;
				flex-wrap: wrap;
				max-width: 55%;
				justify-content: flex-end;
				font-size: 11px;
				color: var(--text-muted, #6b7280);
				background: var(--fg-color, #fff);
				border: 1px solid var(--border-color, #e5e7eb);
				border-radius: 999px;
				padding: 4px 12px;
			}
			.dt-legend-item { display: flex; align-items: center; gap: 4px; }
			.dt-legend-dot {
				width: 10px; height: 10px;
				border-radius: 50%;
				display: inline-block;
				flex-shrink: 0;
			}
			.dt-node { cursor: pointer; }
			.dt-node:hover rect { filter: brightness(0.93); }
			.dt-node.is-root rect { stroke-width: 3; }
			/* Side panel */
			.dt-panel {
				position: absolute;
				top: 0; right: 0; bottom: 0;
				width: 300px;
				max-width: 80%;
				z-index: 10;
				background: var(--fg-color, #fff);
				border-left: 1px solid var(--border-color, #e5e7eb);
				box-shadow: -8px 0 24px rgba(0,0,0,.08);
				overflow-y: auto;
				transform: translateX(0);
				transition: transform .18s ease;
			}
			.dt-panel[hidden] { display: block; transform: translateX(100%); }
			.dt-panel-head {
				display: flex;
				align-items: flex-start;
				justify-content: space-between;
				gap: 8px;
				padding: 16px 18px 12px;
				border-bottom: 1px solid var(--border-color, #e5e7eb);
			}
			.dt-panel-abbrev {
				display: inline-block;
				padding: 2px 8px;
				border-radius: 5px;
				font-size: 11px;
				font-weight: 700;
				letter-spacing: .05em;
				color: #fff;
				margin-bottom: 6px;
			}
			.dt-panel-title { font-weight: 600; font-size: 15px; }
			.dt-panel-sub { font-size: 12px; color: var(--text-muted, #6b7280); margin-top: 2px; }
			.dt-panel-close {
				border: none; background: none; cursor: pointer;
				font-size: 20px; line-height: 1; color: var(--text-muted, #6b7280);
				padding: 0 4px; flex-shrink: 0;
			}
			.dt-panel-close:hover { color: var(--text-color, #1f2937); }
			.dt-panel-body { padding: 14px 18px; }
			.dt-open-btn {
				display: inline-flex;
				align-items: center;
				gap: 6px;
				padding: 8px 16px;
				border-radius: 8px;
				font-size: 13px;
				font-weight: 600;
				text-decoration: none;
				color: #fff;
				margin-top: 4px;
			}
			.dt-open-btn:hover { filter: brightness(1.08); color: #fff; }
		`;
		const tag = document.createElement("style");
		tag.id = "dt-page-styles";
		tag.textContent = css;
		document.head.appendChild(tag);
	}

	// ── Layout ───────────────────────────────────────────────────────────────
	render_layout() {
		this.page.main.html(`
			<div class="dt-root">
				<div class="dt-card dt-header">
					<span class="dt-doc-label">Open any supported document and click <b>Visualize</b> to trace it here.</span>
					<button class="dt-btn dt-retrace" disabled>Re-trace</button>
				</div>
				<div class="dt-card dt-stage-wrap">
					<div class="dt-stage is-empty">No trace loaded.</div>
					<aside class="dt-panel" hidden></aside>
				</div>
			</div>
		`);

		const $root = this.page.main.find(".dt-root");
		this.$doc_label = $root.find(".dt-doc-label");
		this.$retrace   = $root.find(".dt-retrace");
		this.$stage     = $root.find(".dt-stage");
		this.$panel     = $root.find(".dt-panel");
	}

	// ── Events ───────────────────────────────────────────────────────────────
	bind_events() {
		this.$retrace.on("click", () => this.run_trace());

		this.$stage.on("click", ".dt-node", (e) => {
			if (this._suppressClick) { this._suppressClick = false; return; }
			const grp = e.currentTarget;
			const node_id = grp.getAttribute("data-node-id");
			if (!node_id) return;
			const node = this.graph_nodes.find(n => n.id === node_id);
			if (node) this.show_panel(node);
		});
	}

	// ── Trace ────────────────────────────────────────────────────────────────
	run_trace() {
		if (!this.current_doctype || !this.current_docname) return;
		this.$retrace.prop("disabled", true);
		this.set_stage_message("Tracing…");
		this.hide_panel();

		frappe.call({
			method: "ampower_visualize.ampower_visualize.page.document_traceability.document_traceability.get_document_trace",
			args: {
				doctype: this.current_doctype,
				docname: this.current_docname,
			},
			callback: ({ message }) => {
				if (!message) return;
				this.graph_nodes = message.nodes || [];
				this.graph_edges = message.edges || [];

				if (!this.graph_nodes.length) {
					this.set_stage_message("No linked documents found.");
					return;
				}

				this.set_stage_message("Rendering…");
				load_dagre()
					.then(() => this.render_graph())
					.catch((err) => {
						console.error(err);
						this.set_stage_message("Could not load the layout engine.");
					});
			},
			error: () => this.set_stage_message("Trace failed. Please try again."),
			always: () => this.$retrace.prop("disabled", false),
		});
	}

	set_stage_message(text) {
		this.hide_panel();
		this.$stage.addClass("is-empty").html(frappe.utils.escape_html(text));
	}

	// ── Graph rendering ──────────────────────────────────────────────────────
	render_graph() {
		const layout = this.compute_layout();
		if (!layout) return;

		const root_id = this.graph_nodes.length
			? `${this.current_doctype}||${this.current_docname}`
			: null;

		this.$stage
			.removeClass("is-empty")
			.html(
				`<div class="dt-badge">${frappe.utils.escape_html(this.badge_text())}</div>` +
				`<div class="dt-zoom">
					<button data-z="in" title="Zoom in">+</button>
					<button data-z="out" title="Zoom out">−</button>
					<button data-z="fit" title="Fit to screen">⤢</button>
				</div>`
			)
			.append(this.build_svg(layout, root_id));

		this.wire_canvas();
		this.render_legend();
		this.fit();
	}

	badge_text() {
		const n = this.graph_nodes.length;
		const e = this.graph_edges.length;
		return `${n} document${n === 1 ? "" : "s"} · ${e} link${e === 1 ? "" : "s"}`;
	}

	compute_layout() {
		const NODE_W = 164;
		const NODE_H = 52;

		const g = new window.dagre.graphlib.Graph();
		g.setGraph({ rankdir: "LR", ranksep: 120, nodesep: 40, marginx: 32, marginy: 32 });
		g.setDefaultEdgeLabel(() => ({}));

		for (const n of this.graph_nodes) {
			g.setNode(n.id, { meta: n, width: NODE_W, height: NODE_H });
		}
		for (const e of this.graph_edges) {
			if (g.hasNode(e.from) && g.hasNode(e.to)) {
				g.setEdge(e.from, e.to, { label: e.label || "", dashed: !!e.dashed });
			}
		}
		window.dagre.layout(g);
		return { g, width: g.graph().width, height: g.graph().height };
	}

	build_svg(layout, root_id) {
		const { g, width, height } = layout;
		const SVGNS = "http://www.w3.org/2000/svg";
		const make  = (tag, attrs = {}) => {
			const el = document.createElementNS(SVGNS, tag);
			for (const k in attrs) el.setAttribute(k, attrs[k]);
			return el;
		};

		const svg      = make("svg", { class: "dt-svg", width: "100%", height: "100%" });
		const defs     = make("defs");
		const viewport = make("g", { class: "dt-viewport" });

		// Build arrow-head markers for each doctype color + dashed style
		const used_colors = new Set();
		for (const e of g.edges()) {
			const meta = g.edge(e);
			const from_node = g.node(e.v);
			const color = from_node ? doc_color(from_node.meta.doctype) : "#888";
			used_colors.add(color);
		}
		used_colors.add("#aaa"); // dashed edges

		for (const color of used_colors) {
			const mid = color.replace("#", "");
			const marker = make("marker", {
				id: `dt-arrow-${mid}`,
				viewBox: "0 0 10 10",
				refX: "9", refY: "5",
				markerWidth: "7", markerHeight: "7",
				orient: "auto-start-reverse",
			});
			marker.appendChild(make("path", { d: "M0,0 L10,5 L0,10 z", fill: color }));
			defs.appendChild(marker);
		}
		svg.appendChild(defs);
		svg.appendChild(viewport);

		const edgeEls  = [];
		const nodeEls  = new Map();

		// ── Draw edges ───────────────────────────────────────────────────────
		for (const e of g.edges()) {
			const meta       = g.edge(e);
			const from_node  = g.node(e.v);
			const is_dashed  = !!meta.dashed;
			const color      = is_dashed ? "#aaa" : (from_node ? doc_color(from_node.meta.doctype) : "#888");
			const mid_hex    = color.replace("#", "");

			const path = make("path", {
				class: "dt-edge",
				d: this.edge_path(g.edge(e).points),
				fill: "none",
				stroke: color,
				"stroke-width": "1.5",
				"stroke-opacity": is_dashed ? "0.6" : "0.8",
				"stroke-dasharray": is_dashed ? "5 3" : "none",
				"marker-end": `url(#dt-arrow-${mid_hex})`,
				"data-from": e.v,
				"data-to": e.w,
			});
			viewport.appendChild(path);
			edgeEls.push({ path, v: e.v, w: e.w });

		}

		// ── Draw nodes ───────────────────────────────────────────────────────
		for (const id of g.nodes()) {
			const n    = g.node(id);
			const meta = n.meta;
			const w    = n.width;
			const h    = n.height;
			const is_root  = id === root_id;
			const color    = doc_color(meta.doctype);
			const abbrev   = doc_abbrev(meta.doctype);

			const fill   = is_root ? color : `${color}18`;
			const stroke = color;

			const grp = make("g", {
				class: `dt-node${is_root ? " is-root" : ""}`,
				transform: `translate(${(n.x - w / 2).toFixed(1)},${(n.y - h / 2).toFixed(1)})`,
				"data-node-id": id,
			});
			grp.__dt_id = id;

			// Card background
			grp.appendChild(make("rect", {
				width: w, height: h,
				rx: "9",
				fill,
				stroke,
				"stroke-width": is_root ? "2.5" : "1.5",
			}));

			// Abbrev tag (top strip)
			const TAG_H = 16;
			grp.appendChild(make("rect", {
				width: w, height: TAG_H,
				rx: "9",
				fill: color,
			}));
			// square off the bottom corners of the tag
			grp.appendChild(make("rect", {
				y: TAG_H / 2,
				width: w, height: TAG_H / 2,
				fill: color,
			}));

			const tag_lbl = make("text", {
				x: w / 2, y: TAG_H / 2,
				"text-anchor": "middle",
				"dominant-baseline": "central",
				"font-size": "8",
				"font-weight": "700",
				"letter-spacing": "0.1em",
				fill: "#fff",
			});
			tag_lbl.textContent = abbrev;
			grp.appendChild(tag_lbl);

			// Document name
			const name_lbl = make("text", {
				x: w / 2,
				y: TAG_H + (h - TAG_H) / 2 - (meta.status ? 6 : 0),
				"text-anchor": "middle",
				"dominant-baseline": "central",
				"font-size": "11",
				"font-weight": is_root ? "700" : "500",
				fill: is_root ? color : "#1f2937",
			});
			// Truncate long names
			name_lbl.textContent = meta.name.length > 22
				? meta.name.slice(0, 20) + "…"
				: meta.name;
			grp.appendChild(name_lbl);

			// Status
			if (meta.status) {
				const status_lbl = make("text", {
					x: w / 2,
					y: TAG_H + (h - TAG_H) / 2 + 10,
					"text-anchor": "middle",
					"dominant-baseline": "central",
					"font-size": "8.5",
					fill: is_root ? color : "#9aa1ad",
				});
				status_lbl.textContent = meta.status;
				grp.appendChild(status_lbl);
			}

			viewport.appendChild(grp);
			nodeEls.set(id, { grp, x: n.x, y: n.y, width: w, height: h });
		}

		this.canvas = {
			svg, viewport, edgeEls, nodeEls,
			contentW: width, contentH: height,
			tx: 0, ty: 0, k: 1,
		};
		return svg;
	}

	// Catmull-Rom spline through dagre waypoints (same as batch_traceability)
	edge_path(points) {
		const p = points;
		const f = (v) => v.toFixed(1);
		if (p.length < 3) {
			return p.map((q, i) => `${i === 0 ? "M" : "L"}${f(q.x)},${f(q.y)}`).join(" ");
		}
		let d = `M${f(p[0].x)},${f(p[0].y)}`;
		for (let i = 0; i < p.length - 1; i++) {
			const p0 = p[i - 1] || p[i];
			const p1 = p[i];
			const p2 = p[i + 1];
			const p3 = p[i + 2] || p2;
			const c1x = p1.x + (p2.x - p0.x) / 6;
			const c1y = p1.y + (p2.y - p0.y) / 6;
			const c2x = p2.x - (p3.x - p1.x) / 6;
			const c2y = p2.y - (p3.y - p1.y) / 6;
			d += ` C${f(c1x)},${f(c1y)} ${f(c2x)},${f(c2y)} ${f(p2.x)},${f(p2.y)}`;
		}
		return d;
	}

	// ── Legend ───────────────────────────────────────────────────────────────
	render_legend() {
		const stageEl = this.$stage.get(0);
		if (!stageEl) return;
		const doctypes_seen = [...new Set(this.graph_nodes.map(n => n.doctype))];
		if (!doctypes_seen.length) return;

		let legend = stageEl.querySelector(".dt-legend");
		if (!legend) {
			legend = document.createElement("div");
			legend.className = "dt-legend";
			stageEl.appendChild(legend);
		}
		const esc = frappe.utils.escape_html;
		legend.innerHTML = doctypes_seen.map(dt => {
			const color = doc_color(dt);
			const abbrev = doc_abbrev(dt);
			return `<span class="dt-legend-item">
				<span class="dt-legend-dot" style="background:${esc(color)}"></span>
				${esc(abbrev)}
			</span>`;
		}).join("");
	}

	// ── Side panel ───────────────────────────────────────────────────────────
	show_panel(node) {
		const color  = doc_color(node.doctype);
		const abbrev = doc_abbrev(node.doctype);
		const esc    = frappe.utils.escape_html;

		this.$panel.html(`
			<div class="dt-panel-head">
				<div>
					<span class="dt-panel-abbrev" style="background:${esc(color)}">${esc(abbrev)}</span>
					<div class="dt-panel-title">${esc(node.name)}</div>
					<div class="dt-panel-sub">${esc(node.doctype)}${node.status ? " · " + esc(node.status) : ""}</div>
				</div>
				<button class="dt-panel-close" title="Close">&times;</button>
			</div>
			<div class="dt-panel-body">
				<a class="dt-open-btn" href="${esc(node.url)}" target="_blank"
					style="background:${esc(color)}">
					Open document ↗
				</a>
			</div>
		`).prop("hidden", false);

		this.$panel.find(".dt-panel-close").on("click", () => this.hide_panel());
	}

	hide_panel() {
		this.$panel.prop("hidden", true).empty();
	}

	// ── Canvas interactions (pan / zoom / drag — same as batch_traceability) ─
	wire_canvas() {
		const c    = this.canvas;
		const $svg = $(c.svg);
		$(window).off("mousemove.dt mouseup.dt");

		this.$stage.find(".dt-zoom button").on("click", (e) => {
			const z = e.currentTarget.getAttribute("data-z");
			if (z === "in")       this.zoom_by(1.2);
			else if (z === "out") this.zoom_by(1 / 1.2);
			else                  this.fit();
		});

		$svg.on("wheel", (e) => {
			e.preventDefault();
			const rect   = c.svg.getBoundingClientRect();
			const factor = e.originalEvent.deltaY < 0 ? 1.1 : 1 / 1.1;
			this.zoom_by(factor, e.clientX - rect.left, e.clientY - rect.top);
		});

		let mode = null, startX = 0, startY = 0, moved = false, dragNode = null;
		this._suppressClick = false;

		$svg.on("mousedown", (e) => {
			if (e.button !== 0) return;
			const grp = e.target.closest(".dt-node");
			startX = e.clientX; startY = e.clientY; moved = false;
			if (grp && c.nodeEls.has(grp.__dt_id)) {
				mode = "node";
				const id = grp.__dt_id;
				const nd = c.nodeEls.get(id);
				dragNode = { id, ox: nd.x, oy: nd.y };
				$svg.addClass("is-grabbing");
			} else {
				mode = "pan"; dragNode = null;
				$svg.addClass("is-panning");
			}
		});

		$(window).on("mousemove.dt", (e) => {
			if (!mode) return;
			const dx = e.clientX - startX;
			const dy = e.clientY - startY;
			if (!moved && Math.abs(dx) + Math.abs(dy) > 3) moved = true;
			if (mode === "pan") {
				c.tx += dx; c.ty += dy;
				startX = e.clientX; startY = e.clientY;
				this.apply_transform();
			} else if (mode === "node" && dragNode) {
				const nd = c.nodeEls.get(dragNode.id);
				nd.x = dragNode.ox + dx / c.k;
				nd.y = dragNode.oy + dy / c.k;
				nd.grp.setAttribute(
					"transform",
					`translate(${(nd.x - nd.width / 2).toFixed(1)},${(nd.y - nd.height / 2).toFixed(1)})`
				);
				this.reroute_edges(dragNode.id);
			}
		});

		$(window).on("mouseup.dt", () => {
			if (moved) this._suppressClick = true;
			mode = null; dragNode = null;
			$svg.removeClass("is-panning is-grabbing");
		});
	}

	reroute_edges(movedId) {
		const c = this.canvas;
		for (const e of c.edgeEls) {
			if (e.v !== movedId && e.w !== movedId) continue;
			const a = c.nodeEls.get(e.v);
			const b = c.nodeEls.get(e.w);
			if (!a || !b) continue;
			const start = this.border_point(a, b.x, b.y);
			const end   = this.border_point(b, a.x, a.y);
			e.path.setAttribute(
				"d",
				`M${start.x.toFixed(1)},${start.y.toFixed(1)} L${end.x.toFixed(1)},${end.y.toFixed(1)}`
			);
		}
	}

	border_point(n, tx, ty) {
		const dx = tx - n.x, dy = ty - n.y;
		if (!dx && !dy) return { x: n.x, y: n.y };
		const hw = n.width / 2, hh = n.height / 2;
		const scale = 1 / Math.max(Math.abs(dx) / hw, Math.abs(dy) / hh);
		return { x: n.x + dx * scale, y: n.y + dy * scale };
	}

	apply_transform() {
		const c = this.canvas;
		c.viewport.setAttribute(
			"transform",
			`translate(${c.tx.toFixed(2)},${c.ty.toFixed(2)}) scale(${c.k.toFixed(4)})`
		);
	}

	fit() {
		const c    = this.canvas;
		const rect = c.svg.getBoundingClientRect();
		if (!rect.width || !c.contentW) return;
		const pad = 40;
		const k   = Math.min(
			(rect.width  - pad * 2) / c.contentW,
			(rect.height - pad * 2) / c.contentH
		);
		c.k  = Math.max(0.05, Math.min(k, 1.5));
		c.tx = (rect.width  - c.contentW * c.k) / 2;
		c.ty = (rect.height - c.contentH * c.k) / 2;
		this.apply_transform();
	}

	zoom_by(factor, cx, cy) {
		const c    = this.canvas;
		const rect = c.svg.getBoundingClientRect();
		if (cx == null) { cx = rect.width / 2; cy = rect.height / 2; }
		const newK = Math.max(0.05, Math.min(c.k * factor, 4));
		c.tx = cx - ((cx - c.tx) / c.k) * newK;
		c.ty = cy - ((cy - c.ty) / c.k) * newK;
		c.k  = newK;
		this.apply_transform();
	}
}