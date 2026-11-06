import SwiftUI

@main
struct TrailTrackApp: App {
    @StateObject private var tracker = Tracker()

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(tracker)
        }
    }
}
