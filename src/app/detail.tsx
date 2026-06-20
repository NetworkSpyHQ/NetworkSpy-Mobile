import { useState } from 'react';
import { Alert, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View, useColorScheme } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Collapsible } from '@/components/ui/collapsible';
import { Colors, MethodColors, Spacing, getStatusColor } from '@/constants/theme';
import { getEntryById } from '@/data/mock-traffic';
import { saveCompose, generateId } from '@/data/compose-store';
import type { TrafficEntry } from '@/types/traffic';

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

function KeyValueRow({ name, value, last }: { name: string; value: string; last?: boolean }) {
  const handleCopy = async () => {
    await Clipboard.setStringAsync(`${name}: ${value}`);
    Alert.alert('Copied', `${name} copied to clipboard`);
  };

  return (
    <Pressable
      onPress={handleCopy}
      style={({ pressed }) => [styles.kvRow, pressed && styles.kvRowPressed, last && styles.kvRowLast]}
    >
      <ThemedText type="code" themeColor="textSecondary" style={styles.kvName}>
        {name}
      </ThemedText>
      <ThemedText type="code" style={styles.kvValue} selectable numberOfLines={3}>
        {value}
      </ThemedText>
    </Pressable>
  );
}

function BodyContent({ body }: { body: string | null }) {
  if (!body) {
    return (
      <ThemedView style={styles.bodyEmpty}>
        <ThemedText type="small" themeColor="textSecondary">No body</ThemedText>
      </ThemedView>
    );
  }

  return (
    <ThemedView type="backgroundElement" style={styles.bodyContainer}>
      <ThemedText type="code" style={styles.bodyText} selectable>
        {body}
      </ThemedText>
    </ThemedView>
  );
}

function buildCurl(entry: TrafficEntry): string {
  const parts: string[] = ['curl'];
  if (entry.method !== 'GET') {
    parts.push(`-X ${entry.method}`);
  }
  parts.push(`'${entry.url}'`);
  for (const [key, value] of Object.entries(entry.requestHeaders)) {
    if (key.toLowerCase() === 'host') continue;
    parts.push(`-H '${key}: ${value}'`);
  }
  if (entry.requestBody) {
    parts.push(`-d '${entry.requestBody.replace(/'/g, "\\'")}'`);
  }
  return parts.join(' \\\n  ');
}

function ActionSheet({
  visible,
  onClose,
  onCopyCurl,
  onCreateCompose,
}: {
  visible: boolean;
  onClose: () => void;
  onCopyCurl: () => void;
  onCreateCompose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const scheme = useColorScheme();
  const colors = Colors[scheme === 'unspecified' ? 'light' : scheme];

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onClose}>
      <Pressable style={sheetStyles.backdrop} onPress={onClose}>
        <View />
      </Pressable>
      <View style={[sheetStyles.sheet, { paddingBottom: insets.bottom + Spacing.three, backgroundColor: colors.background }]}>
        <View style={sheetStyles.handle} />
        <Pressable style={({ pressed }) => [sheetStyles.row, pressed && sheetStyles.rowPressed]} onPress={onCreateCompose}>
          <ThemedText>Create Compose</ThemedText>
        </Pressable>
        <Pressable style={({ pressed }) => [sheetStyles.row, pressed && sheetStyles.rowPressed]} onPress={onCopyCurl}>
          <ThemedText>Copy as cURL</ThemedText>
        </Pressable>
      </View>
    </Modal>
  );
}

type Tab = 'request' | 'response';

export default function DetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const entry = getEntryById(id ?? '');
  const [activeTab, setActiveTab] = useState<Tab>('request');
  const [menuVisible, setMenuVisible] = useState(false);

  if (!entry) {
    return (
      <ThemedView style={styles.container}>
        <SafeAreaView style={styles.safeArea}>
          <ThemedText style={styles.notFound}>Request not found</ThemedText>
        </SafeAreaView>
      </ThemedView>
    );
  }

  const statusColor = getStatusColor(entry.statusCode);
  const date = new Date(entry.timestamp);

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.navBar}>
          <ThemedText type="linkPrimary" style={styles.backButton} onPress={() => router.back()}>
            ← Traffic
          </ThemedText>
          <Pressable
            style={({ pressed }) => [styles.menuButton, pressed && styles.menuButtonPressed]}
            onPress={() => setMenuVisible(true)}
          >
            <Text style={styles.menuDots}>⋮</Text>
          </Pressable>
        </View>

        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          <ThemedView style={styles.infoCard}>
            <View style={styles.methodRow}>
              <View style={[styles.methodBadge, { backgroundColor: MethodColors[entry.method] ?? '#6B7280' }]}>
                <Text style={styles.methodText}>{entry.method}</Text>
              </View>
              <ThemedText style={styles.hostText} numberOfLines={1}>
                {entry.host}
              </ThemedText>
            </View>

            <ThemedText type="code" themeColor="textSecondary" style={styles.pathText} selectable>
              {entry.path}
            </ThemedText>

            <View style={styles.infoGrid}>
              <View style={styles.infoCell}>
                <ThemedText type="small" themeColor="textSecondary">Status</ThemedText>
                {entry.error ? (
                  <ThemedText type="smallBold" style={{ color: statusColor }}>Error</ThemedText>
                ) : (
                  <View style={[styles.statusBadge, { backgroundColor: statusColor }]}>
                    <Text style={styles.statusText}>{entry.statusCode}</Text>
                  </View>
                )}
              </View>
              <View style={styles.infoCell}>
                <ThemedText type="small" themeColor="textSecondary">Duration</ThemedText>
                <ThemedText type="smallBold">{formatDuration(entry.duration)}</ThemedText>
              </View>
              <View style={styles.infoCell}>
                <ThemedText type="small" themeColor="textSecondary">Size</ThemedText>
                <ThemedText type="smallBold">{formatSize(entry.responseSize)}</ThemedText>
              </View>
              <View style={styles.infoCell}>
                <ThemedText type="small" themeColor="textSecondary">Secure</ThemedText>
                <ThemedText type="smallBold">{entry.isSecure ? 'HTTPS' : 'HTTP'}</ThemedText>
              </View>
              {entry.contentType && (
                <View style={styles.infoCell}>
                  <ThemedText type="small" themeColor="textSecondary">Type</ThemedText>
                  <ThemedText type="smallBold" numberOfLines={1}>
                    {entry.contentType.split(';')[0]}
                  </ThemedText>
                </View>
              )}
              <View style={styles.infoCell}>
                <ThemedText type="small" themeColor="textSecondary">Time</ThemedText>
                <ThemedText type="smallBold">
                  {date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                </ThemedText>
              </View>
            </View>

            {entry.error && (
              <ThemedView style={styles.errorBox}>
                <ThemedText type="small" style={{ color: '#EF4444' }}>{entry.error}</ThemedText>
              </ThemedView>
            )}
          </ThemedView>

          <View style={styles.tabBar}>
            <View style={styles.tabWrapper}>
              <Pressable
                style={[styles.tab, activeTab === 'request' && styles.tabActive]}
                onPress={() => setActiveTab('request')}
              >
                <ThemedText type="smallBold" themeColor={activeTab === 'request' ? 'text' : 'textSecondary'}>
                  Request
                </ThemedText>
              </Pressable>
            </View>
            <View style={styles.tabWrapper}>
              <Pressable
                style={[styles.tab, activeTab === 'response' && styles.tabActive]}
                onPress={() => setActiveTab('response')}
              >
                <ThemedText type="smallBold" themeColor={activeTab === 'response' ? 'text' : 'textSecondary'}>
                  Response
                </ThemedText>
              </Pressable>
            </View>
          </View>

          {activeTab === 'request' && (
            <View style={styles.tabSection}>
              <Collapsible title="Headers" defaultOpen compact>
                {Object.entries(entry.requestHeaders).length === 0 ? (
                  <ThemedText type="small" themeColor="textSecondary" style={styles.emptyText}>
                    No request headers
                  </ThemedText>
                ) : (
                  Object.entries(entry.requestHeaders).map(([key, value], idx, arr) => (
                    <KeyValueRow key={key} name={key} value={value} last={idx === arr.length - 1} />
                  ))
                )}
              </Collapsible>

              <Collapsible title="Body" defaultOpen compact>
                <BodyContent body={entry.requestBody} />
              </Collapsible>
            </View>
          )}

          {activeTab === 'response' && (
            <View style={styles.tabSection}>
              <Collapsible title="Headers" defaultOpen compact>
                {Object.entries(entry.responseHeaders).length === 0 ? (
                  <ThemedText type="small" themeColor="textSecondary" style={styles.emptyText}>
                    No response headers
                  </ThemedText>
                ) : (
                  Object.entries(entry.responseHeaders).map(([key, value], idx, arr) => (
                    <KeyValueRow key={key} name={key} value={value} last={idx === arr.length - 1} />
                  ))
                )}
              </Collapsible>

              <Collapsible title="Body" defaultOpen compact>
                <BodyContent body={entry.responseBody} />
              </Collapsible>
            </View>
          )}
        </ScrollView>

        <ActionSheet
          visible={menuVisible}
          onClose={() => setMenuVisible(false)}
          onCreateCompose={() => {
            setMenuVisible(false);
            const composeId = generateId();
            const headers: [string, string][] = Object.entries(entry.requestHeaders);
            saveCompose({
              id: composeId,
              name: `${entry.method} ${entry.host}${entry.path}`,
              method: entry.method,
              url: entry.url,
              headers,
              body: entry.requestBody,
              timestamp: Date.now(),
            });
            router.push({ pathname: '/composer-detail', params: { id: composeId } });
          }}
          onCopyCurl={async () => {
            setMenuVisible(false);
            await Clipboard.setStringAsync(buildCurl(entry));
            Alert.alert('Copied', 'cURL command copied to clipboard');
          }}
        />
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
  },
  navBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  backButton: {
    paddingVertical: 4,
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
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.six,
    gap: 0,
    alignSelf: 'stretch',
  },
  infoCard: {
    alignSelf: 'stretch',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#D1D5DB',
    borderRadius: Spacing.two,
    padding: Spacing.three,
    gap: Spacing.two,
    marginBottom: Spacing.two,
  },
  methodRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  methodBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
  },
  methodText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
    fontFamily: Platform.select({ ios: 'ui-monospace', default: 'monospace' }),
    letterSpacing: 0.5,
  },
  hostText: {
    flex: 1,
    fontSize: 16,
    fontWeight: '600',
  },
  pathText: {
    fontSize: 13,
  },
  infoGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
  infoCell: {
    width: '30%',
    gap: 2,
  },
  statusBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 3,
    alignSelf: 'flex-start',
  },
  statusText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
    fontFamily: Platform.select({ ios: 'ui-monospace', default: 'monospace' }),
  },
  errorBox: {
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    borderRadius: Spacing.one,
    padding: Spacing.two,
  },
  tabBar: {
    alignSelf: 'stretch',
    flexDirection: 'row',
    gap: Spacing.one,
    paddingBottom: Spacing.two,
  },
  tabWrapper: {
    flex: 1,
  },
  tab: {
    alignItems: 'center',
    paddingVertical: Spacing.one + 2,
    borderRadius: Spacing.one,
    backgroundColor: 'transparent',
  },
  tabActive: {
    backgroundColor: 'rgba(128, 128, 128, 0.15)',
  },
  tabSection: {
    gap: Spacing.two,
  },
  kvRow: {
    flexDirection: 'row',
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one + 2,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  kvRowPressed: {
    backgroundColor: 'rgba(128, 128, 128, 0.1)',
  },
  kvRowLast: {
    borderBottomWidth: 0,
  },
  kvName: {
    flex: 1,
    marginRight: Spacing.two,
  },
  kvValue: {
    flex: 1,
  },
  bodyContainer: {
    borderRadius: Spacing.two,
    padding: Spacing.three,
  },
  bodyText: {
    fontSize: 12,
  },
  bodyEmpty: {
    borderRadius: Spacing.two,
    padding: Spacing.three,
    alignItems: 'center',
  },
  emptyText: {
    padding: Spacing.three,
    textAlign: 'center',
  },
  notFound: {
    textAlign: 'center',
    marginTop: Spacing.five,
  },
});

const sheetStyles = StyleSheet.create({
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
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#D1D5DB',
    alignSelf: 'center',
    marginBottom: Spacing.three,
  },
  row: {
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.two,
    borderRadius: Spacing.two,
  },
  rowPressed: {
    backgroundColor: 'rgba(128, 128, 128, 0.1)',
  },
});
