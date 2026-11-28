import { Html5Qrcode, Html5QrcodeSupportedFormats } from 'html5-qrcode';
import { readBarcodes, readBarcodesFromImageData } from 'zxing-wasm/reader';

let html5QrcodeInstance = null;
let currentCameraId = null;
let isScanning = false;
let isStarting = false;
let startPromise = null;
let isTorchOn = false;
let isSoundEnabled = true;
let currentCallback = null;
let isProcessingScan = false;
let lastScannedCode = '';
let lastScanTime = 0;
let availableCameras = [];
let currentCameraIndex = 0;

const supportedFormats = [
  Html5QrcodeSupportedFormats.QR_CODE,
  Html5QrcodeSupportedFormats.DATA_MATRIX,
  Html5QrcodeSupportedFormats.CODE_128
];

/**
 * Web Audio API Beep Sound Generator
 */
export function playBeep() {
  if (!isSoundEnabled) return;
  try {
    const AudioCtxClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtxClass) return;
    const audioCtx = new AudioCtxClass();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, audioCtx.currentTime);
    gain.gain.setValueAtTime(0.2, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.15);

    osc.connect(gain);
    gain.connect(audioCtx.destination);

    osc.start();
    osc.stop(audioCtx.currentTime + 0.15);
  } catch (e) {
    console.warn('Audio feedback error:', e);
  }
}

/**
 * Haptic Vibration Feedback
 */
export function triggerHaptic() {
  if ('vibrate' in navigator) {
    try {
      navigator.vibrate([60, 40, 60]);
    } catch (e) {
      /* ignore */
    }
  }
}

export function setSoundEnabled(enabled) {
  isSoundEnabled = enabled;
}

export function isSoundActive() {
  return isSoundEnabled;
}

/**
 * Stop any orphan or active media stream tracks across video elements in reader
 */
function stopAllActiveVideoTracks() {
  try {
    const reader = document.getElementById('reader');
    if (reader) {
      const videos = reader.querySelectorAll('video');
      videos.forEach(v => {
        if (v.srcObject && typeof v.srcObject.getTracks === 'function') {
          v.srcObject.getTracks().forEach(t => {
            try { t.stop(); } catch (_) { }
          });
        }
        v.srcObject = null;
      });
    }
  } catch (err) {
    console.warn('Error stopping active video tracks:', err);
  }
}

/**
 * Clean up existing scanner instance safely
 */
async function cleanupScannerInstance() {
  stopWasmCameraSampler();
  stopAllActiveVideoTracks();
  if (html5QrcodeInstance) {
    const inst = html5QrcodeInstance;
    html5QrcodeInstance = null;
    try {
      if (inst.isScanning) {
        await inst.stop();
      }
    } catch (e) {
      console.warn('Instance stop notice:', e);
    }
    try {
      await inst.clear().catch(() => { });
    } catch (_) { }
  }
}

/**
 * Enumerate cameras only AFTER camera permission is granted
 */
async function populateAvailableCameras() {
  try {
    if (navigator.mediaDevices && navigator.mediaDevices.enumerateDevices) {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const videoDevices = devices.filter(d => d.kind === 'videoinput');
      if (videoDevices.length > 0) {
        availableCameras = videoDevices.map((d, idx) => ({
          id: d.deviceId,
          label: d.label || `Camera ${idx + 1}`
        }));
        const switchCamBtn = document.getElementById('btn-switch-cam');
        if (switchCamBtn && availableCameras.length > 1) {
          switchCamBtn.classList.remove('hidden');
        }
      }
    }
  } catch (e) {
    console.warn('Post-permission camera enumeration notice:', e);
  }
}

/**
 * Initialize / Auto-Resume Camera Scanner
 */
export async function initScanner(containerId = 'reader', onScanSuccessCallback) {
  if (onScanSuccessCallback) {
    currentCallback = onScanSuccessCallback;
  }

  if (isScanning) return { success: true };
  if (startPromise) {
    return await startPromise;
  }

  // Wait a moment for DOM layout to settle
  await new Promise(resolve => setTimeout(resolve, 80));

  const statusEl = document.getElementById('camera-status-msg');
  const allowBtn = document.getElementById('btn-allow-camera');
  const promptWrap = document.getElementById('camera-prompt-wrap');
  const overlay = document.getElementById('scanner-overlay');

  const isSecure = window.isSecureContext || window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';

  // Check if blocked by browser security (HTTP on mobile devices)
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    if (promptWrap) promptWrap.classList.remove('hidden');
    if (overlay) overlay.style.display = 'none';
    if (statusEl) {
      statusEl.classList.remove('hidden');
      statusEl.innerHTML = isSecure
        ? '⚠️ <strong>Camera is not supported on this browser.</strong><br>Please use modern Chrome or Safari, or scan a QR code from your gallery below.'
        : '⚠️ <strong>Camera requires a secure HTTPS connection.</strong><br>Mobile browsers block camera access on unencrypted HTTP addresses.<br>Please open the HTTPS link or scan a QR code from your gallery below.';
    }
    if (allowBtn) allowBtn.classList.add('hidden');
    return { success: false, error: new Error('Insecure context') };
  }

  // Show connecting state
  if (promptWrap) promptWrap.classList.remove('hidden');
  if (statusEl) {
    statusEl.classList.remove('hidden');
    statusEl.textContent = 'Connecting to camera...';
  }
  if (allowBtn) allowBtn.classList.add('hidden');
  if (overlay) overlay.style.display = 'none';

  try {
    const result = await startScanner(currentCallback);
    if (result && result.success) {
      if (statusEl) statusEl.classList.add('hidden');
      if (allowBtn) allowBtn.classList.add('hidden');
      if (promptWrap) promptWrap.classList.add('hidden');
      if (overlay) overlay.style.display = 'flex';
      return { success: true };
    }
  } catch (err) {
    console.warn('Camera initialization error:', err);
    if (promptWrap) promptWrap.classList.remove('hidden');
    if (overlay) overlay.style.display = 'none';

    const isPermissionDenied = err?.name === 'NotAllowedError' || err?.name === 'PermissionDeniedError' || err?.message?.includes('Permission') || err?.message?.includes('denied');

    if (statusEl) {
      statusEl.classList.remove('hidden');
      if (isPermissionDenied) {
        statusEl.innerHTML = '<strong>Camera permission was not granted.</strong><br>Tap "ALLOW CAMERA" below to grant access, or check browser site settings.';
      } else if (err?.name === 'NotFoundError' || err?.name === 'DevicesNotFoundError') {
        statusEl.textContent = 'No camera device detected. You can scan a QR code from your gallery below.';
      } else if (err?.name === 'NotReadableError' || err?.name === 'TrackStartError') {
        statusEl.textContent = 'Camera is currently busy or in use. Please close other camera apps and tap below.';
      } else {
        statusEl.textContent = 'Tap below to open camera or select QR from photo gallery.';
      }
    }

    if (allowBtn) {
      allowBtn.classList.remove('hidden');
      allowBtn.textContent = 'ALLOW CAMERA';
      allowBtn.onclick = async () => {
        try {
          if (statusEl) {
            statusEl.classList.remove('hidden');
            statusEl.textContent = 'Requesting camera access...';
          }
          allowBtn.classList.add('hidden');
          const res = await startScanner(currentCallback);
          if (res && res.success) {
            if (statusEl) statusEl.classList.add('hidden');
            if (allowBtn) allowBtn.classList.add('hidden');
            if (promptWrap) promptWrap.classList.add('hidden');
            if (overlay) overlay.style.display = 'flex';
          } else {
            allowBtn.classList.remove('hidden');
          }
        } catch (e) {
          console.error('Manual start failed:', e);
          if (statusEl) {
            statusEl.classList.remove('hidden');
            statusEl.textContent = (e?.name === 'NotAllowedError' || e?.name === 'PermissionDeniedError')
              ? 'Permission denied. Please tap the lock/camera icon in your browser address bar to allow camera access.'
              : 'Could not start camera: ' + (e.message || 'Error');
          }
          allowBtn.classList.remove('hidden');
        }
      };
    }

    return { success: false, error: err };
  }

  return { success: false };
}

let wasmSamplerTimer = null;
let offscreenCanvas = null;
let offscreenCtx = null;

/**
 * High-speed concurrent WebAssembly frame scanner
 * Periodically samples frames from the live video element and decodes using zxing-wasm (C++ engine)
 */
function startWasmCameraSampler() {
  stopWasmCameraSampler();

  const checkVideo = () => {
    if (!isScanning) return;
    const video = document.querySelector('#reader video');
    if (!video) {
      wasmSamplerTimer = setTimeout(checkVideo, 120);
      return;
    }

    if (!offscreenCanvas) {
      offscreenCanvas = document.createElement('canvas');
      offscreenCtx = offscreenCanvas.getContext('2d', { willReadFrequently: true });
    }

    let isSampling = false;

    const sampleFrame = async () => {
      if (!isScanning) return;
      if (isProcessingScan || isSampling) {
        wasmSamplerTimer = setTimeout(sampleFrame, 130);
        return;
      }

      if (video.readyState >= 2 && video.videoWidth > 0 && video.videoHeight > 0) {
        isSampling = true;
        try {
          const w = video.videoWidth;
          const h = video.videoHeight;
          if (offscreenCanvas.width !== w || offscreenCanvas.height !== h) {
            offscreenCanvas.width = w;
            offscreenCanvas.height = h;
          }
          offscreenCtx.drawImage(video, 0, 0, w, h);
          const imageData = offscreenCtx.getImageData(0, 0, w, h);

          const results = await readBarcodesFromImageData(imageData, {
            formats: ['QRCode', 'DataMatrix', 'Code128'],
            tryHarder: true,
            tryInvert: true
          });

          if (results && results.length > 0 && results[0].text) {
            handleSuccessfulScan(results[0].text, { result: results[0] });
          }
        } catch (e) {
          // Quiet transient decode errors
        } finally {
          isSampling = false;
        }
      }

      if (isScanning) {
        wasmSamplerTimer = setTimeout(sampleFrame, 130);
      }
    };

    wasmSamplerTimer = setTimeout(sampleFrame, 200);
  };

  checkVideo();
}

function stopWasmCameraSampler() {
  if (wasmSamplerTimer) {
    clearTimeout(wasmSamplerTimer);
    wasmSamplerTimer = null;
  }
}

/**
 * Unified scan success handler with debouncing and haptics
 */
function handleSuccessfulScan(decodedText, decodedResult) {
  const now = Date.now();
  if (isProcessingScan || (decodedText === lastScannedCode && (now - lastScanTime < 2500))) {
    return;
  }

  isProcessingScan = true;
  lastScannedCode = decodedText;
  lastScanTime = now;

  playBeep();
  triggerHaptic();

  if (currentCallback) {
    try {
      currentCallback(decodedText, decodedResult);
    } catch (cbErr) {
      console.error('Scan callback error:', cbErr);
    } finally {
      setTimeout(() => {
        isProcessingScan = false;
      }, 1800);
    }
  }
}

/**
 * Start camera feed and scanner loop
 */
export async function startScanner(onScanSuccessCallback) {
  if (isScanning && html5QrcodeInstance?.isScanning) return { success: true };
  if (startPromise) {
    return await startPromise;
  }

  if (onScanSuccessCallback) {
    currentCallback = onScanSuccessCallback;
  }

  isStarting = true;

  startPromise = (async () => {
    try {
      const config = {
        fps: 15,
        qrbox: (viewfinderWidth, viewfinderHeight) => {
          const minEdge = Math.min(viewfinderWidth, viewfinderHeight);
          const size = Math.max(180, Math.floor(minEdge * 0.72));
          return { width: size, height: size };
        },
        showTorchButtonIfSupported: false
      };

      await cleanupScannerInstance();

      const readerEl = document.getElementById('reader');
      if (!readerEl) throw new Error('Scanner container #reader not found');

      html5QrcodeInstance = new Html5Qrcode('reader', {
        formatsToSupport: supportedFormats,
        experimentalFeatures: {
          useBarCodeDetectorIfSupported: true
        },
        verbose: false
      });

      // Prefer rear (environment) camera on mobile; if user switched camera, use that specific deviceId
      const primaryConfig = currentCameraId ? { deviceId: { exact: currentCameraId } } : { facingMode: 'environment' };

      let started = false;
      let lastError = null;

      try {
        await html5QrcodeInstance.start(
          primaryConfig,
          config,
          (decodedText, decodedResult) => {
            handleSuccessfulScan(decodedText, decodedResult);
          },
          () => { } // quiet frame parse error
        );
        started = true;
      } catch (err) {
        lastError = err;
        console.warn('Primary camera attempt failed:', err);

        // If permission was denied by user, DO NOT keep prompting in a loop!
        const isPermissionDenied = err?.name === 'NotAllowedError' || err?.name === 'PermissionDeniedError' || err?.message?.includes('Permission') || err?.message?.includes('denied');
        if (isPermissionDenied) {
          throw err;
        }

        // If environment camera was not found (e.g. desktop webcam / device with user camera only), try front camera ONCE
        if (!currentCameraId && (err?.name === 'OverconstrainedError' || err?.name === 'NotFoundError' || err?.name === 'DevicesNotFoundError')) {
          try {
            await cleanupScannerInstance();
            html5QrcodeInstance = new Html5Qrcode('reader', {
              formatsToSupport: supportedFormats,
              experimentalFeatures: { useBarCodeDetectorIfSupported: true },
              verbose: false
            });
            await html5QrcodeInstance.start(
              { facingMode: 'user' },
              config,
              (decodedText, decodedResult) => {
                handleSuccessfulScan(decodedText, decodedResult);
              },
              () => { }
            );
            started = true;
          } catch (fallbackErr) {
            lastError = fallbackErr;
            console.warn('User camera fallback attempt failed:', fallbackErr);
          }
        }
      }

      if (!started) {
        isScanning = false;
        throw lastError || new Error('Unable to start camera.');
      }

      isScanning = true;
      isStarting = false;

      // Mobile inline video playback safeguard
      const videoEl = document.querySelector('#reader video');
      if (videoEl) {
        videoEl.setAttribute('playsinline', 'true');
        videoEl.setAttribute('webkit-playsinline', 'true');
        videoEl.muted = true;
        try {
          await videoEl.play().catch(() => {});
        } catch (_) {}
      }

      checkTorchCapability();
      startWasmCameraSampler();

      // Enumerate available cameras only AFTER permission is active
      populateAvailableCameras().catch(() => {});

      return { success: true };
    } finally {
      isStarting = false;
      startPromise = null;
    }
  })();

  return await startPromise;
}

export async function stopScanner() {
  if (startPromise) {
    try {
      await startPromise;
    } catch (_) { }
  }
  isScanning = false;
  isStarting = false;
  isProcessingScan = false;
  stopWasmCameraSampler();
  await cleanupScannerInstance();
  const overlay = document.getElementById('scanner-overlay');
  if (overlay) overlay.style.display = 'none';
  const promptWrap = document.getElementById('camera-prompt-wrap');
  if (promptWrap) promptWrap.classList.add('hidden');
  const torchBtn = document.getElementById('btn-torch');
  if (torchBtn) {
    torchBtn.classList.remove('active');
    torchBtn.classList.add('hidden');
  }
  isTorchOn = false;
}


export async function switchNextCamera() {
  if (availableCameras.length <= 1) return;
  currentCameraIndex = (currentCameraIndex + 1) % availableCameras.length;
  currentCameraId = availableCameras[currentCameraIndex].id;
  await stopScanner();
  await initScanner('reader', currentCallback);
}

/**
 * Torch / Flashlight Toggle
 */
export async function toggleTorch() {
  if (!html5QrcodeInstance || !isScanning) return;
  try {
    const capabilities = html5QrcodeInstance.getRunningTrackCapabilities();
    if (capabilities && capabilities.torch) {
      isTorchOn = !isTorchOn;
      await html5QrcodeInstance.applyVideoConstraints({
        advanced: [{ torch: isTorchOn }]
      });
      const torchBtn = document.getElementById('btn-torch');
      if (torchBtn) {
        torchBtn.classList.toggle('active', isTorchOn);
      }
    }
  } catch (e) {
    console.warn('Torch toggle error:', e);
  }
}

async function checkTorchCapability() {
  const torchBtn = document.getElementById('btn-torch');
  if (!torchBtn || !html5QrcodeInstance) return;

  try {
    const capabilities = html5QrcodeInstance.getRunningTrackCapabilities();
    if (capabilities && capabilities.torch) {
      torchBtn.classList.remove('hidden');
      torchBtn.onclick = toggleTorch;
    } else {
      torchBtn.classList.add('hidden');
    }
  } catch (e) {
    torchBtn.classList.add('hidden');
  }
}

export async function scanImageFile(file) {
  if (!file) return { success: false, error: 'No file selected.' };

  // 1. Primary: High-performance WebAssembly ZXing (decodes dense 1000+ character QR codes flawlessly)
  try {
    const wasmResults = await readBarcodes(file, {
      formats: ['QRCode', 'DataMatrix', 'Code128'],
      tryHarder: true,
      tryInvert: true,
      tryRotate: true
    });
    if (wasmResults && wasmResults.length > 0 && wasmResults[0].text) {
      playBeep();
      triggerHaptic();
      return { success: true, result: wasmResults[0].text };
    }
  } catch (wasmErr) {
    console.warn('zxing-wasm scanImageFile attempt notice:', wasmErr);
  }

  // 2. Secondary: Hardware-accelerated native BarcodeDetector API (Android Chrome & iOS Safari)
  if ('BarcodeDetector' in window) {
    try {
      const detector = new window.BarcodeDetector({ formats: ['qr_code', 'data_matrix', 'code_128'] });
      const bmp = await createImageBitmap(file);
      const detected = await detector.detect(bmp);
      if (detected && detected.length > 0 && detected[0].rawValue) {
        playBeep();
        triggerHaptic();
        return { success: true, result: detected[0].rawValue };
      }
    } catch (bdErr) {
      console.warn('BarcodeDetector image scan notice:', bdErr);
    }
  }

  // 3. Fallback: Html5Qrcode with isolated scratch element
  let scratchEl = document.getElementById('qr-file-scratch-box');
  if (!scratchEl) {
    scratchEl = document.createElement('div');
    scratchEl.id = 'qr-file-scratch-box';
    scratchEl.style.position = 'fixed';
    scratchEl.style.top = '-9999px';
    scratchEl.style.left = '-9999px';
    scratchEl.style.width = '600px';
    scratchEl.style.height = '600px';
    scratchEl.style.opacity = '0';
    scratchEl.style.pointerEvents = 'none';
    scratchEl.style.zIndex = '-1';
    document.body.appendChild(scratchEl);
  }

  let fileScanner = null;
  try {
    fileScanner = new Html5Qrcode('qr-file-scratch-box', {
      formatsToSupport: supportedFormats,
      experimentalFeatures: { useBarCodeDetectorIfSupported: true },
      verbose: false
    });

    let result = null;
    try {
      result = await fileScanner.scanFile(file, false);
    } catch (e1) {
      try {
        result = await fileScanner.scanFile(file, true);
      } catch (e2) {
        throw e1;
      }
    }

    if (result) {
      playBeep();
      triggerHaptic();
      return { success: true, result };
    }
    throw new Error('No QR detected');
  } catch (err) {
    console.warn('Image QR scan notice:', err);
    return { success: false, error: 'No readable QR code found in selected photo. Please ensure clear lighting and sharp focus.' };
  } finally {
    if (fileScanner) {
      try {
        await fileScanner.clear().catch(() => { });
      } catch (_) { }
    }
  }
}

