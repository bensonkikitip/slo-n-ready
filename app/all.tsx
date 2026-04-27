import React, { useCallback, useMemo, useRef, useState } from 'react';
import { View, FlatList, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { useFocusEffect, Stack } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Account, Transaction, Category,
  getAllAccounts, getDistinctMonths, getAllTransactionsForMonth,
  getDistinctYears, getAllTransactionsForYear,
  getAllCategories, setTransactionCategory,
} from '../src/db/queries';
import { buildMonthList, buildYearList, MonthEntry, YearEntry } from '../src/domain/month';
import { FilterMode } from '../src/components/MonthPicker';
import { SummaryBar } from '../src/components/SummaryBar';
import { MonthPicker } from '../src/components/MonthPicker';
import { CategoryPicker } from '../src/components/CategoryPicker';
import { TransactionRow } from '../src/components/TransactionRow';
import { CategoryPickerSheet } from '../src/components/CategoryPickerSheet';
import { Sloth } from '../src/components/Sloth';
import { writeBackup } from '../src/db/backup';
import { colors, font, spacing } from '../src/theme';

export default function AllAccountsScreen() {
  const insets = useSafeAreaInsets();
  const [accounts,              setAccounts]              = useState<Account[]>([]);
  const [transactions,          setTransactions]          = useState<Transaction[]>([]);
  const [months,                setMonths]                = useState<MonthEntry[]>([]);
  const [years,                 setYears]                 = useState<YearEntry[]>([]);
  const [selectedMonth,         setSelectedMonth]         = useState('');
  const [selectedYear,          setSelectedYear]          = useState('');
  const [filterMode,            setFilterMode]            = useState<FilterMode>('month');
  const [categories,            setCategories]            = useState<Category[]>([]);
  const [selectedTransactionId, setSelectedTransactionId] = useState<string | null>(null);
  const [categoryFilters,       setCategoryFilters]       = useState<string[]>([]);
  const [loading,               setLoading]               = useState(true);
  const [hasAnyData,            setHasAnyData]            = useState(false);

  const selectedMonthRef = useRef('');
  const selectedYearRef  = useRef('');
  const filterModeRef    = useRef<FilterMode>('month');

  function updateMonth(m: string)    { selectedMonthRef.current = m; setSelectedMonth(m); }
  function updateYear(y: string)     { selectedYearRef.current  = y; setSelectedYear(y);  }
  function updateMode(m: FilterMode) { filterModeRef.current    = m; setFilterMode(m);    }

  useFocusEffect(useCallback(() => {
    let active = true;
    (async () => {
      const [accts, dbMonths, dbYears, cats] = await Promise.all([
        getAllAccounts(), getDistinctMonths(), getDistinctYears(), getAllCategories(),
      ]);
      if (!active) return;

      const monthList = buildMonthList(dbMonths);
      const yearList  = buildYearList(dbYears);

      const curMonth = selectedMonthRef.current;
      const curYear  = selectedYearRef.current;
      const curMode  = filterModeRef.current;

      const month = (curMonth && monthList.some(m => m.key === curMonth))
        ? curMonth : monthList.find(m => m.count > 0)?.key ?? '';
      const year  = (curYear && yearList.some(y => y.key === curYear))
        ? curYear : yearList[0]?.key ?? '';

      setAccounts(accts);
      setMonths(monthList);
      setYears(yearList);
      setCategories(cats);
      setHasAnyData(dbMonths.length > 0);
      updateMonth(month);
      updateYear(year);

      const period = curMode === 'year' ? year : month;
      const txns = period
        ? await (curMode === 'year'
            ? getAllTransactionsForYear(period)
            : getAllTransactionsForMonth(period))
        : [];
      if (!active) return;
      setTransactions(txns);
      setLoading(false);
    })();
    return () => { active = false; };
  }, []));

  async function handleMonthChange(month: string) {
    updateMonth(month);
    updateMode('month');
    setCategoryFilters([]);
    setTransactions(await getAllTransactionsForMonth(month));
  }

  async function handleYearChange(year: string) {
    updateYear(year);
    updateMode('year');
    setCategoryFilters([]);
    setTransactions(await getAllTransactionsForYear(year));
  }

  const accountMap = useMemo(
    () => Object.fromEntries(accounts.map(a => [a.id, a])),
    [accounts],
  );

  const categoryMap = useMemo(
    () => Object.fromEntries(categories.map(c => [c.id, c])),
    [categories],
  );

  const categoriesInPeriod = useMemo(() => {
    const ids = new Set(
      transactions.filter(t => t.category_id && t.dropped_at === null).map(t => t.category_id!),
    );
    return categories.filter(c => ids.has(c.id));
  }, [transactions, categories]);

  const filteredTransactions = useMemo(() =>
    categoryFilters.length > 0
      ? transactions.filter(t => t.category_id !== null && categoryFilters.includes(t.category_id))
      : transactions,
  [transactions, categoryFilters]);

  const monthSummary = useMemo(() => {
    const active = filteredTransactions.filter(t => t.dropped_at === null);
    return {
      income_cents:  active.filter(t => t.amount_cents > 0).reduce((s, t) => s + t.amount_cents, 0),
      expense_cents: active.filter(t => t.amount_cents < 0).reduce((s, t) => s + t.amount_cents, 0),
      net_cents:     active.reduce((s, t) => s + t.amount_cents, 0),
    };
  }, [filteredTransactions]);

  async function handleCategorySelect(categoryId: string | null) {
    if (!selectedTransactionId) return;
    const tx = transactions.find(t => t.id === selectedTransactionId);
    if (tx?.category_id === categoryId) { setSelectedTransactionId(null); return; }
    await setTransactionCategory(selectedTransactionId, categoryId, true, null);
    setTransactions(prev => prev.map(t =>
      t.id === selectedTransactionId
        ? { ...t, category_id: categoryId, category_set_manually: 1, applied_rule_id: null }
        : t,
    ));
    setSelectedTransactionId(null);
    void writeBackup();
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <Sloth sloth="sleeping" size={80} />
        <ActivityIndicator style={{ marginTop: spacing.md }} color={colors.primary} />
      </View>
    );
  }

  const showPickers = months.length > 0 || years.length > 0;

  return (
    <>
      <Stack.Screen options={{ title: 'All Accounts' }} />
      <View style={styles.container}>
        {showPickers && (
          <View style={styles.pickerRow}>
            <MonthPicker
              months={months}
              years={years}
              filterMode={filterMode}
              selectedMonth={selectedMonth}
              selectedYear={selectedYear}
              onChangeMonth={handleMonthChange}
              onChangeYear={handleYearChange}
            />
            {categoriesInPeriod.length > 0 && (
              <CategoryPicker
                categories={categoriesInPeriod}
                selected={categoryFilters}
                onSelect={setCategoryFilters}
              />
            )}
          </View>
        )}

        <SummaryBar
          incomeCents={monthSummary.income_cents}
          expenseCents={monthSummary.expense_cents}
          netCents={monthSummary.net_cents}
        />

        <FlatList
          data={filteredTransactions}
          keyExtractor={item => item.id}
          renderItem={({ item }) => (
            <TransactionRow
              transaction={item}
              accountBadge={accountMap[item.account_id]?.name}
              category={item.category_id ? categoryMap[item.category_id] ?? null : null}
              onPress={() => setSelectedTransactionId(item.id)}
            />
          )}
          contentContainerStyle={[
            filteredTransactions.length === 0 && styles.emptyContainer,
            { paddingBottom: insets.bottom + spacing.lg },
          ]}
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Sloth sloth="meditating" size={130} />
              <Text style={styles.emptyTitle}>
                {!hasAnyData ? "I'm ready when you are!" : 'Nothing here'}
              </Text>
              <Text style={styles.emptyBody}>
                {!hasAnyData
                  ? "Import a CSV from one of your accounts and I'll show everything together here."
                  : categoryFilters.length > 0
                  ? "No transactions match the selected categories."
                  : "I don't see any transactions for this period — try a different one."}
              </Text>
            </View>
          }
        />
      </View>

      <CategoryPickerSheet
        visible={selectedTransactionId !== null}
        categories={categories}
        currentCategoryId={
          transactions.find(t => t.id === selectedTransactionId)?.category_id ?? null
        }
        onClose={() => setSelectedTransactionId(null)}
        onSelect={handleCategorySelect}
        onCategoryCreated={cat => setCategories(prev => [...prev, cat].sort((a, b) => a.name.localeCompare(b.name)))}
      />
    </>
  );
}

const styles = StyleSheet.create({
  container:      { flex: 1, backgroundColor: colors.background },
  center:         { flex: 1, justifyContent: 'center', alignItems: 'center', gap: spacing.md, backgroundColor: colors.background },
  pickerRow: {
    flexDirection:     'row',
    alignItems:        'center',
    paddingHorizontal: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.separator,
  },
  emptyContainer: { flex: 1 },
  emptyState: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: spacing.xl, gap: spacing.md,
  },
  emptyTitle: { fontFamily: font.bold, fontSize: 20, color: colors.text },
  emptyBody: {
    fontFamily: font.regular, fontSize: 15, color: colors.textSecondary,
    textAlign: 'center', lineHeight: 22,
  },
});
