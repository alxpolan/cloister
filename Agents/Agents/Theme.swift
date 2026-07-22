import SwiftUI

struct StatusDot: View {
    let on: Bool

    var body: some View {
        Circle()
            .fill(on ? Color.green : Color.secondary.opacity(0.35))
            .frame(width: 8, height: 8)
    }
}

func platformSymbol(_ icon: String) -> String {
    switch icon.lowercased() {
    case "github": return "chevron.left.forwardslash.chevron.right"
    case "instagram": return "camera.fill"
    case "linkedin": return "person.2.fill"
    default: return "globe"
    }
}

func platformColor(_ icon: String) -> Color {
    switch icon.lowercased() {
    case "github": return .indigo
    case "instagram": return .pink
    case "linkedin": return Color(red: 0.0, green: 0.47, blue: 0.71)
    default: return .teal
    }
}

struct PlatformIcon: View {
    let icon: String

    var body: some View {
        Image(systemName: platformSymbol(icon))
            .font(.caption.weight(.semibold))
            .foregroundStyle(platformColor(icon))
            .frame(width: 18)
    }
}

struct McpFavicon: View {
    let entryID: String
    let fallbackIcon: String
    var size: CGFloat = 16

    var body: some View {
        AsyncImage(url: APIClient().faviconURL(entryID)) { phase in
            if let image = phase.image {
                image
                    .resizable()
                    .aspectRatio(contentMode: .fit)
                    .clipShape(RoundedRectangle(cornerRadius: 3, style: .continuous))
            } else {
                Image(systemName: platformSymbol(fallbackIcon))
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(platformColor(fallbackIcon))
            }
        }
        .frame(width: size, height: size)
    }
}

struct IconTile: View {
    let color: Color
    let symbol: String

    var body: some View {
        RoundedRectangle(cornerRadius: 5, style: .continuous)
            .fill(color.gradient)
            .frame(width: 21, height: 21)
            .overlay {
                Image(systemName: symbol)
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(.white)
            }
    }
}

func companyColor(_ name: String) -> Color {
    let palette: [Color] = [.blue, .purple, .pink, .orange, .teal, .indigo, .green, .cyan, .mint, .red]
    let hash = name.unicodeScalars.reduce(5381) { ($0 << 5) &+ $0 &+ Int($1.value) }
    return palette[abs(hash) % palette.count]
}

struct CompanyAvatar: View {
    let name: String
    var size: CGFloat = 26

    var body: some View {
        RoundedRectangle(cornerRadius: size * 0.24, style: .continuous)
            .fill(companyColor(name).gradient)
            .frame(width: size, height: size)
            .overlay {
                Text(String(name.prefix(1)).uppercased())
                    .font(.system(size: size * 0.5, weight: .semibold, design: .rounded))
                    .foregroundStyle(.white)
            }
    }
}

struct ContainerIcon: View {
    let container: AgentContainer
    var size: CGFloat = 26

    var body: some View {
        Group {
            if container.hasIcon == true {
                AsyncImage(url: APIClient().iconURL(container.id, version: container.iconVersion)) { image in
                    image.resizable().aspectRatio(contentMode: .fill)
                } placeholder: {
                    CompanyAvatar(name: container.name, size: size)
                }
                .frame(width: size, height: size)
                .clipShape(RoundedRectangle(cornerRadius: size * 0.24, style: .continuous))
            } else {
                CompanyAvatar(name: container.name, size: size)
            }
        }
    }
}
