#include "vpn.h"
#include <string.h>
#include <stdlib.h>
#include <unistd.h>
#include <errno.h>
#include <time.h>
#include <sys/socket.h>
#include <netinet/in.h>
#include <arpa/inet.h>

#define MAX_UDP_SESSIONS 64
#define UDP_IDLE_TIMEOUT 30

static uint32_t udp_hash(uint32_t src_ip, uint32_t dst_ip,
                         uint16_t src_port, uint16_t dst_port) {
    return (src_ip ^ dst_ip ^ ((uint32_t)src_port << 16 | dst_port)) % MAX_SESSIONS;
}

struct udp_session *udp_session_create(struct vpn_context *ctx,
                                        uint32_t src_ip, uint32_t dst_ip,
                                        uint16_t src_port, uint16_t dst_port) {
    struct udp_session *s = calloc(1, sizeof(struct udp_session));
    if (!s) return NULL;

    s->src_ip = src_ip;
    s->dst_ip = dst_ip;
    s->src_port = src_port;
    s->dst_port = dst_port;
    s->socket_fd = -1;
    s->created = time(NULL);
    s->last_activity = s->created;
    s->active = false;

    uint32_t hash = udp_hash(src_ip, dst_ip, src_port, dst_port);

    pthread_mutex_lock(&ctx->udp_lock);
    s->next = ctx->udp_sessions[hash];
    ctx->udp_sessions[hash] = s;
    pthread_mutex_unlock(&ctx->udp_lock);

    return s;
}

struct udp_session *udp_session_lookup(struct vpn_context *ctx,
                                        uint32_t src_ip, uint32_t dst_ip,
                                        uint16_t src_port, uint16_t dst_port) {
    uint32_t hash = udp_hash(src_ip, dst_ip, src_port, dst_port);

    pthread_mutex_lock(&ctx->udp_lock);
    struct udp_session *s = ctx->udp_sessions[hash];
    while (s) {
        if (s->src_ip == src_ip && s->dst_ip == dst_ip &&
            s->src_port == src_port && s->dst_port == dst_port) {
            s->last_activity = time(NULL);
            pthread_mutex_unlock(&ctx->udp_lock);
            return s;
        }
        s = s->next;
    }
    pthread_mutex_unlock(&ctx->udp_lock);
    return NULL;
}

void udp_session_remove(struct vpn_context *ctx, struct udp_session *s) {
    uint32_t hash = udp_hash(s->src_ip, s->dst_ip, s->src_port, s->dst_port);

    pthread_mutex_lock(&ctx->udp_lock);
    struct udp_session **prev = &ctx->udp_sessions[hash];
    while (*prev) {
        if (*prev == s) {
            *prev = s->next;
            break;
        }
        prev = &(*prev)->next;
    }
    pthread_mutex_unlock(&ctx->udp_lock);
}

void udp_session_cleanup(struct vpn_context *ctx) {
    time_t now = time(NULL);

    pthread_mutex_lock(&ctx->udp_lock);
    for (int i = 0; i < MAX_SESSIONS; i++) {
        struct udp_session **prev = &ctx->udp_sessions[i];
        while (*prev) {
            struct udp_session *s = *prev;
            if (now - s->last_activity > UDP_IDLE_TIMEOUT) {
                *prev = s->next;
                s->active = false;
                if (s->socket_fd >= 0) {
                    close(s->socket_fd);
                }
                if (!s->freed) {
                    s->freed = true;
                    free(s);
                }
            } else {
                prev = &(*prev)->next;
            }
        }
    }
    pthread_mutex_unlock(&ctx->udp_lock);
}

static void *udp_reader_thread(void *arg) {
    struct udp_session *s = (struct udp_session *)arg;
    struct vpn_context *ctx = g_ctx;

    uint8_t buf[4096];

    while (ctx->running && s->active) {
        ssize_t n = read(s->socket_fd, buf, sizeof(buf));
        if (n <= 0) {
            if (n < 0 && errno != EAGAIN && errno != EINTR) {
                LOGE("UDP read error %u.%u.%u.%u:%u: %s",
                     (s->dst_ip >> 24) & 0xFF, (s->dst_ip >> 16) & 0xFF,
                     (s->dst_ip >> 8) & 0xFF, s->dst_ip & 0xFF,
                     s->dst_port, strerror(errno));
            }
            break;
        }

        s->rx_bytes += n;

        int ip_hdr_len = 20;
        int total_len = ip_hdr_len + 8 + (int)n;
        uint8_t *pkt = malloc(total_len);

        build_ip_header(pkt, total_len, s->dst_ip, s->src_ip, 17, 64);

        pkt[ip_hdr_len] = (s->dst_port >> 8) & 0xFF;
        pkt[ip_hdr_len + 1] = s->dst_port & 0xFF;
        pkt[ip_hdr_len + 2] = (s->src_port >> 8) & 0xFF;
        pkt[ip_hdr_len + 3] = s->src_port & 0xFF;
        int udp_total = 8 + (int)n;
        pkt[ip_hdr_len + 4] = (udp_total >> 8) & 0xFF;
        pkt[ip_hdr_len + 5] = udp_total & 0xFF;
        pkt[ip_hdr_len + 6] = 0;
        pkt[ip_hdr_len + 7] = 0;

        memcpy(pkt + ip_hdr_len + 8, buf, n);

        uint16_t csum = udp_checksum(s->dst_ip, s->src_ip,
                                     pkt + ip_hdr_len, 8,
                                     pkt + ip_hdr_len + 8, (int)n);
        pkt[ip_hdr_len + 6] = (csum >> 8) & 0xFF;
        pkt[ip_hdr_len + 7] = csum & 0xFF;

        ssize_t wrote = write(ctx->tun_fd, pkt, total_len);
        if (wrote < 0 && ctx->running) {
            LOGE("UDP TUN write failed: %s", strerror(errno));
        }
        free(pkt);
    }

    s->active = false;
    if (s->socket_fd >= 0) {
        close(s->socket_fd);
        s->socket_fd = -1;
    }
    udp_session_remove(ctx, s);
    if (!s->freed) {
        s->freed = true;
        free(s);
    }
    return NULL;
}

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

    struct udp_session *s = udp_session_lookup(ctx, src_ip, dst_ip, src_port, dst_port);

    if (!s) {
        s = udp_session_create(ctx, src_ip, dst_ip, src_port, dst_port);
        if (!s) return;

        s->socket_fd = socket(AF_INET, SOCK_DGRAM, 0);
        if (s->socket_fd < 0) {
            LOGE("UDP socket() failed: %s", strerror(errno));
            udp_session_remove(ctx, s);
            free(s);
            return;
        }

        if (protect_socket(ctx, s->socket_fd) < 0) {
            LOGE("UDP protect() failed");
            close(s->socket_fd);
            udp_session_remove(ctx, s);
            free(s);
            return;
        }

        struct sockaddr_in addr;
        memset(&addr, 0, sizeof(addr));
        addr.sin_family = AF_INET;
        addr.sin_port = htons(dst_port);
        addr.sin_addr.s_addr = htonl(dst_ip);

        if (connect(s->socket_fd, (const struct sockaddr *)&addr, sizeof(addr)) < 0) {
            LOGE("UDP connect() failed: %s", strerror(errno));
            close(s->socket_fd);
            udp_session_remove(ctx, s);
            free(s);
            return;
        }

        s->active = true;

        LOGI("UDP session created %u.%u.%u.%u:%u -> %u.%u.%u.%u:%u",
             (src_ip >> 24) & 0xFF, (src_ip >> 16) & 0xFF,
             (src_ip >> 8) & 0xFF, src_ip & 0xFF, src_port,
             (dst_ip >> 24) & 0xFF, (dst_ip >> 16) & 0xFF,
             (dst_ip >> 8) & 0xFF, dst_ip & 0xFF, dst_port);

        pthread_create(&s->thread, NULL, udp_reader_thread, s);
        pthread_detach(s->thread);
    }

    s->last_activity = time(NULL);

    ssize_t sent = write(s->socket_fd, packet + payload_off, payload_len);
    if (sent < 0) {
        LOGE("UDP write failed: %s", strerror(errno));
        s->active = false;
    } else {
        s->tx_bytes += sent;
    }
}
