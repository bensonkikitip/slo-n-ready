import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { useRouter, useLocalSearchParams, Stack } from 'expo-router';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';
import * as Crypto from 'expo-crypto';
import { getAllAccounts, Account, importTransactions, insertImportBatch, ImportResult } from '../../../src/db/queries';
import { parseCsv, ParsedRow } from '../../../src/parsers';
import { assignTransactionIds } from '../../../src/domain/transaction-id';
import { centsToDollars } from '../../../src/domain/money';

type Phase = 'pick' | 'preview' | 'done';

interface PreviewData {
  filename: string;
  rows: ParsedRow[];
  ids: string[];
}

export default function ImportScreen() {
  const { id: accountId } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>('pick');
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [account, setAccount] = useState<Account | null>(null);

  // Load account once on mount
  React.useEffect(() => {
    getAllAccounts().then((accts) => {
      setAccount(accts.find((a) => a.id === accountId) ?? null);
    });
  }, [accountId]);

  async function handlePickFile() {
    try {
      const picked = await DocumentPicker.getDocumentAsync({
        type: ['text/csv', 'text/comma-separated-values', 'public.comma-separated-values-text', '*/*'],
        copyToCacheDirectory: true,
      });
      if (picked.canceled) return;

      const asset = picked.assets[0];
      setLoading(true);

      const text = await FileSystem.readAsStringAsync(asset.uri, {
        encoding: FileSystem.EncodingType.UTF8,
      });

      if (!account) throw new Error('Account not found');

      const rows = parseCsv(account.csv_format, text);
      if (rows.length === 0) throw new Error('No transactions found in this file.');

      const ids = assignTransactionIds(
        rows.map((r) => ({
          accountId,
          dateIso: r.dateIso,
          amountCents: r.amountCents,
          description: r.description,
        })),
      );

      setPreview({ filename: asset.name ?? 'file.csv', rows, ids });
      setPhase('preview');
    } catch (e: any) {
      Alert.alert('Error reading file', e.message ?? 'Unknown error');
    } finally {
      setLoading(false);
    }
  }

  async function handleConfirmImport() {
    if (!preview) return;
    setLoading(true);
    try {
      const batchId = Crypto.randomUUID();
      const parsedRows = preview.rows.map((r, i) => ({
        id: preview.ids[i],
        date: r.dateIso,
        amount_cents: r.amountCents,
        description: r.description,
        original_description: r.originalDescription,
        is_pending: r.isPending,
      }));

      const importResult = await importTransactions(accountId, batchId, parsedRows);

      await insertImportBatch({
        id: batchId,
        account_id: accountId,
        filename: preview.filename,
        imported_at: Date.now(),
        rows_total: importResult.total,
        rows_inserted: importResult.inserted,
        rows_skipped_duplicate: importResult.skipped,
        rows_cleared: importResult.cleared,
        rows_dropped: importResult.dropped,
      });

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
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        {phase === 'pick' && (
          <View style={styles.pickContainer}>
            {account && (
              <Text style={styles.accountLabel}>
                Importing into: <Text style={styles.accountName}>{account.name}</Text>
              </Text>
            )}
            <Text style={styles.instruction}>
              Select a CSV file exported from your bank. The file will be parsed and
              previewed before any data is saved.
            </Text>
            {loading ? (
              <ActivityIndicator style={{ marginTop: 32 }} />
            ) : (
              <TouchableOpacity style={styles.primaryButton} onPress={handlePickFile}>
                <Text style={styles.primaryButtonText}>Choose File…</Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        {phase === 'preview' && preview && (
          <View>
            <View style={styles.previewHeader}>
              <Text style={styles.previewTitle}>{preview.filename}</Text>
              <Text style={styles.previewCount}>{preview.rows.length} transactions parsed</Text>
            </View>

            {preview.rows.slice(0, 5).map((r, i) => (
              <View key={i} style={styles.previewRow}>
                <View style={styles.previewLeft}>
                  <Text style={styles.previewDesc} numberOfLines={1}>{r.description}</Text>
                  <Text style={styles.previewDate}>{r.dateIso}</Text>
                </View>
                <Text style={[styles.previewAmount, r.amountCents >= 0 ? styles.positive : styles.negative]}>
                  {centsToDollars(r.amountCents)}
                </Text>
              </View>
            ))}

            {preview.rows.length > 5 && (
              <Text style={styles.moreRows}>…and {preview.rows.length - 5} more</Text>
            )}

            <Text style={styles.dedupeNote}>
              Duplicate transactions (already imported) will be skipped automatically.
            </Text>

            {loading ? (
              <ActivityIndicator style={{ marginTop: 24 }} />
            ) : (
              <>
                <TouchableOpacity style={styles.primaryButton} onPress={handleConfirmImport}>
                  <Text style={styles.primaryButtonText}>Import {preview.rows.length} Transactions</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.secondaryButton} onPress={() => setPhase('pick')}>
                  <Text style={styles.secondaryButtonText}>Choose a Different File</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        )}

        {phase === 'done' && result && (
          <View style={styles.doneContainer}>
            <Text style={styles.doneIcon}>✓</Text>
            <Text style={styles.doneTitle}>Import Complete</Text>
            <View style={styles.doneStats}>
              <StatRow label="Added" value={String(result.inserted)} />
              {result.cleared > 0 && (
                <StatRow label="Pending → Cleared" value={String(result.cleared)} highlight />
              )}
              {result.dropped > 0 && (
                <StatRow label="Dropped (never posted)" value={String(result.dropped)} muted />
              )}
              <StatRow label="Skipped (duplicates)" value={String(result.skipped)} />
              <StatRow label="Total in file" value={String(result.total)} />
            </View>
            <TouchableOpacity style={styles.primaryButton} onPress={() => router.back()}>
              <Text style={styles.primaryButtonText}>Done</Text>
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>
    </>
  );
}

function StatRow({ label, value, highlight, muted }: { label: string; value: string; highlight?: boolean; muted?: boolean }) {
  return (
    <View style={styles.statRow}>
      <Text style={[styles.statLabel, muted && styles.statMuted]}>{label}</Text>
      <Text style={[styles.statValue, highlight && styles.statHighlight, muted && styles.statMuted]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f2f2f7' },
  content: { padding: 16 },
  pickContainer: { alignItems: 'center', paddingTop: 32 },
  accountLabel: { fontSize: 15, color: '#8e8e93', marginBottom: 12 },
  accountName: { color: '#1c1c1e', fontWeight: '600' },
  instruction: { fontSize: 15, color: '#3a3a3c', textAlign: 'center', lineHeight: 22, marginBottom: 32 },
  primaryButton: {
    backgroundColor: '#007aff',
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 16,
  },
  primaryButtonText: { color: '#fff', fontSize: 17, fontWeight: '600' },
  secondaryButton: { paddingVertical: 16, alignItems: 'center', marginTop: 4 },
  secondaryButtonText: { color: '#007aff', fontSize: 16 },
  previewHeader: {
    backgroundColor: '#fff',
    padding: 16,
    borderRadius: 12,
    marginBottom: 12,
  },
  previewTitle: { fontSize: 16, fontWeight: '600', color: '#1c1c1e' },
  previewCount: { fontSize: 14, color: '#8e8e93', marginTop: 4 },
  previewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#d1d1d6',
  },
  previewLeft: { flex: 1, marginRight: 8 },
  previewDesc: { fontSize: 14, color: '#1c1c1e' },
  previewDate: { fontSize: 12, color: '#8e8e93', marginTop: 2 },
  previewAmount: { fontSize: 14, fontWeight: '600' },
  positive: { color: '#2a9d5c' },
  negative: { color: '#1c1c1e' },
  moreRows: { fontSize: 13, color: '#8e8e93', textAlign: 'center', paddingVertical: 10 },
  dedupeNote: {
    fontSize: 13,
    color: '#8e8e93',
    textAlign: 'center',
    marginTop: 12,
    marginBottom: 4,
    fontStyle: 'italic',
  },
  doneContainer: { alignItems: 'center', paddingTop: 32 },
  doneIcon: { fontSize: 56, color: '#2a9d5c', marginBottom: 12 },
  doneTitle: { fontSize: 22, fontWeight: '700', color: '#1c1c1e', marginBottom: 24 },
  doneStats: {
    width: '100%',
    backgroundColor: '#fff',
    borderRadius: 12,
    overflow: 'hidden',
    marginBottom: 24,
  },
  statRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 13,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#d1d1d6',
  },
  statLabel: { fontSize: 15, color: '#3a3a3c' },
  statValue: { fontSize: 15, fontWeight: '600', color: '#1c1c1e' },
  statHighlight: { color: '#2a9d5c' },
  statMuted: { color: '#aeaeb2' },
});
