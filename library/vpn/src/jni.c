#include "vpn.h"
#include <string.h>
#include <stdlib.h>
#include <unistd.h>
#include <errno.h>
#include <time.h>
#include <stdarg.h>

struct vpn_context *g_ctx = NULL;

// ═══════════════════════════════════════════════════════════════
// Platform-independent core
// ═══════════════════════════════════════════════════════════════

static void *tun_reader_thread(void *arg) {
    struct vpn_context *ctx = (struct vpn_context *)arg;
    uint8_t *buffer = malloc(TUN_MTU);
    if (!buffer) return NULL;

    LOGI("TUN reader thread started");

    while (ctx->running) {
        ssize_t len = read(ctx->tun_fd, buffer, TUN_MTU);
        if (len < 0) {
            if (errno == EINTR || errno == EAGAIN) continue;
            LOGE("TUN read error: %s", strerror(errno));
            break;
        }
        if (len == 0) continue;
        if (!ctx->running) break;

        handle_ip_packet(ctx, buffer, (int)len);
    }

    free(buffer);
    LOGI("TUN reader thread stopped");
    return NULL;
}

static void *cleanup_thread(void *arg) {
    struct vpn_context *ctx = (struct vpn_context *)arg;

    while (ctx->running) {
        sleep(30);
        if (ctx->running) {
            session_cleanup(ctx);
            udp_session_cleanup(ctx);
        }
    }
    return NULL;
}

void vpn_start(struct vpn_context *ctx, int tun_fd, bool fwd53, int rcode,
               const char *proxy_ip, int proxy_port) {
    if (!ctx) return;
    if (ctx->running) {
        LOGW("VPN already running");
        return;
    }

    ctx->tun_fd = tun_fd;
    ctx->running = true;
    ctx->fwd53 = fwd53;
    ctx->rcode = rcode;

    if (proxy_ip) {
        strncpy(ctx->proxy_ip, proxy_ip, sizeof(ctx->proxy_ip) - 1);
    }
    ctx->proxy_port = proxy_port;

    if (pipe(ctx->shutdown_pipe) < 0) {
        LOGE("pipe() failed: %s", strerror(errno));
    }

    if (pthread_create(&ctx->tun_thread, NULL, tun_reader_thread, ctx) != 0) {
        LOGE("Failed to create TUN reader thread");
        ctx->running = false;
        return;
    }
    pthread_detach(ctx->tun_thread);

    if (pthread_create(&ctx->cleanup_thread, NULL, cleanup_thread, ctx) != 0) {
        LOGE("Failed to create cleanup thread");
    } else {
        pthread_detach(ctx->cleanup_thread);
    }

    LOGI("VPN started: tunFd=%d fwd53=%d rcode=%d proxy=%s:%d",
         tun_fd, fwd53, rcode, ctx->proxy_ip, ctx->proxy_port);
}

void vpn_stop(struct vpn_context *ctx) {
    if (!ctx || !ctx->running) return;

    LOGI("VPN stopping...");
    ctx->running = false;

    if (ctx->tun_fd >= 0) {
        shutdown(ctx->tun_fd, SHUT_RD);
        ctx->tun_fd = -1;
    }

    if (ctx->shutdown_pipe[1] >= 0) {
        write(ctx->shutdown_pipe[1], "x", 1);
    }
    if (ctx->shutdown_pipe[0] >= 0) {
        close(ctx->shutdown_pipe[0]);
        ctx->shutdown_pipe[0] = -1;
    }
    if (ctx->shutdown_pipe[1] >= 0) {
        close(ctx->shutdown_pipe[1]);
        ctx->shutdown_pipe[1] = -1;
    }

    pthread_mutex_lock(&ctx->tcp_lock);
    for (int i = 0; i < MAX_SESSIONS; i++) {
        struct tcp_session *s = ctx->tcp_sessions[i];
        while (s) {
            struct tcp_session *next = s->next;
            s->active = false;
            if (s->socket_fd >= 0) {
                close(s->socket_fd);
                s->socket_fd = -1;
            }
            s->state = S_CLOSED;
            free(s);
            s = next;
        }
        ctx->tcp_sessions[i] = NULL;
    }
    pthread_mutex_unlock(&ctx->tcp_lock);

    pthread_mutex_lock(&ctx->udp_lock);
    for (int i = 0; i < MAX_SESSIONS; i++) {
        struct udp_session *s = ctx->udp_sessions[i];
        while (s) {
            struct udp_session *next = s->next;
            s->active = false;
            if (s->socket_fd >= 0) {
                close(s->socket_fd);
                s->socket_fd = -1;
            }
            free(s);
            s = next;
        }
        ctx->udp_sessions[i] = NULL;
    }
    pthread_mutex_unlock(&ctx->udp_lock);

    LOGI("VPN stopped");
}

int vpn_get_mtu(void) {
    return 1500;
}

void vpn_done(struct vpn_context *ctx) {
    if (!ctx) return;

    if (ctx->running) {
        vpn_stop(ctx);
    }

#if defined(__ANDROID__)
    if (ctx->instance) {
        JNIEnv *env;
        if ((*ctx->jvm)->GetEnv(ctx->jvm, (void **)&env, JNI_VERSION_1_6) == JNI_OK) {
            (*env)->DeleteGlobalRef(env, ctx->instance);
        }
        ctx->instance = NULL;
    }
#endif

    g_ctx = NULL;

    LOGI("VPN library done");
}

// ═══════════════════════════════════════════════════════════════
// Cross-platform notify_traffic and protect_socket
// ═══════════════════════════════════════════════════════════════

void notify_traffic(struct vpn_context *ctx, const char *fmt, ...) {
    if (!ctx) return;

    char buf[256];
    va_list args;
    va_start(args, fmt);
    vsnprintf(buf, sizeof(buf), fmt, args);
    va_end(args);

#if defined(__ANDROID__)
    if (!ctx->mid_on_traffic) return;
    JNIEnv *env;
    bool attached = false;
    if ((*ctx->jvm)->GetEnv(ctx->jvm, (void **)&env, JNI_VERSION_1_6) != JNI_OK) {
        if ((*ctx->jvm)->AttachCurrentThread(ctx->jvm, &env, NULL) != JNI_OK) return;
        attached = true;
    }
    jstring msg = (*env)->NewStringUTF(env, buf);
    if (msg) {
        (*env)->CallVoidMethod(env, ctx->instance, ctx->mid_on_traffic, msg);
        (*env)->DeleteLocalRef(env, msg);
    }
    if (attached) {
        (*ctx->jvm)->DetachCurrentThread(ctx->jvm);
    }
#else
    if (ctx->traffic_cb) {
        ctx->traffic_cb(buf);
    }
#endif
}

int protect_socket(struct vpn_context *ctx, int fd) {
#if defined(__ANDROID__)
    JNIEnv *env;
    bool attached = false;
    if ((*ctx->jvm)->GetEnv(ctx->jvm, (void **)&env, JNI_VERSION_1_6) != JNI_OK) {
        if ((*ctx->jvm)->AttachCurrentThread(ctx->jvm, &env, NULL) != JNI_OK) {
            LOGE("Failed to attach JNI thread");
            return -1;
        }
        attached = true;
    }
    jboolean result = (*env)->CallBooleanMethod(env, ctx->instance, ctx->mid_protect, (jint)fd);
    if (attached) {
        (*ctx->jvm)->DetachCurrentThread(ctx->jvm);
    }
    return result ? 0 : -1;
#else
    if (ctx->protect_cb) {
        return ctx->protect_cb(fd);
    }
    return 0; // iOS Packet Tunnel sockets bypass VPN automatically
#endif
}

// ═══════════════════════════════════════════════════════════════
// HTTP capture callback
// ═══════════════════════════════════════════════════════════════

void on_http_event(struct vpn_context *ctx, const char *json) {
    if (!ctx) return;
    LOGI("HTTP: %s", json);
#if defined(__ANDROID__)
    if (!ctx->mid_on_http) return;
    JNIEnv *env;
    bool attached = false;
    if ((*ctx->jvm)->GetEnv(ctx->jvm, (void **)&env, JNI_VERSION_1_6) != JNI_OK) {
        if ((*ctx->jvm)->AttachCurrentThread(ctx->jvm, &env, NULL) != JNI_OK) return;
        attached = true;
    }
    jstring msg = (*env)->NewStringUTF(env, json);
    if (msg) {
        (*env)->CallVoidMethod(env, ctx->instance, ctx->mid_on_http, msg);
        (*env)->DeleteLocalRef(env, msg);
    }
    if (attached) {
        (*ctx->jvm)->DetachCurrentThread(ctx->jvm);
    }
#else
    if (ctx->traffic_cb) {
        ctx->traffic_cb(json);
    }
#endif
}

// ═══════════════════════════════════════════════════════════════
// Android JNI entry points
// ═══════════════════════════════════════════════════════════════

#if defined(__ANDROID__)

#include <jni.h>

static void jni_vpn_init(JNIEnv *env, jobject instance) {
    if (g_ctx) {
        LOGW("VPN already initialized");
        return;
    }

    g_ctx = calloc(1, sizeof(struct vpn_context));
    if (!g_ctx) {
        LOGE("Failed to allocate VPN context");
        return;
    }

    (*env)->GetJavaVM(env, &g_ctx->jvm);

    g_ctx->instance = (*env)->NewGlobalRef(env, instance);
    if (!g_ctx->instance) {
        LOGE("Failed to create global ref");
        free(g_ctx);
        g_ctx = NULL;
        return;
    }

    jclass cls = (*env)->GetObjectClass(env, instance);
    g_ctx->mid_protect = (*env)->GetMethodID(env, cls, "protect", "(I)Z");
    if (!g_ctx->mid_protect) {
        LOGE("Failed to find protect(int) method");
        (*env)->DeleteGlobalRef(env, g_ctx->instance);
        free(g_ctx);
        g_ctx = NULL;
        return;
    }

    g_ctx->mid_on_traffic = (*env)->GetMethodID(env, cls, "onTraffic", "(Ljava/lang/String;)V");
    if (!g_ctx->mid_on_traffic) {
        LOGW("Failed to find onTraffic(String) method - traffic logging disabled");
    }

    g_ctx->mid_on_http = (*env)->GetMethodID(env, cls, "onHttpCapture", "(Ljava/lang/String;)V");
    if (!g_ctx->mid_on_http) {
        LOGW("Failed to find onHttpCapture(String) method - HTTP capture disabled");
    }

    g_ctx->mid_on_request_cert = (*env)->GetMethodID(env, cls, "requestCert", "(Ljava/lang/String;)Ljava/lang/String;");
    if (!g_ctx->mid_on_request_cert) {
        LOGW("Failed to find requestCert(String) method - SSL interception disabled");
    }

    g_ctx->tun_fd = -1;
    g_ctx->shutdown_pipe[0] = -1;
    g_ctx->shutdown_pipe[1] = -1;
    pthread_mutex_init(&g_ctx->tcp_lock, NULL);
    pthread_mutex_init(&g_ctx->udp_lock, NULL);

    g_ctx->next_session_id = 1;

    srand((unsigned int)time(NULL));

    LOGI("VPN library initialized (Android)");
}

static void jni_vpn_start_wrapper(JNIEnv *env, jobject instance,
                                  jint tunFd, jboolean fwd53, jint rcode,
                                  jstring proxyIp, jint proxyPort) {
    const char *proxy = NULL;
    if (proxyIp) {
        proxy = (*env)->GetStringUTFChars(env, proxyIp, NULL);
    }
    vpn_start(g_ctx, (int)tunFd, (bool)fwd53, (int)rcode,
              proxy ? proxy : "", (int)proxyPort);
    if (proxy) {
        (*env)->ReleaseStringUTFChars(env, proxyIp, proxy);
    }
}

static void jni_vpn_stop_wrapper(JNIEnv *env, jobject instance, jint tunFd) {
    (void)tunFd;
    vpn_stop(g_ctx);
}

static jint jni_vpn_get_mtu(JNIEnv *env, jobject instance) {
    return vpn_get_mtu();
}

static void jni_vpn_done(JNIEnv *env, jobject instance) {
    vpn_done(g_ctx);
}

static JNINativeMethod methods[] = {
    {"jni_init",    "()V",                              (void *)jni_vpn_init},
    {"jni_start",   "(IZILjava/lang/String;I)V",        (void *)jni_vpn_start_wrapper},
    {"jni_stop",    "(I)V",                              (void *)jni_vpn_stop_wrapper},
    {"jni_get_mtu", "()I",                               (void *)jni_vpn_get_mtu},
    {"jni_done",    "()V",                               (void *)jni_vpn_done},
};

JNIEXPORT jint JNICALL JNI_OnLoad(JavaVM *vm, void *reserved) {
    JNIEnv *env;
    if ((*vm)->GetEnv(vm, (void **)&env, JNI_VERSION_1_6) != JNI_OK) {
        return JNI_ERR;
    }

    int nMethods = sizeof(methods) / sizeof(methods[0]);

    jclass cls_test = (*env)->FindClass(env, "com/networkspy/vpntest/VpnTestService");
    if (cls_test) {
        if ((*env)->RegisterNatives(env, cls_test, methods, nMethods) != JNI_OK) {
            LOGW("Failed to register natives for VpnTestService");
        } else {
            LOGI("Registered natives for com.networkspy.vpntest.VpnTestService");
        }
    } else {
        (*env)->ExceptionClear(env);
    }

    jclass cls_main = (*env)->FindClass(env, "com/networkspy/mobile/vpn/CaptureVpnService");
    if (cls_main) {
        if ((*env)->RegisterNatives(env, cls_main, methods, nMethods) != JNI_OK) {
            LOGW("Failed to register natives for CaptureVpnService");
        } else {
            LOGI("Registered natives for com.networkspy.mobile.vpn.CaptureVpnService");
        }
    } else {
        (*env)->ExceptionClear(env);
    }

    if (!cls_test && !cls_main) {
        LOGE("Neither test nor main class found - no natives registered");
    }

    return JNI_VERSION_1_6;
}

#else // !__ANDROID__

// ═══════════════════════════════════════════════════════════════
// iOS entry point
// ═══════════════════════════════════════════════════════════════

void vpn_init_ios(vpn_protect_fn protect, vpn_traffic_fn traffic) {
    if (g_ctx) {
        LOGW("VPN already initialized");
        return;
    }

    g_ctx = calloc(1, sizeof(struct vpn_context));
    if (!g_ctx) {
        LOGE("Failed to allocate VPN context");
        return;
    }

    g_ctx->protect_cb = protect;
    g_ctx->traffic_cb = traffic;
    g_ctx->tun_fd = -1;
    g_ctx->shutdown_pipe[0] = -1;
    g_ctx->shutdown_pipe[1] = -1;
    pthread_mutex_init(&g_ctx->tcp_lock, NULL);
    pthread_mutex_init(&g_ctx->udp_lock, NULL);

    g_ctx->next_session_id = 1;

    srand((unsigned int)time(NULL));

    LOGI("VPN library initialized (iOS)");
}

#endif
