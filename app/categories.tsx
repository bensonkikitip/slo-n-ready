import React, { useCallback, useRef, useState } from 'react';
import {
  View, Text, FlatList, TouchableOpacity,
  StyleSheet, ActivityIndicator,
} from 'react-native';
import { useRouter, useFocusEffect, Stack } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Category, getAllCategories } from '../src/db/queries';
import { Sloth } from '../src/components/Sloth';
import { RacheyBanner } from '../src/components/RacheyBanner';
import { colors, font, spacing, radius } from '../src/theme';

export default function CategoriesScreen() {
  const router  = useRouter();
  const insets  = useSafeAreaInsets();
  const [categories,   setCategories]   = useState<Category[]>([]);
  const [loading,      setLoading]      = useState(true);
  const [racheyMoment, setRacheyMoment] = useState<'firstCategory' | null>(null);
  const prevCount = useRef(-1);

  useFocusEffect(useCallback(() => {
    let active = true;
    (async () => {
      const cats = await getAllCategories();
      if (!active) return;
      const isFirst = prevCount.current === 0 && cats.length === 1;
      prevCount.current = cats.length;
      setCategories(cats);
      setLoading(false);
      if (isFirst) setRacheyMoment('firstCategory');
    })();
    return () => { active = false; };
  }, []));

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  return (
    <>
      <Stack.Screen
        options={{
          title: 'Categories',
          headerRight: () => (
            <TouchableOpacity onPress={() => router.push('/category/new')} hitSlop={12}>
              <Text style={styles.newBtn}>New</Text>
            </TouchableOpacity>
          ),
        }}
      />
      <View style={[styles.container, { paddingBottom: insets.bottom }]}>
        {racheyMoment && (
          <RacheyBanner moment={racheyMoment} onDismiss={() => setRacheyMoment(null)} />
        )}
        <FlatList
          data={categories}
          keyExtractor={c => c.id}
          contentContainerStyle={categories.length === 0 && styles.listEmpty}
          renderItem={({ item, index }) => (
            <TouchableOpacity
              style={[styles.row, index > 0 && styles.rowBorder]}
              onPress={() => router.push(`/category/${item.id}/edit`)}
              activeOpacity={0.7}
            >
              <View style={[styles.swatch, { backgroundColor: item.color }]} />
              <Text style={styles.rowName}>{item.name}</Text>
              <Text style={styles.chevron}>›</Text>
            </TouchableOpacity>
          )}
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Sloth sloth="writing" size={120} />
              <Text style={styles.emptyTitle}>No categories yet</Text>
              <Text style={styles.emptyBody}>
                Knowing where it goes is half the battle. Tap "New" to create your first category.
              </Text>
            </View>
          }
        />
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  container:  { flex: 1, backgroundColor: colors.background },
  center:     { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.background },
  newBtn:     { fontFamily: font.semiBold, fontSize: 15, color: colors.primary },
  listEmpty:  { flex: 1 },

  row: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: spacing.md, paddingVertical: 14,
    backgroundColor: colors.surface,
  },
  rowBorder: { borderTopWidth: 1, borderTopColor: colors.separator },
  swatch:    { width: 14, height: 14, borderRadius: radius.full, marginRight: spacing.md },
  rowName:   { fontFamily: font.semiBold, fontSize: 16, color: colors.text, flex: 1 },
  chevron:   { fontSize: 22, color: colors.textTertiary },

  emptyState: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: spacing.xl, gap: spacing.md,
  },
  emptyTitle: { fontFamily: font.bold, fontSize: 20, color: colors.text },
  emptyBody:  {
    fontFamily: font.regular, fontSize: 15, color: colors.textSecondary,
    textAlign: 'center', lineHeight: 22,
  },

});
