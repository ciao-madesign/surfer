import Foundation
import Network

struct TrackPoint: Codable {
    let t: Int64          // millisecondi dal 1/1/1970
    let lat: Double
    let lon: Double
    let ele: Double?
    let acc: Double?
}

enum UploadResult { case ok, retry, unauthorized, raceEnded }

/// Coda su disco + invio a blocchi. Senza rete i punti restano nella coda e partono al ritorno del segnale.
@MainActor
final class Uploader: ObservableObject {
    @Published private(set) var pending = 0
    @Published private(set) var lastSuccess: Date?
    @Published private(set) var lastError: String?
    @Published private(set) var online = true

    var pairing: Pairing?
    var active = false             // true solo mentre la condivisione è attiva
    var onFatal: ((UploadResult) -> Void)?

    private var queue: [TrackPoint] = []
    private var sending = false
    private let monitor = NWPathMonitor()
    private let maxQueue = 5000        // ~20 ore a 15 s: oltre, si scartano i punti più vecchi
    private let chunk = 100            // il server accetta al massimo 120 punti per richiesta
    private var retryDelay: TimeInterval = 5
    private let file: URL = {
        let dir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir.appendingPathComponent("queue.json")
    }()

    init() {
        if let d = try? Data(contentsOf: file), let q = try? JSONDecoder().decode([TrackPoint].self, from: d) { queue = q }
        pending = queue.count
        monitor.pathUpdateHandler = { [weak self] path in
            Task { @MainActor in
                guard let self else { return }
                self.online = path.status == .satisfied
                if self.online && self.active { self.flush(status: "tracking") }
            }
        }
        monitor.start(queue: DispatchQueue(label: "net"))
    }

    func enqueue(_ p: TrackPoint) {
        queue.append(p)
        if queue.count > maxQueue { queue.removeFirst(queue.count - maxQueue) }
        persist()
    }

    /// "Interrompi": i punti non ancora inviati vengono cancellati, non verranno condivisi dopo.
    func discardQueue() { queue.removeAll(); persist() }

    private func persist() {
        pending = queue.count
        if let d = try? JSONEncoder().encode(queue) { try? d.write(to: file, options: .atomic) }
    }

    /// Invia la coda (o solo lo stato, se vuota). Un solo invio alla volta.
    func flush(status: String, force: Bool = false) {
        guard !sending, active || force, let pairing else { return }
        sending = true
        Task {
            defer { sending = false }
            repeat {
                let batch = Array(queue.prefix(chunk))
                let result = await post(batch, status: status, to: pairing)
                switch result {
                case .ok:
                    queue.removeFirst(batch.count); persist()
                    lastSuccess = Date(); lastError = nil; retryDelay = 5
                case .retry:
                    scheduleRetry(status: status); return
                case .unauthorized, .raceEnded:
                    onFatal?(result); return
                }
            } while !queue.isEmpty
        }
    }

    private func scheduleRetry(status: String) {
        let d = retryDelay
        retryDelay = min(retryDelay * 2, 60)
        Task { try? await Task.sleep(nanoseconds: UInt64(d * 1_000_000_000)); flush(status: status) }
    }

    private func post(_ points: [TrackPoint], status: String, to p: Pairing) async -> UploadResult {
        var req = URLRequest(url: p.server.appendingPathComponent("api/device/positions"))
        req.httpMethod = "POST"
        req.timeoutInterval = 20
        req.setValue("Bearer \(p.token)", forHTTPHeaderField: "Authorization")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        struct Body: Encodable { let points: [TrackPoint]; let status: String }
        req.httpBody = try? JSONEncoder().encode(Body(points: points, status: status))
        do {
            let (_, resp) = try await URLSession.shared.data(for: req)
            switch (resp as? HTTPURLResponse)?.statusCode ?? 0 {
            case 200: return .ok
            case 401: lastError = "Dispositivo non autorizzato"; return .unauthorized
            case 410: lastError = "Gara conclusa"; return .raceEnded
            case 400: lastError = "Dati rifiutati dal server"; return .ok   // blocco non valido: si scarta, non si ripete all'infinito
            default: lastError = "Server non disponibile"; return .retry
            }
        } catch {
            lastError = "Connessione assente"; return .retry
        }
    }
}
