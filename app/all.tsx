import React, { useCallback, useMemo, useRef, useState } from 'react';
import { View, FlatList, Text, StyleSheet, ActivityIndicator, Alert, TouchableOpacity, TextInput } from 'react-native';
import { useFocusEffect, Stack, useRouter } from 'expo-router';
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
import { CategoryPicker, NONE_FILTER } from '../src/components/CategoryPicker';
import { TransactionRow } from '../src/components/TransactionRow';
import { CategoryPickerSheet } from '../src/components/CategoryPickerSheet';
import { Sloth } from '../src/components/Sloth';
import { writeBackup } from '../src/db/backup';
import { colors, font, spacing, radius } from '../src/theme';
import { centsToDollars } from '../src/domain/money';

export default function AllAccountsScreen() {
  const insets  = useSafeAreaInsets();
  const router  = useRouter();
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
  const [searchText,            setSearchText]            = useState('');
  const [breakdownOpen,         setBreakdownOpen]         = useState(false);

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
    setSearchText('');
    setTransactions(await getAllTransactionsForMonth(month));
  }

  async function handleYearChange(year: string) {
    updateYear(year);
    updateMode('year');
    setCategoryFilters([]);
    setSearchText('');
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

  const hasUncategorized = useMemo(() =>
    transactions.some(t => t.category_id === null && t.dropped_at === null),
  [transactions]);

  const filteredTransactions = useMemo(() => {
    if (categoryFilters.length === 0) return transactions;
    const noneSelected = categoryFilters.includes(NONE_FILTER);
    const realFilters  = categoryFilters.filter(f => f !== NONE_FILTER);
    return transactions.filter(t =>
      (noneSelected && t.category_id === null) ||
      (realFilters.length > 0 && t.category_id !== null && realFilters.includes(t.category_id)),
    );
  }, [transactions, categoryFilters]);

  const displayedTransactions = useMemo(() => {
    const q = searchText.trim().toLowerCase();
    if (!q) return filteredTransactions;
    return filteredTransactions.filter(t => t.description.toLowerCase().includes(q));
  }, [filteredTransactions, searchText]);

  const monthSummary = useMemo(() => {
    const active = displayedTransactions.filter(t => t.dropped_at === null);
    return {
      income_cents:  active.filter(t => t.amount_cents > 0).reduce((s, t) => s + t.amount_cents, 0),
      expense_cents: active.filter(t => t.amount_cents < 0).reduce((s, t) => s + t.amount_cents, 0),
      net_cents:     active.reduce((s, t) => s + t.amount_cents, 0),
    };
  }, [displayedTransactions]);

  const categoryTotals = useMemo(() => {
    const map = new Map<string, number>();
    for (const t of transactions) {
      if (t.dropped_at !== null) continue;
      const key = t.category_id ?? '__none__';
      map.set(key, (map.get(key) ?? 0) + t.amount_cents);
    }
    return Array.from(map.entries())
      .filter(([, total]) => total !== 0)
      .map(([key, total]) => {
        if (key === '__none__') return { key, name: 'Uncategorized', color: null, total };
        const cat = categoryMap[key];
        return { key, name: cat?.name ?? 'Unknown', color: cat?.color ?? null, total };
      })
      .sort((a, b) => Math.abs(b.total) - Math.abs(a.total));
  }, [transactions, categoryMap]);

  async function handleCategorySelect(categoryId: string | null) {
    if (!selectedTransactionId) return;
    const tx = transactions.find(t => t.id === selectedTransactionId);
    if (tx?.category_id === categoryId) { setSelectedTransactionId(null); return; }
    const wasUncategorized = tx?.category_id == null;
    await setTransactionCategory(selectedTransactionId, categoryId, true, null);
    setTransactions(prev => prev.map(t =>
      t.id === selectedTransactionId
        ? { ...t, category_id: categoryId, category_set_manually: 1, applied_rule_id: null }
        : t,
    ));
    setSelectedTransactionId(null);
    void writeBackup();
    if (wasUncategorized && categoryId && tx?.description && tx?.account_id) {
      Alert.alert(
        'Create a rule?',
        `Want to automatically categorize future transactions containing "${tx.description}"?`,
        [
          { text: 'No thanks', style: 'cancel' },
          {
            text: 'Create Rule',
            onPress: () => router.push({
              pathname: `/account/${tx.account_id}/rules`,
              params: { prefillText: tx.description, prefillCategory: categoryId },
            }),
          },
        ],
      );
    }
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
            {(categoriesInPeriod.length > 0 || hasUncategorized) && (
              <CategoryPicker
                categories={categoriesInPeriod}
                selected={categoryFilters}
                onSelect={setCategoryFilters}
                showNone={hasUncategorized}
              />
            )}
          </View>
        )}

        {categoryTotals.length > 0 && (
          <View style={styles.breakdown}>
            <TouchableOpacity
              style={styles.breakdownHeader}
              onPress={() => setBreakdownOpen(o => !o)}
              activeOpacity={0.7}
            >
              <Text style={styles.breakdownTitle}>Totals by Category</Text>
              <Text style={styles.breakdownChevron}>{breakdownOpen ? '▲' : '▼'}</Text>
            </TouchableOpacity>

            {breakdownOpen && categoryTotals.map(row => (
              <TouchableOpacity
                key={row.key}
                style={styles.breakdownRow}
                activeOpacity={0.7}
                onPress={() => { setCategoryFilters([row.key]); setBreakdownOpen(false); }}
              >
                {row.color
                  ? <View style={[styles.breakdownDot, { backgroundColor: row.color }]} />
                  : <View style={[styles.breakdownDot, styles.breakdownDotEmpty]} />
                }
                <Text style={styles.breakdownName} numberOfLines={1}>{row.name}</Text>
                <Text style={[styles.breakdownAmount, { color: row.total >= 0 ? colors.income : colors.text }]}>
                  {centsToDollars(row.total)}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {transactions.length > 0 && (
          <View style={styles.searchBar}>
            <Text style={styles.searchIcon}>⌕</Text>
            <TextInput
              style={styles.searchInput}
              placeholder="Search transactions…"
              placeholderTextColor={colors.textTertiary}
              value={searchText}
              onChangeText={setSearchText}
              clearButtonMode="while-editing"
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="search"
            />
          </View>
        )}

        <SummaryBar
          incomeCents={monthSummary.income_cents}
          expenseCents={monthSummary.expense_cents}
          netCents={monthSummary.net_cents}
        />

        <FlatList
          data={displayedTransactions}
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
            displayedTransactions.length === 0 && styles.emptyContainer,
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
                  : searchText.trim()
                  ? "No transactions match your search."
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

  breakdown: {
    borderBottomWidth: 1,
    borderBottomColor: colors.separator,
    backgroundColor:   colors.surface,
  },
  breakdownHeader: {
    flexDirection:     'row',
    alignItems:        'center',
    justifyContent:    'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical:   11,
  },
  breakdownTitle: {
    fontFamily: font.semiBold,
    fontSize:   14,
    color:      colors.textSecondary,
    letterSpacing: 0.3,
  },
  breakdownChevron: {
    fontSize: 10,
    color:    colors.textTertiary,
  },
  breakdownRow: {
    flexDirection:     'row',
    alignItems:        'center',
    paddingHorizontal: spacing.md,
    paddingVertical:   9,
    borderTopWidth:    1,
    borderTopColor:    colors.separator,
    gap:               spacing.sm,
  },
  breakdownDot: {
    width: 10, height: 10, borderRadius: radius.full, flexShrink: 0,
  },
  breakdownDotEmpty: {
    borderWidth: 1, borderColor: colors.border,
  },
  breakdownName: {
    fontFamily: font.regular,
    fontSize:   14,
    color:      colors.text,
    flex:       1,
  },
  breakdownAmount: {
    fontFamily: font.semiBold,
    fontSize:   14,
  },

  searchBar: {
    flexDirection:     'row',
    alignItems:        'center',
    paddingHorizontal: spacing.md,
    paddingVertical:   spacing.sm,
    gap:               spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.separator,
    backgroundColor:   colors.surface,
  },
  searchIcon: {
    fontSize:  19,
    color:     colors.textTertiary,
    marginTop: 1,
  },
  searchInput: {
    flex:       1,
    fontFamily: font.regular,
    fontSize:   15,
    color:      colors.text,
    paddingVertical: 4,
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
