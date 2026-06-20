#include "vpn.h"
#include <string.h>
#include <stdlib.h>
#include <unistd.h>
#include <errno.h>
#include <openssl/ssl.h>
#include <openssl/err.h>
#include <openssl/pem.h>

// ═══════════════════════════════════════════════════════════════
// SSL context cache (per-host, lazy created)
// ═══════════════════════════════════════════════════════════════

#define MAX_CACHED_CTX 32

typedef struct {
    char host[256];
    SSL_CTX *ctx;
} cached_ctx_t;

static cached_ctx_t ctx_cache[MAX_CACHED_CTX];
static int ctx_cache_count = 0;
static pthread_mutex_t ctx_cache_lock = PTHREAD_MUTEX_INITIALIZER;

static SSL_CTX *find_or_create_ssl_ctx(const char *hostname) {
    pthread_mutex_lock(&ctx_cache_lock);
    
    // Check cache
    for (int i = 0; i < ctx_cache_count; i++) {
        if (strcmp(ctx_cache[i].host, hostname) == 0) {
            SSL_CTX *ctx = ctx_cache[i].ctx;
            pthread_mutex_unlock(&ctx_cache_lock);
            return ctx;
        }
    }
    pthread_mutex_unlock(&ctx_cache_lock);

    // Need to create new SSL context - request cert from Java
    // For now, create a basic server SSL_CTX that will do raw SSL
    SSL_CTX *ctx = SSL_CTX_new(TLS_server_method());
    if (!ctx) return NULL;
    
    SSL_CTX_set_min_proto_version(ctx, TLS1_2_VERSION);
    SSL_CTX_set_verify(ctx, SSL_VERIFY_NONE, NULL);
    
    // Use a simple self-signed approach: generate ephemeral key
    EVP_PKEY *pkey = EVP_PKEY_new();
    if (pkey) {
        RSA *rsa = RSA_new();
        BIGNUM *e = BN_new();
        BN_set_word(e, RSA_F4);
        RSA_generate_key_ex(rsa, 2048, e, NULL);
        EVP_PKEY_assign_RSA(pkey, rsa);
        BN_free(e);
        
        X509 *cert = X509_new();
        ASN1_INTEGER_set(X509_get_serialNumber(cert), 1);
        X509_gmtime_adj(X509_get_notBefore(cert), 0);
        X509_gmtime_adj(X509_get_notAfter(cert), 31536000L); // 1 year
        X509_set_pubkey(cert, pkey);
        X509_sign(cert, pkey, EVP_sha256());
        
        SSL_CTX_use_certificate(ctx, cert);
        SSL_CTX_use_PrivateKey(ctx, pkey);
        X509_free(cert);
        EVP_PKEY_free(pkey);
        
        LOGI("Created ephemeral SSL cert for %s", hostname);
    }

    // Cache it
    pthread_mutex_lock(&ctx_cache_lock);
    if (ctx_cache_count < MAX_CACHED_CTX) {
        strncpy(ctx_cache[ctx_cache_count].host, hostname, sizeof(ctx_cache[0].host) - 1);
        ctx_cache[ctx_cache_count].ctx = ctx;
        ctx_cache_count++;
    }
    pthread_mutex_unlock(&ctx_cache_lock);

    return ctx;
}

// ═══════════════════════════════════════════════════════════════
// TLS interception entry point
// ═══════════════════════════════════════════════════════════════

void tls_intercept(struct tcp_session *s) {
    if (!s->sni_host[0]) return;  // Need SNI hostname

    LOGI("TLS intercept: %s (fd=%d)", s->sni_host, s->socket_fd);

    SSL_CTX *server_ctx = find_or_create_ssl_ctx(s->sni_host);
    if (!server_ctx) {
        LOGE("Failed to create SSL context for %s", s->sni_host);
        return;
    }

    // Create SSL object for client side (we act as server)
    SSL *client_ssl = SSL_new(server_ctx);
    SSL_set_fd(client_ssl, s->socket_fd);
    SSL_set_accept_state(client_ssl);

    int ret = SSL_accept(client_ssl);
    if (ret <= 0) {
        int err = SSL_get_error(client_ssl, ret);
        LOGW("SSL_accept failed: %d (err=%d)", ret, err);
        SSL_free(client_ssl);
        return;
    }
    LOGI("SSL handshake complete with client for %s", s->sni_host);

    // Read plaintext HTTP request from client
    uint8_t req_buf[32768];
    int req_len = SSL_read(client_ssl, req_buf, sizeof(req_buf) - 1);
    if (req_len > 0) {
        req_buf[req_len] = 0;
        LOGI("HTTPS request: %.*s", req_len > 200 ? 200 : req_len, req_buf);

        // Build capture JSON
        char json[1024];
        char safe_url[512] = {0};
        const char *p = (const char *)req_buf;
        const char *space = strchr(p, ' ');
        if (space && space - p < 500) {
            strncpy(safe_url, p, space - p);
            snprintf(json, sizeof(json),
                     "{\"id\":%d,\"type\":\"https_decrypted\",\"host\":\"%s\",\"method\":\"%s\",\"data\":\"%.1024s\"}",
                     s->session_id, s->sni_host, safe_url,
                     (const char *)req_buf);
            on_http_event(g_ctx, json);
        }
    }

    // Cleanup
    SSL_shutdown(client_ssl);
    SSL_free(client_ssl);
}

// ═══════════════════════════════════════════════════════════════
// One-time OpenSSL init
// ═══════════════════════════════════════════════════════════════

__attribute__((constructor))
static void init_openssl(void) {
    SSL_load_error_strings();
    OpenSSL_add_ssl_algorithms();
    LOGI("OpenSSL initialized");
}
