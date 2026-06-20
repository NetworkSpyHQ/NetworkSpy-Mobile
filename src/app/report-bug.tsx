import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useState } from 'react';

export default function ReportBugScreen() {
  const router = useRouter();
  const [description, setDescription] = useState('');

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
            Report Bug
          </ThemedText>

          <ThemedView type="backgroundElement" style={styles.card}>
            <ThemedText type="smallBold">Describe the issue</ThemedText>
            <ThemedText type="small" themeColor="textSecondary" style={styles.hint}>
              Please include steps to reproduce, expected behavior, and what actually happened.
            </ThemedText>
            <TextInput
              style={styles.textInput}
              placeholder="What went wrong?"
              placeholderTextColor="#9CA3AF"
              value={description}
              onChangeText={setDescription}
              multiline
              textAlignVertical="top"
              numberOfLines={6}
            />
          </ThemedView>

          <Pressable
            style={({ pressed }) => [
              styles.submitButton,
              pressed && styles.submitButtonPressed,
            ]}
          >
            <ThemedText style={{ color: '#FFFFFF' }} type="smallBold">
              Submit Report
            </ThemedText>
          </Pressable>
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
  textInput: {
    marginTop: Spacing.two,
    minHeight: 120,
    fontSize: 14,
    padding: Spacing.two,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#D1D5DB',
    borderRadius: Spacing.two,
    color: '#000',
  },
  submitButton: {
    marginTop: Spacing.three,
    paddingVertical: Spacing.three,
    borderRadius: Spacing.two,
    backgroundColor: '#3B82F6',
    alignItems: 'center',
  },
  submitButtonPressed: {
    opacity: 0.8,
  },
});
