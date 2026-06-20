#include "vpn.h"
#include <string.h>
#include <stdio.h>
#include <stdlib.h>
#include <ctype.h>

#define HTTP_BUF_MAX 65536  // 64KB max per direction

static void hex_encode(const uint8_t *data, int len, char *out) {
    for (int i = 0; i < len; i++) {
        sprintf(out + i * 2, "%02x", data[i]);
    }
    out[len * 2] = 0;
}

static void emit_event(struct tcp_session *s, const char *type,
                       const uint8_t *data, int len, int body_offset) {
    if (!g_ctx) return;

    // Find header end (\r\n\r\n)
    int header_end = 0;
    for (int i = 0; i < len - 3; i++) {
        if (data[i] == '\r' && data[i+1] == '\n' &&
            data[i+2] == '\r' && data[i+3] == '\n') {
            header_end = i + 4;
            break;
        }
    }
    if (header_end == 0 && len < HTTP_BUF_MAX) {
        header_end = len; // still accumulating
    }

    int body_start = header_end;
    int body_len = len - body_start;

    char *raw_hdr = malloc(header_end * 3 + 1);
    char *raw_body = NULL;
    if (raw_hdr) {
        hex_encode(data, header_end, raw_hdr);
    }
    if (body_len > 0 && body_len <= 4096) {
        raw_body = malloc(body_len * 3 + 1);
        if (raw_body) {
            hex_encode(data + body_start, body_len, raw_body);
        }
    }

    char json[1024 + 64]; // header for event info, data in separate fields
    snprintf(json, sizeof(json),
             "{\"id\":%d,\"type\":\"%s\",\"hdr_hex\":\"%s\",\"body_hex\":\"%s\"}",
             s->session_id, type,
             raw_hdr ? raw_hdr : "",
              raw_body ? raw_body : "");

    on_http_event(g_ctx, json);
    free(raw_hdr);
    free(raw_body);
}

static bool is_http_start(const uint8_t *data, int len) {
    if (len < 4) return false;
    return (memcmp(data, "GET ", 4) == 0 ||
            memcmp(data, "POST", 4) == 0 ||
            memcmp(data, "PUT ", 4) == 0 ||
            memcmp(data, "HEAD", 4) == 0 ||
            memcmp(data, "DELE", 4) == 0 ||
            memcmp(data, "OPTI", 4) == 0 ||
            memcmp(data, "CONN", 4) == 0 ||
            memcmp(data, "PATC", 4) == 0);
}

static bool is_http_response(const uint8_t *data, int len) {
    if (len < 8) return false;
    return (memcmp(data, "HTTP/", 5) == 0);
}

void http_check_request(struct tcp_session *s, const uint8_t *data, int len) {
    if (s->http_parsed) return;
    if (!is_http_start(data, len)) return;

    emit_event(s, "request", data, len > 4096 ? 4096 : len, 0);
    s->http_parsed = true;
}

void http_check_response(struct tcp_session *s, const uint8_t *data, int len) {
    if (!s->http_parsed) return;
    if (!is_http_response(data, len)) return;

    emit_event(s, "response", data, len > 4096 ? 4096 : len, 0);
}

// ── TLS SNI extraction ─────────────────────────────────────

void tls_extract_sni(struct tcp_session *s, const uint8_t *data, int len) {
    if (s->http_parsed) return;
    if (len < 43) return;

    if (data[0] != 0x16) return;

    if (len < 44 || data[5] != 0x01) return;

    int pos = 43;
    int session_id_len = data[pos];
    pos += 1 + session_id_len;

    if (pos + 2 > len) return;
    int cipher_len = (data[pos] << 8) | data[pos + 1];
    pos += 2 + cipher_len;

    if (pos + 1 > len) return;
    int comp_len = data[pos];
    pos += 1 + comp_len;

    if (pos + 2 > len) return;
    int ext_len = (data[pos] << 8) | data[pos + 1];
    pos += 2;

    int ext_end = pos + ext_len;
    while (pos + 4 <= ext_end && pos + 4 <= len) {
        int ext_type = (data[pos] << 8) | data[pos + 1];
        int ext_data_len = (data[pos + 2] << 8) | data[pos + 3];
        pos += 4;

        if (ext_type == 0x0000) {
            if (pos + 5 > len) break;
            int name_len = (data[pos + 3] << 8) | data[pos + 4];
            if (pos + 5 + name_len > len) break;

            if (name_len > 0 && name_len < (int)sizeof(s->sni_host)) {
                memcpy(s->sni_host, data + pos + 5, name_len);
                s->sni_host[name_len] = 0;
            }

            char json[512];
            snprintf(json, sizeof(json),
                     "{\"id\":%d,\"type\":\"https\",\"host\":\"%s\"}",
                     s->session_id, s->sni_host);
            s->http_parsed = true;
            on_http_event(g_ctx, json);

            // TODO: spawn thread for tls_intercept(s)
            break;
        }
        pos += ext_data_len;
    }
}
