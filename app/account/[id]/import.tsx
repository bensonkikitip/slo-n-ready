import React, { useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  Alert, ScrollView, ActivityIndicator, Linking,
} from 'react-native';
import { useRouter, useLocalSearchParams, Stack, Link } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import * as Crypto from 'expo-crypto';
import {
  getAllAccounts, Account, importTransactions,
  insertImportBatch, updateImportBatchCounts, ImportResult, parseColumnConfig,
  updateAccount, getDistinctMonths,
} from '../../../src/db/queries';
import { writeBackupSafe } from '../../../src/db/backup';
import { autoApplyRulesForAccount, ApplyResult } from '../../../src/domain/rules-engine';
import {
  parseCsv, ParsedRow,
  parseBoaPdf, parseCitiPdf, parseAxosPdf, parseChasePdf, parseBoaCcPdf, parseGenericPdf,
  ParsedPdf, SkippedCandidate,
} from '../../../src/parsers';
import { detectColumnConfig } from '../../../src/parsers/column-detector';
import { assignTransactionIds } from '../../../src/domain/transaction-id';
import { centsToDollars } from '../../../src/domain/money';
import { Sloth } from '../../../src/components/Sloth';
import { RacheyBanner } from '../../../src/components/RacheyBanner';
import { CsvBrowserTip } from '../../../src/components/CsvBrowserTip';
import { colors, font, spacing, radius, accountColor } from '../../../src/theme';

// ─── PDF extractor (native module — only available in development builds) ─────

let extractPdfItems: ((uri: string) => Promise<import('../../../src/parsers/pdf-parsers/pdf-types').PdfTextItem[]>) | null = null;
try {
  // Requires expo prebuild + pod install. Not available in Expo Go.
  extractPdfItems = require('../../../modules/pdf-extractor').extractTextItems;
} catch {
  // Silently unavailable in Expo Go or when module not yet linked
}

// ─── Types ────────────────────────────────────────────────────────────────────

type Phase = 'pick' | 'preview' | 'done';

interface PreviewData {
  filename: string;
  rows: ParsedRow[];
  ids: string[];
  parsedPdf?: ParsedPdf; // present for PDF imports
}

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function ImportScreen() {
  const { id: accountId, fromOnboarding } = useLocalSearchParams<{ id: string; fromOnboarding?: string }>();
  const router  = useRouter();
  const insets  = useSafeAreaInsets();
  const [phase,        setPhase]        = useState<Phase>('pick');
  const [preview,      setPreview]      = useState<PreviewData | null>(null);
  const [result,       setResult]       = useState<ImportResult | null>(null);
  const [applyResult,  setApplyResult]  = useState<ApplyResult | null>(null);
  const [loading,      setLoading]      = useState(false);
  const [account,      setAccount]      = useState<Account | null>(null);
  const [racheyMoment, setRacheyMoment] = useState<'firstImport' | 'recurringImport' | null>(null);
  const [cachedUri,    setCachedUri]    = useState<string | null>(null);
  const [isFromPdf,    setIsFromPdf]    = useState(false);

  React.useEffect(() => {
    getAllAccounts().then(accts => setAccount(accts.find(a => a.id === accountId) ?? null));
  }, [accountId]);

  const accent = account ? accountColor[account.type] : colors.primary;

  // ── CSV flow ────────────────────────────────────────────────────────────────

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
      setCachedUri(asset.uri);
      setIsFromPdf(false);
      if (!account) throw new Error('Account not found');

      // For accounts whose bank isn't in the supported list, auto-detect the
      // column layout from the CSV headers and persist it so future imports
      // don't need to re-detect.
      let columnConfig = parseColumnConfig(account);
      if (account.csv_format === 'custom') {
        const detected = detectColumnConfig(text);
        if (detected.warnings.length > 0) {
          Alert.alert(
            'Heads up',
            detected.warnings.join('\n\n') + '\n\nI\'ll use the detected layout. Go to Edit Account to adjust if needed.',
          );
        }
        columnConfig = detected.config;
        // Persist so subsequent imports use the learned layout automatically.
        await updateAccount(accountId, { column_config: JSON.stringify(detected.config) });
        // Keep the local account state in sync for the rest of this session.
        setAccount(prev => prev ? { ...prev, column_config: JSON.stringify(detected.config) } : prev);
      }

      const rows = parseCsv(columnConfig, text);
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

  // ── PDF flow ─────────────────────────────────────────────────────────────────

  async function handlePickPdf() {
    if (!extractPdfItems) {
      Alert.alert(
        'PDF import requires a development build',
        'PDF statement import is not available in Expo Go. Build the app with "eas build" or "expo run:ios" to unlock this feature.',
      );
      return;
    }

    try {
      const picked = await DocumentPicker.getDocumentAsync({
        type: ['application/pdf', 'com.adobe.pdf'],
        copyToCacheDirectory: true,
      });
      if (picked.canceled) return;
      const asset = picked.assets[0];
      setLoading(true);

      if (!account) throw new Error('Account not found');

      // Extract word-level items via native PDFKit module
      const items = await extractPdfItems(asset.uri);
      if (items.length === 0) {
        throw new Error('No readable text found in this PDF. Is it a scanned image?');
      }

      // Route to the correct bank parser based on account format
      const fmt = account.csv_format;
      let parsedPdf: ParsedPdf;
      if (fmt === 'boa_checking_v1' || fmt === 'boa_savings_v1') {
        parsedPdf = parseBoaPdf(items);
      } else if (fmt === 'citi_cc_v1') {
        parsedPdf = parseCitiPdf(items);
      } else if (fmt === 'boa_cc_v1') {
        parsedPdf = parseBoaCcPdf(items);
      } else if (fmt === 'axos_checking_v1' || fmt === 'axos_savings_v1') {
        parsedPdf = parseAxosPdf(items);
      } else if (fmt === 'chase_cc_v1') {
        parsedPdf = parseChasePdf(items);
      } else {
        parsedPdf = parseGenericPdf(items);
      }

      if (parsedPdf.rows.length === 0) {
        throw new Error('No transactions could be parsed from this PDF. The file may be in an unsupported format.');
      }

      setCachedUri(asset.uri);
      setIsFromPdf(true);

      const ids = assignTransactionIds(
        parsedPdf.rows.map(r => ({
          accountId,
          dateIso: r.dateIso,
          amountCents: r.amountCents,
          description: r.description,
        })),
      );
      setPreview({ filename: asset.name ?? 'statement.pdf', rows: parsedPdf.rows, ids, parsedPdf });
      setPhase('preview');
    } catch (e: any) {
      Alert.alert('Could not read PDF', e.message ?? 'Unknown error');
    } finally {
      setLoading(false);
    }
  }

  // ── Confirm import (shared by CSV and PDF) ───────────────────────────────────

  async function handleConfirmImport() {
    if (!preview) return;
    setLoading(true);
    try {
      const priorMonths = await getDistinctMonths(accountId);
      const isFirstImport = priorMonths.length === 0;
      const batchId     = Crypto.randomUUID();
      const importedAt  = Date.now();

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

      await updateImportBatchCounts(batchId, {
        rows_inserted:          importResult.inserted,
        rows_skipped_duplicate: importResult.skipped,
        rows_cleared:           importResult.cleared,
        rows_dropped:           importResult.dropped,
      });

      const applied = await autoApplyRulesForAccount(accountId);
      writeBackupSafe();

      // Delete the cached copy — CSV or PDF — the app never needs it again
      if (cachedUri) {
        try { await FileSystem.deleteAsync(cachedUri, { idempotent: true }); } catch {}
      }

      setResult(importResult);
      setApplyResult(applied);
      setRacheyMoment(isFirstImport ? 'firstImport' : 'recurringImport');
      setPhase('done');
    } catch (e: any) {
      Alert.alert('Import failed', e.message ?? 'Unknown error');
    } finally {
      setLoading(false);
    }
  }

  // ── Render ───────────────────────────────────────────────────────────────────

  const pdf = preview?.parsedPdf;
  const diffCents = pdf?.summary?.diffCents ?? 0;
  const hasSkipped = (pdf?.skippedCandidates?.length ?? 0) > 0;
  const hasDiff = diffCents > 0 || hasSkipped;

  return (
    <>
      <Stack.Screen options={{ title: isFromPdf ? 'Import PDF Statement' : 'Import CSV' }} />
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
              Hand me a CSV or PDF statement from your bank and I'll show you a preview before saving anything.
            </Text>
            <CsvBrowserTip />
            <Link href="/csv-guide" style={styles.csvGuideLink}>
              How do I export a CSV from my bank? →
            </Link>

            {loading
              ? <ActivityIndicator color={accent} style={{ marginTop: spacing.lg }} />
              : (
                <View style={styles.pickButtons}>
                  <TouchableOpacity
                    style={[styles.primaryButton, { backgroundColor: accent }]}
                    onPress={handlePickFile}
                    activeOpacity={0.85}
                  >
                    <Text style={styles.primaryButtonText}>Choose CSV File…</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.secondaryButton, { borderColor: accent }]}
                    onPress={handlePickPdf}
                    activeOpacity={0.85}
                  >
                    <Text style={[styles.secondaryButtonText, { color: accent }]}>
                      Choose PDF Statement…
                    </Text>
                  </TouchableOpacity>
                  {fromOnboarding === '1' && (
                    <TouchableOpacity
                      style={styles.ghostButton}
                      onPress={() => router.replace(`/account/${accountId}?showFoundationalOnboarding=1`)}
                      activeOpacity={0.7}
                    >
                      <Text style={[styles.ghostButtonText, { color: accent }]}>
                        Skip & set up rules →
                      </Text>
                    </TouchableOpacity>
                  )}
                </View>
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
              {/* ✅ Perfect-match badge (PDF with zero diff) */}
              {pdf?.summary && diffCents === 0 && !hasSkipped && (
                <View style={styles.matchBadge}>
                  <Text style={styles.matchBadgeText}>✓ All transactions matched</Text>
                </View>
              )}
            </View>

            {/* ⚠️ Diff warning card (PDF with non-zero diff or skipped candidates) */}
            {isFromPdf && hasDiff && (
              <View style={styles.diffCard}>
                <Text style={styles.diffCardTitle}>
                  ⚠️ We couldn't parse everything
                </Text>
                {pdf?.summary && diffCents > 0 && (
                  <Text style={styles.diffCardBody}>
                    Your statement total and the transactions we parsed differ by{' '}
                    <Text style={styles.diffCardAmount}>{centsToDollars(diffCents)}</Text>.
                    You can add missing transactions manually before importing.
                  </Text>
                )}
                {pdf?.skippedCandidates && pdf.skippedCandidates.length > 0 && (
                  <View style={styles.skippedList}>
                    {pdf.skippedCandidates.map((c, i) => (
                      <SkippedRow
                        key={i}
                        candidate={c}
                        accountId={accountId}
                        accent={accent}
                      />
                    ))}
                  </View>
                )}
              </View>
            )}

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

            {racheyMoment && (
              <RacheyBanner moment={racheyMoment} onDismiss={() => setRacheyMoment(null)} />
            )}

            {applyResult && applyResult.total > 0 && (
              <View style={styles.categorizedCard}>
                <Text style={styles.categorizedEmoji}>🎉</Text>
                <Text style={styles.categorizedTitle}>
                  {applyResult.total} of {result.inserted + result.cleared} transaction{(result.inserted + result.cleared) !== 1 ? 's' : ''} categorized for you!
                </Text>
                <Text style={styles.categorizedBody}>
                  I sorted what I recognized. The rest are waiting — tap any to assign a category, or just leave them. No rush.
                </Text>
              </View>
            )}

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

            {/* Nudge to delete original file from Files app */}
            <View style={styles.nudgeCard}>
              <Text style={styles.nudgeText}>
                {isFromPdf
                  ? "Your statement PDF has been removed from the app — we recommend deleting the original from your Files app too."
                  : "I've deleted my copy of the file. You may want to delete the original from your Downloads folder too — I never need it again."
                }
              </Text>
              <TouchableOpacity
                style={styles.nudgeButton}
                onPress={() => Linking.openURL('shareddocuments://')}
                activeOpacity={0.8}
              >
                <Text style={styles.nudgeButtonText}>Open Files App</Text>
              </TouchableOpacity>
            </View>

            <TouchableOpacity
              style={[styles.primaryButton, { backgroundColor: accent }]}
              onPress={() => fromOnboarding === '1'
                ? router.replace(`/account/${accountId}?showFoundationalOnboarding=1`)
                : router.back()
              }
              activeOpacity={0.85}
            >
              <Text style={styles.primaryButtonText}>
                {fromOnboarding === '1' ? 'Set up rules →' : 'Back to Account'}
              </Text>
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>
    </>
  );
}

// ─── Skipped candidate row (diff reconciliation) ──────────────────────────────

function SkippedRow({
  candidate,
  accountId,
  accent,
}: { candidate: SkippedCandidate; accountId: string; accent: string }) {
  const router = useRouter();

  function handleAddManually() {
    const params = new URLSearchParams();
    if (candidate.possibleDateIso)    params.set('prefillDate', candidate.possibleDateIso);
    if (candidate.possibleAmountCents !== undefined)
      params.set('prefillAmount', String(candidate.possibleAmountCents));
    if (candidate.rawText)            params.set('prefillDescription', candidate.rawText.slice(0, 80));
    router.push(`/account/${accountId}/add?${params.toString()}`);
  }

  return (
    <View style={styles.skippedRow}>
      <View style={styles.skippedLeft}>
        <Text style={styles.skippedText} numberOfLines={2}>
          {candidate.rawText.slice(0, 60)}{candidate.rawText.length > 60 ? '…' : ''}
        </Text>
        {candidate.possibleAmountCents !== undefined && (
          <Text style={styles.skippedAmount}>
            {centsToDollars(candidate.possibleAmountCents)}
          </Text>
        )}
      </View>
      <TouchableOpacity onPress={handleAddManually} style={styles.addManuallyBtn}>
        <Text style={[styles.addManuallyText, { color: accent }]}>Add manually →</Text>
      </TouchableOpacity>
    </View>
  );
}

// ─── Stat row ─────────────────────────────────────────────────────────────────

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

// ─── Styles ───────────────────────────────────────────────────────────────────

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
  csvGuideLink: {
    fontFamily: font.semiBold, fontSize: 13, color: colors.primary,
  },
  pickButtons: { width: '100%', gap: spacing.sm },

  // Preview
  previewContainer: { gap: spacing.md },
  previewHeader: {
    backgroundColor: colors.surface, borderRadius: radius.lg,
    padding: spacing.md, borderWidth: 1, borderColor: colors.border,
    gap: 4,
  },
  previewFilename: { fontFamily: font.bold, fontSize: 16, color: colors.text },
  previewCount:    { fontFamily: font.regular, fontSize: 13, color: colors.textTertiary },
  matchBadge: {
    alignSelf: 'flex-start',
    backgroundColor: colors.primaryLight,
    borderRadius: radius.full,
    paddingVertical: 3, paddingHorizontal: 10,
    marginTop: 4,
  },
  matchBadgeText: { fontFamily: font.semiBold, fontSize: 12, color: colors.primary },

  // Diff card
  diffCard: {
    backgroundColor: '#FFF8EC',
    borderRadius: radius.lg,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: '#F5C84A',
    gap: spacing.sm,
  },
  diffCardTitle: { fontFamily: font.semiBold, fontSize: 15, color: '#7A5C00' },
  diffCardBody:  { fontFamily: font.regular, fontSize: 14, color: '#7A5C00', lineHeight: 20 },
  diffCardAmount: { fontFamily: font.bold },
  skippedList:   { gap: 8 },
  skippedRow:    { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  skippedLeft:   { flex: 1 },
  skippedText:   { fontFamily: font.regular, fontSize: 13, color: colors.text },
  skippedAmount: { fontFamily: font.semiBold, fontSize: 13, color: colors.textSecondary, marginTop: 2 },
  addManuallyBtn: { paddingVertical: 6, paddingHorizontal: 10 },
  addManuallyText: { fontFamily: font.semiBold, fontSize: 13 },

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

  categorizedCard: {
    width: '100%', backgroundColor: colors.primaryLight,
    borderRadius: radius.lg, padding: spacing.md,
    borderWidth: 1, borderColor: colors.primary,
    alignItems: 'center', gap: 6,
  },
  categorizedEmoji: { fontSize: 28 },
  categorizedTitle: {
    fontFamily: font.bold, fontSize: 17, color: colors.primary,
    textAlign: 'center',
  },
  categorizedBody: {
    fontFamily: font.regular, fontSize: 14, color: colors.textSecondary,
    textAlign: 'center', lineHeight: 20,
  },

  nudgeCard: {
    width: '100%', backgroundColor: colors.surfaceAlt,
    borderRadius: radius.lg, padding: spacing.md,
    borderWidth: 1, borderColor: colors.border,
    gap: spacing.sm,
  },
  nudgeText: {
    fontFamily: font.regular, fontSize: 13, color: colors.textSecondary,
    lineHeight: 18,
  },
  nudgeButton: {
    alignSelf: 'flex-start',
    paddingVertical: 7, paddingHorizontal: spacing.md,
    borderRadius: radius.full,
    backgroundColor: colors.surface,
    borderWidth: 1, borderColor: colors.border,
  },
  nudgeButtonText: { fontFamily: font.semiBold, fontSize: 13, color: colors.textSecondary },
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
  secondaryButton: {
    width: '100%', borderRadius: radius.full,
    paddingVertical: 15, alignItems: 'center',
    borderWidth: 1.5,
  },
  secondaryButtonText: { fontFamily: font.semiBold, fontSize: 16 },
  ghostButton:       { paddingVertical: 14, alignItems: 'center' },
  ghostButtonText:   { fontFamily: font.semiBold, fontSize: 16 },
});
