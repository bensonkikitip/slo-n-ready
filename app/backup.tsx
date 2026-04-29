import React, { useCallback, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  Alert, ScrollView, ActivityIndicator,
} from 'react-native';
import { Stack, useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Sharing from 'expo-sharing';
import * as DocumentPicker from 'expo-document-picker';
import {
  getBackupInfo, writeBackup, readBackupFromPath,
  restoreFromData, wipeAllData, BackupInfo, BACKUP_PATH,
} from '../src/db/backup';
import { Sloth } from '../src/components/Sloth';
import { RacheyBanner } from '../src/components/RacheyBanner';
import { colors, font, spacing, radius } from '../src/theme';

export default function BackupScreen() {
  const insets  = useSafeAreaInsets();
  const router  = useRouter();
  const [info,         setInfo]         = useState<BackupInfo | null>(null);
  const [loading,      setLoading]      = useState(true);
  const [working,      setWorking]      = useState(false);
  const [racheyMoment, setRacheyMoment] = useState<'firstBackup' | 'recurringBackup' | null>(null);

  useFocusEffect(useCallback(() => {
    getBackupInfo().then(i => { setInfo(i); setLoading(false); });
  }, []));

  async function handleExport() {
    const isFirst = !info?.exists;
    setWorking(true);
    try {
      // Refresh backup before sharing so it's always up-to-date
      await writeBackup();
      const refreshed = await getBackupInfo();
      setInfo(refreshed);

      const canShare = await Sharing.isAvailableAsync();
      if (!canShare) {
        Alert.alert('Not available', 'Sharing is not available on this device.');
        return;
      }
      await Sharing.shareAsync(BACKUP_PATH, {
        mimeType:    'application/json',
        dialogTitle: 'Export Slo N Ready Backup',
        UTI:         'public.json',
      });
      setRacheyMoment(isFirst ? 'firstBackup' : 'recurringBackup');
    } catch (e: any) {
      Alert.alert('Export failed', e.message ?? 'Unknown error');
    } finally {
      setWorking(false);
    }
  }

  async function handleImport() {
    try {
      const picked = await DocumentPicker.getDocumentAsync({
        type: ['application/json', 'public.json', '*/*'],
        copyToCacheDirectory: true,
      });
      if (picked.canceled) return;

      setWorking(true);
      const data = await readBackupFromPath(picked.assets[0].uri);
      if (!data) {
        Alert.alert('Invalid file', 'This file does not appear to be a Slo N Ready backup.');
        return;
      }

      const accountWord = data.accounts.length === 1 ? 'account' : 'accounts';
      const txnWord     = data.transactions.length === 1 ? 'transaction' : 'transactions';

      Alert.alert(
        'Ready to restore?',
        `I found a backup with ${data.accounts.length} ${accountWord} and ${data.transactions.length} ${txnWord}, saved ${new Date(data.exported_at).toLocaleString()}.\n\nThis will replace all current data.`,
        [
          { text: 'Not yet', style: 'cancel' },
          {
            text: 'Restore',
            style: 'destructive',
            onPress: async () => {
              try {
                await restoreFromData(data);
                await writeBackup();
                const refreshed = await getBackupInfo();
                setInfo(refreshed);
                Alert.alert("All done!", "I've restored your data successfully.");
              } catch (e: any) {
                Alert.alert('Restore failed', e.message ?? 'Unknown error');
              } finally {
                setWorking(false);
              }
            },
          },
        ],
      );
    } catch (e: any) {
      Alert.alert('Could not open file', e.message ?? 'Unknown error');
    } finally {
      setWorking(false);
    }
  }

  function handleWipe() {
    Alert.alert(
      'Erase all data?',
      'This permanently deletes every account, transaction, category, rule, and budget. There is no undo.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Yes, erase everything',
          style: 'destructive',
          onPress: () => {
            // Second confirmation — this is irreversible
            Alert.alert(
              'Are you absolutely sure?',
              'All your data will be gone. Export a backup first if you might want it later.',
              [
                { text: 'Cancel', style: 'cancel' },
                {
                  text: 'Erase',
                  style: 'destructive',
                  onPress: async () => {
                    setWorking(true);
                    try {
                      await wipeAllData();
                      router.replace('/');
                    } catch (e: any) {
                      Alert.alert('Wipe failed', e.message ?? 'Unknown error');
                      setWorking(false);
                    }
                  },
                },
              ],
            );
          },
        },
      ],
    );
  }

  return (
    <>
      <Stack.Screen options={{ title: 'Backup & Restore' }} />
      <ScrollView
        style={styles.container}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + spacing.xl }]}
      >
        <View style={styles.hero}>
          <Sloth sloth="piggyBank" size={110} />
        </View>

        {racheyMoment && (
          <RacheyBanner moment={racheyMoment} onDismiss={() => setRacheyMoment(null)} />
        )}

        {/* Status card */}
        <Text style={styles.sectionLabel}>BACKUP STATUS</Text>
        <View style={styles.card}>
          {loading ? (
            <ActivityIndicator color={colors.primary} style={{ padding: spacing.md }} />
          ) : info?.exists ? (
            <>
              <View style={styles.statusRow}>
                <Text style={styles.statusLabel}>Last saved</Text>
                <Text style={styles.statusValue}>
                  {info.exported_at
                    ? new Date(info.exported_at).toLocaleString()
                    : 'Unknown'}
                </Text>
              </View>
              <View style={[styles.statusRow, styles.statusRowBorder]}>
                <Text style={styles.statusLabel}>Contents</Text>
                <Text style={styles.statusValue}>
                  {info.account_count} {info.account_count === 1 ? 'account' : 'accounts'} · {info.transaction_count} {info.transaction_count === 1 ? 'transaction' : 'transactions'}
                </Text>
              </View>
            </>
          ) : (
            <View style={styles.statusRow}>
              <Text style={styles.statusLabel}>No backup yet</Text>
              <Text style={styles.statusNote}>
                I'll save one automatically after your next import or account change.
              </Text>
            </View>
          )}
        </View>

        {/* Export */}
        <Text style={styles.sectionLabel}>EXPORT</Text>
        <TouchableOpacity
          style={[styles.button, { backgroundColor: colors.primary }, working && styles.buttonDisabled]}
          onPress={handleExport}
          disabled={working}
          activeOpacity={0.85}
        >
          {working
            ? <ActivityIndicator color={colors.textOnColor} />
            : <Text style={styles.buttonText}>Export Backup…</Text>
          }
        </TouchableOpacity>
        <Text style={styles.hint}>
          I'll save a fresh snapshot and hand it to the share sheet — AirDrop it, save to Files, email it, whatever you like.
        </Text>

        {/* Import */}
        <Text style={[styles.sectionLabel, { marginTop: spacing.lg }]}>RESTORE</Text>
        <TouchableOpacity
          style={[styles.button, styles.buttonOutline, working && styles.buttonDisabled]}
          onPress={handleImport}
          disabled={working}
          activeOpacity={0.85}
        >
          <Text style={[styles.buttonText, { color: colors.primary }]}>Restore from File…</Text>
        </TouchableOpacity>
        <Text style={styles.hint}>
          Pick a backup file you exported earlier and I'll load it right up. This replaces all current data.
        </Text>

        {/* Info */}
        <View style={styles.infoBox}>
          <Text style={styles.infoText}>
            I back myself up automatically after every import or account change. iOS syncs the file to iCloud, so your data is safe when you restore or switch devices.
          </Text>
        </View>

        {/* Danger zone */}
        <Text style={[styles.sectionLabel, { marginTop: spacing.xl }]}>DANGER ZONE</Text>
        <TouchableOpacity
          style={[styles.wipeButton, working && styles.buttonDisabled]}
          onPress={handleWipe}
          disabled={working}
          activeOpacity={0.85}
        >
          <Text style={styles.wipeButtonText}>Erase All Data…</Text>
        </TouchableOpacity>
        <Text style={styles.hint}>
          Permanently deletes every account, transaction, category, and rule. Export a backup first if you might want your data later.
        </Text>
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content:   { padding: spacing.md, gap: spacing.sm },

  hero: { alignItems: 'center', paddingVertical: spacing.lg },

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
    borderWidth:     1,
    borderColor:     colors.border,
    overflow:        'hidden',
  },
  statusRow: {
    paddingHorizontal: spacing.md,
    paddingVertical:   14,
    gap:               4,
  },
  statusRowBorder: {
    borderTopWidth: 1,
    borderTopColor: colors.separator,
  },
  statusLabel: {
    fontFamily: font.semiBold,
    fontSize:   14,
    color:      colors.text,
  },
  statusValue: {
    fontFamily: font.regular,
    fontSize:   13,
    color:      colors.textSecondary,
    marginTop:  2,
  },
  statusNote: {
    fontFamily: font.regular,
    fontSize:   13,
    color:      colors.textTertiary,
    marginTop:  2,
  },

  button: {
    borderRadius:    radius.full,
    paddingVertical: 16,
    alignItems:      'center',
  },
  buttonOutline: {
    backgroundColor: 'transparent',
    borderWidth:     2,
    borderColor:     colors.primary,
  },
  buttonDisabled: { opacity: 0.5 },
  buttonText: {
    fontFamily: font.bold,
    fontSize:   17,
    color:      colors.textOnColor,
  },

  hint: {
    fontFamily: font.regular,
    fontSize:   13,
    color:      colors.textTertiary,
    marginLeft: spacing.xs,
    lineHeight: 18,
  },

  infoBox: {
    backgroundColor: colors.surfaceAlt,
    borderRadius:    radius.lg,
    padding:         spacing.md,
    marginTop:       spacing.lg,
  },
  infoText: {
    fontFamily: font.regular,
    fontSize:   13,
    color:      colors.textSecondary,
    lineHeight: 20,
  },

  wipeButton: {
    borderRadius:    radius.full,
    paddingVertical: 16,
    alignItems:      'center',
    backgroundColor: 'transparent',
    borderWidth:     2,
    borderColor:     colors.destructive,
  },
  wipeButtonText: {
    fontFamily: font.bold,
    fontSize:   17,
    color:      colors.destructive,
  },
});
