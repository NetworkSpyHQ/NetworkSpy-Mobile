#include "vpn.h"
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include <unistd.h>

static uint32_t session_hash(uint32_t src_ip, uint32_t dst_ip,
                             uint16_t src_port, uint16_t dst_port) {
    return (src_ip ^ dst_ip ^ ((uint32_t)src_port << 16 | dst_port)) % MAX_SESSIONS;
}

struct tcp_session *session_create(struct vpn_context *ctx,
                                   uint32_t src_ip, uint32_t dst_ip,
                                   uint16_t src_port, uint16_t dst_port) {
    struct tcp_session *s = calloc(1, sizeof(struct tcp_session));
    if (!s) return NULL;

    s->src_ip = src_ip;
    s->dst_ip = dst_ip;
    s->src_port = src_port;
    s->dst_port = dst_port;
    s->version = 4;
    s->protocol = P_TCP;
    s->state = S_NEW;
    s->socket_fd = -1;
    s->created = time(NULL);
    s->last_activity = s->created;
    s->active = false;

    uint32_t hash = session_hash(src_ip, dst_ip, src_port, dst_port);

    pthread_mutex_lock(&ctx->tcp_lock);
    s->next = ctx->tcp_sessions[hash];
    ctx->tcp_sessions[hash] = s;
    pthread_mutex_unlock(&ctx->tcp_lock);

    return s;
}

struct tcp_session *session_lookup(struct vpn_context *ctx,
                                   uint32_t src_ip, uint32_t dst_ip,
                                   uint16_t src_port, uint16_t dst_port) {
    uint32_t hash = session_hash(src_ip, dst_ip, src_port, dst_port);

    pthread_mutex_lock(&ctx->tcp_lock);
    struct tcp_session *s = ctx->tcp_sessions[hash];
    while (s) {
        if (s->src_ip == src_ip && s->dst_ip == dst_ip &&
            s->src_port == src_port && s->dst_port == dst_port) {
            s->last_activity = time(NULL);
            pthread_mutex_unlock(&ctx->tcp_lock);
            return s;
        }
        s = s->next;
    }
    pthread_mutex_unlock(&ctx->tcp_lock);
    return NULL;
}

void session_remove(struct vpn_context *ctx, struct tcp_session *s) {
    uint32_t hash = session_hash(s->src_ip, s->dst_ip, s->src_port, s->dst_port);

    pthread_mutex_lock(&ctx->tcp_lock);
    struct tcp_session **prev = &ctx->tcp_sessions[hash];
    while (*prev) {
        if (*prev == s) {
            *prev = s->next;
            s->state = S_CLOSED;
            break;
        }
        prev = &(*prev)->next;
    }
    pthread_mutex_unlock(&ctx->tcp_lock);
}

void session_cleanup(struct vpn_context *ctx) {
    time_t now = time(NULL);

    pthread_mutex_lock(&ctx->tcp_lock);
    for (int i = 0; i < MAX_SESSIONS; i++) {
        struct tcp_session **prev = &ctx->tcp_sessions[i];
        while (*prev) {
            struct tcp_session *s = *prev;
            if (now - s->last_activity > SESSION_TIMEOUT) {
                *prev = s->next;
                if (s->socket_fd >= 0) {
                    close(s->socket_fd);
                }
                s->state = S_CLOSED;
                s->active = false;
                free(s);
            } else {
                prev = &(*prev)->next;
            }
        }
    }
    pthread_mutex_unlock(&ctx->tcp_lock);
}
