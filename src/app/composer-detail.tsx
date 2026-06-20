import { useCallback, useRef, useState } from 'react';
import { fetch } from 'react-native-nitro-fetch';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useColorScheme,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import {
  Colors,
  MethodColors,
  Spacing,
  getStatusColor,
} from '@/constants/theme';
import { buildCurlFromCompose, parseCurl } from '@/utils/curl-parser';
import {
  getComposeById,
  saveCompose,
  deleteCompose,
  generateId,
} from '@/data/compose-store';
import type { ComposeEntry, HttpMethod } from '@/types/traffic';
import { HttpMethods } from '@/types/traffic';

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

type ComposeResponse = {
  statusCode: number;
  duration: number;
  responseSize: number;
  responseHeaders: Record<string, string>;
  responseBody: string | null;
  contentType: string | null;
  error: string | null;
};

function MethodPicker({
  method,
  onSelect,
}: {
  method: HttpMethod;
  onSelect: (m: HttpMethod) => void;
}) {
  const [visible, setVisible] = useState(false);
  const scheme = useColorScheme();
  const colors = Colors[scheme === 'unspecified' ? 'light' : scheme];

  return (
    <>
      <Pressable
        style={({ pressed }) => [
          styles.methodPicker,
          { backgroundColor: MethodColors[method] ?? '#6B7280' },
          pressed && styles.methodPickerPressed,
        ]}
        onPress={() => setVisible(true)}
      >
        <Text style={styles.methodPickerText}>{method}</Text>
        <Text style={styles.methodPickerArrow}>▼</Text>
      </Pressable>

      <Modal
        visible={visible}
        animationType="fade"
        transparent
        onRequestClose={() => setVisible(false)}
      >
        <Pressable
          style={sheetStyles.backdrop}
          onPress={() => setVisible(false)}
        >
          <View />
        </Pressable>
        <View
          style={[
            sheetStyles.sheet,
            {
              paddingBottom: 34,
              backgroundColor: colors.background,
            },
          ]}
        >
          <View style={sheetStyles.handle} />
          <ThemedText
            type="smallBold"
            themeColor="textSecondary"
            style={sheetStyles.sheetLabel}
          >
            Method
          </ThemedText>
          {HttpMethods.map((m) => (
            <Pressable
              key={m}
              style={({ pressed }) => [
                sheetStyles.sheetRow,
                pressed && sheetStyles.sheetRowPressed,
              ]}
              onPress={() => {
                onSelect(m);
                setVisible(false);
              }}
            >
              <View style={sheetStyles.sheetRowContent}>
                <View
                  style={[
                    styles.methodBadge,
                    { backgroundColor: MethodColors[m] ?? '#6B7280' },
                  ]}
                >
                  <Text style={styles.methodText}>{m}</Text>
                </View>
                {m === method && (
                  <Text style={sheetStyles.checkmark}>✓</Text>
                )}
              </View>
            </Pressable>
          ))}
        </View>
      </Modal>
    </>
  );
}

type Tab = 'headers' | 'body';

export default function ComposerDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();

  const isNew = id === 'new';
  const existing = !isNew ? getComposeById(id ?? '') : undefined;

  const [name, setName] = useState(existing?.name ?? '');
  const [method, setMethod] = useState<HttpMethod>(existing?.method ?? 'GET');
  const [url, setUrl] = useState(existing?.url ?? '');
  const [headers, setHeaders] = useState<[string, string][]>(
    existing?.headers ?? [['', '']]
  );
  const [body, setBody] = useState(existing?.body ?? '');
  const [activeTab, setActiveTab] = useState<Tab>('headers');
  const [sending, setSending] = useState(false);
  const [response, setResponse] = useState<ComposeResponse | null>(null);
  const [responseTab, setResponseTab] = useState<'body' | 'headers'>('body');
  const [menuVisible, setMenuVisible] = useState(false);

  const urlInputRef = useRef<TextInput>(null);
  const scheme = useColorScheme();
  const colors = Colors[scheme === 'unspecified' ? 'light' : scheme];
  const inputColor = { color: colors.text };

  const handleUrlChange = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (trimmed.startsWith('curl ') && !url.trim().startsWith('curl ')) {
        const parsed = parseCurl(trimmed);
        if (parsed) {
          setMethod(parsed.method);
          setUrl(parsed.url);
          if (parsed.headers.length > 0) {
            setHeaders(parsed.headers);
          }
          if (parsed.body) {
            setBody(parsed.body);
          }
          Alert.alert('cURL Detected', 'Fields have been auto-filled from the cURL command.');
          return;
        }
      }
      setUrl(text);
    },
    [url]
  );

  const handleSend = async () => {
    if (!url.trim()) {
      Alert.alert('Error', 'Please enter a URL');
      return;
    }

    let parsedUrl: string;
    try {
      parsedUrl = url.trim();
      if (!parsedUrl.startsWith('http://') && !parsedUrl.startsWith('https://')) {
        parsedUrl = `https://${parsedUrl}`;
      }
    } catch {
      Alert.alert('Error', 'Invalid URL');
      return;
    }

    setSending(true);
    setResponse(null);

    const startTime = Date.now();

    try {
      const headerObj: Record<string, string> = {};
      for (const [key, value] of headers) {
        if (key.trim()) {
          headerObj[key.trim()] = value;
        }
      }

      const fetchOptions: RequestInit = {
        method,
        headers: headerObj,
      };

      if (body && method !== 'GET' && method !== 'HEAD') {
        fetchOptions.body = body;
      }

      const res = await fetch(parsedUrl, fetchOptions);
      const duration = Date.now() - startTime;

      const responseHeaders: Record<string, string> = {};
      res.headers.forEach((value, key) => {
        responseHeaders[key] = value;
      });

      let responseBody: string | null = null;
      try {
        responseBody = await res.text();
      } catch {
        responseBody = null;
      }

      setResponse({
        statusCode: res.status,
        duration,
        responseSize: responseBody ? new Blob([responseBody]).size : 0,
        responseHeaders,
        responseBody,
        contentType: res.headers.get('content-type') ?? null,
        error: null,
      });
    } catch (err: any) {
      setResponse({
        statusCode: 0,
        duration: Date.now() - startTime,
        responseSize: 0,
        responseHeaders: {},
        responseBody: null,
        contentType: null,
        error: err?.message ?? 'Network request failed',
      });
    } finally {
      setSending(false);
    }
  };

  const handleSave = () => {
    if (!name.trim()) {
      Alert.alert('Error', 'Please enter a name for this request');
      return;
    }

    const entry: ComposeEntry = {
      id: existing?.id ?? generateId(),
      name: name.trim(),
      method,
      url: url.trim(),
      headers: headers.filter(([k]) => k.trim()),
      body: body || null,
      timestamp: existing?.timestamp ?? Date.now(),
    };

    saveCompose(entry);
    router.back();
  };

  const handleDelete = () => {
    if (!existing) return;
    Alert.alert('Delete Request', `Delete "${existing.name}"?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          deleteCompose(existing.id);
          router.back();
        },
      },
    ]);
  };

  const addHeader = () => setHeaders([...headers, ['', '']]);

  const updateHeader = (index: number, key: string, value: string) => {
    const updated = [...headers];
    updated[index] = [key, value];
    setHeaders(updated);
  };

  const removeHeader = (index: number) => {
    if (headers.length <= 1) return;
    setHeaders(headers.filter((_, i) => i !== index));
  };

  const statusColor = response
    ? getStatusColor(response.statusCode)
    : '#6B7280';

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <View style={styles.navBar}>
          <ThemedText
            type="linkPrimary"
            style={styles.backButton}
            onPress={() => router.back()}
          >
            ← Composer
          </ThemedText>
          <View style={styles.navRight}>
            {existing && (
              <Pressable
                style={({ pressed }) => [
                  styles.navButton,
                  pressed && styles.navButtonPressed,
                ]}
                onPress={handleDelete}
              >
                <Text style={styles.deleteIcon}>🗑</Text>
              </Pressable>
            )}
            <Pressable
              style={({ pressed }) => [
                styles.navButton,
                pressed && styles.navButtonPressed,
              ]}
              onPress={handleSave}
            >
              <ThemedText type="linkPrimary">Save</ThemedText>
            </Pressable>
            <Pressable
              style={({ pressed }) => [
                styles.navButton,
                pressed && styles.navButtonPressed,
              ]}
              onPress={() => setMenuVisible(true)}
            >
              <Text style={styles.menuDots}>⋮</Text>
            </Pressable>
          </View>
        </View>

        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.nameRow}>
            <TextInput
              style={[styles.nameInput, inputColor]}
              placeholder="Request name"
              placeholderTextColor="#9CA3AF"
              value={name}
              onChangeText={setName}
              autoCapitalize="none"
            />
          </View>

          <View style={styles.urlRow}>
            <MethodPicker method={method} onSelect={setMethod} />
            <TextInput
              ref={urlInputRef}
                  style={[styles.urlInput, inputColor]}
              placeholder="https://api.example.com/endpoint"
              placeholderTextColor="#9CA3AF"
              value={url}
              onChangeText={handleUrlChange}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
            />
            <Pressable
              style={({ pressed }) => [
                styles.sendButton,
                pressed && styles.sendButtonPressed,
                sending && styles.sendButtonDisabled,
              ]}
              onPress={handleSend}
              disabled={sending}
            >
              {sending ? (
                <ActivityIndicator color="#FFFFFF" size="small" />
              ) : (
                <Text style={styles.sendButtonText}>▶</Text>
              )}
            </Pressable>
          </View>

          <View style={styles.tabBar}>
            <View style={styles.tabWrapper}>
              <Pressable
                style={[
                  styles.tab,
                  activeTab === 'headers' && styles.tabActive,
                ]}
                onPress={() => setActiveTab('headers')}
              >
                <ThemedText
                  type="smallBold"
                  themeColor={
                    activeTab === 'headers' ? 'text' : 'textSecondary'
                  }
                >
                  Headers
                </ThemedText>
              </Pressable>
            </View>
            <View style={styles.tabWrapper}>
              <Pressable
                style={[styles.tab, activeTab === 'body' && styles.tabActive]}
                onPress={() => setActiveTab('body')}
              >
                <ThemedText
                  type="smallBold"
                  themeColor={activeTab === 'body' ? 'text' : 'textSecondary'}
                >
                  Body
                </ThemedText>
              </Pressable>
            </View>
          </View>

          {activeTab === 'headers' && (
            <View style={styles.tabSection}>
              {headers.map(([key, value], index) => (
                <View key={index} style={styles.headerRow}>
                  <TextInput
                    style={[styles.headerKeyInput, inputColor]}
                    placeholder="Key"
                    placeholderTextColor="#9CA3AF"
                    value={key}
                    onChangeText={(text) => updateHeader(index, text, value)}
                    autoCapitalize="none"
                    autoCorrect={false}
                  />
                  <TextInput
                    style={[styles.headerValueInput, inputColor]}
                    placeholder="Value"
                    placeholderTextColor="#9CA3AF"
                    value={value}
                    onChangeText={(text) => updateHeader(index, key, text)}
                    autoCapitalize="none"
                    autoCorrect={false}
                  />
                  <Pressable
                    style={({ pressed }) => [
                      styles.headerRemove,
                      pressed && styles.headerRemovePressed,
                      headers.length <= 1 && styles.headerRemoveHidden,
                    ]}
                    onPress={() => removeHeader(index)}
                  >
                    <Text style={styles.headerRemoveText}>×</Text>
                  </Pressable>
                </View>
              ))}
              <Pressable
                style={({ pressed }) => [
                  styles.addHeaderButton,
                  pressed && styles.addHeaderButtonPressed,
                ]}
                onPress={addHeader}
              >
                <ThemedText type="small" themeColor="textSecondary">
                  + Add Header
                </ThemedText>
              </Pressable>
            </View>
          )}

          {activeTab === 'body' && (
            <View style={styles.tabSection}>
              <TextInput
                style={[styles.bodyInput, inputColor]}
                placeholder='{"key": "value"}'
                placeholderTextColor="#9CA3AF"
                value={body}
                onChangeText={setBody}
                multiline
                textAlignVertical="top"
                autoCapitalize="none"
                autoCorrect={false}
              />
            </View>
          )}

          {response && (
            <View style={styles.responseSection}>
              <ThemedText type="smallBold" style={styles.responseTitle}>
                Response
              </ThemedText>

              <View style={styles.responseMeta}>
                {response.error ? (
                  <View style={styles.responseMetaRow}>
                    <View
                      style={[
                        styles.statusBadge,
                        { backgroundColor: statusColor },
                      ]}
                    >
                      <Text style={styles.statusText}>ERR</Text>
                    </View>
                    <ThemedText type="small" style={{ color: '#EF4444', flex: 1 }}>
                      {response.error}
                    </ThemedText>
                  </View>
                ) : (
                  <View style={styles.responseMetaRow}>
                    <View
                      style={[
                        styles.statusBadge,
                        { backgroundColor: statusColor },
                      ]}
                    >
                      <Text style={styles.statusText}>
                        {response.statusCode}
                      </Text>
                    </View>
                    <ThemedText type="small" themeColor="textSecondary">
                      {formatDuration(response.duration)}
                    </ThemedText>
                    <ThemedText type="small" themeColor="textSecondary">
                      {formatSize(response.responseSize)}
                    </ThemedText>
                  </View>
                )}
              </View>

              <View style={styles.responseTabBar}>
                <Pressable
                  style={[
                    styles.responseTab,
                    responseTab === 'body' && styles.responseTabActive,
                  ]}
                  onPress={() => setResponseTab('body')}
                >
                  <ThemedText
                    type="small"
                    themeColor={
                      responseTab === 'body' ? 'text' : 'textSecondary'
                    }
                  >
                    Body
                  </ThemedText>
                </Pressable>
                <Pressable
                  style={[
                    styles.responseTab,
                    responseTab === 'headers' && styles.responseTabActive,
                  ]}
                  onPress={() => setResponseTab('headers')}
                >
                  <ThemedText
                    type="small"
                    themeColor={
                      responseTab === 'headers' ? 'text' : 'textSecondary'
                    }
                  >
                    Headers
                  </ThemedText>
                </Pressable>
              </View>

              {responseTab === 'body' && (
                <ThemedView type="backgroundElement" style={styles.responseBody}>
                  <ThemedText type="code" selectable>
                    {response.responseBody || '(empty)'}
                  </ThemedText>
                </ThemedView>
              )}

              {responseTab === 'headers' && (
                <ThemedView type="backgroundElement" style={styles.responseBody}>
                  {Object.entries(response.responseHeaders).length === 0 ? (
                    <ThemedText type="small" themeColor="textSecondary">
                      No response headers
                    </ThemedText>
                  ) : (
                    Object.entries(response.responseHeaders).map(
                      ([key, value]) => (
                        <View key={key} style={styles.responseHeaderRow}>
                          <ThemedText type="code" themeColor="textSecondary">
                            {key}:{' '}
                          </ThemedText>
                          <ThemedText type="code" selectable>
                            {value}
                          </ThemedText>
                        </View>
                      )
                    )
                  )}
                </ThemedView>
              )}
            </View>
          )}
        </ScrollView>

        <ActionSheet
          visible={menuVisible}
          onClose={() => setMenuVisible(false)}
          onDuplicate={() => {
            setMenuVisible(false);
            const newId = generateId();
            saveCompose({
              id: newId,
              name: `${name || 'Untitled'} (copy)`,
              method,
              url,
              headers: [...headers],
              body: body || null,
              timestamp: Date.now(),
            });
            router.replace({ pathname: '/composer-detail', params: { id: newId } });
          }}
          onCopyCurl={async () => {
            setMenuVisible(false);
            const entry: ComposeEntry = {
              id: existing?.id ?? 'temp',
              name: name || 'Untitled',
              method,
              url,
              headers,
              body: body || null,
              timestamp: Date.now(),
            };
            await Clipboard.setStringAsync(buildCurlFromCompose(entry));
            Alert.alert('Copied', 'cURL command copied to clipboard');
          }}
        />
      </SafeAreaView>
    </ThemedView>
  );
}

function ActionSheet({
  visible,
  onClose,
  onCopyCurl,
  onDuplicate,
}: {
  visible: boolean;
  onClose: () => void;
  onCopyCurl: () => void;
  onDuplicate?: () => void;
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
      <Pressable style={sheetStyles.backdrop} onPress={onClose}>
        <View />
      </Pressable>
      <View
        style={[
          sheetStyles.sheet,
          {
            paddingBottom: insets.bottom + Spacing.three,
            backgroundColor: colors.background,
          },
        ]}
      >
        <View style={sheetStyles.handle} />
        {onDuplicate && (
          <Pressable
            style={({ pressed }) => [
              sheetStyles.sheetRow,
              pressed && sheetStyles.sheetRowPressed,
            ]}
            onPress={onDuplicate}
          >
            <ThemedText>Duplicate</ThemedText>
          </Pressable>
        )}
        <Pressable
          style={({ pressed }) => [
            sheetStyles.sheetRow,
            pressed && sheetStyles.sheetRowPressed,
          ]}
          onPress={onCopyCurl}
        >
          <ThemedText>Copy as cURL</ThemedText>
        </Pressable>
      </View>
    </Modal>
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
  navRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
  },
  navButton: {
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.one,
    borderRadius: Spacing.one,
  },
  navButtonPressed: {
    opacity: 0.5,
  },
  menuDots: {
    fontSize: 20,
    fontWeight: '700',
    color: '#6B7280',
    letterSpacing: 1,
  },
  deleteIcon: {
    fontSize: 16,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.six,
    gap: Spacing.two,
  },
  nameRow: {
    marginTop: Spacing.one,
  },
  nameInput: {
    fontSize: 18,
    fontWeight: '600',
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.two,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#D1D5DB',
    borderRadius: Spacing.two,
  },
  urlRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  methodPicker: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.two,
    borderRadius: Spacing.two,
    gap: 4,
  },
  methodPickerPressed: {
    opacity: 0.8,
  },
  methodPickerText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
    fontFamily: Platform.select({ ios: 'ui-monospace', default: 'monospace' }),
  },
  methodPickerArrow: {
    color: '#FFFFFF',
    fontSize: 8,
    opacity: 0.7,
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
  urlInput: {
    flex: 1,
    fontSize: 14,
    fontFamily: Platform.select({ ios: 'ui-monospace', default: 'monospace' }),
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.two,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#D1D5DB',
    borderRadius: Spacing.two,
  },
  sendButton: {
    width: 36,
    height: 36,
    borderRadius: Spacing.two,
    backgroundColor: '#3B82F6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendButtonPressed: {
    opacity: 0.8,
  },
  sendButtonDisabled: {
    opacity: 0.5,
  },
  sendButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    marginLeft: 2,
  },
  tabBar: {
    flexDirection: 'row',
    gap: Spacing.one,
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
    gap: Spacing.one,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
  },
  headerKeyInput: {
    flex: 1,
    fontSize: 13,
    fontFamily: Platform.select({ ios: 'ui-monospace', default: 'monospace' }),
    paddingVertical: Spacing.one + 2,
    paddingHorizontal: Spacing.two,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#D1D5DB',
    borderRadius: Spacing.one,
  },
  headerValueInput: {
    flex: 1,
    fontSize: 13,
    fontFamily: Platform.select({ ios: 'ui-monospace', default: 'monospace' }),
    paddingVertical: Spacing.one + 2,
    paddingHorizontal: Spacing.two,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#D1D5DB',
    borderRadius: Spacing.one,
  },
  headerRemove: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerRemovePressed: {
    backgroundColor: 'rgba(239, 68, 68, 0.3)',
  },
  headerRemoveHidden: {
    opacity: 0,
  },
  headerRemoveText: {
    color: '#EF4444',
    fontSize: 16,
    fontWeight: '600',
    lineHeight: 18,
  },
  addHeaderButton: {
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.two,
    borderRadius: Spacing.one,
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#D1D5DB',
    borderStyle: 'dashed',
  },
  addHeaderButtonPressed: {
    backgroundColor: 'rgba(128, 128, 128, 0.05)',
  },
  bodyInput: {
    minHeight: 120,
    fontSize: 13,
    fontFamily: Platform.select({ ios: 'ui-monospace', default: 'monospace' }),
    padding: Spacing.two,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#D1D5DB',
    borderRadius: Spacing.two,
  },
  responseSection: {
    gap: Spacing.two,
    marginTop: Spacing.two,
  },
  responseTitle: {
    marginBottom: 0,
  },
  responseMeta: {},
  responseMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  statusBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 3,
  },
  statusText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '700',
    fontFamily: Platform.select({ ios: 'ui-monospace', default: 'monospace' }),
  },
  responseTabBar: {
    flexDirection: 'row',
    gap: Spacing.one,
  },
  responseTab: {
    paddingVertical: Spacing.one,
    paddingHorizontal: Spacing.three,
    borderRadius: Spacing.one,
  },
  responseTabActive: {
    backgroundColor: 'rgba(128, 128, 128, 0.15)',
  },
  responseBody: {
    borderRadius: Spacing.two,
    padding: Spacing.three,
    gap: Spacing.one,
  },
  responseHeaderRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
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
