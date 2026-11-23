import { useEffect, useLayoutEffect, useRef } from "react";
import { Animated, Easing, Platform, View, type ViewStyle } from "react-native";
import { animateSpinnerOnWeb } from "./web";

const duration = 800;
const progress = new Animated.Value(0);
const rotation = progress.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "360deg"] });
let spinnerCount = 0;
let animation: Animated.CompositeAnimation | null = null;

function NativeSpinnerArc({ style }: { style: ViewStyle }) {
  useEffect(() => {
    spinnerCount += 1;
    if (spinnerCount === 1) {
      progress.setValue(0);
      animation = Animated.loop(
        Animated.timing(progress, {
          toValue: 1,
          duration,
          easing: Easing.linear,
          isInteraction: false,
          useNativeDriver: true,
        }),
      );
      animation.start();
    }
    return () => {
      spinnerCount -= 1;
      if (spinnerCount === 0) {
        animation?.stop();
        animation = null;
      }
    };
  }, []);

  return <Animated.View style={[style, { transform: [{ rotate: rotation }] }]} />;
}

function WebSpinnerArc({ style }: { style: ViewStyle }) {
  const ref = useRef<View>(null);
  useLayoutEffect(() => animateSpinnerOnWeb(ref.current, duration), []);
  return <View ref={ref} style={style} />;
}

const SpinnerArc = Platform.OS === "web" ? WebSpinnerArc : NativeSpinnerArc;

export function RunningSpinner({ color, size }: { color: string; size: number }) {
  const ring = { width: size, height: size, borderRadius: size / 2, borderWidth: size / 8 };
  return (
    <View accessible={false} pointerEvents="none" style={{ width: size, height: size }}>
      <View style={{ ...ring, position: "absolute", borderColor: color, opacity: 0.2 }} />
      <SpinnerArc style={{ ...ring, borderColor: "transparent", borderTopColor: color }} />
    </View>
  );
}
