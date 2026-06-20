cmake_minimum_required(VERSION 3.10.2)
project("vpn" C)

set(CMAKE_C_STANDARD 11)

add_library(vpn SHARED
    src/jni.c
    src/ip.c
    src/tcp.c
    src/udp.c
    src/dns.c
    src/session.c
    src/util.c
)

target_include_directories(vpn PRIVATE include)

find_library(log-lib log)
target_link_libraries(vpn ${log-lib})
