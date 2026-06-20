import NetworkExtension
import os.log

class PacketTunnelProvider: NEPacketTunnelProvider {

    private var tunnelFd: Int32 = -1
    private var running = false

    override func startTunnel(options: [String: NSObject]?, completionHandler: @escaping (Error?) -> Void) {
        let settings = NEPacketTunnelNetworkSettings(tunnelRemoteAddress: "10.0.2.1")
        settings.ipv4Settings = NEIPv4Settings(addresses: ["10.0.2.1"], subnetMasks: ["255.255.255.0"])
        settings.ipv4Settings?.includedRoutes = [NEIPv4Route.default()]
        settings.dnsSettings = NEDNSSettings(servers: ["8.8.8.8", "8.8.4.4"])
        settings.mtu = NSNumber(value: vpn_get_mtu())

        // Create socket pair to bridge packetFlow with C library
        var fds = [Int32](repeating: -1, count: 2)
        guard socketpair(AF_UNIX, SOCK_STREAM, 0, &fds) == 0 else {
            completionHandler(NSError(domain: "VPN", code: 1, userInfo: [NSLocalizedDescriptionKey: "socketpair failed"]))
            return
        }
        tunnelFd = fds[1] // C library reads/writes this

        setTunnelNetworkSettings(settings) { error in
            if let error = error {
                close(fds[0]); close(fds[1])
                completionHandler(error)
                return
            }

            // Initialize native C library
            let protect: @convention(c) (Int32) -> Int32 = { _ in return 0 }
            let traffic: @convention(c) (UnsafePointer<CChar>?) -> Void = { msg in
                if let msg = msg {
                    os_log(.info, "vpn: %{public}s", msg)
                }
            }
            vpn_init_ios(protect, traffic)
            vpn_start(g_ctx, fds[1], false, 3, "", 0)
            self.running = true

            // Bridge: packetFlow.readPackets -> write to fd[0] (C lib reads)
            self.readPackets(pipeWriteEnd: fds[0])

            // Bridge: C lib writes to fd[1] -> read from fd[0] -> packetFlow.writePackets
            DispatchQueue.global().async {
                self.drainPipeWriteback(pipeReadEnd: fds[0])
            }

            completionHandler(nil)
        }
    }

    override func stopTunnel(with reason: NEProviderStopReason, completionHandler: @escaping () -> Void) {
        running = false
        vpn_stop(g_ctx)
        if tunnelFd >= 0 {
            close(tunnelFd)
            tunnelFd = -1
        }
        completionHandler()
    }

    // MARK: - Read from packetFlow, write to C library

    private func readPackets(pipeWriteEnd: Int32) {
        packetFlow.readPackets { [weak self] packets, protocols in
            guard let self = self, self.running else { return }
            for packet in packets {
                packet.withUnsafeBytes { ptr in
                    let data = ptr.bindMemory(to: UInt8.self).baseAddress!
                    _ = write(pipeWriteEnd, data, packet.count)
                }
            }
            self.readPackets(pipeWriteEnd: pipeWriteEnd)
        }
    }

    // MARK: - Read from C library, write to packetFlow

    private func drainPipeWriteback(pipeReadEnd: Int32) {
        var buf = [UInt8](repeating: 0, count: 32767)
        while running {
            let n = read(pipeReadEnd, &buf, buf.count)
            guard n > 0 else { break }
            let data = Data(bytes: buf, count: n)
            packetFlow.writePackets([data], withProtocols: [NSNumber(value: AF_INET)])
        }
    }
}
