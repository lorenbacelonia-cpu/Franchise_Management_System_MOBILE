import './style.css';
import { parseQRCode } from './parser.js';
import { initScanner, stopScanner, setSoundEnabled, isSoundActive, switchNextCamera, toggleTorch, scanImageFile } from './scanner.js';
import { saveScanToHistory } from './history.js';
import { fetchFranchiseByPlate, dbRowToRecord, submitViolationReport, fetchRoleNotifications, markNotificationAsRead, markAllNotificationsRead, subscribeToRealtimeStatusUpdates, deleteReportRecord, deleteFranchiseRecord } from './db.js';
import { loginUser, logoutUser, getCurrentUser, isLoggedIn, registerUser, formatFormalName, formatFormalUsername } from './auth.js';

let activeView = 'view-scan';
let currentVerifiedRecord = null;
let selectedLoginRole = 'Passenger';
let selectedSignupRole = 'Passenger';

let currentRoleNotifications = [];
let currentNotifFilter = 'all';
let notifPollInterval = null;
let realtimeUnsubscribe = null;

const ENFORCER_SHIELD_SVG = `
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">
    <path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm-1 6h2v2h-2V7zm0 4h2v6h-2v-6z"/>
  </svg>
`;

const PASSENGER_LOCK_SVG = `
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">
    <path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z"/>
  </svg>
`;

export function applyLoginRoleTheme(role) {
  selectedLoginRole = role;
  const isEnforcer = role === 'Traffic Enforcer';
  const loginCard = document.getElementById('login-card');
  const loginPassTab = document.getElementById('role-login-passenger');
  const loginEnfTab = document.getElementById('role-login-enforcer');
  const loginSubmitBtn = document.getElementById('btn-login-submit');
  const loginGiantIcon = document.getElementById('login-giant-icon');
  const loginPortalBadge = document.getElementById('login-portal-badge');
  const loginSub = document.getElementById('login-sub');

  if (loginCard) loginCard.classList.toggle('theme-enforcer', isEnforcer);
  if (loginPassTab) loginPassTab.classList.toggle('active', !isEnforcer);
  if (loginEnfTab) loginEnfTab.classList.toggle('active', isEnforcer);
  if (loginSubmitBtn) {
    loginSubmitBtn.textContent = isEnforcer ? 'LOG IN AS TRAFFIC ENFORCER' : 'LOG IN AS PASSENGER';
  }
  if (loginGiantIcon) {
    loginGiantIcon.innerHTML = isEnforcer ? ENFORCER_SHIELD_SVG : PASSENGER_LOCK_SVG;
  }
  if (loginPortalBadge) {
    loginPortalBadge.className = isEnforcer ? 'enforcer-portal-badge' : 'passenger-portal-badge';
    loginPortalBadge.textContent = isEnforcer ? '👮 TRD Law Enforcement Portal' : '👤 Passenger Verifier Portal';
  }
  if (loginSub) {
    loginSub.textContent = isEnforcer ? 'Sign in to official TRD Law Enforcement account' : 'Sign in with your TRD verifier account';
  }
}

export function applySignupRoleTheme(role) {
  selectedSignupRole = role;
  const isEnforcer = role === 'Traffic Enforcer';
  const signupCard = document.getElementById('signup-card');
  const signupPassTab = document.getElementById('role-signup-passenger');
  const signupEnfTab = document.getElementById('role-signup-enforcer');
  const signupSubmitBtn = document.getElementById('btn-signup-submit');
  const signupGiantIcon = document.getElementById('signup-giant-icon');
  const signupPortalBadge = document.getElementById('signup-portal-badge');
  const signupSub = document.getElementById('signup-sub');

  if (signupCard) signupCard.classList.toggle('theme-enforcer', isEnforcer);
  if (signupPassTab) signupPassTab.classList.toggle('active', !isEnforcer);
  if (signupEnfTab) signupEnfTab.classList.toggle('active', isEnforcer);
  if (signupSubmitBtn) {
    signupSubmitBtn.textContent = isEnforcer ? 'CREATE TRAFFIC ENFORCER ACCOUNT' : 'CREATE PASSENGER ACCOUNT';
  }
  if (signupGiantIcon) {
    signupGiantIcon.innerHTML = isEnforcer ? ENFORCER_SHIELD_SVG : PASSENGER_LOCK_SVG;
  }
  if (signupPortalBadge) {
    signupPortalBadge.className = isEnforcer ? 'enforcer-portal-badge' : 'passenger-portal-badge';
    signupPortalBadge.textContent = isEnforcer ? '👮 TRD Law Enforcement Registration' : '👤 Passenger Account Registration';
  }
  if (signupSub) {
    signupSub.textContent = isEnforcer ? 'Register official TRD Law Enforcement Officer credentials' : 'Register to access the TRD franchise system';
  }
}

document.addEventListener('DOMContentLoaded', () => {
  setupNavigation();
  setupSoundToggle();
  setupRoleTabs();
  setupPasswordToggles();
  setupLoginView();
  setupSignupView();
  setupScannerView();
  setupVerificationActions();
  setupFareMatrixView();
  setupModals();
  setupNotificationsCenter();
  setupLogout();

  // Restore logged-in state if active session exists
  if (isLoggedIn()) {
    showLoggedInState(getCurrentUser());
  } else {
    loadAndRenderNotifications();
  }

  // Scanner is the default landing page — hide app header & bottom nav initially
  const appHeader = document.getElementById('app-header');
  const bottomNav = document.querySelector('.bottom-nav');
  if (appHeader) appHeader.style.display = 'none';
  if (bottomNav) bottomNav.style.display = 'none';
  document.body.classList.add('scan-active');

  // Immediately start the camera scanner automatically on launch
  startCameraScanner().catch(err => {
    console.warn('Auto camera startup warning:', err);
  });
});

/* ==========================================================================
   Password Visibility Toggle
   ========================================================================== */
function setupPasswordToggles() {
  const toggleBtns = document.querySelectorAll('.btn-toggle-pwd');
  toggleBtns.forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const targetId = btn.getAttribute('data-target');
      const input = document.getElementById(targetId);
      if (!input) return;

      const isPassword = input.type === 'password';
      input.type = isPassword ? 'text' : 'password';

      const eyeShow = btn.querySelector('.eye-show');
      const eyeHide = btn.querySelector('.eye-hide');

      if (eyeShow) eyeShow.classList.toggle('hidden', isPassword);
      if (eyeHide) eyeHide.classList.toggle('hidden', !isPassword);
    });
  });
}

/* ==========================================================================
   Role Tabs Setup (Passenger vs Traffic Enforcer)
   ========================================================================== */
function setupRoleTabs() {
  // Login Role Tabs
  const loginPassTab = document.getElementById('role-login-passenger');
  const loginEnfTab = document.getElementById('role-login-enforcer');

  if (loginPassTab && loginEnfTab) {
    loginPassTab.addEventListener('click', () => applyLoginRoleTheme('Passenger'));
    loginEnfTab.addEventListener('click', () => applyLoginRoleTheme('Traffic Enforcer'));
  }

  // Signup Role Tabs
  const signupPassTab = document.getElementById('role-signup-passenger');
  const signupEnfTab = document.getElementById('role-signup-enforcer');

  if (signupPassTab && signupEnfTab) {
    signupPassTab.addEventListener('click', () => applySignupRoleTheme('Passenger'));
    signupEnfTab.addEventListener('click', () => applySignupRoleTheme('Traffic Enforcer'));
  }
}

/* ==========================================================================
   Navigation Router
   ========================================================================== */
function setupNavigation() {
  const navBtns = document.querySelectorAll('.bottom-nav .nav-btn');
  navBtns.forEach(btn => {
    btn.addEventListener('click', (e) => {
      if (btn.classList.contains('nav-disabled')) {
        e.preventDefault();
        showToast('⚠️ Please log in first.');
        return;
      }
      const targetId = btn.getAttribute('data-target');
      switchView(targetId);
    });
  });

  const guideStartBtn = document.getElementById('btn-guide-start-scan');
  if (guideStartBtn) {
    guideStartBtn.addEventListener('click', () => {
      switchView('view-scan');
    });
  }
}

function switchView(viewId) {
  // If user is already logged in, do not let them go to login / signup page
  if (isLoggedIn() && (viewId === 'view-login' || viewId === 'view-signup')) {
    showToast('ℹ️ You are already logged in.');
    viewId = 'view-verification';
  }

  const targetPanel = document.getElementById(viewId);
  if (!targetPanel) return;

  document.querySelectorAll('.view-panel').forEach(panel => {
    panel.classList.remove('active');
  });

  targetPanel.classList.add('active');
  activeView = viewId;

  const appHeader = document.getElementById('app-header');
  const bottomNav = document.querySelector('.bottom-nav');

  if (viewId === 'view-scan') {
    if (appHeader) appHeader.style.display = 'none';
    if (bottomNav) bottomNav.style.display = 'none';
    document.body.classList.add('scan-active');
    startCameraScanner().catch(err => {
      console.warn('Camera startup warning:', err);
    });
  } else {
    if (appHeader) appHeader.style.display = '';
    if (bottomNav) bottomNav.style.display = '';
    document.body.classList.remove('scan-active');
    stopScanner();
  }

  // Handle Verification / Record Page setup on view switch
  if (viewId === 'view-verification') {
    const emptyState = document.getElementById('verification-empty-state');
    const recordContent = document.getElementById('verification-card-content');
    if (currentVerifiedRecord) {
      if (emptyState) emptyState.classList.add('hidden');
      if (recordContent) recordContent.classList.remove('hidden');
      renderVerificationDashboard(currentVerifiedRecord);
    } else {
      if (emptyState) emptyState.classList.remove('hidden');
      if (recordContent) recordContent.classList.add('hidden');
    }
  }

  // Handle Fare Matrix Page setup on view switch
  if (viewId === 'view-fare') {
    const mode = currentVerifiedRecord?.vehicleType || currentVehicleMode;
    renderFareMatrixPage(mode);
  }

  // Update nav button highlights
  document.querySelectorAll('.bottom-nav .nav-btn').forEach(btn => {
    const t = btn.getAttribute('data-target');
    btn.classList.toggle('active', t === viewId || (viewId === 'view-signup' && t === 'view-login'));
  });
}

/* ==========================================================================
   Sound Toggle
   ========================================================================== */
function setupSoundToggle() {
  const soundBtn = document.getElementById('btn-toggle-sound');
  if (!soundBtn) return;

  const iconOn = document.getElementById('icon-sound-on');
  const iconOff = document.getElementById('icon-sound-off');

  soundBtn.addEventListener('click', () => {
    const newState = !isSoundActive();
    setSoundEnabled(newState);
    soundBtn.classList.toggle('active', newState);
    if (iconOn) iconOn.classList.toggle('hidden', !newState);
    if (iconOff) iconOff.classList.toggle('hidden', newState);
    showToast(newState ? 'Beep sound enabled' : 'Muted audio');
  });
}

/* ==========================================================================
   Login View — Real Auth with Dual Role Support
   ========================================================================== */
function setupLoginView() {
  const form = document.getElementById('login-form');
  const submitBtn = document.getElementById('btn-login-submit');
  const gotoSignupBtn = document.getElementById('btn-goto-signup');
  const linkGoSignup = document.getElementById('link-go-signup');

  if (gotoSignupBtn) gotoSignupBtn.addEventListener('click', () => switchView('view-signup'));
  if (linkGoSignup) linkGoSignup.addEventListener('click', (e) => { e.preventDefault(); switchView('view-signup'); });

  const doLogin = async (e) => {
    if (e) e.preventDefault();

    const usernameInput = document.getElementById('input-username');
    const passwordInput = document.getElementById('input-password');

    if (!usernameInput || !passwordInput) return;

    const username = usernameInput.value.trim();
    const password = passwordInput.value;

    if (!username || !password) {
      showLoginError('Please enter your username and password.');
      return;
    }

    setLoginLoading(true);

    const result = await loginUser(username, password, selectedLoginRole);

    setLoginLoading(false);

    if (!result.success) {
      showLoginError(result.error);
      return;
    }

    hideLoginError();
    usernameInput.value = '';
    passwordInput.value = '';

    showLoggedInState(result.user);
    showToast(`✅ Welcome, ${result.user.full_name || result.user.username} (${result.user.role})!`);
    switchView('view-scan');
  };

  const usernameInput = document.getElementById('input-username');
  if (usernameInput) {
    attachAutoCapitalize(usernameInput, 'first-letter');
  }

  if (form) form.addEventListener('submit', doLogin);
  if (submitBtn) submitBtn.addEventListener('click', doLogin);
}

/**
 * Auto-capitalize inputs in real-time as user types
 */
function attachAutoCapitalize(inputElement, mode = 'first-letter') {
  if (!inputElement) return;

  inputElement.addEventListener('input', () => {
    const val = inputElement.value;
    if (!val) return;

    const start = inputElement.selectionStart;
    const end = inputElement.selectionEnd;

    let formatted = val;
    if (mode === 'words') {
      // Capitalize first letter of each word (e.g. Maria Santos)
      formatted = val.replace(/(?:^|\s)\S/g, (char) => char.toUpperCase());
    } else {
      // Capitalize very first letter of string (e.g. Juan)
      formatted = val.charAt(0).toUpperCase() + val.slice(1);
    }

    if (val !== formatted) {
      inputElement.value = formatted;
      if (start !== null && end !== null) {
        inputElement.setSelectionRange(start, end);
      }
    }
  });

  inputElement.addEventListener('blur', () => {
    if (mode === 'words') {
      inputElement.value = formatFormalName(inputElement.value);
    } else {
      inputElement.value = formatFormalUsername(inputElement.value);
    }
  });
}

function showLoginError(msg) {
  const el = document.getElementById('login-error-msg');
  if (!el) return;
  el.textContent = msg;
  el.classList.remove('hidden');
}

function hideLoginError() {
  const el = document.getElementById('login-error-msg');
  if (el) el.classList.add('hidden');
}

function setLoginLoading(isLoading) {
  const btn = document.getElementById('btn-login-submit');
  if (!btn) return;
  btn.disabled = isLoading;
  btn.textContent = isLoading ? 'CHECKING...' : `LOG IN AS ${selectedLoginRole.toUpperCase()}`;
}

function forceLoginScreen() {
  switchView('view-login');
}

function showLoggedInState(user) {
  const isEnforcer = user?.role === 'Traffic Enforcer';
  
  // Apply theme class to document body and app container
  document.body.classList.toggle('user-role-enforcer', isEnforcer);
  const appEl = document.getElementById('app');
  if (appEl) appEl.classList.toggle('user-role-enforcer', isEnforcer);

  // Hide the Login / Account navigation button so logged-in users don't see the login page
  const navLoginBtn = document.getElementById('nav-btn-login');
  if (navLoginBtn) navLoginBtn.classList.add('hidden');

  // Populate & display User Profile Bar on Record Page
  const recordProfileBar = document.getElementById('record-user-profile-bar');
  if (recordProfileBar) recordProfileBar.classList.remove('hidden');

  const recordUserName = document.getElementById('record-user-name');
  if (recordUserName) {
    recordUserName.textContent = user?.full_name || user?.username || 'User';
  }

  const recordUserRole = document.getElementById('record-user-role-badge');
  if (recordUserRole) {
    const roleIcon = isEnforcer ? '👮' : '👤';
    const roleTitle = isEnforcer ? 'Traffic Enforcer' : 'Passenger';
    recordUserRole.textContent = `${roleIcon} ${roleTitle}`;
  }

  const recordUserAvatar = document.getElementById('record-user-avatar');
  if (recordUserAvatar) {
    recordUserAvatar.textContent = isEnforcer ? '👮' : '👤';
  }

  // Update header brand text and seal
  const headerSeal = document.querySelector('.lock-seal');
  if (headerSeal) {
    headerSeal.innerHTML = isEnforcer ? ENFORCER_SHIELD_SVG : PASSENGER_LOCK_SVG;
  }
  const subBadge = document.querySelector('.sub-badge');
  if (subBadge) {
    subBadge.textContent = isEnforcer ? 'Law Enforcement Division' : 'Franchise Verifier';
  }

  // Update verification card officer banner & buttons if present
  const enforcerBanner = document.getElementById('enforcer-verify-banner');
  if (enforcerBanner) enforcerBanner.classList.toggle('hidden', !isEnforcer);

  const sendReportBtn = document.getElementById('btn-send-report');
  if (sendReportBtn) {
    if (isEnforcer) {
      sendReportBtn.textContent = '👮 Issue Violation Citation';
      sendReportBtn.classList.add('btn-enforcer-action');
      sendReportBtn.classList.remove('btn-red');
    } else {
      sendReportBtn.textContent = 'Send Report';
      sendReportBtn.classList.remove('btn-enforcer-action');
      sendReportBtn.classList.add('btn-red');
    }
  }

  // Subscribe to live status updates made by Admin in Supabase Realtime
  if (realtimeUnsubscribe) {
    try { realtimeUnsubscribe(); } catch { /* ignore */ }
    realtimeUnsubscribe = null;
  }
  realtimeUnsubscribe = subscribeToRealtimeStatusUpdates(user, (payload) => {
    console.log('🔔 Live Admin status update received:', payload);
    loadAndRenderNotifications(true);
  });

  // Refresh notifications and badge counter for the logged-in role
  loadAndRenderNotifications();
}

/* ==========================================================================
   Sign Up View — Role-aware Registration
   ========================================================================== */
function setupSignupView() {
  const form = document.getElementById('signup-form');
  const submitBtn = document.getElementById('btn-signup-submit');

  const gotoLoginBtn = document.getElementById('btn-goto-login');
  const linkGoLogin = document.getElementById('link-go-login');

  if (gotoLoginBtn) gotoLoginBtn.addEventListener('click', () => switchView('view-login'));
  if (linkGoLogin) linkGoLogin.addEventListener('click', (e) => { e.preventDefault(); switchView('view-login'); });

  const doRegister = async (e) => {
    if (e) e.preventDefault();

    const fullName = document.getElementById('signup-fullname')?.value.trim();
    const username = document.getElementById('signup-username')?.value.trim();
    const password = document.getElementById('signup-password')?.value;
    const confirm = document.getElementById('signup-confirm')?.value;

    const errorEl = document.getElementById('signup-error-msg');
    const successEl = document.getElementById('signup-success-msg');

    errorEl.classList.add('hidden');
    successEl.classList.add('hidden');

    if (password !== confirm) {
      errorEl.textContent = 'Passwords do not match.';
      errorEl.classList.remove('hidden');
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = 'CREATING ACCOUNT...';

    const result = await registerUser(fullName, username, password, selectedSignupRole);

    submitBtn.disabled = false;
    submitBtn.textContent = `CREATE ${selectedSignupRole.toUpperCase()} ACCOUNT`;

    if (!result.success) {
      errorEl.textContent = result.error;
      errorEl.classList.remove('hidden');
      return;
    }

    successEl.textContent = `✅ ${selectedSignupRole} account created! Welcome, ${result.user.full_name}. Please log in.`;
    successEl.classList.remove('hidden');

    ['signup-fullname', 'signup-username', 'signup-password', 'signup-confirm'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });

    setTimeout(() => switchView('view-login'), 1500);
  };

  const fullnameInput = document.getElementById('signup-fullname');
  if (fullnameInput) {
    attachAutoCapitalize(fullnameInput, 'words');
  }

  const signupUserInput = document.getElementById('signup-username');
  if (signupUserInput) {
    attachAutoCapitalize(signupUserInput, 'first-letter');
  }

  if (form) form.addEventListener('submit', doRegister);
  if (submitBtn) submitBtn.addEventListener('click', doRegister);
}

/* ==========================================================================
   Logout
   ========================================================================== */
function setupLogout() {
  const logoutBtn = document.getElementById('btn-logout');
  if (!logoutBtn) return;

  logoutBtn.addEventListener('click', () => {
    stopScanner();
    logoutUser();
    document.body.classList.remove('user-role-enforcer');
    const appEl = document.getElementById('app');
    if (appEl) appEl.classList.remove('user-role-enforcer');

    // Hide record user profile bar
    const recordProfileBar = document.getElementById('record-user-profile-bar');
    if (recordProfileBar) recordProfileBar.classList.add('hidden');

    // Unhide the Login/Account navigation button
    const navLoginBtn = document.getElementById('nav-btn-login');
    if (navLoginBtn) navLoginBtn.classList.remove('hidden');

    const headerSeal = document.querySelector('.lock-seal');
    if (headerSeal) headerSeal.innerHTML = PASSENGER_LOCK_SVG;
    const subBadge = document.querySelector('.sub-badge');
    if (subBadge) subBadge.textContent = 'Franchise Verifier';
    const enforcerBanner = document.getElementById('enforcer-verify-banner');
    if (enforcerBanner) enforcerBanner.classList.add('hidden');

    applyLoginRoleTheme('Passenger');
    applySignupRoleTheme('Passenger');

    if (realtimeUnsubscribe) {
      try { realtimeUnsubscribe(); } catch { /* ignore */ }
      realtimeUnsubscribe = null;
    }

    currentRoleNotifications = [];
    updateNotificationBadges(0);

    showToast('Logged out successfully.');
    switchView('view-login');
  });
}

/* ==========================================================================
   Scanner View (Unified Universal Scanner)
   ========================================================================== */
function setupScannerView() {
  const scanLockBtn = document.getElementById('btn-scan-lock');
  if (scanLockBtn) {
    scanLockBtn.addEventListener('click', () => {
      if (isLoggedIn()) {
        switchView('view-verification');
      } else {
        switchView('view-login');
      }
    });
  }

  const backBtn = document.getElementById('btn-scan-back');
  if (backBtn) {
    backBtn.addEventListener('click', () => {
      stopScanner();
      if (isLoggedIn()) {
        switchView('view-verification');
      } else {
        switchView('view-login');
      }
    });
  }

  const menuBtn = document.getElementById('btn-scan-menu');
  if (menuBtn) {
    menuBtn.addEventListener('click', () => {
      if (isLoggedIn()) {
        switchView('view-instructions');
      } else {
        switchView('view-login');
      }
    });
  }

  const switchCamBtn = document.getElementById('btn-switch-cam');
  if (switchCamBtn) {
    switchCamBtn.addEventListener('click', async () => {
      showToast('🔄 Switching camera...');
      await switchNextCamera();
    });
  }

  const uploadBtn = document.getElementById('btn-upload-qr');
  const fileInput = document.getElementById('qr-file-input');
  if (uploadBtn && fileInput) {
    uploadBtn.addEventListener('click', () => {
      fileInput.click();
    });

    fileInput.addEventListener('change', async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      showToast('🔍 Analyzing image...');
      const res = await scanImageFile(file);
      if (res.success && res.result) {
        handleScannedCode(res.result);
      } else {
        showToast(res.error || 'No QR code found in photo.');
      }
      fileInput.value = '';
    });
  }
}

async function startCameraScanner() {
  const permMsg = document.getElementById('camera-permission-msg');
  if (permMsg) permMsg.classList.add('hidden');

  await initScanner('reader', (rawText) => {
    handleScannedCode(rawText);
  });
}

/* ==========================================================================
   QR Scan → Dynamic Universal Parsing & Supabase Verification
   ========================================================================== */
async function handleScannedCode(rawText) {
  if (!rawText) return;

  console.log('SCANNED RAW CODE:', rawText);
  showToast('🔍 Verifying QR Code with Database...');

  // 1. Universal Dynamic QR Code Parsing (detects Pedicab or Tricycle automatically)
  let record = parseQRCode(rawText);
  let isFoundInDb = false;

  // 2. Check Supabase database across all admin tables for live verified records
  try {
    const dbRow = await fetchFranchiseByPlate(record.plateNo, rawText);
    if (dbRow) {
      record = dbRowToRecord(dbRow, rawText);
      isFoundInDb = true;
    } else {
      record.fromDatabase = false;
      record.status = 'Not Registered';
      record.availability = 'Not in TRD Database';
    }
  } catch (err) {
    console.warn('Database lookup notice:', err);
  }

  currentVerifiedRecord = record;
  saveScanToHistory(record);
  renderVerificationDashboard(record);

  if (isFoundInDb) {
    showToast(`✅ Verified Active ${record.vehicleType || 'Franchise'} Unit (${record.plateNo})`);
  } else {
    showToast(`⚠️ Unit ${record.plateNo || 'QR'} not in TRD Database (Unregistered or Removed)`);
  }
  switchView('view-verification');
}

/* ==========================================================================
   Verification Dashboard
   ========================================================================== */
function renderVerificationDashboard(record) {
  const emptyState = document.getElementById('verification-empty-state');
  const recordContent = document.getElementById('verification-card-content');

  if (!record) {
    if (emptyState) emptyState.classList.remove('hidden');
    if (recordContent) recordContent.classList.add('hidden');
    return;
  }

  if (emptyState) emptyState.classList.add('hidden');
  if (recordContent) recordContent.classList.remove('hidden');

  const vehicleType = record.vehicleType || 'Pedicab';
  const isPedicab = vehicleType.toLowerCase() === 'pedicab';
  const isLiveInDb = Boolean(record.fromDatabase);

  const titleEl = document.getElementById('verified-vehicle-title');
  if (titleEl) {
    titleEl.textContent = isLiveInDb 
      ? `${vehicleType} Verified Unit (TRD Database)`
      : `${vehicleType} Unregistered Unit (Not in Database)`;
  }

  const opEl = document.getElementById('val-operator');
  if (opEl) opEl.textContent = record.operator || '—';

  const drEl = document.getElementById('val-driver');
  if (drEl) drEl.textContent = record.driver || '—';

  const plEl = document.getElementById('val-plate');
  if (plEl) plEl.textContent = record.plateNo || '—';

  const rtEl = document.getElementById('val-route');
  if (rtEl) rtEl.textContent = record.route || 'Tabaco City Route';

  const expEl = document.getElementById('val-expiry');
  if (expEl) expEl.textContent = record.expiry || '2026-12-31';

  const tourEl = document.getElementById('val-tourist');
  if (tourEl) tourEl.textContent = `• ${record.touristGuide || 'Yes'}`;

  const availEl = document.getElementById('val-availability');
  if (availEl) {
    availEl.textContent = isLiveInDb ? (record.availability || 'Available') : '⚠️ Not in TRD Database';
    availEl.style.color = isLiveInDb ? '#059669' : '#dc2626';
  }

  const user = getCurrentUser();
  const isEnforcer = user?.role === 'Traffic Enforcer';
  const enforcerBanner = document.getElementById('enforcer-verify-banner');
  if (enforcerBanner) enforcerBanner.classList.toggle('hidden', !isEnforcer);

  const sendReportBtn = document.getElementById('btn-send-report');
  if (sendReportBtn) {
    if (isEnforcer) {
      sendReportBtn.textContent = '👮 Issue Violation Citation';
      sendReportBtn.classList.add('btn-enforcer-action');
      sendReportBtn.classList.remove('btn-red');
    } else {
      sendReportBtn.textContent = 'Send Report';
      sendReportBtn.classList.remove('btn-enforcer-action');
      sendReportBtn.classList.add('btn-red');
    }
  }

  const iconEl = document.getElementById('vehicle-type-icon');
  if (iconEl) {
    if (isPedicab) {
      iconEl.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"
        stroke="currentColor" stroke-width="2" width="18" height="18">
        <circle cx="5.5" cy="17.5" r="3.5"/>
        <circle cx="18.5" cy="17.5" r="3.5"/>
        <path d="M15 6h-5l-3 8h11l-3-8z"/>
        <path d="M15 6l3 5"/>
      </svg>`;
    } else {
      iconEl.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"
        stroke="currentColor" stroke-width="2" width="18" height="18">
        <rect x="1" y="3" width="15" height="13" rx="2"/>
        <path d="M16 8h4l3 5v3h-7V8z"/>
        <circle cx="5.5" cy="18.5" r="2.5"/>
        <circle cx="18.5" cy="18.5" r="2.5"/>
      </svg>`;
    }
  }
}

function setupVerificationActions() {
  const emptyScanBtn = document.getElementById('btn-empty-start-scan');
  if (emptyScanBtn) {
    emptyScanBtn.addEventListener('click', () => {
      switchView('view-scan');
    });
  }

  const viewFareBtn = document.getElementById('btn-view-fare');
  if (viewFareBtn) {
    viewFareBtn.addEventListener('click', () => {
      switchView('view-fare');
    });
  }

  const sendReportBtn = document.getElementById('btn-send-report');
  if (sendReportBtn) {
    sendReportBtn.addEventListener('click', () => {
      const user = getCurrentUser();
      const isEnforcer = user?.role === 'Traffic Enforcer';
      openReportModalForCurrentUser(isEnforcer ? 'violation' : 'overcharging', isEnforcer ? 'Official Overcharging Citation' : 'Report Overcharging');
    });
  }

  const rescanBtn = document.getElementById('btn-rescan-code');
  if (rescanBtn) {
    rescanBtn.addEventListener('click', () => {
      switchView('view-scan');
    });
  }
}

/* ==========================================================================
   VIEW STANDARD FARE PAGE (1:1 FIGMA MATCH)
   ========================================================================== */
const pedicabFareData = [
  { col1: 'Short Distance (Base)', regular: '20.00 php', student: '15.00 php', senior: '15.00 php' },
  { col1: 'Longer Distance (Inter-Brgy)', regular: '25.00 php', student: '22.00 php', senior: '20.00 php' },
  { col1: 'Special Trip (Pakyaw)', regular: '32.00 php', student: '30.00 php', senior: '28.00 php' },
];

const tricycleFareData = [
  { col1: 'Sua-Igot to BTC', regular: '20.00 php', student: '15.00 php', senior: '15.00 php' },
  { col1: 'Sua-Igot to Tabaco', regular: '25.00 php', student: '22.00 php', senior: '20.00 php' },
  { col1: 'Oras', regular: '32.00 php', student: '30.00 php', senior: '28.00 php' },
  { col1: '', regular: '', student: '', senior: '' },
];

function renderFareMatrixPage(vehicleTypeMode, searchQuery = '') {
  const mode = vehicleTypeMode || currentVerifiedRecord?.vehicleType || 'Pedicab';
  const isPedicab = (mode || 'pedicab').toString().toLowerCase().includes('pedicab');

  const subtitleEl = document.getElementById('fare-subtitle');
  if (subtitleEl) {
    subtitleEl.textContent = isPedicab
      ? 'Barangay / Local Area Rates (Tabaco City)'
      : 'Ordinance Prescribing the New Fare Rates for Tricycles-for-Hire in the City of Tabaco.';
  }

  const pillEl = document.getElementById('fare-matrix-pill');
  if (pillEl) {
    pillEl.textContent = isPedicab ? 'Pedicab Standard Fare Matrix' : 'Tricycle Standard Fare Matrix';
  }

  const noteEl = document.getElementById('tricycle-fare-note');
  if (noteEl) {
    noteEl.classList.toggle('hidden', isPedicab);
  }

  const headerRow = document.getElementById('fare-table-header-row');
  if (headerRow) {
    headerRow.innerHTML = isPedicab
      ? '<th>Distance / Zone</th><th>Regular Fare</th><th>Student</th><th>Senior/PWD</th>'
      : '<th>Route (From-To)</th><th>Regular Fare</th><th>Student</th><th>Senior/PWD</th>';
  }

  const tbody = document.getElementById('fare-table-body');
  if (tbody) {
    let rows = [];

    // 1. Check if the verified record has a custom fare matrix from Supabase DB
    if (currentVerifiedRecord?.fareMatrix && Array.isArray(currentVerifiedRecord.fareMatrix) && currentVerifiedRecord.fareMatrix.length > 0) {
      rows = currentVerifiedRecord.fareMatrix.map(item => ({
        col1: item.destination || item.route || 'Route',
        regular: item.regularFare ? `₱${item.regularFare}.00` : (item.regular || '₱20.00'),
        student: item.discountedFare ? `₱${item.discountedFare}.00` : (item.student || '₱16.00'),
        senior: item.discountedFare ? `₱${item.discountedFare}.00` : (item.senior || '₱16.00')
      }));
    } else {
      // 2. Default standard ordinance table
      rows = isPedicab ? pedicabFareData : tricycleFareData;
    }

    // Apply search filter if query is typed
    const q = (searchQuery || '').trim().toLowerCase();
    if (q) {
      rows = rows.filter(r => (r.col1 || '').toLowerCase().includes(q));
    }

    if (rows.length === 0) {
      tbody.innerHTML = `<tr><td colspan="4" style="text-align:center; padding:18px; color:#64748b;">No matching routes found</td></tr>`;
    } else {
      tbody.innerHTML = rows.map(row => `
        <tr>
          <td><strong>${row.col1}</strong></td>
          <td>${row.regular}</td>
          <td>${row.student}</td>
          <td>${row.senior}</td>
        </tr>
      `).join('');
    }
  }
}

function setupFareMatrixView() {
  const backBtn = document.getElementById('btn-fare-back');
  if (backBtn) {
    backBtn.addEventListener('click', () => {
      switchView(currentVerifiedRecord ? 'view-verification' : 'view-scan');
    });
  }

  const backDashBtn = document.getElementById('btn-fare-back-dashboard');
  if (backDashBtn) {
    backDashBtn.addEventListener('click', () => {
      switchView(currentVerifiedRecord ? 'view-verification' : 'view-scan');
    });
  }

  const driverInfoBtn = document.getElementById('btn-fare-driver-info');
  if (driverInfoBtn) {
    driverInfoBtn.addEventListener('click', () => {
      switchView('view-verification');
    });
  }

  const violationBtn = document.getElementById('btn-fare-violation');
  if (violationBtn) {
    violationBtn.addEventListener('click', () => {
      openReportModalForCurrentUser('violation', 'Official Violation');
    });
  }

  const overchargingBtn = document.getElementById('btn-fare-overcharging');
  if (overchargingBtn) {
    overchargingBtn.addEventListener('click', () => {
      openReportModalForCurrentUser('overcharging', 'Report Overcharging');
    });
  }

  const searchInput = document.getElementById('fare-search-input');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      renderFareMatrixPage(currentVerifiedRecord?.vehicleType, e.target.value);
    });
  }
}

/* ==========================================================================
   REPORT / CITATION FILE ATTACHMENT CONTROLLER
   ========================================================================== */
let currentReportAttachment = null;

function formatFileSize(bytes) {
  if (!bytes || bytes === 0) return '0 KB';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

/**
 * High-performance browser image compressor using HTML5 Canvas.
 * Downscales ultra-high-resolution phone photos to a maximum width/height of 1200px
 * and compresses to lightweight JPEG, reducing 5MB+ camera photos to ~70-150KB.
 */
function compressImage(file, maxWidth = 1200, quality = 0.82) {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = (e) => resolve({ dataUrl: e.target.result, size: file.size });
      reader.onerror = reject;
      reader.readAsDataURL(file);
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        let width = img.width;
        let height = img.height;

        if (width > maxWidth || height > maxWidth) {
          if (width > height) {
            height = Math.round((height * maxWidth) / width);
            width = maxWidth;
          } else {
            width = Math.round((width * maxWidth) / height);
            height = maxWidth;
          }
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);

        const dataUrl = canvas.toDataURL('image/jpeg', quality);
        // Estimate byte size from Base64 string
        const base64Length = dataUrl.length - (dataUrl.indexOf(',') + 1);
        const approxBytes = Math.round((base64Length * 3) / 4);

        resolve({ dataUrl, size: approxBytes });
      };
      img.onerror = () => {
        // Fallback to raw dataUrl if image decoding fails
        resolve({ dataUrl: event.target.result, size: file.size });
      };
      img.src = event.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function handleSelectedAttachmentFile(file) {
  if (!file) return;

  // Maximum file size check (15MB before compression)
  if (file.size > 15 * 1024 * 1024) {
    showToast('⚠️ File is too large. Please select a file under 15MB.');
    return;
  }

  showToast('📎 Processing attachment...');

  try {
    const isImage = file.type.startsWith('image/');
    const { dataUrl, size } = await compressImage(file);

    currentReportAttachment = {
      name: file.name,
      size: size || file.size,
      sizeFormatted: formatFileSize(size || file.size),
      type: file.type || 'application/octet-stream',
      isImage,
      dataUrl
    };

    // Render Preview
    const previewContainer = document.getElementById('report-attachment-preview');
    const previewImg = document.getElementById('preview-image');
    const previewDocIcon = document.getElementById('preview-doc-icon');
    const previewFilename = document.getElementById('preview-filename');
    const previewFilesize = document.getElementById('preview-filesize');
    const sectionContainer = document.getElementById('report-attachment-section');

    if (previewFilename) previewFilename.textContent = file.name;
    if (previewFilesize) previewFilesize.textContent = currentReportAttachment.sizeFormatted;

    if (isImage) {
      if (previewImg) {
        previewImg.src = dataUrl;
        previewImg.classList.remove('hidden');
      }
      if (previewDocIcon) previewDocIcon.classList.add('hidden');
    } else {
      if (previewImg) previewImg.classList.add('hidden');
      if (previewDocIcon) previewDocIcon.classList.remove('hidden');
    }

    if (previewContainer) previewContainer.classList.remove('hidden');
    if (sectionContainer) sectionContainer.classList.add('has-file');

    showToast(`✓ Attached: ${file.name}`);
  } catch (err) {
    console.error('Error attaching file:', err);
    showToast('❌ Failed to process file. Please try another photo.');
  }
}

function clearReportAttachment() {
  currentReportAttachment = null;

  const fileInput = document.getElementById('report-file-input');
  const cameraInput = document.getElementById('report-camera-input');
  if (fileInput) fileInput.value = '';
  if (cameraInput) cameraInput.value = '';

  const previewContainer = document.getElementById('report-attachment-preview');
  const previewImg = document.getElementById('preview-image');
  const sectionContainer = document.getElementById('report-attachment-section');

  if (previewImg) previewImg.src = '';
  if (previewContainer) previewContainer.classList.add('hidden');
  if (sectionContainer) sectionContainer.classList.remove('has-file');
}

/* ==========================================================================
   ROLE-BASED VIOLATION REPORTING MODAL PERMISSIONS
   ========================================================================== */
function openReportModalForCurrentUser(reportCategory = 'overcharging', defaultType = null) {
  const isViolationCategory = reportCategory === 'violation';

  // 1. MANDATORY LOGIN CHECK
  if (!isLoggedIn()) {
    if (isViolationCategory) {
      showToast('⚠️ Only Traffic Enforcers can issue Violation Citations. Please log in.');
      applyLoginRoleTheme('Traffic Enforcer');
    } else {
      showToast('⚠️ Please log in first to file a report.');
    }
    switchView('view-login');
    return;
  }

  const user = getCurrentUser();
  const isEnforcer = user?.role === 'Traffic Enforcer';

  // 2. PERMISSION RULE: VIOLATIONS ARE EXCLUSIVELY FOR TRAFFIC ENFORCERS
  if (isViolationCategory && !isEnforcer) {
    showToast('⛔ Access Restricted: Only Traffic Enforcers are authorized to issue official Violation Citations.');
    return;
  }

  // 3. Reset any previous file attachment state
  clearReportAttachment();

  // 4. CONFIGURE & OPEN REPORT FORM
  const modalEl = document.getElementById('report-modal');
  const titleEl = document.getElementById('report-modal-title');
  const userRoleText = document.getElementById('report-user-role');
  const reportRoleBadge = document.getElementById('report-role-badge');
  const reportTypeSelect = document.getElementById('report-type');

  if (modalEl) {
    modalEl.classList.toggle('theme-enforcer-modal', isEnforcer);
  }

  if (titleEl) {
    if (isEnforcer) {
      titleEl.textContent = isViolationCategory ? 'Official TRD Traffic Citation' : 'Official TRD Overcharging Citation';
    } else {
      titleEl.textContent = 'Submit Passenger Overcharging Report';
    }
  }

  if (userRoleText) {
    userRoleText.textContent = `${user?.role || 'Passenger'}: ${user?.full_name || user?.username}`;
  }

  if (reportRoleBadge) {
    reportRoleBadge.classList.toggle('enforcer', isEnforcer);
  }

  const targetPlateEl = document.getElementById('report-target-plate');
  if (targetPlateEl) {
    targetPlateEl.textContent = currentVerifiedRecord?.plateNo || '—';
  }

  // Pre-fill scanned unit banner details from live scan
  const bannerTypeBadge = document.getElementById('report-banner-type-badge');
  const bannerPlate = document.getElementById('report-banner-plate');
  const bannerDriver = document.getElementById('report-banner-driver');
  const bannerStatus = document.getElementById('report-banner-status');

  if (bannerTypeBadge) bannerTypeBadge.textContent = currentVerifiedRecord?.vehicleType || 'Pedicab';
  if (bannerPlate) bannerPlate.textContent = `Plate: ${currentVerifiedRecord?.plateNo || '—'}`;
  if (bannerDriver) bannerDriver.textContent = `Driver: ${currentVerifiedRecord?.driver || 'Official Driver'}`;
  if (bannerStatus) bannerStatus.textContent = currentVerifiedRecord?.status === 'Active' ? '✓ Verified Unit' : '✓ Scanned Unit';

  // Customize file attachment labels according to user role
  const attachLabel = document.getElementById('report-attachment-label-text');
  const cameraBtnText = document.getElementById('btn-camera-text');
  const uploadBtnText = document.getElementById('btn-upload-text');

  if (attachLabel) {
    attachLabel.textContent = isEnforcer ? 'Attach Photo of Evidence (PNG / JPEG)' : 'Attach Proof / Fare Receipt';
  }
  if (cameraBtnText) {
    cameraBtnText.textContent = isEnforcer ? '📷 Snap Evidence Photo' : 'Take Photo';
  }
  if (uploadBtnText) {
    uploadBtnText.textContent = isEnforcer ? '📁 Upload Photo Evidence' : 'Upload Receipt / File';
  }

  if (reportTypeSelect) {
    if (isEnforcer) {
      reportTypeSelect.innerHTML = `
        <option value="Illegal Route / Out of Line">Illegal Route / Out of Line Operation</option>
        <option value="No Franchise / Expired Permit">No Franchise / Expired TRD Permit</option>
        <option value="Official Overcharging Citation">Official Overcharging Citation</option>
        <option value="Obstruction of Traffic">Obstruction of Traffic / Illegal Parking</option>
        <option value="Refusal of Public Transport">Refusal of Public Transport Service</option>
      `;
    } else {
      reportTypeSelect.innerHTML = `
        <option value="Report Overcharging">Report Overcharging (Excess Fare)</option>
        <option value="Fare Complaint">Submit Fare Complaint / Discourtesy</option>
        <option value="Driver Conduct">Driver Conduct / Refusal to Convey</option>
      `;
    }
  }

  const enforcerBadgeWrap = document.getElementById('field-enforcer-badge-wrap');
  const citationWrap = document.getElementById('field-citation-wrap');
  const fareWrap = document.getElementById('field-fare-wrap');
  const submitBtn = document.getElementById('btn-report-submit');

  // Enforcer does NOT need manual badge or manual driver input (already scanned)
  if (enforcerBadgeWrap) enforcerBadgeWrap.classList.add('hidden');
  if (citationWrap) citationWrap.classList.add('hidden');
  if (fareWrap) fareWrap.classList.toggle('hidden', isEnforcer);

  if (submitBtn) {
    submitBtn.classList.toggle('modal-enforcer-btn', isEnforcer);
    submitBtn.textContent = isEnforcer ? 'Attach Image' : 'Submit Report to TRD Office';
  }

  document.getElementById('report-modal').classList.remove('hidden');
}

/* ==========================================================================
   Modals
   ========================================================================== */
function setupModals() {
  const closeFareBtn = document.getElementById('btn-close-fare');
  if (closeFareBtn) closeFareBtn.addEventListener('click', () => {
    document.getElementById('fare-modal').classList.add('hidden');
  });

  const closeReportBtn = document.getElementById('btn-close-report');
  if (closeReportBtn) closeReportBtn.addEventListener('click', () => {
    clearReportAttachment();
    document.getElementById('report-modal').classList.add('hidden');
  });

  // Camera & File Attachment Listeners
  const btnCamera = document.getElementById('btn-report-camera');
  const btnUpload = document.getElementById('btn-report-upload');
  const cameraInput = document.getElementById('report-camera-input');
  const fileInput = document.getElementById('report-file-input');
  const btnRemoveAttach = document.getElementById('btn-remove-attachment');

  if (btnCamera && cameraInput) {
    btnCamera.addEventListener('click', () => {
      cameraInput.click();
    });
    cameraInput.addEventListener('change', (e) => {
      const file = e.target.files?.[0];
      if (file) handleSelectedAttachmentFile(file);
    });
  }

  if (btnUpload && fileInput) {
    btnUpload.addEventListener('click', () => {
      fileInput.click();
    });
    fileInput.addEventListener('change', (e) => {
      const file = e.target.files?.[0];
      if (file) handleSelectedAttachmentFile(file);
    });
  }

  if (btnRemoveAttach) {
    btnRemoveAttach.addEventListener('click', () => {
      clearReportAttachment();
      showToast('Attachment removed.');
    });
  }

  const reportForm = document.getElementById('report-form');
  if (reportForm) reportForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const user = getCurrentUser();
    const roleName = user?.role || 'Passenger';
    const isEnforcer = roleName === 'Traffic Enforcer';

    const reportType = document.getElementById('report-type')?.value || (isEnforcer ? 'Official Violation Citation' : 'Overcharging / Excess Fare');
    const actualFare = parseFloat(document.getElementById('report-actual-fare')?.value) || null;
    const enforcerBadge = document.getElementById('report-enforcer-id')?.value || '';
    const citationNo = document.getElementById('report-citation-no')?.value || '';
    const remarks = document.getElementById('report-remarks')?.value || '';

    const payload = {
      report_type: reportType,
      plate_no: currentVerifiedRecord?.plateNo || '1243',
      driver_name: currentVerifiedRecord?.driver || 'Salvador B. Bacelonia',
      vehicle_type: currentVerifiedRecord?.vehicleType || 'Pedicab',
      reporter_name: user?.full_name || user?.username || (isEnforcer ? 'TRD Enforcer' : 'Passenger'),
      reporter_username: user?.username || '',
      reporter_role: roleName,
      fare_charged: actualFare,
      enforcer_badge: enforcerBadge || (isEnforcer ? (user?.username ? `TRD-ENF-${user.username}` : 'TRD-ENF-001') : ''),
      citation_no: citationNo,
      description: remarks,
      attachment: currentReportAttachment
    };

    try {
      await submitViolationReport(payload);
    } catch (err) {
      console.warn('Submit report background note:', err);
    }

    // Success dialog setup
    const successModal = document.getElementById('success-modal');
    const successTitle = document.getElementById('success-modal-title');
    const successSub = document.getElementById('success-modal-sub');
    const successAttachInfo = document.getElementById('success-attachment-info');
    const successAttachText = document.getElementById('success-attachment-text');

    if (successTitle) {
      successTitle.textContent = isEnforcer ? 'Citation Registered' : 'Report Submitted';
    }
    if (successSub) {
      successSub.textContent = isEnforcer
        ? `Traffic citation ticket recorded for ${payload.vehicle_type} Plate #${payload.plate_no}.`
        : `Your complaint has been registered with Tabaco City TRD Office.`;
    }

    if (successAttachInfo && successAttachText) {
      if (currentReportAttachment?.name) {
        successAttachText.textContent = `📎 1 Attachment Included: ${currentReportAttachment.name}`;
        successAttachInfo.classList.remove('hidden');
      } else {
        successAttachInfo.classList.add('hidden');
      }
    }

    // Hide report modal and show success modal
    document.getElementById('report-modal').classList.add('hidden');
    if (successModal) successModal.classList.remove('hidden');

    showToast(`✅ ${roleName} report submitted with attachment.`);
    clearReportAttachment();

    // Immediately refresh status notifications for this user
    loadAndRenderNotifications(true);
  });

  const closeSuccessBtn = document.getElementById('btn-close-success');
  if (closeSuccessBtn) closeSuccessBtn.addEventListener('click', () => {
    document.getElementById('success-modal').classList.add('hidden');
  });
}

/* ==========================================================================
   ROLE-BASED STATUS NOTIFICATIONS CONTROLLER
   ========================================================================== */

function setupNotificationsCenter() {
  // 1. Header notification button
  const btnHeaderNotifs = document.getElementById('btn-header-notifs');
  if (btnHeaderNotifs) btnHeaderNotifs.addEventListener('click', () => openNotificationsModal());

  // 2. Modal close buttons
  const btnCloseNotifs = document.getElementById('btn-close-notifs');
  const btnDismissNotifs = document.getElementById('btn-dismiss-notifs');

  if (btnCloseNotifs) btnCloseNotifs.addEventListener('click', () => closeNotificationsModal());
  if (btnDismissNotifs) btnDismissNotifs.addEventListener('click', () => closeNotificationsModal());

  // 3. Refresh button
  const btnRefreshNotifs = document.getElementById('btn-refresh-notifs');
  if (btnRefreshNotifs) {
    btnRefreshNotifs.addEventListener('click', async () => {
      btnRefreshNotifs.style.transform = 'rotate(360deg)';
      btnRefreshNotifs.style.transition = 'transform 0.5s ease';
      showToast('🔄 Refreshing status notifications...');
      await loadAndRenderNotifications(false);
      setTimeout(() => {
        btnRefreshNotifs.style.transform = '';
        btnRefreshNotifs.style.transition = '';
      }, 500);
    });
  }

  // 4. Mark all as read
  const btnMarkAll = document.getElementById('btn-mark-all-read');
  if (btnMarkAll) {
    btnMarkAll.addEventListener('click', () => {
      const allIds = currentRoleNotifications.map(n => n.id);
      markAllNotificationsRead(allIds);
      currentRoleNotifications.forEach(n => { n.isRead = true; });
      updateNotificationBadges(0);
      renderNotificationsList();
      showToast('✓ All notifications marked as read.');
    });
  }

  // 5. Filter tabs
  const filterTabs = document.querySelectorAll('.notif-filter-tabs .notif-tab');
  filterTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      filterTabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      currentNotifFilter = tab.getAttribute('data-filter') || 'all';
      renderNotificationsList();
    });
  });

  // 6. Live floating status banner handlers
  const bannerCloseBtn = document.getElementById('btn-banner-close');
  const liveBanner = document.getElementById('live-status-banner');
  if (bannerCloseBtn) {
    bannerCloseBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (liveBanner) liveBanner.classList.add('hidden');
    });
  }
  if (liveBanner) {
    liveBanner.addEventListener('click', () => {
      liveBanner.classList.add('hidden');
      openNotificationsModal();
    });
  }

  // 7. Periodic background refresh (every 25 seconds for live status updates)
  if (notifPollInterval) clearInterval(notifPollInterval);
  notifPollInterval = setInterval(() => {
    if (isLoggedIn()) {
      loadAndRenderNotifications(false);
    }
  }, 25000);
}

/**
 * Open Notifications Modal with Role-Specific Styling & Data
 * When opened (user clicks notif button), automatically marks all notifications as READ
 * and clears the unread badge from the top bar.
 */
async function openNotificationsModal() {
  const modal = document.getElementById('notifications-modal');
  if (!modal) return;

  const user = getCurrentUser();
  const isEnforcer = user?.role === 'Traffic Enforcer';

  // Customize modal header by role
  const modalTitle = document.getElementById('notif-modal-title');
  const modalSub = document.getElementById('notif-modal-sub');
  const roleBadge = document.getElementById('notif-role-badge');

  if (roleBadge) {
    roleBadge.className = isEnforcer ? 'notif-header-badge enforcer' : 'notif-header-badge';
    roleBadge.textContent = isEnforcer ? '👮 TRD Law Enforcement Status' : '👤 Passenger Report Status';
  }

  if (modalTitle) {
    if (isEnforcer) {
      modalTitle.textContent = 'Officer Citations & Violations Status';
    } else {
      modalTitle.textContent = 'My Reports & Complaints Status';
    }
  }

  if (modalSub) {
    if (isEnforcer) {
      modalSub.textContent = `Tracking review, hearings, & settlements for citations issued by ${user?.full_name || user?.username || 'Officer'}`;
    } else {
      modalSub.textContent = 'Live tracking of your filed overcharging & service reports with TRD Office';
    }
  }

  modal.classList.remove('hidden');

  // 1. Load latest notifications from database
  await loadAndRenderNotifications(false);

  // 2. Mark all currently loaded notifications as read because user clicked the button
  const allIds = currentRoleNotifications.map(n => n.id);
  if (allIds.length > 0) {
    markAllNotificationsRead(allIds);
    currentRoleNotifications.forEach(n => { n.isRead = true; });
    updateNotificationBadges(0);
    renderNotificationsList();
  }
}

function closeNotificationsModal() {
  const modal = document.getElementById('notifications-modal');
  if (modal) modal.classList.add('hidden');
}

/**
 * Load and render live status notifications for the current role
 */
async function loadAndRenderNotifications(notifyIfNew = false) {
  const user = getCurrentUser() || { role: selectedLoginRole || 'Passenger', username: 'Guest' };
  
  try {
    const list = await fetchRoleNotifications(user);
    const previousUnread = currentRoleNotifications.filter(n => !n.isRead).length;
    currentRoleNotifications = list;

    // Calculate unread count and filter counts using stepProgress >= 4 and status patterns
    const isResolvedItem = (n) => (n.stepProgress >= 4) || /resolved|settled|cleared|closed|dismiss|complete|done|paid|sanction|action taken/i.test(n.status || '');
    const unreadCount = list.filter(n => !n.isRead).length;
    const allCount = list.length;
    const pendingCount = list.filter(n => !isResolvedItem(n)).length;
    const resolvedCount = list.filter(n => isResolvedItem(n)).length;

    // Update tab badges
    const tabAll = document.getElementById('tab-count-all');
    const tabPending = document.getElementById('tab-count-pending');
    const tabResolved = document.getElementById('tab-count-resolved');

    if (tabAll) tabAll.textContent = `(${allCount})`;
    if (tabPending) tabPending.textContent = `(${pendingCount})`;
    if (tabResolved) tabResolved.textContent = `(${resolvedCount})`;

    // Update global badge counters
    updateNotificationBadges(unreadCount);

    // Render list into modal
    renderNotificationsList();

    // Show live floating banner if new notification arrived
    if (notifyIfNew && list.length > 0) {
      const topNotif = list[0];
      showLiveStatusBanner(
        topNotif.title || 'Status Notification',
        `${topNotif.subtitle} • Status: ${topNotif.status}`,
        topNotif.id
      );
    }
  } catch (err) {
    console.warn('Error loading notifications:', err);
  }
}

/**
 * Update UI notification bubble badge on top header
 */
function updateNotificationBadges(count) {
  const headerBadge = document.getElementById('header-notif-badge');
  if (!headerBadge) return;

  const displayCount = count > 99 ? '99+' : String(count);

  if (count > 0) {
    headerBadge.textContent = displayCount;
    headerBadge.classList.remove('hidden');
  } else {
    headerBadge.classList.add('hidden');
  }
}

/**
 * Render notification cards feed into the modal
 */
function renderNotificationsList() {
  const container = document.getElementById('notifications-list');
  if (!container) return;

  const isResolvedItem = (n) => (n.stepProgress >= 4) || /resolved|settled|cleared|closed|dismiss|complete|done|paid|sanction|action taken/i.test(n.status || '');

  // Filter list
  let items = [...currentRoleNotifications];
  if (currentNotifFilter === 'pending') {
    items = items.filter(n => !isResolvedItem(n));
  } else if (currentNotifFilter === 'resolved') {
    items = items.filter(n => isResolvedItem(n));
  }

  if (items.length === 0) {
    const user = getCurrentUser();
    const isEnforcer = user?.role === 'Traffic Enforcer';
    const accountName = user?.full_name || user?.username || 'this account';

    container.innerHTML = `
      <div class="notif-empty-card">
        <div class="notif-empty-icon">${isEnforcer ? '🛡️' : '📋'}</div>
        <div class="notif-empty-title">No ${currentNotifFilter === 'all' ? '' : currentNotifFilter} Status Updates</div>
        <div class="notif-empty-desc">
          ${isEnforcer 
            ? `No citations found for Officer ${accountName}. When you issue official violation citations, their TRD review, hearing, and settlement statuses will be tracked here.` 
            : `No reports submitted by ${accountName} yet. When you submit an overcharging report or fare complaint, its official TRD investigation status will appear here.`}
        </div>
      </div>
    `;
    return;
  }

  const user = getCurrentUser();
  const isEnforcer = user?.role === 'Traffic Enforcer';

  container.innerHTML = items.map(item => {
    const isUnread = !item.isRead;
    const cardStatusClass = `status-${item.statusType || 'warning'}`;
    const badgeClass = `badge-${item.statusType || 'warning'}`;

    // 4-Step Progress definition
    const step1Label = isEnforcer ? 'Issued' : 'Filed';
    const step2Label = isEnforcer ? 'TRD Review' : 'Under Review';
    const step3Label = isEnforcer ? 'Hearing' : 'Investigation';
    const step4Label = isEnforcer ? 'Settled' : 'Resolved';

    const currentStep = item.stepProgress || 2;

    const step1Class = currentStep >= 1 ? (currentStep === 1 ? 'active' : 'completed') : '';
    const step2Class = currentStep >= 2 ? (currentStep === 2 ? 'active' : 'completed') : '';
    const step3Class = currentStep >= 3 ? (currentStep === 3 ? 'active' : 'completed') : '';
    const step4Class = currentStep >= 4 ? (currentStep === 4 ? 'completed' : 'completed') : '';

    return `
      <div class="notif-item-card ${cardStatusClass} ${isUnread ? 'is-unread' : ''}" data-id="${item.id}">
        <div class="notif-card-header">
          <span class="notif-category-tag">${item.category || (isEnforcer ? 'Official Citation' : 'Complaint Report')}</span>
          <span class="notif-status-badge ${badgeClass}">
            <span class="badge-dot"></span>
            <span>${item.status || 'Under Investigation'}</span>
          </span>
        </div>

        <div class="notif-card-title">${item.title}</div>
        
        <div class="notif-card-target-pill">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="13" height="13">
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
          </svg>
          <span>${item.vehicleType || 'Pedicab'} Plate #${item.plateNo || '—'}</span>
          ${item.actualFare ? `• <strong>${item.actualFare}</strong>` : ''}
          ${item.citationNo ? `• Ticket: ${item.citationNo}` : ''}
        </div>

        <!-- 4-Step Progress Tracker -->
        <div class="notif-progress-timeline">
          <div class="timeline-step ${step1Class}">
            <div class="timeline-step-dot">${currentStep > 1 ? '✓' : '1'}</div>
            <span class="timeline-step-label">${step1Label}</span>
          </div>
          <div class="timeline-step ${step2Class}">
            <div class="timeline-step-dot">${currentStep > 2 ? '✓' : '2'}</div>
            <span class="timeline-step-label">${step2Label}</span>
          </div>
          <div class="timeline-step ${step3Class}">
            <div class="timeline-step-dot">${currentStep > 3 ? '✓' : '3'}</div>
            <span class="timeline-step-label">${step3Label}</span>
          </div>
          <div class="timeline-step ${step4Class}">
            <div class="timeline-step-dot">${currentStep >= 4 ? '✓' : '4'}</div>
            <span class="timeline-step-label">${step4Label}</span>
          </div>
        </div>

        <div class="notif-desc-box">
          <strong>TRD Status Note:</strong> ${item.description || 'Report filed and queued for TRD review.'}
        </div>

        <div class="notif-card-footer">
          <span>📅 Incident Date: ${item.incidentDate || 'Recent'}</span>
          <div class="notif-card-actions">
            <span>${item.driverName ? `Driver: ${item.driverName}` : 'Tabaco City TRD'}</span>
            <button type="button" class="btn-delete-notif" data-record-id="${item.recordId || item.id}" data-category="${item.category || ''}" title="Delete record from database">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12">
                <polyline points="3 6 5 6 21 6"></polyline>
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
              </svg>
              Delete
            </button>
          </div>
        </div>
      </div>
    `;
  }).join('');

  // Add click to mark as read on individual card
  container.querySelectorAll('.notif-item-card').forEach(card => {
    card.addEventListener('click', (e) => {
      if (e.target.closest('.btn-delete-notif')) return;
      const id = card.getAttribute('data-id');
      if (id) {
        markNotificationAsRead(id);
        const item = currentRoleNotifications.find(n => n.id === id);
        if (item) item.isRead = true;
        card.classList.remove('is-unread');
        const unreadCount = currentRoleNotifications.filter(n => !n.isRead).length;
        updateNotificationBadges(unreadCount);
      }
    });
  });

  // Attach Delete Button Listeners (Two-way Supabase deletion)
  container.querySelectorAll('.btn-delete-notif').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const recordId = btn.getAttribute('data-record-id');
      const category = btn.getAttribute('data-category') || '';

      if (!confirm('Are you sure you want to delete this record? It will be permanently removed from the Supabase database and Admin page.')) {
        return;
      }

      btn.disabled = true;
      btn.textContent = 'Deleting...';
      showToast('🗑️ Removing record from Supabase database...');

      const res = await deleteReportRecord(recordId, category);
      if (res.success) {
        showToast('✅ Record permanently removed from database.');
        await loadAndRenderNotifications(false);
      } else {
        showToast('❌ Failed to delete record.');
        btn.disabled = false;
        btn.textContent = 'Delete';
      }
    });
  });
}

/**
 * Display top floating animated banner for real-time status alerts
 */
function showLiveStatusBanner(title, desc, notifId = null) {
  const banner = document.getElementById('live-status-banner');
  const titleEl = document.getElementById('status-banner-title');
  const descEl = document.getElementById('status-banner-desc');
  const iconEl = document.getElementById('status-banner-icon');

  if (!banner || !titleEl || !descEl) return;

  const isEnforcer = getCurrentUser()?.role === 'Traffic Enforcer';
  if (iconEl) iconEl.textContent = isEnforcer ? '🛡️' : '🔔';

  titleEl.textContent = title;
  descEl.textContent = desc;

  banner.classList.remove('hidden');

  // Auto hide after 6 seconds
  setTimeout(() => {
    banner.classList.add('hidden');
  }, 6000);
}

/* ==========================================================================
   Toast
   ========================================================================== */
function showToast(msg) {
  const toast = document.getElementById('toast');
  const toastMsg = document.getElementById('toast-message');
  if (!toast || !toastMsg) return;

  toastMsg.textContent = msg;
  toast.classList.remove('hidden');
  setTimeout(() => { toast.classList.add('hidden'); }, 2400);
}



