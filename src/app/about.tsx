import { ScrollView, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';

export default function AboutScreen() {
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
            About
          </ThemedText>

          <ThemedView type="backgroundElement" style={styles.hero}>
            <ThemedText type="subtitle">NetworkSpy</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              Version 1.0.0
            </ThemedText>
          </ThemedView>

          <ThemedView type="backgroundElement" style={styles.card}>
            <ThemedText type="smallBold">What is NetworkSpy?</ThemedText>
            <ThemedText type="small" themeColor="textSecondary" style={styles.hint}>
              NetworkSpy is a network debugging tool for mobile devices. It captures HTTP traffic, lets you inspect requests and responses, and compose custom API calls — all from your phone.
            </ThemedText>
          </ThemedView>

          <ThemedView type="backgroundElement" style={styles.card}>
            <ThemedText type="smallBold">Tech Stack</ThemedText>
            <ThemedText type="small" themeColor="textSecondary" style={styles.hint}>
              Built with Expo, React Native, and TypeScript. Uses a local VPN service to intercept network traffic for inspection.
            </ThemedText>
          </ThemedView>

          <ThemedView type="backgroundElement" style={styles.card}>
            <ThemedText type="smallBold">Licenses</ThemedText>
            <ThemedText type="small" themeColor="textSecondary" style={styles.hint}>
              Open source software licenses for third-party libraries used in this app are available upon request.
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
  hero: {
    borderRadius: Spacing.two,
    padding: Spacing.four,
    alignItems: 'center',
    gap: Spacing.one,
    marginTop: Spacing.two,
  },
  card: {
    borderRadius: Spacing.two,
    padding: Spacing.three,
    marginTop: Spacing.two,
    gap: Spacing.one,
  },
  hint: { marginTop: 2 },
});
