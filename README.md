# Ampower Visualize

Ampower Visualize is a powerful tool designed to enhance product traceability and visualize document relationships within your Frappe/ERPNext system. This application provides an interactive, zoomable, and draggable graph view of linked documents, allowing users to explore and understand complex document hierarchies with ease.

Empower your business with clear, interactive document traceability using Ampower Visualize!

## Why Ampower Visualize?

This tool is built for users who deal with orders placed on a daily basis and often face challenges in tracing the status, quantities, or items within a Sales Order. Ampower Visualize bridges this gap by offering an intuitive, visual representation of linked documents, making it easier for businesses to streamline operations and improve traceability.

It can be used for the following use-cases:

1. **Enhanced Traceability**: Quickly trace the origin and flow of products or documents, improving quality control traceability.
2. **Improved Decision Making**: Visualize relationships for better-informed decisions.
3. **Efficient Troubleshooting**: Identify dependencies and resolve issues faster.
4. **User-Friendly Interface**: Accessible for both technical and non-technical users.
5. **Generalized Use Cases**: Applicable across industries for diverse document types.

## Requirements

Before installing Ampower Visualize, ensure your environment meets the following minimum requirements:
- **Frappe**: v15.33.0 (version-15)
- **ERPNext**: v15.28.1 (version-15)
- **NodeJS**: v18.20.5 (LTS)

## How It Works

### Installation

To install Ampower Visualize in your Frappe/ERPNext instance:

1. **Clone and Install**:
```bash
bench get-app <url-to-git-repository>
bench install-app ampower_visualize
```
You can also follow [this](https://discuss.frappe.io/t/install-custom-app-from-github/23458) guide.

2. **Troubleshooting Common Installation Issues**:
If you encounter issues during installation, try running the following series of commands:
```bash
   supervisorctl restart all
   bench restart
   supervisorctl restart all
   bench setup supervisor
   supervisorctl reread
   supervisorctl update
   bench restart
```
3. **Navigate**: Access the "Product Traceability" page in your system.
4. **Select and Visualize**:
    - Select a DocType (e.g., Sales Order) from the dropdown menu.
    - Choose a specific document to begin visualization.
    - Ensure the document hierarchy exists (e.g., a Sales Invoice must be created from a Sales Order) for accurate visualization.
5. **Interactive Exploration**:
    - The graph starts with a root node as the center representing the selected document.
    - Use zoom and pan to navigate large document hierarchies.
    - The meaning of each node can be read from the legend created on top of the graph.
    - Every node represents the document where a particular item is referenced.
    - The edge of each node represents the status of the parent document where the reference is found, along with the quantity of the item.
    - The link on each node can be clicked to navigate to that particular document in Frappe.

## Screenshots
![image](https://github.com/user-attachments/assets/a57cfc80-6bba-4ad0-b365-a39ec368df01)

![image](https://github.com/user-attachments/assets/db3e5e41-9bb2-4b27-aba2-9e13edc66873)

https://github.com/user-attachments/assets/a7f163af-ff5e-4380-9b52-4bca18440465

### Key functions:
1. **`get_graph_data`**:
- Fetches linked documents from the backend using `frappe.call`.
- Constructs a JSON structure with `nodes` and `links` for D3.js.

2. **`visualize_graph`**:
- Builds the graph using D3.js:
  - **Nodes**: Represent documents (e.g., Sales Orders, Sales Invoices).
  - **Links**: Define relationships between documents.
- Adds zoom, pan, and drag functionality for intuitive navigation.
- Uses force-directed layout for dynamic positioning.

### Customizations:

Ampower Visualize uses **D3.js**, a powerful JavaScript library, to render the interactive document graph. The library consumes JSON data from the backend and creates a graphical representation of the basis of this input.

- Node colors and sizes vary by document type.
- A legend helps users identify node types and their significance.
- Links include labels indicating document status and quantities for respective items.

## Future Scope

Ampower Visualize has a range of planned enhancements to further improve its functionality and user experience:

1. **Enhanced Node Display**: Refine the UI to encapsulate document names and relevant fields within each node, providing clearer information at a glance.
2. **Customizable Node Fields**: Introduce the ability to configure which document fields are displayed in each node, tailoring the visualization to specific needs.
3. **Document Status Indicators**: Add support for showing the status of each document (e.g., Submitted, Draft, Balance Quantity) directly on the graph.
4. **Draft Inclusion**: Enable the visualization to include draft documents when applicable.
5. **Manufacturing Workflow Visualization**: Extend support for manufacturing processes, covering workflows such as **Sales Order → Production Plan → Work Order → Job Card**.
6. **Configurable Document Chains**: Implement a feature allowing users to define and customize the chain of documents to trace, offering comprehensive flexibility for unique business workflows.

## Contributing

We welcome contributions! Check out the GitHub repository for guidelines on how to contribute.

## Support

Encountered an issue? File a ticket on the GitHub repository.

## License

MIT
