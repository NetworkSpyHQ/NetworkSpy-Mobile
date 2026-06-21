#!/bin/bash
# Compile OpenSSL for Android using NDK
set -e

OPENSSL_VERSION="openssl-3.4.1"
NDK_HOME="$HOME/Library/Android/sdk/ndk/27.1.12297006"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
OUT_DIR="$SCRIPT_DIR/prebuilt"

export ANDROID_NDK_HOME="$NDK_HOME"
TOOLCHAIN="$NDK_HOME/toolchains/llvm/prebuilt/darwin-x86_64"
export PATH="$TOOLCHAIN/bin:$PATH"

build_arch() {
    local arch=$1
    local target=$2
    local api=$3

    echo "=== Building OpenSSL for $arch (API $api) ==="
    
    cd /tmp
    if [ ! -d "$OPENSSL_VERSION" ]; then
        echo "Downloading OpenSSL..."
        curl -sLO "https://github.com/openssl/openssl/releases/download/$OPENSSL_VERSION/$OPENSSL_VERSION.tar.gz"
        tar xzf "$OPENSSL_VERSION.tar.gz"
    fi

    cd "$OPENSSL_VERSION"
    make clean 2>/dev/null || true

    export CC="$TOOLCHAIN/bin/${target}${api}-clang"
    export CXX="$TOOLCHAIN/bin/${target}${api}-clang++"
    export AR="$TOOLCHAIN/bin/llvm-ar"
    export RANLIB="$TOOLCHAIN/bin/llvm-ranlib"
    export ANDROID_NDK_ROOT="$NDK_HOME"

    local install_dir="$OUT_DIR/$arch"
    mkdir -p "$install_dir"

    perl Configure "$target" -D__ANDROID_API__="$api" no-asm no-shared \
        --prefix="$install_dir" --openssldir="$install_dir" 2>&1 | tail -3

    make -j$(sysctl -n hw.ncpu) 2>&1 | tail -3
    make install_sw 2>&1 | tail -3

    echo "=== $arch done ==="
}

# Build only arm64-v8a (primary target)
build_arch "arm64-v8a" "android-arm64" "24"

echo ""
echo "OpenSSL compiled to: $OUT_DIR"
ls "$OUT_DIR/arm64-v8a/lib/" 2>/dev/null
