import React, { useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  Alert, ScrollView, ActivityIndicator,
} from 'react-native';
import { useRouter, useLocalSearchParams, Stack } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import * as Crypto from 'expo-crypto';
import {
  getAllAccounts, Account, importTransactions,
  insertImportBatch, updateImportBatchCounts, ImportResult, parseColumnConfig,
} from '../../../src/db/queries';
import { writeBackup } from '../../../src/db/backup';
import { parseCsv, ParsedRow } from '../../../src/parsers';
import { assignTransactionIds } from '../../../src/domain/transaction-id';
import { centsToDollars } from '../../../src/domain/money';
import { Sloth } from '../../../src/components/Sloth';
import { colors, font, spacing, radius, accountColor } from '../../../src/theme';

type Phase = 'pick' | 'preview' | 'done';

interface PreviewData { filename: string; rows: ParsedRow[]; ids: string[] }

export default function ImportScreen() {
  const { id: accountId } = useLocalSearchParams<{ id: string }>();
  const router  = useRouter();
  const insets  = useSafeAreaInsets();
  const [phase,   setPhase]   = useState<Phase>('pick');
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [result,  setResult]  = useState<ImportResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [account, setAccount] = useState<Account | null>(null);

  React.useEffect(() => {
    getAllAccounts().then(accts => setAccount(accts.find(a => a.id === accountId) ?? null));
  }, [accountId]);

  const accent = account ? accountColor[account.type] : colors.primary;

  async function handlePickFile() {
    try {
      const picked = await DocumentPicker.getDocumentAsync({
        type: ['text/csv', 'text/comma-separated-values',
               'public.comma-separated-values-text', '*/*'],
        copyToCacheDirectory: true,
      });
      if (picked.canceled) return;
      const asset = picked.assets[0];
      setLoading(true);

      const text = await FileSystem.readAsStringAsync(asset.uri, {
        encoding: FileSystem.EncodingType.UTF8,
      });
      if (!account) throw new Error('Account not found');

      const rows = parseCsv(parseColumnConfig(account), text);
      if (rows.length === 0) throw new Error('No transactions found in this file.');

      const ids = assignTransactionIds(
        rows.map(r => ({ accountId, dateIso: r.dateIso, amountCents: r.amountCents, description: r.description })),
      );
      setPreview({ filename: asset.name ?? 'file.csv', rows, ids });
      setPhase('preview');
    } catch (e: any) {
      Alert.alert('Could not read file', e.message ?? 'Unknown error');
    } finally {
      setLoading(false);
    }
  }

  async function handleConfirmImport() {
    if (!preview) return;
    setLoading(true);
    try {
      const batchId     = Crypto.randomUUID();
      const importedAt  = Date.now();

      // Insert batch FIRST — transactions reference it via FK constraint
      await insertImportBatch({
        id:                     batchId,
        account_id:             accountId,
        filename:               preview.filename,
        imported_at:            importedAt,
        rows_total:             preview.rows.length,
        rows_inserted:          0,
        rows_skipped_duplicate: 0,
        rows_cleared:           0,
        rows_dropped:           0,
      });

      const parsedRows = preview.rows.map((r, i) => ({
        id:                   preview.ids[i],
        date:                 r.dateIso,
        amount_cents:         r.amountCents,
        description:          r.description,
        original_description: r.originalDescription,
        is_pending:           r.isPending,
      }));

      const importResult = await importTransactions(accountId, batchId, parsedRows);

      // Update batch with actual counts now that we know them
      await updateImportBatchCounts(batchId, {
        rows_inserted:          importResult.inserted,
        rows_skipped_duplicate: importResult.skipped,
        rows_cleared:           importResult.cleared,
        rows_dropped:           importResult.dropped,
      });

      void writeBackup();
      setResult(importResult);
      setPhase('done');
    } catch (e: any) {
      Alert.alert('Import failed', e.message ?? 'Unknown error');
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <Stack.Screen options={{ title: 'Import CSV' }} />
      <ScrollView
        style={styles.container}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + spacing.xl }]}
      >

        {/* ── Pick phase ── */}
        {phase === 'pick' && (
          <View style={styles.pickContainer}>
            <Sloth sloth="phoneDollar" size={130} />
            {account && (
              <Text style={styles.pickAccount}>
                Importing into{' '}
                <Text style={[styles.pickAccountName, { color: accent }]}>
                  {account.name}
                </Text>
              </Text>
            )}
            <Text style={styles.pickBody}>
              Hand me a CSV from your bank and I'll show you a preview before saving anything.
            </Text>
            {loading
              ? <ActivityIndicator color={accent} style={{ marginTop: spacing.lg }} />
              : (
                <TouchableOpacity
                  style={[styles.primaryButton, { backgroundColor: accent }]}
                  onPress={handlePickFile}
                  activeOpacity={0.85}
                >
                  <Text style={styles.primaryButtonText}>Choose File…</Text>
                </TouchableOpacity>
              )
            }
          </View>
        )}

        {/* ── Preview phase ── */}
        {phase === 'preview' && preview && (
          <View style={styles.previewContainer}>
            <View style={styles.previewHeader}>
              <Text style={styles.previewFilename}>{preview.filename}</Text>
              <Text style={styles.previewCount}>{preview.rows.length} transactions found</Text>
            </View>

            <View style={styles.previewList}>
              {preview.rows.slice(0, 6).map((r, i) => (
                <View key={i} style={[styles.previewRow, i > 0 && styles.previewRowBorder]}>
                  <View style={styles.previewLeft}>
                    <Text style={styles.previewDesc} numberOfLines={1}>{r.description}</Text>
                    <Text style={styles.previewDate}>{r.dateIso}</Text>
                  </View>
                  <Text style={[
                    styles.previewAmount,
                    { color: r.amountCents >= 0 ? colors.income : colors.text },
                  ]}>
                    {centsToDollars(r.amountCents)}
                  </Text>
                </View>
              ))}
              {preview.rows.length > 6 && (
                <Text style={styles.moreRows}>
                  …and {preview.rows.length - 6} more
                </Text>
              )}
            </View>

            <Text style={styles.dedupeNote}>
              Don't worry about duplicates — I'll skip anything I've already seen.
            </Text>

            {loading
              ? <ActivityIndicator color={accent} style={{ marginTop: spacing.lg }} />
              : (
                <>
                  <TouchableOpacity
                    style={[styles.primaryButton, { backgroundColor: accent }]}
                    onPress={handleConfirmImport}
                    activeOpacity={0.85}
                  >
                    <Text style={styles.primaryButtonText}>
                      Import {preview.rows.length} Transactions
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.ghostButton} onPress={() => setPhase('pick')}>
                    <Text style={[styles.ghostButtonText, { color: accent }]}>
                      Choose a Different File
                    </Text>
                  </TouchableOpacity>
                </>
              )
            }
          </View>
        )}

        {/* ── Done phase ── */}
        {phase === 'done' && result && (
          <View style={styles.doneContainer}>
            <Sloth sloth="thumbsUp" size={140} />
            <Text style={styles.doneTitle}>All done — nice work!</Text>

            <View style={styles.statsCard}>
              <StatRow label="Added"                   value={String(result.inserted)} />
              {result.cleared > 0 && (
                <StatRow label="Pending → Cleared" value={String(result.cleared)} color={colors.income} />
              )}
              {result.dropped > 0 && (
                <StatRow label="Dropped (never posted)" value={String(result.dropped)} color={colors.dropped} />
              )}
              <StatRow label="Skipped (duplicates)"  value={String(result.skipped)} />
              <StatRow label="Total in file"          value={String(result.total)} last />
            </View>

            <TouchableOpacity
              style={[styles.primaryButton, { backgroundColor: accent }]}
              onPress={() => router.back()}
              activeOpacity={0.85}
            >
              <Text style={styles.primaryButtonText}>Back to Account</Text>
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>
    </>
  );
}

function StatRow({
  label, value, color, last,
}: { label: string; value: string; color?: string; last?: boolean }) {
  return (
    <View style={[styles.statRow, !last && styles.statRowBorder]}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={[styles.statValue, color ? { color } : {}]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content:   { padding: spacing.md },

  // Pick
  pickContainer: { alignItems: 'center', paddingTop: spacing.xl, gap: spacing.md },
  pickAccount:   { fontFamily: font.regular, fontSize: 15, color: colors.textSecondary },
  pickAccountName: { fontFamily: font.bold },
  pickBody: {
    fontFamily: font.regular, fontSize: 15, color: colors.textSecondary,
    textAlign: 'center', lineHeight: 22,
  },

  // Preview
  previewContainer: { gap: spacing.md },
  previewHeader: {
    backgroundColor: colors.surface, borderRadius: radius.lg,
    padding: spacing.md, borderWidth: 1, borderColor: colors.border,
  },
  previewFilename: { fontFamily: font.bold, fontSize: 16, color: colors.text },
  previewCount:    { fontFamily: font.regular, fontSize: 13, color: colors.textTertiary, marginTop: 3 },
  previewList: {
    backgroundColor: colors.surface, borderRadius: radius.lg,
    overflow: 'hidden', borderWidth: 1, borderColor: colors.border,
  },
  previewRow:       { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.md, paddingVertical: 11 },
  previewRowBorder: { borderTopWidth: 1, borderTopColor: colors.separator },
  previewLeft:      { flex: 1, marginRight: spacing.sm },
  previewDesc:      { fontFamily: font.semiBold, fontSize: 14, color: colors.text },
  previewDate:      { fontFamily: font.regular, fontSize: 12, color: colors.textTertiary, marginTop: 2 },
  previewAmount:    { fontFamily: font.bold, fontSize: 14 },
  moreRows:         { fontFamily: font.regular, fontSize: 13, color: colors.textTertiary, textAlign: 'center', padding: spacing.sm },
  dedupeNote: {
    fontFamily: font.regular, fontSize: 13, color: colors.textTertiary,
    textAlign: 'center', fontStyle: 'italic',
  },

  // Done
  doneContainer: { alignItems: 'center', paddingTop: spacing.xl, gap: spacing.md },
  doneTitle:     { fontFamily: font.extraBold, fontSize: 26, color: colors.text },
  statsCard: {
    width: '100%', backgroundColor: colors.surface,
    borderRadius: radius.lg, overflow: 'hidden',
    borderWidth: 1, borderColor: colors.border,
    marginBottom: spacing.sm,
  },
  statRow:       { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: spacing.md, paddingVertical: 13 },
  statRowBorder: { borderBottomWidth: 1, borderBottomColor: colors.separator },
  statLabel:     { fontFamily: font.regular, fontSize: 15, color: colors.textSecondary },
  statValue:     { fontFamily: font.bold, fontSize: 15, color: colors.text },

  // Shared
  primaryButton: {
    width: '100%', borderRadius: radius.full,
    paddingVertical: 16, alignItems: 'center', marginTop: spacing.sm,
  },
  primaryButtonText: { fontFamily: font.bold, fontSize: 17, color: colors.textOnColor },
  ghostButton:       { paddingVertical: 14, alignItems: 'center' },
  ghostButtonText:   { fontFamily: font.semiBold, fontSize: 16 },
});
