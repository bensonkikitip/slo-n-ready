import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Stack, ErrorBoundaryProps, useRouter } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import {
  useFonts,
  Nunito_400Regular,
  Nunito_600SemiBold,
  Nunito_700Bold,
  Nunito_800ExtraBold,
} from '@expo-google-fonts/nunito';
import { colors, font, spacing, radius } from '../src/theme';
import { SplashSlogan } from '../src/components/SplashSlogan';
import { Sloth } from '../src/components/Sloth';

export function ErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  const router = useRouter();
  return (
    <View style={eb.container}>
      <Sloth sloth="box" size={120} />
      <Text style={eb.title}>Something went wrong</Text>
      <Text style={eb.body}>{error.message}</Text>
      <TouchableOpacity style={eb.btn} onPress={retry} activeOpacity={0.8}>
        <Text style={eb.btnText}>Try again</Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={[eb.btn, eb.btnSecondary]}
        onPress={() => router.replace('/backup')}
        activeOpacity={0.8}
      >
        <Text style={[eb.btnText, eb.btnTextSecondary]}>Go to Backup & Restore</Text>
      </TouchableOpacity>
    </View>
  );
}

const eb = StyleSheet.create({
  container:       { flex: 1, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center', padding: spacing.xl, gap: spacing.md },
  title:           { fontFamily: font.bold, fontSize: 20, color: colors.text, marginTop: spacing.md, textAlign: 'center' },
  body:            { fontFamily: font.regular, fontSize: 14, color: colors.textSecondary, marginBottom: spacing.lg, textAlign: 'center', lineHeight: 20 },
  btn:             { backgroundColor: colors.primary, borderRadius: radius.full, paddingVertical: 14, paddingHorizontal: spacing.xl, width: '100%', alignItems: 'center' },
  btnSecondary:    { backgroundColor: 'transparent', borderWidth: 1, borderColor: colors.border },
  btnText:         { fontFamily: font.bold, fontSize: 15, color: colors.textOnColor },
  btnTextSecondary:{ color: colors.textSecondary },
});

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [fontsLoaded]  = useFonts({
    Nunito_400Regular,
    Nunito_600SemiBold,
    Nunito_700Bold,
    Nunito_800ExtraBold,
  });
  const [showSplash, setShowSplash] = useState(true);

  useEffect(() => {
    if (fontsLoaded) SplashScreen.hideAsync();
  }, [fontsLoaded]);

  if (!fontsLoaded) return null;

  return (
    <>
      <Stack
        screenOptions={{
          headerStyle:         { backgroundColor: colors.background },
          headerTintColor:     colors.primary,
          headerTitleStyle:    { fontFamily: font.bold, color: colors.text, fontSize: 17 },
          headerShadowVisible: false,
          contentStyle:        { backgroundColor: colors.background },
        }}
      />
      {showSplash && <SplashSlogan onDone={() => setShowSplash(false)} />}
    </>
  );
}
