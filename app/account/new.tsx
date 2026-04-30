import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, Alert, ScrollView, ActivityIndicator,
} from 'react-native';
import { useRouter, Link } from 'expo-router';
import * as Crypto from 'expo-crypto';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import {
  AccountType, insertAccount,
  importTransactions, insertImportBatch, updateImportBatchCounts,
} from '../../src/db/queries';
import { ColumnConfig, DEFAULT_CONFIGS } from '../../src/parsers/column-config';
import { detectColumnConfig } from '../../src/parsers/column-detector';
import { GenericRow } from '../../src/parsers/generic-parser';
import { parseCsv } from '../../src/parsers';
import { assignTransactionIds } from '../../src/domain/transaction-id';
import { autoApplyRulesForAccount } from '../../src/domain/rules-engine';
import { ColumnMappingForm } from '../../src/components/ColumnMappingForm';
import { centsToDollars } from '../../src/domain/money';
import { writeBackupSafe } from '../../src/db/backup';
import { colors, font, spacing, radius, accountColor } from '../../src/theme';

const ACCOUNT_TYPES: { label: string; value: AccountType; emoji: string }[] = [
  { label: 'Checking',    value: 'checking',    emoji: '🏦' },
  { label: 'Credit Card', value: 'credit_card', emoji: '💳' },
];

export default function AddAccountScreen() {
  const router = useRouter();

  const [name,        setName]        = useState('');
  const [type,        setType]        = useState<AccountType>('checking');
  const [config,      setConfig]      = useState<ColumnConfig | null>(null);
  const [sampleRows,  setSampleRows]  = useState<GenericRow[]>([]);
  const [csvFilename, setCsvFilename] = useState<string | null>(null);
  const [csvText,     setCsvText]     = useState<string | null>(null);
  const [csvUri,      setCsvUri]      = useState<string | null>(null);
  const [detecting,   setDetecting]   = useState(false);
  const [saving,      setSaving]      = useState(false);

  const accentColor = accountColor[type];

  function patchConfig(patch: Partial<ColumnConfig>) {
    setConfig(prev => prev ? { ...prev, ...patch } : prev);
  }

  async function handlePickCsv() {
    try {
      const picked = await DocumentPicker.getDocumentAsync({
        type: ['text/csv', 'text/comma-separated-values',
               'public.comma-separated-values-text', '*/*'],
        copyToCacheDirectory: true,
      });
      if (picked.canceled) return;
      const asset = picked.assets[0];
      setDetecting(true);

      const text = await FileSystem.readAsStringAsync(asset.uri, {
        encoding: FileSystem.EncodingType.UTF8,
      });

      const result = detectColumnConfig(text);

      if (result.warnings.length > 0) {
        Alert.alert(
          'Heads up',
          result.warnings.join('\n\n') + '\n\nYou can fix the column names below before saving.',
        );
      }

      setConfig(result.config);
      setSampleRows(result.sampleRows);
      setCsvFilename(asset.name ?? 'file.csv');
      setCsvText(text);
      setCsvUri(asset.uri);
    } catch (e: any) {
      Alert.alert('Could not read file', e.message ?? 'Unknown error');
    } finally {
      setDetecting(false);
    }
  }

  function isMappingValid(): boolean {
    if (!config) return false;
    if (!config.dateColumn.trim() || !config.descriptionColumn.trim()) return false;
    if (config.amountStyle === 'signed' && !config.signedAmountColumn?.trim()) return false;
    if (config.amountStyle === 'debit_credit') {
      if (!config.debitColumn?.trim() || !config.creditColumn?.trim()) return false;
    }
    return true;
  }

  async function handleSave() {
    if (!name.trim()) {
      Alert.alert('Name required', 'Please give this account a name.');
      return;
    }
    if (!config) {
      Alert.alert('CSV required', 'Please choose a sample CSV file first so I can detect the column layout.');
      return;
    }
    if (!isMappingValid()) {
      Alert.alert('Mapping incomplete', 'Please fill in all required column fields before saving.');
      return;
    }

    setSaving(true);
    try {
      const newAccountId = Crypto.randomUUID();
      await insertAccount({
        id:            newAccountId,
        name:          name.trim(),
        type,
        csv_format:    'custom',
        column_config: JSON.stringify(config),
        suggest_rules: 1,
        created_at:    Date.now(),
      });

      // Import the CSV that was already picked and read for column detection.
      // The text is already in memory — no need for the user to pick it again.
      if (csvText && config) {
        const rows = parseCsv(config, csvText);
        if (rows.length > 0) {
          const batchId    = Crypto.randomUUID();
          const importedAt = Date.now();
          const ids        = assignTransactionIds(
            rows.map(r => ({
              accountId:   newAccountId,
              dateIso:     r.dateIso,
              amountCents: r.amountCents,
              description: r.description,
            })),
          );
          const parsedRows = rows.map((r, i) => ({
            id:                   ids[i],
            date:                 r.dateIso,
            amount_cents:         r.amountCents,
            description:          r.description,
            original_description: r.originalDescription,
            is_pending:           r.isPending,
          }));

          await insertImportBatch({
            id:                     batchId,
            account_id:             newAccountId,
            filename:               csvFilename ?? 'import.csv',
            imported_at:            importedAt,
            rows_total:             rows.length,
            rows_inserted:          0,
            rows_skipped_duplicate: 0,
            rows_cleared:           0,
            rows_dropped:           0,
          });

          const importResult = await importTransactions(newAccountId, batchId, parsedRows);

          await updateImportBatchCounts(batchId, {
            rows_inserted:          importResult.inserted,
            rows_skipped_duplicate: importResult.skipped,
            rows_cleared:           importResult.cleared,
            rows_dropped:           importResult.dropped,
          });

          await autoApplyRulesForAccount(newAccountId);

          // Delete the cached copy — the app never needs it again.
          if (csvUri) {
            try { await FileSystem.deleteAsync(csvUri, { idempotent: true }); } catch {}
          }
        }
      }

      writeBackupSafe();
      // Replace this screen so "back" from the account detail goes to Home.
      // The query param triggers the per-account foundational rules onboarding
      // sheet on the account detail screen — see app/account/[id]/index.tsx.
      router.replace(`/account/${newAccountId}?showFoundationalOnboarding=1`);
    } catch (e: any) {
      Alert.alert('Error', e.message ?? 'Could not save account. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  const canSave = !!name.trim() && isMappingValid() && !saving;

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
            onPress={() => setType(t.value)}
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

      {/* ── CSV Setup ── */}
      <Text style={styles.sectionLabel}>CSV COLUMN SETUP</Text>

      <TouchableOpacity
        style={[styles.csvPickButton, { borderColor: accentColor }, detecting && styles.disabled]}
        onPress={handlePickCsv}
        disabled={detecting}
        activeOpacity={0.8}
      >
        {detecting ? (
          <ActivityIndicator color={accentColor} style={styles.spinner} />
        ) : null}
        <Text style={[styles.csvPickLabel, { color: accentColor }]}>
          {csvFilename
            ? `✓ ${csvFilename} — tap to change`
            : 'Choose a sample CSV from your bank'}
        </Text>
      </TouchableOpacity>

      <Text style={styles.hint}>
        I'll read the column headers and auto-detect which columns hold the date, description, and amount. You can fix anything that looks wrong below.
      </Text>

      <Link href="/csv-guide" style={styles.csvGuideLink}>
        How do I export a CSV from my bank? →
      </Link>

      {/* ── Detected mapping form ── */}
      {config && (
        <>
          <Text style={styles.sectionLabel}>DETECTED COLUMN MAPPING</Text>
          <ColumnMappingForm
            config={config}
            onChange={patchConfig}
            accentColor={accentColor}
          />

          {/* ── Preview table ── */}
          {sampleRows.length > 0 && (
            <>
              <Text style={styles.sectionLabel}>PREVIEW (FIRST {sampleRows.length} ROWS)</Text>
              <View style={styles.previewCard}>
                <View style={[styles.previewRow, styles.previewHeader]}>
                  <Text style={[styles.previewCell, styles.previewHeaderText, styles.cellDate]}>Date</Text>
                  <Text style={[styles.previewCell, styles.previewHeaderText, styles.cellDesc]}>Description</Text>
                  <Text style={[styles.previewCell, styles.previewHeaderText, styles.cellAmt]}>Amount</Text>
                </View>
                {sampleRows.map((row, i) => (
                  <View key={i} style={[styles.previewRow, i > 0 && styles.previewRowBorder]}>
                    <Text style={[styles.previewCell, styles.cellDate]} numberOfLines={1}>{row.dateIso}</Text>
                    <Text style={[styles.previewCell, styles.cellDesc]} numberOfLines={1}>{row.originalDescription}</Text>
                    <Text style={[styles.previewCell, styles.cellAmt, { color: row.amountCents < 0 ? colors.destructive : colors.income }]} numberOfLines={1}>
                      {centsToDollars(row.amountCents)}
                    </Text>
                  </View>
                ))}
              </View>
              <Text style={styles.hint}>
                If these look right, you're good to go. If not, adjust the column names above.
              </Text>
            </>
          )}
        </>
      )}

      <TouchableOpacity
        style={[styles.saveButton, { backgroundColor: accentColor }, !canSave && styles.disabled]}
        onPress={handleSave}
        disabled={!canSave}
        activeOpacity={0.85}
      >
        <Text style={styles.saveButtonText}>{saving ? 'Saving…' : 'Add Account & Import →'}</Text>
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
    fontFamily:        font.regular,
    fontSize:          15,
    color:             colors.text,
    paddingHorizontal: spacing.md,
    paddingVertical:   14,
  },

  csvPickButton: {
    flexDirection:   'row',
    alignItems:      'center',
    justifyContent:  'center',
    borderWidth:     1.5,
    borderStyle:     'dashed',
    borderRadius:    radius.lg,
    paddingVertical: 18,
    paddingHorizontal: spacing.md,
    gap:             spacing.xs,
  },
  spinner: { marginRight: spacing.xs },
  csvPickLabel: {
    fontFamily: font.semiBold,
    fontSize:   15,
    textAlign:  'center',
  },

  hint: {
    fontFamily: font.regular,
    fontSize:   13,
    color:      colors.textTertiary,
    marginLeft: spacing.xs,
    lineHeight: 18,
  },

  csvGuideLink: {
    fontFamily: font.bold,
    fontSize:   13,
    color:      colors.primary,
    marginLeft: spacing.xs,
  },

  previewCard: {
    backgroundColor: colors.surface,
    borderRadius:    radius.lg,
    overflow:        'hidden',
    borderWidth:     1,
    borderColor:     colors.border,
  },
  previewRow: {
    flexDirection:     'row',
    paddingHorizontal: spacing.sm,
    paddingVertical:   10,
    alignItems:        'center',
  },
  previewRowBorder: {
    borderTopWidth: 1,
    borderTopColor: colors.separator,
  },
  previewHeader: {
    backgroundColor: colors.background,
  },
  previewHeaderText: {
    fontFamily: font.semiBold,
    color:      colors.textSecondary,
  },
  previewCell: {
    fontFamily: font.regular,
    fontSize:   12,
    color:      colors.text,
    paddingHorizontal: 2,
  },
  cellDate: { width: 90 },
  cellDesc: { flex: 1 },
  cellAmt:  { width: 80, textAlign: 'right' },

  saveButton: {
    borderRadius:    radius.full,
    paddingVertical: 16,
    alignItems:      'center',
    marginTop:       spacing.lg,
  },
  disabled:       { opacity: 0.6 },
  saveButtonText: {
    fontFamily: font.bold,
    fontSize:   17,
    color:      colors.textOnColor,
  },
});
