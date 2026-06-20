cmake_minimum_required(VERSION 3.10.2)

# Import the shared VPN library
add_subdirectory(${CMAKE_CURRENT_SOURCE_DIR}/../../library/vpn
                 ${CMAKE_CURRENT_BINARY_DIR}/vpn)
