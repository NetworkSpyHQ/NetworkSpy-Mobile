import { Ionicons } from '@expo/vector-icons';
import { NativeTabs } from 'expo-router/unstable-native-tabs';
import { useColorScheme } from 'react-native';

import { Colors } from '@/constants/theme';

const ICON_SIZE = 24;

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
          src={<Ionicons name="analytics" size={ICON_SIZE} />}
        />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="composer">
        <NativeTabs.Trigger.Label>Composer</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon
          src={<Ionicons name="create" size={ICON_SIZE} />}
        />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="settings">
        <NativeTabs.Trigger.Label>Settings</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon
          src={<Ionicons name="settings-outline" size={ICON_SIZE} />}
        />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
