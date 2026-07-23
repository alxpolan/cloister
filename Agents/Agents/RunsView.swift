import SwiftUI

struct RunStatusPill: View {
    let status: String

    private var color: Color {
        switch status {
        case "succeeded": return .green
        case "failed": return .red
        default: return .blue
        }
    }

    var body: some View {
        Text(status)
            .font(.caption2.weight(.semibold))
            .foregroundStyle(color)
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
            .background(Capsule().fill(color.opacity(0.15)))
    }
}

struct RunList: View {
    @EnvironmentObject private var model: AppModel
    @Binding var selection: String?

    var body: some View {
        List(selection: $selection) {
            ForEach(model.runs) { run in
                VStack(alignment: .leading, spacing: 3) {
                    HStack(spacing: 6) {
                        RunStatusPill(status: run.status)
                        Text(run.company).font(.caption.weight(.medium))
                        Spacer()
                        Text(run.cli + (run.model.map { " · \($0)" } ?? ""))
                            .font(.caption2.monospaced())
                            .foregroundStyle(.secondary)
                    }
                    Text(run.prompt)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(2)
                }
                .padding(.vertical, 3)
                .tag(run.id)
            }
        }
        .listStyle(.inset)
        .navigationTitle("Runs")
        .navigationSubtitle("\(model.runs.count) recent")
        .overlay {
            if model.runs.isEmpty {
                ContentUnavailableView(
                    "No Runs Yet",
                    systemImage: "scroll",
                    description: Text("Runs triggered via /run or Paperclip show up here.")
                )
            }
        }
        .task { await model.loadRuns() }
    }
}

struct RunDetailView: View {
    let runId: String
    @EnvironmentObject private var model: AppModel
    @State private var detail: RunDetail?
    @State private var poll: Task<Void, Never>?

    var body: some View {
        Group {
            if let d = detail {
                VStack(alignment: .leading, spacing: 0) {
                    HStack(spacing: 8) {
                        RunStatusPill(status: d.status)
                        Text(d.cli + (d.model.map { " · \($0)" } ?? ""))
                            .font(.caption.monospaced())
                            .foregroundStyle(.secondary)
                        if let ec = d.exitCode {
                            Text("exit \(ec)").font(.caption).foregroundStyle(.secondary)
                        }
                        Spacer()
                    }
                    .padding(12)
                    Divider()
                    ScrollView {
                        Text(outputText(d))
                            .font(.caption.monospaced())
                            .foregroundStyle(Color(white: 0.92))
                            .textSelection(.enabled)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(12)
                    }
                    .background(Color(white: 0.09))
                }
                .navigationTitle(d.company)
            } else {
                ContentUnavailableView("Select a run", systemImage: "scroll")
            }
        }
        .task(id: runId) {
            poll?.cancel()
            detail = try? await model.api.getRun(runId)
            poll = Task {
                while !Task.isCancelled, detail?.status == "running" {
                    try? await Task.sleep(for: .seconds(1.5))
                    if let d = try? await model.api.getRun(runId) { detail = d }
                }
            }
        }
        .onDisappear { poll?.cancel() }
    }

    private func outputText(_ d: RunDetail) -> String {
        var out = d.stdout.isEmpty ? (d.status == "running" ? "…working…" : "(no output)") : d.stdout
        if !d.stderr.isEmpty { out += "\n\n--- stderr ---\n" + d.stderr }
        if let e = d.error, !e.isEmpty { out += "\n\n[error] " + e }
        return out
    }
}
