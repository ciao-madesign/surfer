import Foundation
import CoreLocation

enum ShareState { case off, tracking, noGPS }

/// Acquisizione GPS in background con frequenza adattiva:
/// movimento regolare 15 s, lento 30 s, sosta 60 s. La frequenza reale dipende da iOS e dal GPS.
@MainActor
final class Tracker: NSObject, ObservableObject, CLLocationManagerDelegate {
    @Published var state: ShareState = .off
    @Published var pairing: Pairing? = Keychain.load()
    @Published var authorization: CLAuthorizationStatus = .notDetermined
    @Published var lastFix: CLLocation?
    @Published var message: String?
    let uploader = Uploader()

    private let manager = CLLocationManager()
    private var lastEnqueued = Date.distantPast
    private var watchdog: Task<Void, Never>?

    override init() {
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyBest
        manager.distanceFilter = 5
        manager.activityType = .fitness
        manager.pausesLocationUpdatesAutomatically = false
        manager.allowsBackgroundLocationUpdates = true
        manager.showsBackgroundLocationIndicator = true     // la barra blu resta visibile: condivisione trasparente
        authorization = manager.authorizationStatus
        uploader.pairing = pairing
        uploader.onFatal = { [weak self] r in
            guard let self else { return }
            self.message = r == .raceEnded ? "La gara è conclusa: condivisione terminata." : "Dispositivo non autorizzato: ricollega l'app."
            self.stop(sendFinalStatus: false)
        }
    }

    func setPairing(_ p: Pairing?) {
        pairing = p; uploader.pairing = p
        if let p { Keychain.save(p) } else { Keychain.delete() }
    }

    /// Chiamato solo dopo il consenso esplicito dell'utente.
    func start() {
        guard pairing != nil else { message = "Inserisci prima il codice di collegamento."; return }
        message = nil
        if manager.authorizationStatus == .notDetermined { manager.requestWhenInUseAuthorization() }
        else if manager.authorizationStatus == .authorizedWhenInUse { manager.requestAlwaysAuthorization() }
        manager.startUpdatingLocation()
        state = .tracking
        uploader.active = true
        lastEnqueued = .distantPast
        startWatchdog()
    }

    func stop(sendFinalStatus: Bool = true) {
        manager.stopUpdatingLocation()
        watchdog?.cancel()
        state = .off
        uploader.discardQueue()                      // interruzione immediata: nulla viene inviato dopo
        uploader.active = false
        if sendFinalStatus { uploader.flush(status: "paused", force: true) }
    }

    private func interval(for speed: CLLocationSpeed) -> TimeInterval {
        speed >= 1.5 ? 15 : speed >= 0.5 ? 30 : 60
    }

    nonisolated func locationManager(_ m: CLLocationManager, didUpdateLocations locs: [CLLocation]) {
        Task { @MainActor in
            guard state != .off, let loc = locs.last, loc.horizontalAccuracy >= 0 else { return }
            lastFix = loc
            if state == .noGPS { state = .tracking }
            let now = Date()
            guard now.timeIntervalSince(lastEnqueued) >= interval(for: max(loc.speed, 0)) else { return }
            lastEnqueued = now
            uploader.enqueue(TrackPoint(t: Int64(loc.timestamp.timeIntervalSince1970 * 1000), lat: loc.coordinate.latitude,
                                        lon: loc.coordinate.longitude, ele: loc.verticalAccuracy >= 0 ? loc.altitude : nil,
                                        acc: loc.horizontalAccuracy))
            uploader.flush(status: "tracking")
        }
    }

    nonisolated func locationManagerDidChangeAuthorization(_ m: CLLocationManager) {
        Task { @MainActor in
            authorization = m.authorizationStatus
            if state != .off && (authorization == .denied || authorization == .restricted) { state = .noGPS }
        }
    }

    nonisolated func locationManager(_ m: CLLocationManager, didFailWithError error: Error) {
        Task { @MainActor in if state != .off { state = .noGPS; uploader.flush(status: "no_gps") } }
    }

    /// Se per 90 s non arrivano posizioni, avvisa il portale ("Segnale GPS assente") e continua a provare.
    private func startWatchdog() {
        watchdog?.cancel()
        watchdog = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 30_000_000_000)
                guard let self, self.state != .off else { return }
                if Date().timeIntervalSince(self.lastFix?.timestamp ?? .distantPast) > 90 {
                    self.state = .noGPS; self.uploader.flush(status: "no_gps")
                }
            }
        }
    }
}
