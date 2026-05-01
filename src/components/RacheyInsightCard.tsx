/**
 * RacheyInsightCard — the emotional header on the Trends screen.
 *
 * Shows Rachey's sloth illustration alongside the overall period comparison
 * message and a two-column totals bar.
 */

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Sloth } from './Sloth';
import { centsToDollars } from '../domain/money';
import { colors, font, spacing, radius } from '../theme';

interface Props {
  message:        string;
  currentLabel:   string;  // e.g. "March 2026"
  previousLabel:  string;  // e.g. "February 2026"
  currentCents:   number;  // total expenses for current period (negative)
  previousCents:  number;  // total expenses for comparison period (negative)
  isGoodNews:     boolean; // waving = good, piggyBank = neutral/no data
}

export function RacheyInsightCard({
  message,
  currentLabel,
  previousLabel,
  currentCents,
  previousCents,
  isGoodNews,
}: Props) {
  const slothPose = isGoodNews ? 'waving' : 'piggyBank';

  const curAbs  = Math.abs(currentCents);
  const prevAbs = Math.abs(previousCents);
  const diffAbs = Math.abs(curAbs - prevAbs);
  const deltaColor = curAbs <= prevAbs ? colors.income : colors.expense;
  const deltaSign  = curAbs < prevAbs ? '-' : curAbs > prevAbs ? '+' : '';

  return (
    <View style={styles.card}>
      {/* Rachey illustration + message */}
      <View style={styles.header}>
        <Sloth sloth={slothPose} size={80} />
        <Text style={styles.message}>{message}</Text>
      </View>

      {/* Divider */}
      <View style={styles.divider} />

      {/* Period totals bar */}
      <View style={styles.totalsRow}>
        <View style={styles.totalCol}>
          <Text style={styles.totalLabel}>{currentLabel}</Text>
          <Text style={styles.totalAmount}>{centsToDollars(currentCents)}</Text>
        </View>

        {previousCents !== 0 && (
          <>
            <View style={styles.deltaPill}>
              <Text style={[styles.deltaText, { color: deltaColor }]}>
                {deltaSign}{centsToDollars(-diffAbs)}
              </Text>
            </View>

            <View style={[styles.totalCol, styles.totalColRight]}>
              <Text style={styles.totalLabel}>{previousLabel}</Text>
              <Text style={[styles.totalAmount, styles.totalAmountMuted]}>
                {centsToDollars(previousCents)}
              </Text>
            </View>
          </>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.primaryLight,
    borderRadius:    radius.lg,
    padding:         spacing.md,
    borderWidth:     1,
    borderColor:     colors.border,
  },

  header: {
    flexDirection: 'row',
    alignItems:    'center',
    gap:           spacing.md,
  },
  message: {
    flex:       1,
    fontFamily: font.semiBold,
    fontSize:   15,
    color:      colors.text,
    lineHeight: 22,
  },

  divider: {
    height:          1,
    backgroundColor: colors.separator,
    marginVertical:  spacing.sm,
  },

  totalsRow: {
    flexDirection:  'row',
    alignItems:     'center',
    justifyContent: 'space-between',
  },
  totalCol: {
    flex: 1,
  },
  totalColRight: {
    alignItems: 'flex-end',
  },
  totalLabel: {
    fontFamily: font.regular,
    fontSize:   11,
    color:      colors.textTertiary,
    marginBottom: 2,
  },
  totalAmount: {
    fontFamily: font.bold,
    fontSize:   17,
    color:      colors.text,
  },
  totalAmountMuted: {
    color: colors.textSecondary,
  },

  deltaPill: {
    paddingHorizontal: spacing.sm,
    paddingVertical:   4,
    borderRadius:      radius.full,
    backgroundColor:   colors.surface,
    borderWidth:       1,
    borderColor:       colors.border,
  },
  deltaText: {
    fontFamily: font.bold,
    fontSize:   13,
  },
});
