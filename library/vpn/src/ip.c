#include "vpn.h"
#include <string.h>

void build_ip_header(uint8_t *pkt, int total_len, uint32_t src_ip, uint32_t dst_ip,
                     uint8_t protocol, uint8_t ttl) {
    pkt[0] = 0x45; // Version 4, IHL 5
    pkt[1] = 0;
    pkt[2] = (total_len >> 8) & 0xFF;
    pkt[3] = total_len & 0xFF;
    pkt[4] = 0;
    pkt[5] = 0;
    pkt[6] = 0x40;
    pkt[7] = 0;
    pkt[8] = ttl;
    pkt[9] = protocol;
    pkt[10] = 0;
    pkt[11] = 0;

    pkt[12] = (src_ip >> 24) & 0xFF;
    pkt[13] = (src_ip >> 16) & 0xFF;
    pkt[14] = (src_ip >> 8) & 0xFF;
    pkt[15] = src_ip & 0xFF;

    pkt[16] = (dst_ip >> 24) & 0xFF;
    pkt[17] = (dst_ip >> 16) & 0xFF;
    pkt[18] = (dst_ip >> 8) & 0xFF;
    pkt[19] = dst_ip & 0xFF;

    uint16_t csum = ip_checksum(pkt, 20);
    pkt[10] = (csum >> 8) & 0xFF;
    pkt[11] = csum & 0xFF;
}

void handle_ip_packet(struct vpn_context *ctx, const uint8_t *buffer, int len) {
    if (len < 20) return;

    uint8_t version = (buffer[0] >> 4) & 0x0F;
    if (version != 4) {
        if (version == 6) {
            LOGD("IPv6 packet dropped (len=%d)", len);
        }
        return;
    }

    uint8_t ip_header_len = (buffer[0] & 0x0F) * 4;
    if (len < ip_header_len) return;

    uint8_t protocol = buffer[9];

    uint32_t src_ip = ((uint32_t)buffer[12] << 24) |
                      ((uint32_t)buffer[13] << 16) |
                      ((uint32_t)buffer[14] << 8) |
                      (uint32_t)buffer[15];

    uint32_t dst_ip = ((uint32_t)buffer[16] << 24) |
                      ((uint32_t)buffer[17] << 16) |
                      ((uint32_t)buffer[18] << 8) |
                      (uint32_t)buffer[19];

    switch (protocol) {
        case P_TCP:
            handle_tcp_packet(ctx, src_ip, dst_ip, buffer, len, ip_header_len);
            break;
        case P_UDP:
            handle_udp_packet(ctx, src_ip, dst_ip, buffer, len, ip_header_len);
            break;
        default:
            break;
    }
}
