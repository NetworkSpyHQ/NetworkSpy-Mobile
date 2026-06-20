import { useMemo, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, SectionList, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { fetch } from 'react-native-nitro-fetch';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { getComposes } from '@/data/compose-store';
import {
  BottomTabInset,
  MaxContentWidth,
  MethodColors,
  Spacing,
} from '@/constants/theme';
import type { ComposeEntry } from '@/types/traffic';

function ComposeRow({ entry }: { entry: ComposeEntry }) {
  const router = useRouter();
  const [sending, setSending] = useState(false);
  const [lastResult, setLastResult] = useState<{ code: number; error?: string } | null>(null);

  const handleSend = async () => {
    setSending(true);
    setLastResult(null);
    try {
      let url = entry.url.trim();
      if (!url.startsWith('http://') && !url.startsWith('https://')) {
        url = `https://${url}`;
      }
      const headers: Record<string, string> = {};
      for (const [k, v] of entry.headers) {
        if (k.trim()) headers[k.trim()] = v;
      }
      const opts: RequestInit = { method: entry.method, headers };
      if (entry.body && entry.method !== 'GET' && entry.method !== 'HEAD') {
        opts.body = entry.body;
      }
      const res = await fetch(url, opts);
      setLastResult({ code: res.status });
    } catch (e: any) {
      setLastResult({ code: 0, error: e.message });
    } finally {
      setSending(false);
    }
  };

  return (
    <Pressable
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
      onPress={() =>
        router.push({ pathname: '/composer-detail', params: { id: entry.id } })
      }
    >
      <View style={styles.rowLeft}>
        <View
          style={[
            styles.methodBadge,
            { backgroundColor: MethodColors[entry.method] ?? '#6B7280' },
          ]}
        >
          <Text style={styles.methodText}>{entry.method}</Text>
        </View>
        <View style={styles.rowTextContainer}>
          <ThemedText style={styles.nameText} numberOfLines={1}>
            {entry.name}
          </ThemedText>
          <ThemedText
            style={styles.urlText}
            numberOfLines={1}
            themeColor="textSecondary"
          >
            {entry.url}
          </ThemedText>
        </View>
      </View>
      <View style={styles.rowRight}>
        {sending ? (
          <ActivityIndicator size="small" color="#3B82F6" />
        ) : lastResult ? (
          <ThemedText
            type="small"
            themeColor={lastResult.code > 0 ? (lastResult.code < 400 ? 'textSecondary' : 'textSecondary') : 'textSecondary'}
            style={{ color: lastResult.code === 0 ? '#EF4444' : lastResult.code >= 400 ? '#F59E0B' : '#22C55E' }}
          >
            {lastResult.code || 'ERR'}
          </ThemedText>
        ) : (
          <Pressable
            style={({ pressed }) => [styles.playButton, pressed && styles.playButtonPressed]}
            onPress={(e) => { e.stopPropagation(); handleSend(); }}
            hitSlop={8}
          >
            <Text style={styles.playButtonText}>▶</Text>
          </Pressable>
        )}
      </View>
    </Pressable>
  );
}

export default function ComposerListScreen() {
  const composes = useMemo(() => getComposes(), []);
  const router = useRouter();

  const sections = useMemo(() => {
    if (composes.length === 0) return [];
    return [{ title: '', data: composes }];
  }, [composes]);

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <View style={styles.header}>
          <ThemedText type="subtitle">Composer</ThemedText>
          <Pressable
            style={({ pressed }) => [styles.addButton, pressed && styles.addButtonPressed]}
            onPress={() => router.push({ pathname: '/composer-detail', params: { id: 'new' } })}
          >
            <Text style={styles.addButtonText}>+</Text>
          </Pressable>
        </View>

        {composes.length === 0 ? (
          <View style={styles.emptyState}>
            <ThemedText themeColor="textSecondary">
              No saved requests. Tap + to create one.
            </ThemedText>
          </View>
        ) : (
          <SectionList
            sections={sections}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => <ComposeRow entry={item} />}
            contentContainerStyle={styles.listContent}
            style={styles.list}
            ItemSeparatorComponent={Separator}
            showsVerticalScrollIndicator={false}
            stickySectionHeadersEnabled={false}
          />
        )}
      </SafeAreaView>
    </ThemedView>
  );
}

function Separator() {
  return <ThemedView style={styles.separator} type="backgroundElement" />;
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
    paddingBottom: BottomTabInset,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  addButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#3B82F6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  addButtonPressed: {
    opacity: 0.7,
  },
  addButtonText: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: '600',
    lineHeight: 22,
  },
  list: {
    flex: 1,
  },
  listContent: {
    paddingBottom: Spacing.three,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two + 2,
    gap: Spacing.two,
  },
  rowPressed: {
    opacity: 0.7,
  },
  rowLeft: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  rowTextContainer: {
    flex: 1,
    gap: 2,
  },
  methodBadge: {
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 4,
    minWidth: 52,
    alignItems: 'center',
  },
  methodText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '700',
    fontFamily: Platform.select({ ios: 'ui-monospace', default: 'monospace' }),
    letterSpacing: 0.5,
  },
  rowRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  playButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#3B82F6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  playButtonPressed: {
    opacity: 0.7,
  },
  playButtonText: {
    color: '#FFFFFF',
    fontSize: 13,
    marginLeft: 2,
  },
  nameText: {
    fontSize: 14,
    fontWeight: '600',
  },
  urlText: {
    fontSize: 12,
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    marginLeft: Spacing.three,
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.three,
  },
});
