import SwiftUI
import NetworkExtension

struct ContentView: View {
    @State private var vpnStatus = "Idle"
    @State private var logText = "Log output:\n"

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("VPN Status: \(vpnStatus)")
                .font(.headline)

            HStack {
                Button("Start VPN") {
                    startVPN()
                }
                .disabled(vpnStatus == "Running")
                .padding()

                Button("Stop VPN") {
                    stopVPN()
                }
                .disabled(vpnStatus == "Idle")
                .padding()
            }

            ScrollView {
                Text(logText)
                    .font(.system(size: 11, design: .monospaced))
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .frame(maxHeight: .infinity)
            .border(Color.gray.opacity(0.3))
        }
        .padding()
        .onAppear {
            checkVPNStatus()
        }
    }

    private func startVPN() {
        let manager = NETunnelProviderManager()
        manager.localizedDescription = "VPN Test"

        let proto = NETunnelProviderProtocol()
        proto.providerBundleIdentifier = "com.networkspy.vpntest.PacketTunnel"
        proto.serverAddress = "10.0.2.1"
        manager.protocolConfiguration = proto

        manager.isEnabled = true
        manager.saveToPreferences { error in
            if let error = error {
                appendLog("Save error: \(error.localizedDescription)")
                return
            }
            manager.loadFromPreferences { error in
                if let error = error {
                    appendLog("Load error: \(error.localizedDescription)")
                    return
                }
                do {
                    try manager.connection.startVPNTunnel()
                    vpnStatus = "Running"
                    appendLog("VPN starting...")
                } catch {
                    appendLog("Start error: \(error.localizedDescription)")
                }
            }
        }
    }

    private func stopVPN() {
        NETunnelProviderManager.loadAllFromPreferences { managers, error in
            if let managers = managers {
                for m in managers {
                    m.connection.stopVPNTunnel()
                }
            }
            vpnStatus = "Idle"
            appendLog("VPN stopped")
        }
    }

    private func checkVPNStatus() {
        NETunnelProviderManager.loadAllFromPreferences { managers, _ in
            if let managers = managers, let conn = managers.first?.connection {
                if conn.status == .connected || conn.status == .connecting {
                    vpnStatus = "Running"
                } else {
                    vpnStatus = "Idle"
                }
            }
        }
    }

    private func appendLog(_ msg: String) {
        let formatter = DateFormatter()
        formatter.dateFormat = "HH:mm:ss"
        let ts = formatter.string(from: Date())
        logText += "[\(ts)] \(msg)\n"
    }
}
