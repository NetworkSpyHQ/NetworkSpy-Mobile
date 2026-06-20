#ifndef VPN_H
#define VPN_H

#include <stdint.h>
#include <stdbool.h>
#include <pthread.h>
#include <sys/socket.h>
#include <netinet/in.h>

#define TAG "vpn"
#define TUN_MTU 32767
#define MAX_SESSIONS 256
#define SESSION_TIMEOUT 60
#define TCP_CONNECT_TIMEOUT 10
#define UDP_TIMEOUT 10
#define DNS_TIMEOUT 10

// ── Platform-specific headers ──────────────────────────────────

#ifdef __ANDROID__
#include <android/log.h>
#include <jni.h>
#define LOGD(...) __android_log_print(ANDROID_LOG_DEBUG, TAG, __VA_ARGS__)
#define LOGI(...) __android_log_print(ANDROID_LOG_INFO, TAG, __VA_ARGS__)
#define LOGW(...) __android_log_print(ANDROID_LOG_WARN, TAG, __VA_ARGS__)
#define LOGE(...) __android_log_print(ANDROID_LOG_ERROR, TAG, __VA_ARGS__)
#else
#include <stdio.h>
#define LOGD(fmt, ...) printf("[D] " TAG ": " fmt "\n", ##__VA_ARGS__)
#define LOGI(fmt, ...) printf("[I] " TAG ": " fmt "\n", ##__VA_ARGS__)
#define LOGW(fmt, ...) printf("[W] " TAG ": " fmt "\n", ##__VA_ARGS__)
#define LOGE(fmt, ...) printf("[E] " TAG ": " fmt "\n", ##__VA_ARGS__)
#endif

// ── Shared types ───────────────────────────────────────────────

enum session_state {
    S_NEW,
    S_CONNECTING,
    S_CONNECTED,
    S_CLOSING,
    S_CLOSED
};

enum session_protocol {
    P_TCP = 6,
    P_UDP = 17,
    P_ICMP = 1
};

struct tcp_session {
    uint32_t src_ip;
    uint32_t dst_ip;
    uint16_t src_port;
    uint16_t dst_port;
    int socket_fd;
    int version;
    int protocol;
    int state;
    uint32_t client_seq;
    uint32_t server_seq;
    uint32_t client_ack;
    time_t created;
    time_t last_activity;
    uint64_t tx_bytes;
    uint64_t rx_bytes;
    pthread_t thread;
    bool active;
    struct tcp_session *next;
};

struct udp_session {
    uint32_t src_ip;
    uint32_t dst_ip;
    uint16_t src_port;
    uint16_t dst_port;
    int socket_fd;
    time_t created;
    time_t last_activity;
    uint64_t tx_bytes;
    uint64_t rx_bytes;
    pthread_t thread;
    bool active;
    struct udp_session *next;
};

// ── Platform callbacks (iOS) ──────────────────────────────────

#ifndef __ANDROID__
typedef int (*vpn_protect_fn)(int fd);
typedef void (*vpn_traffic_fn)(const char *msg);
#endif

// ── Context struct ────────────────────────────────────────────

struct vpn_context {
#if defined(__ANDROID__)
    JavaVM *jvm;
    jobject instance;
    jmethodID mid_protect;
    jmethodID mid_on_traffic;
#else
    vpn_protect_fn protect_cb;
    vpn_traffic_fn traffic_cb;
#endif

    int tun_fd;
    bool running;
    bool fwd53;
    int rcode;
    char proxy_ip[16];
    int proxy_port;

    pthread_t tun_thread;
    pthread_t cleanup_thread;
    int shutdown_pipe[2];

    struct tcp_session *tcp_sessions[MAX_SESSIONS];
    struct udp_session *udp_sessions[MAX_SESSIONS];
    pthread_mutex_t tcp_lock;
    pthread_mutex_t udp_lock;
};

extern struct vpn_context *g_ctx;

// ── Platform-specific init ────────────────────────────────────

#ifdef __ANDROID__
void vpn_init_android(JNIEnv *env, jobject instance);
#else
void vpn_init_ios(vpn_protect_fn protect, vpn_traffic_fn traffic);
#endif

void vpn_start(struct vpn_context *ctx, int tun_fd, bool fwd53, int rcode,
               const char *proxy_ip, int proxy_port);
void vpn_stop(struct vpn_context *ctx);
int  vpn_get_mtu(void);
void vpn_done(struct vpn_context *ctx);

// ── Packet handling ───────────────────────────────────────────

void handle_ip_packet(struct vpn_context *ctx, const uint8_t *buffer, int len);
void build_ip_header(uint8_t *pkt, int total_len, uint32_t src_ip, uint32_t dst_ip,
                     uint8_t protocol, uint8_t ttl);

uint16_t ip_checksum(const uint8_t *data, int len);
uint16_t tcp_checksum(uint32_t src_ip, uint32_t dst_ip,
                      const uint8_t *tcp_header, int tcp_len,
                      const uint8_t *payload, int payload_len);
uint16_t udp_checksum(uint32_t src_ip, uint32_t dst_ip,
                      const uint8_t *udp_header, int udp_len,
                      const uint8_t *payload, int payload_len);

// ── Session management ────────────────────────────────────────

struct tcp_session *session_create(struct vpn_context *ctx,
                                   uint32_t src_ip, uint32_t dst_ip,
                                   uint16_t src_port, uint16_t dst_port);
struct tcp_session *session_lookup(struct vpn_context *ctx,
                                   uint32_t src_ip, uint32_t dst_ip,
                                   uint16_t src_port, uint16_t dst_port);
void session_remove(struct vpn_context *ctx, struct tcp_session *s);
void session_cleanup(struct vpn_context *ctx);

struct udp_session *udp_session_create(struct vpn_context *ctx,
                                       uint32_t src_ip, uint32_t dst_ip,
                                       uint16_t src_port, uint16_t dst_port);
struct udp_session *udp_session_lookup(struct vpn_context *ctx,
                                       uint32_t src_ip, uint32_t dst_ip,
                                       uint16_t src_port, uint16_t dst_port);
void udp_session_remove(struct vpn_context *ctx, struct udp_session *s);
void udp_session_cleanup(struct vpn_context *ctx);

int protect_socket(struct vpn_context *ctx, int fd);
void notify_traffic(struct vpn_context *ctx, const char *fmt, ...);

void handle_tcp_packet(struct vpn_context *ctx,
                       uint32_t src_ip, uint32_t dst_ip,
                       const uint8_t *packet, int len,
                       int ip_header_len);
void handle_udp_packet(struct vpn_context *ctx,
                       uint32_t src_ip, uint32_t dst_ip,
                       const uint8_t *packet, int len,
                       int ip_header_len);
void handle_dns_packet(struct vpn_context *ctx,
                       uint32_t src_ip, uint32_t dst_ip,
                       uint16_t src_port, uint16_t dst_port,
                       const uint8_t *data, int len);

#endif
