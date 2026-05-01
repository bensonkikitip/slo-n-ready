import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { centsToDollars } from '../domain/money';
import { colors, font, spacing } from '../theme';

interface Props {
  incomeCents:    number;
  expenseCents:   number;
  netCents:       number;
  excludedCents?: number;  // v4.6 — sum of excluded-category transactions; shown as separate row when non-zero
}

export function SummaryBar({ incomeCents, expenseCents, netCents, excludedCents = 0 }: Props) {
  return (
    <View style={styles.wrapper}>
      <View style={styles.container}>
        <Cell label="Income"   cents={incomeCents}  color={colors.income} />
        <View style={styles.divider} />
        <Cell label="Expenses" cents={expenseCents} color={colors.expense} />
        <View style={styles.divider} />
        <Cell
          label="Net"
          cents={netCents}
          color={netCents >= 0 ? colors.netPositive : colors.netNegative}
          bold
        />
      </View>
      {excludedCents !== 0 && (
        <View style={styles.excludedRow}>
          <Text style={styles.excludedText}>
            {'↔ '}{centsToDollars(Math.abs(excludedCents))}{' not counted toward totals'}
          </Text>
        </View>
      )}
    </View>
  );
}

function Cell({
  label,
  cents,
  color,
  bold,
}: {
  label: string;
  cents: number;
  color: string;
  bold?: boolean;
}) {
  return (
    <View style={styles.cell}>
      <Text style={styles.label}>{label}</Text>
      <Text style={[styles.amount, { color }, bold && styles.amountBold]}>
        {centsToDollars(cents)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    backgroundColor:  colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.separator,
  },
  container: {
    flexDirection:    'row',
    paddingVertical:  spacing.md,
    paddingHorizontal: spacing.md,
  },
  excludedRow: {
    alignItems:       'center',
    paddingBottom:    6,
  },
  excludedText: {
    fontFamily: font.regular,
    fontSize:   12,
    color:      colors.textTertiary,
  },
  cell: {
    flex:       1,
    alignItems: 'center',
    gap:        2,
  },
  divider: {
    width:           1,
    backgroundColor: colors.separator,
    marginVertical:  4,
  },
  label: {
    fontFamily: font.semiBold,
    fontSize:   11,
    color:      colors.textTertiary,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  amount: {
    fontFamily: font.bold,
    fontSize:   15,
  },
  amountBold: {
    fontFamily: font.extraBold,
    fontSize:   16,
  },
});
