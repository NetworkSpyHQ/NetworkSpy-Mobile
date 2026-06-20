import { ScrollView, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';

export default function SupportScreen() {
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
            Support
          </ThemedText>

          <ThemedView type="backgroundElement" style={styles.card}>
            <ThemedText type="smallBold">Need help?</ThemedText>
            <ThemedText type="small" themeColor="textSecondary" style={styles.hint}>
              We're here to help you get the most out of NetworkSpy.
            </ThemedText>
          </ThemedView>

          <ThemedView type="backgroundElement" style={styles.card}>
            <ThemedText type="smallBold">Documentation</ThemedText>
            <ThemedText type="small" themeColor="textSecondary" style={styles.hint}>
              Visit our documentation for guides, FAQs, and troubleshooting tips.
            </ThemedText>
          </ThemedView>

          <ThemedView type="backgroundElement" style={styles.card}>
            <ThemedText type="smallBold">Contact Us</ThemedText>
            <ThemedText type="small" themeColor="textSecondary" style={styles.hint}>
              Email: support@networkspy.app{'\n'}
              Response time: within 24 hours
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
