import SwiftUI

// MARK: - New container

struct NewContainerSheet: View {
    @EnvironmentObject private var model: AppModel
    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    @State private var company = ""
    @State private var error = ""

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Form {
                Section("New Container") {
                    TextField("Display Name", text: $name, prompt: Text("Marteso"))
                    TextField("Company Slug", text: $company, prompt: Text("marteso"))
                        .onChange(of: company) { _, v in company = v.lowercased() }
                    Text("Lowercase letters, digits, hyphens — becomes ./homes/<slug> and container agent-<slug>.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    if !error.isEmpty {
                        Text(error).font(.caption).foregroundStyle(.red)
                    }
                }
            }
            .formStyle(.grouped)
            Divider()
            HStack {
                Spacer()
                Button("Cancel") { dismiss() }
                    .keyboardShortcut(.cancelAction)
                Button("Create") {
                    Task {
                        do {
                            _ = try await model.api.createContainer(name: name, company: company)
                            await model.refresh()
                            dismiss()
                        } catch { self.error = error.localizedDescription }
                    }
                }
                .buttonStyle(.borderedProminent)
                .keyboardShortcut(.defaultAction)
                .disabled(name.isEmpty || company.isEmpty)
            }
            .padding(14)
        }
        .frame(width: 420, height: 260)
    }
}

// MARK: - New secret

struct NewSecretSheet: View {
    @EnvironmentObject private var model: AppModel
    @Environment(\.dismiss) private var dismiss
    @State private var ref = ""
    @State private var value = ""
    @State private var error = ""

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Form {
                Section("New Secret") {
                    TextField("Reference", text: $ref, prompt: Text("marteso-github"))
                    SecureField("Token / API Key", text: $value)
                    Text("Encrypted with libsodium before it reaches the database; decrypted only into a container's environment at start.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    if !error.isEmpty {
                        Text(error).font(.caption).foregroundStyle(.red)
                    }
                }
            }
            .formStyle(.grouped)
            Divider()
            HStack {
                Spacer()
                Button("Cancel") { dismiss() }
                    .keyboardShortcut(.cancelAction)
                Button("Save") {
                    Task {
                        do {
                            try await model.api.putSecret(ref: ref, value: value)
                            await model.loadConfig()
                            dismiss()
                        } catch { self.error = error.localizedDescription }
                    }
                }
                .buttonStyle(.borderedProminent)
                .keyboardShortcut(.defaultAction)
                .disabled(ref.isEmpty || value.isEmpty)
            }
            .padding(14)
        }
        .frame(width: 420, height: 260)
    }
}

// MARK: - New catalog entry

struct NewCatalogEntrySheet: View {
    @EnvironmentObject private var model: AppModel
    @Environment(\.dismiss) private var dismiss
    @State private var key = ""
    @State private var label = ""
    @State private var icon = "globe"
    @State private var configText = ""
    @State private var secretsText = ""
    @State private var error = ""

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Form {
                Section("New Catalog Server") {
                    TextField("Key", text: $key, prompt: Text("linkedin"))
                        .onChange(of: key) { _, v in key = v.lowercased() }
                    TextField("Label", text: $label, prompt: Text("LinkedIn"))
                    Picker("Icon", selection: $icon) {
                        ForEach(["globe", "github", "instagram", "linkedin"], id: \.self) {
                            Text($0).tag($0)
                        }
                    }
                }
                Section("Server Config (Claude-style JSON)") {
                    TextEditor(text: $configText)
                        .font(.caption.monospaced())
                        .frame(minHeight: 80)
                }
                Section("Required Secrets — one per line: ENV_VAR = Label") {
                    TextEditor(text: $secretsText)
                        .font(.caption.monospaced())
                        .frame(minHeight: 44)
                }
                if !error.isEmpty {
                    Text(error).font(.caption).foregroundStyle(.red)
                }
            }
            .formStyle(.grouped)
            Divider()
            HStack {
                Spacer()
                Button("Cancel") { dismiss() }
                    .keyboardShortcut(.cancelAction)
                Button("Add") { add() }
                    .buttonStyle(.borderedProminent)
                    .keyboardShortcut(.defaultAction)
                    .disabled(key.isEmpty || label.isEmpty || configText.isEmpty)
            }
            .padding(14)
        }
        .frame(width: 520, height: 480)
    }

    private func add() {
        guard let data = configText.data(using: .utf8),
              let cfg = try? JSONDecoder().decode([String: JSONValue].self, from: data)
        else {
            error = "Config is not a valid JSON object"
            return
        }
        let secrets: [SecretSpec] = secretsText
            .split(separator: "\n")
            .map { String($0).trimmingCharacters(in: .whitespaces) }
            .filter { !$0.isEmpty }
            .map { line in
                let parts = line.split(separator: "=", maxSplits: 1)
                let env = parts[0].trimmingCharacters(in: .whitespaces)
                let label = parts.count > 1 ? parts[1].trimmingCharacters(in: .whitespaces) : env
                return SecretSpec(env: env, label: label)
            }
        Task {
            do {
                try await model.api.createCatalogEntry(key: key, label: label, icon: icon, config: cfg, secrets: secrets)
                await model.loadConfig()
                dismiss()
            } catch { self.error = error.localizedDescription }
        }
    }
}

// MARK: - CLI auth (interactive terminal)

struct AuthSheet: View {
    let container: AgentContainer
    let cli: String
    @EnvironmentObject private var model: AppModel
    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL

    @State private var sessionID: String?
    @State private var note = ""
    @State private var state: AuthSessionState?
    @State private var input = ""
    @State private var error = ""

    private var authURL: URL? {
        guard let output = state?.output else { return nil }
        let pattern = #"https://[^\s"'<>\)\]]+"#
        guard let regex = try? NSRegularExpression(pattern: pattern) else { return nil }
        let range = NSRange(output.startIndex..., in: output)
        let matches = regex.matches(in: output, range: range)
            .compactMap { Range($0.range, in: output).map { String(output[$0]) } }
        let candidate = matches.first {
            $0.contains("oauth") || $0.contains("auth") || $0.contains("login")
        } ?? matches.first
        return candidate.flatMap(URL.init(string:))
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("\(cli == "claude" ? "Claude Code" : "Codex") Login — \(container.name)")
                    .font(.headline)
                Spacer()
            }
            if !note.isEmpty {
                Text(note).font(.caption).foregroundStyle(.secondary)
            }
            ScrollViewReader { proxy in
                ScrollView {
                    Text(state?.output.isEmpty == false ? state!.output : "starting…")
                        .font(.caption.monospaced())
                        .foregroundStyle(Color(white: 0.92))
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(12)
                        .id("tail")
                }
                .frame(height: 280)
                .background(Color(white: 0.09))
                .clipShape(RoundedRectangle(cornerRadius: 8))
                .onChange(of: state?.output) { _, _ in
                    proxy.scrollTo("tail", anchor: .bottom)
                }
            }
            if let url = authURL {
                Button {
                    openURL(url)
                } label: {
                    Label("Open Authorization URL", systemImage: "arrow.up.forward.app")
                }
                .buttonStyle(.borderedProminent)
            }
            if let s = state, !s.running {
                Text("Session ended (exit code \(s.exitCode.map(String.init) ?? "?")). Close this dialog — the auth status refreshes automatically.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            HStack(spacing: 8) {
                TextField("Paste code / answer here, ⏎ to send", text: $input)
                    .textFieldStyle(.roundedBorder)
                    .onSubmit { send() }
                    .disabled(state?.running != true)
                Button("Send") { send() }
                    .disabled(state?.running != true || input.isEmpty)
            }
            if !error.isEmpty {
                Text(error).font(.caption).foregroundStyle(.red)
            }
            HStack {
                Spacer()
                Button("Close") { close() }
                    .keyboardShortcut(.cancelAction)
            }
        }
        .padding(20)
        .frame(width: 640)
        .task { await run() }
    }

    private func run() async {
        do {
            let started = try await model.api.startAuth(container.id, cli: cli)
            sessionID = started.sessionId
            note = started.note
            while !Task.isCancelled {
                guard let sid = sessionID else { break }
                let s = try await model.api.authSession(sid)
                state = s
                if !s.running { break }
                try? await Task.sleep(for: .seconds(1))
            }
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func send() {
        guard let sid = sessionID, !input.isEmpty else { return }
        let text = input
        input = ""
        Task {
            do { try await model.api.sendAuthInput(sid, text: text) }
            catch { self.error = error.localizedDescription }
        }
    }

    private func close() {
        if let sid = sessionID {
            Task { try? await model.api.killAuthSession(sid) }
        }
        Task { await model.refresh() }
        dismiss()
    }
}
