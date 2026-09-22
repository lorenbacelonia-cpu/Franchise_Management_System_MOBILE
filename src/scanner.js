import { Html5Qrcode, Html5QrcodeSupportedFormats } from 'html5-qrcode';

let html5QrcodeInstance = null;
let currentCameraId = null;
let isScanning = false;
let isStarting = false;
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
  Html5QrcodeSupportedFormats.AZTEC,
  Html5QrcodeSupportedFormats.CODE_128,
  Html5QrcodeSupportedFormats.CODE_39,
  Html5QrcodeSupportedFormats.CODE_93,
  Html5QrcodeSupportedFormats.EAN_13,
  Html5QrcodeSupportedFormats.EAN_8,
  Html5QrcodeSupportedFormats.UPC_A,
  Html5QrcodeSupportedFormats.UPC_E,
  Html5QrcodeSupportedFormats.PDF_417,
  Html5QrcodeSupportedFormats.ITF
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
 * Initialize / Auto-Resume Camera Scanner
 */
export async function initScanner(containerId = 'reader', onScanSuccessCallback) {
  if (onScanSuccessCallback) {
    currentCallback = onScanSuccessCallback;
  }

  if (isScanning) return { success: true };

  // Wait a moment for DOM layout to settle
  await new Promise(resolve => setTimeout(resolve, 80));

  const statusEl = document.getElementById('camera-status-msg');
  const allowBtn = document.getElementById('btn-allow-camera');
  const promptWrap = document.getElementById('camera-prompt-wrap');

  const updateUIStarted = () => {
    if (statusEl) statusEl.classList.add('hidden');
    if (allowBtn) allowBtn.classList.add('hidden');
    if (promptWrap) promptWrap.classList.add('hidden');
    const overlay = document.getElementById('scanner-overlay');
    if (overlay) overlay.style.display = 'flex';
  };

  const updateUIError = (err) => {
    console.warn('Camera startup notice:', err);
    if (promptWrap) promptWrap.classList.remove('hidden');
    
    // Check if insecure HTTP context
    const isSecure = window.isSecureContext || window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
    
    if (statusEl) {
      statusEl.classList.remove('hidden');
      if (!isSecure && !navigator.mediaDevices) {
        statusEl.innerHTML = '⚠️ Camera blocked by browser security.<br>Please open the HTTPS Cloudflare link or localhost.';
      } else if (err?.name === 'NotAllowedError' || err?.message?.includes('Permission')) {
        statusEl.textContent = 'Camera permission denied. Please allow camera in browser site settings.';
      } else {
        statusEl.textContent = 'Tap to allow camera access for scanning';
      }
    }

    if (allowBtn) {
      allowBtn.classList.remove('hidden');
      allowBtn.onclick = async () => {
        try {
          if (statusEl) statusEl.textContent = 'Requesting camera access...';
          // Explicitly prompt user via getUserMedia on user click
          if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
            try {
              const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
              stream.getTracks().forEach(track => track.stop());
            } catch (_) {}
          }
          await startScanner(currentCallback);
          updateUIStarted();
        } catch (e) {
          console.error('Manual start failed:', e);
          if (statusEl) {
            statusEl.textContent = 'Could not start camera: ' + (e.message || 'Permission required.');
          }
        }
      };
    }
  };

  try {
    if (!html5QrcodeInstance) {
      html5QrcodeInstance = new Html5Qrcode(containerId, {
        formatsToSupport: supportedFormats,
        experimentalFeatures: {
          useBarCodeDetectorIfSupported: true
        },
        verbose: false
      });
    }

    await startScanner(currentCallback);
    updateUIStarted();

    // Query cameras in background for switch selector
    Html5Qrcode.getCameras().then(cameras => {
      if (cameras && cameras.length > 0) {
        availableCameras = cameras;
        const switchCamBtn = document.getElementById('btn-switch-cam');
        if (switchCamBtn && cameras.length > 1) {
          switchCamBtn.classList.remove('hidden');
        }
      }
    }).catch(e => console.log('Camera list note:', e));

    return { success: true };
  } catch (err) {
    updateUIError(err);
    return { success: false, error: err };
  }
}

export async function startScanner(onScanSuccessCallback) {
  if (isScanning || isStarting) return;
  if (onScanSuccessCallback) {
    currentCallback = onScanSuccessCallback;
  }

  if (!html5QrcodeInstance) {
    html5QrcodeInstance = new Html5Qrcode('reader', {
      formatsToSupport: supportedFormats,
      experimentalFeatures: {
        useBarCodeDetectorIfSupported: true
      },
      verbose: false
    });
  }

  isStarting = true;

  const config = {
    fps: 15,
    showTorchButtonIfSupported: false
  };

  // Attempt camera starts in order of most specific to general
  const attempts = [];
  if (currentCameraId) {
    attempts.push(currentCameraId);
  }
  attempts.push({ facingMode: 'environment' });
  attempts.push({ facingMode: { ideal: 'environment' } });
  attempts.push({ facingMode: 'user' });

  let lastError = null;
  for (const cameraConfig of attempts) {
    try {
      await html5QrcodeInstance.start(
        cameraConfig,
        config,
        (decodedText, decodedResult) => {
          const now = Date.now();
          if (isProcessingScan || (decodedText === lastScannedCode && (now - lastScanTime < 2000))) {
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
              }, 1500);
            }
          }
        },
        () => {}
      );
      isScanning = true;
      isStarting = false;
      checkTorchCapability();
      return;
    } catch (err) {
      lastError = err;
      console.warn('Camera attempt failed for', cameraConfig, err);
    }
  }

  isStarting = false;
  throw lastError || new Error('Unable to start camera.');
}

export async function stopScanner() {
  if (html5QrcodeInstance && isScanning) {
    isScanning = false;
    isProcessingScan = false;
    try {
      await html5QrcodeInstance.stop();
    } catch (e) {
      console.warn('Stop scanner warning:', e);
    }
    try {
      await html5QrcodeInstance.clear().catch(() => {});
    } catch (_) {}
    html5QrcodeInstance = null;
  }
}

/**
 * Switch to next available camera
 */
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

/**
 * Scan static image file
 */
export async function scanImageFile(file) {
  try {
    const scanner = new Html5Qrcode('reader', {
      formatsToSupport: supportedFormats,
      experimentalFeatures: { useBarCodeDetectorIfSupported: true },
      verbose: false
    });
    const result = await scanner.scanFile(file, true);
    playBeep();
    triggerHaptic();
    return { success: true, result };
  } catch (err) {
    return { success: false, error: 'No readable QR code found in selected image.' };
  }
}
