// Copyright (c) 2026, Ambibuzz Technologies LLP and contributors
// For license information, please see license.txt

// Doctype display config

const DOCTYPE_CFG = {
	"Sales Order":      { abbrev: "SO",  color: "#2490EF" },
	"Delivery Note":    { abbrev: "DN",  color: "#36B37E" },
	"Sales Invoice":    { abbrev: "SI",  color: "#FF8B00" },
	"Material Request": { abbrev: "MR",  color: "#FF5630" },
	"Purchase Order":   { abbrev: "PO",  color: "#36B37E" },
	"Purchase Receipt": { abbrev: "PR",  color: "#00B8D9" },
	"Purchase Invoice": { abbrev: "PI",  color: "#6554C0" },
	"Production Plan":  { abbrev: "PP",  color: "#8993A4" },
	"Work Order":       { abbrev: "WO",  color: "#42526E" },
	"Job Card":         { abbrev: "JC",  color: "#B8ACF6" },
	"Stock Entry":      { abbrev: "SE",  color: "#F4A261" },
};

/** Deep blue for the root node — must be distinct from every doctype colour. */
const ROOT_NODE_COLOR = "#1565C0";

/** Hot pink for item-row nodes (SOI, MRI, POI …). */
const ITEM_ROLE_COLOR = "#e91e8c";

/** Legend entries rendered in the top-left overlay. */
const LEGEND_CFG = [
	{ label: "Root Document",    color: ROOT_NODE_COLOR },
	{ label: "Sales Order",      color: DOCTYPE_CFG["Sales Order"].color },
	{ label: "Sales Order Item", color: ITEM_ROLE_COLOR },
	{ label: "Sales Invoice",    color: DOCTYPE_CFG["Sales Invoice"].color },
	{ label: "Delivery Note",    color: DOCTYPE_CFG["Delivery Note"].color },
	{ label: "Material Request", color: DOCTYPE_CFG["Material Request"].color },
	{ label: "Purchase Order",   color: DOCTYPE_CFG["Purchase Order"].color },
	{ label: "Purchase Invoice", color: DOCTYPE_CFG["Purchase Invoice"].color },
	{ label: "Purchase Receipt", color: DOCTYPE_CFG["Purchase Receipt"].color },
];

/** Return the colour for a doctype, falling back to grey. */
function dt_color(doctype) {
	return (DOCTYPE_CFG[doctype] || {}).color || "#8993A4";
}

/** Return the two/three-letter abbreviation for a doctype. */
function dt_abbrev(doctype) {
	return (DOCTYPE_CFG[doctype] || {}).abbrev || doctype.substring(0, 2).toUpperCase();
}

// Frappe page lifecycle

frappe.pages["document-traceability"].on_page_load = function (wrapper) {
	const page = frappe.ui.make_app_page({
		parent: wrapper,
		title: "Document Traceability",
		single_column: true,
	});
	wrapper._dt_view = new DocTraceView(page);
};

frappe.pages["document-traceability"].on_page_show = function (wrapper) {
	const opts = frappe.route_options || {};
	const view = wrapper._dt_view;
	if (!view) return;
	if (opts.doctype && opts.docname) {
		frappe.route_options = {};
		view.set_doc(opts.doctype, opts.docname);
	}
};

frappe.pages["document-traceability"].on_page_leave = function () {
	$(window).off("mousemove.dt mouseup.dt");
};

// Main view class

class DocTraceView {
	constructor(page) {
		this.page    = page;
		this.doctype = null;
		this.docname = null;
		this._build_toolbar();
		this._build_canvas();
	}

	// Toolbar

	_build_toolbar() {
		this.page.add_button(__("Re-trace"), () => this.run_trace(),
			{ icon: "es-line-reload" });
	}

	// Canvas + interaction setup

	_build_canvas() {
		this.$wrap = $(`
			<div style="position:relative;overflow:hidden;background:#f8f9fb;
				border-radius:6px;height:calc(100vh - 140px);cursor:grab;user-select:none">
				<svg id="dt-svg" style="position:absolute;top:0;left:0;
					width:100%;height:100%;overflow:visible"></svg>
				<div id="dt-panel" style="display:none;position:absolute;top:12px;right:12px;
					width:280px;background:#fff;border:1px solid #d1d8dd;border-radius:6px;
					box-shadow:0 4px 12px rgba(0,0,0,.08);padding:16px;font-size:12px;
					max-height:calc(100% - 24px);overflow-y:auto;z-index:10"></div>
				<div id="dt-zoom-ctrl" style="position:absolute;bottom:16px;right:16px;z-index:5;
					display:flex;flex-direction:column;gap:3px;
					background:rgba(255,255,255,0.92);border:1px solid #e2e8f0;
					border-radius:8px;padding:4px;box-shadow:0 2px 8px rgba(0,0,0,.10);">
					<button id="dt-zoom-in"    title="Zoom in"   style="width:28px;height:28px;border:none;background:transparent;border-radius:5px;cursor:pointer;font-size:16px;line-height:1;color:#374151;display:flex;align-items:center;justify-content:center;">+</button>
					<button id="dt-zoom-fit"   title="Fit graph" style="width:28px;height:28px;border:none;background:transparent;border-radius:5px;cursor:pointer;font-size:13px;line-height:1;color:#374151;display:flex;align-items:center;justify-content:center;">⊙</button>
					<button id="dt-zoom-out"   title="Zoom out"  style="width:28px;height:28px;border:none;background:transparent;border-radius:5px;cursor:pointer;font-size:16px;line-height:1;color:#374151;display:flex;align-items:center;justify-content:center;">−</button>
				</div>
			</div>
		`).appendTo($(this.page.body));

		this.$svg   = this.$wrap.find("#dt-svg");
		this.$panel = this.$wrap.find("#dt-panel");

		// Zoom button helpers — zoom centred on canvas midpoint
		const _zoom_btn = (factor) => {
			const cw = this.$wrap[0].offsetWidth;
			const ch = this.$wrap[0].offsetHeight;
			const cx = cw / 2, cy = ch / 2;
			this._vp.x = cx - factor * (cx - this._vp.x);
			this._vp.y = cy - factor * (cy - this._vp.y);
			this._vp.scale *= factor;
			this._apply_vp();
		};
		this.$wrap.find("#dt-zoom-in" ).on("click", (e) => { e.stopPropagation(); _zoom_btn(1.25); });
		this.$wrap.find("#dt-zoom-out").on("click", (e) => { e.stopPropagation(); _zoom_btn(1 / 1.25); });
		this.$wrap.find("#dt-zoom-fit").on("click", (e) => {
			e.stopPropagation();
			if (this._fit_vp) { this._vp = { ...this._fit_vp }; this._apply_vp(); }
		});

		// Highlight zoom buttons on hover
		this.$wrap.find("#dt-zoom-ctrl button").on("mouseenter", function() {
			$(this).css("background", "#f1f5f9");
		}).on("mouseleave", function() {
			$(this).css("background", "transparent");
		});

		/**
		 * Viewport state — the SVG root group is transformed as:
		 *   translate(vp.x, vp.y) scale(vp.scale)
		 * so a node at SVG (nx, ny) appears at screen (vp.x + nx*scale, vp.y + ny*scale).
		 */
		this._vp        = { x: 0, y: 0, scale: 1 };
		this._drag      = null;
		this._node_drag = null;

		// Zoom centred on cursor position
		this.$wrap.on("wheel", (e) => {
			e.preventDefault();
			const delta = e.originalEvent.deltaY < 0 ? 1.1 : 0.9;
			const rect  = this.$wrap[0].getBoundingClientRect();
			const mx    = e.originalEvent.clientX - rect.left;
			const my    = e.originalEvent.clientY - rect.top;
			this._vp.x  = mx - delta * (mx - this._vp.x);
			this._vp.y  = my - delta * (my - this._vp.y);
			this._vp.scale *= delta;
			this._apply_vp();
		}).on("mousedown", (e) => {
			// Start canvas pan only when the click lands on the background, not a node
			if ($(e.target).closest("[data-nid]").length) return;
			this.$wrap.css("cursor", "grabbing");
			this._drag = { sx: e.clientX - this._vp.x, sy: e.clientY - this._vp.y };
		});

		$(window).on("mousemove.dt", (e) => {
			if (this._node_drag) {
				// Node drag — move node group + label group + update connected edge endpoints
				const nd    = this._node_drag;
				const scale = this._vp.scale || 1;
				const dx    = (e.clientX - nd.ox) / scale;
				const dy    = (e.clientY - nd.oy) / scale;
				if (Math.abs(dx) > 3 || Math.abs(dy) > 3) nd.moved = true;
				const nx = nd.sx + dx;
				const ny = nd.sy + dy;
				nd.g_el.setAttribute("transform", `translate(${nx},${ny})`);
				nd.lbl_g.setAttribute("transform", `translate(${nx},${ny})`);
				nd.edges.forEach(({ line, ep }) => {
					if (ep === 1) { line.setAttribute("x1", nx); line.setAttribute("y1", ny); }
					else          { line.setAttribute("x2", nx); line.setAttribute("y2", ny); }
				});
				// Reposition ALL qty labels — midpoint of live line + perpendicular offset
				this.$svg[0].querySelectorAll(".dt-qty-label").forEach(t => {
					const l = t._line_ref;
					if (!l) return;
					const ax1 = parseFloat(l.getAttribute("x1")), ay1 = parseFloat(l.getAttribute("y1"));
					const ax2 = parseFloat(l.getAttribute("x2")), ay2 = parseFloat(l.getAttribute("y2"));
					const mx = (ax1 + ax2) / 2, my = (ay1 + ay2) / 2;
					const llen = Math.hypot(ax2 - ax1, ay2 - ay1) || 1;
					let px = -(ay2 - ay1) / llen, py = (ax2 - ax1) / llen;
					if (py > 0) { px = -px; py = -py; }
					const off = t._loff || 0;
					t.setAttribute("x", String(mx + px * off));
					t.setAttribute("y", String(my + py * off));
				});
			} else if (this._drag) {
				// Canvas pan
				this._vp.x = e.clientX - this._drag.sx;
				this._vp.y = e.clientY - this._drag.sy;
				this._apply_vp();
			}
		}).on("mouseup.dt", () => {
			if (this._node_drag) {
				const nd = this._node_drag;
				// A mousedown + mouseup with no significant movement is treated as a click
				if (!nd.moved) this.show_panel(nd.node);
				this._node_drag = null;
			}
			this._drag = null;
			this.$wrap.css("cursor", "grab");
		});
	}

	/** Apply the current viewport state to the SVG root group. */
	_apply_vp() {
		const { x, y, scale } = this._vp;
		this.$svg.find("#dt-root").attr("transform", `translate(${x},${y}) scale(${scale})`);
	}

	/**
	 * Post-render collision resolver.
	 *
	 * Iteratively nudges item nodes outward along the root→node direction
	 * whenever a qty-on-arrow label overlaps any node ID / name label.
	 * Uses getBoundingClientRect() so all viewport transforms are accounted for.
	 *
	 * @param {Map} node_dom   nid → { g_el, lbl_g, nx, ny }
	 * @param {Map} node_edges nid → [{ line, ep }]
	 */
	_resolve_overlaps(node_dom, node_edges) {
		const svg      = this.$svg[0];
		const qty_els  = [...svg.querySelectorAll(".dt-qty-label")];
		const name_els = [...svg.querySelectorAll(".dt-node-lbl")];
		if (!qty_els.length || !name_els.length) return;

		const PAD      = 5;    // extra breathing room around qty label (px, screen space)
		const STEP     = 22;   // px to nudge the node outward per collision (SVG space)
		const MAX_ITER = 8;

		const hit = (a, b) =>
			a.left   - PAD < b.right  &&
			b.left   - PAD < a.right  &&
			a.top    - PAD < b.bottom &&
			b.top    - PAD < a.bottom;

		/** Reposition every qty label to the midpoint of its live line + perpendicular offset. */
		const _reposition_qty = () => {
			for (const qt of qty_els) {
				const l = qt._line_ref;
				if (!l) continue;
				const ax1 = parseFloat(l.getAttribute("x1")), ay1 = parseFloat(l.getAttribute("y1"));
				const ax2 = parseFloat(l.getAttribute("x2")), ay2 = parseFloat(l.getAttribute("y2"));
				const mx = (ax1 + ax2) / 2, my = (ay1 + ay2) / 2;
				const ll = Math.hypot(ax2 - ax1, ay2 - ay1) || 1;
				let px = -(ay2 - ay1) / ll, py = (ax2 - ax1) / ll;
				if (py > 0) { px = -px; py = -py; }
				qt.setAttribute("x", String(mx + px * (qt._loff || 10)));
				qt.setAttribute("y", String(my + py * (qt._loff || 10)));
			}
		};

		for (let iter = 0; iter < MAX_ITER; iter++) {
			let any_moved = false;

			for (const qt of qty_els) {
				const nid = qt._node_to_id;
				const nd  = nid ? node_dom.get(nid) : null;
				if (!nd) continue;

				// Check this qty label against every node ID / name label
				const qr = qt.getBoundingClientRect();
				let clash = false;
				for (const ne of name_els) {
					if (hit(qr, ne.getBoundingClientRect())) { clash = true; break; }
				}
				if (!clash) continue;

				// Nudge the item node outward from the SVG origin (= root at 0,0)
				const rl = Math.hypot(nd.nx, nd.ny) || 1;
				nd.nx += (nd.nx / rl) * STEP;
				nd.ny += (nd.ny / rl) * STEP;
				nd.g_el.setAttribute("transform",  `translate(${nd.nx},${nd.ny})`);
				nd.lbl_g.setAttribute("transform", `translate(${nd.nx},${nd.ny})`);

				// Update all edges connected to the nudged node
				(node_edges.get(nid) || []).forEach(({ line, ep }) => {
					if (ep === 1) {
						line.setAttribute("x1", String(nd.nx));
						line.setAttribute("y1", String(nd.ny));
					} else {
						line.setAttribute("x2", String(nd.nx));
						line.setAttribute("y2", String(nd.ny));
					}
				});

				any_moved = true;
			}

			if (!any_moved) break;

			// Reposition qty labels to reflect updated line endpoints
			_reposition_qty();
		}
	}

	// Public API

	/** Switch to a new document and immediately run the trace. */
	set_doc(doctype, docname) {
		this.doctype = doctype;
		this.docname = docname;
		this.page.set_title(`${doctype}: ${docname}`);
		this.run_trace();
	}

	/** Call the Python backend and render the result. */
	run_trace() {
		if (!this.doctype || !this.docname) return;
		this.$svg.html(
			`<text x="50%" y="50%" text-anchor="middle" fill="#8993a4"
				font-family="Inter,system-ui,sans-serif" font-size="13">Tracing…</text>`
		);
		this.$panel.hide();

		frappe.call({
			method: "ampower_visualize.ampower_visualize.page.document_traceability.document_traceability.get_document_trace",
			args: { doctype: this.doctype, docname: this.docname, include_items: 1 },
			callback: (r) => {
				if (r.exc) {
					this.$svg.html(
						`<text x="50%" y="50%" text-anchor="middle" fill="#DE350B"
							font-family="Inter,system-ui,sans-serif" font-size="13">${r.exc}</text>`
					);
					return;
				}
				const data = r.message || { nodes: [], edges: [] };
				if (!data.nodes.length) {
					this.$svg.html(
						`<text x="50%" y="50%" text-anchor="middle" fill="#8993a4"
							font-family="Inter,system-ui,sans-serif" font-size="13">No linked documents found.</text>`
					);
					return;
				}
				this._render_radial(data);
			},
		});
	}

	// Radial layout

	_render_radial(data) {
		const positions = this._compute_radial(data);
		this._build_radial_svg(data, positions);
	}

	/**
	 * Compute SVG (x, y) positions for every node.
	 *
	 * Supports two layouts depending on whether the backend emitted group nodes:
	 *
	 * THREE-TIER  (root is the SO/MR/PO itself)
	 *   root → item rows → leaf docs
	 *
	 * FOUR-TIER   (root is a DN/SI/PR that links back to one or more SOs)
	 *   root → SO/MR/PO group → item rows → leaf docs
	 *
	 * In the four-tier layout each group node is placed uniformly around the
	 * root. Its item rows fan 270° around it (away from the root), and each
	 * item's leaves spread 60° outward from the item — decoupling leaf spacing
	 * from the item/group angular allocation so leaves never become too cramped.
	 *
	 * @param {object} data  { nodes, edges } from the Python backend
	 * @returns {Map<string, {x:number, y:number}>}
	 */
	_compute_radial(data) {
		const meta = {};
		for (const n of data.nodes) meta[n.id] = n;

		// Build adjacency maps for all tier transitions
		const root_to_groups = new Map();
		const root_to_items  = new Map();
		const group_to_items = new Map();
		const item_to_leaves = new Map();

		for (const e of data.edges) {
			const f = meta[e.from], t = meta[e.to];
			if (!f || !t) continue;
			if (f.role === "root"  && t.role === "group") {
				if (!root_to_groups.has(e.from)) root_to_groups.set(e.from, []);
				root_to_groups.get(e.from).push(e.to);
			}
			if (f.role === "root"  && t.role === "item") {
				if (!root_to_items.has(e.from)) root_to_items.set(e.from, []);
				root_to_items.get(e.from).push(e.to);
			}
			if (f.role === "group" && t.role === "item") {
				if (!group_to_items.has(e.from)) group_to_items.set(e.from, []);
				group_to_items.get(e.from).push(e.to);
			}
			if (f.role === "item"  && t.role === "leaf") {
				if (!item_to_leaves.has(e.from)) item_to_leaves.set(e.from, []);
				item_to_leaves.get(e.from).push(e.to);
			}
		}

		const positions = new Map();

		// Single centre root — the document the user navigated from
		const main_root =
			data.nodes.find(n => n.role === "root" &&
				n.doctype === this.doctype && n.name === this.docname) ||
			data.nodes.find(n => n.role === "root" &&
				(root_to_groups.has(n.id) || root_to_items.has(n.id))) ||
			data.nodes.find(n => n.role === "root");

		if (!main_root) return positions;
		positions.set(main_root.id, { x: 0, y: 0 });

		const has_groups = root_to_groups.size > 0;

		if (has_groups) {
			/**
			 * FOUR-TIER layout: root → group → item → leaf
			 *
			 * Groups are placed uniformly around the root at GROUP_R.
			 * Items fan 270° around their group node (centred on the outward
			 * direction so the inward 90° stays clear for the root→group edge).
			 * Leaves spread a fixed 60° arc around each item's outward direction,
			 * keeping leaf spacing independent of how many items the group has.
			 */
			const all_groups = [...new Set([...root_to_groups.values()].flat())];
			const n_groups   = all_groups.length || 1;
			const max_items  = Math.max(1, ...all_groups.map(
				gid => (group_to_items.get(gid) || []).length));
			const max_leaves = Math.max(1, ...[...item_to_leaves.values()].map(
				a => a.length));

			// Adaptive radii for 4-tier
			const LEAF_R  = Math.min(220, Math.max(130, 65 * max_leaves));
			const ITEM_R  = Math.min(300, Math.max(170,
				Math.ceil(90 * max_items / (Math.PI * 1.5))));
			const GROUP_R = Math.max(260, ITEM_R + LEAF_R + 100);

			const ITEM_SPREAD = Math.PI * 1.5;
			const LEAF_SPREAD = Math.PI / 3;

			all_groups.forEach((gid, gi) => {
				const theta_g = (2 * Math.PI * gi / n_groups) - Math.PI / 2;
				const gx = GROUP_R * Math.cos(theta_g);
				const gy = GROUP_R * Math.sin(theta_g);
				positions.set(gid, { x: gx, y: gy });

				const items   = group_to_items.get(gid) || [];
				const n_items = items.length;

				items.forEach((iid, ii) => {
					const theta_i = theta_g + (n_items > 1
						? ITEM_SPREAD * (ii / (n_items - 1) - 0.5)
						: 0);
					const ix = gx + ITEM_R * Math.cos(theta_i);
					const iy = gy + ITEM_R * Math.sin(theta_i);
					positions.set(iid, { x: ix, y: iy });

					const leaves = item_to_leaves.get(iid) || [];
					const nl     = leaves.length;
					if (!nl) return;

					leaves.forEach((lid, li) => {
						const theta_l = theta_i + (nl > 1
							? LEAF_SPREAD * (li / (nl - 1) - 0.5)
							: 0);
						positions.set(lid, {
							x: ix + LEAF_R * Math.cos(theta_l),
							y: iy + LEAF_R * Math.sin(theta_l),
						});
					});
				});
			});

		} else {
			/**
			 * THREE-TIER layout: root → item → leaf
			 *
			 * Uses the same fan algorithm as the four-tier layout:
			 * items fan 270° around the root (treating root as the implicit group),
			 * leaves spread a fixed 60° arc around each item's outward direction.
			 * This matches the visual quality of the DN/SI/PR four-tier view.
			 */
			const all_items  = [...new Set([...root_to_items.values()].flat())];
			const n_items    = all_items.length || 1;
			const max_leaves = Math.max(1, ...[...item_to_leaves.values()].map(
				a => a.length));

			const LEAF_R      = Math.min(220, Math.max(130, 65 * max_leaves));
			const ITEM_R      = Math.min(300, Math.max(170,
				Math.ceil(90 * n_items / (Math.PI * 1.5))));
			const ITEM_SPREAD = Math.PI * 1.5;
			const LEAF_SPREAD = Math.PI / 3;

			all_items.forEach((iid, ii) => {
				const theta_i = -Math.PI / 2 + (n_items > 1
					? ITEM_SPREAD * (ii / (n_items - 1) - 0.5)
					: 0);
				const ix = ITEM_R * Math.cos(theta_i);
				const iy = ITEM_R * Math.sin(theta_i);
				positions.set(iid, { x: ix, y: iy });

				const leaves = item_to_leaves.get(iid) || [];
				const nl     = leaves.length;
				if (!nl) return;

				leaves.forEach((lid, li) => {
					const theta_l = theta_i + (nl > 1
						? LEAF_SPREAD * (li / (nl - 1) - 0.5)
						: 0);
					positions.set(lid, {
						x: ix + LEAF_R * Math.cos(theta_l),
						y: iy + LEAF_R * Math.sin(theta_l),
					});
				});
			});
		}

		// Orphan handler — nodes not placed by the layout above (rare)
		// Root-role nodes other than main_root are skipped intentionally.
		let ox = 0;
		for (const nd of data.nodes) {
			if (positions.has(nd.id)) continue;
			if (nd.role === "root") continue;
			positions.set(nd.id, { x: ox, y: 800 });
			ox += 160;
		}

		return positions;
	}

	/**
	 * Build the SVG from computed positions.
	 *
	 * Three rendering layers (appended in order so z-order is correct):
	 *   1. edges_g  — connector lines, pointer-events:none
	 *   2. labels_g — text labels, pointer-events:none
	 *   3. nodes_g  — coloured squares, receives mouse events
	 *
	 * Separating labels into their own non-interactive layer prevents text
	 * from swallowing mouse events that should reach the canvas behind it.
	 *
	 * @param {object}                             data       { nodes, edges }
	 * @param {Map<string, {x:number, y:number}>}  positions  output of _compute_radial
	 */
	_build_radial_svg(data, positions) {
		// Visual dimensions per role
		const NODE_SZ     = { root: 68, group: 52, item: 60, leaf: 40 };
		const TEXT_HEIGHT = { root: 38, group: 38, item: 52, leaf: 32 };
		const TEXT_HPAD   = { root: 72, group: 64, item: 66, leaf: 52 };

		// Compute the bounding box of all placed nodes (including labels below)
		let min_x = Infinity, min_y = Infinity, max_x = -Infinity, max_y = -Infinity;
		for (const n of data.nodes) {
			const p = positions.get(n.id);
			if (!p) continue;
			const role = n.role || "leaf";
			const half = (NODE_SZ[role] || 40) / 2;
			min_x = Math.min(min_x, p.x - TEXT_HPAD[role]);
			min_y = Math.min(min_y, p.y - half - 12);
			max_x = Math.max(max_x, p.x + TEXT_HPAD[role]);
			max_y = Math.max(max_y, p.y + half + TEXT_HEIGHT[role] + 12);
		}

		const SVG_NS = "http://www.w3.org/2000/svg";
		const svg    = this.$svg[0];
		svg.innerHTML = "";

		// Arrowhead marker — reused by every connector line via marker-end
		const defs   = document.createElementNS(SVG_NS, "defs");
		const marker = document.createElementNS(SVG_NS, "marker");
		marker.setAttribute("id",           "dt-arrow");
		marker.setAttribute("markerWidth",  "6");
		marker.setAttribute("markerHeight", "6");
		marker.setAttribute("refX",         "5");
		marker.setAttribute("refY",         "3");
		marker.setAttribute("orient",       "auto");
		const arrow_path = document.createElementNS(SVG_NS, "path");
		arrow_path.setAttribute("d",    "M0,0 L0,6 L6,3 z");
		arrow_path.setAttribute("fill", "#c8cdd6");
		marker.appendChild(arrow_path);
		defs.appendChild(marker);
		svg.appendChild(defs);

		// Single root group — _apply_vp sets its transform for pan/zoom
		const root_g = document.createElementNS(SVG_NS, "g");
		root_g.setAttribute("id", "dt-root");
		svg.appendChild(root_g);

		this._build_legend();

		/** Shorthand: create an SVG element with given attributes. */
		const mk = (tag, attrs = {}) => {
			const el = document.createElementNS(SVG_NS, tag);
			for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
			return el;
		};

		// Three layers — order matters for z-index and pointer-events
		const edges_g  = mk("g", { "pointer-events": "none" });
		const labels_g = mk("g", { "pointer-events": "none" });
		const nodes_g  = mk("g");
		root_g.appendChild(edges_g);
		root_g.appendChild(labels_g);
		root_g.appendChild(nodes_g);

		/**
		 * Identify the placed centre root nid.
		 *
		 * Python emits edges like SO-001 → SOI-001 (root → item).  When the
		 * user visualises a DN, SO-001 is NOT placed in positions (only the DN
		 * is the centre root).  Any edge whose "from" isn't placed is registered
		 * under the visible centre root so that dragging the centre node also
		 * moves the unplaced-root → item lines correctly.
		 */
		const _mr = data.nodes.find(n => n.role === "root" &&
				n.doctype === this.doctype && n.name === this.docname) ||
			data.nodes.find(n => n.role === "root");
		const main_root_nid = _mr ? _mr.id : null;
		const main_root_pos = main_root_nid
			? (positions.get(main_root_nid) || { x: 0, y: 0 })
			: { x: 0, y: 0 };

		/**
		 * Edge endpoint tracking.
		 * node_edges: nid → [{ line, ep }]
		 *   ep = 1  →  this node owns x1/y1 of the line
		 *   ep = 2  →  this node owns x2/y2 of the line
		 * During node drag, every registered line has its endpoint updated.
		 */
		const node_edges = new Map();
		const node_dom   = new Map();

		const _track = (nid, line, ep) => {
			if (!nid) return;
			if (!node_edges.has(nid)) node_edges.set(nid, []);
			node_edges.get(nid).push({ line, ep });
		};

		// Index nodes by id for role lookups during edge drawing
		const node_meta = {};
		for (const n of data.nodes) node_meta[n.id] = n;

		/**
		 * Draw connector lines.
		 * Lines are trimmed to 62 % of the full node-to-node distance so
		 * arrows appear visually shorter while node positions (which govern
		 * the spacing between siblings) remain unchanged.
		 */
		for (const e of data.edges) {
			const from_placed = positions.has(e.from);
			const fp = from_placed ? positions.get(e.from) : main_root_pos;
			const tp = positions.get(e.to);
			if (!fp || !tp) continue;

			// Stop the line at the target node's border so there is no gap.
			// half-size of the target square + 2 px breathing room.
			let x2 = tp.x, y2 = tp.y;
			const dx = tp.x - fp.x, dy = tp.y - fp.y;
			const len = Math.hypot(dx, dy);
			const to_meta = node_meta[e.to];
			const to_half = to_meta ? ((NODE_SZ[to_meta.role] || 40) / 2 + 2) : 22;
			if (len > to_half + 10) {
				x2 = fp.x + (dx / len) * (len - to_half);
				y2 = fp.y + (dy / len) * (len - to_half);
			}

			const line = mk("line", {
				x1: fp.x, y1: fp.y, x2, y2,
				stroke: "#c8cdd6", "stroke-width": "1.4",
				"marker-end": "url(#dt-arrow)",
				...(e.dashed ? { "stroke-dasharray": "5,4" } : {}),
			});
			edges_g.appendChild(line);

			// Quantity label on root/group → item edges — floated above the arrow line
			const _to_nd = node_meta[e.to];
			if (_to_nd && _to_nd.role === "item" && _to_nd.qty != null) {
				const mid_x = (fp.x + x2) / 2;
				const mid_y = (fp.y + y2) / 2;
				// Perpendicular unit vector — flip so it always points upward (negative SVG y)
				const _ldx = x2 - fp.x, _ldy = y2 - fp.y;
				const _llen = Math.hypot(_ldx, _ldy) || 1;
				let _px = -_ldy / _llen, _py = _ldx / _llen;
				if (_py > 0) { _px = -_px; _py = -_py; }
				const LOFF = 10;
				const qty_t = mk("text", {
					x: mid_x + _px * LOFF, y: mid_y + _py * LOFF,
					"class": "dt-qty-label",
					"text-anchor": "middle", "dominant-baseline": "middle",
					fill: "#374151", "font-size": "8", "font-weight": "700",
					"font-family": "Inter,system-ui,sans-serif",
					stroke: "white", "stroke-width": "2.5", "paint-order": "stroke",
				});
				qty_t.textContent   = String(_to_nd.qty);
				// Store line ref + offset + target node id for drag + collision resolver
				qty_t._line_ref     = line;
				qty_t._loff         = LOFF;
				qty_t._node_to_id   = e.to;
				labels_g.appendChild(qty_t);
			}

			// Unplaced "from" nodes (e.g. SO when visualising a DN) are
			// registered under the main root so their lines follow when the
			// centre node is dragged.
			_track(from_placed ? e.from : main_root_nid, line, 1);
			if (positions.has(e.to)) _track(e.to, line, 2);
		}

		/**
		 * Text helper — appends an SVG <text> to parent.
		 * Coordinates are relative to the parent group's origin.
		 */
		const lbl = (parent, x, y, txt, opts = {}) => {
			const el = mk("text", {
				x, y,
				"text-anchor":       "middle",
				"dominant-baseline": opts.baseline || "auto",
				fill:                opts.fill     || "#1a1a1a",
				"font-size":         opts.size     || "10",
				"font-weight":       opts.weight   || "400",
				"font-family":       "Inter,system-ui,sans-serif",
				...(opts.opacity ? { opacity: opts.opacity } : {}),
				...(opts.cls     ? { "class": opts.cls }     : {}),
			});
			el.textContent = txt;
			parent.appendChild(el);
		};

		// Render each node
		for (const n of data.nodes) {
			const pos = positions.get(n.id);
			if (!pos) continue;

			const role      = n.role || "leaf";
			const sz        = NODE_SZ[role] || 40;
			const half      = sz / 2;
			const fill      = role === "root"  ? ROOT_NODE_COLOR
			                : role === "item"  ? ITEM_ROLE_COLOR
			                : dt_color(n.doctype);
			const is_origin = (n.doctype === this.doctype && n.name === this.docname);

			/**
			 * Node group — positioned with a transform so dragging only needs
			 * to update the transform, not every child element.
			 * All child geometry is relative to (0, 0) = square centre.
			 */
			const g_el = mk("g", {
				"data-nid":  n.id,
				"transform": `translate(${pos.x},${pos.y})`,
			});
			g_el.style.cursor = "grab";

			// Subtle drop-shadow offset by (2, 2)
			g_el.appendChild(mk("rect", {
				x: -half + 2, y: -half + 2, width: sz, height: sz,
				rx: role === "leaf" ? "3" : "5",
				fill: "rgba(0,0,0,0.14)",
			}));

			// Highlight ring around the document that was opened
			if (is_origin) {
				g_el.appendChild(mk("rect", {
					x: -half - 4, y: -half - 4, width: sz + 8, height: sz + 8,
					rx: "8", fill: "none", stroke: fill, "stroke-width": "3",
				}));
			}

			// Coloured square
			const sq = mk("rect", {
				x: -half, y: -half, width: sz, height: sz,
				rx: role === "leaf" ? "3" : "5", fill,
			});
			g_el.appendChild(sq);

			// Doctype abbreviation centred inside the square
			// Item-role nodes carry their own abbrev (SOI, MRI, POI …) from the backend
			lbl(g_el, 0, 1, n.abbrev || dt_abbrev(n.doctype), {
				fill: "rgba(255,255,255,0.9)",
				size: role === "leaf" ? "9" : "11",
				weight: "700", baseline: "middle",
			});

			// Dim the square on hover to signal interactivity
			g_el.addEventListener("mouseenter", () => {
				sq.style.filter = "brightness(0.85)";
				g_el.style.cursor = "grab";
			});
			g_el.addEventListener("mouseleave", () => { sq.style.filter = ""; });

			/**
			 * Mousedown starts a node drag.
			 * We read the CURRENT transform (not initial pos) so repeated drags
			 * accumulate correctly.  The click/drag distinction is resolved on
			 * mouseup via the `moved` flag.
			 */
			g_el.addEventListener("mousedown", (ev) => {
				ev.stopPropagation();
				this.$wrap.css("cursor", "grabbing");
				const t = g_el.getAttribute("transform").match(/translate\(([^,]+),([^)]+)\)/);
				this._node_drag = {
					node:  n,
					g_el,
					lbl_g: g_el.__lbl_g,
					edges: node_edges.get(n.id) || [],
					ox:    ev.clientX,
					oy:    ev.clientY,
					sx:    t ? parseFloat(t[1]) : pos.x,
					sy:    t ? parseFloat(t[2]) : pos.y,
					moved: false,
				};
			});

			nodes_g.appendChild(g_el);

			/**
			 * Label group — same transform as the node group but lives in
			 * labels_g (pointer-events:none) so mouse events pass through
			 * to the canvas background beneath it.
			 * g_el.__lbl_g links the two groups for synchronised drag.
			 */
			const lbl_g = mk("g", { transform: `translate(${pos.x},${pos.y})` });
			g_el.__lbl_g = lbl_g;

			const below = half + 8;

			if (role === "root" || role === "group") {
				lbl(lbl_g, 0, below + 11, n.name,   { fill: "#111827", size: "10", weight: "700", cls: "dt-node-lbl" });
				if (n.status)
					lbl(lbl_g, 0, below + 25, n.status, { fill: "#6b7280", size: "8.5" });

			} else if (role === "item") {
				lbl(lbl_g, 0, below + 11, n.item_name || n.item_code || "",
					{ fill: "#111827", size: "10", weight: "700", cls: "dt-node-lbl" });
				if (n.item_code && n.item_name && n.item_code !== n.item_name)
					lbl(lbl_g, 0, below + 24, n.item_code, { fill: "#374151", size: "8.5", cls: "dt-node-lbl" });

			} else {
				lbl(lbl_g, 0, below + 11, n.name,   { fill: "#111827", size: "9.5", weight: "600", cls: "dt-node-lbl" });
				if (n.status)
					lbl(lbl_g, 0, below + 24, n.status, { fill: "#6b7280", size: "8" });
			}

			labels_g.appendChild(lbl_g);
			// Register node DOM refs so _resolve_overlaps() can nudge positions
			node_dom.set(n.id, { g_el, lbl_g, nx: pos.x, ny: pos.y });
		}

		/**
		 * Fit the graph to the viewport.
		 * Scale is chosen so the entire bounding box fits with `pad` px of margin.
		 * Translation centres the bounding box inside the canvas.
		 */
		const pad     = 140;
		const total_w = max_x - min_x + pad * 2;
		const total_h = max_y - min_y + pad * 2;
		const cw      = this.$wrap.width();
		const ch      = this.$wrap.height();
		const scale   = Math.min(1, Math.min(cw / total_w, ch / total_h));

		this._vp = {
			x: (cw - total_w * scale) / 2 + (pad - min_x) * scale,
			y: (ch - total_h * scale) / 2 + (pad - min_y) * scale,
			scale,
		};
		this._fit_vp = { ...this._vp };
		this._apply_vp();

		// Collision resolver — runs after the browser has laid out SVG text
		// so getBoundingClientRect() returns accurate values.
		requestAnimationFrame(() => this._resolve_overlaps(node_dom, node_edges));

		// Clicking the canvas background closes the side panel
		this.$wrap.off("click.dt-panel").on("click.dt-panel", (e) => {
			if (!$(e.target).closest("[data-nid]").length) this.$panel.hide();
		});
	}

	// Legend overlay

	_build_legend() {
		this.$wrap.find(".dt-legend").remove();

		const $legend = $(`
			<div class="dt-legend" style="position:absolute;top:10px;left:10px;z-index:5;
				display:flex;flex-wrap:wrap;gap:6px 12px;background:rgba(255,255,255,0.9);
				border:1px solid #e2e8f0;border-radius:20px;padding:5px 14px;
				font-size:11px;color:#374151;backdrop-filter:blur(4px);
				pointer-events:none;user-select:none"></div>
		`).appendTo(this.$wrap);

		for (const { label, color } of LEGEND_CFG) {
			$legend.append(`
				<span style="display:flex;align-items:center;gap:5px">
					<span style="display:inline-block;width:12px;height:12px;
						background:${color};border-radius:2px;flex-shrink:0"></span>
					${frappe.utils.escape_html(label)}
				</span>
			`);
		}
	}

	// Side panel

	/**
	 * Show the detail panel for a clicked node.
	 * For document nodes, also fetches and displays the item list.
	 *
	 * @param {object} node  node data object from the backend
	 */
	show_panel(node) {
		const $p     = this.$panel;
		const color  = node.role === "item" ? ITEM_ROLE_COLOR : dt_color(node.doctype);
		const abbrev = node.role === "item"
			? (node.abbrev || "ITEM")
			: dt_abbrev(node.doctype);
		const title  = node.role === "item"
			? frappe.utils.escape_html(node.item_name || node.item_code)
			: frappe.utils.escape_html(node.name);

		$p.html(`
			<div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">
				<span style="background:${color};color:#fff;font-size:10px;font-weight:700;
					padding:2px 8px;border-radius:4px;flex-shrink:0">${abbrev}</span>
				<strong style="font-size:12px;flex:1;word-break:break-all">${title}</strong>
				<button class="btn btn-xs btn-default" id="dt-panel-close" style="flex-shrink:0">✕</button>
			</div>
			${node.role === "item" ? `
				<div style="font-size:11px;color:#6b7280;line-height:1.9;margin-bottom:8px">
					<div><b>Code:</b> ${frappe.utils.escape_html(node.item_code || "")}</div>
					<div><b>Qty:</b> ${node.qty != null ? node.qty : "—"}</div>
					<div><b>In:</b> <a href="${node.url}" target="_blank">${frappe.utils.escape_html(node.docname)}</a></div>
				</div>
			` : `
				<div style="margin-bottom:8px">
					<span style="background:#f1f3f5;padding:2px 8px;border-radius:4px;font-size:11px">
						${frappe.utils.escape_html(node.status || "")}
					</span>
				</div>
			`}
			<a href="${node.url}" target="_blank" style="font-size:11px">
				Open ${frappe.utils.escape_html(node.doctype || "")} ↗
			</a>
			${node.role !== "item" ? `
				<hr style="margin:10px 0">
				<div style="font-size:11px;color:#8993a4;margin-bottom:6px">Items</div>
				<div id="dt-panel-items"><em style="color:#aaa;font-size:11px">Loading…</em></div>
			` : ""}
		`);
		$p.find("#dt-panel-close").on("click", () => $p.hide());
		$p.show();

		// Fetch item rows for document nodes (not needed for item-role nodes)
		if (node.role !== "item") {
			frappe.call({
				method: "ampower_visualize.ampower_visualize.page.document_traceability.document_traceability.get_document_items",
				args: { doctype: node.doctype, docname: node.name },
				callback: (r) => {
					const items = (r && r.message) || [];
					const $tgt  = $p.find("#dt-panel-items");
					if (!items.length) {
						$tgt.html(`<em style="color:#aaa;font-size:11px">No items</em>`);
						return;
					}
					const rows = items.map(it => {
						const qty = it.qty            != null ? it.qty
						          : it.planned_qty     != null ? it.planned_qty
						          : it.transferred_qty != null ? it.transferred_qty
						          : "—";
						return `<tr>
							<td style="padding:3px 4px;border-bottom:1px solid #f1f3f5;word-break:break-all">
								${frappe.utils.escape_html(it.item_code || "")}
							</td>
							<td style="padding:3px 4px;border-bottom:1px solid #f1f3f5;white-space:nowrap">
								${qty}
							</td>
						</tr>`;
					}).join("");
					$tgt.html(`
						<table style="width:100%;border-collapse:collapse;font-size:11px">
							<thead><tr style="color:#8993a4">
								<th style="text-align:left;padding:2px 4px;border-bottom:1px solid #e2e8f0">Item</th>
								<th style="text-align:left;padding:2px 4px;border-bottom:1px solid #e2e8f0">Qty</th>
							</tr></thead>
							<tbody>${rows}</tbody>
						</table>
					`);
				},
			});
		}
	}
}