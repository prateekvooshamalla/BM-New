import React from 'react';
import { SafeAreaView, StatusBar, StyleSheet, Text, View } from 'react-native';
import { BRAND_CONFIG, DESIGN_TOKENS, MOBILE_BOTTOM_TABS } from '@bharat-makaan/config';

export default function App() {
  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" />
      <View style={styles.header}>
        <Text style={styles.brand}>{BRAND_CONFIG.name}</Text>
        <Text style={styles.subtitle}>{BRAND_CONFIG.positioning}</Text>
      </View>
      <View style={styles.tabPreview}>
        {MOBILE_BOTTOM_TABS.map((tab) => (
          <Text key={tab.id} style={styles.tabLabel}>
            {tab.label}
          </Text>
        ))}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: DESIGN_TOKENS.colors.light.background,
    justifyContent: 'space-between',
  },
  header: {
    padding: 24,
  },
  brand: {
    fontSize: 22,
    fontWeight: '700',
    color: DESIGN_TOKENS.colors.light.primary,
  },
  subtitle: {
    marginTop: 6,
    fontSize: 13,
    color: DESIGN_TOKENS.colors.light.mutedForeground,
  },
  tabPreview: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    borderTopWidth: 1,
    borderTopColor: DESIGN_TOKENS.colors.light.border,
    backgroundColor: DESIGN_TOKENS.colors.light.surface,
    paddingVertical: 14,
  },
  tabLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: DESIGN_TOKENS.colors.light.foreground,
  },
});
