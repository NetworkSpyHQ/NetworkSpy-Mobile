#include "vpn.h"
#include <string.h>
#include <stdlib.h>
#include <unistd.h>
#include <errno.h>
#include <openssl/ssl.h>
#include <openssl/err.h>
#include <openssl/pem.h>

struct ssl_thread_args {
    int client_fd;
    uint32_t dst_ip;
    uint16_t dst_port;
    int session_id;
    char hostname[256];
};

// ═══════════════════════════════════════════════════════════════
// Get cert from Java via JNI, create SSL_CTX
// ═══════════════════════════════════════════════════════════════

static SSL_CTX *get_ssl_ctx_for_host(const char *hostname) {
    if (!g_ctx || !g_ctx->instance || !g_ctx->mid_on_request_cert) return NULL;

    JNIEnv *env;
    bool attached = false;
    if ((*g_ctx->jvm)->GetEnv(g_ctx->jvm, (void **)&env, JNI_VERSION_1_6) != JNI_OK) {
        if ((*g_ctx->jvm)->AttachCurrentThread(g_ctx->jvm, &env, NULL) != JNI_OK) return NULL;
        attached = true;
    }

    jstring host = (*env)->NewStringUTF(env, hostname);
    jstring pem = (*env)->CallObjectMethod(env, g_ctx->instance, g_ctx->mid_on_request_cert, host);
    (*env)->DeleteLocalRef(env, host);

    if ((*env)->ExceptionCheck(env)) {
        (*env)->ExceptionDescribe(env);
        (*env)->ExceptionClear(env);
        LOGE("JNI exception requesting cert for %s", hostname);
        if (attached) (*g_ctx->jvm)->DetachCurrentThread(g_ctx->jvm);
        return NULL;
    }

    if (!pem || (*env)->GetStringLength(env, pem) < 100) {
        if (attached) (*g_ctx->jvm)->DetachCurrentThread(g_ctx->jvm);
        return NULL;
    }

    const char *pem_str = (*env)->GetStringUTFChars(env, pem, NULL);
    if (!pem_str || strlen(pem_str) < 100) {
        if (pem_str) (*env)->ReleaseStringUTFChars(env, pem, pem_str);
        (*env)->DeleteLocalRef(env, pem);
        if (attached) (*g_ctx->jvm)->DetachCurrentThread(g_ctx->jvm);
        LOGE("Empty/invalid PEM for %s", hostname);
        return NULL;
    }

    // Write PEM to memory BIOs
    BIO *cert_bio = BIO_new_mem_buf(pem_str, (int)strlen(pem_str));
    X509 *cert = PEM_read_bio_X509(cert_bio, NULL, NULL, NULL);
    BIO *key_bio = BIO_new_mem_buf(pem_str, (int)strlen(pem_str));
    EVP_PKEY *pkey = PEM_read_bio_PrivateKey(key_bio, NULL, NULL, NULL);

    (*env)->ReleaseStringUTFChars(env, pem, pem_str);
    (*env)->DeleteLocalRef(env, pem);
    if (attached) (*g_ctx->jvm)->DetachCurrentThread(g_ctx->jvm);

    if (!cert || !pkey) {
        LOGE("Failed to parse PEM for %s", hostname);
        if (cert) X509_free(cert);
        if (pkey) EVP_PKEY_free(pkey);
        BIO_free(cert_bio);
        BIO_free(key_bio);
        return NULL;
    }

    SSL_CTX *ctx = SSL_CTX_new(TLS_server_method());
    SSL_CTX_use_certificate(ctx, cert);
    SSL_CTX_use_PrivateKey(ctx, pkey);
    SSL_CTX_set_min_proto_version(ctx, TLS1_2_VERSION);
    SSL_CTX_set_verify(ctx, SSL_VERIFY_NONE, NULL);

    X509_free(cert);
    EVP_PKEY_free(pkey);
    BIO_free(cert_bio);
    BIO_free(key_bio);

    LOGI("Created SSL_CTX with CA-signed cert for %s", hostname);
    return ctx;
}

// ═══════════════════════════════════════════════════════════════
// Hex encode for JSON-safe sending
// ═══════════════════════════════════════════════════════════════

static void hex_encode(const uint8_t *data, int len, char *out) {
    for (int i = 0; i < len && i < 2048; i++) {
        sprintf(out + i * 2, "%02x", data[i]);
    }
    out[(len < 2048 ? len : 2048) * 2] = 0;
}

// ═══════════════════════════════════════════════════════════════
// Main SSL interception thread
// ═══════════════════════════════════════════════════════════════

void *ssl_intercept_thread(void *arg) {
    struct ssl_thread_args *a = (struct ssl_thread_args *)arg;

    LOGI("SSL intercept: %s (fd=%d, session=%d)", a->hostname, a->client_fd, a->session_id);

    SSL_CTX *server_ctx = get_ssl_ctx_for_host(a->hostname);
    if (!server_ctx) {
        LOGE("SSL: no cert for %s", a->hostname);
        close(a->client_fd);
        free(a);
        return NULL;
    }

    // ── Accept TLS from client (we act as server) ──────────
    SSL *client_ssl = SSL_new(server_ctx);
    if (!client_ssl) {
        LOGE("SSL_new failed for %s", a->hostname);
        close(a->client_fd);
        free(a);
        return NULL;
    }
    SSL_set_fd(client_ssl, a->client_fd);

    int ret = SSL_accept(client_ssl);
    if (ret <= 0) {
        int err = SSL_get_error(client_ssl, ret);
        LOGW("SSL accept failed for %s: err=%d", a->hostname, err);
        SSL_free(client_ssl);
        close(a->client_fd);
        free(a);
        return NULL;
    }
    LOGI("SSL accept OK: %s", a->hostname);

    // ── Connect to real server ─────────────────────────────
    int server_fd = socket(AF_INET, SOCK_STREAM, 0);
    if (server_fd < 0) {
        SSL_free(client_ssl); SSL_CTX_free(server_ctx); close(a->client_fd); free(a);
        return NULL;
    }

    if (protect_socket(g_ctx, server_fd) < 0) {
        close(server_fd);
        SSL_free(client_ssl); SSL_CTX_free(server_ctx); close(a->client_fd); free(a);
        return NULL;
    }

    struct sockaddr_in addr;
    memset(&addr, 0, sizeof(addr));
    addr.sin_family = AF_INET;
    addr.sin_port = htons(a->dst_port);
    addr.sin_addr.s_addr = htonl(a->dst_ip);

    if (connect(server_fd, (const struct sockaddr *)&addr, sizeof(addr)) < 0) {
        LOGE("SSL connect to server failed: %s", strerror(errno));
        close(server_fd);
        SSL_free(client_ssl); SSL_CTX_free(server_ctx); close(a->client_fd); free(a);
        return NULL;
    }

    SSL_CTX *client_ctx = SSL_CTX_new(TLS_client_method());
    if (!client_ctx) {
        SSL_free(client_ssl); SSL_CTX_free(server_ctx);
        close(server_fd); close(a->client_fd); free(a);
        return NULL;
    }
    SSL_CTX_set_verify(client_ctx, SSL_VERIFY_NONE, NULL);
    SSL *server_ssl = SSL_new(client_ctx);
    if (!server_ssl) {
        SSL_CTX_free(client_ctx);
        SSL_free(client_ssl); SSL_CTX_free(server_ctx);
        close(server_fd); close(a->client_fd); free(a);
        return NULL;
    }
    SSL_set_fd(server_ssl, server_fd);

    ret = SSL_connect(server_ssl);
    if (ret <= 0) {
        int err = SSL_get_error(server_ssl, ret);
        LOGW("SSL connect to server failed: err=%d", err);
        SSL_free(server_ssl); SSL_CTX_free(client_ctx);
        SSL_free(client_ssl); SSL_CTX_free(server_ctx);
        close(server_fd); close(a->client_fd); free(a);
        return NULL;
    }
    LOGI("SSL connect OK to %s", a->hostname);

    // ── Read request from client, forward to server ────────
    uint8_t req_buf[32768];
    int req_total = 0;

    while (req_total < (int)sizeof(req_buf) - 1) {
        int n = SSL_read(client_ssl, req_buf + req_total, 4096);
        if (n <= 0) break;
        req_total += n;
        // Check if we have full headers
        req_buf[req_total] = 0;
        if (strstr((char *)req_buf, "\r\n\r\n")) break;
    }

    if (req_total > 0) {
        req_buf[req_total] = 0;

        // Forward to server
        SSL_write(server_ssl, req_buf, req_total);

        // 📸 Capture request
        char hex[8192];
        hex_encode(req_buf, req_total, hex);
        char json[8448];
        snprintf(json, sizeof(json),
                 "{\"id\":%d,\"type\":\"request\",\"host\":\"%s\",\"real_https\":true,\"hdr_hex\":\"%s\"}",
                 a->session_id, a->hostname, hex);
        on_http_event(g_ctx, json);
    }

    // ── Read response from server, forward to client ───────
    uint8_t resp_buf[32768];
    int resp_total = 0;

    while (resp_total < (int)sizeof(resp_buf) - 1) {
        int n = SSL_read(server_ssl, resp_buf + resp_total, 4096);
        if (n <= 0) break;
        resp_total += n;
        resp_buf[resp_total] = 0;
        if (strstr((char *)resp_buf, "\r\n\r\n")) break;
    }

    if (resp_total > 0) {
        resp_buf[resp_total] = 0;

        // Forward to client
        SSL_write(client_ssl, resp_buf, resp_total);

        // 📸 Capture response
        char hex[8192];
        hex_encode(resp_buf, resp_total, hex);
        char json[8448];
        snprintf(json, sizeof(json),
                 "{\"id\":%d,\"type\":\"response\",\"host\":\"%s\",\"real_https\":true,\"hdr_hex\":\"%s\"}",
                 a->session_id, a->hostname, hex);
        on_http_event(g_ctx, json);
    }

    // ── Cleanup ────────────────────────────────────────────
    SSL_shutdown(client_ssl);
    SSL_shutdown(server_ssl);
    SSL_free(client_ssl);
    SSL_free(server_ssl);
    SSL_CTX_free(server_ctx);
    SSL_CTX_free(client_ctx);
    close(server_fd);
    close(a->client_fd);
    free(a);

    LOGI("SSL intercept done: %s", a->hostname);
    return NULL;
}

// ═══════════════════════════════════════════════════════════════
// Called from tcp.c when HTTPS + SNI detected
// ═══════════════════════════════════════════════════════════════

void tls_intercept(struct tcp_session *s) {
    if (!s->sni_host[0] || !s->socket_fd) return;

    struct ssl_thread_args *args = malloc(sizeof(struct ssl_thread_args));
    args->client_fd = s->socket_fd;
    args->dst_ip = s->dst_ip;
    args->dst_port = s->dst_port;
    args->session_id = s->session_id;
    strncpy(args->hostname, s->sni_host, sizeof(args->hostname) - 1);

    // Transfer socket ownership to the SSL thread
    s->socket_fd = -1;
    s->active = false;
    s->state = S_CLOSED;

    pthread_t thread;
    pthread_create(&thread, NULL, ssl_intercept_thread, args);
    pthread_detach(thread);

    LOGI("Spawned SSL intercept thread for %s", s->sni_host);
}

// ═══════════════════════════════════════════════════════════════
__attribute__((constructor))
static void init_openssl(void) {
    SSL_load_error_strings();
    OpenSSL_add_ssl_algorithms();
    LOGI("OpenSSL initialized");
}
