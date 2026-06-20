import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <ThemedText type="smallBold" themeColor="textSecondary" style={styles.sectionTitle}>
        {title}
      </ThemedText>
      <ThemedView type="backgroundElement" style={styles.sectionCard}>
        {children}
      </ThemedView>
    </View>
  );
}

function Row({
  label,
  hint,
  last,
  disabled,
  onPress,
}: {
  label: string;
  hint?: string;
  last?: boolean;
  disabled?: boolean;
  onPress?: () => void;
}) {
  return (
    <Pressable
      style={({ pressed }) => [
        styles.row,
        !last && styles.rowBorder,
        disabled && styles.rowDisabled,
        pressed && styles.rowPressed,
      ]}
      onPress={onPress}
      disabled={disabled}
    >
      <View style={styles.rowContent}>
        <ThemedText type="small">{label}</ThemedText>
        {hint && (
          <ThemedText type="small" themeColor="textSecondary" style={styles.rowHint}>
            {hint}
          </ThemedText>
        )}
      </View>
      <ThemedText themeColor="textSecondary" style={styles.chevron}>
        ›
      </ThemedText>
    </Pressable>
  );
}

export default function SettingsScreen() {
  const insets = useSafeAreaInsets();

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView
        style={[styles.safeArea, { paddingBottom: insets.bottom + Spacing.three }]}
        edges={['top']}
      >
        <ThemedText type="subtitle" style={styles.title}>
          Settings
        </ThemedText>

        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.scrollContent}
        >
          <Section title="App Settings">
            <Row
              label="Certificates"
              hint="Install CA certificate for HTTPS inspection"
              disabled
            />
            <Row label="Manage Subscriptions" last disabled />
          </Section>

          <Section title="Help">
            <Row
              label="How to Setup"
              hint="Configure your device for traffic capture"
              disabled
            />
            <Row label="Support" last disabled />
          </Section>

          <Section title="About">
            <Row label="Report Bug" disabled />
            <Row label="About" hint="Version 1.0.0" last />
          </Section>
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'center',
  },
  safeArea: {
    flex: 1,
    maxWidth: MaxContentWidth,
  },
  title: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  scrollContent: {
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.three,
  },
  section: {
    marginBottom: Spacing.three,
  },
  sectionTitle: {
    marginBottom: Spacing.two,
    paddingHorizontal: Spacing.one,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  sectionCard: {
    borderRadius: Spacing.two,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.three,
  },
  rowBorder: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(128, 128, 128, 0.2)',
  },
  rowDisabled: {
    opacity: 0.5,
  },
  rowPressed: {
    backgroundColor: 'rgba(128, 128, 128, 0.1)',
  },
  rowContent: {
    flex: 1,
    gap: 2,
  },
  rowHint: {
    marginTop: 2,
  },
  chevron: {
    fontSize: 20,
    marginLeft: Spacing.two,
  },
});
