import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  View, Text, FlatList, TouchableOpacity,
  StyleSheet, ActivityIndicator, Alert,
} from 'react-native';
import { useRouter, useLocalSearchParams, useFocusEffect, Stack } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Account, Transaction, Category,
  getAllAccounts, deleteAccount,
  getDistinctMonths, getTransactionsForMonth,
  getDistinctYears, getTransactionsForYear,
  getAllCategories, setTransactionCategory,
} from '../../../src/db/queries';
import { writeBackup } from '../../../src/db/backup';
import { buildMonthList, buildYearList, MonthEntry, YearEntry } from '../../../src/domain/month';
import { SummaryBar } from '../../../src/components/SummaryBar';
import { MonthPicker, FilterMode } from '../../../src/components/MonthPicker';
import { CategoryPicker } from '../../../src/components/CategoryPicker';
import { TransactionRow } from '../../../src/components/TransactionRow';
import { CategoryPickerSheet } from '../../../src/components/CategoryPickerSheet';
import { Sloth } from '../../../src/components/Sloth';
import { colors, font, spacing, radius, accountColor } from '../../../src/theme';

export default function AccountDetailScreen() {
  const { id }   = useLocalSearchParams<{ id: string }>();
  const router   = useRouter();
  const insets   = useSafeAreaInsets();
  const [account,               setAccount]               = useState<Account | null>(null);
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

  const selectedMonthRef = useRef('');
  const selectedYearRef  = useRef('');
  const filterModeRef    = useRef<FilterMode>('month');

  function updateMonth(m: string)      { selectedMonthRef.current = m; setSelectedMonth(m); }
  function updateYear(y: string)       { selectedYearRef.current  = y; setSelectedYear(y);  }
  function updateMode(m: FilterMode)   { filterModeRef.current    = m; setFilterMode(m);    }

  useFocusEffect(useCallback(() => {
    let active = true;
    (async () => {
      const [accts, dbMonths, dbYears, cats] = await Promise.all([
        getAllAccounts(), getDistinctMonths(id), getDistinctYears(id), getAllCategories(),
      ]);
      if (!active) return;

      const acct      = accts.find(a => a.id === id) ?? null;
      const monthList = buildMonthList(dbMonths);
      const yearList  = buildYearList(dbYears);

      const curMonth = selectedMonthRef.current;
      const curYear  = selectedYearRef.current;
      const curMode  = filterModeRef.current;

      const month = (curMonth && monthList.some(m => m.key === curMonth))
        ? curMonth : monthList.find(m => m.count > 0)?.key ?? '';
      const year  = (curYear && yearList.some(y => y.key === curYear))
        ? curYear : yearList[0]?.key ?? '';

      setAccount(acct);
      setMonths(monthList);
      setYears(yearList);
      setCategories(cats);
      updateMonth(month);
      updateYear(year);

      const period = curMode === 'year' ? year : month;
      const txns = period
        ? await (curMode === 'year'
            ? getTransactionsForYear(id, period)
            : getTransactionsForMonth(id, period))
        : [];
      if (!active) return;
      setTransactions(txns);
      setLoading(false);
    })();
    return () => { active = false; };
  }, [id]));

  async function handleMonthChange(month: string) {
    updateMonth(month);
    updateMode('month');
    setCategoryFilters([]);
    setTransactions(await getTransactionsForMonth(id, month));
  }

  async function handleYearChange(year: string) {
    updateYear(year);
    updateMode('year');
    setCategoryFilters([]);
    setTransactions(await getTransactionsForYear(id, year));
  }

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

  const categoryMap = useMemo(
    () => Object.fromEntries(categories.map(c => [c.id, c])),
    [categories],
  );

  function handleDelete() {
    Alert.alert(
      'Delete Account',
      'This will permanently delete this account and all its transactions. Cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete', style: 'destructive',
          onPress: async () => { await deleteAccount(id); void writeBackup(); router.back(); },
        },
      ],
    );
  }

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

  if (!account) {
    return (
      <View style={styles.center}>
        <Sloth sloth="box" size={80} />
        <Text style={styles.notFound}>Account not found.</Text>
      </View>
    );
  }

  const accent = accountColor[account.type];
  const showPickers = months.length > 0 || years.length > 0;

  return (
    <>
      <Stack.Screen
        options={{
          title: account.name,
          headerRight: () => (
            <View style={styles.headerBtns}>
              <TouchableOpacity onPress={() => router.push(`/account/${id}/rules`)} hitSlop={12}>
                <Text style={styles.rulesBtn}>Rules</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => router.push(`/account/${id}/edit`)} hitSlop={12}>
                <Text style={styles.editBtn}>Edit</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={handleDelete} hitSlop={12}>
                <Text style={styles.deleteBtn}>Delete</Text>
              </TouchableOpacity>
            </View>
          ),
        }}
      />
      <View style={styles.container}>
        <View style={[styles.typeStrip, { backgroundColor: accent }]}>
          <Text style={styles.typeStripText}>
            {account.type === 'checking' ? 'Checking Account' : 'Credit Card'}
          </Text>
        </View>

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
              category={item.category_id ? categoryMap[item.category_id] ?? null : null}
              onPress={() => setSelectedTransactionId(item.id)}
            />
          )}
          contentContainerStyle={[
            filteredTransactions.length === 0 && styles.emptyContainer,
            { paddingBottom: insets.bottom + 88 },
          ]}
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Sloth sloth="receipt" size={120} />
              <Text style={styles.emptyTitle}>Nothing here yet!</Text>
              <Text style={styles.emptyBody}>
                {months.length === 0
                  ? "Hand me a CSV and I'll get to work sorting your transactions."
                  : categoryFilters.length > 0
                  ? "No transactions match the selected categories."
                  : "I don't see any transactions for this month — try another one or import more."}
              </Text>
            </View>
          }
        />

        <TouchableOpacity
          style={[styles.importFab, { bottom: insets.bottom + spacing.lg, backgroundColor: accent }]}
          onPress={() => router.push(`/account/${id}/import`)}
          activeOpacity={0.85}
        >
          <Text style={styles.importFabText}>Import CSV</Text>
        </TouchableOpacity>
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
  container: { flex: 1, backgroundColor: colors.background },
  center:    { flex: 1, justifyContent: 'center', alignItems: 'center', gap: spacing.md, backgroundColor: colors.background },
  notFound:  { fontFamily: font.regular, fontSize: 15, color: colors.textSecondary },

  typeStrip: { paddingVertical: 6, paddingHorizontal: spacing.md },
  typeStripText: {
    fontFamily: font.semiBold, fontSize: 12,
    color: colors.textOnColor, letterSpacing: 0.4,
  },

  headerBtns: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  rulesBtn:   { fontFamily: font.semiBold, fontSize: 15, color: colors.primary },
  editBtn:    { fontFamily: font.semiBold, fontSize: 15, color: colors.primary },
  deleteBtn:  { fontFamily: font.semiBold, fontSize: 15, color: colors.destructive, marginRight: 4 },

  pickerRow: {
    flexDirection:   'row',
    alignItems:      'center',
    paddingHorizontal: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.separator,
  },

  emptyContainer: { flex: 1 },
  emptyState: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: spacing.xl, gap: spacing.md,
  },
  emptyTitle: { fontFamily: font.bold, fontSize: 20, color: colors.text, marginTop: spacing.sm },
  emptyBody:  { fontFamily: font.regular, fontSize: 15, color: colors.textSecondary, textAlign: 'center', lineHeight: 22 },

  importFab: {
    position: 'absolute', left: spacing.lg, right: spacing.lg,
    borderRadius: radius.full, paddingVertical: 16, alignItems: 'center',
    shadowColor: '#2C2416', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2, shadowRadius: 8, elevation: 6,
  },
  importFabText: { fontFamily: font.bold, fontSize: 17, color: colors.textOnColor },
});
