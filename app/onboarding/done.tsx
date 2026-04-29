/**
 * Onboarding "done" screen — shown after the user accepts foundational rules
 * and they're applied to the account's already-imported transactions.
 *
 * Uses the firstFoundationalCategorization Rachey moment.
 */

import React from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, SafeAreaView, ImageBackground,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Sloth } from '../../src/components/Sloth';
import { pickRacheyLine } from '../../src/domain/rachey-quotes';
import { colors, font, spacing, radius } from '../../src/theme';

export default function OnboardingDoneScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    accountId: string;
    appliedFoundational?: string;
    appliedTotal?: string;
  }>();
  const applied = Number(params.appliedFoundational ?? '0') || 0;

  // Lock the line for this render so it doesn't reroll on re-render
  const [{ pose, line }] = React.useState(() => pickRacheyLine('firstFoundationalCategorization'));

  const headline = applied > 0
    ? `${applied} transaction${applied === 1 ? '' : 's'} categorized!`
    : "All set up.";
  const sub = applied > 0
    ? "I sorted what I recognized. The rest are waiting whenever you're ready — tap any to assign a category, or just leave them."
    : "I didn't recognize any merchants this time around. As you import more, I'll learn — and you can always add your own rules.";

  return (
    <ImageBackground
      source={require('../../assets/backdrop.png')}
      style={styles.bg}
      resizeMode="cover"
    >
      <SafeAreaView style={styles.safe}>
        <View style={styles.hero}>
          <Sloth sloth={pose} size={160} />
        </View>

        <View style={styles.textCard}>
          <Text style={styles.headline}>{headline}</Text>
          <Text style={styles.quote}>"{line}"</Text>
          <View style={styles.divider} />
          <Text style={styles.bodyText}>{sub}</Text>
        </View>

        <TouchableOpacity
          style={styles.cta}
          onPress={() => router.replace(`/account/${params.accountId}`)}
          activeOpacity={0.85}
        >
          <Text style={styles.ctaText}>View account →</Text>
        </TouchableOpacity>
      </SafeAreaView>
    </ImageBackground>
  );
}

const styles = StyleSheet.create({
  bg:   { flex: 1 },
  safe: {
    flex: 1, paddingHorizontal: spacing.xl, paddingVertical: spacing.xl,
    justifyContent: 'space-between',
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
    fontFamily: font.extraBold, fontSize: 26, color: colors.text,
    textAlign: 'center',
  },
  quote: {
    fontFamily: font.semiBold, fontSize: 14, color: colors.textSecondary,
    textAlign: 'center', fontStyle: 'italic',
  },
  bodyText: {
    fontFamily: font.regular, fontSize: 15, color: colors.textSecondary,
    textAlign: 'center', lineHeight: 22,
  },

  cta: {
    backgroundColor: colors.primary,
    borderRadius: radius.full,
    paddingVertical: 18, alignItems: 'center',
    shadowColor: '#1A4030', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25, shadowRadius: 8, elevation: 4,
  },
  ctaText: { fontFamily: font.bold, fontSize: 17, color: colors.textOnColor },
});
