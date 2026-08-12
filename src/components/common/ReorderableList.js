import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  FlatList,
  Animated,
  StyleSheet,
  View,
  Platform,
  UIManager,
  LayoutAnimation,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}
const SLIDE = { duration: 160, update: { type: LayoutAnimation.Types.easeInEaseOut } };

// Hold-to-drag reorderable list on react-native-gesture-handler + Animated only
// (no reanimated). While dragging, the row leaves a visible gap placeholder that
// slides to show exactly where the card will land, and the real card floats as an
// overlay under the finger. Order is committed once, on release.
const EDGE_ZONE = 90;
const SCROLL_STEP = 14;
const SCROLL_TICK_MS = 16;

export default function ReorderableList({
  data,
  renderItem,
  keyExtractor,
  onDragEnd,
  contentContainerStyle,
  ListEmptyComponent,
  refreshControl,
  ...restProps
}) {
  const keyOf = useCallback(
    (item, index) => (keyExtractor ? keyExtractor(item, index) : String(index)),
    [keyExtractor]
  );

  const [items, setItems] = useState(data || []);
  const itemsRef = useRef(items);
  itemsRef.current = items;

  const draggingRef = useRef(false);
  useEffect(() => {
    if (!draggingRef.current) setItems(data || []);
  }, [data]);

  const listRef = useRef(null);
  const heights = useRef({});
  const scrollY = useRef(0);
  const viewportH = useRef(0);
  const contentH = useRef(0);

  const onDragEndRef = useRef(onDragEnd);
  onDragEndRef.current = onDragEnd;

  const [activeKey, setActiveKey] = useState(null);
  const [activeItem, setActiveItem] = useState(null);
  const activeIndexRef = useRef(null);
  const startIndexRef = useRef(null);
  const pendingIndexRef = useRef(null);
  const baseline = useRef(0);
  const autoScrollAccum = useRef(0);
  const translationYRef = useRef(0);
  const pointerViewportY = useRef(0);
  const autoScrollTimer = useRef(null);
  const activeHeightRef = useRef(80);

  const overlayY = useRef(new Animated.Value(0)).current;
  const lift = useRef(new Animated.Value(0)).current;

  const heightAt = (idx) => {
    const arr = itemsRef.current;
    if (idx < 0 || idx >= arr.length) return 0;
    return heights.current[keyOf(arr[idx], idx)] || 80;
  };

  const moveItem = (from, to) => {
    LayoutAnimation.configureNext(SLIDE);
    const next = [...itemsRef.current];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    itemsRef.current = next;
    setItems(next);
  };

  const contentDelta = () => translationYRef.current + autoScrollAccum.current;

  const updateDrag = useCallback(() => {
    if (activeIndexRef.current == null) return;
    const delta = contentDelta();
    let idx = activeIndexRef.current;

    while (idx < itemsRef.current.length - 1) {
      const nextH = heightAt(idx + 1);
      if (delta - baseline.current > nextH / 2) {
        moveItem(idx, idx + 1);
        baseline.current += nextH;
        idx += 1;
      } else break;
    }
    while (idx > 0) {
      const prevH = heightAt(idx - 1);
      if (delta - baseline.current < -prevH / 2) {
        moveItem(idx, idx - 1);
        baseline.current -= prevH;
        idx -= 1;
      } else break;
    }

    activeIndexRef.current = idx;
  }, []);

  const stopAutoScroll = useCallback(() => {
    if (autoScrollTimer.current) {
      clearInterval(autoScrollTimer.current);
      autoScrollTimer.current = null;
    }
  }, []);

  const maybeAutoScroll = useCallback(() => {
    if (activeIndexRef.current == null) return;
    const y = pointerViewportY.current;
    const dir = y < EDGE_ZONE ? -1 : y > viewportH.current - EDGE_ZONE ? 1 : 0;
    if (dir === 0) { stopAutoScroll(); return; }
    if (autoScrollTimer.current) return;

    autoScrollTimer.current = setInterval(() => {
      const max = Math.max(0, contentH.current - viewportH.current);
      const next = Math.max(0, Math.min(max, scrollY.current + dir * SCROLL_STEP));
      if (next === scrollY.current) { stopAutoScroll(); return; }
      autoScrollAccum.current += next - scrollY.current;
      scrollY.current = next;
      listRef.current?.scrollToOffset({ offset: next, animated: false });
      updateDrag();
    }, SCROLL_TICK_MS);
  }, [stopAutoScroll, updateDrag]);

  const beginDrag = useCallback((index) => {
    const arr = itemsRef.current;
    if (index == null || index < 0 || index >= arr.length) return;
    const key = keyOf(arr[index], index);
    draggingRef.current = true;
    activeIndexRef.current = index;
    startIndexRef.current = index;
    baseline.current = 0;
    autoScrollAccum.current = 0;
    translationYRef.current = 0;
    activeHeightRef.current = heights.current[key] || 80;
    overlayY.setValue(pointerViewportY.current);
    setActiveKey(key);
    setActiveItem(arr[index]);
    // Halt any momentum scroll so the pick point doesn't drift onto another card.
    listRef.current?.scrollToOffset({ offset: scrollY.current, animated: false });
    Animated.spring(lift, { toValue: 1, useNativeDriver: true, mass: 0.4, damping: 12 }).start();
  }, [keyOf, lift, overlayY]);

  const endDrag = useCallback(() => {
    if (activeIndexRef.current == null) return;
    stopAutoScroll();
    const finalItems = itemsRef.current;
    const toIndex = activeIndexRef.current;
    const changed = toIndex !== startIndexRef.current;
    activeIndexRef.current = null;
    startIndexRef.current = null;
    draggingRef.current = false;
    setActiveKey(null);
    setActiveItem(null);
    Animated.spring(lift, { toValue: 0, useNativeDriver: true, mass: 0.4, damping: 14 }).start();
    if (onDragEndRef.current) onDragEndRef.current({ data: finalItems, toIndex, changed });
  }, [lift, stopAutoScroll]);

  const panGesture = useMemo(
    () =>
      Gesture.Pan()
        .runOnJS(true)
        .activateAfterLongPress(220)
        .onStart((e) => {
          pointerViewportY.current = e.y;
          overlayY.setValue(e.y);
          if (activeIndexRef.current == null && pendingIndexRef.current != null) {
            beginDrag(pendingIndexRef.current);
            pendingIndexRef.current = null;
          }
        })
        .onUpdate((e) => {
          if (activeIndexRef.current == null) return;
          translationYRef.current = e.translationY;
          pointerViewportY.current = e.y;
          overlayY.setValue(e.y);
          updateDrag();
          maybeAutoScroll();
        })
        .onEnd(endDrag)
        .onFinalize(() => {
          if (activeIndexRef.current != null) endDrag();
          pendingIndexRef.current = null;
          stopAutoScroll();
          draggingRef.current = false;
        }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  const scale = useMemo(() => lift.interpolate({ inputRange: [0, 1], outputRange: [1, 1.04] }), [lift]);
  const shadowOpacity = useMemo(() => lift.interpolate({ inputRange: [0, 1], outputRange: [0, 0.28] }), [lift]);

  const renderRow = useCallback(
    ({ item, index }) => {
      const key = keyOf(item, index);
      const isActive = key === activeKey;
      if (isActive) {
        return <View style={[styles.placeholder, { height: Math.max(40, activeHeightRef.current - 8) }]} />;
      }
      return (
        <View onLayout={(e) => { heights.current[key] = e.nativeEvent.layout.height; }}>
          {renderItem({ item, index, isActive: false, drag: () => { pendingIndexRef.current = index; } })}
        </View>
      );
    },
    [activeKey, keyOf, renderItem]
  );

  useEffect(() => () => stopAutoScroll(), [stopAutoScroll]);

  const overlayTranslate = useMemo(
    () => Animated.subtract(overlayY, activeHeightRef.current / 2),
    [overlayY, activeItem]
  );

  return (
    <View
      style={styles.container}
      onLayout={(e) => { viewportH.current = e.nativeEvent.layout.height; }}
    >
      <GestureDetector gesture={panGesture}>
        <FlatList
          ref={listRef}
          data={items}
          renderItem={renderRow}
          keyExtractor={keyOf}
          onScroll={(e) => { scrollY.current = e.nativeEvent.contentOffset.y; }}
          onContentSizeChange={(w, h) => { contentH.current = h; }}
          scrollEventThrottle={16}
          scrollEnabled={activeKey === null}
          contentContainerStyle={contentContainerStyle}
          ListEmptyComponent={ListEmptyComponent}
          refreshControl={refreshControl}
          {...restProps}
        />
      </GestureDetector>

      {activeItem && (
        <Animated.View
          pointerEvents="none"
          style={[styles.overlay, { shadowOpacity, transform: [{ translateY: overlayTranslate }, { scale }] }]}
        >
          {renderItem({ item: activeItem, index: -1, isActive: true, drag: () => {} })}
        </Animated.View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  placeholder: {
    marginHorizontal: 10,
    marginTop: 2,
    marginBottom: 6,
    borderRadius: 10,
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: 'rgba(16,53,52,0.35)',
    backgroundColor: 'rgba(16,53,52,0.06)',
  },
  overlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    zIndex: 1000,
    elevation: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowRadius: 12,
  },
});
