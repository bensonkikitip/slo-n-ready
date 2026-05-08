/**
 * tx-edit.tsx — Transaction edit screen
 *
 * Lets the user edit any transaction's date, amount, description, and category.
 * Also provides a Delete action whose semantics depend on source:
 *   - manual (source_is_manual = 1) → hard delete (row removed)
 *   - imported (source_is_manual = 0) → soft drop (dropped_at set, row hidden
 *     from summaries but preserved for audit trail)
 *
 * Route params:
 *   id    account id
 *   txId  transaction id to edit
 */
import React, { useCallback, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  Alert, ScrollView, KeyboardAvoidingView, Platform, ActivityIndicator,
} from 'react-native';
import { useRouter, useLocalSearchParams, Stack, useFocusEffect } from 'expo-router';
import {
  Transaction,
  updateTransaction,
  setTransactionCategory,
  hardDeleteTransaction,
  softDropTransaction,
} from '../../../src/db/queries/transactions';
import { getAllCategories, Category } from '../../../src/db/queries/categories';
import { autoApplyRulesForAccount } from '../../../src/domain/rules-engine';
import { writeBackupSafe } from '../../../src/db/backup';
import { getDb } from '../../../src/db/client';
import { centsToDollars } from '../../../src/domain/money';
import { CategoryPickerSheet } from '../../../src/components/CategoryPickerSheet';
import { CategoryBadge } from '../../../src/components/CategoryBadge';
import { colors, font, spacing, radius } from '../../../src/theme';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseDollarInput(text: string): number | null {
  const cleaned = text.replace(/[$,]/g, '').trim();
  const num = parseFloat(cleaned);
  if (isNaN(num)) return null;
  return Math.round(num * 100);
}

function formatCentsForInput(cents: number): string {
  return (cents / 100).toFixed(2);
}

function isValidDate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s));
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function TxEditScreen() {
  const router = useRouter();
  const { id: accountId, txId } = useLocalSearchParams<{ id: string; txId: string }>();

  const [tx,           setTx]           = useState<Transaction | null>(null);
  const [categories,   setCategories]   = useState<Category[]>([]);
  const [loading,      setLoading]      = useState(true);

  // Editable field state — initialised from tx on load
  const [date,        setDate]        = useState('');
  const [amountText,  setAmountText]  = useState('');
  const [description, setDescription] = useState('');
  const [categoryId,  setCategoryId]  = useState<string | null>(null);
  const [catManually, setCatManually] = useState(0);

  const [saving,      setSaving]      = useState(false);
  const [deleting,    setDeleting]    = useState(false);
  const [pickerOpen,  setPickerOpen]  = useState(false);

  useFocusEffect(useCallback(() => {
    let active = true;
    (async () => {
      if (!txId) { setLoading(false); return; }
      const db = await getDb();
      const row = await db.getFirstAsync<Transaction>(
        `SELECT * FROM transactions WHERE id = ?`, txId,
      );
      const cats = await getAllCategories();
      if (!active) return;
      if (row) {
        setTx(row);
        setDate(row.date);
        setAmountText(formatCentsForInput(row.amount_cents));
        setDescription(row.description);
        setCategoryId(row.category_id ?? null);
        setCatManually(row.category_set_manually);
      }
      setCategories(cats);
      setLoading(false);
    })();
    return () => { active = false; };
  }, [txId]));

  async function handleSave() {
    if (!tx) return;
    if (!isValidDate(date)) {
      Alert.alert('Invalid date', 'Please enter a date as YYYY-MM-DD.');
      return;
    }
    const amountCents = parseDollarInput(amountText);
    if (amountCents === null || amountCents === 0) {
      Alert.alert('Invalid amount', 'Please enter a non-zero dollar amount.');
      return;
    }
    if (!description.trim()) {
      Alert.alert('Missing description', 'Please enter a description.');
      return;
    }

    setSaving(true);
    try {
      await updateTransaction(tx.id, {
        dateIso: date,
        amountCents,
        description: description.trim(),
      });
      if (categoryId !== tx.category_id || catManually !== tx.category_set_manually) {
        await setTransactionCategory(tx.id, categoryId, catManually === 1, null);
      }
      await autoApplyRulesForAccount(accountId);
      writeBackupSafe();
      router.back();
    } catch (e) {
      Alert.alert('Error saving', String(e));
    } finally {
      setSaving(false);
    }
  }

  function handleDelete() {
    if (!tx) return;
    const isManual = tx.source_is_manual === 1;
    Alert.alert(
      'Delete transaction?',
      isManual
        ? 'This will permanently remove the transaction.'
        : 'This will hide the transaction from your account. It won\'t affect your bank records.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            setDeleting(true);
            try {
              if (isManual) {
                await hardDeleteTransaction(tx.id);
              } else {
                await softDropTransaction(tx.id);
              }
              writeBackupSafe();
              router.back();
            } catch (e) {
              Alert.alert('Error deleting', String(e));
              setDeleting(false);
            }
          },
        },
      ],
    );
  }

  function handleCategorySelect(newCatId: string | null) {
    setCategoryId(newCatId);
    setCatManually(1);
    setPickerOpen(false);
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <Stack.Screen options={{ title: 'Edit Transaction' }} />
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  if (!tx) {
    return (
      <View style={styles.center}>
        <Stack.Screen options={{ title: 'Edit Transaction' }} />
        <Text style={styles.notFound}>Transaction not found.</Text>
      </View>
    );
  }

  const currentCategory = categoryId ? categories.find(c => c.id === categoryId) ?? null : null;

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.background }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <Stack.Screen options={{ title: 'Edit Transaction', headerBackTitle: 'Back' }} />
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">

        {/* Source badge */}
        <View style={styles.sourceBadge}>
          <Text style={styles.sourceBadgeText}>
            {tx.source_is_manual === 1 ? 'Manual entry' : 'Imported'}
            {tx.is_pending === 1 ? ' · Pending' : ''}
            {tx.dropped_at !== null ? ' · Dropped' : ''}
          </Text>
        </View>

        {/* Date */}
        <Text style={styles.label}>Date (YYYY-MM-DD)</Text>
        <TextInput
          style={styles.input}
          value={date}
          onChangeText={setDate}
          placeholder="2026-03-15"
          placeholderTextColor={colors.textTertiary}
          keyboardType="numbers-and-punctuation"
          autoCorrect={false}
          returnKeyType="next"
          accessibilityLabel="Date field"
        />

        {/* Amount */}
        <Text style={styles.label}>Amount</Text>
        <TextInput
          style={styles.input}
          value={amountText}
          onChangeText={setAmountText}
          placeholder="-18.04  (negative = expense, positive = income)"
          placeholderTextColor={colors.textTertiary}
          keyboardType="numbers-and-punctuation"
          autoCorrect={false}
          returnKeyType="next"
          accessibilityLabel="Amount field"
        />

        {/* Description */}
        <Text style={styles.label}>Description</Text>
        <TextInput
          style={[styles.input, styles.descInput]}
          value={description}
          onChangeText={setDescription}
          placeholder="e.g. Starbucks Coffee"
          placeholderTextColor={colors.textTertiary}
          autoCorrect={false}
          returnKeyType="done"
          accessibilityLabel="Description field"
        />

        {/* Category */}
        <Text style={styles.label}>Category</Text>
        <TouchableOpacity
          style={styles.categoryRow}
          onPress={() => setPickerOpen(true)}
          activeOpacity={0.7}
          accessibilityLabel="Change category"
        >
          {currentCategory ? (
            <CategoryBadge name={currentCategory.name} color={currentCategory.color} emoji={currentCategory.emoji} />
          ) : (
            <Text style={styles.noCategoryText}>None</Text>
          )}
          <Text style={styles.categoryChevron}>›</Text>
        </TouchableOpacity>

        {/* Save */}
        <TouchableOpacity
          style={[styles.saveBtn, (saving || deleting) && styles.btnDisabled]}
          onPress={handleSave}
          disabled={saving || deleting}
          activeOpacity={0.85}
        >
          <Text style={styles.saveBtnText}>{saving ? 'Saving…' : 'Save Changes'}</Text>
        </TouchableOpacity>

        {/* Delete */}
        <TouchableOpacity
          style={[styles.deleteBtn, (saving || deleting) && styles.btnDisabled]}
          onPress={handleDelete}
          disabled={saving || deleting}
          activeOpacity={0.85}
        >
          <Text style={styles.deleteBtnText}>{deleting ? 'Deleting…' : 'Delete Transaction'}</Text>
        </TouchableOpacity>

        {/* Original description (read-only, for reference) */}
        {tx.original_description && tx.original_description !== description && (
          <View style={styles.originalWrap}>
            <Text style={styles.originalLabel}>Original</Text>
            <Text style={styles.originalText}>{tx.original_description}</Text>
          </View>
        )}

      </ScrollView>

      <CategoryPickerSheet
        visible={pickerOpen}
        categories={categories}
        currentCategoryId={categoryId}
        onClose={() => setPickerOpen(false)}
        onSelect={handleCategorySelect}
        onCategoryCreated={cat => setCategories(prev => [...prev, cat].sort((a, b) => a.name.localeCompare(b.name)))}
      />
    </KeyboardAvoidingView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
  notFound: { fontFamily: font.regular, fontSize: 15, color: colors.textSecondary },

  container: { padding: spacing.md, paddingBottom: spacing.xl * 3 },

  sourceBadge: {
    alignSelf: 'flex-start',
    backgroundColor: colors.surface,
    borderRadius: radius.full,
    paddingVertical: 4,
    paddingHorizontal: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.md,
  },
  sourceBadgeText: { fontFamily: font.regular, fontSize: 12, color: colors.textSecondary },

  label: {
    fontFamily: font.semiBold,
    fontSize: 12,
    color: colors.textTertiary,
    marginBottom: 4,
    marginTop: spacing.sm,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  input: {
    fontFamily: font.regular,
    fontSize: 16,
    color: colors.text,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    paddingHorizontal: spacing.sm,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: colors.border,
  },
  descInput: { minHeight: 60, textAlignVertical: 'top' },

  categoryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    paddingHorizontal: spacing.sm,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: colors.border,
  },
  noCategoryText:  { fontFamily: font.regular, fontSize: 15, color: colors.textTertiary },
  categoryChevron: { fontFamily: font.regular, fontSize: 20, color: colors.textTertiary, marginRight: 2 },

  saveBtn: {
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: spacing.lg,
  },
  saveBtnText: { fontFamily: font.semiBold, fontSize: 16, color: '#fff' },

  deleteBtn: {
    backgroundColor: colors.background,
    borderRadius: radius.md,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: spacing.sm,
    borderWidth: 1,
    borderColor: colors.destructive,
  },
  deleteBtnText: { fontFamily: font.semiBold, fontSize: 16, color: colors.destructive },

  btnDisabled: { opacity: 0.45 },

  originalWrap: {
    marginTop: spacing.lg,
    padding: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  originalLabel: { fontFamily: font.semiBold, fontSize: 11, color: colors.textTertiary, marginBottom: 2, textTransform: 'uppercase', letterSpacing: 0.4 },
  originalText:  { fontFamily: font.regular, fontSize: 13, color: colors.textSecondary },
});
