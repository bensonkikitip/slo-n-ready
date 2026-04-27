import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, Alert, ScrollView,
} from 'react-native';
import { useRouter } from 'expo-router';
import * as Crypto from 'expo-crypto';
import { AccountType, CsvFormat, insertAccount } from '../../src/db/queries';
import { DEFAULT_CONFIGS } from '../../src/parsers/column-config';
import { writeBackup } from '../../src/db/backup';
import { colors, font, spacing, radius, accountColor } from '../../src/theme';

const ACCOUNT_TYPES: { label: string; value: AccountType; emoji: string }[] = [
  { label: 'Checking',    value: 'checking',    emoji: '🏦' },
  { label: 'Credit Card', value: 'credit_card', emoji: '💳' },
];

const CSV_FORMATS: { label: string; value: CsvFormat; forType: AccountType }[] = [
  { label: 'Bank of America – Checking', value: 'boa_checking_v1', forType: 'checking'    },
  { label: 'Citi – Credit Card',         value: 'citi_cc_v1',      forType: 'credit_card' },
];

export default function AddAccountScreen() {
  const router = useRouter();
  const [name,      setName]      = useState('');
  const [type,      setType]      = useState<AccountType>('checking');
  const [csvFormat, setCsvFormat] = useState<CsvFormat>('boa_checking_v1');
  const [saving,    setSaving]    = useState(false);

  const accentColor = accountColor[type];
  const availableFormats = CSV_FORMATS.filter(f => f.forType === type);

  function handleTypeChange(newType: AccountType) {
    setType(newType);
    const def = CSV_FORMATS.find(f => f.forType === newType);
    if (def) setCsvFormat(def.value);
  }

  async function handleSave() {
    if (!name.trim()) {
      Alert.alert('Name required', 'Please give this account a name.');
      return;
    }
    setSaving(true);
    try {
      await insertAccount({
        id:            Crypto.randomUUID(),
        name:          name.trim(),
        type,
        csv_format:    csvFormat,
        column_config: JSON.stringify(DEFAULT_CONFIGS[csvFormat]),
        created_at:    Date.now(),
      });
      void writeBackup();
      router.back();
    } catch {
      Alert.alert('Error', 'Could not save account. Please try again.');
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
      {/* Account type picker — shown first so the accent color responds immediately */}
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

      <Text style={styles.sectionLabel}>ACCOUNT NAME</Text>
      <View style={styles.card}>
        <TextInput
          style={styles.input}
          placeholder="e.g. BoA Checking, Citi Rewards"
          placeholderTextColor={colors.textTertiary}
          value={name}
          onChangeText={setName}
          autoFocus
          returnKeyType="done"
        />
      </View>

      <Text style={styles.sectionLabel}>CSV FORMAT</Text>
      <View style={styles.card}>
        {availableFormats.map((f, i) => (
          <TouchableOpacity
            key={f.value}
            style={[
              styles.option,
              i > 0 && styles.optionBorder,
              csvFormat === f.value && { backgroundColor: colors.primaryLight },
            ]}
            onPress={() => setCsvFormat(f.value)}
            activeOpacity={0.7}
          >
            <Text style={[styles.optionLabel, csvFormat === f.value && { color: accentColor }]}>
              {f.label}
            </Text>
            {csvFormat === f.value && (
              <Text style={[styles.check, { color: accentColor }]}>✓</Text>
            )}
          </TouchableOpacity>
        ))}
      </View>
      <Text style={styles.hint}>
        This tells me how to read your bank's CSV — pick the one that matches your bank.
      </Text>

      <TouchableOpacity
        style={[styles.saveButton, { backgroundColor: accentColor }, saving && styles.disabled]}
        onPress={handleSave}
        disabled={saving}
        activeOpacity={0.85}
      >
        <Text style={styles.saveButtonText}>{saving ? 'Saving…' : 'Add Account'}</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content:   { padding: spacing.md, gap: spacing.sm },

  sectionLabel: {
    fontFamily:   font.semiBold,
    fontSize:     11,
    color:        colors.textTertiary,
    letterSpacing: 0.8,
    marginTop:    spacing.md,
    marginBottom: spacing.xs,
    marginLeft:   spacing.xs,
  },

  card: {
    backgroundColor: colors.surface,
    borderRadius:    radius.lg,
    overflow:        'hidden',
    borderWidth:     1,
    borderColor:     colors.border,
  },

  option: {
    flexDirection:  'row',
    alignItems:     'center',
    paddingHorizontal: spacing.md,
    paddingVertical: 14,
    gap:            spacing.sm,
  },
  optionBorder: {
    borderTopWidth: 1,
    borderTopColor: colors.separator,
  },
  optionEmoji: { fontSize: 18 },
  optionLabel: {
    fontFamily: font.semiBold,
    fontSize:   15,
    color:      colors.text,
    flex:       1,
  },
  check: {
    fontFamily: font.bold,
    fontSize:   16,
  },

  input: {
    fontFamily:   font.regular,
    fontSize:     15,
    color:        colors.text,
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

  saveButton: {
    borderRadius:    radius.full,
    paddingVertical: 16,
    alignItems:      'center',
    marginTop:       spacing.lg,
  },
  disabled: { opacity: 0.6 },
  saveButtonText: {
    fontFamily: font.bold,
    fontSize:   17,
    color:      colors.textOnColor,
  },
});
