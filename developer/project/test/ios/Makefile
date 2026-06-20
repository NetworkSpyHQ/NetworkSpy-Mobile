SCHEME = PacketTunnel
APP_ID = com.networkspy.vpntest
PROJECT = VpnTest.xcodeproj
DEVICE_ID ?=
TEAM ?=
DEST ?= generic/platform=iOS
SIGN_FLAGS = CODE_SIGN_IDENTITY="iPhone Developer" CODE_SIGN_STYLE=Automatic
ifneq ($(TEAM),)
	SIGN_FLAGS += DEVELOPMENT_TEAM=$(TEAM)
endif
ifneq ($(DEVICE_ID),)
	DEST = id=$(DEVICE_ID)
endif

.PHONY: project build install launch log clean

project:
	xcodegen generate --spec project.yml

build: project
	xcodebuild -project $(PROJECT) -scheme $(SCHEME) -configuration Debug -destination "$(DEST)" build $(SIGN_FLAGS) 2>&1 | grep -E "^\\\\*\\\\*|error:|warning:|BUILD"

install: build
	ios-deploy --debug --bundle build/Debug-iphoneos/VpnTest.app

launch: install
	idevicesyslog --match vpn

log:
	idevicesyslog --match vpn

clean:
	rm -rf build VpnTest.xcodeproj
	rm -f VpnTest/VpnTest-Bridging-Header.h
	rm -f PacketTunnel/PacketTunnel-Bridging-Header.h
