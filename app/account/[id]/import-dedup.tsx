/**
 * import-dedup.tsx — Cross-import duplicate review screen
 *
 * After importing a statement, if rows in the new batch closely match rows from
 * a previous import (same amount_cents, dates within 1 day, different batch),
 * this screen lists them side-by-side so the user can decide which to keep.
 *
 * Actions per pair:
 *   Keep New      → softDrop the existing row (preserve the just-imported one)
 *   Keep Existing → softDrop the new row      (discard the just-imported one)
 *   Keep Both     → dismiss from list, no DB write
 *
 * Both "keep" options use soft-drop (dropped_at) because both rows are imported
 * — audit trail is preserved, consistent with the existing dropped_at convention.
 *
 * Route params:
 *   id       account id
 *   batchId  the newly imported batch id whose rows we're checking
 */
import React, { useCallback, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity,
  StyleSheet, ActivityIndicator,
} from 'react-native';
import { useLocalSearchParams, useRouter, useFocusEffect, Stack } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  CrossImportDupePair,
  findCrossImportDuplicates,
  softDropTransaction,
} from '../../../src/db/queries/transactions';
import { writeBackupSafe } from '../../../src/db/backup';
import { centsToDollars } from '../../../src/domain/money';
import { Sloth } from '../../../src/components/Sloth';
import { colors, font, spacing, radius } from '../../../src/theme';

export default function ImportDedupScreen() {
  const { id, batchId } = useLocalSearchParams<{ id: string; batchId: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [pairs,   setPairs]   = useState<CrossImportDupePair[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy,    setBusy]    = useState<string | null>(null); // newTx.id being actioned

  useFocusEffect(useCallback(() => {
    let active = true;
    (async () => {
      if (!id || !batchId) { setLoading(false); return; }
      const candidates = await findCrossImportDuplicates(id, batchId);
      if (!active) return;
      setPairs(candidates);
      setLoading(false);
    })();
    return () => { active = false; };
  }, [id, batchId]));

  function dismissPair(newTxId: string) {
    setPairs(prev => prev.filter(p => p.newTx.id !== newTxId));
  }

  async function handleKeepNew(pair: CrossImportDupePair) {
    setBusy(pair.newTx.id);
    try {
      await softDropTransaction(pair.existingTx.id);
      writeBackupSafe();
      dismissPair(pair.newTx.id);
    } finally {
      setBusy(null);
    }
  }

  async function handleKeepExisting(pair: CrossImportDupePair) {
    setBusy(pair.newTx.id);
    try {
      await softDropTransaction(pair.newTx.id);
      writeBackupSafe();
      dismissPair(pair.newTx.id);
    } finally {
      setBusy(null);
    }
  }

  function handleKeepBoth(pair: CrossImportDupePair) {
    dismissPair(pair.newTx.id);
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <Stack.Screen options={{ title: 'Review Duplicates' }} />
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  return (
    <>
      <Stack.Screen options={{ title: 'Review Duplicates' }} />

      {pairs.length === 0 ? (
        <View style={styles.center}>
          <Sloth sloth="thumbsUp" size={120} />
          <Text style={styles.doneTitle}>All clear!</Text>
          <Text style={styles.doneBody}>No more potential duplicate imports.</Text>
          <TouchableOpacity
            style={styles.doneBtn}
            onPress={() => router.back()}
            activeOpacity={0.85}
          >
            <Text style={styles.doneBtnText}>Done</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + spacing.xl }]}
        >
          <Text style={styles.intro}>
            These newly imported rows look like they may already exist from a previous import — same amount, close date. Pick which one to keep.
          </Text>

          {pairs.map(pair => {
            const isBusy  = busy === pair.newTx.id;
            const amount  = centsToDollars(Math.abs(pair.newTx.amount_cents));
            const sign    = pair.newTx.amount_cents < 0 ? '–' : '+';

            return (
              <View key={pair.newTx.id} style={styles.card}>
                {/* Amount header */}
                <Text style={styles.cardAmount}>{sign}{amount}</Text>

                {/* Side-by-side rows */}
                <View style={styles.rowsContainer}>
                  {/* New (just imported) */}
                  <View style={[styles.txRow, styles.newRow]}>
                    <View style={styles.txRowHeader}>
                      <Text style={styles.txRowTag}>New import</Text>
                      <Text style={styles.txRowDate}>{pair.newTx.date}</Text>
                    </View>
                    <Text style={styles.txRowDesc} numberOfLines={2}>
                      {pair.newTx.description}
                    </Text>
                  </View>

                  {/* VS divider */}
                  <View style={styles.vsDivider}>
                    <Text style={styles.vsText}>vs</Text>
                  </View>

                  {/* Existing (prior import) */}
                  <View style={[styles.txRow, styles.existingRow]}>
                    <View style={styles.txRowHeader}>
                      <Text style={styles.txRowTag}>Prior import</Text>
                      <Text style={styles.txRowDate}>{pair.existingTx.date}</Text>
                    </View>
                    <Text style={styles.txRowDesc} numberOfLines={2}>
                      {pair.existingTx.description}
                    </Text>
                  </View>
                </View>

                {/* Actions */}
                <View style={styles.actions}>
                  <View style={styles.keepRow}>
                    <TouchableOpacity
                      style={[styles.keepNewBtn, isBusy && styles.btnDisabled]}
                      onPress={() => handleKeepNew(pair)}
                      activeOpacity={0.85}
                      disabled={isBusy}
                    >
                      {isBusy
                        ? <ActivityIndicator color={colors.textOnColor} size="small" />
                        : <Text style={styles.keepNewBtnText}>Keep New</Text>
                      }
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.keepExistingBtn, isBusy && styles.btnDisabled]}
                      onPress={() => handleKeepExisting(pair)}
                      activeOpacity={0.85}
                      disabled={isBusy}
                    >
                      {isBusy
                        ? <ActivityIndicator color={colors.textOnColor} size="small" />
                        : <Text style={styles.keepExistingBtnText}>Keep Existing</Text>
                      }
                    </TouchableOpacity>
                  </View>
                  <TouchableOpacity
                    style={[styles.keepBothBtn, isBusy && styles.btnDisabled]}
                    onPress={() => handleKeepBoth(pair)}
                    activeOpacity={0.8}
                    disabled={isBusy}
                  >
                    <Text style={styles.keepBothBtnText}>Keep both</Text>
                  </TouchableOpacity>
                </View>
              </View>
            );
          })}
        </ScrollView>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1, justifyContent: 'center', alignItems: 'center',
    gap: spacing.md, paddingHorizontal: spacing.xl,
    backgroundColor: colors.background,
  },
  doneTitle: { fontFamily: font.bold, fontSize: 22, color: colors.text },
  doneBody:  { fontFamily: font.regular, fontSize: 15, color: colors.textSecondary, textAlign: 'center' },
  doneBtn: {
    marginTop: spacing.md, backgroundColor: colors.primary,
    paddingVertical: 14, paddingHorizontal: spacing.xl,
    borderRadius: radius.full,
  },
  doneBtnText: { fontFamily: font.bold, fontSize: 16, color: colors.textOnColor },

  list: { padding: spacing.md, gap: spacing.md, backgroundColor: colors.background },

  intro: {
    fontFamily: font.regular, fontSize: 14,
    color: colors.textSecondary, lineHeight: 20,
    marginBottom: spacing.xs,
  },

  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1, borderColor: colors.border,
    overflow: 'hidden',
  },
  cardAmount: {
    fontFamily: font.bold, fontSize: 18, color: colors.text,
    paddingHorizontal: spacing.md, paddingTop: spacing.md, paddingBottom: spacing.sm,
  },

  rowsContainer: {
    flexDirection: 'row',
    borderTopWidth: 1, borderTopColor: colors.separator,
  },
  txRow: { flex: 1, padding: spacing.sm },
  newRow:      { backgroundColor: colors.primaryLight },
  existingRow: { backgroundColor: colors.surface },
  txRowHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  txRowTag:  { fontFamily: font.semiBold, fontSize: 11, color: colors.textTertiary, textTransform: 'uppercase', letterSpacing: 0.3 },
  txRowDate: { fontFamily: font.regular,  fontSize: 11, color: colors.textTertiary },
  txRowDesc: { fontFamily: font.regular,  fontSize: 13, color: colors.text, lineHeight: 18 },

  vsDivider: {
    width: 28, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.separator,
  },
  vsText: { fontFamily: font.bold, fontSize: 11, color: colors.textTertiary },

  actions: {
    padding: spacing.sm,
    borderTopWidth: 1, borderTopColor: colors.separator,
    gap: spacing.xs,
  },
  keepRow: { flexDirection: 'row', gap: spacing.xs },

  keepNewBtn: {
    flex: 1, backgroundColor: colors.primary,
    borderRadius: radius.md, paddingVertical: 10,
    alignItems: 'center',
  },
  keepNewBtnText: { fontFamily: font.semiBold, fontSize: 14, color: colors.textOnColor },

  keepExistingBtn: {
    flex: 1, backgroundColor: colors.surface,
    borderRadius: radius.md, paddingVertical: 10,
    alignItems: 'center', borderWidth: 1, borderColor: colors.border,
  },
  keepExistingBtnText: { fontFamily: font.semiBold, fontSize: 14, color: colors.text },

  keepBothBtn: {
    borderRadius: radius.md, paddingVertical: 8,
    alignItems: 'center',
  },
  keepBothBtnText: { fontFamily: font.semiBold, fontSize: 13, color: colors.textTertiary },

  btnDisabled: { opacity: 0.45 },
});
