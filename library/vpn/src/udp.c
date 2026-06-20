#include "vpn.h"
#include <string.h>
#include <stdlib.h>
#include <unistd.h>
#include <errno.h>
#include <sys/socket.h>
#include <netinet/in.h>
#include <arpa/inet.h>

void handle_udp_packet(struct vpn_context *ctx,
                       uint32_t src_ip, uint32_t dst_ip,
                       const uint8_t *packet, int len,
                       int ip_header_len) {
    if (len < ip_header_len + 8) return;

    uint16_t src_port = ((uint16_t)packet[ip_header_len] << 8) | packet[ip_header_len + 1];
    uint16_t dst_port = ((uint16_t)packet[ip_header_len + 2] << 8) | packet[ip_header_len + 3];
    int udp_len = ((uint16_t)packet[ip_header_len + 4] << 8) | packet[ip_header_len + 5];
    int payload_off = ip_header_len + 8;
    int payload_len = len - payload_off;
    if (payload_len > udp_len - 8) payload_len = udp_len - 8;
    if (payload_len <= 0) return;

    // DNS interception
    if (dst_port == 53 || (ctx->fwd53 && dst_port != 53)) {
        handle_dns_packet(ctx, src_ip, dst_ip, src_port, dst_port,
                         packet + payload_off, payload_len);
        return;
    }

    LOGI("UDP %u.%u.%u.%u:%u -> %u.%u.%u.%u:%u len=%d",
         (src_ip >> 24) & 0xFF, (src_ip >> 16) & 0xFF,
         (src_ip >> 8) & 0xFF, src_ip & 0xFF, src_port,
         (dst_ip >> 24) & 0xFF, (dst_ip >> 16) & 0xFF,
         (dst_ip >> 8) & 0xFF, dst_ip & 0xFF, dst_port,
         payload_len);

    notify_traffic(ctx, "UDP %u.%u.%u.%u:%u -> %u.%u.%u.%u:%u",
                   (src_ip >> 24) & 0xFF, (src_ip >> 16) & 0xFF,
                   (src_ip >> 8) & 0xFF, src_ip & 0xFF, src_port,
                   (dst_ip >> 24) & 0xFF, (dst_ip >> 16) & 0xFF,
                   (dst_ip >> 8) & 0xFF, dst_ip & 0xFF, dst_port);

    int sock = socket(AF_INET, SOCK_DGRAM, 0);
    if (sock < 0) return;

    if (protect_socket(ctx, sock) < 0) {
        close(sock);
        return;
    }

    struct timeval tv;
    tv.tv_sec = UDP_TIMEOUT;
    tv.tv_usec = 0;
    setsockopt(sock, SOL_SOCKET, SO_RCVTIMEO, &tv, sizeof(tv));

    struct sockaddr_in addr;
    memset(&addr, 0, sizeof(addr));
    addr.sin_family = AF_INET;
    addr.sin_port = htons(dst_port);
    addr.sin_addr.s_addr = htonl(dst_ip);

    ssize_t sent = sendto(sock, packet + payload_off, payload_len, 0,
                          (const struct sockaddr *)&addr, sizeof(addr));
    if (sent < 0) {
        LOGE("UDP sendto failed: %s", strerror(errno));
        close(sock);
        return;
    }

    uint8_t resp_buf[4096];
    ssize_t resp_len = recvfrom(sock, resp_buf, sizeof(resp_buf), 0, NULL, NULL);
    close(sock);

    if (resp_len <= 0) return;

    // Build IP + UDP response packet
    int total_len = ip_header_len + 8 + (int)resp_len;
    uint8_t *pkt = malloc(total_len);

    build_ip_header(pkt, total_len, dst_ip, src_ip, 17, 64);

    // UDP header
    pkt[ip_header_len] = (dst_port >> 8) & 0xFF;
    pkt[ip_header_len + 1] = dst_port & 0xFF;
    pkt[ip_header_len + 2] = (src_port >> 8) & 0xFF;
    pkt[ip_header_len + 3] = src_port & 0xFF;
    int udp_total = 8 + (int)resp_len;
    pkt[ip_header_len + 4] = (udp_total >> 8) & 0xFF;
    pkt[ip_header_len + 5] = udp_total & 0xFF;
    pkt[ip_header_len + 6] = 0;
    pkt[ip_header_len + 7] = 0;

    memcpy(pkt + ip_header_len + 8, resp_buf, resp_len);

    uint16_t csum = udp_checksum(dst_ip, src_ip,
                                 pkt + ip_header_len, 8,
                                 pkt + ip_header_len + 8, (int)resp_len);
    pkt[ip_header_len + 6] = (csum >> 8) & 0xFF;
    pkt[ip_header_len + 7] = csum & 0xFF;

    write(ctx->tun_fd, pkt, total_len);
    free(pkt);
}
