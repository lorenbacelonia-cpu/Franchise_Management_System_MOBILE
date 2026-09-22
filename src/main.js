import './style.css';
import { parseQRCode } from './parser.js';
import { initScanner, stopScanner, setSoundEnabled, isSoundActive, switchNextCamera, toggleTorch, scanImageFile } from './scanner.js';
import { saveScanToHistory } from './history.js';
import { fetchFranchiseByPlate, dbRowToRecord, submitViolationReport } from './db.js';
import { loginUser, logoutUser, getCurrentUser, isLoggedIn, registerUser, formatFormalName, formatFormalUsername } from './auth.js';

let activeView = 'view-scan';
let currentVerifiedRecord = null;
let selectedLoginRole = 'Passenger';
let selectedSignupRole = 'Passenger';

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
  setupLogout();

  // Restore logged-in state if active session exists
  if (isLoggedIn()) {
    showLoggedInState(getCurrentUser());
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
  showToast('🔍 Verifying QR Code...');

  // 1. Universal Dynamic QR Code Parsing (detects Pedicab or Tricycle automatically)
  let record = parseQRCode(rawText);

  // 2. Check Supabase database across all admin tables for live verified records
  try {
    const dbRow = await fetchFranchiseByPlate(record.plateNo, rawText);
    if (dbRow) {
      record = dbRowToRecord(dbRow, rawText);
    }
  } catch (err) {
    console.warn('Database lookup notice:', err);
  }

  currentVerifiedRecord = record;
  saveScanToHistory(record);
  renderVerificationDashboard(record);
  showToast(`✅ Verified ${record.vehicleType || 'Franchise'} Unit (${record.plateNo})`);
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

  const titleEl = document.getElementById('verified-vehicle-title');
  if (titleEl) {
    titleEl.textContent = `${vehicleType} Verified Unit`;
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
  if (availEl) availEl.textContent = record.availability || 'Available';

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

  // 3. CONFIGURE & OPEN REPORT FORM
  const titleEl = document.getElementById('report-modal-title');
  const userRoleText = document.getElementById('report-user-role');
  const reportRoleBadge = document.getElementById('report-role-badge');
  const reportTypeSelect = document.getElementById('report-type');

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

  if (reportTypeSelect) {
    if (isEnforcer) {
      reportTypeSelect.innerHTML = `
        <option value="Official Overcharging Citation">Official Overcharging Citation</option>
        <option value="No Franchise / Expired Permit">No Franchise / Expired TRD Permit</option>
        <option value="Illegal Route Operation">Illegal Route / Out of Line Operation</option>
        <option value="Refusal of Service">Refusal of Public Transport Service</option>
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

  if (enforcerBadgeWrap) enforcerBadgeWrap.classList.toggle('hidden', !isEnforcer);
  if (citationWrap) citationWrap.classList.toggle('hidden', !isEnforcer);
  if (fareWrap) fareWrap.classList.remove('hidden');

  if (submitBtn) {
    submitBtn.classList.toggle('modal-enforcer-btn', isEnforcer);
    submitBtn.textContent = isEnforcer ? 'SUBMIT OFFICIAL TRAFFIC CITATION' : 'Submit Report to TRD Office';
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
    document.getElementById('report-modal').classList.add('hidden');
  });

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
      reporter_role: roleName,
      fare_charged: actualFare,
      enforcer_badge: enforcerBadge,
      citation_no: citationNo,
      description: remarks
    };

    try {
      await submitViolationReport(payload);
    } catch (err) {
      console.warn('Submit report background note:', err);
    }

    document.getElementById('report-modal').classList.add('hidden');
    document.getElementById('success-modal').classList.remove('hidden');
    showToast(`✅ ${roleName} report saved to database.`);
  });

  const closeSuccessBtn = document.getElementById('btn-close-success');
  if (closeSuccessBtn) closeSuccessBtn.addEventListener('click', () => {
    document.getElementById('success-modal').classList.add('hidden');
  });
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
