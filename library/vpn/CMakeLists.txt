cmake_minimum_required(VERSION 3.10.2)
project("vpn" C)

set(CMAKE_C_STANDARD 11)

set(OPENSSL_DIR ${CMAKE_CURRENT_SOURCE_DIR}/openssl/prebuilt/${ANDROID_ABI})

add_library(vpn SHARED
    src/jni.c
    src/ip.c
    src/tcp.c
    src/udp.c
    src/dns.c
    src/session.c
    src/util.c
    src/http.c
    src/tls_proxy.c
)

target_include_directories(vpn PRIVATE include ${OPENSSL_DIR}/include)

find_library(log-lib log)
find_library(dl-lib dl)
target_link_libraries(vpn
    ${log-lib}
    ${dl-lib}
    ${OPENSSL_DIR}/lib/libssl.a
    ${OPENSSL_DIR}/lib/libcrypto.a
)
