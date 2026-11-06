import SwiftUI
import CoreLocation

struct ContentView: View {
    @EnvironmentObject var t: Tracker
    @State private var code = ""
    @State private var askConsent = false

    var body: some View {
        NavigationView {
            Form {
                if let p = t.pairing {
                    Section("Corridore") {
                        Text(p.name).font(.headline)
                        Text(p.server.host ?? "").foregroundStyle(.secondary)
                        Button("Scollega questo telefono", role: .destructive) { t.stop(); t.setPairing(nil) }
                            .disabled(t.state != .off)
                    }
                    Section("Condivisione posizione") {
                        HStack {
                            Circle().fill(color).frame(width: 12, height: 12)
                            Text(label)
                        }
                        Button(t.state == .off ? "Avvia condivisione" : "Interrompi condivisione") {
                            if t.state == .off { askConsent = true } else { t.stop() }
                        }
                        .buttonStyle(.borderedProminent)
                        .tint(t.state == .off ? .teal : .red)
                        if t.authorization == .authorizedWhenInUse {
                            Text("Per continuare con lo schermo spento imposta la posizione su «Sempre» in Impostazioni → TrailTrack.")
                                .font(.footnote).foregroundStyle(.orange)
                        }
                    }
                    Section("Stato") {
                        row("Punti in coda", "\(t.uploader.pending)")
                        row("Rete", t.uploader.online ? "connesso" : "assente")
                        row("Ultimo invio", t.uploader.lastSuccess.map { $0.formatted(date: .omitted, time: .standard) } ?? "–")
                        if let e = t.uploader.lastError { Text(e).foregroundStyle(.orange) }
                        if let f = t.lastFix { row("Precisione GPS", "\(Int(f.horizontalAccuracy)) m") }
                    }
                } else {
                    Section("Collega il telefono") {
                        Text("Incolla il codice di collegamento che ti ha dato l'organizzatore.")
                        TextField("Codice di collegamento", text: $code, axis: .vertical)
                            .textInputAutocapitalization(.never).autocorrectionDisabled()
                        Button("Collega") {
                            if let p = Pairing.parse(code) { t.setPairing(p); code = ""; t.message = nil }
                            else { t.message = "Codice non valido." }
                        }.buttonStyle(.borderedProminent)
                    }
                }
                if let m = t.message { Section { Text(m).foregroundStyle(.orange) } }
            }
            .navigationTitle("TrailTrack")
        }
        .alert("Condividere la tua posizione?", isPresented: $askConsent) {
            Button("Annulla", role: .cancel) {}
            Button("Acconsento") { t.start() }
        } message: {
            Text("Durante la gara la tua posizione verrà inviata, anche con lo schermo spento, a chi ha il link privato della gara. Puoi interrompere in qualsiasi momento. I dati vengono cancellati 24 ore dopo la fine della gara.")
        }
    }

    private func row(_ a: String, _ b: String) -> some View { HStack { Text(a); Spacer(); Text(b).foregroundStyle(.secondary) } }
    private var color: Color { t.state == .tracking ? .green : t.state == .noGPS ? .orange : .gray }
    private var label: String { t.state == .tracking ? "Condivisione attiva" : t.state == .noGPS ? "Segnale GPS assente" : "Condivisione ferma" }
}
