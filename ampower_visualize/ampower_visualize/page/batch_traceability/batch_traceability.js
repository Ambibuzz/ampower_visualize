frappe.pages["batch_traceability"].on_page_load = function (wrapper) {
	const page = frappe.ui.make_app_page({
		parent: wrapper,
		title: "Batch Traceability",
		single_column: true,
	});

	new BatchTraceView(page);
};


// dagre.bundle.js imports @dagrejs/dagre and sets window.dagre; built by
// `bench build --app ampower_synergy` and loaded on demand here.
let _dagre_loading = null;
function load_dagre() {
	if (window.dagre) return Promise.resolve();
	if (_dagre_loading) return _dagre_loading;
	_dagre_loading = frappe.require("dagre.bundle.js").then(() => {
		if (!window.dagre) throw new Error("dagre failed to load");
	});
	return _dagre_loading;
}

class BatchTraceView {
	constructor(page) {
		this.page = page;
		this.batch_no = null;
		this.direction = 0;

		this.inject_styles();
		this.render_layout();
		this.bind_events();
	}

	inject_styles() {
		if (document.getElementById("batch-traceability-styles")) return;
		const css = `
			.bt-root {
				--bt-radius: 12px;
				--bt-accent: #4f46e5;
				--bt-gap: 16px;
				font-feature-settings: "tnum";
				display: flex;
				flex-direction: column;
				height: calc(100vh - 142px);
				min-height: 480px;
			}
			.bt-card {
				background: var(--card-bg, var(--fg-color, #fff));
				border: 1px solid var(--border-color, #e5e7eb);
				border-radius: var(--bt-radius);
				box-shadow: 0 1px 2px rgba(0,0,0,.04), 0 4px 16px rgba(0,0,0,.06);
			}
			.bt-controls {
				display: flex;
				align-items: flex-start;
				gap: var(--bt-gap);
				flex-wrap: wrap;
				padding: 16px 18px;
				margin-bottom: var(--bt-gap);
			}
			.bt-field { display: flex; flex-direction: column; gap: 6px; }
			.bt-field > label {
				font-size: 11px;
				font-weight: 600;
				letter-spacing: .04em;
				text-transform: uppercase;
				color: var(--text-muted, #6b7280);
				height: 14px;
				line-height: 14px;
				margin: 0;
			}
			.bt-controls .bt-btn { margin-top: 20px; }
			.bt-field .form-control,
			.bt-field select.form-control {
				min-width: 220px;
				border-radius: 8px;
			}
			.bt-field .bt-depth {
				min-width: 88px;
				width: 88px;
			}
			.bt-from .clearfix,
			.bt-to .clearfix,
			.bt-from .control-label,
			.bt-to .control-label,
			.bt-from .help-box,
			.bt-to .help-box,
			.bt-from .tz-info,
			.bt-to .tz-info,
			.bt-from .control-value,
			.bt-to .control-value { display: none !important; }
			.bt-from .frappe-control,
			.bt-to .frappe-control,
			.bt-from .control-input-wrapper,
			.bt-to .control-input-wrapper,
			.bt-from .control-input,
			.bt-to .control-input {
				margin: 0 !important;
				padding: 0 !important;
				min-height: 0 !important;
				line-height: normal !important;
			}
			.bt-from .form-control,
			.bt-to .form-control {
				min-width: 200px;
				height: var(--input-height);
				border-radius: 8px;
				margin: 0 !important;
			}
			.bt-search { position: relative; }
			.bt-suggest {
				position: absolute;
				z-index: 20;
				top: calc(100% + 4px);
				left: 0;
				right: 0;
				max-height: 280px;
				overflow-y: auto;
				background: var(--fg-color, #fff);
				border: 1px solid var(--border-color, #e5e7eb);
				border-radius: 10px;
				box-shadow: 0 6px 24px rgba(0,0,0,.12);
				padding: 4px;
			}
			.bt-suggest-item {
				display: flex;
				justify-content: space-between;
				gap: 12px;
				padding: 8px 10px;
				border-radius: 7px;
				cursor: pointer;
			}
			.bt-suggest-item:hover,
			.bt-suggest-item.is-active {
				background: var(--bt-accent);
				color: #fff;
			}
			.bt-suggest-item .bt-sub {
				font-size: 12px;
				opacity: .7;
				white-space: nowrap;
			}
			.bt-suggest-empty {
				padding: 10px;
				color: var(--text-muted, #6b7280);
				font-size: 13px;
			}
			.bt-btn {
				border: none;
				border-radius: 8px;
				padding: 8px 18px;
				font-weight: 600;
				background: var(--bt-accent);
				color: #fff;
				transition: filter .12s ease, transform .02s ease;
			}
			.page-body:has(.bt-root) .container,
			.page-body:has(.bt-root) .page-wrapper .container { max-width: none; }
			.bt-controls { margin-bottom: var(--bt-gap); flex: 0 0 auto; }
			.bt-btn:hover { filter: brightness(1.07); }
			.bt-btn:active { transform: translateY(1px); }
			.bt-btn[disabled] { opacity: .5; cursor: not-allowed; }
			.bt-stage-wrap { position: relative; flex: 1; min-height: 0; overflow: hidden; }
			.bt-stage {
				position: absolute;
				inset: 0;
				color: var(--text-muted, #6b7280);
				overflow: hidden;
			}
			.bt-stage.is-empty {
				display: flex;
				align-items: center;
				justify-content: center;
			}
			.bt-svg { position: absolute; inset: 0; cursor: grab; user-select: none; }
			.bt-svg.is-panning { cursor: grabbing; }
			.bt-svg.is-grabbing { cursor: grabbing; }
			.bt-zoom {
				position: absolute;
				right: 14px;
				bottom: 14px;
				z-index: 5;
				display: flex;
				flex-direction: column;
				gap: 4px;
			}
			.bt-zoom button {
				width: 30px; height: 30px;
				border: 1px solid var(--border-color, #e5e7eb);
				background: var(--fg-color, #fff);
				border-radius: 8px;
				font-size: 16px; line-height: 1;
				cursor: pointer;
				box-shadow: 0 1px 2px rgba(0,0,0,.06);
			}
			.bt-zoom button:hover { background: var(--control-bg, #f3f4f6); }
			.bt-node rect { transition: filter .12s ease; }
			.bt-node.is-loading rect {
				stroke-dasharray: 4 3;
				animation: bt-pulse 1s ease-in-out infinite;
			}
			.bt-node.is-loading .bt-spinner { animation: bt-spin .7s linear infinite; }
			@keyframes bt-pulse { 0%,100% { opacity: 1; } 50% { opacity: .45; } }
			@keyframes bt-spin { to { transform: rotate(360deg); } }
			.bt-voucher { cursor: pointer; }
			.bt-voucher:hover rect { filter: brightness(0.95); }
			.bt-batch { cursor: pointer; }
			.bt-batch:hover rect { filter: brightness(0.94); }
			/* expand hint */
			.bt-expand-hint { opacity: .45; transition: opacity .12s ease; }
			.bt-batch.is-expandable:hover .bt-expand-hint { opacity: 1; }
			.bt-viewport.bt-spotlight .bt-node,
			.bt-viewport.bt-spotlight .bt-edge {
				opacity: .12;
				filter: blur(1.5px);
				transition: opacity .12s ease, filter .12s ease;
			}
			.bt-viewport.bt-spotlight .bt-node.bt-hot,
			.bt-viewport.bt-spotlight .bt-edge.bt-hot {
				opacity: 1;
				filter: none;
			}
			.bt-badge {
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
			.bt-legend {
				position: absolute;
				top: 12px;
				right: 14px;
				z-index: 5;
				display: flex;
				align-items: center;
				gap: 10px;
				flex-wrap: wrap;
				max-width: 60%;
				justify-content: flex-end;
				font-size: 11px;
				color: var(--text-muted, #6b7280);
				background: var(--fg-color, #fff);
				border: 1px solid var(--border-color, #e5e7eb);
				border-radius: 999px;
				padding: 4px 12px;
			}
			.bt-legend-item { display: flex; align-items: center; gap: 5px; }
			.bt-legend-swatch {
				width: 16px;
				height: 3px;
				border-radius: 2px;
				display: inline-block;
			}
			.bt-panel {
				position: absolute;
				top: 0;
				right: 0;
				bottom: 0;
				width: 340px;
				max-width: 80%;
				z-index: 10;
				background: var(--fg-color, #fff);
				border-left: 1px solid var(--border-color, #e5e7eb);
				box-shadow: -8px 0 24px rgba(0,0,0,.08);
				overflow-y: auto;
				transform: translateX(0);
				transition: transform .18s ease;
			}
			.bt-panel[hidden] { display: block; transform: translateX(100%); }
			.bt-panel-head {
				display: flex;
				align-items: flex-start;
				justify-content: space-between;
				gap: 8px;
				padding: 16px 18px 10px;
				border-bottom: 1px solid var(--border-color, #e5e7eb);
			}
			.bt-panel-title { font-weight: 600; font-size: 14px; }
			.bt-panel-sub { font-size: 12px; color: var(--text-muted, #6b7280); }
			.bt-panel-note {
				margin: 8px 18px;
				padding: 7px 10px;
				font-size: 11.5px;
				border-radius: 7px;
				background: #eef2ff;
				color: var(--bt-accent, #4f46e5);
			}
			.bt-panel-close {
				border: none; background: none; cursor: pointer;
				font-size: 20px; line-height: 1; color: var(--text-muted, #6b7280);
				padding: 0 4px;
			}
			.bt-panel-close:hover { color: var(--text-color, #1f2937); }
			.bt-move {
				display: grid;
				grid-template-columns: auto 1fr auto;
				gap: 2px 10px;
				padding: 11px 18px;
				border-bottom: 1px solid var(--border-color, #f0f1f3);
				font-size: 12.5px;
			}
			.bt-move-dir {
				grid-row: span 2;
				align-self: center;
				font-size: 10px;
				font-weight: 600;
				letter-spacing: .03em;
				padding: 2px 7px;
				border-radius: 6px;
			}
			.bt-move-dir.in { background: #e7f5ec; color: #1a7f43; }
			.bt-move-dir.out { background: #fdeaea; color: #c0392b; }
			.bt-move-wh { color: var(--text-color, #1f2937); }
			.bt-move-batch { font-size: 11px; color: var(--text-muted, #6b7280); }
			.bt-move-qty { font-weight: 600; text-align: right; }
			.bt-move-time { font-size: 11px; color: var(--text-muted, #9aa1ad); text-align: right; }
			.bt-move-toggle {
				grid-column: 2 / -1;
				grid-row: 3;
				justify-self: end;
				margin-top: 2px;
				border: 1px solid var(--border-color, #e5e7eb);
				background: var(--fg-color, #fff);
				border-radius: 6px;
				font-size: 10px;
				padding: 1px 7px;
				cursor: pointer;
				color: var(--text-muted, #6b7280);
			}
			.bt-move-toggle:hover { background: var(--control-bg, #f3f4f6); }
			.bt-move.is-hidden { opacity: .55; }
			.bt-move.is-hidden .bt-move-batch { text-decoration: line-through; }
			.bt-move.is-stub .bt-move-wh {
				font-style: italic;
				font-size: 11px;
				color: var(--bt-accent, #4f46e5);
			}
			.bt-panel-actions { padding: 8px 18px; border-bottom: 1px solid var(--border-color, #f0f1f3); }
			.bt-trunc {
				border: 1px solid var(--bt-accent);
				background: var(--fg-color, #fff);
				color: var(--bt-accent);
				border-radius: 7px;
				font-size: 11px;
				font-weight: 600;
				padding: 5px 12px;
				cursor: pointer;
			}
			.bt-trunc:hover { background: #eef2ff; }
		`;
		const tag = document.createElement("style");
		tag.id = "batch-traceability-styles";
		tag.textContent = css;
		document.head.appendChild(tag);
	}

	render_layout() {
		this.page.main.html(`
			<div class="bt-root">
				<div class="bt-card bt-controls">
					<div class="bt-field">
						<label>Batch</label>
						<div class="bt-search">
							<input type="text" class="form-control bt-batch"
								placeholder="Search batch or item…" autocomplete="off">
							<div class="bt-suggest" hidden></div>
						</div>
					</div>
					<div class="bt-field">
						<label>Direction</label>
						<select class="form-control bt-direction">
							<option value="0">Both</option>
							<option value="-1">Ancestors (where it came from)</option>
							<option value="1">Descendants (what it became)</option>
						</select>
					</div>
					<div class="bt-field">
						<label>Depth</label>
						<input type="number" class="form-control bt-depth"
							min="0" max="50" step="1" value="1">
					</div>
					<div class="bt-field">
						<label>From</label>
						<div class="bt-from"></div>
					</div>
					<div class="bt-field">
						<label>To</label>
						<div class="bt-to"></div>
					</div>
					<button class="bt-btn bt-trace" disabled>Trace</button>
				</div>
				<div class="bt-card bt-stage-wrap">
					<div class="bt-stage is-empty">Pick a batch and press Trace.</div>
					<aside class="bt-panel" hidden></aside>
				</div>
			</div>
		`);

		const $root = this.page.main.find(".bt-root");
		this.$batch = $root.find(".bt-batch");
		this.$suggest = $root.find(".bt-suggest");
		this.$direction = $root.find(".bt-direction");
		this.$depth = $root.find(".bt-depth");
		this.$trace = $root.find(".bt-trace");
		this.$stage = $root.find(".bt-stage");
		this.$panel = $root.find(".bt-panel");

		this.from_control = frappe.ui.form.make_control({
			df: {
				fieldtype: "Datetime",
				fieldname: "from_datetime",
				placeholder: "From",
				hide_timezone: true,
			},
			parent: $root.find(".bt-from").get(0),
			render_input: true,
		});
		this.to_control = frappe.ui.form.make_control({
			df: {
				fieldtype: "Datetime",
				fieldname: "to_datetime",
				placeholder: "To",
				hide_timezone: true,
			},
			parent: $root.find(".bt-to").get(0),
			render_input: true,
		});
	}

	date_args() {
		const v = (ctrl) => ctrl.get_value() || null;
		return { from_datetime: v(this.from_control), to_datetime: v(this.to_control) };
	}

	depth_value() {
		const n = parseInt(this.$depth.val(), 10);
		if (!Number.isFinite(n)) return 1;
		return Math.max(0, Math.min(n, 50));
	}

	bind_events() {
		this.$batch.on("input", () => {
			this.batch_no = null;
			this.$trace.prop("disabled", true);
			const q = this.$batch.val().trim();
			if (q) this.show_searching();
			else this.hide_suggest();
			this.search_debounced(q);
		});

		this.$batch.on("blur", () => setTimeout(() => this.hide_suggest(), 150));

		this.$direction.on("change", () => {
			this.direction = parseInt(this.$direction.val(), 10);
		});

		this.$trace.on("click", () => this.run_trace());

		this.$stage.on("click", ".bt-voucher", (e) => {
			if (this._suppressClick) {
				this._suppressClick = false;
				return;
			}
			const voucher_no = e.currentTarget.getAttribute("data-voucher");
			if (voucher_no) this.show_voucher_panel(voucher_no);
		});

		this.$stage.on("click", ".bt-batch", (e) => {
			if (this._suppressClick) {
				this._suppressClick = false;
				return;
			}
			const id = e.currentTarget.__bt_id;
			if (id) this.expand_batch(id);
		});
	}

	search_debounced = frappe.utils.debounce((query) => this.search(query), 250);

	show_searching() {
		this.$suggest
			.html(`<div class="bt-suggest-empty">Searching…</div>`)
			.prop("hidden", false);
	}

	search(query) {
		if (!query) return this.hide_suggest();
		const token = (this._search_token = (this._search_token || 0) + 1);
		frappe.call({
			method:
				"ampower_visualize.ampower_visualize.page.batch_traceability.batch_traceability.search_batches",
			args: { query, limit: 20 },
			callback: ({ message }) => {
				if (token !== this._search_token) return;
				this.show_suggest(message || []);
			},
		});
	}

	show_suggest(rows) {
		if (!rows.length) {
			this.$suggest
				.html(`<div class="bt-suggest-empty">No matching batches</div>`)
				.prop("hidden", false);
			return;
		}
		const html = rows
			.map((r) => {
				return `
					<div class="bt-suggest-item" data-batch="${frappe.utils.escape_html(r.name)}">
						<span>${frappe.utils.escape_html(r.name)}</span>
					</div>`;
			})
			.join("");
		this.$suggest.html(html).prop("hidden", false);

		this.$suggest.find(".bt-suggest-item").on("mousedown", (e) => {
			const name = e.currentTarget.getAttribute("data-batch");
			this.select_batch(name);
		});
	}

	select_batch(name) {
		this.batch_no = name;
		this.$batch.val(name);
		this.$trace.prop("disabled", false);
		this.hide_suggest();
	}

	hide_suggest() {
		this.$suggest.prop("hidden", true).empty();
	}

	run_trace() {
		if (!this.batch_no) return;
		this.$trace.prop("disabled", true);
		this.set_stage_message("Tracing…");

		frappe.call({
			method:
				"ampower_visualize.ampower_visualize.page.batch_traceability.batch_traceability.trace_batch",
			args: {
				batch_no: this.batch_no,
				direction: this.direction,
				max_depth: this.depth_value(),
				...this.date_args(),
			},
			callback: ({ message }) => {
				this.last_result = message || {};
				this.set_stage_message("Rendering…");
				load_dagre()
					.then(() => this.render_graph(this.last_result))
					.catch((err) => {
						console.error(err);
						this.set_stage_message("Could not load the layout engine.");
					});
			},
			always: () => this.$trace.prop("disabled", false),
		});
	}

	set_stage_message(text) {
		this.hide_panel();
		this.$stage.addClass("is-empty").html(frappe.utils.escape_html(text));
	}

	render_graph(result) {
		this.graph_model = { nodes: new Map(), linkKeys: new Set(), links: [] };
		this.movements_by_voucher = new Map();
		this.expanded = new Set();
		this.expanded_depth = new Map();
		this.explored_empty = new Set();
		this.hidden = new Set();
		this.merge_result(result);
		this.expanded.add(this.batch_no);
		this.expanded_depth.set(this.batch_no, this.depth_value());

		if (!this.graph_model.nodes.size) {
			return this.set_stage_message("No movements found for this batch.");
		}
		this.auto_truncate();
		this.draw();
	}

	voucher_sides(voucherId) {
		const out = new Set();
		const inn = new Set();
		for (const l of this.graph_model.links) {
			if (l.to === voucherId && this.is_batch(l.from)) out.add(l.from);
			if (l.from === voucherId && this.is_batch(l.to)) inn.add(l.to);
		}
		return { out: [...out], in: [...inn] };
	}

	voucher_batches(voucherId) {
		const { out, in: inn } = this.voucher_sides(voucherId);
		return new Set([...out, ...inn]);
	}

	is_batch(id) {
		const n = this.graph_model.nodes.get(id);
		return n && n.kind === "batch";
	}

	// Truncation is keyed per (voucher, batch) so hiding a batch on one voucher
	// doesn't hide it on another that shares it.
	hide_key(voucherId, batch) {
		return `${voucherId}»${batch}`;
	}

	is_hidden_on(voucherId, batch) {
		return this.hidden.has(this.hide_key(voucherId, batch));
	}

	vouchers_of_batch(batch) {
		const out = [];
		for (const n of this.graph_model.nodes.values()) {
			if (n.kind !== "voucher") continue;
			if (this.voucher_batches(n.id).has(batch)) out.push(n.id);
		}
		return out;
	}

	// A batch node disappears only when every voucher touching it has hidden it.
	is_batch_fully_hidden(batch) {
		const vs = this.vouchers_of_batch(batch);
		return vs.length > 0 && vs.every((v) => this.is_hidden_on(v, batch));
	}

	hidden_batch_count() {
		let n = 0;
		for (const node of this.graph_model.nodes.values()) {
			if (node.kind === "batch" && this.is_batch_fully_hidden(node.id)) n++;
		}
		return n;
	}

	auto_truncate() {
		const LIMIT = 4;
		for (const node of this.graph_model.nodes.values()) {
			if (node.kind !== "voucher") continue;
			const all = [...this.voucher_batches(node.id)];
			if (all.length <= LIMIT) continue;
			let kept = 0;
			const ranked = all.sort(
				(a, b) => this.keep_priority(b) - this.keep_priority(a)
			);
			for (const id of ranked) {
				if (kept < LIMIT) kept++;
				else this.hidden.add(this.hide_key(node.id, id));
			}
		}
	}

	keep_priority(id) {
		if (id === this.batch_no) return 2;
		if (this.expanded && this.expanded.has(id)) return 1;
		return 0;
	}

	visible_model() {
		const nodes = [];
		const hiddenPerVoucher = new Map();
		for (const n of this.graph_model.nodes.values()) {
			if (n.kind === "batch" && this.is_batch_fully_hidden(n.id)) continue;
			nodes.push(n);
		}
		const visibleIds = new Set(nodes.map((n) => n.id));
		const links = this.graph_model.links.filter((l) => {
			if (!visibleIds.has(l.from) || !visibleIds.has(l.to)) return false;
			const voucherId = this.is_batch(l.from) ? l.to : l.from;
			const batch = this.is_batch(l.from) ? l.from : l.to;
			return !this.is_hidden_on(voucherId, batch);
		});
		for (const v of this.graph_model.nodes.values()) {
			if (v.kind !== "voucher") continue;
			let n = 0;
			this.voucher_batches(v.id).forEach(
				(b) => this.is_hidden_on(v.id, b) && n++
			);
			if (n) hiddenPerVoucher.set(v.id, n);
		}
		return { nodes, links, hiddenPerVoucher };
	}

	merge_result(result) {
		const m = this.graph_model;
		const edges = result.edges || [];
		const movements = result.movements || [];
		const added = new Set();

		const addBatch = (id) => {
			if (!m.nodes.has(id)) {
				m.nodes.set(id, { id, kind: "batch", label: id });
				added.add(id);
			}
		};
		const addVoucher = (voucher_no, voucher_type, voucher_subtype) => {
			const id = `V::${voucher_no}`;
			const sub = voucher_subtype || voucher_type || "";
			if (!m.nodes.has(id)) {
				m.nodes.set(id, {
					id,
					kind: "voucher",
					label: voucher_no,
					sub,
					voucher_type: voucher_type || "",
					voucher_subtype: voucher_subtype || "",
					voucher_no,
				});
				added.add(id);
			} else if (voucher_subtype) {
				const node = m.nodes.get(id);
				node.voucher_subtype = voucher_subtype;
				node.sub = sub;
			}
			return id;
		};
		const addLink = (from, to) => {
			const k = `${from}»${to}`;
			if (!m.linkKeys.has(k)) {
				m.linkKeys.add(k);
				m.links.push({ from, to });
			}
		};

		for (const mv of movements) {
			if (!this.movements_by_voucher.has(mv.voucher_no)) {
				this.movements_by_voucher.set(mv.voucher_no, []);
			}
			// Dedup: the same movement can be returned again on a later expand.
			const list = this.movements_by_voucher.get(mv.voucher_no);
			const key = `${mv.sabb}»${mv.batch_no}»${mv.type_of_transaction}`;
			if (!list.some((x) => `${x.sabb}»${x.batch_no}»${x.type_of_transaction}` === key)) {
				list.push(mv);
			}
		}

		const edgeVouchers = new Set();
		for (const e of edges) {
			const vid = addVoucher(e.voucher_no, e.voucher_type, e.voucher_subtype);
			edgeVouchers.add(e.voucher_no);
			addBatch(e.from_batch);
			addBatch(e.to_batch);
			addLink(e.from_batch, vid);
			addLink(vid, e.to_batch);
		}

		for (const mv of movements) {
			if (edgeVouchers.has(mv.voucher_no)) continue;
			addBatch(mv.batch_no);
			const vid = addVoucher(mv.voucher_no, mv.voucher_type, mv.voucher_subtype);
			if (mv.type_of_transaction === "Inward") addLink(vid, mv.batch_no);
			else addLink(mv.batch_no, vid);
		}

		return added;
	}

	draw() {
		const model = this.visible_model();
		const layout = this.compute_layout(model);

		const totalBatches = [...this.graph_model.nodes.values()].filter((n) => n.kind === "batch").length;
		const voucherCount = this.graph_model.nodes.size - totalBatches;
		const _hiddenN = this.hidden_batch_count();
		const hiddenNote = _hiddenN ? ` · ${_hiddenN} hidden` : "";
		const counts = `${totalBatches} batches · ${voucherCount} vouchers${hiddenNote} · click a batch to expand`;

		this.$stage
			.removeClass("is-empty")
			.html(
				`<div class="bt-badge">${frappe.utils.escape_html(counts)}</div>` +
					`<div class="bt-zoom">
						<button data-z="in" title="Zoom in">+</button>
						<button data-z="out" title="Zoom out">−</button>
						<button data-z="fit" title="Fit to screen">⤢</button>
					</div>`
			)
			.append(this.build_svg(layout, model.hiddenPerVoucher));

		this.wire_canvas();
		this.render_legend();
		this.fit();
	}

	expand_batch(batch_id) {
		if (batch_id.startsWith("V::")) return;
		if (this.expanding) return;
		const depth = this.depth_value();
		if (this.expanded.has(batch_id) && (this.expanded_depth.get(batch_id) || 0) >= depth) {
			frappe.show_alert({ message: `${batch_id} is already expanded`, indicator: "blue" });
			return;
		}
		const prev_depth = this.expanded_depth.get(batch_id);
		this.expanded.add(batch_id);
		this.expanded_depth.set(batch_id, depth);

		this.expanding = batch_id;
		this.set_node_loading(batch_id, true);
		this.loading_alert = frappe.show_alert(
			{ message: `Tracing ${batch_id}…`, indicator: "blue" },
			10
		);

		frappe.call({
			method:
				"ampower_visualize.ampower_visualize.page.batch_traceability.batch_traceability.trace_batch",
			args: {
				batch_no: batch_id,
				direction: this.direction,
				max_depth: this.depth_value(),
				...this.date_args(),
			},
			callback: ({ message }) => {
				const added = this.merge_result(message || {});
				if (!added.size) {
					// Confirmed dead end: mark it so the expand hint clears.
					this.explored_empty.add(batch_id);
					this.redraw_keep_view();
					frappe.show_alert({
						message: `No further lineage for ${batch_id}`,
						indicator: "orange",
					});
					return;
				}
				this.draw_incremental(batch_id);
				frappe.show_alert({
					message: `${batch_id}: +${added.size} linked node${added.size === 1 ? "" : "s"}`,
					indicator: "green",
				});
			},
			error: () => {
				this.restore_expansion(batch_id, prev_depth);
				frappe.show_alert({
					message: `Could not trace ${batch_id}. Please try again.`,
					indicator: "red",
				});
			},
			always: () => {
				this.expanding = null;
				this.set_node_loading(batch_id, false);
				if (this.loading_alert) this.loading_alert.remove();
				this.loading_alert = null;
			},
		});
	}

	restore_expansion(batch_id, prev_depth) {
		if (prev_depth == null) {
			this.expanded.delete(batch_id);
			this.expanded_depth.delete(batch_id);
		} else {
			this.expanded_depth.set(batch_id, prev_depth);
		}
	}

	set_node_loading(batch_id, on) {
		const c = this.canvas;
		if (!c) return;
		const sel = `.bt-node[data-node-id="${window.CSS ? CSS.escape(batch_id) : batch_id}"]`;
		const grp = c.viewport.querySelector(sel);
		if (!grp) return;
		const existing = grp.querySelector(".bt-spinner");
		if (on) {
			grp.classList.add("is-loading");
			if (!existing) {
				const SVGNS = "http://www.w3.org/2000/svg";
				const nd = c.nodeEls.get(batch_id);
				const cx = nd ? nd.width - 12 : 130;
				const r = 5;
				const spin = document.createElementNS(SVGNS, "path");
				spin.setAttribute("class", "bt-spinner");
				spin.setAttribute(
					"d",
					`M ${cx + r} 10 A ${r} ${r} 0 1 1 ${cx} ${10 - r}`
				);
				spin.setAttribute("fill", "none");
				spin.setAttribute("stroke", "#4f46e5");
				spin.setAttribute("stroke-width", "2");
				spin.setAttribute("stroke-linecap", "round");
				spin.style.transformOrigin = `${cx}px 10px`;
				grp.appendChild(spin);
			}
		} else {
			grp.classList.remove("is-loading");
			if (existing) existing.remove();
		}
	}

	draw_incremental(anchorId) {
		const c = this.canvas;
		const oldAnchor = c.nodeEls.get(anchorId);
		const oldTransform = { tx: c.tx, ty: c.ty, k: c.k };

		this.auto_truncate();
		const model = this.visible_model();
		const layout = this.compute_layout(model);

		const badge = this.$stage.find(".bt-badge").get(0);
		const totalBatches = [...this.graph_model.nodes.values()].filter((n) => n.kind === "batch").length;
		const voucherCount = this.graph_model.nodes.size - totalBatches;
		const _hiddenN = this.hidden_batch_count();
		const hiddenNote = _hiddenN ? ` · ${_hiddenN} hidden` : "";
		if (badge) {
			badge.textContent = `${totalBatches} batches · ${voucherCount} vouchers${hiddenNote} · click a batch to expand`;
		}
		this.$stage.find(".bt-svg").remove();
		this.$stage.append(this.build_svg(layout, model.hiddenPerVoucher));
		this.wire_canvas();
		this.render_legend();

		const newAnchor = this.canvas.nodeEls.get(anchorId);
		const c2 = this.canvas;
		c2.k = oldTransform.k;
		if (oldAnchor && newAnchor) {
			c2.tx = oldTransform.tx + (oldAnchor.x - newAnchor.x) * c2.k;
			c2.ty = oldTransform.ty + (oldAnchor.y - newAnchor.y) * c2.k;
		} else {
			c2.tx = oldTransform.tx;
			c2.ty = oldTransform.ty;
		}
		this.apply_transform();
	}

	compute_edge_depths(model) {
		const isVoucher = (id) => id.startsWith("V::");

		const adj = new Map();
		const push = (a, b) => {
			if (!adj.has(a)) adj.set(a, []);
			adj.get(a).push(b);
		};
		for (const l of model.links) {
			push(l.from, l.to);
			push(l.to, l.from);
		}

		const batchRing = new Map();
		const root = this.batch_no;
		const reachable = root && model.nodes.some((n) => n.id === root);
		if (reachable) {
			batchRing.set(root, 0);
			const q = [root];
			while (q.length) {
				const cur = q.shift();
				const r = batchRing.get(cur);
				for (const v of adj.get(cur) || []) {
					if (!isVoucher(v)) continue;
					for (const nb of adj.get(v) || []) {
						if (isVoucher(nb) || batchRing.has(nb)) continue;
						batchRing.set(nb, r + 1);
						q.push(nb);
					}
				}
			}
		}

		const edgeDepth = new Map();
		for (const l of model.links) {
			const batch = isVoucher(l.from) ? l.to : l.from;
			edgeDepth.set(`${l.from}»${l.to}`, batchRing.get(batch) || 0);
		}
		return edgeDepth;
	}

	depth_color(depth) {
		const palette = [
			"#4f46e5",
			"#0ea5e9",
			"#10b981",
			"#f59e0b",
			"#ef4444",
			"#a855f7",
		];
		if (depth <= 0) return "#c7cdd6";
		return palette[Math.min(depth, palette.length) - 1];
	}

	render_legend() {
		const stageEl = this.$stage.get(0);
		if (!stageEl) return;
		let legend = stageEl.querySelector(".bt-legend");
		const c = this.canvas;
		if (!c) {
			if (legend) legend.remove();
			return;
		}
		const depths = new Set();
		const model = this.visible_model();
		const edgeDepth = this.compute_edge_depths(model);
		edgeDepth.forEach((d) => {
			if (d > 0) depths.add(d);
		});
		if (!depths.size) {
			if (legend) legend.remove();
			return;
		}
		if (!legend) {
			legend = document.createElement("div");
			legend.className = "bt-legend";
			stageEl.appendChild(legend);
		}
		const esc = frappe.utils.escape_html;
		const items = [...depths]
			.sort((a, b) => a - b)
			.map((d) => {
				const color = this.depth_color(d);
				const label = `depth ${d}`;
				return `<span class="bt-legend-item">
						<span class="bt-legend-swatch" style="background:${esc(color)}"></span>
						${esc(label)}
					</span>`;
			})
			.join("");
		legend.innerHTML = items;
	}

	compute_layout(model) {
		const SIZES = {
			batch: { w: 142, h: 36 },
			voucher: { w: 124, h: 32 },
		};
		const g = new window.dagre.graphlib.Graph();
		g.setGraph({ rankdir: "LR", ranksep: 110, nodesep: 34, marginx: 28, marginy: 28 });
		g.setDefaultEdgeLabel(() => ({}));

		for (const n of model.nodes) {
			const s = SIZES[n.kind];
			g.setNode(n.id, { meta: n, width: s.w, height: s.h });
		}
		for (const l of model.links) {
			if (g.hasNode(l.from) && g.hasNode(l.to)) g.setEdge(l.from, l.to, {});
		}
		window.dagre.layout(g);
		return { g, width: g.graph().width, height: g.graph().height };
	}

	build_svg(layout, hiddenPerVoucher) {
		const { g, width, height } = layout;
		const hidden = hiddenPerVoucher || new Map();
		const SVGNS = "http://www.w3.org/2000/svg";
		const accent = "#4f46e5";
		const make = (tag, attrs) => {
			const el = document.createElementNS(SVGNS, tag);
			for (const k in attrs) el.setAttribute(k, attrs[k]);
			return el;
		};

		const edgeDepth = this.compute_edge_depths({
			nodes: [...g.nodes()].map((id) => g.node(id).meta),
			links: g.edges().map((e) => ({ from: e.v, to: e.w })),
		});

		const markerId = (color) => "bt-arrow-" + color.replace("#", "");
		const usedColors = new Set();

		const svg = make("svg", { class: "bt-svg", width: "100%", height: "100%" });
		const viewport = make("g", { class: "bt-viewport" });

		const edgeEls = [];
		const nodeEls = new Map();

		for (const e of g.edges()) {
			const d = edgeDepth.get(`${e.v}»${e.w}`) || 0;
			const color = this.depth_color(d);
			usedColors.add(color);
			const path = make("path", {
				class: "bt-edge",
				d: this.edge_path(g.edge(e).points),
				fill: "none",
				stroke: color,
				"stroke-width": "1.5",
				"stroke-opacity": "0.7",
				"marker-end": `url(#${markerId(color)})`,
				"data-from": e.v,
				"data-to": e.w,
				"data-color": color,
			});
			viewport.appendChild(path);
			edgeEls.push({ path, v: e.v, w: e.w });
		}

		const defs = make("defs", {});
		for (const color of usedColors) {
			const marker = make("marker", {
				id: markerId(color),
				viewBox: "0 0 10 10",
				refX: "9",
				refY: "5",
				markerWidth: "7",
				markerHeight: "7",
				orient: "auto-start-reverse",
			});
			marker.appendChild(make("path", { d: "M0,0 L10,5 L0,10 z", fill: color }));
			defs.appendChild(marker);
		}
		svg.appendChild(defs);
		svg.appendChild(viewport);

		for (const id of g.nodes()) {
			const n = g.node(id);
			const meta = n.meta;
			const w = n.width;
			const h = n.height;
			const is_batch = meta.kind === "batch";
			const is_root = is_batch && meta.id === this.batch_no;
			// Unexpanded, not-yet-confirmed-empty batches are clickable to load more.
			const is_expandable =
				is_batch &&
				!this.expanded.has(meta.id) &&
				!(this.explored_empty && this.explored_empty.has(meta.id));

			const grpAttrs = {
				class: `bt-node bt-${meta.kind}` + (is_root ? " is-root" : "") +
					(is_expandable ? " is-expandable" : ""),
				transform: `translate(${(n.x - w / 2).toFixed(1)},${(n.y - h / 2).toFixed(1)})`,
				"data-node-id": id,
			};
			if (!is_batch) grpAttrs["data-voucher"] = meta.voucher_no;
			const grp = make("g", grpAttrs);
			grp.__bt_id = id;

			const fill = is_root ? accent : is_batch ? "#eef2ff" : "#f3f4f6";
			const stroke = is_root ? "none" : is_batch ? accent : "#cbd1da";
			grp.appendChild(
				make("rect", {
					width: w,
					height: h,
					rx: is_batch ? 9 : 16,
					fill,
					stroke,
					"stroke-width": "1.5",
				})
			);

			if (is_batch) {
				const tag = make("text", {
					x: w / 2,
					y: 8,
					"text-anchor": "middle",
					"dominant-baseline": "central",
					"font-size": "7.5",
					"font-weight": "700",
					"letter-spacing": "0.08em",
					fill: is_root ? "#dfe1f5" : "#8b8fd9",
				});
				tag.textContent = "BATCH";
				grp.appendChild(tag);
			}

			if (is_expandable) {
				const chevron = make("text", {
					class: "bt-expand-hint",
					x: w - 9,
					y: h / 2,
					"text-anchor": "middle",
					"dominant-baseline": "central",
					"font-size": "13",
					"font-weight": "700",
					fill: accent,
				});
				chevron.textContent = "›";
				grp.appendChild(chevron);
			}

			const label = make("text", {
				x: w / 2,
				y: meta.sub ? h / 2 - 5 : h / 2 + (is_batch ? 4 : 0),
				"text-anchor": "middle",
				"dominant-baseline": "central",
				"font-size": is_batch ? "11.5" : "10.5",
				fill: is_root ? "#fff" : "#1f2937",
				"font-weight": is_root ? "600" : "500",
			});
			label.textContent = meta.label;
			grp.appendChild(label);

			if (meta.sub) {
				const sub = make("text", {
					x: w / 2,
					y: h / 2 + 8,
					"text-anchor": "middle",
					"dominant-baseline": "central",
					"font-size": "8.5",
					fill: is_root ? "#dfe1f5" : "#9aa1ad",
				});
				sub.textContent = meta.sub;
				grp.appendChild(sub);
			}

			const hiddenCount = !is_batch ? hidden.get(id) || 0 : 0;
			if (hiddenCount) {
				const bx = w - 6;
				const by = 6;
				grp.appendChild(
					make("circle", { cx: bx, cy: by, r: 9, fill: accent })
				);
				const badge = make("text", {
					x: bx,
					y: by,
					"text-anchor": "middle",
					"dominant-baseline": "central",
					"font-size": "8.5",
					"font-weight": "700",
					fill: "#fff",
				});
				badge.textContent = `+${hiddenCount}`;
				grp.appendChild(badge);
			}

			viewport.appendChild(grp);
			nodeEls.set(id, { grp, x: n.x, y: n.y, width: w, height: h });
		}

		this.canvas = {
			svg,
			viewport,
			edgeEls,
			nodeEls,
			contentW: width,
			contentH: height,
			tx: 0,
			ty: 0,
			k: 1,
		};
		return svg;
	}

	// Draw dagre's waypoints as a smooth curve. Crossing curves read far more
	// cleanly than crossing straight polylines. We pass a Catmull-Rom spline
	// through the points (converted to cubic beziers), so the line still
	// follows dagre's node-avoiding route but flows instead of zig-zagging.
	edge_path(points) {
		const p = points;
		const f = (v) => v.toFixed(1);
		if (p.length < 3) {
			// Too few points for a spline — a simple line is fine.
			return p.map((q, i) => `${i === 0 ? "M" : "L"}${f(q.x)},${f(q.y)}`).join(" ");
		}
		let d = `M${f(p[0].x)},${f(p[0].y)}`;
		for (let i = 0; i < p.length - 1; i++) {
			const p0 = p[i - 1] || p[i];
			const p1 = p[i];
			const p2 = p[i + 1];
			const p3 = p[i + 2] || p2;
			// Catmull-Rom → cubic bezier control points.
			const c1x = p1.x + (p2.x - p0.x) / 6;
			const c1y = p1.y + (p2.y - p0.y) / 6;
			const c2x = p2.x - (p3.x - p1.x) / 6;
			const c2y = p2.y - (p3.y - p1.y) / 6;
			d += ` C${f(c1x)},${f(c1y)} ${f(c2x)},${f(c2y)} ${f(p2.x)},${f(p2.y)}`;
		}
		return d;
	}

	apply_transform() {
		const c = this.canvas;
		c.viewport.setAttribute(
			"transform",
			`translate(${c.tx.toFixed(2)},${c.ty.toFixed(2)}) scale(${c.k.toFixed(4)})`
		);
	}

	fit() {
		const c = this.canvas;
		const rect = c.svg.getBoundingClientRect();
		if (!rect.width || !c.contentW) return;
		const pad = 40;
		const k = Math.min(
			(rect.width - pad * 2) / c.contentW,
			(rect.height - pad * 2) / c.contentH
		);
		c.k = Math.max(0.05, Math.min(k, 1.5));
		c.tx = (rect.width - c.contentW * c.k) / 2;
		c.ty = (rect.height - c.contentH * c.k) / 2;
		this.apply_transform();
	}

	zoom_by(factor, cx, cy) {
		const c = this.canvas;
		const rect = c.svg.getBoundingClientRect();
		if (cx == null) {
			cx = rect.width / 2;
			cy = rect.height / 2;
		}
		const newK = Math.max(0.05, Math.min(c.k * factor, 4));
		c.tx = cx - ((cx - c.tx) / c.k) * newK;
		c.ty = cy - ((cy - c.ty) / c.k) * newK;
		c.k = newK;
		this.apply_transform();
	}

	wire_canvas() {
		const c = this.canvas;
		const $svg = $(c.svg);
		$(window).off("mousemove.bt mouseup.bt");

		this.$stage.find(".bt-zoom button").on("click", (e) => {
			const z = e.currentTarget.getAttribute("data-z");
			if (z === "in") this.zoom_by(1.2);
			else if (z === "out") this.zoom_by(1 / 1.2);
			else this.fit();
		});

		$svg.on("wheel", (e) => {
			e.preventDefault();
			const rect = c.svg.getBoundingClientRect();
			const factor = e.originalEvent.deltaY < 0 ? 1.1 : 1 / 1.1;
			this.zoom_by(factor, e.clientX - rect.left, e.clientY - rect.top);
		});

		let mode = null;
		let startX = 0;
		let startY = 0;
		let moved = false;
		let dragNode = null;
		this._suppressClick = false;

		$svg.on("mousedown", (e) => {
			if (e.button !== 0) return;
			const grp = e.target.closest(".bt-node");
			startX = e.clientX;
			startY = e.clientY;
			moved = false;
			if (grp && c.nodeEls.has(this.node_id_of(grp))) {
				mode = "node";
				const id = this.node_id_of(grp);
				const nd = c.nodeEls.get(id);
				dragNode = { id, ox: nd.x, oy: nd.y };
				$svg.addClass("is-grabbing");
			} else {
				mode = "pan";
				dragNode = null;
				$svg.addClass("is-panning");
			}
		});

		$(window).on("mousemove.bt", (e) => {
			if (!mode) return;
			const dx = e.clientX - startX;
			const dy = e.clientY - startY;
			if (!moved && Math.abs(dx) + Math.abs(dy) > 3) moved = true;
			if (mode === "pan") {
				c.tx += dx;
				c.ty += dy;
				startX = e.clientX;
				startY = e.clientY;
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

		$(window).on("mouseup.bt", () => {
			if (moved) this._suppressClick = true;
			mode = null;
			dragNode = null;
			$svg.removeClass("is-panning is-grabbing");
		});
	}

	node_id_of(grp) {
		return grp.__bt_id;
	}

	reroute_edges(movedId) {
		const c = this.canvas;
		for (const e of c.edgeEls) {
			if (e.v !== movedId && e.w !== movedId) continue;
			const a = c.nodeEls.get(e.v);
			const b = c.nodeEls.get(e.w);
			if (!a || !b) continue;
			const start = this.border_point(a, b.x, b.y);
			const end = this.border_point(b, a.x, a.y);
			e.path.setAttribute(
				"d",
				`M${start.x.toFixed(1)},${start.y.toFixed(1)} L${end.x.toFixed(1)},${end.y.toFixed(1)}`
			);
		}
	}

	border_point(n, tx, ty) {
		const dx = tx - n.x;
		const dy = ty - n.y;
		if (dx === 0 && dy === 0) return { x: n.x, y: n.y };
		const hw = n.width / 2;
		const hh = n.height / 2;
		const scale = 1 / Math.max(Math.abs(dx) / hw, Math.abs(dy) / hh);
		return { x: n.x + dx * scale, y: n.y + dy * scale };
	}

	show_voucher_panel(voucher_no) {
		const moves = (this.movements_by_voucher && this.movements_by_voucher.get(voucher_no)) || [];
		if (!moves.length) return;
		this.current_voucher = voucher_no;

		const base_type = moves[0].voucher_type || "";
		const subtype = moves[0].voucher_subtype || "";
		const voucher_type =
			subtype && subtype !== base_type ? `${subtype} (${base_type})` : base_type;
		const vid = `V::${voucher_no}`;
		const esc = frappe.utils.escape_html;

		const entries = moves.map((m) => ({
			batch_no: m.batch_no,
			dir: m.type_of_transaction === "Inward" ? "in" : "out",
			qty: m.qty,
			warehouse: m.warehouse,
			posting_datetime: m.posting_datetime,
		}));
		const movedPairs = new Set(entries.map((e) => `${e.batch_no}»${e.dir}`));
		const sides = this.voucher_sides(vid);
		for (const b of sides.out) {
			if (!movedPairs.has(`${b}»out`)) entries.push({ batch_no: b, dir: "out" });
		}
		for (const b of sides.in) {
			if (!movedPairs.has(`${b}»in`)) entries.push({ batch_no: b, dir: "in" });
		}

		const linkedBatches = this.voucher_batches(vid);
		let hiddenHere = 0;
		linkedBatches.forEach((b) => this.is_hidden_on(vid, b) && hiddenHere++);

		const rows = entries
			.map((entry) => {
				const { batch_no, dir } = entry;
				const isIn = dir === "in";
				const hasDetail = entry.qty != null || entry.warehouse != null;
				// No detail = a frontier stub whose own movements aren't loaded
				// yet. Show a hint so the blank "—" reads as "click to load", not
				// "no data". The root batch itself never lacks detail.
				const isStub = !hasDetail && batch_no !== this.batch_no;
				const qty =
					entry.qty != null ? (isIn ? "+" : "") + entry.qty : "—";
				const wh = isStub ? "Not loaded — click batch to expand" : (entry.warehouse || "—");
				const time = hasDetail ? (entry.posting_datetime || "").slice(0, 16) : "";
				const isHidden = this.is_hidden_on(vid, batch_no);
				const canToggle = batch_no && batch_no !== this.batch_no;
				const toggle = canToggle
					? `<button class="bt-move-toggle" data-batch="${esc(batch_no)}"
							title="${isHidden ? "Show in graph" : "Hide from graph"}">${isHidden ? "show" : "hide"}</button>`
					: "";
				return `
					<div class="bt-move${isHidden ? " is-hidden" : ""}${isStub ? " is-stub" : ""}" data-batch="${esc(batch_no)}" data-dir="${dir}">
						<span class="bt-move-dir ${isIn ? "in" : "out"}">${isIn ? "IN" : "OUT"}</span>
						<span class="bt-move-wh">${esc(wh)}</span>
						<span class="bt-move-qty">${esc(String(qty))}</span>
						<span class="bt-move-batch">${esc(batch_no)}</span>
						<span class="bt-move-time">${esc(time)}</span>
						${toggle}
					</div>`;
			})
			.join("");

		const stubCount = entries.filter(
			(e) => e.qty == null && e.warehouse == null && e.batch_no !== this.batch_no
		).length;
		const stubNote = stubCount
			? `<div class="bt-panel-note">${stubCount} batch${stubCount === 1 ? "" : "es"} not loaded yet — click ${stubCount === 1 ? "it" : "them"} in the graph to expand.</div>`
			: "";

		const trncBtn = hiddenHere
			? `<button class="bt-trunc" data-act="expand">Show all ${hiddenHere} hidden</button>`
			: linkedBatches.size > 1
				? `<button class="bt-trunc" data-act="truncate">Truncate all</button>`
				: "";

		this.$panel
			.html(`
				<div class="bt-panel-head">
					<div>
						<div class="bt-panel-title">${esc(voucher_no)}</div>
						<div class="bt-panel-sub">${esc(voucher_type)} · ${entries.length} entr${entries.length === 1 ? "y" : "ies"} · ${linkedBatches.size} batch${linkedBatches.size === 1 ? "" : "es"}${hiddenHere ? ` · ${hiddenHere} hidden` : ""}</div>
					</div>
					<button class="bt-panel-close" title="Close">&times;</button>
				</div>
				${stubNote}
				${trncBtn ? `<div class="bt-panel-actions">${trncBtn}</div>` : ""}
				${rows}
			`)
			.prop("hidden", false);

		this.$panel.find(".bt-panel-close").on("click", () => this.hide_panel());

		this.$panel.find(".bt-trunc").on("click", (e) => {
			const act = e.currentTarget.getAttribute("data-act");
			this.set_voucher_truncation(voucher_no, act === "truncate");
		});

		this.$panel.find(".bt-move-toggle").on("click", (e) => {
			e.stopPropagation();
			const b = e.currentTarget.getAttribute("data-batch");
			this.toggle_batch_hidden(voucher_no, b);
		});

		this.$panel
			.find(".bt-move")
			.on("mouseenter", (e) => {
				const batch_id = e.currentTarget.getAttribute("data-batch");
				if (this.is_hidden_on(vid, batch_id)) return;
				const dir = e.currentTarget.getAttribute("data-dir");
				const edge =
					dir === "in" ? { from: vid, to: batch_id } : { from: batch_id, to: vid };
				this.spotlight([vid, batch_id], [edge]);
			})
			.on("mouseleave", () => this.clear_spotlight());
	}

	set_voucher_truncation(voucher_no, truncate) {
		const vid = `V::${voucher_no}`;
		const { out, in: inn } = this.voucher_sides(vid);
		for (const b of [...out, ...inn]) {
			if (b === this.batch_no) continue;
			const key = this.hide_key(vid, b);
			if (truncate) this.hidden.add(key);
			else this.hidden.delete(key);
		}
		this.redraw_keep_view();
		this.show_voucher_panel(voucher_no);
	}

	toggle_batch_hidden(voucher_no, batch_no) {
		if (batch_no === this.batch_no) return;
		const key = this.hide_key(`V::${voucher_no}`, batch_no);
		if (this.hidden.has(key)) this.hidden.delete(key);
		else this.hidden.add(key);
		this.redraw_keep_view();
		if (this.current_voucher) this.show_voucher_panel(this.current_voucher);
	}

	redraw_keep_view() {
		const c = this.canvas;
		const keep = c ? { tx: c.tx, ty: c.ty, k: c.k } : null;
		const model = this.visible_model();
		const layout = this.compute_layout(model);

		const totalBatches = [...this.graph_model.nodes.values()].filter((n) => n.kind === "batch").length;
		const voucherCount = this.graph_model.nodes.size - totalBatches;
		const _hiddenN = this.hidden_batch_count();
		const hiddenNote = _hiddenN ? ` · ${_hiddenN} hidden` : "";
		const badge = this.$stage.find(".bt-badge").get(0);
		if (badge) {
			badge.textContent = `${totalBatches} batches · ${voucherCount} vouchers${hiddenNote} · click a batch to expand`;
		}
		this.$stage.find(".bt-svg").remove();
		this.$stage.append(this.build_svg(layout, model.hiddenPerVoucher));
		this.wire_canvas();
		this.render_legend();
		if (keep) {
			this.canvas.tx = keep.tx;
			this.canvas.ty = keep.ty;
			this.canvas.k = keep.k;
			this.apply_transform();
		} else {
			this.fit();
		}
	}

	spotlight(nodeIds, edges) {
		if (!this.canvas) return;
		const vp = this.canvas.viewport;
		vp.classList.add("bt-spotlight");
		for (const id of nodeIds) {
			const sel = `.bt-node[data-node-id="${window.CSS ? CSS.escape(id) : id}"]`;
			const el = vp.querySelector(sel);
			if (el) el.classList.add("bt-hot");
		}
		for (const e of edges) {
			const esc = (v) => (window.CSS ? CSS.escape(v) : v);
			const el = vp.querySelector(
				`.bt-edge[data-from="${esc(e.from)}"][data-to="${esc(e.to)}"]`
			);
			if (el) el.classList.add("bt-hot");
		}
	}

	clear_spotlight() {
		if (!this.canvas) return;
		const vp = this.canvas.viewport;
		vp.classList.remove("bt-spotlight");
		vp.querySelectorAll(".bt-hot").forEach((el) => el.classList.remove("bt-hot"));
	}

	hide_panel() {
		this.clear_spotlight();
		this.current_voucher = null;
		this.$panel.prop("hidden", true).empty();
	}
}
