

```
adb logcat -c
adb shell am force-stop com.networkspy.mobile
adb shell monkey -p com.networkspy.mobile 1
adb logcat --pid=$(adb shell pidof com.networkspy.mobile) | grep -i "anr\|fatal\|exception\|react\|js\|error\|timeout\|skipped"
```