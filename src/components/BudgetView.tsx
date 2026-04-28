import React from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet } from 'react-native';
import { router } from 'expo-router';
import { Category } from '../db/queries';
import { CategoryRow, VarianceSummary, sortCategoryRows } from '../domain/budget-variance';
import { BudgetVarianceSummary } from './BudgetVarianceSummary';
import { BudgetCategoryRow } from './BudgetCategoryRow';
import { Sloth } from './Sloth';
import { colors, font, spacing, radius } from '../theme';

interface Props {
  summary:       VarianceSummary;
  rows:          CategoryRow[];
  categoryById:  Record<string, Category>;
  hasAnyBudget:  boolean;
  budgetGridHref?: string;  // when set, empty state CTA navigates here
  ytdNote?:      string;    // e.g. "Through April 2026" — shown when year mode + partial year
}

export function BudgetView({ summary, rows, categoryById, hasAnyBudget, budgetGridHref, ytdNote }: Props) {
  if (!hasAnyBudget) {
    return <EmptyState budgetGridHref={budgetGridHref} />;
  }

  const nameOf = (id: string) => categoryById[id]?.name ?? 'Unknown';
  const sorted = sortCategoryRows(rows, nameOf);

  return (
    <FlatList
      data={sorted}
      keyExtractor={r => r.category_id}
      ListHeaderComponent={
        <View>
          <BudgetVarianceSummary summary={summary} />
          {ytdNote && (
            <View style={styles.ytdChip}>
              <Text style={styles.ytdText}>Year-to-date — {ytdNote}</Text>
            </View>
          )}
        </View>
      }
      renderItem={({ item }) => {
        const cat = categoryById[item.category_id];
        return (
          <BudgetCategoryRow
            row={item}
            categoryName={cat?.name ?? 'Unknown'}
            categoryColor={cat?.color ?? colors.textTertiary}
          />
        );
      }}
      contentContainerStyle={styles.list}
    />
  );
}

function EmptyState({ budgetGridHref }: { budgetGridHref?: string }) {
  return (
    <View style={styles.empty}>
      <Sloth sloth="piggyBank" size={100} />
      <Text style={styles.emptyTitle}>No budget set</Text>
      <Text style={styles.emptyBody}>
        {budgetGridHref
          ? 'Set up monthly targets to see how your spending compares.'
          : 'Open an account and tap ••• → Budget to set spending targets.'}
      </Text>
      {budgetGridHref && (
        <TouchableOpacity style={styles.cta} onPress={() => router.push(budgetGridHref as any)} activeOpacity={0.8}>
          <Text style={styles.ctaText}>Set up budgets</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  list: {
    flexGrow: 1,
    backgroundColor: colors.background,
  },
  ytdChip: {
    alignSelf:       'center',
    marginVertical:  spacing.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical:   4,
    backgroundColor: colors.primaryLight,
    borderRadius:    radius.full,
  },
  ytdText: {
    fontFamily: font.semiBold,
    fontSize:   12,
    color:      colors.primary,
  },
  empty: {
    flex:            1,
    alignItems:      'center',
    justifyContent:  'center',
    padding:         spacing.xl,
    gap:             spacing.md,
    backgroundColor: colors.background,
  },
  emptyTitle: {
    fontFamily: font.bold,
    fontSize:   20,
    color:      colors.text,
    textAlign:  'center',
  },
  emptyBody: {
    fontFamily: font.regular,
    fontSize:   15,
    color:      colors.textSecondary,
    textAlign:  'center',
    lineHeight: 22,
  },
  cta: {
    marginTop:         spacing.sm,
    paddingVertical:   spacing.sm,
    paddingHorizontal: spacing.lg,
    backgroundColor:   colors.primary,
    borderRadius:      radius.full,
  },
  ctaText: {
    fontFamily: font.bold,
    fontSize:   15,
    color:      colors.textOnColor,
  },
});
