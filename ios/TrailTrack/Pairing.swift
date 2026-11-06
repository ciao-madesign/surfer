import Foundation
import Security

/// Codice di collegamento generato dal portale: base64url di {"u": server, "t": token dispositivo, "n": nome}.
struct Pairing: Codable, Equatable {
    var server: URL
    var token: String
    var name: String

    private struct Wire: Decodable { let u: String; let t: String; let n: String }

    static func parse(_ code: String) -> Pairing? {
        var s = code.trimmingCharacters(in: .whitespacesAndNewlines)
            .replacingOccurrences(of: "-", with: "+")
            .replacingOccurrences(of: "_", with: "/")
        while s.count % 4 != 0 { s += "=" }
        guard let data = Data(base64Encoded: s),
              let w = try? JSONDecoder().decode(Wire.self, from: data),
              let url = URL(string: w.u),
              url.scheme == "https" || url.scheme == "http",   // http solo per prove in rete locale
              w.t.count >= 20 else { return nil }
        return Pairing(server: url, token: w.t, name: w.n)
    }
}

/// Il token del dispositivo è una credenziale: va nel Keychain, non in UserDefaults.
enum Keychain {
    private static let service = "it.trailtrack.pairing"

    static func save(_ p: Pairing) {
        guard let data = try? JSONEncoder().encode(p) else { return }
        delete()
        let q: [String: Any] = [kSecClass as String: kSecClassGenericPassword,
                                kSecAttrService as String: service,
                                kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
                                kSecValueData as String: data]
        SecItemAdd(q as CFDictionary, nil)
    }

    static func load() -> Pairing? {
        let q: [String: Any] = [kSecClass as String: kSecClassGenericPassword,
                                kSecAttrService as String: service,
                                kSecReturnData as String: true,
                                kSecMatchLimit as String: kSecMatchLimitOne]
        var out: AnyObject?
        guard SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess, let d = out as? Data else { return nil }
        return try? JSONDecoder().decode(Pairing.self, from: d)
    }

    static func delete() {
        let q: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service]
        SecItemDelete(q as CFDictionary)
    }
}
