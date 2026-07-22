import SwiftUI

enum SidebarItem: Hashable {
    case containers
    case catalog
    case secrets
}

enum ActiveSheet: Identifiable {
    case newContainer
    case newCatalogEntry
    case newSecret
    case auth(AgentContainer, String)

    var id: String {
        switch self {
        case .newContainer: return "new-container"
        case .newCatalogEntry: return "new-catalog"
        case .newSecret: return "new-secret"
        case .auth(let c, let cli): return "auth-\(c.id)-\(cli)"
        }
    }
}

struct ContentView: View {
    @EnvironmentObject private var model: AppModel
    @State private var sidebar: SidebarItem? = .containers
    @State private var selectedContainerID: String?
    @State private var selectedCatalogID: String?
    @State private var selectedSecretRef: String?
    @State private var sheet: ActiveSheet?

    var body: some View {
        NavigationSplitView {
            List(selection: $sidebar) {
                Section("Agents") {
                    Label {
                        Text("Containers")
                    } icon: {
                        IconTile(color: .blue, symbol: "shippingbox.fill")
                    }
                    .tag(SidebarItem.containers)
                }
                Section("Configuration") {
                    Label {
                        Text("MCP Catalog")
                    } icon: {
                        IconTile(color: .orange, symbol: "square.grid.2x2.fill")
                    }
                    .tag(SidebarItem.catalog)
                    Label {
                        Text("Secrets")
                    } icon: {
                        IconTile(color: .yellow, symbol: "key.fill")
                    }
                    .tag(SidebarItem.secrets)
                }
            }
            .navigationSplitViewColumnWidth(min: 170, ideal: 195)
        } content: {
            Group {
                switch sidebar ?? .containers {
                case .containers:
                    ContainerList(selection: $selectedContainerID) {
                        sheet = .newContainer
                    }
                case .catalog:
                    CatalogList(selection: $selectedCatalogID) {
                        sheet = .newCatalogEntry
                    }
                case .secrets:
                    SecretList(selection: $selectedSecretRef) {
                        sheet = .newSecret
                    }
                }
            }
            .navigationSplitViewColumnWidth(min: 250, ideal: 280)
        } detail: {
            switch sidebar ?? .containers {
            case .containers:
                if let c = model.containers.first(where: { $0.id == selectedContainerID }) {
                    ContainerDetail(container: c) { cli in
                        sheet = .auth(c, cli)
                    }
                } else {
                    placeholder("Select a container")
                }
            case .catalog:
                if let entry = model.catalog.first(where: { $0.id == selectedCatalogID }) {
                    CatalogDetail(entry: entry)
                } else {
                    placeholder("Select a catalog entry")
                }
            case .secrets:
                if let secret = model.secrets.first(where: { $0.ref == selectedSecretRef }) {
                    SecretDetail(secret: secret)
                } else {
                    placeholder("Select a secret")
                }
            }
        }
        .task { await model.pollLoop() }
        .sheet(item: $sheet) { active in
            switch active {
            case .newContainer: NewContainerSheet()
            case .newCatalogEntry: NewCatalogEntrySheet()
            case .newSecret: NewSecretSheet()
            case .auth(let c, let cli): AuthSheet(container: c, cli: cli)
            }
        }
    }

    private func placeholder(_ text: String) -> some View {
        ContentUnavailableView {
            Label(text, systemImage: "sidebar.left")
        }
    }
}

// MARK: - Container list (middle column)

struct ContainerList: View {
    @EnvironmentObject private var model: AppModel
    @Binding var selection: String?
    let onNew: () -> Void
    @State private var containerToDelete: AgentContainer?

    var body: some View {
        List(selection: $selection) {
            ForEach(model.containers) { container in
                ContainerRow(
                    container: container,
                    busy: model.busyContainerIDs.contains(container.id),
                    onStart: { model.perform(container.id) { try await model.api.start(container.id) } },
                    onStop: { model.perform(container.id) { try await model.api.stop(container.id) } },
                    onDelete: { containerToDelete = container }
                )
                .tag(container.id)
            }
        }
        .listStyle(.inset)
        .navigationTitle("Containers")
        .navigationSubtitle("\(model.containers.filter(\.isRunning).count) running")
        .toolbar {
            ToolbarItem {
                Button(action: onNew) {
                    Label("New Container", systemImage: "plus")
                }
            }
        }
        .overlay {
            if model.loaded && model.containers.isEmpty {
                ContentUnavailableView(
                    "No Containers",
                    systemImage: "shippingbox",
                    description: Text("Create one per company to get isolated Claude Code / Codex environments.")
                )
            }
        }
        .confirmationDialog(
            "Remove “\(containerToDelete?.name ?? "")”?",
            isPresented: Binding(get: { containerToDelete != nil }, set: { if !$0 { containerToDelete = nil } })
        ) {
            Button("Remove Container", role: .destructive) {
                if let c = containerToDelete {
                    model.perform(c.id) { try await model.api.delete(c.id) }
                }
                containerToDelete = nil
            }
        } message: {
            Text("The home directory with all auth state stays on disk.")
        }
    }
}

private struct ContainerRow: View {
    let container: AgentContainer
    let busy: Bool
    let onStart: () -> Void
    let onStop: () -> Void
    let onDelete: () -> Void

    var body: some View {
        HStack(spacing: 9) {
            ContainerIcon(container: container)
                .overlay(alignment: .bottomTrailing) {
                    Circle()
                        .fill(container.isRunning ? Color.green : Color.secondary.opacity(0.4))
                        .frame(width: 8, height: 8)
                        .overlay(Circle().stroke(Color(nsColor: .windowBackgroundColor), lineWidth: 1.5))
                        .offset(x: 2, y: 2)
                }
            VStack(alignment: .leading, spacing: 1) {
                Text(container.name)
                    .font(.body)
                Text("agent-\(container.company)")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
            Spacer()
            if busy {
                ProgressView().controlSize(.mini)
            } else {
                Button {
                    container.isRunning ? onStop() : onStart()
                } label: {
                    Image(systemName: container.isRunning ? "square.fill" : "play.fill")
                }
                .buttonStyle(.borderless)
                .controlSize(.small)
                .help(container.isRunning ? "Stop" : "Start")
                Button(action: onDelete) {
                    Image(systemName: "trash")
                }
                .buttonStyle(.borderless)
                .controlSize(.small)
                .help("Remove")
            }
        }
        .padding(.vertical, 3)
    }
}

// MARK: - Catalog list

struct CatalogList: View {
    @EnvironmentObject private var model: AppModel
    @Binding var selection: String?
    let onNew: () -> Void

    var body: some View {
        List(selection: $selection) {
            ForEach(model.catalog) { entry in
                HStack(spacing: 8) {
                    McpFavicon(entryID: entry.id, fallbackIcon: entry.icon)
                    VStack(alignment: .leading, spacing: 1) {
                        Text(entry.label)
                        Text(entry.key)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    Spacer()
                    if !entry.secretsJson.isEmpty {
                        Image(systemName: "key")
                            .font(.caption2)
                            .foregroundStyle(.tertiary)
                            .help("Requires a token")
                    }
                }
                .padding(.vertical, 3)
                .tag(entry.id)
            }
        }
        .listStyle(.inset)
        .navigationTitle("MCP Catalog")
        .navigationSubtitle("\(model.catalog.count) servers")
        .toolbar {
            ToolbarItem {
                Button(action: onNew) {
                    Label("Add Server", systemImage: "plus")
                }
            }
        }
        .task { await model.loadConfig() }
    }
}

// MARK: - Secret list

struct SecretList: View {
    @EnvironmentObject private var model: AppModel
    @Binding var selection: String?
    let onNew: () -> Void

    var body: some View {
        List(selection: $selection) {
            ForEach(model.secrets) { secret in
                HStack(spacing: 8) {
                    Image(systemName: "key.fill")
                        .font(.caption)
                        .foregroundStyle(.yellow)
                        .frame(width: 18)
                    Text(secret.ref)
                        .font(.body.monospaced())
                    Spacer()
                }
                .padding(.vertical, 3)
                .tag(secret.ref)
            }
        }
        .listStyle(.inset)
        .navigationTitle("Secrets")
        .navigationSubtitle("\(model.secrets.count) stored")
        .toolbar {
            ToolbarItem {
                Button(action: onNew) {
                    Label("Add Secret", systemImage: "plus")
                }
            }
        }
        .task { await model.loadConfig() }
    }
}

#Preview {
    ContentView().environmentObject(AppModel())
}
