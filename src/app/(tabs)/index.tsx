import { useCallback, useEffect, useMemo, useState } from 'react';
import { useColorScheme } from 'react-native';
import {
  Modal,
  Platform,
  Pressable,
  SectionList,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import {
  Colors,
  MaxContentWidth,
  MethodColors,
  Spacing,
  getStatusColor,
} from '@/constants/theme';
import type { TrafficEntry } from '@/types/traffic';
import { startVpn, stopVpn, onTrafficCapture, onVpnStatus, onVpnError } from '@/native/VpnModule';
import { addCapturedEntry, getCapturedTraffic } from '@/data/captured-traffic';

function formatTime(ts: number): string {
  const date = new Date(ts);
  const now = new Date();
  const diffMin = Math.floor((now.getTime() - date.getTime()) / 60000);

  if (diffMin < 1 && date.getTime() > now.getTime() - 60000) return 'Just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const hours = Math.floor(diffMin / 60);
  if (hours < 24) return `${hours}h ago`;
  return date.toLocaleDateString();
}

function formatDuration(ms: number): string {
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`;
  return `${ms}ms`;
}

function formatSize(bytes: number): string {
  if (bytes >= 1024) {
    const kb = bytes / 1024;
    if (kb >= 1024) return `${(kb / 1024).toFixed(1)} MB`;
    return `${kb.toFixed(1)} KB`;
  }
  return `${bytes} B`;
}

function TrafficRow({ entry, hideHost }: { entry: TrafficEntry; hideHost?: boolean }) {
  const router = useRouter();
  const statusColor = getStatusColor(entry.statusCode);

  return (
    <Pressable
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
      onPress={() => router.push({ pathname: '/detail', params: { id: entry.id } })}
    >
      <View style={styles.rowLeft}>
        <View style={[styles.methodBadge, { backgroundColor: MethodColors[entry.method] ?? '#6B7280' }]}>
          <Text style={styles.methodText}>{entry.method}</Text>
        </View>
        <View style={styles.urlContainer}>
          {!hideHost && (
            <ThemedText style={styles.urlText} numberOfLines={1}>
              {entry.host}
            </ThemedText>
          )}
          <ThemedText style={styles.pathText} numberOfLines={2} themeColor="textSecondary">
            {entry.path}
          </ThemedText>
        </View>
      </View>
      <View style={styles.rowRight}>
        <View style={styles.statusRow}>
          {entry.statusCode > 0 && (
            <View style={[styles.statusBadge, { backgroundColor: statusColor }]}>
              <Text style={styles.statusText}>{entry.statusCode}</Text>
            </View>
          )}
          {entry.error && (
            <View style={[styles.statusBadge, { backgroundColor: statusColor }]}>
              <Text style={styles.statusText}>ERR</Text>
            </View>
          )}
        </View>
        <View style={styles.rowRightMeta}>
          <ThemedText style={styles.metaText} themeColor="textSecondary">
            {formatDuration(entry.duration)}
          </ThemedText>
          <ThemedText style={[styles.metaText, styles.metaDot]} themeColor="textSecondary">
            ·
          </ThemedText>
          <ThemedText style={styles.metaText} themeColor="textSecondary">
            {formatSize(entry.responseSize)}
          </ThemedText>
          <ThemedText style={[styles.metaText, styles.metaDot]} themeColor="textSecondary">
            ·
          </ThemedText>
          <ThemedText style={styles.metaText} themeColor="textSecondary">
            {formatTime(entry.timestamp)}
          </ThemedText>
        </View>
      </View>
    </Pressable>
  );
}

function groupByHost(entries: TrafficEntry[]): { title: string; data: TrafficEntry[] }[] {
  const map = new Map<string, TrafficEntry[]>();
  for (const entry of entries) {
    const list = map.get(entry.host) ?? [];
    list.push(entry);
    map.set(entry.host, list);
  }
  return Array.from(map.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([host, data]) => ({
      title: `${host} (${data.length})`,
      data,
    }));
}

function MenuSheet({
  visible,
  grouped,
  onClose,
  onToggleGrouped,
}: {
  visible: boolean;
  grouped: boolean;
  onClose: () => void;
  onToggleGrouped: () => void;
}) {
  const insets = useSafeAreaInsets();
  const scheme = useColorScheme();
  const colors = Colors[scheme === 'unspecified' ? 'light' : scheme];

  return (
    <Modal
      visible={visible}
      animationType="fade"
      transparent
      onRequestClose={onClose}
    >
      <Pressable style={styles.backdrop} onPress={onClose}>
        <View />
      </Pressable>

      <View style={[styles.sheet, { paddingBottom: insets.bottom + Spacing.three, backgroundColor: colors.background }]}>
        <View style={styles.sheetHandle} />

        <ThemedText type="smallBold" themeColor="textSecondary" style={styles.sheetLabel}>
          View
        </ThemedText>

        <Pressable
          style={({ pressed }) => [styles.sheetRow, pressed && styles.sheetRowPressed]}
          onPress={() => {
            if (grouped) onToggleGrouped();
            onClose();
          }}
        >
          <ThemedText>Flat</ThemedText>
          {!grouped && <Text style={styles.checkmark}>✓</Text>}
        </Pressable>

        <Pressable
          style={({ pressed }) => [styles.sheetRow, pressed && styles.sheetRowPressed]}
          onPress={() => {
            if (!grouped) onToggleGrouped();
            onClose();
          }}
        >
          <ThemedText>Group by host</ThemedText>
          {grouped && <Text style={styles.checkmark}>✓</Text>}
        </Pressable>
      </View>
    </Modal>
  );
}

export default function TrafficListScreen() {
  const [capturing, setCapturing] = useState(false);
  const [grouped, setGrouped] = useState(false);
  const [menuVisible, setMenuVisible] = useState(false);
  const [liveTraffic, setLiveTraffic] = useState<TrafficEntry[]>([]);
  const traffic = liveTraffic;

  const insets = useSafeAreaInsets();

  useEffect(() => {
    const unsubTraffic = onTrafficCapture((entry) => {
      addCapturedEntry(entry);
      setLiveTraffic(getCapturedTraffic());
    });
    const unsubStatus = onVpnStatus((status) => {
      setCapturing(status === 'started');
    });
    const unsubError = onVpnError((msg) => {
      console.warn('VPN error:', msg);
    });

    return () => {
      unsubTraffic();
      unsubStatus();
      unsubError();
    };
  }, []);

  const toggleCapture = useCallback(() => {
    if (capturing) {
      stopVpn();
      setCapturing(false);
    } else {
      startVpn();
    }
  }, [capturing]);

  const sections = useMemo(() => {
    if (grouped) return groupByHost(traffic);
    return [{ title: '', data: traffic }];
  }, [grouped, traffic]);

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={[styles.safeArea, { paddingBottom: insets.bottom + Spacing.three }]} edges={['top']}>
        <View style={styles.header}>
          <ThemedText type="subtitle">Traffic</ThemedText>
          <View style={styles.headerRight}>
            <ThemedText type="small" themeColor="textSecondary">
              {traffic.length}
            </ThemedText>
            <Pressable
              style={({ pressed }) => [
                styles.captureButton,
                capturing && styles.captureButtonActive,
                pressed && styles.captureButtonPressed,
              ]}
              onPress={toggleCapture}
            >
              <ThemedText
                type="smallBold"
                themeColor={capturing ? 'text' : 'textSecondary'}
              >
                {capturing ? '■ Stop' : '▶ Start'}
              </ThemedText>
            </Pressable>
            <Pressable
              style={({ pressed }) => [styles.menuButton, pressed && styles.menuButtonPressed]}
              onPress={() => setMenuVisible(true)}
            >
              <Text style={styles.menuDots}>⋮</Text>
            </Pressable>
          </View>
        </View>

        <SectionList
          sections={sections}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => <TrafficRow entry={item} hideHost={grouped} />}
          renderSectionHeader={({ section }) =>
            section.title ? (
              <ThemedView style={styles.sectionHeader}>
                <ThemedText type="smallBold">{section.title}</ThemedText>
              </ThemedView>
            ) : null
          }
          contentContainerStyle={styles.listContent}
          style={styles.list}
          ItemSeparatorComponent={Separator}
          showsVerticalScrollIndicator={false}
          stickySectionHeadersEnabled={false}
        />

        <MenuSheet
          visible={menuVisible}
          grouped={grouped}
          onClose={() => setMenuVisible(false)}
          onToggleGrouped={() => setGrouped((g) => !g)}
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
    gap: Spacing.two,
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
  captureButton: {
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.one,
    borderRadius: Spacing.one,
    backgroundColor: 'rgba(34, 197, 94, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(34, 197, 94, 0.3)',
  },
  captureButtonActive: {
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    borderColor: 'rgba(239, 68, 68, 0.3)',
  },
  captureButtonPressed: {
    opacity: 0.7,
  },
  list: {
    flex: 1,
  },
  listContent: {
    paddingBottom: 0,
  },
  sectionHeader: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    marginTop: Spacing.two,
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
  rowRight: {
    alignItems: 'flex-end',
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
  urlContainer: {
    flex: 1,
  },
  urlText: {
    fontSize: 14,
    fontWeight: '600',
  },
  pathText: {
    fontSize: 12,
    marginTop: 1,
  },
  statusBadge: {
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 3,
  },
  statusText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '700',
    fontFamily: Platform.select({ ios: 'ui-monospace', default: 'monospace' }),
  },
  statusRow: {
    flexDirection: 'row',
    gap: 4,
  },
  metaText: {
    fontSize: 11,
  },
  metaDot: {
    marginHorizontal: 2,
  },
  rowRightMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 0,
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    marginLeft: Spacing.three,
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
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.two,
    borderRadius: Spacing.two,
  },
  sheetRowPressed: {
    backgroundColor: 'rgba(128, 128, 128, 0.1)',
  },
  checkmark: {
    fontSize: 16,
    color: '#3B82F6',
    fontWeight: '600',
  },
});
