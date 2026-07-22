import SwiftUI
import UniformTypeIdentifiers

// MARK: - Container detail (right pane): Info / MCPs tabs

struct ContainerDetail: View {
    let container: AgentContainer
    let onLogin: (String) -> Void

    enum Tab: String, CaseIterable {
        case info = "Info"
        case mcps = "MCPs"
    }

    @EnvironmentObject private var model: AppModel
    @State private var tab: Tab = .info

    var body: some View {
        Group {
            switch tab {
            case .info:
                ContainerInfoForm(container: container, onLogin: onLogin)
            case .mcps:
                McpAssignmentEditor(container: container)
                    .id(container.id)
            }
        }
        .toolbar {
            ToolbarItem(placement: .principal) {
                Picker("View", selection: $tab) {
                    ForEach(Tab.allCases, id: \.self) { t in
                        Text(t.rawValue).tag(t)
                    }
                }
                .pickerStyle(.segmented)
                .labelsHidden()
            }
            ToolbarItem {
                if model.busyContainerIDs.contains(container.id) {
                    ProgressView().controlSize(.small)
                } else if container.isRunning {
                    Button {
                        model.perform(container.id) { try await model.api.stop(container.id) }
                    } label: {
                        Label("Stop", systemImage: "square.fill")
                    }
                    .help("Stop container")
                } else {
                    Button {
                        model.perform(container.id) { try await model.api.start(container.id) }
                    } label: {
                        Label("Start", systemImage: "play.fill")
                    }
                    .help("Start container")
                }
            }
        }
        .navigationTitle(container.name)
    }
}

// MARK: - Info tab

private struct ContainerInfoForm: View {
    let container: AgentContainer
    let onLogin: (String) -> Void
    @EnvironmentObject private var model: AppModel
    @State private var showIconPicker = false
    @State private var iconError = ""

    var body: some View {
        Form {
            Section {
                LabeledContent("Name") {
                    HStack(spacing: 8) {
                        ContainerIcon(container: container, size: 20)
                        Text(container.name)
                    }
                }
                LabeledContent("Company", value: container.company)
                LabeledContent("Container", value: "agent-\(container.company)")
                LabeledContent("Status") {
                    Text(container.isRunning ? "Running" : "Stopped")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(container.isRunning ? Color.green : Color.secondary)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 2)
                        .background(
                            Capsule().fill(
                                (container.isRunning ? Color.green : Color.secondary).opacity(0.15)
                            )
                        )
                }
            }

            Section("Icon") {
                LabeledContent("Custom Icon") {
                    HStack(spacing: 10) {
                        ContainerIcon(container: container, size: 32)
                        Button("Choose…") { showIconPicker = true }
                            .controlSize(.small)
                        if container.hasIcon == true {
                            Button("Remove") {
                                Task {
                                    try? await model.api.deleteIcon(container.id)
                                    await model.refresh()
                                }
                            }
                            .controlSize(.small)
                        }
                    }
                }
                if !iconError.isEmpty {
                    Text(iconError).font(.caption).foregroundStyle(.red)
                }
            }

            Section("Command Line Tools") {
                cliRow(name: "Claude Code", cli: "claude", ok: container.claudeAuthenticated)
                cliRow(name: "Codex", cli: "codex", ok: container.codexAuthenticated)
            }

            Section("MCP Servers") {
                if container.mcps.isEmpty && container.customServerCount == 0 {
                    Text("None assigned — use the MCPs tab.")
                        .foregroundStyle(.secondary)
                }
                ForEach(container.mcps) { mcp in
                    LabeledContent {
                        if mcp.secretsOk {
                            Image(systemName: "checkmark.circle.fill")
                                .foregroundStyle(.green)
                        } else {
                            Text("token missing")
                                .foregroundStyle(.red)
                        }
                    } label: {
                        HStack(spacing: 8) {
                            PlatformIcon(icon: mcp.icon)
                            Text(mcp.label)
                        }
                    }
                }
                if container.customServerCount > 0 {
                    Text("+ \(container.customServerCount) custom (raw JSON, managed via web/API)")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
        }
        .formStyle(.grouped)
        .fileImporter(
            isPresented: $showIconPicker,
            allowedContentTypes: [.image]
        ) { result in
            switch result {
            case .success(let url):
                uploadIcon(from: url)
            case .failure(let err):
                iconError = err.localizedDescription
            }
        }
    }

    private func uploadIcon(from url: URL) {
        let scoped = url.startAccessingSecurityScopedResource()
        defer { if scoped { url.stopAccessingSecurityScopedResource() } }
        guard let png = resizedPNG(from: url, maxDimension: 256) else {
            iconError = "Could not read that image."
            return
        }
        Task {
            do {
                try await model.api.uploadIcon(container.id, data: png, mime: "image/png")
                await model.refresh()
                iconError = ""
            } catch {
                iconError = error.localizedDescription
            }
        }
    }

    private func resizedPNG(from url: URL, maxDimension: CGFloat) -> Data? {
        guard let image = NSImage(contentsOf: url), image.size.width > 0, image.size.height > 0 else {
            return nil
        }
        let ratio = min(1, maxDimension / max(image.size.width, image.size.height))
        let target = NSSize(width: max(1, image.size.width * ratio), height: max(1, image.size.height * ratio))
        guard let rep = NSBitmapImageRep(
            bitmapDataPlanes: nil,
            pixelsWide: Int(target.width),
            pixelsHigh: Int(target.height),
            bitsPerSample: 8,
            samplesPerPixel: 4,
            hasAlpha: true,
            isPlanar: false,
            colorSpaceName: .deviceRGB,
            bytesPerRow: 0,
            bitsPerPixel: 0
        ) else { return nil }
        rep.size = target
        NSGraphicsContext.saveGraphicsState()
        NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
        image.draw(in: NSRect(origin: .zero, size: target), from: .zero, operation: .copy, fraction: 1)
        NSGraphicsContext.restoreGraphicsState()
        return rep.representation(using: .png, properties: [:])
    }

    private func cliRow(name: String, cli: String, ok: Bool) -> some View {
        LabeledContent {
            HStack(spacing: 10) {
                Text(ok ? "Authenticated" : "Not authenticated")
                    .foregroundStyle(ok ? Color.primary : Color.secondary)
                if container.isRunning {
                    Button(ok ? "Re-login…" : "Login…") {
                        onLogin(cli)
                    }
                    .controlSize(.small)
                }
            }
        } label: {
            HStack(spacing: 6) {
                Image(systemName: ok ? "checkmark.seal.fill" : "xmark.seal")
                    .foregroundStyle(ok ? .green : .secondary)
                Text(name)
            }
        }
    }
}

// MARK: - MCPs tab (inline assignment editor)

struct McpAssignmentEditor: View {
    let container: AgentContainer

    struct Draft {
        var enabled = false
        var bindings: [String: String] = [:]
        var newTokens: [String: String] = [:]
    }

    @EnvironmentObject private var model: AppModel
    @State private var drafts: [String: Draft] = [:]
    @State private var loaded = false
    @State private var saving = false
    @State private var saved = false
    @State private var error = ""

    var body: some View {
        Form {
            if !loaded {
                ProgressView()
            } else {
                ForEach(model.catalog) { entry in
                    Section {
                        entryRows(entry)
                    }
                }
                if model.catalog.isEmpty {
                    Text("Catalog is empty — add servers under MCP Catalog in the sidebar.")
                        .foregroundStyle(.secondary)
                }
            }

            Section {
                HStack {
                    Text(saved ? "Saved — applies on next start." : "Changes apply on the next container start.")
                        .font(.caption)
                        .foregroundStyle(saved ? .green : .secondary)
                    Spacer()
                    Button(saving ? "Saving…" : "Save") { save() }
                        .buttonStyle(.borderedProminent)
                        .disabled(saving || !loaded)
                }
                if !error.isEmpty {
                    Text(error).font(.caption).foregroundStyle(.red)
                }
            }
        }
        .formStyle(.grouped)
        .task(id: container.id) { await load() }
    }

    @ViewBuilder
    private func entryRows(_ entry: CatalogEntry) -> some View {
        let enabled = drafts[entry.id]?.enabled ?? false
        Toggle(isOn: Binding(
            get: { drafts[entry.id]?.enabled ?? false },
            set: { drafts[entry.id, default: Draft()].enabled = $0; saved = false }
        )) {
            HStack(spacing: 8) {
                PlatformIcon(icon: entry.icon)
                Text(entry.label)
                Text(entry.key)
                    .font(.caption.monospaced())
                    .foregroundStyle(.secondary)
                if entry.secretsJson.isEmpty {
                    Spacer()
                    Text("OAuth / no token")
                        .font(.caption)
                        .foregroundStyle(.tertiary)
                }
            }
        }
        .toggleStyle(.switch)
        .controlSize(.small)

        if enabled {
            ForEach(entry.secretsJson, id: \.env) { spec in
                LabeledContent(spec.label) {
                    HStack(spacing: 8) {
                        Picker("", selection: Binding(
                            get: { drafts[entry.id]?.bindings[spec.env] ?? "" },
                            set: { drafts[entry.id, default: Draft()].bindings[spec.env] = $0; saved = false }
                        )) {
                            Text("— choose secret —").tag("")
                            ForEach(model.secrets) { s in
                                Text(s.ref).tag(s.ref)
                            }
                        }
                        .labelsHidden()
                        .frame(maxWidth: 240)
                        SecureField("or paste new token", text: Binding(
                            get: { drafts[entry.id]?.newTokens[spec.env] ?? "" },
                            set: { drafts[entry.id, default: Draft()].newTokens[spec.env] = $0; saved = false }
                        ))
                        .textFieldStyle(.roundedBorder)
                        .frame(maxWidth: 220)
                    }
                }
            }
        }
    }

    private func load() async {
        loaded = false
        await model.loadConfig()
        do {
            let assigned = try await model.api.assignments(for: container.id)
            var d: [String: Draft] = [:]
            for entry in model.catalog {
                let a = assigned.first { $0.id == entry.id }
                d[entry.id] = Draft(enabled: a != nil, bindings: a?.bindingsJson ?? [:], newTokens: [:])
            }
            drafts = d
        } catch {
            self.error = error.localizedDescription
        }
        loaded = true
    }

    private func save() {
        saving = true
        saved = false
        Task {
            do {
                var updates: [APIClient.AssignmentUpdate] = []
                for entry in model.catalog {
                    guard let draft = drafts[entry.id], draft.enabled else { continue }
                    var bindings = draft.bindings.filter { !$0.value.isEmpty }
                    for (env, token) in draft.newTokens {
                        let trimmed = token.trimmingCharacters(in: .whitespaces)
                        guard !trimmed.isEmpty else { continue }
                        let multi = entry.secretsJson.count > 1
                        let ref = multi
                            ? "\(container.company)-\(entry.key)-\(env.lowercased())"
                            : "\(container.company)-\(entry.key)"
                        try await model.api.putSecret(ref: ref, value: trimmed)
                        bindings[env] = ref
                    }
                    updates.append(.init(catalog_id: entry.id, bindings: bindings))
                }
                try await model.api.updateAssignments(container.id, assignments: updates)
                await model.loadConfig()
                await model.refresh()
                await load()
                saved = true
                error = ""
            } catch {
                self.error = error.localizedDescription
            }
            saving = false
        }
    }
}

// MARK: - Catalog detail

struct CatalogDetail: View {
    let entry: CatalogEntry
    @EnvironmentObject private var model: AppModel
    @State private var error = ""

    private var configPretty: String {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        guard let data = try? encoder.encode(entry.configJson) else { return "{}" }
        return String(data: data, encoding: .utf8) ?? "{}"
    }

    var body: some View {
        Form {
            Section {
                LabeledContent("Label", value: entry.label)
                LabeledContent("Key", value: entry.key)
                LabeledContent("Icon", value: entry.icon)
            }
            Section("Required Secrets") {
                if entry.secretsJson.isEmpty {
                    Text("None — OAuth or public server.")
                        .foregroundStyle(.secondary)
                }
                ForEach(entry.secretsJson, id: \.env) { spec in
                    LabeledContent(spec.label, value: spec.env)
                        .font(.body)
                }
            }
            Section("Server Config") {
                Text(configPretty)
                    .font(.caption.monospaced())
                    .textSelection(.enabled)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            Section {
                Button("Delete from Catalog", role: .destructive) {
                    Task {
                        do {
                            try await model.api.deleteCatalogEntry(entry.id)
                            await model.loadConfig()
                        } catch { self.error = error.localizedDescription }
                    }
                }
                if !error.isEmpty {
                    Text(error).font(.caption).foregroundStyle(.red)
                }
            }
        }
        .formStyle(.grouped)
        .navigationTitle(entry.label)
    }
}

// MARK: - Secret detail

struct SecretDetail: View {
    let secret: SecretRef
    @EnvironmentObject private var model: AppModel
    @State private var newValue = ""
    @State private var message = ""
    @State private var error = ""

    var body: some View {
        Form {
            Section {
                LabeledContent("Reference", value: secret.ref)
                if let updated = secret.updatedAt {
                    LabeledContent("Updated", value: updated)
                }
                LabeledContent("Value", value: "encrypted (libsodium)")
            }
            Section("Replace Value") {
                SecureField("New token / API key", text: $newValue)
                    .textFieldStyle(.roundedBorder)
                HStack {
                    if !message.isEmpty {
                        Text(message).font(.caption).foregroundStyle(.green)
                    }
                    if !error.isEmpty {
                        Text(error).font(.caption).foregroundStyle(.red)
                    }
                    Spacer()
                    Button("Save") {
                        Task {
                            do {
                                try await model.api.putSecret(ref: secret.ref, value: newValue)
                                newValue = ""
                                message = "Updated — containers pick it up on next start."
                                error = ""
                            } catch {
                                self.error = error.localizedDescription
                                message = ""
                            }
                        }
                    }
                    .disabled(newValue.isEmpty)
                }
            }
        }
        .formStyle(.grouped)
        .navigationTitle(secret.ref)
    }
}
