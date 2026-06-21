#include "vpn.h"
#include <string.h>
#include <stdlib.h>
#include <unistd.h>
#include <errno.h>
#include <time.h>
#include <fcntl.h>
#include <netinet/in.h>
#include <arpa/inet.h>
#include <poll.h>

static void build_tcp_header(uint8_t *pkt, int offset,
                             uint16_t src_port, uint16_t dst_port,
                             uint32_t seq, uint32_t ack,
                             uint8_t flags, uint16_t window) {
    // Packets going back to the client must swap src/dst:
    // IP:  src=dst_ip,  dst=src_ip  (pretend to be the server)
    // TCP: src=dst_port, dst=src_port
    pkt[offset] = (src_port >> 8) & 0xFF;
    pkt[offset + 1] = src_port & 0xFF;
    pkt[offset + 2] = (dst_port >> 8) & 0xFF;
    pkt[offset + 3] = dst_port & 0xFF;

    pkt[offset + 4] = (seq >> 24) & 0xFF;
    pkt[offset + 5] = (seq >> 16) & 0xFF;
    pkt[offset + 6] = (seq >> 8) & 0xFF;
    pkt[offset + 7] = seq & 0xFF;

    pkt[offset + 8] = (ack >> 24) & 0xFF;
    pkt[offset + 9] = (ack >> 16) & 0xFF;
    pkt[offset + 10] = (ack >> 8) & 0xFF;
    pkt[offset + 11] = ack & 0xFF;

    pkt[offset + 12] = 0x50; // Data offset = 5 (20 bytes)
    pkt[offset + 13] = flags;

    pkt[offset + 14] = (window >> 8) & 0xFF;
    pkt[offset + 15] = window & 0xFF;

    pkt[offset + 16] = 0;
    pkt[offset + 17] = 0;
    pkt[offset + 18] = 0;
    pkt[offset + 19] = 0;
}

// Flags
#define TCP_FIN 0x01
#define TCP_SYN 0x02
#define TCP_RST 0x04
#define TCP_PSH 0x08
#define TCP_ACK 0x10

static int make_nonblocking(int fd) {
    int flags = fcntl(fd, F_GETFL, 0);
    if (flags == -1) return -1;
    return fcntl(fd, F_SETFL, flags | O_NONBLOCK);
}

static void send_tun_packet(struct vpn_context *ctx, const uint8_t *pkt, int len) {
    if (ctx->tun_fd < 0) {
        LOGE("TUN write failed: tun_fd is -1");
        return;
    }
    ssize_t n = write(ctx->tun_fd, pkt, len);
    if (n < 0) {
        LOGE("TUN write failed: %s (fd=%d)", strerror(errno), ctx->tun_fd);
    } else if (n != len) {
        LOGW("TUN write partial: %zd/%d bytes", n, len);
    }
}

static int connect_with_timeout(int fd, const struct sockaddr_in *addr, int timeout_sec) {
    make_nonblocking(fd);
    int ret = connect(fd, (const struct sockaddr *)addr, sizeof(*addr));

    if (ret < 0 && errno == EINPROGRESS) {
        struct pollfd pfd;
        pfd.fd = fd;
        pfd.events = POLLOUT;
        ret = poll(&pfd, 1, timeout_sec * 1000);
        if (ret <= 0) {
            return -1;
        }

        int so_error = 0;
        socklen_t len = sizeof(so_error);
        if (getsockopt(fd, SOL_SOCKET, SO_ERROR, &so_error, &len) < 0 || so_error != 0) {
            return -1;
        }
    }

    // Restore blocking
    int flags = fcntl(fd, F_GETFL, 0);
    fcntl(fd, F_SETFL, flags & ~O_NONBLOCK);
    return 0;
}

static void *tcp_server_reader(void *arg) {
    struct tcp_session *s = (struct tcp_session *)arg;
    struct vpn_context *ctx = g_ctx;

    uint8_t buf[8192];

    while (ctx->running && s->active && s->state == S_CONNECTED) {
        ssize_t n = read(s->socket_fd, buf, sizeof(buf));
        if (n <= 0) {
            if (n < 0) {
                LOGE("TCP read error from %u.%u.%u.%u:%u: %s",
                     (s->dst_ip >> 24) & 0xFF, (s->dst_ip >> 16) & 0xFF,
                     (s->dst_ip >> 8) & 0xFF, s->dst_ip & 0xFF,
                     s->dst_port, strerror(errno));
            }
            break;
        }

        s->rx_bytes += n;

        // Build IP + TCP response packet
        int ip_hdr_len = 20;
        int tcp_hdr_len = 20;
        int total_len = ip_hdr_len + tcp_hdr_len + (int)n;
        uint8_t *pkt = malloc(total_len);

        build_ip_header(pkt, total_len, s->dst_ip, s->src_ip, 6, 64);
        // Response packet: src/dst swapped (server→client)
        build_tcp_header(pkt, ip_hdr_len, s->dst_port, s->src_port,
                        s->server_seq, s->client_ack, TCP_PSH | TCP_ACK, 65535);

        memcpy(pkt + ip_hdr_len + tcp_hdr_len, buf, n);

        uint16_t csum = tcp_checksum(s->dst_ip, s->src_ip,
                                     pkt + ip_hdr_len, tcp_hdr_len,
                                     pkt + ip_hdr_len + tcp_hdr_len, (int)n);
        pkt[ip_hdr_len + 16] = (csum >> 8) & 0xFF;
        pkt[ip_hdr_len + 17] = csum & 0xFF;

        send_tun_packet(ctx, pkt, total_len);
        s->server_seq += n;

        if (s->http_parsed && !s->is_https) {
            http_check_response(s, buf, (int)n);
        }

        free(pkt);
    }

    LOGI("TCP server reader exiting for %u.%u.%u.%u:%u",
         (s->dst_ip >> 24) & 0xFF, (s->dst_ip >> 16) & 0xFF,
         (s->dst_ip >> 8) & 0xFF, s->dst_ip & 0xFF, s->dst_port);

    if (!s->freed) {
        s->active = false;
        s->state = S_CLOSING;
    }
    return NULL;
}

void handle_tcp_packet(struct vpn_context *ctx,
                       uint32_t src_ip, uint32_t dst_ip,
                       const uint8_t *packet, int len,
                       int ip_header_len) {
    if (len < ip_header_len + 20) return;

    uint16_t src_port = ((uint16_t)packet[ip_header_len] << 8) | packet[ip_header_len + 1];
    uint16_t dst_port = ((uint16_t)packet[ip_header_len + 2] << 8) | packet[ip_header_len + 3];
    uint32_t seq = ((uint32_t)packet[ip_header_len + 4] << 24) |
                   ((uint32_t)packet[ip_header_len + 5] << 16) |
                   ((uint32_t)packet[ip_header_len + 6] << 8) |
                   (uint32_t)packet[ip_header_len + 7];
    uint32_t ack = ((uint32_t)packet[ip_header_len + 8] << 24) |
                   ((uint32_t)packet[ip_header_len + 9] << 16) |
                   ((uint32_t)packet[ip_header_len + 10] << 8) |
                   (uint32_t)packet[ip_header_len + 11];
    uint8_t flags = packet[ip_header_len + 13];
    int tcp_hdr_len = ((packet[ip_header_len + 12] >> 4) & 0x0F) * 4;
    int payload_off = ip_header_len + tcp_hdr_len;
    int payload_len = len - payload_off;

    struct tcp_session *s = session_lookup(ctx, src_ip, dst_ip, src_port, dst_port);

    if (flags & TCP_RST) {
        if (s) {
            LOGD("TCP RST %u.%u.%u.%u:%u -> %u.%u.%u.%u:%u",
                 (src_ip >> 24) & 0xFF, (src_ip >> 16) & 0xFF,
                 (src_ip >> 8) & 0xFF, src_ip & 0xFF, src_port,
                 (dst_ip >> 24) & 0xFF, (dst_ip >> 16) & 0xFF,
                 (dst_ip >> 8) & 0xFF, dst_ip & 0xFF, dst_port);
            s->active = false;
            if (s->socket_fd >= 0) close(s->socket_fd);
            s->socket_fd = -1;
            session_remove(ctx, s);
            if (!s->freed) { s->freed = true; free(s); }
        }
        return;
    }

    if (flags & TCP_SYN) {
        if (s) return; // duplicate SYN, ignore

        LOGI("TCP SYN %u.%u.%u.%u:%u -> %u.%u.%u.%u:%u",
             (src_ip >> 24) & 0xFF, (src_ip >> 16) & 0xFF,
             (src_ip >> 8) & 0xFF, src_ip & 0xFF, src_port,
             (dst_ip >> 24) & 0xFF, (dst_ip >> 16) & 0xFF,
             (dst_ip >> 8) & 0xFF, dst_ip & 0xFF, dst_port);

        notify_traffic(ctx, "TCP %u.%u.%u.%u:%u -> %u.%u.%u.%u:%u",
                       (src_ip >> 24) & 0xFF, (src_ip >> 16) & 0xFF,
                       (src_ip >> 8) & 0xFF, src_ip & 0xFF, src_port,
                       (dst_ip >> 24) & 0xFF, (dst_ip >> 16) & 0xFF,
                       (dst_ip >> 8) & 0xFF, dst_ip & 0xFF, dst_port);

        s = session_create(ctx, src_ip, dst_ip, src_port, dst_port);
        if (!s) return;

        s->client_seq = seq + 1;
        s->client_ack = s->client_seq;
        s->server_seq = (uint32_t)(rand() & 0x7FFFFFFF);
        s->state = S_CONNECTING;

        // Create socket
        s->socket_fd = socket(AF_INET, SOCK_STREAM, 0);
        if (s->socket_fd < 0) {
            LOGE("TCP socket() failed: %s", strerror(errno));
            session_remove(ctx, s);
            if (!s->freed) { s->freed = true; free(s); }
            return;
        }

        // Protect socket
        if (protect_socket(ctx, s->socket_fd) < 0) {
            LOGE("TCP protect() failed");
            close(s->socket_fd);
            session_remove(ctx, s);
            if (!s->freed) { s->freed = true; free(s); }
            return;
        }

        // Connect to destination
        struct sockaddr_in addr;
        memset(&addr, 0, sizeof(addr));
        addr.sin_family = AF_INET;
        addr.sin_port = htons(dst_port);
        addr.sin_addr.s_addr = htonl(dst_ip);

        if (connect_with_timeout(s->socket_fd, &addr, TCP_CONNECT_TIMEOUT) < 0) {
            LOGW("TCP connect failed %u.%u.%u.%u:%u: %s",
                 (dst_ip >> 24) & 0xFF, (dst_ip >> 16) & 0xFF,
                 (dst_ip >> 8) & 0xFF, dst_ip & 0xFF, dst_port,
                 strerror(errno));
            // Send RST back to client
            int total_len = ip_header_len + 20;
            uint8_t rst_pkt[total_len];
            build_ip_header(rst_pkt, total_len, dst_ip, src_ip, 6, 64);
            // RST responses: also swapped (server→client)
            build_tcp_header(rst_pkt, ip_header_len, dst_port, src_port, seq, 0, TCP_RST | TCP_ACK, 0);
            uint16_t csum = tcp_checksum(dst_ip, src_ip, rst_pkt + ip_header_len, 20, NULL, 0);
            rst_pkt[ip_header_len + 16] = (csum >> 8) & 0xFF;
            rst_pkt[ip_header_len + 17] = csum & 0xFF;
            send_tun_packet(ctx, rst_pkt, total_len);

            close(s->socket_fd);
            session_remove(ctx, s);
            if (!s->freed) { s->freed = true; free(s); }
            return;
        }

        s->state = S_CONNECTED;
        s->active = true;

        LOGI("TCP connected %u.%u.%u.%u:%u",
             (dst_ip >> 24) & 0xFF, (dst_ip >> 16) & 0xFF,
             (dst_ip >> 8) & 0xFF, dst_ip & 0xFF, dst_port);

        // Send SYN-ACK
        int total_len = ip_header_len + 20;
        uint8_t syn_ack[total_len];
        build_ip_header(syn_ack, total_len, dst_ip, src_ip, 6, 64);
        // Response: src/dst ports swapped (server→client)
        build_tcp_header(syn_ack, ip_header_len, dst_port, src_port,
                        s->server_seq, s->client_seq, TCP_SYN | TCP_ACK, 65535);
        uint16_t csum = tcp_checksum(dst_ip, src_ip, syn_ack + ip_header_len, 20, NULL, 0);
        syn_ack[ip_header_len + 16] = (csum >> 8) & 0xFF;
        syn_ack[ip_header_len + 17] = csum & 0xFF;
        send_tun_packet(ctx, syn_ack, total_len);

        s->server_seq++; // SYN consumes 1 seq number

        // Spawn reader thread for server -> client data
        pthread_create(&s->thread, NULL, tcp_server_reader, s);
        pthread_detach(s->thread);

        return;
    }

    if (!s) {
        return;
    }

    s->last_activity = time(NULL);

    if (flags & TCP_FIN) {
        LOGI("TCP FIN %u.%u.%u.%u:%u -> %u.%u.%u.%u:%u",
             (src_ip >> 24) & 0xFF, (src_ip >> 16) & 0xFF,
             (src_ip >> 8) & 0xFF, src_ip & 0xFF, src_port,
             (dst_ip >> 24) & 0xFF, (dst_ip >> 16) & 0xFF,
             (dst_ip >> 8) & 0xFF, dst_ip & 0xFF, dst_port);

        s->client_ack = seq + 1;

        if (s->socket_fd >= 0) {
            shutdown(s->socket_fd, SHUT_WR);
        }

        // Send FIN-ACK back
        int total_len = ip_header_len + 20;
        uint8_t fin_ack[total_len];
        build_ip_header(fin_ack, total_len, dst_ip, src_ip, 6, 64);
        // Response: ports swapped (server→client)
        build_tcp_header(fin_ack, ip_header_len, dst_port, src_port,
                        s->server_seq, s->client_ack, TCP_FIN | TCP_ACK, 65535);
        uint16_t csum = tcp_checksum(dst_ip, src_ip, fin_ack + ip_header_len, 20, NULL, 0);
        fin_ack[ip_header_len + 16] = (csum >> 8) & 0xFF;
        fin_ack[ip_header_len + 17] = csum & 0xFF;
        send_tun_packet(ctx, fin_ack, total_len);

        s->server_seq++;
        s->active = false;
        s->state = S_CLOSING;

        if (s->socket_fd >= 0) {
            close(s->socket_fd);
            s->socket_fd = -1;
        }
        session_remove(ctx, s);
        free(s);
        return;
    }

    if (flags & TCP_ACK) {
        s->client_ack = seq;
        if (payload_len > 0) {
            s->client_ack += payload_len;
        }
    }

    // Forward data from client to server
    if (payload_len > 0 && s->socket_fd >= 0 && s->state == S_CONNECTED) {
        // Check for HTTP/HTTPS BEFORE forwarding to real server
        if (!s->http_parsed) {
            if (s->is_https) {
                tls_extract_sni(s, packet + payload_off, payload_len);
                if (s->http_parsed && s->sni_host[0] && g_intercept_enabled) {
                    // SSL intercept - transfer socket to SSL thread
                    tls_intercept(s);
                    return;
                }
            } else {
                http_check_request(s, packet + payload_off, payload_len);
            }
        }

        s->tx_bytes += payload_len;
        ssize_t n = write(s->socket_fd, packet + payload_off, payload_len);
        if (n < 0) {
            LOGE("TCP write to server failed: %s", strerror(errno));
            s->active = false;
        }
    }
}
