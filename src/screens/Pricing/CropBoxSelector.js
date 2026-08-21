import React, { useEffect, useRef, useState } from 'react';
import {
  Modal,
  View,
  Text,
  Image,
  TouchableOpacity,
  StyleSheet,
  PanResponder,
} from 'react-native';
import { colors } from '../../constants/colors';
import { fonts } from '../../constants/fonts';

const clamp01 = (v) => Math.max(0, Math.min(1, v));

// Lets the user draw a box over the ORIGINAL (uncropped) image and emits the box as
// fractions (0..1) of the image — never pixels — so the backend can crop at full
// resolution regardless of device screen size / pixel ratio.
//
// Coordinates: we use PanResponder gestureState (absolute page coords) minus the canvas's
// measured window position. This is reliable on BOTH iOS and Android — unlike
// nativeEvent.locationX/Y, which on iOS is relative to whatever child view is under the
// finger and drifts during a drag.
export default function CropBoxSelector({
  visible,
  imageUri,
  imageWidth,
  imageHeight,
  onConfirm,
  onCancel,
}) {
  const [container, setContainer] = useState(null);
  const [rect, setRect] = useState(null);
  const canvasRef = useRef(null);
  const canvasWinRef = useRef(null); // { x, y, width, height } in window/page coords
  const startRef = useRef(null);
  const imgRectRef = useRef(null);

  // The displayed image rectangle inside the container (resizeMode="contain" letterboxes it).
  useEffect(() => {
    if (!container || !imageWidth || !imageHeight) {
      imgRectRef.current = null;
      return;
    }
    const scale = Math.min(container.width / imageWidth, container.height / imageHeight);
    const w = imageWidth * scale;
    const h = imageHeight * scale;
    imgRectRef.current = {
      left: (container.width - w) / 2,
      top: (container.height - h) / 2,
      width: w,
      height: h,
    };
  }, [container, imageWidth, imageHeight]);

  const measureCanvas = () => {
    const node = canvasRef.current;
    if (node && node.measureInWindow) {
      node.measureInWindow((x, y, width, height) => {
        if (!width || !height) return;
        canvasWinRef.current = { x, y, width, height };
        setContainer((prev) =>
          prev && prev.width === width && prev.height === height ? prev : { width, height },
        );
      });
    }
  };

  // Convert an absolute page point to canvas-local coordinates.
  const toLocal = (pageX, pageY, evt) => {
    const win = canvasWinRef.current;
    if (win) return { x: pageX - win.x, y: pageY - win.y };
    // Fallback (should not normally happen once measured): use locationX/Y.
    return { x: evt?.nativeEvent?.locationX ?? pageX, y: evt?.nativeEvent?.locationY ?? pageY };
  };

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (evt, gesture) => {
        const p = toLocal(gesture.x0, gesture.y0, evt);
        startRef.current = p;
        setRect({ x: p.x, y: p.y, w: 0, h: 0 });
      },
      onPanResponderMove: (evt, gesture) => {
        const s = startRef.current;
        if (!s) return;
        const p = toLocal(gesture.moveX, gesture.moveY, evt);
        setRect({
          x: Math.min(s.x, p.x),
          y: Math.min(s.y, p.y),
          w: Math.abs(p.x - s.x),
          h: Math.abs(p.y - s.y),
        });
      },
    }),
  ).current;

  const handleConfirm = () => {
    const ir = imgRectRef.current;
    // No box (or a stray tap) → treat as the whole image.
    if (!rect || !ir || rect.w < 8 || rect.h < 8) {
      onConfirm({ x: 0, y: 0, w: 1, h: 1 });
      return;
    }
    const fx = clamp01((rect.x - ir.left) / ir.width);
    const fy = clamp01((rect.y - ir.top) / ir.height);
    const fw = clamp01(Math.min(rect.w / ir.width, 1 - fx));
    const fh = clamp01(Math.min(rect.h / ir.height, 1 - fy));
    const fractions = { x: +fx.toFixed(4), y: +fy.toFixed(4), w: +fw.toFixed(4), h: +fh.toFixed(4) };
    onConfirm(fractions);
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={s.overlay}>
        <View style={s.header}>
          <Text style={s.title}>Mark the stone / pricing table</Text>
          <Text style={s.subtitle}>Drag to draw a box around the chart. The rest of the image is ignored.</Text>
        </View>

        <View
          ref={canvasRef}
          style={s.canvas}
          onLayout={measureCanvas}
          {...pan.panHandlers}
        >
          {imageUri ? (
            <Image
              source={{ uri: imageUri }}
              style={StyleSheet.absoluteFill}
              resizeMode="contain"
              pointerEvents="none"
            />
          ) : null}
          {rect ? (
            <View
              style={[s.box, { left: rect.x, top: rect.y, width: rect.w, height: rect.h }]}
              pointerEvents="none"
            />
          ) : null}
        </View>

        <View style={s.footer}>
          <TouchableOpacity style={s.btnOutline} onPress={onCancel} activeOpacity={0.85}>
            <Text style={s.btnOutlineText}>Cancel</Text>
          </TouchableOpacity>
          <TouchableOpacity style={s.btnOutline} onPress={() => setRect(null)} activeOpacity={0.85}>
            <Text style={s.btnOutlineText}>Reset Box</Text>
          </TouchableOpacity>
          <TouchableOpacity style={s.btnPrimary} onPress={handleConfirm} activeOpacity={0.85}>
            <Text style={s.btnPrimaryText}>Use This Area</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: '#000' },
  header: { paddingHorizontal: 16, paddingTop: 44, paddingBottom: 10 },
  title: { fontFamily: fonts.bold, fontSize: fonts.base || 15, color: '#fff' },
  subtitle: { fontFamily: fonts.regular, fontSize: fonts.xs || 12, color: 'rgba(255,255,255,0.7)', marginTop: 4 },
  canvas: { flex: 1, backgroundColor: '#111', overflow: 'hidden' },
  box: {
    position: 'absolute',
    borderWidth: 2,
    borderColor: colors.primary,
    backgroundColor: 'rgba(20,63,69,0.15)',
  },
  footer: {
    flexDirection: 'row',
    gap: 10,
    padding: 16,
    paddingBottom: 28,
    backgroundColor: '#000',
  },
  btnOutline: {
    flex: 1,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.4)',
    borderRadius: 12,
    paddingVertical: 13,
    alignItems: 'center',
  },
  btnOutlineText: { fontFamily: fonts.bold, fontSize: fonts.sm || 13, color: '#fff' },
  btnPrimary: {
    flex: 1.4,
    backgroundColor: colors.primary,
    borderRadius: 12,
    paddingVertical: 13,
    alignItems: 'center',
  },
  btnPrimaryText: { fontFamily: fonts.bold, fontSize: fonts.sm || 13, color: '#fff' },
});
