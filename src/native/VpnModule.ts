import { NativeModules, NativeEventEmitter, Platform, Alert } from 'react-native';
import type { TrafficEntry } from '@/types/traffic';

type VpnStatusCallback = (status: string) => void;
type TrafficCallback = (entry: TrafficEntry) => void;
type VpnErrorCallback = (error: string) => void;

interface VpnModuleNative {
  prepareVpn(): Promise<boolean>;
  startVpn(): void;
  stopVpn(): void;
  isVpnRunning(): Promise<boolean>;
}

const VpnNative: VpnModuleNative | null =
  Platform.OS === 'android' ? NativeModules.VpnModule : null;

let eventEmitter: NativeEventEmitter | null = null;

if (VpnNative) {
  eventEmitter = new NativeEventEmitter(NativeModules.VpnModule);
}

export async function startVpn(): Promise<void> {
  if (!VpnNative) return;

  try {
    const granted = await VpnNative.prepareVpn();
    if (granted) {
      VpnNative.startVpn();
    } else {
      Alert.alert('VPN Permission', 'VPN permission is required to capture traffic.');
    }
  } catch (e: any) {
    Alert.alert('Error', `Failed to prepare VPN: ${e.message}`);
  }
}

export function stopVpn(): void {
  VpnNative?.stopVpn();
}

export async function isVpnRunning(): Promise<boolean> {
  if (!VpnNative) return false;
  return VpnNative.isVpnRunning();
}

export function onVpnStatus(callback: VpnStatusCallback): () => void {
  if (!eventEmitter) {
    return () => {};
  }
  const sub = eventEmitter.addListener('VpnStatus', (event: { status: string }) => {
    callback(event.status);
  });
  return () => sub.remove();
}

export function onTrafficCapture(callback: TrafficCallback): () => void {
  if (!eventEmitter) {
    return () => {};
  }
  const sub = eventEmitter.addListener('TrafficCapture', (event: { payload: string }) => {
    try {
      const entry: TrafficEntry = JSON.parse(event.payload);
      callback(entry);
    } catch (e) {
      console.warn('Failed to parse traffic payload:', e);
    }
  });
  return () => sub.remove();
}

export function onVpnError(callback: VpnErrorCallback): () => void {
  if (!eventEmitter) {
    return () => {};
  }
  const sub = eventEmitter.addListener('VpnError', (event: { message: string }) => {
    callback(event.message);
  });
  return () => sub.remove();
}
