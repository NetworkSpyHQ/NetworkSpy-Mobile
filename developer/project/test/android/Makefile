PACKAGE = com.networkspy.vpntest
ACTIVITY = .MainActivity
APK = app/build/outputs/apk/debug/app-debug.apk

.PHONY: build install launch clean log

build:
	./gradlew :app:assembleDebug

install: build
	adb install -r $(APK)

launch: install
	adb shell am start -n $(PACKAGE)/$(PACKAGE)$(ACTIVITY)
	@echo ""
	adb logcat -s vpn:V VpnTestService:V AndroidRuntime:E '*:F'

log:
	adb logcat -s vpn:V VpnTestService:V AndroidRuntime:E '*:F'

clean:
	./gradlew clean
