// Camera barcode scanning. Uses the native BarcodeDetector where available (Chrome, Android),
// otherwise lazy-loads ZXing. Both paths stop after one successful read per start().
const FORMATS = ["qr_code", "ean_13", "ean_8", "upc_a", "upc_e", "code_128", "code_39", "code_93",
  "itf", "codabar", "data_matrix", "pdf417", "aztec"];
const ZXING_URL = "https://cdn.jsdelivr.net/npm/@zxing/library@0.21.3/umd/index.min.js";

export function loadZxing() {
  if (window.ZXing) return Promise.resolve(window.ZXing);
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = ZXING_URL;
    s.onload = () => resolve(window.ZXing);
    s.onerror = () => reject(new Error("Could not load the scanning library (offline?)"));
    document.head.append(s);
  });
}

// Decodes one canvas frame with ZXing; returns the text or null when no code is found.
export function makeZxingDecoder(ZXing) {
  const { DecodeHintType, BarcodeFormat } = ZXing;
  const hints = new Map([
    [DecodeHintType.TRY_HARDER, true],
    [DecodeHintType.POSSIBLE_FORMATS, [
      BarcodeFormat.QR_CODE, BarcodeFormat.EAN_13, BarcodeFormat.EAN_8, BarcodeFormat.UPC_A,
      BarcodeFormat.UPC_E, BarcodeFormat.CODE_128, BarcodeFormat.CODE_39, BarcodeFormat.CODE_93,
      BarcodeFormat.ITF, BarcodeFormat.CODABAR, BarcodeFormat.DATA_MATRIX, BarcodeFormat.PDF_417,
      BarcodeFormat.AZTEC,
    ]],
  ]);
  const reader = new ZXing.MultiFormatReader();
  reader.setHints(hints);
  return (canvas) => {
    const bitmap = new ZXing.BinaryBitmap(
      new ZXing.HybridBinarizer(new ZXing.HTMLCanvasElementLuminanceSource(canvas)));
    try { return reader.decode(bitmap).getText(); } catch { return null; }
  };
}

export async function startScanner(video, onResult) {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
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
    const decode = makeZxingDecoder(ZXing);
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    const tick = () => {
      if (stopped) return;
      if (video.videoWidth) {
        const scale = Math.min(1, 960 / video.videoWidth);
        canvas.width = Math.round(video.videoWidth * scale);
        canvas.height = Math.round(video.videoHeight * scale);
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const text = decode(canvas);
        if (text) return found(text);
      }
      setTimeout(tick, 100);
    };
    tick();
  }
  return stop;
}
