import Foundation
import Combine

struct APIError: LocalizedError {
    let message: String
    var errorDescription: String? { message }
}

private struct ErrorBody: Decodable { let error: String? }

struct APIClient: Sendable {
    static let defaultBaseURL = "http://localhost:8080"

    var baseURL: URL {
        let raw = UserDefaults.standard.string(forKey: "apiURL") ?? Self.defaultBaseURL
        return URL(string: raw) ?? URL(string: Self.defaultBaseURL)!
    }

    private func request<T: Decodable>(
        _ path: String,
        method: String = "GET",
        body: Data? = nil
    ) async throws -> T {
        var req = URLRequest(url: baseURL.appendingPathComponent(path))
        req.httpMethod = method
        req.timeoutInterval = 180
        if let body {
            req.httpBody = body
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        let (data, response) = try await URLSession.shared.data(for: req)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard (200..<300).contains(status) else {
            let message = (try? JSONDecoder().decode(ErrorBody.self, from: data))?.error
            throw APIError(message: message ?? "HTTP \(status) on \(path)")
        }
        return try JSONDecoder().decode(T.self, from: data)
    }

    private func encode(_ value: some Encodable) throws -> Data {
        try JSONEncoder().encode(value)
    }

    // MARK: containers

    func listContainers() async throws -> [AgentContainer] {
        try await request("containers")
    }

    func createContainer(name: String, company: String) async throws -> OkContainer {
        struct Payload: Encodable { let name: String, company: String }
        return try await request("containers", method: "POST", body: encode(Payload(name: name, company: company)))
    }

    struct OkContainer: Decodable { let id: String }

    func start(_ id: String) async throws {
        let _: OkResponse = try await request("containers/\(id)/start", method: "POST")
    }

    func stop(_ id: String) async throws {
        let _: OkResponse = try await request("containers/\(id)/stop", method: "POST")
    }

    func delete(_ id: String) async throws {
        let _: OkResponse = try await request("containers/\(id)", method: "DELETE")
    }

    // MARK: container icons

    func iconURL(_ containerID: String, version: Double?) -> URL {
        var url = baseURL.appendingPathComponent("containers/\(containerID)/icon")
        if let version, version > 0 {
            url.append(queryItems: [URLQueryItem(name: "v", value: String(Int(version)))])
        }
        return url
    }

    func uploadIcon(_ containerID: String, data: Data, mime: String) async throws {
        struct Payload: Encodable { let data: String, mime: String }
        let _: OkResponse = try await request(
            "containers/\(containerID)/icon", method: "PUT",
            body: encode(Payload(data: data.base64EncodedString(), mime: mime))
        )
    }

    func deleteIcon(_ containerID: String) async throws {
        let _: OkResponse = try await request("containers/\(containerID)/icon", method: "DELETE")
    }

    // MARK: catalog & assignments

    func listCatalog() async throws -> [CatalogEntry] {
        try await request("mcp-catalog")
    }

    func createCatalogEntry(
        key: String, label: String, icon: String,
        config: [String: JSONValue], secrets: [SecretSpec]
    ) async throws {
        struct Payload: Encodable {
            let key: String, label: String, icon: String
            let config: [String: JSONValue]
            let secrets: [SecretSpec]
        }
        let _: CatalogEntry = try await request(
            "mcp-catalog", method: "POST",
            body: encode(Payload(key: key, label: label, icon: icon, config: config, secrets: secrets))
        )
    }

    func deleteCatalogEntry(_ id: String) async throws {
        let _: OkResponse = try await request("mcp-catalog/\(id)", method: "DELETE")
    }

    func assignments(for containerID: String) async throws -> [Assignment] {
        try await request("containers/\(containerID)/mcps")
    }

    struct AssignmentUpdate: Encodable {
        let catalog_id: String
        let bindings: [String: String]
    }

    func updateAssignments(_ containerID: String, assignments: [AssignmentUpdate]) async throws {
        struct Payload: Encodable { let assignments: [AssignmentUpdate] }
        let _: OkResponse = try await request(
            "containers/\(containerID)/mcps", method: "PUT",
            body: encode(Payload(assignments: assignments))
        )
    }

    // MARK: secrets

    func listSecrets() async throws -> [SecretRef] {
        try await request("secrets")
    }

    func putSecret(ref: String, value: String) async throws {
        struct Payload: Encodable { let ref: String, value: String }
        let _: OkResponse = try await request("secrets", method: "PUT", body: encode(Payload(ref: ref, value: value)))
    }

    // MARK: auth sessions

    func startAuth(_ containerID: String, cli: String) async throws -> StartAuthResponse {
        try await request("containers/\(containerID)/auth/\(cli)", method: "POST")
    }

    func authSession(_ sid: String) async throws -> AuthSessionState {
        try await request("auth-sessions/\(sid)")
    }

    func sendAuthInput(_ sid: String, text: String) async throws {
        struct Payload: Encodable { let text: String }
        let _: OkResponse = try await request("auth-sessions/\(sid)/input", method: "POST", body: encode(Payload(text: text)))
    }

    func killAuthSession(_ sid: String) async throws {
        let _: OkResponse = try await request("auth-sessions/\(sid)", method: "DELETE")
    }
}

// MARK: - App state

@MainActor
final class AppModel: ObservableObject {
    let api = APIClient()

    @Published var containers: [AgentContainer] = []
    @Published var catalog: [CatalogEntry] = []
    @Published var secrets: [SecretRef] = []
    @Published var loaded = false
    @Published var errorMessage: String?
    @Published var busyContainerIDs: Set<String> = []

    func refresh() async {
        do {
            containers = try await api.listContainers()
            errorMessage = nil
        } catch {
            errorMessage = error.localizedDescription
        }
        loaded = true
    }

    /** Catalog + secret refs change rarely; loaded at startup and after edits. */
    func loadConfig() async {
        catalog = (try? await api.listCatalog()) ?? catalog
        secrets = (try? await api.listSecrets()) ?? secrets
    }

    func pollLoop() async {
        await loadConfig()
        while !Task.isCancelled {
            await refresh()
            try? await Task.sleep(for: .seconds(4))
        }
    }

    func perform(_ containerID: String, _ work: @escaping () async throws -> Void) {
        busyContainerIDs.insert(containerID)
        Task {
            do {
                try await work()
                await refresh()
            } catch {
                errorMessage = error.localizedDescription
            }
            busyContainerIDs.remove(containerID)
        }
    }
}
