import { Stack } from 'expo-router';
import { DarkTheme, DefaultTheme, ThemeProvider } from 'expo-router';
import { useColorScheme } from 'react-native';

import { AnimatedSplashOverlay } from '@/components/animated-icon';

export default function RootLayout() {
  const colorScheme = useColorScheme();
  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <AnimatedSplashOverlay />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen
          name="detail"
          options={{
            animation: 'slide_from_right',
          }}
        />
        <Stack.Screen
          name="composer-detail"
          options={{
            animation: 'slide_from_right',
          }}
        />
        <Stack.Screen
          name="certificates"
          options={{
            animation: 'slide_from_right',
          }}
        />
        <Stack.Screen
          name="subscriptions"
          options={{
            animation: 'slide_from_right',
          }}
        />
        <Stack.Screen
          name="setup"
          options={{
            animation: 'slide_from_right',
          }}
        />
        <Stack.Screen
          name="support"
          options={{
            animation: 'slide_from_right',
          }}
        />
        <Stack.Screen
          name="report-bug"
          options={{
            animation: 'slide_from_right',
          }}
        />
        <Stack.Screen
          name="about"
          options={{
            animation: 'slide_from_right',
          }}
        />
      </Stack>
    </ThemeProvider>
  );
}
