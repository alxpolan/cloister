import Foundation

// MARK: - Loose JSON (for MCP server config payloads)

enum JSONValue: Codable, Hashable {
    case string(String)
    case number(Double)
    case bool(Bool)
    case object([String: JSONValue])
    case array([JSONValue])
    case null

    init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if c.decodeNil() { self = .null }
        else if let b = try? c.decode(Bool.self) { self = .bool(b) }
        else if let n = try? c.decode(Double.self) { self = .number(n) }
        else if let s = try? c.decode(String.self) { self = .string(s) }
        else if let a = try? c.decode([JSONValue].self) { self = .array(a) }
        else if let o = try? c.decode([String: JSONValue].self) { self = .object(o) }
        else {
            throw DecodingError.dataCorruptedError(in: c, debugDescription: "unsupported JSON value")
        }
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        switch self {
        case .string(let s): try c.encode(s)
        case .number(let n): try c.encode(n)
        case .bool(let b): try c.encode(b)
        case .object(let o): try c.encode(o)
        case .array(let a): try c.encode(a)
        case .null: try c.encodeNil()
        }
    }
}

// MARK: - API models

struct McpSummary: Codable, Hashable, Identifiable {
    let id: String
    let key: String
    let label: String
    let icon: String
    let secretsOk: Bool
    let oauth: Bool
    let authorized: Bool?
}

struct McpConfigJson: Codable, Hashable {
    let mcpServers: [String: JSONValue]?
}

struct AgentContainer: Codable, Identifiable, Hashable {
    let id: String
    let name: String
    let company: String
    let status: String
    let claudeAuthenticated: Bool
    let codexAuthenticated: Bool
    let mcps: [McpSummary]
    let mcpConfigJson: McpConfigJson?
    let hasIcon: Bool?
    let iconVersion: Double?
    let gitName: String?
    let gitEmail: String?
    let resources: ContainerResources?

    var isRunning: Bool { status == "running" }
    var customServerCount: Int { mcpConfigJson?.mcpServers?.count ?? 0 }

    enum CodingKeys: String, CodingKey {
        case id, name, company, status, claudeAuthenticated, codexAuthenticated, mcps
        case mcpConfigJson = "mcp_config_json"
        case hasIcon, iconVersion, resources
        case gitName = "git_name"
        case gitEmail = "git_email"
    }
}

struct ContainerResources: Codable, Hashable {
    let memMb: Double
    let cpus: Double
    let pidsLimit: Double
    let isDefault: Bool
}

struct SecretSpec: Codable, Hashable {
    let env: String
    let label: String
}

struct CatalogEntry: Codable, Identifiable, Hashable {
    let id: String
    let key: String
    let label: String
    let icon: String
    let website: String?
    let configJson: [String: JSONValue]
    let secretsJson: [SecretSpec]

    enum CodingKeys: String, CodingKey {
        case id, key, label, icon, website
        case configJson = "config_json"
        case secretsJson = "secrets_json"
    }
}

struct Assignment: Codable, Identifiable, Hashable {
    let id: String
    let key: String
    let bindingsJson: [String: String]

    enum CodingKeys: String, CodingKey {
        case id, key
        case bindingsJson = "bindings_json"
    }
}

struct SecretRef: Codable, Identifiable, Hashable {
    let ref: String
    let updatedAt: String?
    var id: String { ref }

    enum CodingKeys: String, CodingKey {
        case ref
        case updatedAt = "updated_at"
    }
}

struct RunSummary: Codable, Identifiable, Hashable {
    let id: String
    let company: String
    let cli: String
    let model: String?
    let status: String
    let exitCode: Int?
    let prompt: String
    let startedAt: String
    let finishedAt: String?

    enum CodingKeys: String, CodingKey {
        case id, company, cli, model, status, prompt
        case exitCode = "exit_code"
        case startedAt = "started_at"
        case finishedAt = "finished_at"
    }
}

struct RunDetail: Codable {
    let id: String
    let company: String
    let cli: String
    let model: String?
    let status: String
    let exitCode: Int?
    let prompt: String
    let stdout: String
    let stderr: String
    let error: String?

    enum CodingKeys: String, CodingKey {
        case id, company, cli, model, status, prompt, stdout, stderr, error
        case exitCode = "exit_code"
    }
}

struct AuthSessionState: Codable {
    let id: String
    let running: Bool
    let exitCode: Int?
    let output: String
}

struct StartAuthResponse: Codable {
    let sessionId: String
    let note: String
}

struct OkResponse: Codable {
    let ok: Bool
}
