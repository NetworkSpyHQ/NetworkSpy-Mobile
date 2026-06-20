import { ScrollView, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';

export default function SetupGuideScreen() {
  const router = useRouter();

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <View style={styles.navBar}>
          <ThemedText type="linkPrimary" style={styles.backButton} onPress={() => router.back()}>
            ← Settings
          </ThemedText>
        </View>

        <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
          <ThemedText type="subtitle" style={styles.title}>
            How to Setup
          </ThemedText>

          <ThemedView type="backgroundElement" style={styles.stepCard}>
            <View style={styles.stepHeader}>
              <View style={styles.stepNumber}>
                <ThemedText type="smallBold" style={{ color: '#FFFFFF' }}>1</ThemedText>
              </View>
              <ThemedText type="smallBold">Install NetworkSpy</ThemedText>
            </View>
            <ThemedText type="small" themeColor="textSecondary">
              Download and install the app from your device's app store.
            </ThemedText>
          </ThemedView>

          <ThemedView type="backgroundElement" style={styles.stepCard}>
            <View style={styles.stepHeader}>
              <View style={styles.stepNumber}>
                <ThemedText type="smallBold" style={{ color: '#FFFFFF' }}>2</ThemedText>
              </View>
              <ThemedText type="smallBold">Enable VPN Profile</ThemedText>
            </View>
            <ThemedText type="small" themeColor="textSecondary">
              Open the app and allow the VPN configuration profile. This routes your traffic through NetworkSpy for capture.
            </ThemedText>
          </ThemedView>

          <ThemedView type="backgroundElement" style={styles.stepCard}>
            <View style={styles.stepHeader}>
              <View style={styles.stepNumber}>
                <ThemedText type="smallBold" style={{ color: '#FFFFFF' }}>3</ThemedText>
              </View>
              <ThemedText type="smallBold">Install Certificate</ThemedText>
            </View>
            <ThemedText type="small" themeColor="textSecondary">
              Install the CA certificate to decrypt HTTPS traffic. Go to Certificates in App Settings for detailed instructions.
            </ThemedText>
          </ThemedView>

          <ThemedView type="backgroundElement" style={styles.stepCard}>
            <View style={styles.stepHeader}>
              <View style={styles.stepNumber}>
                <ThemedText type="smallBold" style={{ color: '#FFFFFF' }}>4</ThemedText>
              </View>
              <ThemedText type="smallBold">Start Capturing</ThemedText>
            </View>
            <ThemedText type="small" themeColor="textSecondary">
              Tap the capture button on the Traffic tab to start intercepting network requests from your device.
            </ThemedText>
          </ThemedView>
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, flexDirection: 'row', justifyContent: 'center' },
  safeArea: { flex: 1 },
  navBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  backButton: { paddingVertical: 4 },
  scrollContent: { paddingHorizontal: Spacing.three, paddingBottom: Spacing.six },
  title: { paddingVertical: Spacing.two },
  stepCard: {
    borderRadius: Spacing.two,
    padding: Spacing.three,
    marginTop: Spacing.two,
    gap: Spacing.two,
  },
  stepHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  stepNumber: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#3B82F6',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
