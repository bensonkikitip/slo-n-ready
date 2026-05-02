import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, Alert, ScrollView,
} from 'react-native';
import { useRouter } from 'expo-router';
import * as Crypto from 'expo-crypto';
import { AccountType, CsvFormat, insertAccount } from '../../src/db/queries';
import { DEFAULT_CONFIGS } from '../../src/parsers/column-config';
import { CSV_FORMATS } from '../../src/parsers/bank-formats';
import { writeBackupSafe } from '../../src/db/backup';
import { colors, font, spacing, radius, accountColor } from '../../src/theme';

const ACCOUNT_TYPES: { label: string; value: AccountType; emoji: string }[] = [
  { label: 'Checking',    value: 'checking',    emoji: '🏦' },
  { label: 'Credit Card', value: 'credit_card', emoji: '💳' },
];

export default function AddAccountScreen() {
  const router = useRouter();

  const [name,   setName]   = useState('');
  const [type,   setType]   = useState<AccountType>('checking');
  const [format, setFormat] = useState<CsvFormat>('custom');
  const [saving, setSaving] = useState(false);

  const accentColor = accountColor[type];

  function handleTypeChange(newType: AccountType) {
    setType(newType);
    // Reset format so the user picks from the correct bank list for the new type.
    setFormat('custom');
  }

  const formatsForType = CSV_FORMATS.filter(f => f.forType === type);
  const canSave = !!name.trim() && !saving;

  async function handleSave() {
    if (!name.trim()) {
      Alert.alert('Name required', 'Please give this account a name.');
      return;
    }
    setSaving(true);
    try {
      const newAccountId = Crypto.randomUUID();
      await insertAccount({
        id:            newAccountId,
        name:          name.trim(),
        type,
        csv_format:    format,
        // For named bank formats the correct column config is set here; for
        // 'custom' this is a placeholder that import.tsx will overwrite when
        // the user picks their first CSV (auto-detection happens there).
        column_config: JSON.stringify(DEFAULT_CONFIGS[format] ?? DEFAULT_CONFIGS['boa_checking_v1']),
        suggest_rules: 1,
        created_at:    Date.now(),
      });
      writeBackupSafe();
      // Hand off to the unified import screen. fromOnboarding=1 changes the
      // done-phase CTA to "Set up rules →" and keeps the flow connected.
      router.replace(`/account/${newAccountId}/import?fromOnboarding=1`);
    } catch (e: any) {
      Alert.alert('Error', e.message ?? 'Could not save account. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      {/* ── Account Type ── */}
      <Text style={styles.sectionLabel}>ACCOUNT TYPE</Text>
      <View style={styles.card}>
        {ACCOUNT_TYPES.map((t, i) => (
          <TouchableOpacity
            key={t.value}
            style={[
              styles.option,
              i > 0 && styles.optionBorder,
              type === t.value && { backgroundColor: colors.primaryLight },
            ]}
            onPress={() => handleTypeChange(t.value)}
            activeOpacity={0.7}
          >
            <Text style={styles.optionEmoji}>{t.emoji}</Text>
            <Text style={[styles.optionLabel, type === t.value && { color: accentColor }]}>
              {t.label}
            </Text>
            {type === t.value && (
              <Text style={[styles.check, { color: accentColor }]}>✓</Text>
            )}
          </TouchableOpacity>
        ))}
      </View>

      {/* ── Account Name ── */}
      <Text style={styles.sectionLabel}>ACCOUNT NAME</Text>
      <View style={styles.card}>
        <TextInput
          style={styles.input}
          placeholder="e.g. Chase Checking, Amex Gold"
          placeholderTextColor={colors.textTertiary}
          value={name}
          onChangeText={setName}
          autoFocus
          returnKeyType="done"
        />
      </View>

      {/* ── Bank Format ── */}
      <Text style={styles.sectionLabel}>YOUR BANK</Text>
      <Text style={styles.hint}>
        Tells me which parser to use for your CSV and PDF statements. You can change this later in Edit Account.
      </Text>
      <View style={styles.card}>
        {formatsForType.map((f, i) => (
          <TouchableOpacity
            key={f.value}
            style={[
              styles.option,
              i > 0 && styles.optionBorder,
              format === f.value && { backgroundColor: colors.primaryLight },
            ]}
            onPress={() => setFormat(f.value)}
            activeOpacity={0.7}
          >
            <Text style={[styles.optionLabel, format === f.value && { color: accentColor }]}>
              {f.label}
            </Text>
            {format === f.value && (
              <Text style={[styles.check, { color: accentColor }]}>✓</Text>
            )}
          </TouchableOpacity>
        ))}
        {/* "My bank isn't listed" — always at the bottom */}
        <TouchableOpacity
          style={[
            styles.option,
            formatsForType.length > 0 && styles.optionBorder,
            format === 'custom' && { backgroundColor: colors.primaryLight },
          ]}
          onPress={() => setFormat('custom')}
          activeOpacity={0.7}
        >
          <Text style={[styles.optionLabel, format === 'custom' && { color: accentColor }]}>
            My bank isn't listed
          </Text>
          {format === 'custom' && (
            <Text style={[styles.check, { color: accentColor }]}>✓</Text>
          )}
        </TouchableOpacity>
      </View>

      {format === 'custom' && (
        <Text style={styles.customHint}>
          No problem — just pick a CSV and I'll auto-detect the column layout. PDF import is generic for unlisted banks.
        </Text>
      )}

      {/* ── Save CTA ── */}
      <TouchableOpacity
        style={[styles.saveButton, { backgroundColor: accentColor }, !canSave && styles.disabled]}
        onPress={handleSave}
        disabled={!canSave}
        activeOpacity={0.85}
      >
        <Text style={styles.saveButtonText}>
          {saving ? 'Saving…' : 'Add Account & Import →'}
        </Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content:   { padding: spacing.md, gap: spacing.sm, paddingBottom: spacing.xxl },

  sectionLabel: {
    fontFamily:    font.semiBold,
    fontSize:      11,
    color:         colors.textTertiary,
    letterSpacing: 0.8,
    marginTop:     spacing.md,
    marginBottom:  spacing.xs,
    marginLeft:    spacing.xs,
  },

  card: {
    backgroundColor: colors.surface,
    borderRadius:    radius.lg,
    overflow:        'hidden',
    borderWidth:     1,
    borderColor:     colors.border,
  },

  option: {
    flexDirection:     'row',
    alignItems:        'center',
    paddingHorizontal: spacing.md,
    paddingVertical:   14,
    gap:               spacing.sm,
  },
  optionBorder: { borderTopWidth: 1, borderTopColor: colors.separator },
  optionEmoji:  { fontSize: 18 },
  optionLabel: {
    fontFamily: font.semiBold,
    fontSize:   15,
    color:      colors.text,
    flex:       1,
  },
  check: { fontFamily: font.bold, fontSize: 16 },

  input: {
    fontFamily:        font.regular,
    fontSize:          15,
    color:             colors.text,
    paddingHorizontal: spacing.md,
    paddingVertical:   14,
  },

  hint: {
    fontFamily: font.regular,
    fontSize:   13,
    color:      colors.textTertiary,
    marginLeft: spacing.xs,
    lineHeight: 18,
  },

  customHint: {
    fontFamily:  font.regular,
    fontSize:    13,
    color:       colors.textTertiary,
    marginLeft:  spacing.xs,
    lineHeight:  18,
    fontStyle:   'italic',
  },

  saveButton: {
    borderRadius:    radius.full,
    paddingVertical: 16,
    alignItems:      'center',
    marginTop:       spacing.lg,
  },
  disabled:       { opacity: 0.6 },
  saveButtonText: { fontFamily: font.bold, fontSize: 17, color: colors.textOnColor },
});
