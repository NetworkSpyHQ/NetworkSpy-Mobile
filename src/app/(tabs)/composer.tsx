import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Modal, Platform, Pressable, SectionList, StyleSheet, Text, View, useColorScheme } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { fetch } from 'react-native-nitro-fetch';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { getComposes } from '@/data/compose-store';
import {
  BottomTabInset,
  Colors,
  MaxContentWidth,
  MethodColors,
  Spacing,
} from '@/constants/theme';
import type { ComposeEntry } from '@/types/traffic';

function ComposeRow({ entry, asyncMode, onFire }: { entry: ComposeEntry; asyncMode: boolean; onFire: () => void }) {
  const router = useRouter();
  const [sending, setSending] = useState(false);
  const [lastResult, setLastResult] = useState<{ code: number } | null>(null);

  const sendRequest = useCallback(async () => {
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
    return fetch(url, opts);
  }, [entry]);

  const handleSend = async () => {
    if (asyncMode) {
      sendRequest();
      onFire();
      return;
    }
    setSending(true);
    setLastResult(null);
    try {
      const res = await sendRequest();
      setLastResult({ code: res.status });
    } catch {
      setLastResult({ code: 0 });
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
          <Pressable
            onPress={(e) => { e.stopPropagation(); setLastResult(null); }}
            style={[
              styles.resultButton,
              { backgroundColor: lastResult.code === 0 ? '#EF4444' : lastResult.code >= 400 ? '#F59E0B' : '#22C55E' },
            ]}
          >
            <ThemedText
              type="small"
              style={{
                color: '#FFFFFF',
                fontFamily: Platform.select({ ios: 'ui-monospace', default: 'monospace' }),
                fontWeight: '700',
              }}
            >
              {lastResult.code || 'ERR'}
            </ThemedText>
          </Pressable>
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

function SettingsSheet({
  visible,
  asyncMode,
  onClose,
  onToggleAsync,
}: {
  visible: boolean;
  asyncMode: boolean;
  onClose: () => void;
  onToggleAsync: () => void;
}) {
  const scheme = useColorScheme();
  const colors = Colors[scheme === 'unspecified' ? 'light' : scheme];

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <View />
      </Pressable>
      <View style={[styles.sheet, { backgroundColor: colors.background }]}>
        <View style={styles.sheetHandle} />
        <ThemedText type="smallBold" themeColor="textSecondary" style={styles.sheetLabel}>
          Send Mode
        </ThemedText>
        <Pressable
          style={({ pressed }) => [styles.sheetRow, pressed && styles.sheetRowPressed]}
          onPress={() => { if (asyncMode) onToggleAsync(); onClose(); }}
        >
          <View style={styles.sheetRowContent}>
            <View>
              <ThemedText>Wait for response</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">Show status code after request</ThemedText>
            </View>
            {!asyncMode && <Text style={styles.checkmark}>✓</Text>}
          </View>
        </Pressable>
        <Pressable
          style={({ pressed }) => [styles.sheetRow, pressed && styles.sheetRowPressed]}
          onPress={() => { if (!asyncMode) onToggleAsync(); onClose(); }}
        >
          <View style={styles.sheetRowContent}>
            <View>
              <ThemedText>Fire & forget</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">Send without waiting — spam OK</ThemedText>
            </View>
            {asyncMode && <Text style={styles.checkmark}>✓</Text>}
          </View>
        </Pressable>
      </View>
    </Modal>
  );
}

export default function ComposerListScreen() {
  const composes = useMemo(() => getComposes(), []);
  const router = useRouter();
  const [asyncMode, setAsyncMode] = useState(false);
  const [menuVisible, setMenuVisible] = useState(false);
  const [fireCount, setFireCount] = useState(0);

  const handleFire = useCallback(() => {
    setFireCount(c => c + 1);
  }, []);

  const sections = useMemo(() => {
    if (composes.length === 0) return [];
    return [{ title: '', data: composes }];
  }, [composes]);

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <View style={styles.header}>
          <ThemedText type="subtitle">Composer</ThemedText>
          <View style={styles.headerRight}>
            <Pressable
              style={({ pressed }) => [styles.addButton, pressed && styles.addButtonPressed]}
              onPress={() => router.push({ pathname: '/composer-detail', params: { id: 'new' } })}
            >
              <Text style={styles.addButtonText}>+</Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [styles.menuButton, pressed && styles.menuButtonPressed]}
              onPress={() => setMenuVisible(true)}
            >
              <Text style={styles.menuDots}>⋮</Text>
            </Pressable>
          </View>
        </View>

        {asyncMode && fireCount > 0 && (
          <Pressable style={styles.toastBanner} onPress={() => setFireCount(0)}>
            <ThemedText type="small" style={{ color: '#F59E0B' }}>
              ⚡ {fireCount} request{fireCount > 1 ? 's' : ''} fired
            </ThemedText>
          </Pressable>
        )}

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
            renderItem={({ item }) => <ComposeRow entry={item} asyncMode={asyncMode} onFire={handleFire} />}
            contentContainerStyle={styles.listContent}
            style={styles.list}
            ItemSeparatorComponent={Separator}
            showsVerticalScrollIndicator={false}
            stickySectionHeadersEnabled={false}
          />
        )}

        <SettingsSheet
          visible={menuVisible}
          asyncMode={asyncMode}
          onClose={() => setMenuVisible(false)}
          onToggleAsync={() => setAsyncMode(a => !a)}
        />
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
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
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
  menuButton: {
    paddingHorizontal: Spacing.one,
    paddingVertical: Spacing.one,
    borderRadius: Spacing.one,
  },
  menuButtonPressed: {
    opacity: 0.5,
  },
  menuDots: {
    fontSize: 20,
    fontWeight: '700',
    color: '#6B7280',
    letterSpacing: 1,
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
  resultButton: {
    alignSelf: 'stretch',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: Spacing.two + 2,
    marginVertical: -Spacing.two - 2,
    marginRight: -Spacing.three,
    borderTopLeftRadius: Spacing.two,
    borderBottomLeftRadius: Spacing.two,
    minWidth: 48,
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
  toastBanner: {
    marginHorizontal: Spacing.three,
    marginBottom: Spacing.two,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
    borderRadius: Spacing.two,
    backgroundColor: 'rgba(245, 158, 11, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(245, 158, 11, 0.2)',
    alignItems: 'center',
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.three,
  },
  backdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.3)',
  },
  sheet: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.two,
    paddingBottom: Spacing.five,
  },
  sheetHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#D1D5DB',
    alignSelf: 'center',
    marginBottom: Spacing.three,
  },
  sheetLabel: {
    marginBottom: Spacing.two,
    paddingHorizontal: Spacing.one,
  },
  sheetRow: {
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.two,
    borderRadius: Spacing.two,
  },
  sheetRowPressed: {
    backgroundColor: 'rgba(128, 128, 128, 0.1)',
  },
  sheetRowContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  checkmark: {
    fontSize: 16,
    color: '#3B82F6',
    fontWeight: '600',
  },
});
