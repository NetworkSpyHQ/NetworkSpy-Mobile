import { Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';

export default function CertificatesScreen() {
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
            Certificates
          </ThemedText>

          <ThemedView type="backgroundElement" style={styles.card}>
            <ThemedText type="smallBold">CA Certificate</ThemedText>
            <ThemedText type="small" themeColor="textSecondary" style={styles.hint}>
              Install the CA certificate on your device to inspect HTTPS traffic. This allows NetworkSpy to decrypt and display encrypted requests.
            </ThemedText>
          </ThemedView>

          <ThemedView type="backgroundElement" style={styles.card}>
            <ThemedText type="smallBold">iOS</ThemedText>
            <ThemedText type="small" themeColor="textSecondary" style={styles.hint}>
              1. Download the certificate profile{'\n'}
              2. Go to Settings → General → VPN & Device Management{'\n'}
              3. Install the NetworkSpy profile{'\n'}
              4. Go to Settings → General → About → Certificate Trust Settings{'\n'}
              5. Enable full trust for the NetworkSpy certificate
            </ThemedText>
          </ThemedView>

          <ThemedView type="backgroundElement" style={styles.card}>
            <ThemedText type="smallBold">Android</ThemedText>
            <ThemedText type="small" themeColor="textSecondary" style={styles.hint}>
              1. Download the certificate file{'\n'}
              2. Go to Settings → Security → Encryption & credentials{'\n'}
              3. Install from device storage{'\n'}
              4. Select the NetworkSpy certificate
            </ThemedText>
          </ThemedView>

          <ThemedView type="backgroundElement" style={styles.card}>
            <ThemedText type="smallBold">Download Certificate</ThemedText>
            <ThemedText type="small" themeColor="textSecondary" style={styles.hint}>
              Certificate installation will be available when VPN capture is active.
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
  card: {
    borderRadius: Spacing.two,
    padding: Spacing.three,
    marginTop: Spacing.two,
    gap: Spacing.one,
  },
  hint: { marginTop: 2 },
});
