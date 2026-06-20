import { NativeModules, NativeEventEmitter, Platform } from 'react-native';
import type { TrafficEntry } from '@/types/traffic';

type VpnStatusCallback = (status: string) => void;
type TrafficCallback = (entry: TrafficEntry) => void;
type VpnErrorCallback = (error: string) => void;

interface VpnModuleNative {
  startVpn(): void;
  stopVpn(): void;
  isVpnRunning(): Promise<boolean>;
}

const VpnNative: VpnModuleNative | null =
  Platform.OS === 'android' ? NativeModules.VpnModule : null;

let eventEmitter: NativeEventEmitter | null = null;
let statusSub: any = null;
let trafficSub: any = null;
let errorSub: any = null;

if (VpnNative) {
  eventEmitter = new NativeEventEmitter(NativeModules.VpnModule);
}

export function startVpn(): void {
  VpnNative?.startVpn();
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
  statusSub = eventEmitter.addListener('VpnStatus', (event: { status: string }) => {
    callback(event.status);
  });
  return () => {
    statusSub?.remove();
  };
}

export function onTrafficCapture(callback: TrafficCallback): () => void {
  if (!eventEmitter) {
    return () => {};
  }
  trafficSub = eventEmitter.addListener('TrafficCapture', (event: { payload: string }) => {
    try {
      const entry: TrafficEntry = JSON.parse(event.payload);
      callback(entry);
    } catch (e) {
      console.warn('Failed to parse traffic payload:', e);
    }
  });
  return () => {
    trafficSub?.remove();
  };
}

export function onVpnError(callback: VpnErrorCallback): () => void {
  if (!eventEmitter) {
    return () => {};
  }
  errorSub = eventEmitter.addListener('VpnError', (event: { message: string }) => {
    callback(event.message);
  });
  return () => {
    errorSub?.remove();
  };
}
