PACKAGE = com.networkspy.vpntest
ACTIVITY = .MainActivity
APK = app/build/outputs/apk/debug/app-debug.apk

.PHONY: build install uninstall launch clean log

build:
	./gradlew :app:assembleDebug

install: build
	adb install -r $(APK)

uninstall:
	adb uninstall $(PACKAGE)

launch: install
	adb shell am start -n $(PACKAGE)/$(PACKAGE)$(ACTIVITY)
	@echo ""
	adb logcat -s vpn:V VpnTestService:V AndroidRuntime:E '*:F'

log:
	adb logcat -s vpn:V VpnTestService:V AndroidRuntime:E '*:F'

clean:
	./gradlew clean
