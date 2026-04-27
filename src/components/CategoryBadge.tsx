import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { radius, font } from '../theme';

interface Props {
  name:  string;
  color: string;
}

export function CategoryBadge({ name, color }: Props) {
  return (
    <View style={[styles.pill, { backgroundColor: color + '33' }]}>
      <Text style={[styles.text, { color }]}>{name}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    borderRadius:     radius.full,
    paddingHorizontal: 7,
    paddingVertical:   1,
  },
  text: {
    fontFamily: font.semiBold,
    fontSize:   11,
  },
});
