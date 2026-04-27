import React, { useCallback, useState } from 'react';
import {
  View, Text, FlatList, TouchableOpacity,
  Modal, TextInput, StyleSheet, SafeAreaView,
  ActivityIndicator, Alert,
} from 'react-native';
import { useLocalSearchParams, useFocusEffect, Stack } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Rule, Category, MatchType,
  getRulesForAccount, getAllCategories,
  insertRule, deleteRule, reorderRules,
} from '../../../src/db/queries';
import { Sloth } from '../../../src/components/Sloth';
import { colors, font, spacing, radius } from '../../../src/theme';
import * as Crypto from 'expo-crypto';

const MATCH_TYPES: { value: MatchType; label: string }[] = [
  { value: 'contains',    label: 'Contains' },
  { value: 'starts_with', label: 'Starts with' },
  { value: 'ends_with',   label: 'Ends with' },
  { value: 'equals',      label: 'Equals' },
];

interface RuleWithCategory extends Rule { categoryName: string; categoryColor: string; }

export default function AccountRulesScreen() {
  const { id }    = useLocalSearchParams<{ id: string }>();
  const insets    = useSafeAreaInsets();
  const [rules,       setRules]       = useState<RuleWithCategory[]>([]);
  const [categories,  setCategories]  = useState<Category[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [sheetOpen,   setSheetOpen]   = useState(false);
  const [matchType,   setMatchType]   = useState<MatchType>('contains');
  const [matchText,   setMatchText]   = useState('');
  const [categoryId,  setCategoryId]  = useState('');
  const [saving,      setSaving]      = useState(false);

  useFocusEffect(useCallback(() => {
    let active = true;
    (async () => {
      const [rawRules, cats] = await Promise.all([
        getRulesForAccount(id),
        getAllCategories(),
      ]);
      if (!active) return;
      const catMap = Object.fromEntries(cats.map(c => [c.id, c]));
      setRules(rawRules.map(r => ({
        ...r,
        categoryName:  catMap[r.category_id]?.name  ?? '(deleted)',
        categoryColor: catMap[r.category_id]?.color ?? colors.textTertiary,
      })));
      setCategories(cats);
      if (cats.length > 0 && !categoryId) setCategoryId(cats[0].id);
      setLoading(false);
    })();
    return () => { active = false; };
  }, [id]));

  function openSheet() {
    setMatchType('contains');
    setMatchText('');
    if (categories.length > 0) setCategoryId(categories[0].id);
    setSheetOpen(true);
  }

  async function handleAddRule() {
    const text = matchText.trim();
    if (!text || !categoryId) return;
    setSaving(true);
    const maxPriority = rules.length > 0 ? Math.max(...rules.map(r => r.priority)) : 0;
    try {
      await insertRule({
        id: Crypto.randomUUID(),
        account_id: id,
        category_id: categoryId,
        match_type: matchType,
        match_text: text,
        priority: maxPriority + 1,
      });
      const [rawRules, cats] = await Promise.all([getRulesForAccount(id), getAllCategories()]);
      const catMap = Object.fromEntries(cats.map(c => [c.id, c]));
      setRules(rawRules.map(r => ({
        ...r,
        categoryName:  catMap[r.category_id]?.name  ?? '(deleted)',
        categoryColor: catMap[r.category_id]?.color ?? colors.textTertiary,
      })));
      setSheetOpen(false);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(ruleId: string) {
    Alert.alert(
      'Delete Rule',
      'This rule will be removed. Transactions already categorized by it will keep their category.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete', style: 'destructive',
          onPress: async () => {
            await deleteRule(ruleId);
            setRules(prev => prev.filter(r => r.id !== ruleId));
          },
        },
      ],
    );
  }

  async function handleMove(index: number, direction: 'up' | 'down') {
    const newRules = [...rules];
    const swapWith = direction === 'up' ? index - 1 : index + 1;
    if (swapWith < 0 || swapWith >= newRules.length) return;
    [newRules[index], newRules[swapWith]] = [newRules[swapWith], newRules[index]];
    setRules(newRules);
    await reorderRules(newRules.map(r => r.id));
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  return (
    <>
      <Stack.Screen
        options={{
          title: 'Rules',
          headerRight: () => (
            <TouchableOpacity onPress={openSheet} hitSlop={12}>
              <Text style={styles.addBtn}>Add</Text>
            </TouchableOpacity>
          ),
        }}
      />
      <View style={[styles.container, { paddingBottom: insets.bottom }]}>
        <FlatList
          data={rules}
          keyExtractor={r => r.id}
          contentContainerStyle={rules.length === 0 && styles.listEmpty}
          ListHeaderComponent={rules.length > 0 ? (
            <Text style={styles.hint}>Rules run top-to-bottom on import. First match wins.</Text>
          ) : null}
          renderItem={({ item, index }) => (
            <View style={[styles.ruleRow, index > 0 && styles.rowBorder]}>
              <View style={styles.ruleInfo}>
                <Text style={styles.ruleMatchLine}>
                  <Text style={styles.ruleMatchType}>{MATCH_TYPES.find(m => m.value === item.match_type)?.label ?? item.match_type}</Text>
                  {' "'}
                  <Text style={styles.ruleMatchText}>{item.match_text}</Text>
                  {'"'}
                </Text>
                <View style={styles.ruleCategoryRow}>
                  <View style={[styles.ruleCatDot, { backgroundColor: item.categoryColor }]} />
                  <Text style={styles.ruleCatName}>{item.categoryName}</Text>
                </View>
              </View>
              <View style={styles.ruleActions}>
                <TouchableOpacity onPress={() => handleMove(index, 'up')} disabled={index === 0} hitSlop={8}>
                  <Text style={[styles.arrow, index === 0 && styles.arrowDisabled]}>↑</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => handleMove(index, 'down')} disabled={index === rules.length - 1} hitSlop={8}>
                  <Text style={[styles.arrow, index === rules.length - 1 && styles.arrowDisabled]}>↓</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => handleDelete(item.id)} hitSlop={8}>
                  <Text style={styles.deleteBtn}>✕</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Sloth sloth="meditating" size={120} />
              <Text style={styles.emptyTitle}>No rules yet</Text>
              <Text style={styles.emptyBody}>
                Tap "Add" to create a rule. I'll use it to automatically categorize transactions when you import.
              </Text>
            </View>
          }
        />
      </View>

      {/* Add Rule Sheet */}
      <Modal visible={sheetOpen} transparent animationType="slide" onRequestClose={() => setSheetOpen(false)}>
        <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={() => setSheetOpen(false)} />
        <SafeAreaView style={styles.sheet}>
          <View style={styles.sheetHandle} />
          <Text style={styles.sheetTitle}>Add Rule</Text>

          <Text style={styles.sheetLabel}>Match type</Text>
          <View style={styles.tabs}>
            {MATCH_TYPES.map(m => (
              <TouchableOpacity
                key={m.value}
                style={[styles.tab, matchType === m.value && styles.tabActive]}
                onPress={() => setMatchType(m.value)}
                activeOpacity={0.75}
              >
                <Text style={[styles.tabText, matchType === m.value && styles.tabTextActive]}>
                  {m.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={styles.sheetLabel}>Text to match (case-insensitive)</Text>
          <TextInput
            style={styles.sheetInput}
            value={matchText}
            onChangeText={setMatchText}
            placeholder="e.g. whole foods"
            placeholderTextColor={colors.textTertiary}
            autoFocus
          />

          <Text style={styles.sheetLabel}>Assign category</Text>
          <View style={styles.catPills}>
            {categories.map(c => (
              <TouchableOpacity
                key={c.id}
                style={[
                  styles.catPill,
                  { borderColor: c.color },
                  categoryId === c.id && { backgroundColor: c.color },
                ]}
                onPress={() => setCategoryId(c.id)}
                activeOpacity={0.75}
              >
                <Text style={[styles.catPillText, categoryId === c.id && styles.catPillTextSelected]}>
                  {c.name}
                </Text>
              </TouchableOpacity>
            ))}
            {categories.length === 0 && (
              <Text style={styles.noCatsText}>Create a category first.</Text>
            )}
          </View>

          <TouchableOpacity
            style={[styles.saveBtn, (!matchText.trim() || !categoryId || saving) && styles.saveBtnDisabled]}
            onPress={handleAddRule}
            disabled={!matchText.trim() || !categoryId || saving}
            activeOpacity={0.85}
          >
            <Text style={styles.saveBtnText}>{saving ? 'Saving…' : 'Add Rule'}</Text>
          </TouchableOpacity>
        </SafeAreaView>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  center:    { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.background },
  addBtn:    { fontFamily: font.semiBold, fontSize: 15, color: colors.primary },
  listEmpty: { flex: 1 },

  hint: {
    fontFamily: font.regular, fontSize: 13, color: colors.textTertiary,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
  },

  ruleRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: spacing.md, paddingVertical: 12,
    backgroundColor: colors.surface,
  },
  rowBorder: { borderTopWidth: 1, borderTopColor: colors.separator },
  ruleInfo:  { flex: 1 },
  ruleMatchLine: { fontFamily: font.regular, fontSize: 15, color: colors.text, marginBottom: 4 },
  ruleMatchType: { fontFamily: font.semiBold, color: colors.textSecondary },
  ruleMatchText: { fontFamily: font.semiBold, color: colors.primary },
  ruleCategoryRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  ruleCatDot: { width: 10, height: 10, borderRadius: radius.full },
  ruleCatName: { fontFamily: font.regular, fontSize: 13, color: colors.textSecondary },

  ruleActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  arrow:         { fontSize: 18, color: colors.primary, fontFamily: font.bold },
  arrowDisabled: { color: colors.border },
  deleteBtn:     { fontSize: 16, color: colors.destructive, fontFamily: font.bold },

  emptyState: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: spacing.xl, gap: spacing.md,
  },
  emptyTitle: { fontFamily: font.bold, fontSize: 20, color: colors.text },
  emptyBody:  { fontFamily: font.regular, fontSize: 15, color: colors.textSecondary, textAlign: 'center', lineHeight: 22 },

  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.25)' },
  sheet: {
    backgroundColor: colors.background,
    borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl,
    maxHeight: '80%', paddingBottom: spacing.lg, paddingHorizontal: spacing.md,
  },
  sheetHandle: {
    width: 40, height: 4, borderRadius: radius.full,
    backgroundColor: colors.border,
    alignSelf: 'center', marginTop: spacing.sm, marginBottom: spacing.sm,
  },
  sheetTitle: { fontFamily: font.bold, fontSize: 17, color: colors.text, textAlign: 'center', marginBottom: spacing.md },
  sheetLabel: { fontFamily: font.semiBold, fontSize: 13, color: colors.textSecondary, marginBottom: spacing.sm, letterSpacing: 0.4 },

  tabs: {
    flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs,
    marginBottom: spacing.md,
  },
  tab: {
    paddingVertical: 7, paddingHorizontal: spacing.md,
    borderRadius: radius.full, backgroundColor: colors.surfaceAlt,
  },
  tabActive:     { backgroundColor: colors.primary },
  tabText:       { fontFamily: font.semiBold, fontSize: 14, color: colors.textSecondary },
  tabTextActive: { color: colors.textOnColor },

  sheetInput: {
    backgroundColor: colors.surface,
    borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    paddingHorizontal: spacing.md, paddingVertical: 12,
    fontFamily: font.regular, fontSize: 16, color: colors.text,
    marginBottom: spacing.md,
  },

  catPills: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.lg },
  catPill:  {
    paddingVertical: 7, paddingHorizontal: spacing.md,
    borderRadius: radius.full, borderWidth: 2,
  },
  catPillText:         { fontFamily: font.semiBold, fontSize: 14, color: colors.text },
  catPillTextSelected: { color: colors.textOnColor },
  noCatsText:          { fontFamily: font.regular, fontSize: 14, color: colors.textTertiary },

  saveBtn: {
    backgroundColor: colors.primary, borderRadius: radius.full,
    paddingVertical: 16, alignItems: 'center',
  },
  saveBtnDisabled: { opacity: 0.4 },
  saveBtnText: { fontFamily: font.bold, fontSize: 16, color: colors.textOnColor },
});
