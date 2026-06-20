#include "vpn.h"
#include <string.h>
#include <stdlib.h>
#include <unistd.h>
#include <errno.h>
#include <time.h>
#include <stdarg.h>

struct vpn_context *g_ctx = NULL;

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
        }
    }
    return NULL;
}

void notify_traffic(struct vpn_context *ctx, const char *fmt, ...) {
    if (!ctx || !ctx->mid_on_traffic) return;

    JNIEnv *env;
    bool attached = false;
    if ((*ctx->jvm)->GetEnv(ctx->jvm, (void **)&env, JNI_VERSION_1_6) != JNI_OK) {
        if ((*ctx->jvm)->AttachCurrentThread(ctx->jvm, &env, NULL) != JNI_OK) {
            return;
        }
        attached = true;
    }

    char buf[256];
    va_list args;
    va_start(args, fmt);
    vsnprintf(buf, sizeof(buf), fmt, args);
    va_end(args);

    jstring msg = (*env)->NewStringUTF(env, buf);
    if (msg) {
        (*env)->CallVoidMethod(env, ctx->instance, ctx->mid_on_traffic, msg);
        (*env)->DeleteLocalRef(env, msg);
    }

    if (attached) {
        (*ctx->jvm)->DetachCurrentThread(ctx->jvm);
    }
}

static void vpn_init(JNIEnv *env, jobject instance) {
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

    g_ctx->tun_fd = -1;
    g_ctx->shutdown_pipe[0] = -1;
    g_ctx->shutdown_pipe[1] = -1;
    pthread_mutex_init(&g_ctx->sessions_lock, NULL);

    srand((unsigned int)time(NULL));

    LOGI("VPN library initialized");
}

static void vpn_start(JNIEnv *env, jobject instance,
                      jint tunFd, jboolean fwd53, jint rcode,
                      jstring proxyIp, jint proxyPort) {
    if (!g_ctx) {
        LOGE("VPN not initialized");
        return;
    }

    if (g_ctx->running) {
        LOGW("VPN already running");
        return;
    }

    g_ctx->tun_fd = tunFd;
    g_ctx->running = true;
    g_ctx->fwd53 = fwd53;
    g_ctx->rcode = rcode;

    const char *proxy = NULL;
    if (proxyIp) {
        proxy = (*env)->GetStringUTFChars(env, proxyIp, NULL);
        if (proxy) {
            strncpy(g_ctx->proxy_ip, proxy, sizeof(g_ctx->proxy_ip) - 1);
            (*env)->ReleaseStringUTFChars(env, proxyIp, proxy);
        }
    }
    g_ctx->proxy_port = proxyPort;

    // Create shutdown pipe
    if (pipe(g_ctx->shutdown_pipe) < 0) {
        LOGE("pipe() failed: %s", strerror(errno));
    }

    // Start TUN reader thread
    if (pthread_create(&g_ctx->tun_thread, NULL, tun_reader_thread, g_ctx) != 0) {
        LOGE("Failed to create TUN reader thread");
        g_ctx->running = false;
        return;
    }
    pthread_detach(g_ctx->tun_thread);

    // Start cleanup thread
    if (pthread_create(&g_ctx->cleanup_thread, NULL, cleanup_thread, g_ctx) != 0) {
        LOGE("Failed to create cleanup thread");
    } else {
        pthread_detach(g_ctx->cleanup_thread);
    }

    LOGI("VPN started: tunFd=%d fwd53=%d rcode=%d proxy=%s:%d",
         tunFd, fwd53, rcode, g_ctx->proxy_ip, g_ctx->proxy_port);
}

static void vpn_stop(JNIEnv *env, jobject instance, jint tunFd) {
    if (!g_ctx || !g_ctx->running) return;

    LOGI("VPN stopping...");
    g_ctx->running = false;

    // Signal shutdown via pipe
    if (g_ctx->shutdown_pipe[1] >= 0) {
        write(g_ctx->shutdown_pipe[1], "x", 1);
        close(g_ctx->shutdown_pipe[1]);
        g_ctx->shutdown_pipe[1] = -1;
    }
    if (g_ctx->shutdown_pipe[0] >= 0) {
        close(g_ctx->shutdown_pipe[0]);
        g_ctx->shutdown_pipe[0] = -1;
    }

    g_ctx->tun_fd = -1;

    // Close all sessions
    pthread_mutex_lock(&g_ctx->sessions_lock);
    for (int i = 0; i < MAX_SESSIONS; i++) {
        struct tcp_session *s = g_ctx->sessions[i];
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
        g_ctx->sessions[i] = NULL;
    }
    pthread_mutex_unlock(&g_ctx->sessions_lock);

    LOGI("VPN stopped");
}

static jint vpn_get_mtu(JNIEnv *env, jobject instance) {
    return 1500;
}

static void vpn_done(JNIEnv *env, jobject instance) {
    if (!g_ctx) return;

    if (g_ctx->running) {
        vpn_stop(env, instance, g_ctx->tun_fd);
    }

    pthread_mutex_destroy(&g_ctx->sessions_lock);

    if (g_ctx->instance) {
        (*env)->DeleteGlobalRef(env, g_ctx->instance);
        g_ctx->instance = NULL;
    }

    free(g_ctx);
    g_ctx = NULL;

    LOGI("VPN library done");
}

// ── JNI Method Tables ──────────────────────────────────────────

static JNINativeMethod methods[] = {
    {"jni_init",    "()V",                              (void *)vpn_init},
    {"jni_start",   "(IZILjava/lang/String;I)V",        (void *)vpn_start},
    {"jni_stop",    "(I)V",                              (void *)vpn_stop},
    {"jni_get_mtu", "()I",                               (void *)vpn_get_mtu},
    {"jni_done",    "()V",                               (void *)vpn_done},
};

JNIEXPORT jint JNICALL JNI_OnLoad(JavaVM *vm, void *reserved) {
    JNIEnv *env;
    if ((*vm)->GetEnv(vm, (void **)&env, JNI_VERSION_1_6) != JNI_OK) {
        return JNI_ERR;
    }

    int nMethods = sizeof(methods) / sizeof(methods[0]);

    // Register for test project class
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

    // Register for main app class
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
