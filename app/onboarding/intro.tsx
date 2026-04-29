/**
 * First-time user — Intro screen.
 *
 * Single-page welcome. Rachey waving + the slogan + 1 CTA. No skip — the
 * categories step is essentially required before they can do anything useful,
 * and the categories screen itself has an "Add my own" / minimal-set escape.
 */

import React from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, SafeAreaView, ImageBackground,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Sloth } from '../../src/components/Sloth';
import { colors, font, spacing, radius } from '../../src/theme';

export default function OnboardingIntroScreen() {
  const router = useRouter();

  return (
    <ImageBackground
      source={require('../../assets/backdrop.png')}
      style={styles.bg}
      resizeMode="cover"
    >
      <SafeAreaView style={styles.safe}>
        <View style={styles.hero}>
          <Sloth sloth="waving" size={180} />
        </View>

        <View style={styles.textCard}>
          <Text style={styles.headline}>Hi, I'm Rachey.</Text>
          <Text style={styles.tagline}>Take it Slow, Do it Steady, Become Ready…zZ</Text>
          <View style={styles.divider} />
          <Text style={styles.bodyText}>
            I'll help you track your spending — at your own pace. Nothing gets
            sent anywhere; everything stays on your phone.
          </Text>
          <Text style={styles.bodyText}>
            We'll start with a few categories so I know how to sort things.
            Then you'll add an account and I'll do as much of the categorizing
            as I can.
          </Text>
        </View>

        <TouchableOpacity
          style={styles.cta}
          onPress={() => router.push('/onboarding/categories')}
          activeOpacity={0.85}
        >
          <Text style={styles.ctaText}>Let's set up your categories →</Text>
        </TouchableOpacity>
      </SafeAreaView>
    </ImageBackground>
  );
}

const styles = StyleSheet.create({
  bg:   { flex: 1 },
  safe: {
    flex: 1, paddingHorizontal: spacing.xl,
    justifyContent: 'space-between', paddingVertical: spacing.xl,
  },

  hero: { alignItems: 'center', marginTop: spacing.xl },

  textCard: {
    backgroundColor: 'rgba(250,247,242,0.93)',
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.sm,
    shadowColor: '#2C2416',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
  },
  divider: {
    height: 1,
    backgroundColor: colors.separator,
    marginVertical: spacing.xs,
  },

  headline: {
    fontFamily: font.extraBold, fontSize: 30,
    color: colors.text, textAlign: 'center',
  },
  tagline: {
    fontFamily: font.semiBold, fontSize: 13,
    color: colors.textSecondary, textAlign: 'center',
    fontStyle: 'italic', letterSpacing: 0.3,
  },
  bodyText: {
    fontFamily: font.regular, fontSize: 15,
    color: colors.textSecondary, textAlign: 'center',
    lineHeight: 22,
  },

  cta: {
    backgroundColor: colors.primary,
    borderRadius: radius.full,
    paddingVertical: 18, alignItems: 'center',
    shadowColor: '#1A4030', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25, shadowRadius: 8, elevation: 4,
  },
  ctaText: {
    fontFamily: font.bold, fontSize: 17, color: colors.textOnColor,
  },
});
