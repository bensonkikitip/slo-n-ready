/**
 * Trends screen — spending comparison across time periods.
 *
 * Shows how spending has changed vs last month, same month last year,
 * or a 3-month average, with Rachey's encouraging commentary.
 *
 * Terminology: UI uses "spending goal" — DB table stays `budgets`.
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  ActivityIndicator, SafeAreaView,
} from 'react-native';
import { useRouter } from 'expo-router';
import { getAllCategories }               from '../src/db/queries/categories';
import { getDistinctMonths }              from '../src/db/queries/transactions';
import { getCategorySpendingForMonth,
         getBudgetsForAllAccountsYear }   from '../src/db/queries/budgets';
import { addMonths, monthLabel }          from '../src/domain/month';
import {
  buildTrendRows,
  getRacheyOverallMessage,
  averageSpendingPeriods,
  TrendRow,
} from '../src/domain/trends';
import { RacheyInsightCard }   from '../src/components/RacheyInsightCard';
import { TrendCategoryRow }    from '../src/components/TrendCategoryRow';
import { Sloth }               from '../src/components/Sloth';
import { centsToDollars }      from '../src/domain/money';
import { colors, font, spacing, radius } from '../src/theme';
import type { Category }  from '../src/db/queries/categories';
import type { Budget }    from '../src/db/queries/budgets';

// ─── Types ────────────────────────────────────────────────────────────────────

type ComparisonMode = 'last_month' | 'same_month_last_year' | 'three_month_avg';

interface TrendsData {
  currentMonth:    string;
  previousLabel:   string;
  rows:            TrendRow[];
  totalCurrentCents:  number;
  totalPreviousCents: number;
  budgetsByCategory: Map<string, number>; // category_id → spending goal cents
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function TrendsScreen() {
  const router = useRouter();

  const [mode,          setMode]          = useState<ComparisonMode>('last_month');
  const [data,          setData]          = useState<TrendsData | null>(null);
  const [categories,    setCategories]    = useState<Category[]>([]);
  const [monthCount,    setMonthCount]    = useState(0);
  const [loading,       setLoading]       = useState(true);
  const [error,         setError]         = useState<string | null>(null);

  // ── Load base data (categories + month list) ──────────────────────────────

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [cats, months] = await Promise.all([
          getAllCategories(),
          getDistinctMonths(),
        ]);
        if (cancelled) return;
        setCategories(cats);
        setMonthCount(months.length);
      } catch (e: any) {
        if (!cancelled) setError(e.message ?? 'Could not load data');
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // ── Load trend data whenever mode or categories change ────────────────────

  const loadTrends = useCallback(async () => {
    if (categories.length === 0) return;
    setLoading(true);
    setError(null);
    try {
      const months = await getDistinctMonths();
      if (months.length === 0) {
        setData(null);
        return;
      }

      const currentMonth = months[0].month; // newest first
      let previousLabel: string;
      let previousData:  Array<{ category_id: string; total_cents: number }>;

      if (mode === 'last_month') {
        const prevMonth = addMonths(currentMonth, -1);
        previousLabel   = monthLabel(prevMonth);
        previousData    = await getCategorySpendingForMonth(prevMonth);

      } else if (mode === 'same_month_last_year') {
        const prevMonth = addMonths(currentMonth, -12);
        previousLabel   = monthLabel(prevMonth);
        previousData    = await getCategorySpendingForMonth(prevMonth);

      } else {
        // 3-month average
        const [p1, p2, p3] = await Promise.all([
          getCategorySpendingForMonth(addMonths(currentMonth, -1)),
          getCategorySpendingForMonth(addMonths(currentMonth, -2)),
          getCategorySpendingForMonth(addMonths(currentMonth, -3)),
        ]);
        previousLabel = '3-month avg';
        previousData  = averageSpendingPeriods([p1, p2, p3]);
      }

      const currentData = await getCategorySpendingForMonth(currentMonth);

      // Spending goals for the current month
      const year       = currentMonth.slice(0, 4);
      const budgetRows = await getBudgetsForAllAccountsYear(year);
      const budgetsForMonth = budgetRows.filter(b => b.month === currentMonth);
      const budgetsByCategory = new Map(
        budgetsForMonth.map(b => [b.category_id, b.amount_cents]),
      );

      const rows = buildTrendRows(currentData, previousData, categories);

      // Total expenses only (negative amounts) for overall message
      const totalCurrentCents  = rows
        .filter(r => r.current_cents  < 0)
        .reduce((s, r) => s + r.current_cents, 0);
      const totalPreviousCents = rows
        .filter(r => r.previous_cents < 0)
        .reduce((s, r) => s + r.previous_cents, 0);

      setData({
        currentMonth,
        previousLabel,
        rows,
        totalCurrentCents,
        totalPreviousCents,
        budgetsByCategory,
      });
    } catch (e: any) {
      setError(e.message ?? 'Could not load trends');
    } finally {
      setLoading(false);
    }
  }, [mode, categories]);

  useEffect(() => {
    loadTrends();
  }, [loadTrends]);

  // ── Helpers ───────────────────────────────────────────────────────────────

  const catMap = new Map(categories.map(c => [c.id, c]));

  const showLastYear = monthCount > 11;

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <SafeAreaView style={styles.safe}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} hitSlop={8}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Trends</Text>
        <View style={styles.backBtn} /> {/* spacer */}
      </View>

      {/* Comparison mode selector */}
      <View style={styles.pillRow}>
        <PillButton
          label="vs last month"
          active={mode === 'last_month'}
          onPress={() => setMode('last_month')}
        />
        {showLastYear && (
          <PillButton
            label="vs last year"
            active={mode === 'same_month_last_year'}
            onPress={() => setMode('same_month_last_year')}
          />
        )}
        <PillButton
          label="vs 3-month avg"
          active={mode === 'three_month_avg'}
          onPress={() => setMode('three_month_avg')}
        />
      </View>

      {/* Body */}
      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator color={colors.primary} size="large" />
        </View>
      ) : error ? (
        <View style={styles.centered}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : !data || data.rows.length === 0 ? (
        <EmptyState />
      ) : (
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          {/* Rachey insight card */}
          <RacheyInsightCard
            message={getRacheyOverallMessage(data.totalCurrentCents, data.totalPreviousCents)}
            currentLabel={monthLabel(data.currentMonth)}
            previousLabel={data.previousLabel}
            currentCents={data.totalCurrentCents}
            previousCents={data.totalPreviousCents}
            isGoodNews={Math.abs(data.totalCurrentCents) <= Math.abs(data.totalPreviousCents)}
          />

          {/* Category rows */}
          <Text style={styles.sectionLabel}>BY CATEGORY</Text>

          <View style={styles.card}>
            {data.rows.map((row, i) => {
              const cat       = catMap.get(row.category_id);
              const goalCents = data.budgetsByCategory.get(row.category_id);
              return (
                <View key={row.category_id}>
                  {i > 0 && <View style={styles.separator} />}
                  <TrendCategoryRow
                    row={row}
                    categoryEmoji={cat?.emoji ?? null}
                  />
                  {/* Spending goal pill */}
                  {goalCents !== undefined && goalCents !== 0 && (
                    <GoalPill
                      actualCents={row.current_cents}
                      goalCents={goalCents}
                    />
                  )}
                </View>
              );
            })}
          </View>

          <View style={styles.bottomPad} />
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function PillButton({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity
      style={[styles.pill, active && styles.pillActive]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <Text style={[styles.pillText, active && styles.pillTextActive]}>{label}</Text>
    </TouchableOpacity>
  );
}

function GoalPill({ actualCents, goalCents }: { actualCents: number; goalCents: number }) {
  // Both are signed; expenses negative, income positive.
  // For expenses: goal is negative (e.g. −50000); over-budget = actual < goal (more negative)
  // For income:   goal is positive;               over-goal   = actual > goal
  const isExpense = goalCents < 0;
  const overGoal  = isExpense ? actualCents < goalCents : actualCents < goalCents;

  let label: string;
  let bgColor: string;
  let textColor: string;

  if (!overGoal) {
    label     = '✓ under goal';
    bgColor   = colors.primaryLight;
    textColor = colors.income;
  } else {
    const overPct = goalCents !== 0
      ? Math.abs((actualCents - goalCents) / goalCents)
      : 1;
    if (overPct <= 0.2) {
      label     = '↑ slightly over';
      bgColor   = '#FFF8E6';
      textColor = '#B8860B';
    } else {
      label     = '↑ over goal';
      bgColor   = colors.accentLight;
      textColor = colors.expense;
    }
  }

  return (
    <View style={[styles.goalPill, { backgroundColor: bgColor }]}>
      <Text style={[styles.goalPillText, { color: textColor }]}>{label}</Text>
    </View>
  );
}

function EmptyState() {
  return (
    <View style={styles.emptyState}>
      <Sloth sloth="sleeping" size={120} />
      <Text style={styles.emptyTitle}>Not enough history yet</Text>
      <Text style={styles.emptyBody}>
        Keep importing and I'll track your trends 💤
      </Text>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe: {
    flex:            1,
    backgroundColor: colors.background,
  },

  header: {
    flexDirection:     'row',
    alignItems:        'center',
    justifyContent:    'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical:   spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.separator,
  },
  backBtn: {
    minWidth: 60,
  },
  backText: {
    fontFamily: font.semiBold,
    fontSize:   15,
    color:      colors.primary,
  },
  title: {
    fontFamily: font.extraBold,
    fontSize:   18,
    color:      colors.text,
  },

  pillRow: {
    flexDirection:     'row',
    paddingHorizontal: spacing.md,
    paddingVertical:   spacing.sm,
    gap:               spacing.xs,
  },
  pill: {
    borderRadius:      radius.full,
    paddingVertical:   7,
    paddingHorizontal: spacing.sm,
    borderWidth:       1,
    borderColor:       colors.border,
    backgroundColor:   colors.surface,
  },
  pillActive: {
    backgroundColor: colors.primary,
    borderColor:     colors.primary,
  },
  pillText: {
    fontFamily: font.semiBold,
    fontSize:   13,
    color:      colors.textSecondary,
  },
  pillTextActive: {
    color: colors.textOnColor,
  },

  centered: {
    flex:           1,
    justifyContent: 'center',
    alignItems:     'center',
    padding:        spacing.xl,
  },
  errorText: {
    fontFamily: font.regular,
    fontSize:   15,
    color:      colors.textSecondary,
    textAlign:  'center',
  },

  scroll: { flex: 1 },
  scrollContent: {
    padding:        spacing.md,
    gap:            spacing.sm,
    paddingBottom:  spacing.xxl,
  },

  sectionLabel: {
    fontFamily:    font.semiBold,
    fontSize:      11,
    color:         colors.textTertiary,
    letterSpacing: 0.8,
    marginTop:     spacing.xs,
    marginLeft:    spacing.xs,
  },

  card: {
    backgroundColor: colors.surface,
    borderRadius:    radius.lg,
    borderWidth:     1,
    borderColor:     colors.border,
    overflow:        'hidden',
  },
  separator: {
    height:          1,
    backgroundColor: colors.separator,
    marginLeft:      spacing.md,
  },

  goalPill: {
    alignSelf:         'flex-start',
    marginLeft:        spacing.md + 28 + spacing.sm, // align with text, past emoji
    marginBottom:      8,
    borderRadius:      radius.full,
    paddingVertical:   3,
    paddingHorizontal: 10,
  },
  goalPillText: {
    fontFamily: font.semiBold,
    fontSize:   11,
  },

  emptyState: {
    flex:           1,
    justifyContent: 'center',
    alignItems:     'center',
    gap:            spacing.sm,
    padding:        spacing.xl,
  },
  emptyTitle: {
    fontFamily: font.bold,
    fontSize:   18,
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

  bottomPad: { height: spacing.xl },
});
