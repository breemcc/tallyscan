// Camera barcode scanning. Uses the native BarcodeDetector where available (Chrome, Android),
// otherwise lazy-loads ZXing. Both paths stop after one successful read per start().
const FORMATS = ["qr_code", "ean_13", "ean_8", "upc_a", "upc_e", "code_128", "code_39", "code_93",
  "itf", "codabar", "data_matrix", "pdf417", "aztec"];
const ZXING_URL = "https://cdn.jsdelivr.net/npm/@zxing/library@0.21.3/umd/index.min.js";

function loadZxing() {
  if (window.ZXing) return Promise.resolve(window.ZXing);
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = ZXING_URL;
    s.onload = () => resolve(window.ZXing);
    s.onerror = () => reject(new Error("Could not load the scanning library (offline?)"));
    document.head.append(s);
  });
}

export async function startScanner(video, onResult) {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: { ideal: "environment" } },
    audio: false,
  });
  video.srcObject = stream;
  await video.play();

  let stopped = false;
  const stop = () => {
    stopped = true;
    stream.getTracks().forEach((t) => t.stop());
    video.srcObject = null;
  };
  const found = (text) => {
    if (stopped || !text) return;
    stop();
    onResult(text);
  };

  if ("BarcodeDetector" in window) {
    const detector = new BarcodeDetector({ formats: FORMATS });
    const tick = async () => {
      if (stopped) return;
      try {
        const codes = await detector.detect(video);
        if (codes.length) return found(codes[0].rawValue);
      } catch { /* frame not ready */ }
      setTimeout(tick, 120);
    };
    tick();
  } else {
    const ZXing = await loadZxing();
    const reader = new ZXing.BrowserMultiFormatReader();
    const tick = async () => {
      if (stopped) return;
      try {
        const result = await reader.decodeFromVideoElement(video);
        return found(result.getText());
      } catch { setTimeout(tick, 150); }
    };
    tick();
  }
  return stop;
}
