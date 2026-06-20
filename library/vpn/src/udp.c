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

    LOGI("UDP %u.%u.%u.%u:%u -> %u.%u.%u.%u:%u len=%d (dropped to force TCP)",
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
}
