import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { centsToDollars } from '../domain/money';
import { CategoryRow, classifyRow, computeProgress } from '../domain/budget-variance';
import { colors, font, radius, spacing } from '../theme';

interface Props {
  row:           CategoryRow;
  categoryName:  string;
  categoryColor: string;
}

export function BudgetCategoryRow({ row, categoryName, categoryColor }: Props) {
  const track    = classifyRow(row);
  const progress = computeProgress(row);
  const fillColor = track === 'good' ? colors.income : track === 'bad' ? colors.expense : 'transparent';
  const fillWidth = `${Math.min(progress, 1.0) * 100}%` as `${number}%`;
  const variance  = row.actual_cents - row.budget_cents;

  return (
    <View style={styles.row}>
      {/* Left: dot + name */}
      <View style={styles.left}>
        <View style={[styles.dot, { backgroundColor: categoryColor }]} />
        <Text style={styles.name} numberOfLines={1}>{categoryName}</Text>
      </View>

      {/* Right: amounts + variance */}
      <View style={styles.right}>
        <Text style={styles.amounts}>
          <Text style={styles.actual}>{centsToDollars(row.actual_cents)}</Text>
          <Text style={styles.separator}> / </Text>
          <Text style={styles.budget}>{row.has_budget ? centsToDollars(row.budget_cents) : '—'}</Text>
        </Text>
        {row.has_budget && (
          <Text style={[styles.variance, { color: track === 'bad' ? colors.expense : track === 'good' ? colors.income : colors.textTertiary }]}>
            {variance > 0 ? '+' : ''}{centsToDollars(variance)}
          </Text>
        )}
      </View>

      {/* Progress bar — spans full width below name/amounts */}
      <View style={styles.barTrack}>
        {track !== 'neutral' && progress > 0 && (
          <View style={[styles.barFill, { width: fillWidth, backgroundColor: fillColor }]} />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection:  'row',
    flexWrap:       'wrap',
    alignItems:     'center',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.separator,
  },
  left: {
    flex:           1,
    flexDirection:  'row',
    alignItems:     'center',
    gap:            8,
    minWidth:       0,
  },
  dot: {
    width:        8,
    height:       8,
    borderRadius: radius.full,
    flexShrink:   0,
  },
  name: {
    fontFamily: font.semiBold,
    fontSize:   14,
    color:      colors.text,
    flexShrink: 1,
  },
  right: {
    alignItems: 'flex-end',
  },
  amounts: {
    fontSize: 13,
  },
  actual: {
    fontFamily: font.bold,
    color:      colors.text,
  },
  separator: {
    fontFamily: font.regular,
    color:      colors.textTertiary,
  },
  budget: {
    fontFamily: font.regular,
    color:      colors.textSecondary,
  },
  variance: {
    fontFamily: font.semiBold,
    fontSize:   11,
  },
  barTrack: {
    width:           '100%',
    height:          5,
    backgroundColor: colors.surfaceAlt,
    borderRadius:    radius.full,
    marginTop:       6,
    overflow:        'hidden',
  },
  barFill: {
    height:       5,
    borderRadius: radius.full,
  },
});
