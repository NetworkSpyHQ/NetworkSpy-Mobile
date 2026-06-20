import { ScrollView, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';

function TierCard({
  name,
  price,
  features,
  current,
}: {
  name: string;
  price: string;
  features: string[];
  current?: boolean;
}) {
  return (
    <ThemedView
      type="backgroundElement"
      style={[styles.tierCard, current && styles.tierCardCurrent]}
    >
      <View style={styles.tierHeader}>
        <ThemedText type="smallBold">{name}</ThemedText>
        {current && (
          <ThemedView style={styles.currentBadge}>
            <ThemedText type="small" style={{ color: '#3B82F6' }}>Current</ThemedText>
          </ThemedView>
        )}
      </View>
      <ThemedText type="subtitle" style={styles.price}>
        {price}
      </ThemedText>
      {features.map((f, i) => (
        <ThemedText key={i} type="small" themeColor="textSecondary" style={styles.feature}>
          • {f}
        </ThemedText>
      ))}
    </ThemedView>
  );
}

export default function SubscriptionsScreen() {
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
            Manage Subscriptions
          </ThemedText>

          <TierCard
            name="Free"
            price="$0"
            current
            features={[
              'View captured traffic',
              'Basic request details',
              'Export as cURL',
            ]}
          />

          <TierCard
            name="Pro"
            price="$4.99/mo"
            features={[
              'Everything in Free',
              'HTTPS decryption',
              'Custom filters',
              'Export as HAR / JSON',
              'Request composer',
              'Priority support',
            ]}
          />
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
  tierCard: {
    borderRadius: Spacing.two,
    padding: Spacing.three,
    marginTop: Spacing.two,
    gap: Spacing.one,
  },
  tierCardCurrent: {
    borderWidth: 2,
    borderColor: '#3B82F6',
  },
  tierHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  currentBadge: {
    paddingHorizontal: Spacing.two,
    paddingVertical: 2,
    borderRadius: Spacing.two,
    backgroundColor: 'rgba(59, 130, 246, 0.1)',
  },
  price: {
    fontSize: 28,
    marginTop: Spacing.one,
  },
  feature: {
    marginTop: 2,
  },
});
