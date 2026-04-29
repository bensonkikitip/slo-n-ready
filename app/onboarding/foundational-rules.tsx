/**
 * Per-account foundational rules onboarding.
 *
 * Triggered by /account/[id]/index.tsx when ?showFoundationalOnboarding=1 AND
 * the account has no foundational_rule_settings rows yet.
 *
 * For the FIRST account, category mappings are pre-filled by matching each
 * foundational rule's defaultCategoryName against the user's categories.
 * For 2nd+ accounts, mappings are copied from the user's oldest account.
 *
 * On accept: bulk-upserts settings (enabled=1 for rows with a category mapped),
 * runs autoApplyRulesForAccount, navigates to /onboarding/done.
 *
 * On skip: bulk-upserts all 6 with enabled=0 so this screen doesn't re-fire,
 * navigates back to /account/[id].
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
  View, Text, TouchableOpacity, ScrollView, StyleSheet,
  ActivityIndicator, Modal, SafeAreaView, Switch, Alert,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import {
  Category, getAllCategories, getAllAccounts,
  getFoundationalRuleSettingsForAccount,
  bulkUpsertFoundationalRuleSettings,
} from '../../src/db/queries';
import { FOUNDATIONAL_RULES } from '../../src/domain/foundational-rules';
import { autoApplyRulesForAccount } from '../../src/domain/rules-engine';
import { Sloth } from '../../src/components/Sloth';
import { colors, font, spacing, radius } from '../../src/theme';

interface RowState {
  ruleId:     string;
  categoryId: string | null;
  enabled:    boolean;
}

export default function OnboardingFoundationalRulesScreen() {
  const router = useRouter();
  const { accountId, first } = useLocalSearchParams<{ accountId: string; first?: string }>();
  const isFirstAccount = first === '1';

  const [categories, setCategories] = useState<Category[]>([]);
  const [rows,       setRows]       = useState<RowState[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [saving,     setSaving]     = useState(false);
  const [pickerForRule, setPickerForRule] = useState<string | null>(null);

  // Load categories + compute initial mappings
  useEffect(() => {
    let active = true;
    (async () => {
      const [cats, allAccts] = await Promise.all([
        getAllCategories(), getAllAccounts(),
      ]);
      if (!active) return;

      // Try to seed from oldest OTHER account first (n+1 case)
      let seedFromOlder: Map<string, string | null> | null = null;
      const otherAccts = allAccts
        .filter(a => a.id !== accountId)
        .sort((a, b) => a.created_at - b.created_at);
      if (otherAccts.length > 0) {
        const prior = await getFoundationalRuleSettingsForAccount(otherAccts[0].id);
        if (prior.length > 0) {
          seedFromOlder = new Map(prior.map(p => [p.rule_id, p.category_id]));
        }
      }

      const initialRows: RowState[] = FOUNDATIONAL_RULES.map(fr => {
        let catId: string | null = null;
        if (seedFromOlder && seedFromOlder.has(fr.id)) {
          catId = seedFromOlder.get(fr.id) ?? null;
        } else {
          // First account (or older account had no settings) — match by name
          const match = cats.find(
            c => c.name.toLowerCase() === fr.defaultCategoryName.toLowerCase(),
          );
          catId = match?.id ?? null;
        }
        return { ruleId: fr.id, categoryId: catId, enabled: catId !== null };
      });

      setCategories(cats);
      setRows(initialRows);
      setLoading(false);
    })();
    return () => { active = false; };
  }, [accountId]);

  const enabledMappedCount = useMemo(
    () => rows.filter(r => r.enabled && r.categoryId !== null).length,
    [rows],
  );

  function setRow(ruleId: string, patch: Partial<RowState>) {
    setRows(prev => prev.map(r => r.ruleId === ruleId ? { ...r, ...patch } : r));
  }

  function handlePickCategory(ruleId: string, categoryId: string | null) {
    // Same gating invariant as the rules screen: clearing the category
    // auto-disables; setting one auto-enables.
    if (categoryId === null) {
      setRow(ruleId, { categoryId: null, enabled: false });
    } else {
      setRow(ruleId, { categoryId, enabled: true });
    }
    setPickerForRule(null);
  }

  function handleToggle(ruleId: string, value: boolean) {
    setRow(ruleId, { enabled: value });
  }

  async function handleAccept() {
    if (!accountId) {
      Alert.alert('Error', 'Account ID is missing. Please go back and try again.');
      return;
    }
    setSaving(true);
    try {
      // Validate category IDs against the categories we loaded from DB.
      // Stale IDs from a seeded older account can fail the FK constraint if those
      // categories were recreated with new UUIDs since the original rules were saved.
      const validCatIds = new Set(categories.map(c => c.id));
      const safeRows = rows.map((r, i) => {
        const catId = r.categoryId && validCatIds.has(r.categoryId) ? r.categoryId : null;
        return {
          rule_id:     r.ruleId,
          category_id: catId,
          enabled:     r.enabled && catId !== null ? 1 : 0,
          sort_order:  i,
        };
      });

      // Persist all rows. enabled=0 for any row missing a category (DB invariant).
      await bulkUpsertFoundationalRuleSettings(accountId, safeRows);

      // Apply rules to already-imported transactions.
      const applied = await autoApplyRulesForAccount(accountId);

      router.replace(
        `/onboarding/done?accountId=${accountId}&appliedFoundational=${applied.byFoundational}&appliedTotal=${applied.total}`,
      );
    } catch (e: any) {
      setSaving(false);
      Alert.alert('Something went wrong', e?.message ?? 'Could not apply rules. Please try again.');
    }
  }

  async function handleSkip() {
    if (!accountId) {
      router.back();
      return;
    }
    setSaving(true);
    try {
      // Write all 6 rows with enabled=0 so we don't re-prompt.
      // Validate category IDs to avoid FK constraint errors (same as handleAccept).
      const validCatIds = new Set(categories.map(c => c.id));
      await bulkUpsertFoundationalRuleSettings(
        accountId,
        rows.map((r, i) => ({
          rule_id:     r.ruleId,
          category_id: r.categoryId && validCatIds.has(r.categoryId) ? r.categoryId : null,
          enabled:     0,
          sort_order:  i,
        })),
      );
      router.back();
    } catch (e: any) {
      setSaving(false);
      Alert.alert('Something went wrong', e?.message ?? 'Could not skip. Please try again.');
    }
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  const headline = isFirstAccount
    ? "Want me to recognize what I can?"
    : "Same setup for this account?";
  const subhead = isFirstAccount
    ? "I know hundreds of common merchants. Pick which ones I should sort for this account, and I'll apply them right now."
    : "Pre-filled with what your other account uses. Tweak anything, then I'll apply them.";

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* Header */}
        <View style={styles.header}>
          <Sloth sloth="meditating" size={100} />
          <Text style={styles.title}>{headline}</Text>
          <Text style={styles.subtitle}>{subhead}</Text>
        </View>

        {/* Rules list */}
        <View style={styles.card}>
          {FOUNDATIONAL_RULES.map((fr, i) => {
            const row = rows.find(r => r.ruleId === fr.id);
            if (!row) return null;
            const cat = categories.find(c => c.id === row.categoryId);
            const canToggle = row.categoryId !== null;
            return (
              <View key={fr.id} style={[styles.row, i > 0 && styles.rowBorder]}>
                <View style={styles.rowMain}>
                  <Text style={styles.ruleEmoji}>{fr.emoji}</Text>
                  <View style={styles.ruleText}>
                    <Text style={styles.ruleName}>{fr.name}</Text>
                    <Text style={styles.ruleDesc}>{fr.description}</Text>
                  </View>
                  <Switch
                    value={row.enabled && canToggle}
                    onValueChange={(v) => handleToggle(fr.id, v)}
                    disabled={!canToggle}
                    trackColor={{ false: colors.border, true: colors.primary }}
                    thumbColor={colors.surface}
                  />
                </View>

                <TouchableOpacity
                  style={styles.catPickerRow}
                  onPress={() => setPickerForRule(fr.id)}
                  activeOpacity={0.7}
                >
                  {cat ? (
                    <View style={styles.catChosen}>
                      <View style={[styles.catDot, { backgroundColor: cat.color }]}>
                        {cat.emoji ? <Text style={styles.catDotEmoji}>{cat.emoji}</Text> : null}
                      </View>
                      <Text style={styles.catChosenName}>{cat.name}</Text>
                      <Text style={styles.catChevron}>▼</Text>
                    </View>
                  ) : (
                    <Text style={styles.catEmpty}>Choose category… ▼</Text>
                  )}
                </TouchableOpacity>

                {!canToggle && (
                  <Text style={styles.hint}>Pick a category to turn this on.</Text>
                )}
              </View>
            );
          })}
        </View>

        <Text style={styles.helperText}>
          {enabledMappedCount} of {FOUNDATIONAL_RULES.length} rules will be applied to this account.
        </Text>
      </ScrollView>

      {/* Sticky CTAs */}
      <View style={styles.ctaBar}>
        {saving ? (
          <ActivityIndicator color={colors.primary} />
        ) : (
          <>
            <TouchableOpacity
              style={[styles.cta, enabledMappedCount === 0 && styles.ctaDisabled]}
              onPress={handleAccept}
              disabled={enabledMappedCount === 0}
              activeOpacity={0.85}
            >
              <Text style={styles.ctaText}>Use these — apply now</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.skipBtn}
              onPress={handleSkip}
              activeOpacity={0.6}
            >
              <Text style={styles.skipText}>Skip for now</Text>
            </TouchableOpacity>
          </>
        )}
      </View>

      {/* Category picker modal */}
      <Modal
        visible={pickerForRule !== null}
        transparent
        animationType="slide"
        onRequestClose={() => setPickerForRule(null)}
      >
        <TouchableOpacity
          style={styles.backdrop}
          activeOpacity={1}
          onPress={() => setPickerForRule(null)}
        />
        <SafeAreaView style={styles.sheet}>
          <View style={styles.sheetHandle} />
          <Text style={styles.sheetTitle}>Choose category</Text>
          <ScrollView keyboardShouldPersistTaps="handled">
            <TouchableOpacity
              style={styles.catDropdownRow}
              onPress={() => pickerForRule && handlePickCategory(pickerForRule, null)}
              activeOpacity={0.7}
            >
              <Text style={[styles.catDropdownLabel, { color: colors.textTertiary }]}>
                — Remove mapping
              </Text>
            </TouchableOpacity>
            {categories.map(cat => {
              const currentCatId = pickerForRule
                ? rows.find(r => r.ruleId === pickerForRule)?.categoryId ?? null
                : null;
              const isSelected = cat.id === currentCatId;
              return (
                <TouchableOpacity
                  key={cat.id}
                  style={[styles.catDropdownRow, styles.catDropdownRowBorder, isSelected && styles.catDropdownRowSelected]}
                  onPress={() => pickerForRule && handlePickCategory(pickerForRule, cat.id)}
                  activeOpacity={0.7}
                >
                  <View style={[styles.catDot, { backgroundColor: cat.color }]}>
                    {cat.emoji ? <Text style={styles.catDotEmoji}>{cat.emoji}</Text> : null}
                  </View>
                  <Text style={styles.catDropdownLabel}>{cat.name}</Text>
                  {isSelected && <Text style={styles.catCheck}>✓</Text>}
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  center:    { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
  scrollContent: { padding: spacing.md, paddingBottom: spacing.xl },

  header: { alignItems: 'center', gap: spacing.sm, paddingTop: spacing.lg, paddingBottom: spacing.md },
  title: {
    fontFamily: font.extraBold, fontSize: 22, color: colors.text,
    textAlign: 'center', marginTop: spacing.sm,
  },
  subtitle: {
    fontFamily: font.regular, fontSize: 14, color: colors.textSecondary,
    textAlign: 'center', lineHeight: 20, paddingHorizontal: spacing.md,
  },

  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    overflow: 'hidden',
    borderWidth: 1, borderColor: colors.border,
  },
  row: { paddingHorizontal: spacing.md, paddingVertical: spacing.md },
  rowBorder: { borderTopWidth: 1, borderTopColor: colors.separator },
  rowMain: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  ruleEmoji: { fontSize: 24, width: 32, textAlign: 'center' },
  ruleText: { flex: 1 },
  ruleName: { fontFamily: font.bold, fontSize: 15, color: colors.text },
  ruleDesc: { fontFamily: font.regular, fontSize: 12, color: colors.textTertiary, marginTop: 2 },

  catPickerRow: {
    marginTop: spacing.sm,
    backgroundColor: colors.background,
    borderRadius: radius.md,
    paddingVertical: 10, paddingHorizontal: spacing.sm,
    borderWidth: 1, borderColor: colors.border,
  },
  catChosen: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  catDot: {
    width: 24, height: 24, borderRadius: 12,
    alignItems: 'center', justifyContent: 'center',
  },
  catDotEmoji: { fontSize: 14 },
  catChosenName: { flex: 1, fontFamily: font.semiBold, fontSize: 14, color: colors.text },
  catChevron: { fontSize: 11, color: colors.textTertiary },
  catEmpty: { fontFamily: font.semiBold, fontSize: 14, color: colors.textTertiary },

  hint: {
    fontFamily: font.regular, fontSize: 12, color: colors.textTertiary,
    marginTop: spacing.xs, fontStyle: 'italic',
  },

  helperText: {
    fontFamily: font.regular, fontSize: 12, color: colors.textTertiary,
    textAlign: 'center', marginTop: spacing.md, paddingHorizontal: spacing.lg,
    lineHeight: 18,
  },

  ctaBar: {
    paddingHorizontal: spacing.md, paddingVertical: spacing.md,
    borderTopWidth: 1, borderTopColor: colors.border,
    backgroundColor: colors.surface,
    gap: spacing.xs,
  },
  cta: {
    backgroundColor: colors.primary,
    borderRadius: radius.full,
    paddingVertical: 16, alignItems: 'center',
  },
  ctaDisabled: { opacity: 0.4 },
  ctaText: { fontFamily: font.bold, fontSize: 16, color: colors.textOnColor },
  skipBtn: { paddingVertical: 12, alignItems: 'center' },
  skipText: { fontFamily: font.semiBold, fontSize: 14, color: colors.textSecondary },

  // Category picker modal
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg,
    maxHeight: '70%',
    paddingTop: spacing.sm, paddingBottom: spacing.md,
  },
  sheetHandle: {
    width: 40, height: 4, borderRadius: 2,
    backgroundColor: colors.border,
    alignSelf: 'center', marginBottom: spacing.sm,
  },
  sheetTitle: {
    fontFamily: font.bold, fontSize: 16, color: colors.text,
    paddingHorizontal: spacing.md, marginBottom: spacing.sm,
  },
  catDropdownRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: spacing.md, paddingVertical: 14, gap: spacing.sm,
  },
  catDropdownRowBorder: { borderTopWidth: 1, borderTopColor: colors.separator },
  catDropdownRowSelected: { backgroundColor: colors.primaryLight },
  catDropdownLabel: { flex: 1, fontFamily: font.semiBold, fontSize: 15, color: colors.text },
  catCheck: { fontFamily: font.bold, fontSize: 16, color: colors.primary },
});
