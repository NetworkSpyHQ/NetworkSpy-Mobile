#include "vpn.h"
#include <string.h>
#include <stdio.h>
#include <stdlib.h>

static char *safe_strndup(const uint8_t *data, int start, int max_len) {
    int end = start;
    while (end < max_len && data[end] != '\r' && data[end] != '\n' && data[end] != ' ') {
        end++;
    }
    int len = end - start;
    if (len <= 0) return NULL;
    char *s = malloc(len + 1);
    memcpy(s, data + start, len);
    s[len] = 0;
    return s;
}

static char *header_value(const uint8_t *data, int len, const char *name) {
    int name_len = (int)strlen(name);
    for (int i = 0; i < len - name_len - 1; i++) {
        if (strncasecmp((const char *)data + i, name, name_len) == 0 && data[i + name_len] == ':') {
            int val = i + name_len + 1;
            while (val < len && data[val] == ' ') val++;
            return safe_strndup(data, val, len);
        }
    }
    return NULL;
}

static bool is_http_start(const uint8_t *data, int len) {
    if (len < 7) return false;
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
    if (len < 12) return false;
    return (memcmp(data, "HTTP/", 5) == 0);
}

void http_check_request(struct tcp_session *s, const uint8_t *data, int len) {
    if (s->http_parsed) return;
    if (!is_http_start(data, len)) return;

    char *method = safe_strndup(data, 0, len);
    if (!method) return;

    // Find URL start after method + space
    int url_start = (int)strlen(method) + 1;
    if (url_start >= len) { free(method); return; }

    char *url = safe_strndup(data, url_start, len);
    if (!url) { free(method); return; }

    char *host = header_value(data, len, "Host");

    char json[1024];
    snprintf(json, sizeof(json),
             "{\"id\":%d,\"type\":\"request\",\"method\":\"%s\",\"url\":\"%s\",\"host\":\"%s\"}",
             s->session_id, method, url, host ? host : "");

    s->http_parsed = true;
    on_http_event(g_ctx, json);

    free(method);
    free(url);
    free(host);
}

void http_check_response(struct tcp_session *s, const uint8_t *data, int len) {
    if (!s->http_parsed) return;
    if (!is_http_response(data, len)) return;

    char *status_str = safe_strndup(data, 9, len); // "HTTP/1.1 "
    int status = 0;
    if (status_str) {
        char *space = strchr(status_str, ' ');
        if (space) status = atoi(space + 1);
        free(status_str);
    }

    char *ctype = header_value(data, len, "Content-Type");

    char json[512];
    snprintf(json, sizeof(json),
             "{\"id\":%d,\"type\":\"response\",\"status\":%d,\"contentType\":\"%s\"}",
             s->session_id, status, ctype ? ctype : "");

    on_http_event(g_ctx, json);
    free(ctype);
}

// ── TLS SNI extraction ─────────────────────────────────────

void tls_extract_sni(struct tcp_session *s, const uint8_t *data, int len) {
    if (s->http_parsed) return;
    if (len < 43) return;

    // TLS record: byte 0 = content type (0x16 = handshake)
    if (data[0] != 0x16) return;

    // Skip TLS record header (5 bytes): type, version(2), length(2)
    // TLS handshake: byte 5 = type (0x01 = client_hello), 3 bytes length, 2 bytes version, 32 bytes random
    // Session ID length at offset 43
    if (len < 44 || data[5] != 0x01) return;

    int pos = 43;
    int session_id_len = data[pos];
    pos += 1 + session_id_len;

    // Cipher suites length
    if (pos + 2 > len) return;
    int cipher_len = (data[pos] << 8) | data[pos + 1];
    pos += 2 + cipher_len;

    // Compression methods length
    if (pos + 1 > len) return;
    int comp_len = data[pos];
    pos += 1 + comp_len;

    // Extensions length
    if (pos + 2 > len) return;
    int ext_len = (data[pos] << 8) | data[pos + 1];
    pos += 2;

    int ext_end = pos + ext_len;
    while (pos + 4 <= ext_end && pos + 4 <= len) {
        int ext_type = (data[pos] << 8) | data[pos + 1];
        int ext_data_len = (data[pos + 2] << 8) | data[pos + 3];
        pos += 4;

        if (ext_type == 0x0000) { // server_name
            // Skip server_name_list length (2 bytes)
            // Skip name_type (1 byte)
            // name_len (2 bytes)
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
            break;
        }
        pos += ext_data_len;
    }
}
