import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  View, Text, FlatList, TouchableOpacity,
  StyleSheet, ActivityIndicator, Alert, Modal,
} from 'react-native';
import { useRouter, useLocalSearchParams, useFocusEffect, Stack } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Account, Transaction, Category,
  getAllAccounts, deleteAccount,
  getDistinctMonths, getTransactionsForMonth,
  getDistinctYears, getTransactionsForYear,
  getAllCategories, setTransactionCategory, bulkManualSetCategory,
} from '../../../src/db/queries';
import { writeBackup } from '../../../src/db/backup';
import { buildMonthList, buildYearList, MonthEntry, YearEntry } from '../../../src/domain/month';
import { SummaryBar } from '../../../src/components/SummaryBar';
import { MonthPicker, FilterMode } from '../../../src/components/MonthPicker';
import { CategoryPicker, NONE_FILTER } from '../../../src/components/CategoryPicker';
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
  const [menuOpen,              setMenuOpen]              = useState(false);
  const [bulkMode,              setBulkMode]              = useState(false);
  const [selectedIds,           setSelectedIds]           = useState<Set<string>>(new Set());
  const [bulkPickerVisible,     setBulkPickerVisible]     = useState(false);

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

  const hasUncategorized = useMemo(() =>
    transactions.some(t => t.category_id === null && t.dropped_at === null),
  [transactions]);

  const filteredTransactions = useMemo(() => {
    if (categoryFilters.length === 0) return transactions;
    const noneSelected  = categoryFilters.includes(NONE_FILTER);
    const realFilters   = categoryFilters.filter(f => f !== NONE_FILTER);
    return transactions.filter(t =>
      (noneSelected && t.category_id === null) ||
      (realFilters.length > 0 && t.category_id !== null && realFilters.includes(t.category_id)),
    );
  }, [transactions, categoryFilters]);

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

  function toggleSelectId(txId: string) {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(txId)) next.delete(txId); else next.add(txId);
      return next;
    });
  }

  function exitBulkMode() {
    setBulkMode(false);
    setSelectedIds(new Set());
  }

  async function handleBulkCategorySelect(categoryId: string | null) {
    const ids = Array.from(selectedIds);
    await bulkManualSetCategory(ids, categoryId);
    setTransactions(prev => prev.map(t =>
      selectedIds.has(t.id)
        ? { ...t, category_id: categoryId, category_set_manually: 1, applied_rule_id: null }
        : t,
    ));
    exitBulkMode();
    setBulkPickerVisible(false);
    void writeBackup();
  }

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
    const wasUncategorized = tx?.category_id == null;
    await setTransactionCategory(selectedTransactionId, categoryId, true, null);
    setTransactions(prev => prev.map(t =>
      t.id === selectedTransactionId
        ? { ...t, category_id: categoryId, category_set_manually: 1, applied_rule_id: null }
        : t,
    ));
    setSelectedTransactionId(null);
    void writeBackup();
    if (wasUncategorized && categoryId && tx?.description) {
      Alert.alert(
        'Create a rule?',
        `Want to automatically categorize future transactions containing "${tx.description}"?`,
        [
          { text: 'No thanks', style: 'cancel' },
          {
            text: 'Create Rule',
            onPress: () => router.push({
              pathname: `/account/${id}/rules`,
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
          title: bulkMode ? `${selectedIds.size} selected` : account.name,
          headerRight: () =>
            bulkMode ? (
              <TouchableOpacity onPress={exitBulkMode} hitSlop={12}>
                <Text style={styles.editBtn}>Done</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity onPress={() => setMenuOpen(true)} hitSlop={12}>
                <Text style={styles.menuDots}>•••</Text>
              </TouchableOpacity>
            ),
        }}
      />

      {/* Action menu dropdown */}
      <Modal visible={menuOpen} transparent animationType="fade" onRequestClose={() => setMenuOpen(false)}>
        <TouchableOpacity style={styles.menuBackdrop} activeOpacity={1} onPress={() => setMenuOpen(false)} />
        <View style={[styles.menuCard, { top: insets.top + 44 + 6 }]}>
          <TouchableOpacity style={styles.menuItem} onPress={() => { setMenuOpen(false); router.push(`/account/${id}/rules`); }}>
            <Text style={styles.menuItemText}>Rules</Text>
          </TouchableOpacity>
          <View style={styles.menuDivider} />
          <TouchableOpacity style={styles.menuItem} onPress={() => { setMenuOpen(false); router.push(`/account/${id}/edit`); }}>
            <Text style={styles.menuItemText}>Edit</Text>
          </TouchableOpacity>
          <View style={styles.menuDivider} />
          <TouchableOpacity style={styles.menuItem} onPress={() => { setMenuOpen(false); setBulkMode(true); }}>
            <Text style={styles.menuItemText}>Bulk Edit</Text>
          </TouchableOpacity>
          <View style={styles.menuDivider} />
          <TouchableOpacity style={styles.menuItem} onPress={() => { setMenuOpen(false); handleDelete(); }}>
            <Text style={[styles.menuItemText, { color: colors.destructive }]}>Delete</Text>
          </TouchableOpacity>
        </View>
      </Modal>
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
              onPress={bulkMode ? () => toggleSelectId(item.id) : () => setSelectedTransactionId(item.id)}
              bulkMode={bulkMode}
              selected={selectedIds.has(item.id)}
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

        {bulkMode ? (
          <TouchableOpacity
            style={[
              styles.importFab,
              { bottom: insets.bottom + spacing.lg, backgroundColor: accent },
              selectedIds.size === 0 && styles.fabDisabled,
            ]}
            onPress={() => selectedIds.size > 0 && setBulkPickerVisible(true)}
            activeOpacity={0.85}
          >
            <Text style={styles.importFabText}>
              Bulk Categorize{selectedIds.size > 0 ? ` (${selectedIds.size})` : ''}
            </Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={[styles.importFab, { bottom: insets.bottom + spacing.lg, backgroundColor: accent }]}
            onPress={() => router.push(`/account/${id}/import`)}
            activeOpacity={0.85}
          >
            <Text style={styles.importFabText}>Import CSV</Text>
          </TouchableOpacity>
        )}
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

      <CategoryPickerSheet
        visible={bulkPickerVisible}
        categories={categories}
        currentCategoryId={null}
        onClose={() => setBulkPickerVisible(false)}
        onSelect={handleBulkCategorySelect}
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

  menuDots: {
    fontFamily:  font.bold,
    fontSize:    18,
    color:       colors.primary,
    letterSpacing: 2,
    marginRight: 4,
  },
  editBtn: { fontFamily: font.semiBold, fontSize: 15, color: colors.primary },

  menuBackdrop: { ...StyleSheet.absoluteFillObject },
  menuCard: {
    position:          'absolute',
    right:             spacing.md,
    backgroundColor:   colors.surface,
    borderRadius:      radius.md,
    shadowColor:       '#000',
    shadowOffset:      { width: 0, height: 4 },
    shadowOpacity:     0.15,
    shadowRadius:      12,
    elevation:         8,
    minWidth:          160,
    overflow:          'hidden',
  },
  menuItem: {
    paddingVertical:   14,
    paddingHorizontal: spacing.md,
  },
  menuItemText: { fontFamily: font.semiBold, fontSize: 15, color: colors.text },
  menuDivider:  { height: 1, backgroundColor: colors.separator },

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
  fabDisabled:   { opacity: 0.45 },
});
