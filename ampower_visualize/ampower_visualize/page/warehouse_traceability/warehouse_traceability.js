frappe.pages["warehouse_traceability"].on_page_load = function (wrapper) {
	const page = frappe.ui.make_app_page({
		parent: wrapper,
		title: "Warehouse Traceability",
		single_column: true,
	});

	new WarehouseTraceView(page);
};


// dagre.bundle.js imports @dagrejs/dagre and sets window.dagre; built by
// `bench build --app ampower_synergy` and loaded on demand here.
let warehouseTraceDagre = null;
function loadWarehouseTraceDagre() {
	if (window.dagre) return Promise.resolve();
	if (!warehouseTraceDagre) {
		warehouseTraceDagre = Promise.resolve().then(() => frappe.require("dagre.bundle.js"))
			.then(() => { if (!window.dagre) throw new Error("Dagre failed to load"); })
			.catch((error) => { warehouseTraceDagre = null; throw error; });
	}
	return warehouseTraceDagre;
}

class WarehouseTraceView {
	constructor(page) {
		this.page = page;
		this.batch_no = null;
		this.direction = 0;

		this.inject_styles();
		this.render_layout();
		this.bind_events();
	}

	inject_styles() {
		if (document.getElementById("warehouse-traceability-styles")) return;
		const css = `
			.wt-root {
				--wt-radius: 12px;
				--wt-accent: #4f46e5;
				--wt-gap: 16px;
				font-feature-settings: "tnum";
				display: flex;
				flex-direction: column;
				height: calc(100vh - 142px);
				min-height: 480px;
			}
			.wt-card {
				background: var(--card-bg, var(--fg-color, #fff));
				border: 1px solid var(--border-color, #e5e7eb);
				border-radius: var(--wt-radius);
				box-shadow: 0 1px 2px rgba(0,0,0,.04), 0 4px 16px rgba(0,0,0,.06);
			}
			.wt-controls {
				display: flex;
				align-items: flex-start;
				gap: var(--wt-gap);
				flex-wrap: wrap;
				padding: 16px 18px;
				margin-bottom: var(--wt-gap);
			}
			.wt-field { display: flex; flex-direction: column; gap: 6px; }
			.wt-field > label {
				font-size: 11px;
				font-weight: 600;
				letter-spacing: .04em;
				text-transform: uppercase;
				color: var(--text-muted, #6b7280);
				height: 14px;
				line-height: 14px;
				margin: 0;
			}
			.wt-controls .wt-btn { margin-top: 20px; }
			.wt-field .form-control,
			.wt-field select.form-control {
				min-width: 220px;
				border-radius: 8px;
			}
			.wt-field .wt-depth {
				min-width: 88px;
				width: 88px;
			}
			.wt-from .clearfix,
			.wt-to .clearfix,
			.wt-from .control-label,
			.wt-to .control-label,
			.wt-from .help-box,
			.wt-to .help-box,
			.wt-from .tz-info,
			.wt-to .tz-info,
			.wt-from .control-value,
			.wt-to .control-value { display: none !important; }
			.wt-from .frappe-control,
			.wt-to .frappe-control,
			.wt-from .control-input-wrapper,
			.wt-to .control-input-wrapper,
			.wt-from .control-input,
			.wt-to .control-input {
				margin: 0 !important;
				padding: 0 !important;
				min-height: 0 !important;
				line-height: normal !important;
			}
			.wt-from .form-control,
			.wt-to .form-control {
				min-width: 200px;
				height: var(--input-height);
				border-radius: 8px;
				margin: 0 !important;
			}
			.wt-search { position: relative; }
			.wt-suggest {
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
			.wt-suggest-item {
				display: flex;
				justify-content: space-between;
				gap: 12px;
				padding: 8px 10px;
				border-radius: 7px;
				cursor: pointer;
			}
			.wt-suggest-item:hover,
			.wt-suggest-item[aria-selected="true"] {
				background: var(--wt-accent);
				color: #fff;
			}
			.wt-suggest-item .wt-sub {
				font-size: 12px;
				opacity: .7;
				white-space: nowrap;
			}
			.wt-suggest-empty {
				padding: 10px;
				color: var(--text-muted, #6b7280);
				font-size: 13px;
			}
			.wt-btn {
				border: none;
				border-radius: 8px;
				padding: 8px 18px;
				font-weight: 600;
				background: var(--wt-accent);
				color: #fff;
				transition: filter .12s ease, transform .02s ease;
			}
			.page-body:has(.wt-root) .container,
			.page-body:has(.wt-root) .page-wrapper .container { max-width: none; }
			.wt-controls { margin-bottom: var(--wt-gap); flex: 0 0 auto; }
			.wt-btn:hover { filter: brightness(1.07); }
			.wt-btn:active { transform: translateY(1px); }
			.wt-btn[disabled] { opacity: .5; cursor: not-allowed; }
			.wt-stage-wrap { position: relative; flex: 1; min-height: 0; overflow: hidden; }
			.wt-stage {
				position: absolute;
				inset: 0;
				color: var(--text-muted, #6b7280);
				overflow: hidden;
			}
			.wt-stage.is-empty {
				display: flex;
				align-items: center;
				justify-content: center;
			}
			.wt-svg { position: absolute; inset: 0; cursor: grab; user-select: none; }
			.wt-svg.is-panning { cursor: grabbing; }
			.wt-svg.is-grabbing { cursor: grabbing; }
			.wt-zoom {
				position: absolute;
				right: 14px;
				bottom: 14px;
				z-index: 5;
				display: flex;
				flex-direction: column;
				gap: 4px;
			}
			.wt-zoom button {
				width: 30px; height: 30px;
				border: 1px solid var(--border-color, #e5e7eb);
				background: var(--fg-color, #fff);
				border-radius: 8px;
				font-size: 16px; line-height: 1;
				cursor: pointer;
				box-shadow: 0 1px 2px rgba(0,0,0,.06);
			}
			.wt-zoom button:hover { background: var(--control-bg, #f3f4f6); }
			.wt-node rect { transition: filter .12s ease; }
			.wt-node.is-loading rect {
				stroke-dasharray: 4 3;
				animation: wt-pulse 1s ease-in-out infinite;
			}
			.wt-node.is-loading .wt-spinner { animation: wt-spin .7s linear infinite; }
			@keyframes wt-pulse { 0%,100% { opacity: 1; } 50% { opacity: .45; } }
			@keyframes wt-spin { to { transform: rotate(360deg); } }
			.wt-warehouse, .wt-edge, .wt-edge-label { cursor: pointer; }
			.wt-warehouse:hover rect { filter: brightness(0.95); }
			.wt-edge { pointer-events: stroke; }
			.wt-edge-label { font-size: 10px; fill: var(--text-color, #1f2937); paint-order: stroke; stroke: var(--card-bg, #fff); stroke-width: 3px; stroke-linejoin: round; }
			.wt-spotlight .wt-edge-label { opacity: .25; }
			.wt-spotlight .wt-edge-label.wt-hot { opacity: 1; }
			.wt-transaction { grid-column: 1 / -1; display: flex; gap: 6px; flex-wrap: wrap; align-items: baseline; }
			.wt-voucher-link { border: none; padding: 0; background: none; color: var(--wt-accent); text-decoration: underline; }
			.wt-company .control-label, .wt-company .help-box { display: none !important; }
			.wt-company .frappe-control { margin-bottom: 0; }
			.wt-expansion-error { position: absolute; z-index: 4; bottom: 14px; right: 14px; padding: 8px; background: var(--card-bg, #fff); }
			@media (max-width: 600px) {
				.wt-root { height: auto; }
				.wt-stage-wrap { min-height: 55vh; }
				.wt-field { min-width: 0; flex: 1 1 130px; }
				.wt-field .form-control, .wt-field select.form-control { min-width: 0; width: 100%; }
				.wt-root .wt-panel { width: min(100%, 360px); }
				.wt-root .wt-badge { max-width: calc(100% - 65px); white-space: normal; }
			}
			.wt-batch { cursor: pointer; }
			.wt-batch:hover rect { filter: brightness(0.94); }
			/* expand hint */
			.wt-expand-hint { opacity: .45; transition: opacity .12s ease; }
			.wt-batch.is-expandable:hover .wt-expand-hint { opacity: 1; }
			.wt-viewport.wt-spotlight .wt-node,
			.wt-viewport.wt-spotlight .wt-edge {
				opacity: .12;
				filter: blur(1.5px);
				transition: opacity .12s ease, filter .12s ease;
			}
			.wt-viewport.wt-spotlight .wt-node.wt-hot,
			.wt-viewport.wt-spotlight .wt-edge.wt-hot {
				opacity: 1;
				filter: none;
			}
			.wt-badge {
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
			.wt-legend {
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
			.wt-legend-item { display: flex; align-items: center; gap: 5px; }
			.wt-legend-swatch {
				width: 16px;
				height: 3px;
				border-radius: 2px;
				display: inline-block;
			}
			.wt-panel {
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
			.wt-panel[hidden] { display: block; transform: translateX(100%); }
			.wt-panel-head {
				display: flex;
				align-items: flex-start;
				justify-content: space-between;
				gap: 8px;
				padding: 16px 18px 10px;
				border-bottom: 1px solid var(--border-color, #e5e7eb);
			}
			.wt-panel-title { font-weight: 600; font-size: 14px; }
			.wt-panel-sub { font-size: 12px; color: var(--text-muted, #6b7280); }
			.wt-panel-note {
				margin: 8px 18px;
				padding: 7px 10px;
				font-size: 11.5px;
				border-radius: 7px;
				background: #eef2ff;
				color: var(--wt-accent, #4f46e5);
			}
			.wt-panel-close {
				border: none; background: none; cursor: pointer;
				font-size: 20px; line-height: 1; color: var(--text-muted, #6b7280);
				padding: 0 4px;
			}
			.wt-panel-close:hover { color: var(--text-color, #1f2937); }
			.wt-move {
				display: grid;
				grid-template-columns: auto 1fr auto;
				gap: 2px 10px;
				padding: 11px 18px;
				border-bottom: 1px solid var(--border-color, #f0f1f3);
				font-size: 12.5px;
			}
			.wt-move-dir {
				grid-row: span 2;
				align-self: center;
				font-size: 10px;
				font-weight: 600;
				letter-spacing: .03em;
				padding: 2px 7px;
				border-radius: 6px;
			}
			.wt-move-dir.in { background: #e7f5ec; color: #1a7f43; }
			.wt-move-dir.out { background: #fdeaea; color: #c0392b; }
			.wt-move-wh { color: var(--text-color, #1f2937); }
			.wt-move-batch { font-size: 11px; color: var(--text-muted, #6b7280); }
			.wt-move-qty { font-weight: 600; text-align: right; }
			.wt-move-time { font-size: 11px; color: var(--text-muted, #9aa1ad); text-align: right; }
			.wt-move-toggle {
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
			.wt-move-toggle:hover { background: var(--control-bg, #f3f4f6); }
			.wt-move.is-hidden { opacity: .55; }
			.wt-move.is-hidden .wt-move-batch { text-decoration: line-through; }
			.wt-move.is-stub .wt-move-wh {
				font-style: italic;
				font-size: 11px;
				color: var(--wt-accent, #4f46e5);
			}
			.wt-panel-actions { padding: 8px 18px; border-bottom: 1px solid var(--border-color, #f0f1f3); }
			.wt-trunc {
				border: 1px solid var(--wt-accent);
				background: var(--fg-color, #fff);
				color: var(--wt-accent);
				border-radius: 7px;
				font-size: 11px;
				font-weight: 600;
				padding: 5px 12px;
				cursor: pointer;
			}
			.wt-trunc:hover { background: #eef2ff; }
		`;
		const tag = document.createElement("style");
		tag.id = "warehouse-traceability-styles";
		tag.textContent = css;
		document.head.appendChild(tag);
	}

	render_layout() {
		this.page.main.html(`
			<div class="wt-root">
				<div class="wt-card wt-controls">
					<div class="wt-field">
						<label>Company</label><div class="wt-company"></div>
					</div>
					<div class="wt-field">
						<label for="wt-seed-mode">Start from</label>
						<select id="wt-seed-mode" class="form-control wt-mode"><option>Warehouse</option><option>Batch</option></select>
					</div>
					<div class="wt-field">
						<label for="wt-seed">Warehouse</label>
						<div class="wt-search">
							<input id="wt-seed" type="text" class="form-control wt-seed" placeholder="Search warehouse…" autocomplete="off" role="combobox" aria-controls="wt-suggestions" aria-expanded="false" aria-autocomplete="list">
							<div id="wt-suggestions" class="wt-suggest" hidden></div>
						</div>
					</div>
					<div class="wt-field">
						<label for="wt-direction">Direction</label>
						<select id="wt-direction" class="form-control wt-direction">
							<option value="0">Both</option>
							<option value="-1">Ancestors (where it came from)</option>
							<option value="1">Descendants (what it became)</option>
						</select>
					</div>
					<div class="wt-field">
						<label for="wt-depth">Depth</label>
						<input id="wt-depth" type="number" class="form-control wt-depth"
							min="0" max="50" step="1" value="1">
					</div>
					<div class="wt-field">
						<label>From</label>
						<div class="wt-from"></div>
					</div>
					<div class="wt-field">
						<label>To</label>
						<div class="wt-to"></div>
					</div>
					<button class="wt-btn wt-trace" disabled>Trace</button>
				</div>
				<div class="wt-card wt-stage-wrap">
					<div class="wt-stage is-empty">Select a company and a starting warehouse or batch, then press Trace.</div>
					<aside class="wt-panel" hidden></aside>
				</div>
			</div>
		`);

		const $root = this.page.main.find(".wt-root");
		this.$batch = $root.find(".wt-seed");
		this.$mode = $root.find(".wt-mode");
		this.company_control = frappe.ui.form.make_control({
			df: { fieldtype: "Link", fieldname: "company", options: "Company", placeholder: "Company", change: () => this.reset_seed() },
			parent: $root.find(".wt-company").get(0), render_input: true,
		});
		this.company_control.$input.attr("aria-label", "Company");
		this.$suggest = $root.find(".wt-suggest");
		this.$direction = $root.find(".wt-direction");
		this.$depth = $root.find(".wt-depth");
		this.$trace = $root.find(".wt-trace");
		this.$stage = $root.find(".wt-stage");
		this.$panel = $root.find(".wt-panel");

		this.from_control = frappe.ui.form.make_control({
			df: {
				fieldtype: "Datetime",
				fieldname: "from_datetime",
				placeholder: "From",
				hide_timezone: true,
			},
			parent: $root.find(".wt-from").get(0),
			render_input: true,
		});
		this.to_control = frappe.ui.form.make_control({
			df: {
				fieldtype: "Datetime",
				fieldname: "to_datetime",
				placeholder: "To",
				hide_timezone: true,
			},
			parent: $root.find(".wt-to").get(0),
			render_input: true,
		});
		const now = frappe.datetime.now_datetime();
		this.from_control.set_value(`${frappe.datetime.add_days(now.slice(0, 10), -30)} ${now.slice(11)}`);
		this.to_control.set_value(now);
		this.from_control.$input.attr("aria-label", "From");
		this.to_control.$input.attr("aria-label", "To");
		const company = frappe.defaults.get_user_default("Company");
		if (company) this.company_control.set_value(company);
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
		this.$mode.on("change", () => this.reset_seed());
		this.company_control.$input.on("input", () => this.reset_seed());
		this.$batch.on("input", () => {
			this.seed = null;
			this.invalidate_graph();
			this.lookup();
		});
		this.$batch.on("focus", () => { if (!this.seed) this.lookup(); });
		this.$batch.on("blur", (e) => {
			if (!this.$suggest.get(0).contains(e.relatedTarget)) this.hide_suggest();
		});
		this.$batch.on("keydown", (e) => {
			const rows = this.suggestion_rows || [];
			if (e.key === "Escape") return this.hide_suggest();
			if (!rows.length) return;
			if (["ArrowDown", "ArrowUp"].includes(e.key)) {
				e.preventDefault();
				const step = e.key === "ArrowDown" ? 1 : -1;
				this.suggestion_index = this.suggestion_index < 0 ? (step > 0 ? 0 : rows.length - 1)
					: (this.suggestion_index + step + rows.length) % rows.length;
				const items = this.$suggest.find(".wt-suggest-item").attr("aria-selected", "false");
				const active = items.eq(this.suggestion_index).attr("aria-selected", "true");
				this.$batch.attr("aria-activedescendant", active.attr("id"));
				active.get(0).scrollIntoView({ block: "nearest" });
			} else if (e.key === "Enter" && this.suggestion_index >= 0) {
				e.preventDefault();
				this.select_seed(rows[this.suggestion_index].name);
			}
		});
		this.$direction.add(this.from_control.$input).add(this.to_control.$input).on("change input", () => this.invalidate_graph());
		this.$depth.on("change input", () => { if (!this.canvas) this.invalidate_graph(); });
		this.$trace.on("click", () => this.run_trace());
		this.$stage.on("click", ".wt-warehouse, .wt-edge, .wt-edge-label, .wt-batch", (e) => {
			if (this._suppressClick) { this._suppressClick = false; return; }
			const el = e.currentTarget;
			if (el.__wt_link) this.show_details({ link: el.__wt_link });
			else if (el.__wt_id && el.classList.contains("wt-warehouse")) this.show_details({ warehouse: el.__wt_id });
			else if (el.__wt_id) this.expand_batch(el.__wt_id);
		});
	}

	reset_seed() {
		this.seed = null;
		this.$batch.val("");
		const mode = this.$mode.val();
		this.page.main.find('label[for="wt-seed"]').text(mode);
		this.$batch.attr("placeholder", mode === "Batch" ? "Search batch or item…" : "Search warehouse…");
		this.hide_suggest();
		this.invalidate_graph();
	}

	invalidate_graph() {
		this.trace_token = (this.trace_token || 0) + 1;
		this.expanding = null;
		if (this.loading_alert) this.loading_alert.remove();
		this.loading_alert = null;
		this.set_stage_message("Select a company and a starting warehouse or batch, then press Trace.");
		this.$trace.prop("disabled", !this.seed || !this.company_control.get_value());
	}

	lookup() {
		this.hide_suggest();
		const query = this.$batch.val().trim();
		const company = this.company_control.get_value();
		if (!query) return;
		if (!company) return this.suggest_status("Select a company first.");
		this.suggest_status("Searching…");
		this.search_debounced(query, company, this.$mode.val(), this.lookup_token);
	}

	search_debounced = frappe.utils.debounce((...args) => this.search(...args), 250);

	suggest_status(text) {
		this.$suggest.html(`<div class="wt-suggest-empty" role="status">${frappe.utils.escape_html(text)}</div>`).prop("hidden", false);
		this.$batch.attr("aria-expanded", "true");
	}

	search(query, company, mode, token) {
		const current = () => token === this.lookup_token && company === this.company_control.get_value();
		if (!current()) return;
		const warehouse = mode === "Warehouse";
		frappe.call({
			method: warehouse
				? "ampower_visualize.ampower_visualize.page.warehouse_traceability.warehouse_traceability.search_warehouses"
				: "ampower_visualize.ampower_visualize.page.warehouse_traceability.warehouse_traceability.search_batches",
			args: { query, limit: 20, ...(warehouse ? { company } : {}) },
			callback: ({ message }) => { if (current()) this.show_suggest(message || []); },
			error: () => {
				if (!current()) return;
				this.suggest_status("Lookup failed.");
				this.$suggest.append('<button type="button" class="wt-lookup-retry">Retry lookup</button>')
					.find("button").on("click", () => { this.$batch.trigger("focus"); this.lookup(); });
			},
		});
	}

	show_suggest(rows) {
		if (!rows.length) return this.suggest_status("No matching records.");
		this.suggestion_rows = rows;
		this.suggestion_index = -1;
		const esc = frappe.utils.escape_html;
		this.$suggest.html(`<div role="listbox">${rows.map((r, i) =>
			`<div class="wt-suggest-item" id="wt-option-${i}" role="option" aria-selected="false" data-index="${i}">${esc(r.name)}</div>`
		).join("")}</div>`).prop("hidden", false);
		this.$suggest.find(".wt-suggest-item").on("mousedown", (e) => {
			e.preventDefault();
			this.select_seed(rows[Number(e.currentTarget.dataset.index)].name);
		});
	}

	select_seed(name) {
		this.seed = name;
		this.$batch.val(name);
		this.$trace.prop("disabled", false);
		this.hide_suggest();
	}

	hide_suggest() {
		this.lookup_token = (this.lookup_token || 0) + 1;
		this.suggestion_rows = [];
		this.$batch.attr("aria-expanded", "false").removeAttr("aria-activedescendant");
		this.$suggest.prop("hidden", true).empty();
	}

	static trace_request(scope, mode, seed, max_depth) {
		if (!scope.company || !seed || !scope.from_datetime || !scope.to_datetime || scope.from_datetime > scope.to_datetime) return null;
		const warehouse = mode === "Warehouse";
		return {
			method: warehouse
				? "ampower_visualize.ampower_visualize.page.warehouse_traceability.warehouse_traceability.trace_warehouse"
				: "ampower_visualize.ampower_visualize.page.warehouse_traceability.warehouse_traceability.trace_batch",
			args: { ...scope, max_depth, [warehouse ? "warehouse" : "batch_no"]: seed },
		};
	}

	run_trace() {
		const scope = { company: this.company_control.get_value(), direction: Number(this.$direction.val()), ...this.date_args() };
		const mode = this.$mode.val();
		const seed = this.seed;
		const max_depth = this.depth_value();
		const request = WarehouseTraceView.trace_request(scope, mode, seed, max_depth);
		if (!request) return this.set_stage_message("Select a company and a starting record, and enter both dates in order.");
		this.invalidate_graph();
		const token = this.trace_token;
		const current = () => token === this.trace_token;
		const warehouse = mode === "Warehouse";
		this.$trace.prop("disabled", true);
		this.set_stage_message("Tracing…");
		const fail = (text) => {
			if (!current()) return;
			this.set_stage_message(text);
			this.$stage.append(' <button class="wt-btn wt-retry">Retry</button>').find(".wt-retry").on("click", () => this.run_trace());
			this.$trace.prop("disabled", false);
		};
		frappe.call({
			...request,
			callback: ({ message }) => {
				if (!current()) return;
				this.scope = scope;
				this.root_id = `${warehouse ? "W" : "B"}::${seed}`;
				this.batch_no = warehouse ? null : this.root_id;
				if (!message?.nodes?.length) {
					this.render_graph(message || {}, max_depth);
					this.$trace.prop("disabled", false);
					return;
				}
				this.set_stage_message("Rendering…");
				loadWarehouseTraceDagre().then(() => {
					if (!current()) return;
					this.render_graph(message || {}, max_depth);
					this.$trace.prop("disabled", false);
				}).catch(() => fail("Could not render the movement graph."));
			},
			error: () => fail("Could not trace stock movements."),
		});
	}

	set_stage_message(text) {
		this.hide_panel();
		this.canvas = null;
		$(window).off("mousemove.wt mouseup.wt");
		this.$stage.addClass("is-empty").text(text);
	}

	render_graph(result, max_depth) {
		this.graph_model = {
			nodes: new Map(), linkKeys: new Map(), links: [],
			voucherSides: new Map(), batchVouchers: new Map(),
			movements: new Map(), warehouseMoves: new Map(),
		};
		this.partial = false;
		this.expanded = new Set();
		this.expanded_depth = new Map();
		this.explored_empty = new Set();
		this.hidden = new Set();
		this.manual_visibility = new Map();
		this.merge_result(result);
		if (this.batch_no && !this.partial) {
			this.expanded.add(this.batch_no);
			this.expanded_depth.set(this.batch_no, max_depth);
		}
		if (!this.graph_model.nodes.size) {
			return this.set_stage_message(this.partial ? "Partial trace: limits reached before finding a movement. Try a narrower date range." : "No movements found for this selection.");
		}
		this.auto_truncate();
		this.draw();
	}

	voucher_sides(voucherId) {
		const sides = this.graph_model.voucherSides.get(voucherId);
		if (!sides) return { out: [], in: [] };
		return { out: [...sides.out], in: [...sides.in] };
	}

	voucher_batches(voucherId) {
		const sides = this.graph_model.voucherSides.get(voucherId);
		if (!sides) return new Set();
		const out = new Set(sides.out);
		sides.in.forEach((b) => out.add(b));
		return out;
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
		const vs = this.graph_model.batchVouchers.get(batch);
		return vs ? [...vs] : [];
	}

	// A batch node disappears only when every voucher touching it has hidden it.
	is_batch_fully_hidden(batch) {
		const vs = this.graph_model.batchVouchers.get(batch);
		if (!vs || !vs.size) return false;
		for (const v of vs) {
			if (!this.is_hidden_on(v, batch)) return false;
		}
		return true;
	}

	hidden_batch_count() {
		let n = 0;
		for (const node of this.graph_model.nodes.values()) {
			if (node.kind === "batch" && this.is_batch_fully_hidden(node.id)) n++;
		}
		return n;
	}

	badge_text() {
		let totalBatches = 0;
		for (const n of this.graph_model.nodes.values()) {
			if (n.kind === "batch") totalBatches++;
		}
		const voucherCount = this.graph_model.nodes.size - totalBatches;
		const hidden = this.hidden_batch_count();
		const hiddenNote = hidden ? ` · ${hidden} hidden` : "";
		return `${totalBatches} batches · ${voucherCount} warehouses${hiddenNote} · click a batch to expand${this.partial ? " · Partial trace: limits reached" : ""}`;
	}

	update_badge() {
		const badge = this.$stage.find(".wt-badge").get(0);
		if (badge) badge.textContent = this.badge_text();
	}

	auto_truncate() {
		this.hidden.clear();
		for (const node of this.graph_model.nodes.values()) {
			if (node.kind !== "warehouse") continue;
			const ranked = [...this.voucher_batches(node.id)].sort((a, b) => this.keep_priority(b) - this.keep_priority(a));
			ranked.forEach((id, index) => {
				const key = this.hide_key(node.id, id);
				if (id !== this.batch_no && (this.manual_visibility.get(key) ?? index >= 4)) this.hidden.add(key);
			});
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
			if (l.kind === "lineage") return true;
			const fromBatch = this.is_batch(l.from);
			const voucherId = fromBatch ? l.to : l.from;
			const batch = fromBatch ? l.from : l.to;
			return !this.is_hidden_on(voucherId, batch);
		});
		for (const warehouse of this.graph_model.voucherSides.keys()) {
			const n = [...this.voucher_batches(warehouse)].filter((b) => this.is_hidden_on(warehouse, b)).length;
			if (n) hiddenPerVoucher.set(warehouse, n);
		}
		return { nodes, links, hiddenPerVoucher };
	}

	merge_result(result, offset = 0) {
		this.partial = this.partial || Boolean(result.truncated);
		return WarehouseTraceView.merge_model(this.graph_model, result, offset);
	}

	static merge_model(m, result, offset) {
		let added = 0;
		for (const node of result.nodes || []) {
			if (!m.nodes.has(node.id)) { m.nodes.set(node.id, node); added++; }
		}
		for (const row of result.movements || []) {
			if (m.movements.has(row.id)) continue;
			m.movements.set(row.id, row);
			const warehouse = `W::${row.warehouse}`;
			if (!m.warehouseMoves.has(warehouse)) m.warehouseMoves.set(warehouse, []);
			m.warehouseMoves.get(warehouse).push(row);
			added++;
		}
		for (const edge of result.graph_links || []) {
			const from = edge.source, to = edge.target;
			const key = JSON.stringify([from, to]);
			let link = m.linkKeys.get(key);
			if (!link) {
				link = { from, to, kind: edge.kind, depth: edge.depth + offset, ids: new Set(), pairs: new Map() };
				m.linkKeys.set(key, link);
				m.links.push(link);
				added++;
				if (edge.kind === "movement") {
					const inward = from.startsWith("B::");
					const warehouse = inward ? to : from, batch = inward ? from : to;
					if (!m.voucherSides.has(warehouse)) m.voucherSides.set(warehouse, { in: new Set(), out: new Set() });
					m.voucherSides.get(warehouse)[inward ? "in" : "out"].add(batch);
					if (!m.batchVouchers.has(batch)) m.batchVouchers.set(batch, new Set());
					m.batchVouchers.get(batch).add(warehouse);
				}
			}
			link.depth = Math.min(link.depth, edge.depth + offset);
			for (const id of edge.movement_ids) link.ids.add(id);
			for (const pair of edge.pairs || []) {
				const pairKey = JSON.stringify(pair);
				if (!link.pairs.has(pairKey)) { link.pairs.set(pairKey, pair); added++; }
			}
		}
		return added;
	}

	static details_rows(model, selection) {
		const rows = selection.link ? [...selection.link.ids].map((id) => model.movements.get(id))
			: model.warehouseMoves.get(selection.warehouse) || [];
		return [...rows].sort((a, b) => b.posting_datetime.localeCompare(a.posting_datetime) || a.id.localeCompare(b.id));
	}

	static link_label(link, model) {
		const rows = WarehouseTraceView.details_rows(model, { link });
		if (link.kind === "lineage") {
			const pairs = [...link.pairs.values()].map(([a, b]) => [model.movements.get(a), model.movements.get(b)]);
			pairs.sort((a, b) => `${b[1].posting_datetime}:${b[0].posting_datetime}:${b[1].id}`.localeCompare(`${a[1].posting_datetime}:${a[0].posting_datetime}:${a[1].id}`));
			const [source, target] = pairs[0];
			const time = source.posting_datetime === target.posting_datetime ? target.posting_datetime
				: `${source.posting_datetime} → ${target.posting_datetime}`;
			return `${Math.abs(source.qty)} issued / ${Math.abs(target.qty)} received · ${time}${pairs.length > 1 ? ` · ${pairs.length} pairs` : ""}`;
		}
		const row = rows[0];
		return `${Math.abs(row.qty)}${row.stock_uom ? ` ${row.stock_uom}` : ""} · ${row.posting_datetime}${rows.length > 1 ? ` · ${rows.length} movements` : ""}`;
	}

	draw() {
		const model = this.visible_model();
		const layout = this.compute_layout(model);

		this.$stage
			.removeClass("is-empty")
			.html(
				`<div class="wt-badge">${frappe.utils.escape_html(this.badge_text())}</div>` +
					`<div class="wt-zoom">
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
		if (!this.canvas || !this.is_batch(batch_id) || this.expanding) return;
		const name = this.graph_model.nodes.get(batch_id).label;
		const token = this.trace_token;
		const current = () => token === this.trace_token;
		const depth = this.depth_value();
		if (this.expanded.has(batch_id) && this.expanded_depth.get(batch_id) >= depth) {
			frappe.show_alert({ message: this.explored_empty.has(batch_id) ? "No further lineage at this depth." : "This batch is already expanded.", indicator: "blue" });
			return;
		}
		this.$stage.find(".wt-expansion-error").remove();

		this.expanding = batch_id;
		this.set_node_loading(batch_id, true);
		this.loading_alert = frappe.show_alert(
			{ message: "Tracing batch…", indicator: "blue" },
			10
		);

		frappe.call({
			...WarehouseTraceView.trace_request(this.scope, "Batch", name, depth),
			callback: ({ message }) => {
				if (!current()) return;
				const offset = this.graph_model.links.reduce((min, edge) => edge.from === batch_id || edge.to === batch_id ? Math.min(min, edge.depth) : min, Infinity);
				const added = this.merge_result(message || {}, Number.isFinite(offset) ? offset : 0);
				if (!message?.truncated) {
					this.expanded.add(batch_id);
					this.expanded_depth.set(batch_id, depth);
					if (!added) this.explored_empty.add(batch_id);
					else this.explored_empty.delete(batch_id);
				}
				this.draw_incremental(batch_id);
				if (this.current_details) this.show_details(this.current_details);
				frappe.show_alert({ message: message?.truncated ? "Batch expanded with partial results." : added ? "Batch expanded." : "No further lineage at this depth.", indicator: added ? "green" : "orange" });
			},
			error: () => {
				if (!current()) return;
				this.$stage.append('<div class="wt-expansion-error" role="status">Could not expand batch. <button type="button">Retry expansion</button></div>')
					.find(".wt-expansion-error button").on("click", () => this.expand_batch(batch_id));
			},
			always: () => {
				if (!current()) return;
				this.expanding = null;
				this.set_node_loading(batch_id, false);
				if (this.loading_alert) this.loading_alert.remove();
				this.loading_alert = null;
			},
		});
	}

	set_node_loading(batch_id, on) {
		const c = this.canvas;
		if (!c) return;
		const sel = `.wt-node[data-node-id="${window.CSS ? CSS.escape(batch_id) : batch_id}"]`;
		const grp = c.viewport.querySelector(sel);
		if (!grp) return;
		const existing = grp.querySelector(".wt-spinner");
		if (on) {
			grp.classList.add("is-loading");
			if (!existing) {
				const SVGNS = "http://www.w3.org/2000/svg";
				const nd = c.nodeEls.get(batch_id);
				const cx = nd ? nd.width - 12 : 130;
				const r = 5;
				const spin = document.createElementNS(SVGNS, "path");
				spin.setAttribute("class", "wt-spinner");
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

		this.update_badge();
		this.$stage.find(".wt-svg").remove();
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
		let legend = stageEl.querySelector(".wt-legend");
		const c = this.canvas;
		if (!c) {
			if (legend) legend.remove();
			return;
		}
		const depths = new Set();
		// build_svg just computed this; reuse instead of doing the BFS twice.
		c.edgeDepth.forEach((d) => {
			if (d > 0) depths.add(d);
		});
		if (!depths.size) {
			if (legend) legend.remove();
			return;
		}
		if (!legend) {
			legend = document.createElement("div");
			legend.className = "wt-legend";
			stageEl.appendChild(legend);
		}
		const esc = frappe.utils.escape_html;
		const items = [...depths]
			.sort((a, b) => a - b)
			.map((d) => {
				const color = this.depth_color(d);
				const label = `depth ${d}`;
				return `<span class="wt-legend-item">
						<span class="wt-legend-swatch" style="background:${esc(color)}"></span>
						${esc(label)}
					</span>`;
			})
			.join("");
		legend.innerHTML = items;
	}

	compute_layout(model) {
		const SIZES = {
			batch: { w: 142, h: 36 },
			warehouse: { w: 162, h: 36 },
		};
		const g = new window.dagre.graphlib.Graph();
		g.setGraph({ rankdir: "LR", ranksep: 110, nodesep: 34, marginx: 28, marginy: 28 });
		g.setDefaultEdgeLabel(() => ({}));

		for (const n of model.nodes) {
			const s = SIZES[n.kind];
			g.setNode(n.id, { meta: n, width: s.w, height: s.h });
		}
		for (const l of model.links) {
			if (!g.hasNode(l.from) || !g.hasNode(l.to)) continue;
			const text = WarehouseTraceView.link_label(l, this.graph_model);
			g.setEdge(l.from, l.to, { link: l, text, width: text.length * 5.6, height: 16, labelpos: "c" });
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

		const edgeDepth = new Set();

		const markerId = (color) => "wt-arrow-" + color.replace("#", "");
		const usedColors = new Set();

		const svg = make("svg", { class: "wt-svg", width: "100%", height: "100%" });
		const viewport = make("g", { class: "wt-viewport" });

		const edgeEls = [];
		const nodeEls = new Map();

		for (const e of g.edges()) {
			const data = g.edge(e);
			edgeDepth.add(data.link.depth);
			const color = this.depth_color(data.link.depth);
			usedColors.add(color);
			const path = make("path", {
				class: "wt-edge",
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
			if (data.link.kind === "lineage") path.setAttribute("stroke-dasharray", "5 3");
			path.__wt_link = data.link;
			viewport.appendChild(path);
			const label = make("text", { class: "wt-edge-label", x: data.x, y: data.y, "text-anchor": "middle", "dominant-baseline": "central" });
			label.textContent = data.text;
			label.__wt_link = data.link;
			viewport.appendChild(label);
			edgeEls.push({ path, label, v: e.v, w: e.w });
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
			const is_root = meta.id === this.root_id;
			// Unexpanded, not-yet-confirmed-empty batches are clickable to load more.
			const is_expandable =
				is_batch &&
				!this.expanded.has(meta.id) &&
				!(this.explored_empty && this.explored_empty.has(meta.id));

			const grpAttrs = {
				class: `wt-node wt-${meta.kind}` + (is_root ? " is-root" : "") +
					(is_expandable ? " is-expandable" : ""),
				transform: `translate(${(n.x - w / 2).toFixed(1)},${(n.y - h / 2).toFixed(1)})`,
				"data-node-id": id,
			};
			const grp = make("g", grpAttrs);
			grp.__wt_id = id;

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

			{
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
				tag.textContent = is_batch ? "BATCH" : "WAREHOUSE";
				grp.appendChild(tag);
			}

			if (is_expandable) {
				const chevron = make("text", {
					class: "wt-expand-hint",
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
				y: h / 2 + 4,
				"text-anchor": "middle",
				"dominant-baseline": "central",
				"font-size": is_batch ? "11.5" : "10.5",
				fill: is_root ? "#fff" : "#1f2937",
				"font-weight": is_root ? "600" : "500",
			});
			label.textContent = meta.label.length > 26 ? `${meta.label.slice(0, 25)}…` : meta.label;
			const title = make("title", {});
			title.textContent = meta.label;
			grp.append(title, label);

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
			edgeDepth,
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
		$(window).off("mousemove.wt mouseup.wt");

		this.$stage.find(".wt-zoom button").on("click", (e) => {
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
			const grp = e.target.closest(".wt-node");
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

		$(window).on("mousemove.wt", (e) => {
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

		$(window).on("mouseup.wt", () => {
			if (moved) this._suppressClick = true;
			mode = null;
			dragNode = null;
			$svg.removeClass("is-panning is-grabbing");
		});
	}

	node_id_of(grp) {
		return grp.__wt_id;
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
			const reverse = c.edgeEls.some((edge) => edge.v === e.w && edge.w === e.v);
			const dx = end.x - start.x, dy = end.y - start.y;
			const length = Math.hypot(dx, dy) || 1;
			const bend = reverse ? 32 : 0;
			const x = (start.x + end.x) / 2 - dy / length * bend;
			const y = (start.y + end.y) / 2 + dx / length * bend;
			e.path.setAttribute("d", `M${start.x},${start.y} Q${x},${y} ${end.x},${end.y}`);
			e.label.setAttribute("x", x);
			e.label.setAttribute("y", y - 8);
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

	show_details(selection) {
		this.clear_spotlight();
		const { warehouse, link } = selection;
		const m = this.graph_model;
		const entries = WarehouseTraceView.details_rows(m, selection);
		if (!entries.length) return;
		this.current_details = selection;
		const esc = frappe.utils.escape_html;
		const label = (id) => m.nodes.get(id).label;
		const title = warehouse ? label(warehouse) : `${label(link.from)} → ${label(link.to)}`;
		const batches = warehouse ? [...this.voucher_batches(warehouse)] : [];
		const hiddenCount = batches.filter((id) => this.is_hidden_on(warehouse, id)).length;
		const toggleableCount = batches.filter((id) => id !== this.batch_no).length;
		const actions = warehouse && toggleableCount
			? `<button class="wt-trunc">${hiddenCount ? `Show all ${hiddenCount} hidden` : "Hide all linked batches"}</button>` : "";
		const note = link?.kind === "lineage" ? "Same voucher, separate posted legs. Quantities are not a matched transfer."
			: entries.some((r) => !this.expanded.has(`B::${r.batch_no}`)) ? "Click a batch in the graph to load more of its movement history." : "";
		const rows = entries.map((row, index) => {
			const id = `B::${row.batch_no}`;
			const inward = row.type_of_transaction === "Inward";
			const hidden = warehouse && this.is_hidden_on(warehouse, id);
			const canToggle = warehouse && id !== this.batch_no;
			const qty = `${inward ? "+" : ""}${row.qty}${row.stock_uom ? ` ${row.stock_uom}` : ""}`;
			return `<div class="wt-move${hidden ? " is-hidden" : ""}" data-index="${index}">
				<span class="wt-move-dir ${inward ? "in" : "out"}">${inward ? "IN" : "OUT"}</span>
				<span class="wt-move-wh">${esc(row.warehouse)}</span>
				<span class="wt-move-qty">${esc(qty)}</span>
				<span class="wt-move-batch">${esc(row.batch_no)}</span>
				<span class="wt-move-time">${esc(row.posting_datetime)}</span>
				${canToggle ? `<button class="wt-move-toggle" type="button">${hidden ? "show" : "hide"}</button>` : ""}
				<div class="wt-transaction"><button type="button" class="wt-voucher-link">${esc(row.voucher_no)}</button>
				<span>${esc(row.voucher_type)}${row.voucher_subtype ? ` · ${esc(row.voucher_subtype)}` : ""}</span></div>
			</div>`;
		}).join("");
		this.$panel.html(`
			<div class="wt-panel-head"><div><div class="wt-panel-title">${esc(title)}</div>
			<div class="wt-panel-sub">${entries.length} movement${entries.length === 1 ? "" : "s"}${hiddenCount ? ` · ${hiddenCount} hidden batches` : ""}</div></div>
			<button class="wt-panel-close" title="Close">&times;</button></div>
			${note ? `<div class="wt-panel-note">${esc(note)}</div>` : ""}
			${actions ? `<div class="wt-panel-actions">${actions}</div>` : ""}${rows}`).prop("hidden", false);
		const entry = (el) => entries[Number(el.closest(".wt-move").dataset.index)];
		this.$panel.find(".wt-panel-close").on("click", () => this.hide_panel());
		this.$panel.find(".wt-trunc").on("click", () => {
			for (const id of batches) if (id !== this.batch_no) this.manual_visibility.set(this.hide_key(warehouse, id), !hiddenCount);
			this.refresh_visibility();
		});
		this.$panel.find(".wt-move-toggle").on("click", (e) => {
			const id = `B::${entry(e.currentTarget).batch_no}`;
			this.manual_visibility.set(this.hide_key(warehouse, id), !this.is_hidden_on(warehouse, id));
			this.refresh_visibility();
		});
		this.$panel.find(".wt-voucher-link").on("click", (e) => {
			const row = entry(e.currentTarget);
			frappe.set_route("Form", row.voucher_type, row.voucher_no);
		});
		this.$panel.find(".wt-move").on("mouseenter", (e) => {
			const row = entry(e.currentTarget);
			const batch = `B::${row.batch_no}`, wh = `W::${row.warehouse}`;
			if (this.is_hidden_on(wh, batch)) return;
			const edge = row.type_of_transaction === "Inward" ? { from: batch, to: wh } : { from: wh, to: batch };
			this.spotlight([batch, wh, ...(link ? [link.from, link.to] : [])], link ? [edge, link] : [edge]);
		}).on("mouseleave", () => this.clear_spotlight());
	}

	refresh_visibility() {
		this.auto_truncate();
		this.redraw_keep_view();
		this.show_details(this.current_details);
	}

	redraw_keep_view() {
		const c = this.canvas;
		const keep = c ? { tx: c.tx, ty: c.ty, k: c.k } : null;
		const model = this.visible_model();
		const layout = this.compute_layout(model);

		this.update_badge();
		this.$stage.find(".wt-svg").remove();
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
		vp.classList.add("wt-spotlight");
		for (const id of nodeIds) {
			const sel = `.wt-node[data-node-id="${window.CSS ? CSS.escape(id) : id}"]`;
			const el = vp.querySelector(sel);
			if (el) el.classList.add("wt-hot");
		}
		for (const e of edges) {
			const esc = (v) => (window.CSS ? CSS.escape(v) : v);
			const el = vp.querySelector(
				`.wt-edge[data-from="${esc(e.from)}"][data-to="${esc(e.to)}"]`
			);
			if (el) el.classList.add("wt-hot");
			const label = this.canvas.edgeEls.find(({ v, w }) => v === e.from && w === e.to)?.label;
			if (label) label.classList.add("wt-hot");
		}
	}

	clear_spotlight() {
		if (!this.canvas) return;
		const vp = this.canvas.viewport;
		vp.classList.remove("wt-spotlight");
		vp.querySelectorAll(".wt-hot").forEach((el) => el.classList.remove("wt-hot"));
	}

	hide_panel() {
		this.clear_spotlight();
		this.current_details = null;
		this.$panel.prop("hidden", true).empty();
	}
}
