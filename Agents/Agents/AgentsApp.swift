import SwiftUI

@main
struct AgentsApp: App {
    @StateObject private var model = AppModel()

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(model)
                .frame(minWidth: 940, minHeight: 600)
        }

        Settings {
            SettingsView()
                .environmentObject(model)
        }
    }
}

struct SettingsView: View {
    @EnvironmentObject private var model: AppModel
    @AppStorage("apiURL") private var apiURL = APIClient.defaultBaseURL
    @AppStorage("apiToken") private var apiToken = ""

    var body: some View {
        Form {
            Section("Backend") {
                TextField("API URL", text: $apiURL, prompt: Text(APIClient.defaultBaseURL))
                SecureField("API Token", text: $apiToken)
                Text("The token printed by ./start.sh (API_TOKEN in .env). Required unless the backend runs without auth.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Section {
                Button("Test Connection") {
                    Task { await model.refresh() }
                }
                if let err = model.errorMessage {
                    Text(err).font(.caption).foregroundStyle(.red)
                } else if model.loaded {
                    Text("Connected — \(model.containers.count) containers.")
                        .font(.caption).foregroundStyle(.green)
                }
            }
        }
        .formStyle(.grouped)
        .frame(width: 440)
        .padding()
    }
}
