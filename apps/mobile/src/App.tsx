import React from "react";
import { Platform, SafeAreaView, ScrollView, StatusBar, StyleSheet, Text, View } from "react-native";
import { calendarEventColors, iosLiquidGlassTokens, touchxColors } from "@touchx/ui-tokens";

const isIOS = Platform.OS === "ios";

const cards = [
  { title: "今日", subtitle: "课程 + Todo + 订阅事件", color: calendarEventColors.course },
  { title: "周视图", subtitle: "原生滚动网格、手势与冲突标识", color: calendarEventColors.activity },
  { title: "提醒", subtitle: "本地通知、ClawDBot、飞书策略", color: calendarEventColors.deadline },
];

export default function App() {
  return (
    <SafeAreaView style={styles.root}>
      <StatusBar barStyle="light-content" />
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.kicker}>TouchX Native</Text>
        <Text style={styles.title}>React Native App</Text>
        <Text style={styles.subtitle}>
          iOS 优先适配 Liquid Glass 质感；Android 先使用原生组件与 Material 交互语义。
        </Text>
        <View style={styles.stack}>
          {cards.map((card) => (
            <View key={card.title} style={[styles.card, isIOS ? styles.iosGlass : styles.androidCard]}>
              <View style={[styles.dot, { backgroundColor: card.color }]} />
              <View style={styles.cardCopy}>
                <Text style={styles.cardTitle}>{card.title}</Text>
                <Text style={styles.cardSubtitle}>{card.subtitle}</Text>
              </View>
            </View>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const colors = touchxColors.dark;

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    padding: 24,
    paddingBottom: 48,
  },
  kicker: {
    color: colors.mutedForeground,
    fontSize: 13,
    letterSpacing: 2.4,
    textTransform: "uppercase",
  },
  title: {
    marginTop: 8,
    color: colors.foreground,
    fontSize: 38,
    fontWeight: "700",
    letterSpacing: -1.2,
  },
  subtitle: {
    marginTop: 12,
    color: colors.mutedForeground,
    fontSize: 16,
    lineHeight: 24,
  },
  stack: {
    marginTop: 28,
    gap: 14,
  },
  card: {
    minHeight: 112,
    borderRadius: 28,
    padding: 20,
    flexDirection: "row",
    gap: 14,
    alignItems: "center",
  },
  iosGlass: {
    backgroundColor: iosLiquidGlassTokens.materialBackgroundDark,
    borderWidth: 1,
    borderColor: iosLiquidGlassTokens.materialStrokeDark,
    shadowColor: "#000",
    shadowOpacity: 0.22,
    shadowRadius: 28,
    shadowOffset: { width: 0, height: 18 },
  },
  androidCard: {
    backgroundColor: colors.card,
    elevation: 3,
  },
  dot: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  cardCopy: {
    flex: 1,
  },
  cardTitle: {
    color: colors.cardForeground,
    fontSize: 20,
    fontWeight: "700",
  },
  cardSubtitle: {
    marginTop: 6,
    color: colors.mutedForeground,
    fontSize: 14,
    lineHeight: 20,
  },
});
