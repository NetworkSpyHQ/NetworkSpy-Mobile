SCHEME = PacketTunnel
APP_ID = com.networkspy.vpntest
PROJECT = VpnTest.xcodeproj
TEAM ?=
SIGN_FLAGS = CODE_SIGN_IDENTITY="iPhone Developer" CODE_SIGN_STYLE=Automatic
ifneq ($(TEAM),)
	SIGN_FLAGS += DEVELOPMENT_TEAM=$(TEAM)
endif

.PHONY: project build install launch log clean

project:
	xcodegen generate --spec project.yml

build: project
	xcodebuild -project $(PROJECT) -scheme $(SCHEME) -configuration Debug -sdk iphoneos build $(SIGN_FLAGS)

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
