import { useState } from 'react';
import { Alert, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Collapsible } from '@/components/ui/collapsible';
import { MethodColors, Spacing, getStatusColor } from '@/constants/theme';
import { getEntryById } from '@/data/mock-traffic';

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

type Tab = 'request' | 'response';

export default function DetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const entry = getEntryById(id ?? '');
  const [activeTab, setActiveTab] = useState<Tab>('request');

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
          <ThemedView style={styles.navSpacer} />
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
  navSpacer: {
    flex: 1,
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
