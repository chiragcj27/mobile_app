import { useRef, useCallback, useState, useEffect } from 'react';
import { View, StyleSheet } from 'react-native';
import { WebView } from 'react-native-webview';

const PROCESSING_HTML = `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;">
<canvas id="c"></canvas>
<script>
function processImage(base64, cb) {
  var img = new Image();
  img.onload = function() {
    var canvas = document.getElementById('c');
    canvas.width = img.width;
    canvas.height = img.height;
    var ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);
    var imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    var d = imageData.data;

    for (var i = 0; i < d.length; i += 4) {
      var gray = 0.299 * d[i] + 0.587 * d[i+1] + 0.114 * d[i+2];
      d[i] = gray;
      d[i+1] = gray;
      d[i+2] = gray;
    }

    var w = canvas.width, h = canvas.height;
    var src = new Uint8ClampedArray(d);
    var amount = 0.7;
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var idx = (y * w + x) * 4;
        var sumR = 0, sumG = 0, sumB = 0;
        for (var ky = -1; ky <= 1; ky++) {
          for (var kx = -1; kx <= 1; kx++) {
            var px = Math.min(w - 1, Math.max(0, x + kx));
            var py = Math.min(h - 1, Math.max(0, y + ky));
            var sidx = (py * w + px) * 4;
            var kVal = (ky === 0 && kx === 0) ? (1 + 4 * amount) : (ky === 0 || kx === 0 ? -amount : 0);
            sumR += src[sidx] * kVal;
            sumG += src[sidx + 1] * kVal;
            sumB += src[sidx + 2] * kVal;
          }
        }
        d[idx] = Math.min(255, Math.max(0, sumR));
        d[idx + 1] = Math.min(255, Math.max(0, sumG));
        d[idx + 2] = Math.min(255, Math.max(0, sumB));
      }
    }
    ctx.putImageData(imageData, 0, 0);
    var resultBase64 = canvas.toDataURL('image/jpeg', 0.85).split(',')[1];
    cb(resultBase64);
  };
  img.src = 'data:image/jpeg;base64,' + base64;
}

function handleMsg(e) {
  processImage(e.data, function(result) {
    window.ReactNativeWebView.postMessage(result);
  });
}
document.addEventListener('message', handleMsg);
window.addEventListener('message', handleMsg);
</script>
</body>
</html>
`;

export function useImageProcessor() {
  const webViewRef = useRef(null);
  const [pendingProcess, setPendingProcess] = useState(null);
  const [webViewReady, setWebViewReady] = useState(false);
  const resolveRef = useRef(null);
  const rejectRef = useRef(null);

  useEffect(() => {
    if (webViewReady && pendingProcess && webViewRef.current) {
      webViewRef.current.postMessage(pendingProcess);
      setPendingProcess(null);
    }
  }, [webViewReady, pendingProcess]);

  const processImage = useCallback((base64) => {
    return new Promise((resolve, reject) => {
      resolveRef.current = resolve;
      rejectRef.current = reject;
      setPendingProcess(base64);
    });
  }, []);

  const handleMessage = useCallback((event) => {
    if (resolveRef.current) {
      resolveRef.current(event.nativeEvent.data);
      resolveRef.current = null;
      rejectRef.current = null;
      setWebViewReady(false);
    }
  }, []);

  const handleLoad = useCallback(() => {
    setWebViewReady(true);
  }, []);

  const handleError = useCallback(() => {
    if (rejectRef.current) {
      rejectRef.current(new Error('WebView failed to load'));
      resolveRef.current = null;
      rejectRef.current = null;
    }
  }, []);

  const processor = (
    <View style={styles.hidden}>
      <WebView
        ref={webViewRef}
        source={{ html: PROCESSING_HTML }}
        style={styles.webview}
        onMessage={handleMessage}
        onLoad={handleLoad}
        onError={handleError}
        javaScriptEnabled
        originWhitelist={['*']}
      />
    </View>
  );

  return { processImage, processor };
}

const styles = StyleSheet.create({
  hidden: {
    width: 300,
    height: 300,
    opacity: 0.01,
    position: 'absolute',
    top: 0,
    left: 0,
    zIndex: -1,
    overflow: 'hidden',
  },
  webview: {
    width: 300,
    height: 300,
  },
});
