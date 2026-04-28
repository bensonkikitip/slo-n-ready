import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { centsToDollars } from '../domain/money';
import { VarianceSummary } from '../domain/budget-variance';
import { colors, font, spacing } from '../theme';

interface Props {
  summary: VarianceSummary;
}

export function BudgetVarianceSummary({ summary }: Props) {
  const netVariance = summary.income_variance_cents + summary.expense_variance_cents;
  return (
    <View style={styles.container}>
      <VarianceCell
        label="Income"
        actualCents={summary.income_actual_cents}
        budgetCents={summary.income_budget_cents}
        varianceCents={summary.income_variance_cents}
        isIncome
      />
      <View style={styles.divider} />
      <VarianceCell
        label="Expenses"
        actualCents={summary.expense_actual_cents}
        budgetCents={summary.expense_budget_cents}
        varianceCents={summary.expense_variance_cents}
        isIncome={false}
      />
      <View style={styles.divider} />
      <NetCell varianceCents={netVariance} />
    </View>
  );
}

function VarianceCell({
  label,
  actualCents,
  budgetCents,
  varianceCents,
  isIncome,
}: {
  label:         string;
  actualCents:   number;
  budgetCents:   number;
  varianceCents: number;
  isIncome:      boolean;
}) {
  const amountColor = isIncome ? colors.income : colors.expense;
  // For income: positive variance = over goal = good. For expense: positive variance = under-spent = good.
  const varianceGood = varianceCents >= 0;
  const varianceColor = varianceGood ? colors.income : colors.expense;
  const arrow = varianceCents === 0 ? '' : varianceCents > 0 ? '▲ ' : '▼ ';
  const hasBudget = budgetCents !== 0;

  return (
    <View style={styles.cell}>
      <Text style={styles.label}>{label.toUpperCase()}</Text>
      <Text style={[styles.amount, { color: amountColor }]}>{centsToDollars(actualCents)}</Text>
      {hasBudget ? (
        <Text style={[styles.variance, { color: varianceColor }]}>
          {arrow}{centsToDollars(Math.abs(varianceCents))}
        </Text>
      ) : (
        <Text style={styles.varianceNeutral}>no budget</Text>
      )}
    </View>
  );
}

function NetCell({ varianceCents }: { varianceCents: number }) {
  const good = varianceCents >= 0;
  const color = good ? colors.netPositive : colors.netNegative;
  const arrow = varianceCents === 0 ? '—' : varianceCents > 0 ? '▲ ' : '▼ ';
  return (
    <View style={styles.cell}>
      <Text style={styles.label}>NET VAR.</Text>
      <Text style={[styles.netAmount, { color }]}>
        {varianceCents === 0 ? '—' : `${arrow}${centsToDollars(Math.abs(varianceCents))}`}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection:     'row',
    backgroundColor:   colors.surface,
    paddingVertical:   spacing.md,
    paddingHorizontal: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.separator,
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
    fontFamily:    font.semiBold,
    fontSize:      11,
    color:         colors.textTertiary,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  amount: {
    fontFamily: font.bold,
    fontSize:   15,
  },
  netAmount: {
    fontFamily: font.extraBold,
    fontSize:   16,
  },
  variance: {
    fontFamily: font.semiBold,
    fontSize:   11,
  },
  varianceNeutral: {
    fontFamily: font.regular,
    fontSize:   11,
    color:      colors.textTertiary,
  },
});
