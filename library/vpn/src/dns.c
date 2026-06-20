#include "vpn.h"
#include <string.h>
#include <stdlib.h>
#include <unistd.h>
#include <errno.h>
#include <sys/socket.h>
#include <netinet/in.h>
#include <arpa/inet.h>

static void extract_dns_name(const uint8_t *data, int len, char *out, int out_len) {
    if (len < 12) { out[0] = '?'; out[1] = 0; return; }
    int pos = 12;
    int wrote = 0;
    while (pos < len && data[pos] != 0 && wrote < out_len - 1) {
        int label_len = data[pos];
        if (label_len == 0 || (label_len & 0xC0) == 0xC0) break;
        pos++;
        if (pos + label_len > len) break;
        if (wrote > 0) { out[wrote++] = '.'; }
        for (int i = 0; i < label_len && pos < len && wrote < out_len - 1; i++) {
            out[wrote++] = data[pos++];
        }
    }
    out[wrote] = 0;
}

void handle_dns_packet(struct vpn_context *ctx,
                       uint32_t src_ip, uint32_t dst_ip,
                       uint16_t src_port, uint16_t dst_port,
                       const uint8_t *data, int len) {
    if (len < 12) return;

    char qname[128];
    extract_dns_name(data, len, qname, sizeof(qname));
    LOGI("DNS query: %s (from %u.%u.%u.%u:%u)",
         qname,
         (src_ip >> 24) & 0xFF, (src_ip >> 16) & 0xFF,
         (src_ip >> 8) & 0xFF, src_ip & 0xFF, src_port);
    notify_traffic(ctx, "DNS %s", qname);

    int sock = socket(AF_INET, SOCK_DGRAM, 0);
    if (sock < 0) {
        LOGE("DNS socket() failed: %s", strerror(errno));
        return;
    }

    if (protect_socket(ctx, sock) < 0) {
        LOGE("DNS protect() failed");
        close(sock);
        return;
    }

    struct timeval tv;
    tv.tv_sec = DNS_TIMEOUT;
    tv.tv_usec = 0;
    setsockopt(sock, SOL_SOCKET, SO_RCVTIMEO, &tv, sizeof(tv));

    struct sockaddr_in dns_addr;
    memset(&dns_addr, 0, sizeof(dns_addr));
    dns_addr.sin_family = AF_INET;
    dns_addr.sin_port = htons(53);
    dns_addr.sin_addr.s_addr = inet_addr("8.8.8.8");

    ssize_t sent = sendto(sock, data, len, 0,
                          (const struct sockaddr *)&dns_addr, sizeof(dns_addr));
    if (sent < 0) {
        LOGE("DNS sendto() failed: %s", strerror(errno));
        close(sock);
        return;
    }
    LOGI("DNS forwarded %zd bytes to 8.8.8.8 for %s", sent, qname);

    uint8_t resp_buf[4096];
    ssize_t resp_len = recvfrom(sock, resp_buf, sizeof(resp_buf), 0, NULL, NULL);
    close(sock);

    if (resp_len <= 0) {
        LOGW("DNS no response for %s after %ds", qname, DNS_TIMEOUT);
        return;
    }
    LOGI("DNS response %zd bytes for %s", resp_len, qname);

    int ip_hdr_len = 20;
    int total_len = ip_hdr_len + 8 + (int)resp_len;
    uint8_t *pkt = malloc(total_len);

    build_ip_header(pkt, total_len, dst_ip, src_ip, 17, 64);

    pkt[ip_hdr_len] = (dst_port >> 8) & 0xFF;
    pkt[ip_hdr_len + 1] = dst_port & 0xFF;
    pkt[ip_hdr_len + 2] = (src_port >> 8) & 0xFF;
    pkt[ip_hdr_len + 3] = src_port & 0xFF;
    int udp_total = 8 + (int)resp_len;
    pkt[ip_hdr_len + 4] = (udp_total >> 8) & 0xFF;
    pkt[ip_hdr_len + 5] = udp_total & 0xFF;
    pkt[ip_hdr_len + 6] = 0;
    pkt[ip_hdr_len + 7] = 0;

    memcpy(pkt + ip_hdr_len + 8, resp_buf, resp_len);

    uint16_t csum = udp_checksum(dst_ip, src_ip,
                                 pkt + ip_hdr_len, 8,
                                 pkt + ip_hdr_len + 8, (int)resp_len);
    pkt[ip_hdr_len + 6] = (csum >> 8) & 0xFF;
    pkt[ip_hdr_len + 7] = csum & 0xFF;

    ssize_t wrote = write(ctx->tun_fd, pkt, total_len);
    if (wrote < 0) {
        LOGE("DNS TUN write failed: %s", strerror(errno));
    }
    free(pkt);
}
