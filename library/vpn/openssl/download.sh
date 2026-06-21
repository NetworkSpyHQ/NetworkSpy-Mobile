#!/bin/bash
# Downloads prebuilt OpenSSL for Android from KDAB's maintained repository
set -e

OPENSSL_VERSION="3.3.2"
BASE_URL="https://github.com/KDAB/android_openssl/raw/refs/heads/master/archives"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
OUT_DIR="$SCRIPT_DIR/prebuilt"

mkdir -p "$OUT_DIR"

download_arch() {
    local arch=$1
    local libdir=$2
    local tarball="openssl-${OPENSSL_VERSION}-android-${arch}.tar.gz"
    local url="$BASE_URL/$tarball"

    echo "Downloading $arch..."
    curl -sL "$url" -o "/tmp/$tarball" 2>&1 || {
        echo "  Failed to download $arch from KDAB, trying alternate source..."
        curl -sL "https://github.com/KDAB/android_openssl/releases/download/v${OPENSSL_VERSION}/$tarball" -o "/tmp/$tarball" 2>&1 || {
            echo "  WARNING: Could not download $arch. Build will skip this arch."
            return 1
        }
    }

    echo "  Extracting..."
    mkdir -p "$OUT_DIR/$arch"
    tar xzf "/tmp/$tarball" -C "$OUT_DIR/$arch" --strip-components=1 2>/dev/null || {
        # Try without strip-components
        tar xzf "/tmp/$tarball" -C "$OUT_DIR/$arch"
    }
    rm "/tmp/$tarball"
    echo "  Done: $arch"
}

echo "Downloading OpenSSL $OPENSSL_VERSION for Android..."
echo ""

download_arch "arm64-v8a"  "arm64-v8a"
download_arch "armeabi-v7a" "armeabi-v7a"
download_arch "x86"        "x86"
download_arch "x86_64"     "x86_64"

echo ""
echo "OpenSSL prebuilts downloaded to: $OUT_DIR"
ls "$OUT_DIR"
