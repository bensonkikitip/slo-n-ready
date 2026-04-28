import React, { useEffect, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  Alert, ScrollView, ActivityIndicator,
} from 'react-native';
import { useRouter, useLocalSearchParams, Stack } from 'expo-router';
import {
  Account, AccountType, CsvFormat,
  getAllAccounts, getTransactions, updateAccount, deleteAccount, parseColumnConfig,
} from '../../../src/db/queries';
import { writeBackup } from '../../../src/db/backup';
import { ColumnConfig, DEFAULT_CONFIGS, DateFormat, AmountStyle } from '../../../src/parsers/column-config';
import { colors, font, spacing, radius, accountColor } from '../../../src/theme';

const ACCOUNT_TYPES: { label: string; value: AccountType; emoji: string }[] = [
  { label: 'Checking',    value: 'checking',    emoji: '🏦' },
  { label: 'Credit Card', value: 'credit_card', emoji: '💳' },
];

const CSV_FORMATS: { label: string; value: CsvFormat; forType: AccountType }[] = [
  { label: 'Bank of America – Checking', value: 'boa_checking_v1', forType: 'checking' },
  { label: 'Citi – Credit Card',         value: 'citi_cc_v1',      forType: 'credit_card' },
];

const DATE_FORMATS: DateFormat[] = ['MM/DD/YYYY', 'DD/MM/YYYY', 'YYYY-MM-DD'];

export default function EditAccountScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router  = useRouter();

  const [account,         setAccount]         = useState<Account | null>(null);
  const [name,            setName]            = useState('');
  const [type,            setType]            = useState<AccountType>('checking');
  const [csvFormat,       setCsvFormat]       = useState<CsvFormat>('boa_checking_v1');
  const [config,          setConfig]          = useState<ColumnConfig>(DEFAULT_CONFIGS['boa_checking_v1']);
  const [hasTransactions, setHasTransactions] = useState(false);
  const [loading,         setLoading]         = useState(true);
  const [saving,          setSaving]          = useState(false);

  useEffect(() => {
    (async () => {
      const accts = await getAllAccounts();
      const acct  = accts.find(a => a.id === id) ?? null;
      if (acct) {
        setAccount(acct);
        setName(acct.name);
        setType(acct.type);
        setCsvFormat(acct.csv_format);
        setConfig(parseColumnConfig(acct));
        const txns = await getTransactions(id);
        setHasTransactions(txns.length > 0);
      }
      setLoading(false);
    })();
  }, [id]);

  const accent = accountColor[type];

  function patchConfig(patch: Partial<ColumnConfig>) {
    setConfig(prev => ({ ...prev, ...patch }));
  }

  function handleTypeChange(newType: AccountType) {
    const fmt = CSV_FORMATS.find(f => f.forType === newType);
    if (!fmt) return;

    function apply() {
      setType(newType);
      setCsvFormat(fmt!.value);
      setConfig(DEFAULT_CONFIGS[fmt!.value]);
    }

    if (hasTransactions) {
      Alert.alert(
        'Change Account Type?',
        'This resets your column mapping to the new type\'s defaults. Existing transactions are not affected — only future imports will use the new mapping.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Reset & Change', style: 'destructive', onPress: apply },
        ],
      );
    } else {
      apply();
    }
  }

  function handleReset() {
    Alert.alert(
      'Reset to Defaults?',
      "This will restore the default column mapping for this account's format template.",
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Reset', onPress: () => setConfig(DEFAULT_CONFIGS[csvFormat]) },
      ],
    );
  }

  async function handleSave() {
    if (!name.trim()) {
      Alert.alert('Name required', 'Please give this account a name.');
      return;
    }
    setSaving(true);
    try {
      await updateAccount(id, {
        name:          name.trim(),
        type,
        csv_format:    csvFormat,
        column_config: JSON.stringify(config),
      });
      void writeBackup();
      router.back();
    } catch {
      Alert.alert('Error', 'Could not save changes. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  if (!account) {
    return (
      <View style={styles.center}>
        <Text style={styles.notFound}>Account not found.</Text>
      </View>
    );
  }

  return (
    <>
      <Stack.Screen options={{ title: 'Edit Account' }} />
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        {/* ── Account Name ── */}
        <Text style={styles.sectionLabel}>ACCOUNT NAME</Text>
        <View style={styles.card}>
          <TextInput
            style={styles.input}
            value={name}
            onChangeText={setName}
            placeholderTextColor={colors.textTertiary}
            returnKeyType="done"
          />
        </View>

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
              <Text style={[styles.optionLabel, type === t.value && { color: accent }]}>
                {t.label}
              </Text>
              {type === t.value && <Text style={[styles.check, { color: accent }]}>✓</Text>}
            </TouchableOpacity>
          ))}
        </View>

        {/* ── CSV Column Mapping ── */}
        <Text style={styles.sectionLabel}>CSV COLUMN MAPPING</Text>

        <Text style={styles.fieldLabel}>Date column name</Text>
        <View style={styles.card}>
          <TextInput
            style={styles.input}
            value={config.dateColumn}
            onChangeText={v => patchConfig({ dateColumn: v })}
            placeholderTextColor={colors.textTertiary}
            autoCapitalize="words"
            returnKeyType="done"
          />
        </View>

        <Text style={styles.fieldLabel}>Description column name</Text>
        <View style={styles.card}>
          <TextInput
            style={styles.input}
            value={config.descriptionColumn}
            onChangeText={v => patchConfig({ descriptionColumn: v })}
            placeholderTextColor={colors.textTertiary}
            autoCapitalize="words"
            returnKeyType="done"
          />
        </View>

        <Text style={styles.fieldLabel}>Date format</Text>
        <View style={[styles.card, styles.segmentRow]}>
          {DATE_FORMATS.map((fmt, i) => (
            <TouchableOpacity
              key={fmt}
              style={[
                styles.segment,
                i > 0 && styles.segmentBorder,
                config.dateFormat === fmt && { backgroundColor: accent },
              ]}
              onPress={() => patchConfig({ dateFormat: fmt })}
              activeOpacity={0.7}
            >
              <Text style={[
                styles.segmentText,
                config.dateFormat === fmt && styles.segmentTextActive,
              ]}>
                {fmt}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={styles.fieldLabel}>Amount style</Text>
        <View style={[styles.card, styles.segmentRow]}>
          {(['signed', 'debit_credit'] as AmountStyle[]).map((val, i) => (
            <TouchableOpacity
              key={val}
              style={[
                styles.segment,
                i > 0 && styles.segmentBorder,
                config.amountStyle === val && { backgroundColor: accent },
              ]}
              onPress={() => patchConfig({ amountStyle: val })}
              activeOpacity={0.7}
            >
              <Text style={[
                styles.segmentText,
                config.amountStyle === val && styles.segmentTextActive,
              ]}>
                {val === 'signed' ? 'Single Column' : 'Debit / Credit'}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* ── Signed amount fields ── */}
        {config.amountStyle === 'signed' && (
          <>
            <Text style={styles.fieldLabel}>Amount column name</Text>
            <View style={styles.card}>
              <TextInput
                style={styles.input}
                value={config.signedAmountColumn ?? ''}
                onChangeText={v => patchConfig({ signedAmountColumn: v })}
                placeholderTextColor={colors.textTertiary}
                autoCapitalize="words"
                returnKeyType="done"
              />
            </View>

            <Text style={styles.fieldLabel}>Skip preamble until header contains (optional)</Text>
            <View style={styles.card}>
              <TextInput
                style={styles.input}
                value={config.headerContains ?? ''}
                onChangeText={v => patchConfig({ headerContains: v || undefined })}
                placeholder="e.g. Date,Description,Amount"
                placeholderTextColor={colors.textTertiary}
                autoCapitalize="none"
                returnKeyType="done"
              />
            </View>
          </>
        )}

        {/* ── Debit / Credit fields ── */}
        {config.amountStyle === 'debit_credit' && (
          <>
            <Text style={styles.fieldLabel}>Debit column name</Text>
            <View style={styles.card}>
              <TextInput
                style={styles.input}
                value={config.debitColumn ?? ''}
                onChangeText={v => patchConfig({ debitColumn: v })}
                placeholderTextColor={colors.textTertiary}
                autoCapitalize="words"
                returnKeyType="done"
              />
            </View>

            <Text style={styles.fieldLabel}>Credit column name</Text>
            <View style={styles.card}>
              <TextInput
                style={styles.input}
                value={config.creditColumn ?? ''}
                onChangeText={v => patchConfig({ creditColumn: v })}
                placeholderTextColor={colors.textTertiary}
                autoCapitalize="words"
                returnKeyType="done"
              />
            </View>

            <Text style={styles.fieldLabel}>Pending status column (optional)</Text>
            <View style={styles.card}>
              <TextInput
                style={styles.input}
                value={config.pendingColumn ?? ''}
                onChangeText={v => patchConfig({ pendingColumn: v || undefined })}
                placeholder="e.g. Status"
                placeholderTextColor={colors.textTertiary}
                autoCapitalize="words"
                returnKeyType="done"
              />
            </View>

            {!!config.pendingColumn && (
              <>
                <Text style={styles.fieldLabel}>Cleared value</Text>
                <View style={styles.card}>
                  <TextInput
                    style={styles.input}
                    value={config.clearedValue ?? ''}
                    onChangeText={v => patchConfig({ clearedValue: v || undefined })}
                    placeholder="e.g. Cleared"
                    placeholderTextColor={colors.textTertiary}
                    autoCapitalize="words"
                    returnKeyType="done"
                  />
                </View>
              </>
            )}
          </>
        )}

        <Text style={styles.hint}>
          Changes apply to new imports only — existing transactions are not re-parsed.
        </Text>

        <TouchableOpacity style={styles.ghostButton} onPress={handleReset} activeOpacity={0.7}>
          <Text style={[styles.ghostButtonText, { color: accent }]}>Reset to Template Defaults</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.saveButton, { backgroundColor: accent }, saving && styles.disabled]}
          onPress={handleSave}
          disabled={saving}
          activeOpacity={0.85}
        >
          <Text style={styles.saveButtonText}>{saving ? 'Saving…' : 'Save Changes'}</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.deleteButton}
          onPress={() => {
            Alert.alert(
              'Delete Account',
              'This will permanently delete this account and all its transactions. Cannot be undone.',
              [
                { text: 'Cancel', style: 'cancel' },
                {
                  text: 'Delete', style: 'destructive',
                  onPress: async () => {
                    await deleteAccount(id);
                    void writeBackup();
                    router.replace('/');
                  },
                },
              ],
            );
          }}
          activeOpacity={0.7}
        >
          <Text style={styles.deleteButtonText}>Delete Account</Text>
        </TouchableOpacity>
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content:   { padding: spacing.md, gap: spacing.sm, paddingBottom: spacing.xxl },
  center:    { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.background },
  notFound:  { fontFamily: font.regular, fontSize: 15, color: colors.textSecondary },

  sectionLabel: {
    fontFamily:    font.semiBold,
    fontSize:      11,
    color:         colors.textTertiary,
    letterSpacing: 0.8,
    marginTop:     spacing.md,
    marginBottom:  spacing.xs,
    marginLeft:    spacing.xs,
  },
  fieldLabel: {
    fontFamily:   font.regular,
    fontSize:     13,
    color:        colors.textSecondary,
    marginTop:    spacing.sm,
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

  segmentRow: { flexDirection: 'row' },
  segment: {
    flex:           1,
    paddingVertical: 13,
    alignItems:     'center',
  },
  segmentBorder: { borderLeftWidth: 1, borderLeftColor: colors.border },
  segmentText: {
    fontFamily: font.semiBold,
    fontSize:   13,
    color:      colors.textSecondary,
  },
  segmentTextActive: { color: colors.textOnColor },

  hint: {
    fontFamily: font.regular,
    fontSize:   13,
    color:      colors.textTertiary,
    marginLeft: spacing.xs,
    lineHeight: 18,
    marginTop:  spacing.sm,
  },

  ghostButton: { paddingVertical: 14, alignItems: 'center', marginTop: spacing.xs },
  ghostButtonText: { fontFamily: font.semiBold, fontSize: 16 },

  saveButton: {
    borderRadius:    radius.full,
    paddingVertical: 16,
    alignItems:      'center',
    marginTop:       spacing.sm,
  },
  disabled:       { opacity: 0.6 },
  saveButtonText: { fontFamily: font.bold, fontSize: 17, color: colors.textOnColor },

  deleteButton: {
    paddingVertical: 14,
    alignItems:      'center',
    marginTop:       spacing.sm,
  },
  deleteButtonText: {
    fontFamily: font.semiBold,
    fontSize:   16,
    color:      colors.destructive,
  },
});
