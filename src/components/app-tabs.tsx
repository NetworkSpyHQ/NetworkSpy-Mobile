import { SymbolView } from 'expo-symbols';
import { NativeTabs } from 'expo-router/unstable-native-tabs';
import { Platform, useColorScheme } from 'react-native';

import { Colors } from '@/constants/theme';

function TabIcon({ name }: { name: string }) {
  return (
    <SymbolView
      name={name as any}
      size={22}
      weight="regular"
    />
  );
}

export default function AppTabs() {
  const scheme = useColorScheme();
  const colors = Colors[scheme === 'unspecified' ? 'light' : scheme];

  return (
    <NativeTabs
      backgroundColor={colors.background}
      indicatorColor={colors.backgroundElement}
      labelStyle={{ selected: { color: colors.text } }}>
      <NativeTabs.Trigger name="index">
        <NativeTabs.Trigger.Label>Traffic</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon
          src={Platform.select({
            ios: <TabIcon name="antenna.radiowaves.left.and.right" /> as any,
            default: require('@/assets/images/tabIcons/home.png'),
          })}
          renderingMode="template"
        />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="composer">
        <NativeTabs.Trigger.Label>Composer</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon
          src={Platform.select({
            ios: <TabIcon name="square.and.pencil" /> as any,
            default: require('@/assets/images/tabIcons/home.png'),
          })}
          renderingMode="template"
        />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="settings">
        <NativeTabs.Trigger.Label>Settings</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon
          src={Platform.select({
            ios: <TabIcon name="gearshape" /> as any,
            default: require('@/assets/images/tabIcons/explore.png'),
          })}
          renderingMode="template"
        />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
