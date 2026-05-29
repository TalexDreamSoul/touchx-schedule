import React from "react";
import {
  ColorValue,
  NativeSyntheticEvent,
  Platform,
  processColor,
  requireNativeComponent,
  StyleProp,
  UIManager,
  ViewStyle,
} from "react-native";

type TabPressPayload = {
  index: number;
};

type NativeLiquidTabBarProps = {
  style?: StyleProp<ViewStyle>;
  selectedIndex: number;
  labels: string[];
  accentColor?: ReturnType<typeof processColor> | null;
  textColor?: ReturnType<typeof processColor> | null;
  mutedColor?: ReturnType<typeof processColor> | null;
  surfaceColor?: ReturnType<typeof processColor> | null;
  onTabPress?: (event: NativeSyntheticEvent<TabPressPayload>) => void;
};

const COMPONENT_NAME = "TouchXLiquidTabBar";
const isNativeAvailable = Platform.OS === "android" && Boolean(UIManager.getViewManagerConfig?.(COMPONENT_NAME));

const NativeTouchXLiquidTabBar = isNativeAvailable
  ? requireNativeComponent<NativeLiquidTabBarProps>(COMPONENT_NAME)
  : undefined;

export function isNativeLiquidTabBarAvailable() {
  return isNativeAvailable;
}

export function NativeLiquidTabBar({
  selectedIndex,
  labels,
  onTabPress,
  style,
  accentColor = "#2f55c8",
  textColor = "#111111",
  mutedColor = "#6b6b70",
  surfaceColor = "rgba(255,255,255,0.90)",
}: {
  selectedIndex: number;
  labels: string[];
  onTabPress: (index: number) => void;
  style?: StyleProp<ViewStyle>;
  accentColor?: ColorValue;
  textColor?: ColorValue;
  mutedColor?: ColorValue;
  surfaceColor?: ColorValue;
}) {
  if (!NativeTouchXLiquidTabBar) return null;

  return (
    <NativeTouchXLiquidTabBar
      style={style}
      selectedIndex={selectedIndex}
      labels={labels}
      accentColor={processColor(accentColor) ?? null}
      textColor={processColor(textColor) ?? null}
      mutedColor={processColor(mutedColor) ?? null}
      surfaceColor={processColor(surfaceColor) ?? null}
      onTabPress={(event) => onTabPress(event.nativeEvent.index)}
    />
  );
}
