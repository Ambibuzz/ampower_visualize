var global_wrapper;

frappe.pages['batch_traceability'].on_page_load = (wrapper) => {
    global_wrapper = wrapper;
    let page = frappe.ui.make_app_page({
        parent: wrapper,
        title: 'Batch Traceability',
        single_column: true
    });
    setup_fields(page, wrapper);
    append_static_html();
}

let previous_sabb_name = 'Select SABB';

const setup_fields = (page, wrapper) => {
    let sabb_field = page.add_field({
        label: 'Select Serial / Batch Bundle',
        fieldtype: 'Link',
        fieldname: 'sabb',
        options: 'Serial and Batch Bundle',
        change() {
            const sabb_name = sabb_field.get_value();
            if (sabb_name && sabb_name !== previous_sabb_name) {
                previous_sabb_name = sabb_name;
                update_visualization(wrapper, sabb_name);
            }
        }
    });
}

const update_visualization = (wrapper, sabb_name) => {
    $(wrapper).find('.top-level-parent').remove();
    append_dynamic_html(sabb_name);
}

const append_static_html = () => {
    $(global_wrapper).find('.layout-main-section').append(`
        <script src="https://d3js.org/d3.v7.min.js"/>
    `);
}

const append_dynamic_html = (sabb_name) => {
    if (!sabb_name) {
        notify("No SABB specified");
        return;
    }
    $(global_wrapper).find('.layout-main-section').append(`
        <div class="top-level-parent">
            <script>
                get_batch_data('${sabb_name}');
            </script>
        </div>
    `);
}

const get_batch_data = (sabb_name) => {
    frappe.call({
        method: 'ampower_visualize.ampower_visualize.page.batch_traceability.batch_traceability.get_serial_and_batch_bundle_links',
        args: { sabb_name: sabb_name },
        callback: function (r) {
            if (!r.message) {
                notify("Invalid data format or no items to display.", "red");
                return;
            }

            const data = r.message;
            const graph_data = { nodes: [], links: [] };
            const existing_nodes = new Set();

            const sabb_node_id = data.serial_and_batch_bundle.name;
            graph_data.nodes.push({
                id: sabb_node_id,
                label: sabb_node_id,
                type: 'sabb',
                is_parent: true
            });
            existing_nodes.add(sabb_node_id);

            data.batches.forEach(batch => {
                const batch_node_id = `${batch.batch_no}-${batch.batch_qty}`;

                if (!existing_nodes.has(batch_node_id)) {
                    graph_data.nodes.push({
                        id: batch_node_id,
                        label: `${batch.batch_no}\n(Qty: ${batch.batch_qty})`,
                        type: 'batch',
                        qty: batch.batch_qty,
                        is_parent: false
                    });
                    existing_nodes.add(batch_node_id);
                }

                graph_data.links.push({
                    source: sabb_node_id,
                    target: batch_node_id,
                    warehouse: batch.current_warehouse
                });

                batch.serial_numbers.forEach(serial => {
                    if (!existing_nodes.has(serial.unique_id)) {
                        graph_data.nodes.push({
                            id: serial.unique_id,
                            label: `${serial.serial_no}\n(${serial.item_code})`,
                            type: 'serial',
                            is_parent: false
                        });
                        existing_nodes.add(serial.unique_id);
                    }

                    graph_data.links.push({
                        source: batch_node_id,
                        target: serial.unique_id,
                        warehouse: batch.current_warehouse
                    });
                });
            });

            visualize_graph(graph_data, document.querySelector('.top-level-parent'));
        },
        freeze: true,
        freeze_message: __("Fetching batch data...")
    });
};


const visualize_graph = (graph_data, node_element) => {
    const width = 1256, height = 720;
    d3.select(node_element).select("svg").remove();

    const svg = d3.select(node_element)
        .append("svg")
        .attr("width", width)
        .attr("height", height)
        .call(
            d3.zoom()
                .scaleExtent([0.1, 3])
                .on("zoom", event => {
                    g.attr("transform", event.transform);
                })
        )
        .append("g");

    const g = svg.append("g");

    svg.append("defs").append("marker")
        .attr("id", "arrowhead")
        .attr("viewBox", "0 -5 10 10")
        .attr("refX", 20)
        .attr("refY", 0)
        .attr("markerWidth", 8)
        .attr("markerHeight", 8)
        .attr("orient", "auto")
        .append("path")
        .attr("d", "M0,-5L10,0L0,5")
        .attr("fill", "#696C71");


    const nodeColors = {
        'sabb': '#b0b336',
        'batch': '#ff59d0',
        'serial': '#3498db'
    };

    const nodeSizes = {
        'sabb': 60,
        'batch': 50,
        'serial': 36
    };

    const legendData = [
        { type: 'sabb', label: 'Serial and Batch Bundle' },
        { type: 'batch', label: 'Batch' },
        { type: 'serial', label: 'Serial Number' }
    ];

    const legendGroup = svg.append("g")
        .attr("transform", `translate(20, 10)`);

    const legendItems = legendGroup.selectAll(".legend-item")
        .data(legendData)
        .enter()
        .append("g")
        .attr("transform", (d, i) => `translate(${i * 200}, 0)`);

    legendItems.append("rect")
        .attr("width", 20)
        .attr("height", 20)
        .attr("fill", d => nodeColors[d.type]);

    legendItems.append("text")
        .attr("x", 25)
        .attr("y", 15)
        .text(d => d.label)
        .style("fill", "#555555")
        .style("font-size", "12px");

    const getLinkDistance = (link) => {
        const sourceType = link.source.type || link.source.type;
        const targetType = link.target.type || link.target.type;
        if ((sourceType === 'sabb' && targetType === 'batch') ||
            (sourceType === 'batch' && targetType === 'sabb')) {
            return 600;
        }
        return (sourceType === 'serial' || targetType === 'serial') ? 300 : 200;
    };

    const format_document_url = (base_url, type, label) => {
        if (type === "sabb") {
            return `${base_url}/app/serial-and-batch-bundle/${label}`;
        }
        if (type === "batch") {
            return `${base_url}/app/batch/${label.split('\n')[0]}`;
        }
        if (type === "serial") {
            const serial_no = label.split('\n')[0];
            return `${base_url}/app/serial-no/${serial_no}`;
        }
    }

    const forceSerialRepulsion = () => {
        return (alpha) => {
            graph_data.nodes.forEach(nodeI => {
                if (nodeI.type === 'serial') {
                    graph_data.nodes.forEach(nodeJ => {
                        if (nodeJ.type !== 'serial') {
                            const dx = nodeI.x - nodeJ.x;
                            const dy = nodeI.y - nodeJ.y;
                            const distance = Math.sqrt(dx * dx + dy * dy);
                            if (distance < 300) {
                                const force = (300 - distance) * alpha * 0.5;
                                nodeI.x += dx * force / distance;
                                nodeI.y += dy * force / distance;
                            }
                        }
                    });
                }
            });
        };
    };

    const simulation = d3.forceSimulation(graph_data.nodes)
        .force("link", d3.forceLink(graph_data.links)
            .id(d => d.id)
            .distance(link => getLinkDistance(link))
        )
        .force("charge", d3.forceManyBody()
            .strength(node => {
                if (node.type === 'serial') return -300;
                if (node.type === 'sabb') return -400;
                return -200;
            })
        )
        .force("center", d3.forceCenter(width / 2, height / 2))
        .force("serialRepulsion", forceSerialRepulsion())
        .force("collision", d3.forceCollide().radius(node => nodeSizes[node.type] * 0.75))
        .alphaDecay(0.01)
        .alphaTarget(0.3);

    const link = g.append("g")
        .selectAll("g")
        .data(graph_data.links)
        .enter()
        .append("g");

    const linkPath = link.append("path")
        .attr("stroke", "#696C71")
        .attr("stroke-width", d => {
            const sourceType = d.source.type || d.source.type;
            const targetType = d.target.type || d.target.type;
            return ((sourceType === 'sabb' && targetType === 'batch') ||
                (sourceType === 'batch' && targetType === 'sabb')) ? 2.5 : 1.5;
        })
        .attr("stroke-opacity", 0.6)
        .attr("fill", "none")
        .attr("marker-end", "url(#arrowhead)");

    const linkLabel = link.append("text")
        .attr("dy", -5)
        .attr("text-anchor", "middle")
        .style("font-size", "10px")
        .style("fill", "#555")
        .text(d => {
            const sourceType = d.source.type;
            const targetType = d.target.type;
            if ((sourceType === 'sabb' && targetType === 'batch') ||
                (sourceType === 'batch' && targetType === 'sabb')) {
                return d.warehouse || "";
            }
            return "";
        });

    const node = g.append("g")
        .selectAll("rect")
        .data(graph_data.nodes)
        .enter()
        .append("rect")
        .attr("width", d => nodeSizes[d.type])
        .attr("height", d => nodeSizes[d.type])
        .attr("fill", d => nodeColors[d.type])
        .attr("x", d => d.x - nodeSizes[d.type] / 2)
        .attr("y", d => d.y - nodeSizes[d.type] / 2)
        .call(d3.drag()
            .on("start", dragstarted)
            .on("drag", dragged)
            .on("end", dragended));

    const label = g.append("g")
        .selectAll("text")
        .data(graph_data.nodes)
        .enter()
        .append("a")
        .attr("xlink:href", d => format_document_url(window.location.origin, d.type, d.label))
        .attr("target", "_blank")
        .append("text")
        .text(d => d.label)
        .style("font-size", d => d.type === 'sabb' ? "12px" : "10px")
        .style("font-weight", d => d.type === 'sabb' ? "bold" : "normal")
        .style("fill", "#fff")
        .attr("text-anchor", "middle")
        .attr("alignment-baseline", "middle");

    simulation.on("tick", () => {
        linkPath.attr("d", d => {
            const dx = d.target.x - d.source.x;
            const dy = d.target.y - d.source.y;
            return `M${d.source.x},${d.source.y} L${d.target.x},${d.target.y}`;
        });

        linkLabel.attr("transform", d => {
            const midX = (d.source.x + d.target.x) / 2;
            const midY = (d.source.y + d.target.y) / 2;
            return `translate(${midX},${midY})`;
        });

        node
            .attr("x", d => d.x - nodeSizes[d.type] / 2)
            .attr("y", d => d.y - nodeSizes[d.type] / 2);

        label
            .attr("x", d => d.x)
            .attr("y", d => d.y);
    });


    function dragstarted(event, d) {
        if (!event.active) simulation.alphaTarget(0.3).restart();
        d.fx = d.x;
        d.fy = d.y;
    }

    function dragged(event, d) {
        d.fx = event.x;
        d.fy = event.y;
    }

    function dragended(event, d) {
        if (!event.active) simulation.alphaTarget(0);
        d.fx = null;
        d.fy = null;
    }
};

const notify = (message, indicator = "yellow", time = 3) => {
    frappe.show_alert({
        message: __(message),
        indicator: indicator
    }, time);
}