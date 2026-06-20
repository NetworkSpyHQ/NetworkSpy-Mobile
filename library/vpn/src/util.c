#include "vpn.h"
#include <string.h>
#include <unistd.h>

uint16_t ip_checksum(const uint8_t *data, int len) {
    uint32_t sum = 0;
    for (int i = 0; i < len - 1; i += 2) {
        sum += ((uint16_t)data[i] << 8) | data[i + 1];
    }
    if (len & 1) {
        sum += (uint16_t)data[len - 1] << 8;
    }
    while (sum >> 16) {
        sum = (sum & 0xFFFF) + (sum >> 16);
    }
    return (uint16_t)~sum;
}

uint16_t tcp_checksum(uint32_t src_ip, uint32_t dst_ip,
                      const uint8_t *tcp_header, int tcp_len,
                      const uint8_t *payload, int payload_len) {
    int pseudo_len = 12 + tcp_len + payload_len;
    uint8_t pseudo[pseudo_len];

    pseudo[0] = (src_ip >> 24) & 0xFF;
    pseudo[1] = (src_ip >> 16) & 0xFF;
    pseudo[2] = (src_ip >> 8) & 0xFF;
    pseudo[3] = src_ip & 0xFF;
    pseudo[4] = (dst_ip >> 24) & 0xFF;
    pseudo[5] = (dst_ip >> 16) & 0xFF;
    pseudo[6] = (dst_ip >> 8) & 0xFF;
    pseudo[7] = dst_ip & 0xFF;
    pseudo[8] = 0;
    pseudo[9] = 6; // TCP
    pseudo[10] = ((tcp_len + payload_len) >> 8) & 0xFF;
    pseudo[11] = (tcp_len + payload_len) & 0xFF;

    memcpy(pseudo + 12, tcp_header, tcp_len);
    if (payload && payload_len > 0) {
        memcpy(pseudo + 12 + tcp_len, payload, payload_len);
    }

    return ip_checksum(pseudo, pseudo_len);
}

uint16_t udp_checksum(uint32_t src_ip, uint32_t dst_ip,
                      const uint8_t *udp_header, int udp_len,
                      const uint8_t *payload, int payload_len) {
    int pseudo_len = 12 + udp_len + payload_len;
    uint8_t pseudo[pseudo_len];

    pseudo[0] = (src_ip >> 24) & 0xFF;
    pseudo[1] = (src_ip >> 16) & 0xFF;
    pseudo[2] = (src_ip >> 8) & 0xFF;
    pseudo[3] = src_ip & 0xFF;
    pseudo[4] = (dst_ip >> 24) & 0xFF;
    pseudo[5] = (dst_ip >> 16) & 0xFF;
    pseudo[6] = (dst_ip >> 8) & 0xFF;
    pseudo[7] = dst_ip & 0xFF;
    pseudo[8] = 0;
    pseudo[9] = 17; // UDP
    pseudo[10] = ((udp_len + payload_len) >> 8) & 0xFF;
    pseudo[11] = (udp_len + payload_len) & 0xFF;

    memcpy(pseudo + 12, udp_header, udp_len);
    if (payload && payload_len > 0) {
        memcpy(pseudo + 12 + udp_len, payload, payload_len);
    }

    return ip_checksum(pseudo, pseudo_len);
}

