import './style.css';
import { parseQRCode } from './parser.js';
import { initScanner, stopScanner, setSoundEnabled, isSoundActive, switchNextCamera, toggleTorch, scanImageFile } from './scanner.js';
import { saveScanToHistory } from './history.js';
import { fetchFranchiseByPlate, dbRowToRecord, submitViolationReport, fetchRoleNotifications, markNotificationAsRead, markAllNotificationsRead, subscribeToRealtimeStatusUpdates, deleteReportRecord, deleteFranchiseRecord } from './db.js';
import { 
  loginUser, 
  logoutUser, 
  getCurrentUser, 
  isLoggedIn, 
  registerUser, 
  formatFormalName, 
  formatFormalUsername,
  isValidEmail,
  isValidPhone,
  formatPhoneNumber,
  generateSmsVerificationOtp,
  generateEmailVerificationOtp,
  generateVerificationOtp,
  verifySmsOtp,
  verifyEmailOtp,
  verifyOtp,
  checkAccountAvailability,
  loginWithEmailVerification,
  findUserByIdentifier,
  resetUserPassword,
  maskTarget
} from './auth.js';

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
  const loginRegText = document.getElementById('login-register-text');
  const loginEnfNotice = document.getElementById('login-enforcer-notice');
  const loginAuthOptions = document.querySelector('.login-auth-options');
  const usernameInput = document.getElementById('input-username');

  if (loginCard) loginCard.classList.toggle('theme-enforcer', isEnforcer);
  if (loginPassTab) loginPassTab.classList.toggle('active', !isEnforcer);
  if (loginEnfTab) loginEnfTab.classList.toggle('active', isEnforcer);
  if (loginSubmitBtn) {
    loginSubmitBtn.textContent = isEnforcer ? 'LOG IN AS TRAFFIC ENFORCER' : 'LOG IN AS PASSENGER';
  }
  if (loginGiantIcon) {
    loginGiantIcon.innerHTML = `
      <img src="/tabaco-city-seal.png" alt="City of Tabaco Official Seal" class="auth-seal-img" />
      ${isEnforcer ? '<span class="auth-enforcer-badge">👮</span>' : ''}
    `;
  }
  if (loginPortalBadge) {
    loginPortalBadge.className = isEnforcer ? 'enforcer-portal-badge' : 'passenger-portal-badge';
    loginPortalBadge.textContent = isEnforcer ? '👮 TRD Law Enforcement Portal' : '👤 Passenger Verifier Portal';
  }
  if (loginSub) {
    loginSub.textContent = isEnforcer ? 'Sign in with your official TRD Enforcer account provided by Admin' : 'Sign in with your TRD verifier account';
  }
  if (usernameInput) {
    usernameInput.placeholder = isEnforcer ? 'Officer Username / ID' : 'Username or Email';
  }
  if (loginRegText) loginRegText.classList.toggle('hidden', isEnforcer);
  if (loginEnfNotice) loginEnfNotice.classList.toggle('hidden', !isEnforcer);
  // Email verification is for passengers only because admin provides enforcer accounts
  if (loginAuthOptions) loginAuthOptions.classList.toggle('hidden', isEnforcer);

  hideLoginError();
}

export function applySignupRoleTheme() {
  selectedSignupRole = 'Passenger';
  const signupCard = document.getElementById('signup-card');
  const signupSubmitBtn = document.getElementById('btn-signup-submit');
  const signupGiantIcon = document.getElementById('signup-giant-icon');
  const signupPortalBadge = document.getElementById('signup-portal-badge');
  const signupSub = document.getElementById('signup-sub');

  if (signupCard) signupCard.classList.remove('theme-enforcer');
  if (signupSubmitBtn) {
    signupSubmitBtn.textContent = 'VERIFY VIA SMS & REGISTER AS PASSENGER';
  }
  if (signupGiantIcon) {
    signupGiantIcon.innerHTML = `
      <img src="/tabaco-city-seal.png" alt="City of Tabaco Official Seal" class="auth-seal-img" />
    `;
  }
  if (signupPortalBadge) {
    signupPortalBadge.className = 'passenger-portal-badge';
    signupPortalBadge.textContent = '👤 Passenger Account Registration';
  }
  if (signupSub) {
    signupSub.textContent = 'Register as a Passenger with instant SMS verification via TextBee';
  }
  const signupErr = document.getElementById('signup-error-msg');
  const signupSucc = document.getElementById('signup-success-msg');
  if (signupErr) { signupErr.textContent = ''; signupErr.classList.add('hidden'); }
  if (signupSucc) { signupSucc.textContent = ''; signupSucc.classList.add('hidden'); }
}

document.addEventListener('DOMContentLoaded', () => {
  // Setup all event handlers and views
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

  // Check if opened via QR Code scan (Google Lens, built-in camera, or direct URL with parameters)
  const urlParams = new URLSearchParams(window.location.search);
  const hasIncomingScan = urlParams.has('plate') || urlParams.has('plateNo') || urlParams.has('mtop') || urlParams.has('id') || urlParams.has('driver');

  const appHeader = document.getElementById('app-header');
  const bottomNav = document.querySelector('.bottom-nav');

  if (hasIncomingScan) {
    if (appHeader) appHeader.style.display = '';
    if (bottomNav) bottomNav.style.display = '';
    document.body.classList.remove('scan-active');

    // Immediately handle and render verification for the scanned URL
    handleIncomingUrlVerification(window.location.href);
  } else {
    // Normal direct open without QR scan — show camera scanner as landing page
    if (appHeader) appHeader.style.display = 'none';
    if (bottomNav) bottomNav.style.display = 'none';
    document.body.classList.add('scan-active');

    startCameraScanner().catch(err => {
      console.warn('Auto camera startup warning:', err);
    });
  }
});

/* ==========================================================================
   Password Visibility Toggle (Mobile Touch & Pointer Optimized)
   ========================================================================== */
function setupPasswordToggles() {
  const toggleBtns = document.querySelectorAll('.btn-toggle-pwd');
  toggleBtns.forEach(btn => {
    let lastActionTime = 0;

    const toggleVisibility = (e) => {
      if (e) {
        e.preventDefault();
        e.stopPropagation();
      }

      const now = Date.now();
      if (now - lastActionTime < 350) return;
      lastActionTime = now;

      const targetId = btn.getAttribute('data-target');
      const input = document.getElementById(targetId);
      if (!input) return;

      const isPassword = input.type === 'password';
      input.type = isPassword ? 'text' : 'password';

      const eyeShow = btn.querySelector('.eye-show');
      const eyeHide = btn.querySelector('.eye-hide');

      if (eyeShow) eyeShow.classList.toggle('hidden', isPassword);
      if (eyeHide) eyeHide.classList.toggle('hidden', !isPassword);

      btn.setAttribute('aria-pressed', isPassword ? 'true' : 'false');
    };

    // 'pointerdown' provides instant, zero-delay feedback on mobile touchscreens
    // and prevents virtual keyboard dismiss or layout shift cancelations.
    btn.addEventListener('pointerdown', toggleVisibility);
    btn.addEventListener('click', toggleVisibility);
    btn.addEventListener('touchend', (e) => {
      e.preventDefault();
    });
  });
}

/* ==========================================================================
   Role Tabs Setup (Passenger vs Traffic Enforcer Login)
   ========================================================================== */
function setupRoleTabs() {
  // Login Role Tabs
  const loginPassTab = document.getElementById('role-login-passenger');
  const loginEnfTab = document.getElementById('role-login-enforcer');

  if (loginPassTab && loginEnfTab) {
    loginPassTab.addEventListener('click', () => applyLoginRoleTheme('Passenger'));
    loginEnfTab.addEventListener('click', () => applyLoginRoleTheme('Traffic Enforcer'));
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
    stopScanner().catch(err => {
      console.warn('Camera stop warning:', err);
    });
  }

  if (viewId === 'view-login') {
    hideLoginError();
  }
  if (viewId === 'view-signup') {
    const signupErr = document.getElementById('signup-error-msg');
    const signupSucc = document.getElementById('signup-success-msg');
    if (signupErr) { signupErr.textContent = ''; signupErr.classList.add('hidden'); }
    if (signupSucc) { signupSucc.textContent = ''; signupSucc.classList.add('hidden'); }
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
  const passwordInput = document.getElementById('input-password');
  const forgotPwdBtn = document.getElementById('btn-login-forgot-pwd') || document.getElementById('btn-login-email-verify');

  if (forgotPwdBtn) {
    forgotPwdBtn.addEventListener('click', () => {
      const usernameVal = usernameInput?.value.trim() || '';
      const isEmail = isValidEmail(usernameVal);
      const isPhone = isValidPhone(usernameVal);
      const methodToUse = isPhone ? 'sms' : (isEmail ? 'email' : 'sms');
      openEmailVerificationModal({
        target: usernameVal,
        email: isEmail ? usernameVal : '',
        phone: isPhone ? usernameVal : '',
        method: methodToUse,
        role: selectedLoginRole || 'Passenger',
        isForgotMode: true,
        isLoginMode: false
      });
    });
  }

  if (usernameInput) {
    attachAutoCapitalize(usernameInput, 'first-letter');
    usernameInput.addEventListener('input', hideLoginError);
  }
  if (passwordInput) {
    passwordInput.addEventListener('input', hideLoginError);
  }

  if (form) form.addEventListener('submit', doLogin);
  // login handled by form
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
      // Capitalize very first letter of string (e.g. Juan), unless user is typing an email
      if (!val.includes('@')) {
        formatted = val.charAt(0).toUpperCase() + val.slice(1);
      }
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
      if (!inputElement.value.includes('@')) {
        inputElement.value = formatFormalUsername(inputElement.value);
      }
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

  // Update header enforcer badge
  const headerEnforcerBadge = document.getElementById('header-enforcer-badge');
  if (headerEnforcerBadge) {
    headerEnforcerBadge.classList.toggle('hidden', !isEnforcer);
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

  // Update fare matrix buttons (hide Violation button if logged in as Passenger)
  updateFareMatrixButtonsUI();
}

/* ==========================================================================
   Sign Up View — Role-aware Registration with Email Verification
   ========================================================================== */
let pendingEmailRegistration = null;
let otpResendTimer = null;
let otpCountdownSec = 60;

let selectedSignupVerifyMethod = 'sms';

function setupSignupView() {
  const form = document.getElementById('signup-form');
  const submitBtn = document.getElementById('btn-signup-submit');

  const gotoLoginBtn = document.getElementById('btn-goto-login');
  const linkGoLogin = document.getElementById('link-go-login');

  const contactInput = document.getElementById('signup-contact');
  const contactBadge = document.getElementById('signup-contact-badge');
  const contactIcon = document.getElementById('signup-contact-icon');
  const hiddenPhone = document.getElementById('signup-phone');
  const hiddenEmail = document.getElementById('signup-email');

  // Unified auto-detection: 09... 11 digits refers to SMS (no letters); letters refer to Email
  const updateContactType = () => {
    if (!contactInput) return;
    let val = contactInput.value.trimStart();

    if (!val) {
      if (contactBadge) contactBadge.classList.add('hidden');
      if (hiddenPhone) hiddenPhone.value = '';
      if (hiddenEmail) hiddenEmail.value = '';
      selectedSignupVerifyMethod = 'sms';
      if (submitBtn) {
        submitBtn.textContent = 'VERIFY VIA SMS & REGISTER AS PASSENGER';
      }
      if (contactIcon) {
        contactIcon.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"></path><polyline points="22,6 12,13 2,6"></polyline></svg>`;
      }
      return;
    }

    // If starts with a digit
    if (/^\d/.test(val)) {
      // Disallow all non-digits (no letters allowed when entering a phone number)
      val = val.replace(/\D/g, '');
      // Enforce 11 digits maximum (e.g. 09123456789)
      if (val.length > 11) {
        val = val.slice(0, 11);
      }
      contactInput.value = val;
      selectedSignupVerifyMethod = 'sms';
      if (hiddenPhone) hiddenPhone.value = val;
      if (hiddenEmail) hiddenEmail.value = '';

      if (contactBadge) {
        contactBadge.textContent = 'SMS';
        contactBadge.classList.remove('hidden');
      }
      if (submitBtn) {
        submitBtn.textContent = 'VERIFY VIA SMS & REGISTER AS PASSENGER';
      }
      if (contactIcon) {
        contactIcon.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><rect x="5" y="2" width="14" height="20" rx="2" ry="2"></rect><line x1="12" y1="18" x2="12.01" y2="18"></line></svg>`;
      }
    } else {
      // Contains letters -> refers to Email
      selectedSignupVerifyMethod = 'email';
      if (hiddenEmail) hiddenEmail.value = val;
      if (hiddenPhone) hiddenPhone.value = '';

      if (contactBadge) {
        contactBadge.textContent = 'Email';
        contactBadge.classList.remove('hidden');
      }
      if (submitBtn) {
        submitBtn.textContent = 'VERIFY VIA EMAIL & REGISTER AS PASSENGER';
      }
      if (contactIcon) {
        contactIcon.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"></path><polyline points="22,6 12,13 2,6"></polyline></svg>`;
      }
    }
  };

  if (contactInput) {
    contactInput.addEventListener('input', updateContactType);

    // Prevent letters on keydown if input is currently in phone number mode
    contactInput.addEventListener('keydown', (e) => {
      const val = contactInput.value;
      if (/^\d/.test(val)) {
        if (['Backspace', 'ArrowLeft', 'ArrowRight', 'Tab', 'Enter', 'Delete', 'Escape'].includes(e.key)) {
          return;
        }
        if (e.ctrlKey || e.metaKey) return;
        if (!/^\d$/.test(e.key)) {
          e.preventDefault();
        }
      }
    });
  }

  if (gotoLoginBtn) gotoLoginBtn.addEventListener('click', () => switchView('view-login'));
  if (linkGoLogin) linkGoLogin.addEventListener('click', (e) => { e.preventDefault(); switchView('view-login'); });

  const doRegister = async (e) => {
    if (e) e.preventDefault();

    const fullName = document.getElementById('signup-fullname')?.value.trim();
    const contactVal = (contactInput ? contactInput.value.trim() : '');
    const username = document.getElementById('signup-username')?.value.trim();
    const password = document.getElementById('signup-password')?.value;
    const confirm = document.getElementById('signup-confirm')?.value;

    const errorEl = document.getElementById('signup-error-msg');
    const successEl = document.getElementById('signup-success-msg');

    errorEl.classList.add('hidden');
    successEl.classList.add('hidden');

    if (!fullName || !username || !password) {
      errorEl.textContent = 'Full Name, Username, and Password are required.';
      errorEl.classList.remove('hidden');
      return;
    }

    if (!contactVal) {
      errorEl.textContent = 'Please enter your 11-digit mobile number (09...) or email address.';
      errorEl.classList.remove('hidden');
      if (contactInput) contactInput.focus();
      return;
    }

    let phone = '';
    let email = '';

    if (selectedSignupVerifyMethod === 'sms') {
      phone = contactVal.replace(/\D/g, '');
      if (!phone.startsWith('09') || phone.length !== 11) {
        errorEl.textContent = 'Please enter a valid 11-digit mobile number starting with 09 (e.g. 09123456789).';
        errorEl.classList.remove('hidden');
        if (contactInput) contactInput.focus();
        return;
      }
    } else {
      email = contactVal;
      if (!isValidEmail(email)) {
        errorEl.textContent = 'Please enter a valid email address (e.g. name@gmail.com).';
        errorEl.classList.remove('hidden');
        if (contactInput) contactInput.focus();
        return;
      }
    }

    if (password.length < 4) {
      errorEl.textContent = 'Password must be at least 4 characters long.';
      errorEl.classList.remove('hidden');
      return;
    }

    if (password !== confirm) {
      errorEl.textContent = 'Passwords do not match.';
      errorEl.classList.remove('hidden');
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = 'CHECKING AVAILABILITY...';

    // Verify username, email, and phone availability
    const avail = await checkAccountAvailability(username, email, 'Passenger', phone);

    if (!avail.available) {
      submitBtn.disabled = false;
      submitBtn.textContent = selectedSignupVerifyMethod === 'sms'
        ? 'VERIFY VIA SMS & REGISTER AS PASSENGER'
        : 'VERIFY VIA EMAIL & REGISTER AS PASSENGER';
      errorEl.textContent = avail.error;
      errorEl.classList.remove('hidden');
      return;
    }

    const verificationTarget = selectedSignupVerifyMethod === 'sms' ? formatPhoneNumber(phone) : email;
    submitBtn.textContent = selectedSignupVerifyMethod === 'sms'
      ? 'DISPATCHING SMS VERIFICATION CODE...'
      : 'DISPATCHING EMAIL VERIFICATION CODE...';

    // Dispatch verification code via chosen method
    const otpRes = selectedSignupVerifyMethod === 'sms'
      ? await generateSmsVerificationOtp(phone, 'Passenger')
      : await generateEmailVerificationOtp(email, 'Passenger');

    submitBtn.disabled = false;
    submitBtn.textContent = selectedSignupVerifyMethod === 'sms'
      ? 'VERIFY VIA SMS & REGISTER AS PASSENGER'
      : 'VERIFY VIA EMAIL & REGISTER AS PASSENGER';

    if (!otpRes.success) {
      errorEl.textContent = otpRes.error || 'Failed to dispatch verification code.';
      errorEl.classList.remove('hidden');
      return;
    }

    // Launch verification modal in registration mode
    openEmailVerificationModal({
      fullName,
      username,
      email,
      phone,
      target: verificationTarget,
      password,
      method: selectedSignupVerifyMethod,
      role: 'Passenger',
      isLoginMode: false,
      isForgotMode: false
    });
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
}

/* ==========================================================================
   Verification OTP Modal Logic (Passenger & Enforcer — SMS & Email)
   ========================================================================== */
function openEmailVerificationModal(data = {}) {
  pendingEmailRegistration = { ...data };
  const modal = document.getElementById('modal-email-verification');
  if (!modal) return;

  const isEnforcer = data.role === 'Traffic Enforcer';
  const isForgot = !!data.isForgotMode;
  const isLogin = !!data.isLoginMode;

  const method = data.method || (data.phone ? 'sms' : (isValidEmail(data.target || data.email) ? 'email' : 'sms'));
  pendingEmailRegistration.method = method;

  const sheet = modal.querySelector('.otp-bottom-sheet');
  const iconWrap = document.getElementById('otp-header-icon-wrap');
  const iconSms = document.getElementById('otp-icon-sms');
  const iconEmail = document.getElementById('otp-icon-email');
  const badge = document.getElementById('otp-portal-badge');
  const targetDisplay = document.getElementById('otp-target-email-display');
  const receiverInput = document.getElementById('otp-receiver-email-input');
  const receiverLabel = document.getElementById('otp-box-label');
  const receiverHint = document.getElementById('otp-receiver-hint');
  const dispatchedNotice = document.getElementById('otp-dispatched-notice');
  const dispatchedTitleText = document.getElementById('otp-dispatched-title-text');
  const dispatchedNote = document.getElementById('otp-dispatched-note');
  const digitsLabel = document.getElementById('otp-digits-label');
  const errorMsg = document.getElementById('otp-error-msg');
  const verifyBtn = document.getElementById('btn-verify-otp');
  const modalTitle = document.getElementById('otp-modal-title');
  const modalDesc = document.getElementById('otp-modal-desc');
  const resetSection = document.getElementById('otp-reset-password-section');
  const digitsContainer = document.getElementById('otp-digits-container');
  const receiverBox = modal.querySelector('.otp-receiver-box');
  const forgotDestBox = document.getElementById('otp-forgot-destinations');

  if (sheet) sheet.classList.toggle('theme-enforcer', isEnforcer);
  if (iconWrap) iconWrap.classList.toggle('theme-enforcer', isEnforcer);

  // Toggle method icons
  if (iconSms) iconSms.classList.toggle('hidden', method !== 'sms');
  if (iconEmail) iconEmail.classList.toggle('hidden', method !== 'email');

  // Hide reset password fields on fresh modal open
  if (resetSection) resetSection.classList.add('hidden');
  if (digitsContainer) digitsContainer.classList.remove('hidden');
  if (receiverBox) receiverBox.classList.remove('hidden');
  const newPwdInput = document.getElementById('otp-new-password');
  const confPwdInput = document.getElementById('otp-confirm-password');
  if (newPwdInput) newPwdInput.value = '';
  if (confPwdInput) confPwdInput.value = '';

  const currentTarget = method === 'sms' 
    ? (data.phone || data.target || '') 
    : (data.email || data.target || '');

  // Forgot Password Mode vs Normal Verification Mode
  if (isForgot) {
    if (receiverLabel) receiverLabel.textContent = 'Account Username';
    if (receiverHint) receiverHint.textContent = 'We will send the verification code to the phone or email you provided during sign-up.';
    if (receiverInput) {
      receiverInput.type = 'text';
      receiverInput.placeholder = 'Enter your account username';
      receiverInput.value = data.username || data.target || '';
      receiverInput.disabled = false;
    }
    if (badge) {
      badge.className = isEnforcer ? 'enforcer-portal-badge' : 'passenger-portal-badge';
      badge.textContent = '🔑 Password Recovery';
    }
    if (modalTitle) {
      modalTitle.textContent = 'Forgot Password';
    }
    if (modalDesc) {
      modalDesc.innerHTML = 'Enter your <strong>Username</strong> to receive a verification code on your registered mobile number or email.';
    }
    if (digitsLabel) digitsLabel.textContent = 'Enter 6-Digit Code';
  } else {
    if (forgotDestBox) forgotDestBox.classList.add('hidden');

    if (method === 'sms') {
      if (badge) {
        badge.className = isEnforcer ? 'enforcer-portal-badge' : 'passenger-portal-badge';
        badge.textContent = isEnforcer ? '👮 Enforcer SMS Verification' : '📱 SMS Verification';
      }
      if (modalTitle) {
        modalTitle.textContent = data.isLoginMode ? 'Security SMS Verification' : 'Verify Mobile Number';
      }
      if (modalDesc) {
        modalDesc.innerHTML = 'A secure 6-digit verification code is dispatched to your mobile number via SMS.';
      }
      if (receiverLabel) receiverLabel.textContent = 'Mobile Number';
      if (receiverHint) receiverHint.textContent = 'Official 6-digit verification code sent via SMS.';
      if (dispatchedTitleText) dispatchedTitleText.textContent = 'SMS Verification Code Sent!';
      if (dispatchedNote) dispatchedNote.textContent = 'Note: The code was dispatched directly to your mobile phone via SMS.';
      if (digitsLabel) digitsLabel.textContent = 'Enter 6-Digit Code (from your SMS)';
    } else {
      if (badge) {
        badge.className = isEnforcer ? 'enforcer-portal-badge' : 'passenger-portal-badge';
        badge.textContent = isEnforcer ? '👮 Enforcer Email Verification' : '✉️ Email Verification';
      }
      if (modalTitle) {
        modalTitle.textContent = data.isLoginMode ? 'Security Email Verification' : 'Verify Email Address';
      }
      if (modalDesc) {
        modalDesc.innerHTML = 'A secure 6-digit verification code is dispatched to your email address.';
      }
      if (receiverLabel) receiverLabel.textContent = 'Email Address';
      if (receiverHint) receiverHint.textContent = 'Official 6-digit verification code sent via Email.';
      if (dispatchedTitleText) dispatchedTitleText.textContent = 'Email Verification Code Sent!';
      if (dispatchedNote) dispatchedNote.textContent = 'Note: The code is accessible in your email inbox.';
      if (digitsLabel) digitsLabel.textContent = 'Enter 6-Digit Code (from your Email)';
    }

    if (receiverInput) {
      receiverInput.type = method === 'sms' ? 'tel' : 'email';
      receiverInput.placeholder = method === 'sms' ? 'Enter 11-digit mobile (09xxxxxxxxx)' : 'Enter email (e.g. name@gmail.com)';
      receiverInput.value = currentTarget;
      receiverInput.disabled = !isLogin && !!currentTarget;
    }
  }

  if (targetDisplay) {
    targetDisplay.textContent = currentTarget ? maskTarget(currentTarget) : (method === 'sms' ? 'your phone' : 'your email');
  }

  if (dispatchedNotice) {
    dispatchedNotice.classList.toggle('hidden', !currentTarget || isForgot);
  }

  if (errorMsg) {
    errorMsg.textContent = '';
    errorMsg.classList.add('hidden');
  }

  if (verifyBtn) {
    verifyBtn.disabled = false;
    verifyBtn.textContent = isForgot 
      ? 'VERIFY CODE' 
      : (data.isLoginMode ? 'VERIFY & SIGN IN' : 'VERIFY & ACTIVATE ACCOUNT');
  }

  // Clear OTP input digits
  const digits = modal.querySelectorAll('.otp-digit');
  digits.forEach(d => {
    d.value = '';
    d.classList.remove('filled');
  });

  if (currentTarget && !isForgot) {
    startOtpResendCountdown();
  }

  modal.classList.remove('hidden');

  // If forgot password mode and username is provided, lookup account immediately
  if (isForgot) {
    const userToLookup = data.username || data.target || '';
    if (userToLookup) {
      setTimeout(() => {
        triggerForgotAccountLookup(userToLookup);
      }, 50);
    }
  }

  setTimeout(() => {
    if (currentTarget && !isForgot) {
      const firstDigit = modal.querySelector('.otp-digit[data-index="0"]');
      if (firstDigit) firstDigit.focus();
    } else if (receiverInput) {
      receiverInput.focus();
    }
  }, 100);
}

// Global helper for forgot password account lookup and destination toggling
async function triggerForgotAccountLookup(identifier) {
  if (!identifier) return;
  const role = pendingEmailRegistration?.role || selectedLoginRole;
  const errorEl = document.getElementById('otp-error-msg');
  const destBox = document.getElementById('otp-forgot-destinations');
  const smsDestBtn = document.getElementById('btn-forgot-dest-sms');
  const emailDestBtn = document.getElementById('btn-forgot-dest-email');
  const smsDisplay = document.getElementById('otp-dest-sms-display');
  const emailDisplay = document.getElementById('otp-dest-email-display');
  const modalDesc = document.getElementById('otp-modal-desc');

  const check = await findUserByIdentifier(identifier, role);
  if (check.success && check.user) {
    const u = check.user;
    if (pendingEmailRegistration) {
      pendingEmailRegistration.foundUser = u;
      pendingEmailRegistration.username = u.username;
    }
    if (destBox) destBox.classList.remove('hidden');

    const phoneVal = (u.contact_number || '').trim();
    const emailVal = (u.email || '').trim();

    if (smsDisplay) smsDisplay.textContent = phoneVal ? maskTarget(phoneVal) : 'Not registered';
    if (emailDisplay) emailDisplay.textContent = emailVal ? maskTarget(emailVal) : 'Not registered';

    if (smsDestBtn) {
      smsDestBtn.disabled = !phoneVal;
      smsDestBtn.style.opacity = phoneVal ? '1' : '0.4';
      smsDestBtn.style.cursor = phoneVal ? 'pointer' : 'not-allowed';
    }
    if (emailDestBtn) {
      emailDestBtn.disabled = !emailVal;
      emailDestBtn.style.opacity = emailVal ? '1' : '0.4';
      emailDestBtn.style.cursor = emailVal ? 'pointer' : 'not-allowed';
    }

    // Default to SMS if available, otherwise Email
    const defaultMethod = phoneVal ? 'sms' : (emailVal ? 'email' : 'sms');
    setForgotDestMethod(defaultMethod);

    if (modalDesc) {
      modalDesc.innerHTML = `Account found: <strong>${u.fullname || u.username}</strong>. Choose where to receive your 6-digit code:`;
    }
    if (errorEl) errorEl.classList.add('hidden');
  } else {
    if (destBox) destBox.classList.add('hidden');
    if (pendingEmailRegistration) pendingEmailRegistration.foundUser = null;
    if (modalDesc) {
      modalDesc.innerHTML = 'Enter your <strong>Username</strong> to receive a verification code on your registered mobile number or email.';
    }
  }
}

function setForgotDestMethod(method) {
  if (!pendingEmailRegistration) return;
  const u = pendingEmailRegistration.foundUser;
  if (!u) return;

  pendingEmailRegistration.method = method;
  const smsDestBtn = document.getElementById('btn-forgot-dest-sms');
  const emailDestBtn = document.getElementById('btn-forgot-dest-email');
  const modalTitle = document.getElementById('otp-modal-title');
  const badge = document.getElementById('otp-portal-badge');
  const iconSms = document.getElementById('otp-icon-sms');
  const iconEmail = document.getElementById('otp-icon-email');

  if (smsDestBtn && emailDestBtn) {
    smsDestBtn.classList.toggle('active', method === 'sms');
    emailDestBtn.classList.toggle('active', method === 'email');
  }

  if (iconSms) iconSms.classList.toggle('hidden', method !== 'sms');
  if (iconEmail) iconEmail.classList.toggle('hidden', method !== 'email');

  if (method === 'sms') {
    pendingEmailRegistration.target = u.contact_number || '';
    pendingEmailRegistration.phone = u.contact_number || '';
    if (modalTitle) modalTitle.textContent = 'Reset Password via SMS';
    if (badge) badge.textContent = '🔑 Password Recovery (SMS)';
  } else {
    pendingEmailRegistration.target = u.email || '';
    pendingEmailRegistration.email = u.email || '';
    if (modalTitle) modalTitle.textContent = 'Reset Password via Email';
    if (badge) badge.textContent = '🔑 Password Recovery (Email)';
  }
}

function closeEmailVerificationModal() {
  const modal = document.getElementById('modal-email-verification');
  if (modal) modal.classList.add('hidden');
  if (otpResendTimer) {
    clearInterval(otpResendTimer);
    otpResendTimer = null;
  }
}

function startOtpResendCountdown() {
  if (otpResendTimer) {
    clearInterval(otpResendTimer);
    otpResendTimer = null;
  }

  otpCountdownSec = 60;
  const resendBtn = document.getElementById('btn-resend-otp');
  const sendCodeBtn = document.getElementById('btn-otp-send-code');

  if (resendBtn) {
    resendBtn.disabled = true;
    resendBtn.innerHTML = `Resend Code (<span id="otp-timer-count">${otpCountdownSec}</span>s)`;
  }
  if (sendCodeBtn) {
    sendCodeBtn.disabled = true;
    sendCodeBtn.textContent = `Sent (${otpCountdownSec}s)`;
  }

  otpResendTimer = setInterval(() => {
    otpCountdownSec--;
    const currentCount = document.getElementById('otp-timer-count');
    if (currentCount) currentCount.textContent = otpCountdownSec;

    const currentSendBtn = document.getElementById('btn-otp-send-code');
    if (currentSendBtn && currentSendBtn.disabled) {
      currentSendBtn.textContent = `Wait ${otpCountdownSec}s`;
    }

    if (otpCountdownSec <= 0) {
      clearInterval(otpResendTimer);
      otpResendTimer = null;
      if (resendBtn) {
        resendBtn.disabled = false;
        resendBtn.textContent = 'Resend Verification Code';
      }
      if (currentSendBtn) {
        currentSendBtn.disabled = false;
        currentSendBtn.textContent = 'Send Code';
      }
    }
  }, 1000);
}

function setupEmailVerificationModal() {
  const modal = document.getElementById('modal-email-verification');
  if (!modal) return;

  const digits = modal.querySelectorAll('.otp-digit');
  const verifyBtn = document.getElementById('btn-verify-otp');
  const resendBtn = document.getElementById('btn-resend-otp');
  const cancelBtn = document.getElementById('btn-cancel-otp');
  const sendCodeBtn = document.getElementById('btn-otp-send-code');
  const receiverInput = document.getElementById('otp-receiver-email-input');
  const dispatchedNotice = document.getElementById('otp-dispatched-notice');
  const targetEmailDisplay = document.getElementById('otp-target-email-display');
  const errorEl = document.getElementById('otp-error-msg');
  const modalTitle = document.getElementById('otp-modal-title');
  const digitsLabel = document.getElementById('otp-digits-label');
  const resetSection = document.getElementById('otp-reset-password-section');
  const smsDestBtn = document.getElementById('btn-forgot-dest-sms');
  const emailDestBtn = document.getElementById('btn-forgot-dest-email');

  // Destination toggle clicks for Forgot Password
  if (smsDestBtn) {
    smsDestBtn.addEventListener('click', () => {
      if (!smsDestBtn.disabled) setForgotDestMethod('sms');
    });
  }
  if (emailDestBtn) {
    emailDestBtn.addEventListener('click', () => {
      if (!emailDestBtn.disabled) setForgotDestMethod('email');
    });
  }

  // Input filter & account lookup for receiver input
  if (receiverInput) {
    let lookupDebounce = null;
    receiverInput.addEventListener('input', () => {
      const isForgot = !!pendingEmailRegistration?.isForgotMode;
      if (isForgot) {
        clearTimeout(lookupDebounce);
        lookupDebounce = setTimeout(() => {
          triggerForgotAccountLookup(receiverInput.value.trim());
        }, 400);
      } else {
        const method = pendingEmailRegistration?.method || 'sms';
        if (method === 'sms') {
          let val = receiverInput.value.replace(/\D/g, '');
          if (val.length > 11) val = val.slice(0, 11);
          receiverInput.value = val;
        }
      }
    });
  }

  // Send Code button action (for login, forgot password, or manual dispatch)
  if (sendCodeBtn) {
    sendCodeBtn.addEventListener('click', async () => {
      const isForgot = !!pendingEmailRegistration?.isForgotMode;
      const role = pendingEmailRegistration?.role || selectedLoginRole;
      let inputVal = receiverInput?.value.trim() || '';

      // --- A. FORGOT PASSWORD MODE: Dispatch to registered contact from sign-up ---
      if (isForgot) {
        if (!inputVal) {
          if (errorEl) {
            errorEl.textContent = 'Please enter your account username.';
            errorEl.classList.remove('hidden');
          }
          if (receiverInput) receiverInput.focus();
          return;
        }

        sendCodeBtn.disabled = true;
        sendCodeBtn.textContent = 'Looking up...';

        let user = pendingEmailRegistration?.foundUser;
        if (!user || user.username?.toLowerCase() !== inputVal.toLowerCase()) {
          const check = await findUserByIdentifier(inputVal, role);
          if (!check.success || !check.user) {
            sendCodeBtn.disabled = false;
            sendCodeBtn.textContent = 'Send Code';
            if (errorEl) {
              errorEl.textContent = `No registered account found with username "${inputVal}".`;
              errorEl.classList.remove('hidden');
            }
            return;
          }
          user = check.user;
          await triggerForgotAccountLookup(inputVal);
        }

        const chosenMethod = pendingEmailRegistration?.method || 'sms';
        let targetToSend = '';

        if (chosenMethod === 'sms') {
          targetToSend = (user.contact_number || '').trim();
          if (!targetToSend) {
            sendCodeBtn.disabled = false;
            sendCodeBtn.textContent = 'Send Code';
            if (errorEl) {
              errorEl.textContent = 'This account does not have a registered mobile number. Please select Email.';
              errorEl.classList.remove('hidden');
            }
            return;
          }
        } else {
          targetToSend = (user.email || '').trim();
          if (!targetToSend) {
            sendCodeBtn.disabled = false;
            sendCodeBtn.textContent = 'Send Code';
            if (errorEl) {
              errorEl.textContent = 'This account does not have a registered email address. Please select SMS.';
              errorEl.classList.remove('hidden');
            }
            return;
          }
        }

        if (errorEl) errorEl.classList.add('hidden');
        sendCodeBtn.textContent = 'Sending...';

        const res = chosenMethod === 'sms'
          ? await generateSmsVerificationOtp(targetToSend, role)
          : await generateEmailVerificationOtp(targetToSend, role);

        if (!res.success) {
          sendCodeBtn.disabled = false;
          sendCodeBtn.textContent = 'Send Code';
          if (errorEl) {
            errorEl.textContent = res.error || 'Failed to dispatch verification code.';
            errorEl.classList.remove('hidden');
          }
          return;
        }

        pendingEmailRegistration.target = targetToSend;
        if (chosenMethod === 'sms') pendingEmailRegistration.phone = targetToSend;
        else pendingEmailRegistration.email = targetToSend;

        if (targetEmailDisplay) targetEmailDisplay.textContent = maskTarget(targetToSend);
        if (dispatchedNotice) dispatchedNotice.classList.remove('hidden');

        digits.forEach(d => {
          d.value = '';
          d.classList.remove('filled');
        });
        if (digits[0]) digits[0].focus();

        startOtpResendCountdown();
        showToast(chosenMethod === 'sms' 
          ? `📱 Verification code sent to registered mobile (${maskTarget(targetToSend)})!` 
          : `📧 Verification code sent to registered email (${maskTarget(targetToSend)})!`);
        return;
      }

      // --- B. NORMAL REGISTRATION OR LOGIN MODE ---
      const method = pendingEmailRegistration?.method || (isValidEmail(inputVal) ? 'email' : 'sms');

      if (method === 'sms') {
        inputVal = inputVal.replace(/\D/g, '');
        if (!inputVal.startsWith('09') || inputVal.length !== 11) {
          if (errorEl) {
            errorEl.textContent = 'Please enter a valid 11-digit mobile number starting with 09 (e.g. 09123456789).';
            errorEl.classList.remove('hidden');
          }
          if (receiverInput) receiverInput.focus();
          return;
        }
      } else {
        if (!inputVal || !isValidEmail(inputVal)) {
          if (errorEl) {
            errorEl.textContent = 'Please enter a valid email address (e.g. name@gmail.com).';
            errorEl.classList.remove('hidden');
          }
          if (receiverInput) receiverInput.focus();
          return;
        }
      }

      if (errorEl) errorEl.classList.add('hidden');

      sendCodeBtn.disabled = true;
      sendCodeBtn.textContent = 'Sending...';

      const res = method === 'sms'
        ? await generateSmsVerificationOtp(inputVal, role)
        : await generateEmailVerificationOtp(inputVal, role);

      if (!res.success) {
        sendCodeBtn.disabled = false;
        sendCodeBtn.textContent = 'Send Code';
        if (errorEl) {
          errorEl.textContent = res.error || 'Failed to dispatch verification code.';
          errorEl.classList.remove('hidden');
        }
        return;
      }

      if (!pendingEmailRegistration) {
        pendingEmailRegistration = { isLoginMode: true, isForgotMode: false, role, method };
      }
      if (method === 'sms') {
        pendingEmailRegistration.phone = inputVal;
        pendingEmailRegistration.target = inputVal;
      } else {
        pendingEmailRegistration.email = inputVal;
        pendingEmailRegistration.target = inputVal;
      }

      if (targetEmailDisplay) targetEmailDisplay.textContent = inputVal;
      if (dispatchedNotice) dispatchedNotice.classList.remove('hidden');

      digits.forEach(d => {
        d.value = '';
        d.classList.remove('filled');
      });
      if (digits[0]) digits[0].focus();

      startOtpResendCountdown();
      showToast(method === 'sms' 
        ? `📱 Verification code sent via SMS to ${inputVal}!` 
        : `📧 Verification code sent to ${inputVal}!`);
    });
  }

  // Setup digit inputs keyboard navigation and paste handling
  digits.forEach((input, idx) => {
    input.addEventListener('input', () => {
      const val = input.value.replace(/\D/g, '');
      input.value = val ? val.slice(-1) : '';

      input.classList.toggle('filled', !!input.value);
      if (errorEl) errorEl.classList.add('hidden');

      if (input.value && idx < digits.length - 1) {
        digits[idx + 1].focus();
      }

      const currentCode = Array.from(digits).map(d => d.value).join('');
      if (currentCode.length === 6) {
        if (verifyBtn) verifyBtn.focus();
      }
    });

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Backspace') {
        if (!input.value && idx > 0) {
          digits[idx - 1].focus();
          digits[idx - 1].value = '';
          digits[idx - 1].classList.remove('filled');
        } else {
          input.value = '';
          input.classList.remove('filled');
        }
      } else if (e.key === 'ArrowLeft' && idx > 0) {
        digits[idx - 1].focus();
      } else if (e.key === 'ArrowRight' && idx < digits.length - 1) {
        digits[idx + 1].focus();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        doVerifyOtp();
      }
    });

    input.addEventListener('paste', (e) => {
      e.preventDefault();
      const pasteText = (e.clipboardData || window.clipboardData).getData('text');
      const numericDigits = pasteText.replace(/\D/g, '').slice(0, 6);
      if (numericDigits.length > 0) {
        digits.forEach((d, i) => {
          if (i < numericDigits.length) {
            d.value = numericDigits[i];
            d.classList.add('filled');
          } else {
            d.value = '';
            d.classList.remove('filled');
          }
        });
        const nextIdx = Math.min(numericDigits.length, digits.length - 1);
        digits[nextIdx].focus();
        if (numericDigits.length === 6) {
          if (verifyBtn) verifyBtn.focus();
        }
      }
    });
  });

  // Cancel / back button
  if (cancelBtn) {
    cancelBtn.addEventListener('click', () => {
      closeEmailVerificationModal();
    });
  }

  // Resend OTP button
  if (resendBtn) {
    resendBtn.addEventListener('click', async () => {
      const method = pendingEmailRegistration?.method || 'sms';
      const targetToResend = method === 'sms'
        ? (pendingEmailRegistration?.phone || receiverInput?.value.trim())
        : (pendingEmailRegistration?.email || receiverInput?.value.trim());

      if (!targetToResend) {
        if (errorEl) {
          errorEl.textContent = `Please provide a valid ${method === 'sms' ? 'mobile number' : 'email address'} to resend.`;
          errorEl.classList.remove('hidden');
        }
        return;
      }

      resendBtn.disabled = true;
      resendBtn.textContent = 'Sending...';

      const role = pendingEmailRegistration?.role || selectedLoginRole;
      const newOtp = method === 'sms'
        ? await generateSmsVerificationOtp(targetToResend, role)
        : await generateEmailVerificationOtp(targetToResend, role);

      if (newOtp.success) {
        if (targetEmailDisplay) targetEmailDisplay.textContent = maskTarget(targetToResend);
        if (dispatchedNotice) dispatchedNotice.classList.remove('hidden');

        digits.forEach(d => {
          d.value = '';
          d.classList.remove('filled');
        });
        if (digits[0]) digits[0].focus();

        startOtpResendCountdown();
        showToast(method === 'sms' 
          ? `📱 New code sent via SMS to ${maskTarget(targetToResend)}!` 
          : `📧 New code sent to ${maskTarget(targetToResend)}!`);
      } else {
        resendBtn.disabled = false;
        resendBtn.textContent = 'Resend Verification Code';
        if (errorEl) {
          errorEl.textContent = newOtp.error || 'Failed to resend code.';
          errorEl.classList.remove('hidden');
        }
      }
    });
  }

  // Do verify OTP logic
  const doVerifyOtp = async () => {
    const isForgot = !!pendingEmailRegistration?.isForgotMode;
    const isCodeVerified = !!pendingEmailRegistration?.codeVerified;

    // A. If FORGOT PASSWORD and code was already verified: Save New Password
    if (isForgot && isCodeVerified) {
      const newPwd = document.getElementById('otp-new-password')?.value || '';
      const confPwd = document.getElementById('otp-confirm-password')?.value || '';

      if (newPwd.length < 4) {
        if (errorEl) {
          errorEl.textContent = 'New password must be at least 4 characters long.';
          errorEl.classList.remove('hidden');
        }
        return;
      }
      if (newPwd !== confPwd) {
        if (errorEl) {
          errorEl.textContent = 'Passwords do not match.';
          errorEl.classList.remove('hidden');
        }
        return;
      }

      verifyBtn.disabled = true;
      verifyBtn.textContent = 'UPDATING PASSWORD...';

      const resetTarget = pendingEmailRegistration.username || pendingEmailRegistration.target || pendingEmailRegistration.phone || pendingEmailRegistration.email;
      const role = pendingEmailRegistration.role || selectedLoginRole;

      const resetRes = await resetUserPassword(resetTarget, newPwd, role);
      verifyBtn.disabled = false;
      verifyBtn.textContent = 'UPDATE PASSWORD';

      if (!resetRes.success) {
        if (errorEl) {
          errorEl.textContent = resetRes.error || 'Failed to update password.';
          errorEl.classList.remove('hidden');
        }
        return;
      }

      closeEmailVerificationModal();
      showToast(`🎉 Password updated successfully! Please log in.`);

      // Pre-fill username on login screen
      const loginUserEl = document.getElementById('input-username');
      if (loginUserEl && resetRes.username) {
        loginUserEl.value = resetRes.username;
      }
      switchView('view-login');
      const loginPwdEl = document.getElementById('input-password');
      if (loginPwdEl) {
        setTimeout(() => loginPwdEl.focus(), 300);
      }
      return;
    }

    // B. Verify entered OTP code
    const method = pendingEmailRegistration?.method || 'sms';
    const target = pendingEmailRegistration?.target || (method === 'sms' ? pendingEmailRegistration?.phone : pendingEmailRegistration?.email) || '';

    if (!target) {
      if (errorEl) {
        errorEl.textContent = isForgot 
          ? 'Please enter your username and click "Send Code" first.' 
          : `Please enter your ${method === 'sms' ? 'mobile number' : 'email address'} and click "Send Code".`;
        errorEl.classList.remove('hidden');
      }
      return;
    }

    const enteredCode = Array.from(digits).map(d => d.value).join('');
    if (enteredCode.length < 6) {
      if (errorEl) {
        errorEl.textContent = `Please enter the complete 6-digit verification code.`;
        errorEl.classList.remove('hidden');
      }
      return;
    }

    if (verifyBtn) {
      verifyBtn.disabled = true;
      verifyBtn.textContent = 'VERIFYING CODE...';
    }

    const verifyResult = await verifyOtp(target, enteredCode, method);
    if (!verifyResult.success) {
      if (verifyBtn) {
        verifyBtn.disabled = false;
        verifyBtn.textContent = isForgot 
          ? 'VERIFY CODE' 
          : (pendingEmailRegistration?.isLoginMode ? 'VERIFY & SIGN IN' : 'VERIFY & ACTIVATE ACCOUNT');
      }
      if (errorEl) {
        errorEl.textContent = verifyResult.error;
        errorEl.classList.remove('hidden');
      }
      return;
    }

    // C. If FORGOT PASSWORD: OTP verified! Transition to New Password inputs
    if (isForgot) {
      pendingEmailRegistration.codeVerified = true;
      if (verifyBtn) {
        verifyBtn.disabled = false;
        verifyBtn.textContent = 'UPDATE PASSWORD';
      }
      if (errorEl) errorEl.classList.add('hidden');
      if (modalTitle) modalTitle.textContent = 'Set New Password';
      if (digitsLabel) digitsLabel.textContent = 'Verification Code Confirmed ✓';
      if (resetSection) resetSection.classList.remove('hidden');
      if (dispatchedNotice) dispatchedNotice.classList.add('hidden');

      const newPwdInput = document.getElementById('otp-new-password');
      if (newPwdInput) newPwdInput.focus();
      return;
    }

    // D. If LOGIN MODE: Authenticate account directly
    if (pendingEmailRegistration?.isLoginMode) {
      if (verifyBtn) verifyBtn.textContent = 'SIGNING IN...';
      const roleToUse = pendingEmailRegistration.role || selectedLoginRole;
      const loginRes = await loginWithEmailVerification(target, roleToUse);

      if (verifyBtn) {
        verifyBtn.disabled = false;
        verifyBtn.textContent = 'VERIFY & SIGN IN';
      }

      if (!loginRes.success) {
        if (errorEl) {
          errorEl.textContent = loginRes.error;
          errorEl.classList.remove('hidden');
        }
        return;
      }

      closeEmailVerificationModal();
      showLoggedInState(loginRes.user);
      showToast(`✅ Welcome, ${loginRes.user.full_name || loginRes.user.username} (${loginRes.user.role})!`);
      switchView('view-scan');
      return;
    }

    // E. If REGISTRATION MODE: Persist new account
    if (verifyBtn) verifyBtn.textContent = 'ACTIVATING ACCOUNT...';

    const regResult = await registerUser({
      fullName: pendingEmailRegistration.fullName,
      username: pendingEmailRegistration.username,
      password: pendingEmailRegistration.password,
      email: pendingEmailRegistration.email || '',
      phone: pendingEmailRegistration.phone || '',
      verificationMethod: method,
      role: pendingEmailRegistration.role || 'Passenger'
    });

    if (verifyBtn) {
      verifyBtn.disabled = false;
      verifyBtn.textContent = 'VERIFY & ACTIVATE ACCOUNT';
    }

    if (!regResult.success) {
      if (errorEl) {
        errorEl.textContent = regResult.error;
        errorEl.classList.remove('hidden');
      }
      return;
    }

    // Registration Success
    const roleName = pendingEmailRegistration.role || 'Passenger';
    const userName = pendingEmailRegistration.username;
    closeEmailVerificationModal();

    showToast(`🎉 Verified via ${method === 'sms' ? 'SMS' : 'Email'}! ${roleName} account created.`);

    // Clear signup form
    ['signup-fullname', 'signup-contact', 'signup-phone', 'signup-email', 'signup-username', 'signup-password', 'signup-confirm'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });

    // Auto-fill login screen and switch to login
    const loginUserField = document.getElementById('input-username');
    if (loginUserField) loginUserField.value = userName;
    applyLoginRoleTheme(roleName);

    switchView('view-login');

    const loginPwdField = document.getElementById('input-password');
    if (loginPwdField) {
      setTimeout(() => loginPwdField.focus(), 300);
    }
  };

  if (verifyBtn) {
    verifyBtn.addEventListener('click', doVerifyOtp);
  }
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

    const headerEnforcerBadge = document.getElementById('header-enforcer-badge');
    if (headerEnforcerBadge) headerEnforcerBadge.classList.add('hidden');
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
    updateFareMatrixButtonsUI();

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
/* ==========================================================================
   Handle Direct URL Verification (Google Lens / Phone Camera QR Scan)
   ========================================================================== */
async function handleIncomingUrlVerification(rawUrl) {
  if (!rawUrl) return;

  // 1. Immediately parse parameters from the QR URL so the screen displays instantly
  let record = parseQRCode(rawUrl);
  let isFoundInDb = false;

  currentVerifiedRecord = record;
  renderVerificationDashboard(record);
  switchView('view-verification');
  showToast('🔍 Verifying ' + (record.vehicleType || 'Pedicab') + ' Unit (' + (record.plateNo || '') + ')...');

  // 2. Query Supabase for latest live database record
  try {
    const dbRow = await fetchFranchiseByPlate(record.plateNo, rawUrl);
    if (dbRow) {
      record = dbRowToRecord(dbRow, rawUrl);
      isFoundInDb = true;
    } else {
      if (record.driver && record.driver !== '—' && record.operator && record.operator !== '—') {
        record.fromDatabase = true;
      } else {
        record.fromDatabase = false;
        record.status = 'Unregistered';
        record.availability = 'Unregistered';
        record.vehicleTitle = (record.vehicleType || 'Pedicab') + ' Unregistered Unit';
      }
    }
  } catch (err) {
    console.warn('Live DB verification notice:', err);
  }

  currentVerifiedRecord = record;
  saveScanToHistory(record);
  renderVerificationDashboard(record);
  switchView('view-verification');

  if (isFoundInDb || (record.driver && record.driver !== '—')) {
    if (/suspend/i.test(record.status) || /suspend/i.test(record.availability)) {
      showToast('⛔ Verified Unit (' + record.plateNo + ') — DRIVER SUSPENDED');
    } else if (/expired/i.test(record.status)) {
      showToast('⚠️ Verified Unit (' + record.plateNo + ') - EXPIRED PERMIT');
    } else {
      showToast('✅ Verified Active ' + (record.vehicleType || 'Pedicab') + ' Unit (' + record.plateNo + ')');
    }
  } else {
    showToast('⚠️ ' + (record.vehicleType || 'Pedicab') + ' Unregistered Unit (' + (record.plateNo || 'QR') + ')');
  }
}

async function handleScannedCode(rawText) {
  if (!rawText) return;

  console.log('SCANNED RAW CODE:', rawText);
  showToast('🔍 Verifying QR Code...');

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
      record.status = 'Unregistered';
      record.availability = 'Unregistered';
      record.vehicleTitle = `${record.vehicleType || 'Pedicab'} Unregistered Unit`;
    }
  } catch (err) {
    console.warn('Database lookup notice:', err);
  }

  currentVerifiedRecord = record;
  saveScanToHistory(record);
  renderVerificationDashboard(record);

  if (isFoundInDb) {
    if (/suspend/i.test(record.status) || /suspend/i.test(record.availability)) {
      showToast(`⛔ Verified Unit (${record.plateNo}) — DRIVER SUSPENDED`);
    } else if (/expired/i.test(record.status)) {
      showToast(`⚠️ Verified Unit (${record.plateNo}) - EXPIRED PERMIT`);
    } else {
      showToast(`✅ Verified Active ${record.vehicleType || 'Franchise'} Unit (${record.plateNo})`);
    }
  } else {
    showToast(`⚠️ ${record.vehicleType || 'Pedicab'} Unregistered Unit (${record.plateNo || 'QR'})`);
  }
  switchView('view-verification');
}


/* ==========================================================================
   OFFICIAL TABACCO CITY TRD SELECTIVE VIOLATIONS
   ========================================================================== */
export const TRD_VIOLATIONS = [
  {
    id: 'unregistered_unit',
    title: 'Unregistered Pedalled/Motorized Tricycle',
    shortTitle: 'Unregistered Unit',
    desc: 'Operating without valid initial registration or annual renewal',
    pedicabFine: 300,
    tricycleFine: 500,
    icon: '📄'
  },
  {
    id: 'unlicensed_driver',
    title: 'Unlicensed Driver / Uncarried DL',
    shortTitle: 'Unlicensed Driver',
    desc: 'Driving without a valid driver license or failing to carry physical license',
    pedicabFine: 300,
    tricycleFine: 500,
    icon: '🪪'
  },
  {
    id: 'unfranchised_colorum',
    title: 'Unfranchised OPN/Colorum',
    shortTitle: 'Colorum Unit',
    desc: 'Commercial passenger operation without an approved MTOP franchise',
    pedicabFine: 500,
    tricycleFine: 1000,
    icon: '🚫'
  },
  {
    id: 'invalid_expired_dl',
    title: 'Invalid or suspended / revoked / expired DL',
    shortTitle: 'Expired/Invalid DL',
    desc: 'Driving with an expired, delinquent, or officially suspended license',
    pedicabFine: 300,
    tricycleFine: 500,
    icon: '⚠️'
  },
  {
    id: 'out_of_line',
    title: 'Out of Line',
    shortTitle: 'Out of Line',
    desc: 'Operating beyond permitted route boundary or outside designated zone',
    pedicabFine: 300,
    tricycleFine: 500,
    icon: '🗺️'
  },
  {
    id: 'student_driver_alone',
    title: 'Student Driver not accompanied by a Licensed Driver',
    shortTitle: 'Student Driver Alone',
    desc: 'Student permit holder operating without an accredited licensed driver',
    pedicabFine: 300,
    tricycleFine: 500,
    icon: '🎓'
  },
  {
    id: 'discourteous_driver',
    title: 'Discourteous Driver/Conduct',
    shortTitle: 'Discourteous Conduct',
    desc: 'Arrogant behavior, profanity, or disrespect towards commuting passengers',
    pedicabFine: 300,
    tricycleFine: 300,
    icon: '🗣️'
  },
  {
    id: 'no_or_cr',
    title: 'OR/CR not Carried',
    shortTitle: 'No OR/CR',
    desc: 'Failure to present Official Receipt and Certificate of Registration',
    pedicabFine: 300,
    tricycleFine: 500,
    icon: '📑'
  },
  {
    id: 'permits_not_carried',
    title: 'OFC / PA / Permits not Carried',
    shortTitle: 'Permits not Carried',
    desc: 'Failure to carry Certificate of Public Convenience or Mayor Permit',
    pedicabFine: 300,
    tricycleFine: 500,
    icon: '📁'
  },
  {
    id: 'improvised_plates',
    title: 'Unauthorized Improvised Plates',
    shortTitle: 'Improvised Plates',
    desc: 'Using non-official, homemade, or unregistered vehicle plates',
    pedicabFine: 300,
    tricycleFine: 500,
    icon: '🔢'
  },
  {
    id: 'reckless_driving',
    title: 'Reckless Driving',
    shortTitle: 'Reckless Driving',
    desc: 'Endangering public safety, swerving, or aggressive road operation',
    pedicabFine: 500,
    tricycleFine: 1000,
    icon: '🏎️'
  },
  {
    id: 'overloading_top',
    title: 'Allowing Passenger on Top of MV/ Overloading',
    shortTitle: 'Overloading / Roof Ride',
    desc: 'Carrying passengers on the roof, excess capacity, or hazardous loading',
    pedicabFine: 300,
    tricycleFine: 500,
    icon: '👥'
  },
  {
    id: 'no_early_warning',
    title: 'No Early Warning Devices',
    shortTitle: 'No Warning Device',
    desc: 'Failure to equip required reflective early warning safety devices',
    pedicabFine: 300,
    tricycleFine: 300,
    icon: '🔺'
  },
  {
    id: 'no_front_panel_route',
    title: 'No Front Panel Route',
    shortTitle: 'No Route Sign',
    desc: 'Missing or obscured front panel signage indicating authorized route',
    pedicabFine: 300,
    tricycleFine: 300,
    icon: '🪧'
  },
  {
    id: 'cargo_without_cover',
    title: 'Loaded Cargo Truck without Cover',
    shortTitle: 'Cargo Without Cover',
    desc: 'Transporting loose cargo or aggregates without protective tarpaulin',
    pedicabFine: 300,
    tricycleFine: 500,
    icon: '🚛'
  },
  {
    id: 'illegal_franchise_transfer',
    title: 'Violation of the Sale, Mortgage and Transfer of Franchise',
    shortTitle: 'Illegal Transfer',
    desc: 'Unauthorized conveyance, sale, or mortgage of MTOP franchise permit',
    pedicabFine: 500,
    tricycleFine: 1000,
    icon: '🤝'
  },
  {
    id: 'no_tailgate_sign',
    title: 'No Tailgate / No for hire Sign',
    shortTitle: 'No Tailgate/Hire Sign',
    desc: 'Missing rear safety tailgate markings or official For Hire signage',
    pedicabFine: 300,
    tricycleFine: 300,
    icon: '🛑'
  },
  {
    id: 'no_tariff_display',
    title: 'No Tariff Display',
    shortTitle: 'No Tariff Display',
    desc: 'Failure to visibly post official Tabaco City fare matrix inside vehicle',
    pedicabFine: 300,
    tricycleFine: 300,
    icon: '🏷️'
  },
  {
    id: 'no_pedalled_id',
    title: 'No Pedalled ID',
    shortTitle: 'No Pedalled ID',
    desc: 'Failure to display accredited pedicab driver identification card',
    pedicabFine: 300,
    tricycleFine: 300,
    icon: '🪪'
  },
  {
    id: 'dts_dtio',
    title: 'DTS / DTIO',
    shortTitle: 'DTS/DTIO Infraction',
    desc: 'Violation of Dispatch Terminal System or Daily Terminal Inspection Order',
    pedicabFine: 300,
    tricycleFine: 500,
    icon: '📋'
  },
  {
    id: 'illegal_terminal',
    title: 'Illegal Terminal',
    shortTitle: 'Illegal Terminal',
    desc: 'Operating or barkada queueing outside designated municipal terminals',
    pedicabFine: 300,
    tricycleFine: 500,
    icon: '🚏'
  },
  {
    id: 'illegal_parking',
    title: 'Illegal Parking',
    shortTitle: 'Illegal Parking',
    desc: 'Parking in no-parking zones, pedestrian sidewalks, or blocking roads',
    pedicabFine: 300,
    tricycleFine: 500,
    icon: '🅿️'
  },
  {
    id: 'obstruction',
    title: 'Obstruction',
    shortTitle: 'Traffic Obstruction',
    desc: 'Impeding smooth vehicular traffic flow or loading in travel lanes',
    pedicabFine: 300,
    tricycleFine: 500,
    icon: '🚧'
  },
  {
    id: 'overcharging',
    title: 'Overcharging',
    shortTitle: 'Overcharging',
    desc: 'Demanding or collecting fares higher than the legal municipal fare matrix',
    pedicabFine: 300,
    tricycleFine: 500,
    icon: '💰'
  },
  {
    id: 'refused_convey_passenger',
    title: 'Refused to Convey Passenger',
    shortTitle: 'Refusal to Convey',
    desc: 'Selective passenger pick-up or unjust refusal to transport commuters',
    pedicabFine: 300,
    tricycleFine: 500,
    icon: '🚷'
  },
  {
    id: 'jaywalking',
    title: 'Jaywalking',
    shortTitle: 'Jaywalking',
    desc: 'Crossing streets outside designated pedestrian lanes or ignoring signals',
    pedicabFine: 200,
    tricycleFine: 200,
    icon: '🚶'
  },
  {
    id: 'improper_attire',
    title: 'Unauthorized Wearing Shirt/ Improper Attire',
    shortTitle: 'Improper Attire / No Shoes',
    desc: 'Operating without uniform shirt, wearing slippers, or driving without shoes',
    pedicabFine: 300,
    tricycleFine: 300,
    icon: '👕'
  },
  {
    id: 'no_pedalled_driver_permit',
    title: "No Pedalled Driver's Permit",
    shortTitle: 'No Pedalled Permit',
    desc: 'Operating a non-motorized pedicab without a valid city driver permit',
    pedicabFine: 300,
    tricycleFine: 300,
    icon: '🚲'
  },
  {
    id: 'smoking_while_driving',
    title: 'Smoking While Driving',
    shortTitle: 'Smoking While Driving',
    desc: 'Smoking cigarettes or vapes while operating public conveyance',
    pedicabFine: 300,
    tricycleFine: 500,
    icon: '🚭'
  },
  {
    id: 'no_body_plate_number',
    title: 'No Body Plate Number',
    shortTitle: 'No Body Plate',
    desc: 'Missing, unpainted, or obscured municipal body number on sidecar',
    pedicabFine: 300,
    tricycleFine: 500,
    icon: '🔢'
  },
  {
    id: 'loitering_pedicab',
    title: 'Loitering Pedalled Tricycle',
    shortTitle: 'Loitering Pedicab',
    desc: 'Cruising or loitering along restricted main thoroughfares without passengers',
    pedicabFine: 300,
    tricycleFine: 300,
    icon: '🔄'
  },
  {
    id: 'air_noise_pollution',
    title: 'Violation on Air and Noise Pollution',
    shortTitle: 'Noise/Air Pollution',
    desc: 'Excessive exhaust smoke emissions or open/loud modified mufflers',
    pedicabFine: 300,
    tricycleFine: 500,
    icon: '💨'
  },
  {
    id: 'ordinance_010_2016',
    title: 'Violation on Ordinance 010-2016 (Regulating the Loading and Unloading)',
    shortTitle: 'Ord. 010-2016 (Load/Unload)',
    desc: 'Loading or discharging passengers outside designated yellow bays',
    pedicabFine: 300,
    tricycleFine: 500,
    icon: '🛑'
  }
];

/* ==========================================================================
   OFFICIAL PASSENGER COMPLAINT & VIOLATION TYPES (MULTI-SELECT CHECKLIST)
   ========================================================================== */
export const PASSENGER_VIOLATIONS = [
  {
    id: 'pass_overcharging',
    title: 'Overcharging (Excess Fare)',
    shortTitle: 'Overcharging',
    desc: 'Demanded or collected fare higher than official TRD fare matrix rate',
    icon: '🚨',
    isFareRelated: true
  },
  {
    id: 'pass_refusal_discount',
    title: 'Refusal to Give 20% Discount',
    shortTitle: 'Refusal of Discount',
    desc: 'Denied mandatory 20% discount to Students, Senior Citizens, or PWDs',
    icon: '🎫',
    isFareRelated: true
  },
  {
    id: 'pass_over_speeding',
    title: 'Over Speeding / Fast Driving',
    shortTitle: 'Over Speeding',
    desc: 'Driving dangerously fast or racing above local city speed limit',
    icon: '⚡'
  },
  {
    id: 'pass_abusive_language',
    title: 'Abusive Language / Cursing / Arrogance',
    shortTitle: 'Abusive Language',
    desc: 'Rude, shouting, profane, or disrespectful behavior towards passengers',
    icon: '🤬'
  },
  {
    id: 'pass_drunk_driving',
    title: 'Drunk Driving / Intoxication',
    shortTitle: 'Drunk Driving',
    desc: 'Suspected driving while under the influence of alcohol or substances',
    icon: '🍺'
  },
  {
    id: 'pass_harassment',
    title: 'Harassment / Threatening Conduct',
    shortTitle: 'Harassment',
    desc: 'Physical, verbal, or sexual harassment, intimidation, or coercion',
    icon: '⚠️'
  },
  {
    id: 'pass_wrong_destination',
    title: 'Wrong Destination / Refusal to Convey',
    shortTitle: 'Wrong Destination',
    desc: 'Refused route, left before destination, or dropped off at wrong place',
    icon: '📍'
  },
  {
    id: 'pass_reckless_driving',
    title: 'Reckless / Careless Driving',
    shortTitle: 'Reckless Driving',
    desc: 'Sudden swerving, beating red lights, or endangering passenger safety',
    icon: '🚸'
  },
  {
    id: 'pass_overloading',
    title: 'Overloading of Passengers',
    shortTitle: 'Overloading',
    desc: 'Carrying more passengers than authorized vehicle seating capacity',
    icon: '👥'
  },
  {
    id: 'pass_colorum',
    title: 'No City Franchise / Colorum Unit',
    shortTitle: 'Colorum Unit',
    desc: 'Operating without valid Tabaco City franchise permit or body plate',
    icon: '⛔'
  },
  {
    id: 'pass_no_tariff',
    title: 'No Fare Matrix Displayed',
    shortTitle: 'No Tariff Displayed',
    desc: 'Failure to visibly display official TRD fare matrix inside vehicle',
    icon: '📋'
  },
  {
    id: 'pass_out_of_line',
    title: 'Operating Out of Line',
    shortTitle: 'Out of Line',
    desc: 'Operating beyond authorized barangay route or terminal boundaries',
    icon: '🔄'
  }
];

const selectedViolationIds = new Set();
const modalCheckedViolationIds = new Set();
let modalViolationSearchQuery = '';

function getFineForViolation(violationId, isPedicab) {
  const v = TRD_VIOLATIONS.find(item => item.id === violationId);
  if (!v) return isPedicab ? 300 : 500;
  return isPedicab ? v.pedicabFine : v.tricycleFine;
}

function toggleViolationSelection(violationId) {
  if (selectedViolationIds.has(violationId)) {
    selectedViolationIds.delete(violationId);
  } else {
    selectedViolationIds.add(violationId);
  }
  updateSelectiveViolationUI();
}

function updateSelectiveViolationUI() {
  const isPedicab = (currentVerifiedRecord?.vehicleType || '').toLowerCase().includes('ped');
  const count = selectedViolationIds.size;
  let totalFine = 0;

  selectedViolationIds.forEach(id => {
    totalFine += getFineForViolation(id, isPedicab);
  });

  const formattedFine = '₱' + totalFine.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  // Update on-page stats
  const onpageCountEl = document.getElementById('onpage-selected-count');
  const onpageTotalEl = document.getElementById('onpage-total-fine');
  const modalBadgeEl = document.getElementById('modal-total-fine-badge');

  if (onpageCountEl) onpageCountEl.textContent = count === 1 ? '1 infraction' : `${count} infractions`;
  if (onpageTotalEl) onpageTotalEl.textContent = formattedFine;
  if (modalBadgeEl) modalBadgeEl.textContent = `Total Fine: ${formattedFine}`;

  // Update all chips state across onpage and modal grids
  document.querySelectorAll('.violation-chip[data-id]').forEach(chip => {
    const chipId = chip.getAttribute('data-id');
    const isSelected = selectedViolationIds.has(chipId);
    chip.classList.toggle('selected', isSelected);
    const checkWrap = chip.querySelector('.chip-checkbox-wrap');
    if (checkWrap) {
      checkWrap.innerHTML = isSelected
        ? '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" width="12" height="12"><polyline points="20 6 9 17 4 12"></polyline></svg>'
        : '';
    }
  });

  // Render selected violation pills in summary
  const pillsWrap = document.getElementById('onpage-selected-pills');
  if (pillsWrap) {
    if (count === 0) {
      pillsWrap.innerHTML = '<span style="font-size:0.7rem; opacity:0.75; font-style:italic;">No infractions chosen yet. Tap any item above to select.</span>';
    } else {
      pillsWrap.innerHTML = Array.from(selectedViolationIds).map(id => {
        const v = TRD_VIOLATIONS.find(item => item.id === id);
        if (!v) return '';
        return `<span class="violation-tag-pill">${v.shortTitle || v.title} <button type="button" class="pill-remove-btn" data-remove="${id}">&times;</button></span>`;
      }).join('');

      pillsWrap.querySelectorAll('.pill-remove-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const removeId = e.currentTarget.getAttribute('data-remove');
          if (removeId) {
            selectedViolationIds.delete(removeId);
            updateSelectiveViolationUI();
          }
        });
      });
    }
  }
}

function renderSelectiveViolationGrids() {
  const onpageGrid = document.getElementById('onpage-selective-violation-grid');
  const modalGrid = document.getElementById('modal-selective-violation-grid');

  const generateChipsHtml = () => {
    return TRD_VIOLATIONS.map(v => {
      const isSelected = selectedViolationIds.has(v.id);
      return `
        <div class="violation-chip ${isSelected ? 'selected' : ''}" data-id="${v.id}">
          <div class="chip-checkbox-wrap">
            ${isSelected ? '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" width="12" height="12"><polyline points="20 6 9 17 4 12"></polyline></svg>' : ''}
          </div>
          <div class="chip-info">
            <div class="chip-title-row">
              <span class="chip-title">${v.title}</span>
            </div>
            <div class="chip-desc">${v.desc}</div>
          </div>
        </div>
      `;
    }).join('');
  };

  const bindChipEvents = (container) => {
    if (!container) return;
    container.querySelectorAll('.violation-chip[data-id]').forEach(chip => {
      chip.addEventListener('click', () => {
        const id = chip.getAttribute('data-id');
        if (id) toggleViolationSelection(id);
      });
    });
  };

  if (onpageGrid) {
    onpageGrid.innerHTML = generateChipsHtml();
    bindChipEvents(onpageGrid);
  }

  if (modalGrid) {
    modalGrid.innerHTML = generateChipsHtml();
    bindChipEvents(modalGrid);
  }

  updateSelectiveViolationUI();
}

/* ==========================================================================
   MULTI-VIOLATION CHECKLIST CONTROLLER (FOR MODAL SUBMISSION)
   ========================================================================== */
function getActiveModalViolationsList() {
  return TRD_VIOLATIONS;
}

function updateModalChecklistUI() {
  const user = getCurrentUser();
  const isEnforcer = user?.role === 'Traffic Enforcer';
  const sourceList = getActiveModalViolationsList();
  const isPedicab = (currentVerifiedRecord?.vehicleType || '').toLowerCase().includes('ped');
  const count = modalCheckedViolationIds.size;

  // 1. Update Counter Badge & Clear Button
  const countBadge = document.getElementById('checklist-selected-counter');
  const clearBtn = document.getElementById('btn-checklist-clear');
  if (countBadge) {
    countBadge.textContent = count === 1 ? '1 selected' : `${count} selected`;
    countBadge.classList.toggle('has-count', count > 0);
  }
  if (clearBtn) {
    clearBtn.classList.toggle('hidden', count === 0);
  }

  // 2. Update Checklist Cards Active State
  document.querySelectorAll('#violation-checklist-grid .checklist-item-card[data-id]').forEach(card => {
    const id = card.getAttribute('data-id');
    const isChecked = modalCheckedViolationIds.has(id);
    card.classList.toggle('is-checked', isChecked);
    card.setAttribute('aria-checked', isChecked ? 'true' : 'false');
  });

  // 3. Update Selected Summary Tag Pills
  const pillsRow = document.getElementById('checklist-selected-pills');
  if (pillsRow) {
    if (count === 0) {
      pillsRow.innerHTML = '<span class="empty-pills-placeholder">No violations checked yet. Check one or more above.</span>';
    } else {
      const themeClass = isEnforcer ? 'theme-enforcer' : 'theme-passenger';
      pillsRow.innerHTML = Array.from(modalCheckedViolationIds).map(id => {
        const item = sourceList.find(v => v.id === id);
        if (!item) return '';
        return `
          <span class="checklist-tag-chip ${themeClass}">
            <span>${item.shortTitle || item.title}</span>
            <button type="button" class="tag-chip-remove" data-remove="${id}" title="Remove violation">&times;</button>
          </span>
        `;
      }).join('');

      pillsRow.querySelectorAll('.tag-chip-remove').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const removeId = btn.getAttribute('data-remove');
          if (removeId) {
            modalCheckedViolationIds.delete(removeId);
            updateModalChecklistUI();
          }
        });
      });
    }
  }

  // 4. Dynamic Fare Wrap Display
  const fareWrap = document.getElementById('field-fare-wrap');
  if (fareWrap && !isEnforcer) {
    const hasFareIssue = Array.from(modalCheckedViolationIds).some(id => {
      const item = sourceList.find(v => v.id === id);
      return Boolean(item?.isFareRelated);
    });
    fareWrap.classList.toggle('hidden', !hasFareIssue && count > 0);
  }
}

function renderModalViolationChecklist(searchQuery = '') {
  const user = getCurrentUser();
  const isEnforcer = user?.role === 'Traffic Enforcer';
  const sourceList = getActiveModalViolationsList();
  const gridEl = document.getElementById('violation-checklist-grid');
  if (!gridEl) return;

  const q = (searchQuery || '').trim().toLowerCase();
  const filtered = q
    ? sourceList.filter(v => (v.title && v.title.toLowerCase().includes(q)) || (v.desc && v.desc.toLowerCase().includes(q)) || (v.shortTitle && v.shortTitle.toLowerCase().includes(q)))
    : sourceList;

  if (filtered.length === 0) {
    gridEl.innerHTML = `<div style="text-align:center; padding:18px 10px; color:#94a3b8; font-size:0.75rem;">No matching violations found for "${searchQuery}".</div>`;
    return;
  }

  gridEl.innerHTML = filtered.map(v => {
    const isChecked = modalCheckedViolationIds.has(v.id);
    return `
      <div class="checklist-item-card ${isChecked ? 'is-checked' : ''}" data-id="${v.id}" role="checkbox" aria-checked="${isChecked}">
        <div class="checklist-checkbox-box">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" width="12" height="12">
            <polyline points="20 6 9 17 4 12"></polyline>
          </svg>
        </div>
        <div class="checklist-item-body">
          <div class="checklist-item-title-row">
            <span class="checklist-item-title">${v.title}</span>
          </div>
          <div class="checklist-item-desc">${v.desc || ''}</div>
        </div>
      </div>
    `;
  }).join('');

  gridEl.querySelectorAll('.checklist-item-card[data-id]').forEach(card => {
    card.addEventListener('click', () => {
      const id = card.getAttribute('data-id');
      if (!id) return;
      if (modalCheckedViolationIds.has(id)) {
        modalCheckedViolationIds.delete(id);
      } else {
        modalCheckedViolationIds.add(id);
        const sectionEl = document.getElementById('violation-checklist-section');
        if (sectionEl) sectionEl.classList.remove('has-error');
      }
      updateModalChecklistUI();
    });
  });

  updateModalChecklistUI();
}

function setupModalChecklistControls() {
  const searchInput = document.getElementById('checklist-search-input');
  const searchClearBtn = document.getElementById('btn-checklist-search-clear');
  const clearAllBtn = document.getElementById('btn-checklist-clear');

  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      modalViolationSearchQuery = e.target.value;
      if (searchClearBtn) searchClearBtn.classList.toggle('hidden', !modalViolationSearchQuery);
      renderModalViolationChecklist(modalViolationSearchQuery);
    });
  }

  if (searchClearBtn) {
    searchClearBtn.addEventListener('click', () => {
      if (searchInput) {
        searchInput.value = '';
        modalViolationSearchQuery = '';
        searchClearBtn.classList.add('hidden');
        renderModalViolationChecklist('');
      }
    });
  }

  if (clearAllBtn) {
    clearAllBtn.addEventListener('click', () => {
      modalCheckedViolationIds.clear();
      updateModalChecklistUI();
      showToast('Checklist cleared.');
    });
  }
}

async function handleEnforcerIssueCitation(openModalForEvidence = false) {
  if (!isLoggedIn()) {
    showToast('⚠️ Please log in as a Traffic Enforcer.');
    applyLoginRoleTheme('Traffic Enforcer');
    switchView('view-login');
    return;
  }

  const user = getCurrentUser();
  if (user?.role !== 'Traffic Enforcer') {
    showToast('⛔ Only authorized Traffic Enforcers can issue citations.');
    return;
  }

  if (selectedViolationIds.size === 0) {
    showToast('⚠️ Please select at least one violation before issuing citation.');
    const cardEl = document.getElementById('enforcer-selective-violations-card');
    if (cardEl) {
      cardEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      cardEl.style.transition = 'all 0.3s ease';
      cardEl.style.boxShadow = '0 0 0 3px #ef4444';
      setTimeout(() => { cardEl.style.boxShadow = ''; }, 1500);
    }
    return;
  }

  // Photo evidence is required for traffic enforcers: always open citation modal to capture or attach evidence
  openReportModalForCurrentUser('violation');
  showToast('📷 Photo evidence is required. Please capture or attach a photo of the violation.');
  return;

  const isPedicab = (currentVerifiedRecord?.vehicleType || '').toLowerCase().includes('ped');
  const selectedItems = Array.from(selectedViolationIds).map(id => TRD_VIOLATIONS.find(v => v.id === id)).filter(Boolean);
  const violationTitles = selectedItems.map(v => v.title).join(', ');
  const totalFine = selectedItems.reduce((sum, v) => sum + (isPedicab ? v.pedicabFine : v.tricycleFine), 0);
  const location = document.getElementById('onpage-enforcer-location')?.value || 'Tabaco City Commercial Center';
  const remarks = document.getElementById('onpage-enforcer-remarks')?.value || '';
  const citationNo = 'CIT-' + Date.now().toString().slice(-6);

  const payload = {
    report_type: violationTitles,
    plate_no: currentVerifiedRecord?.plateNo || '—',
    driver_name: currentVerifiedRecord?.driver || 'Apprehended Driver',
    operator_name: currentVerifiedRecord?.operator || 'Registered Operator',
    vehicle_type: currentVerifiedRecord?.vehicleType || (isPedicab ? 'Pedicab' : 'Tricycle'),
    reporter_name: user?.full_name || user?.username || 'TRD Traffic Enforcer',
    reporter_username: user?.username || '',
    reporter_role: 'Traffic Enforcer',
    fine_amount: totalFine,
    location: location,
    citation_no: citationNo,
    enforcer_badge: user?.username ? `TRD-ENF-${user.username}` : 'TRD-ENF-001',
    description: [
      `Selective Infractions: ${violationTitles}`,
      `Total Fine: ₱${totalFine}`,
      `Location: ${location}`,
      remarks ? `Officer Remarks: ${remarks}` : ''
    ].filter(Boolean).join(' | '),
    attachment: null
  };

  showToast('⏳ Registering citation ticket...');

  try {
    await submitViolationReport(payload);
  } catch (err) {
    console.warn('Submit citation background note:', err);
  }

  // Setup and display success dialog
  const successModal = document.getElementById('success-modal');
  const successTitle = document.getElementById('success-modal-title');
  const successSub = document.getElementById('success-modal-sub');
  const successAttachInfo = document.getElementById('success-attachment-info');

  if (successTitle) successTitle.textContent = 'Citation Registered';
  if (successSub) {
    successSub.textContent = `Official TRD citation registered for ${payload.vehicle_type} Plate #${payload.plate_no}. Infractions: ${violationTitles}.`;
  }
  if (successAttachInfo) successAttachInfo.classList.add('hidden');
  if (successModal) successModal.classList.remove('hidden');

  // Reset selected violations & inputs
  selectedViolationIds.clear();
  updateSelectiveViolationUI();
  const locInput = document.getElementById('onpage-enforcer-location');
  const remInput = document.getElementById('onpage-enforcer-remarks');
  if (locInput) locInput.value = '';
  if (remInput) remInput.value = '';

  // Immediately refresh officer citation logs and status notifications
  loadAndRenderNotifications(true);
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
  const pillEl = document.getElementById('verified-status-pill');
  const pillTextEl = document.getElementById('verified-status-text');

  const rawStatus = (record.status || (isLiveInDb ? 'Active' : 'Unregistered')).trim();
  const rawAvail = (record.availability || '').trim();
  const isSuspended = /suspend/i.test(rawStatus) || /suspend/i.test(rawAvail) || (record.raw && /suspend/i.test(record.raw));
  const isExpired = /expire/i.test(rawStatus) || /expire/i.test(rawAvail);
  const isActiveRegistered = (isLiveInDb || (record.operator && record.operator !== "—" && record.driver && record.driver !== "—")) && !isSuspended && !isExpired && !/unregistered|inactive|revoked/i.test(rawStatus);

  if (titleEl) {
    if (isSuspended) {
      titleEl.textContent = `${vehicleType} Suspended Unit`;
    } else if (isActiveRegistered) {
      titleEl.textContent = `${vehicleType} Verified Unit`;
    } else if (isLiveInDb) {
      titleEl.textContent = `${vehicleType} Unit (${rawStatus})`;
    } else {
      titleEl.textContent = `${vehicleType} Unregistered Unit`;
    }
  }

  const statusIconEl = document.getElementById('verified-status-icon');
  if (pillTextEl) {
    if (isSuspended) {
      pillTextEl.textContent = 'SUSPENDED DRIVER';
    } else if (isActiveRegistered) {
      pillTextEl.textContent = 'REGISTERED DRIVER';
    } else if (isExpired) {
      pillTextEl.textContent = 'EXPIRED PERMIT';
    } else {
      pillTextEl.textContent = 'UNREGISTERED DRIVER';
    }
  }

  if (pillEl) {
    pillEl.classList.remove('registered', 'unregistered', 'expired', 'suspended');
    if (isSuspended) {
      pillEl.classList.add('suspended');
    } else if (isActiveRegistered) {
      pillEl.classList.add('registered');
    } else if (isExpired) {
      pillEl.classList.add('expired');
    } else {
      pillEl.classList.add('unregistered');
    }
  }

  if (statusIconEl) {
    if (isSuspended) {
      statusIconEl.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="13" height="13">
          <circle cx="12" cy="12" r="10"></circle>
          <line x1="4.93" y1="4.93" x2="19.07" y2="19.07"></line>
        </svg>
      `;
    } else if (isExpired) {
      statusIconEl.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="13" height="13">
          <circle cx="12" cy="12" r="10"></circle>
          <line x1="12" y1="8" x2="12" y2="12"></line>
          <line x1="12" y1="16" x2="12.01" y2="16"></line>
        </svg>
      `;
    } else if (isActiveRegistered) {
      statusIconEl.innerHTML = `
        <svg viewBox="0 0 20 20" fill="currentColor" width="13" height="13">
          <path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd" />
        </svg>
      `;
    } else {
      statusIconEl.innerHTML = `
        <svg viewBox="0 0 20 20" fill="currentColor" width="13" height="13">
          <path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd" />
        </svg>
      `;
    }
  }

  const heroCardEl = document.getElementById('driver-hero-card');
  if (heroCardEl) {
    heroCardEl.classList.toggle('suspended', isSuspended);
  }

  const suspensionAlertEl = document.getElementById('verified-suspension-alert');
  if (suspensionAlertEl) {
    if (isSuspended) {
      suspensionAlertEl.classList.remove('hidden');
      const descEl = document.getElementById('verified-suspension-desc');
      if (descEl && record.sanctionReason) {
        descEl.textContent = `Administrative Suspension: ${record.sanctionReason}. Operating privileges revoked.`;
      }
    } else {
      suspensionAlertEl.classList.add('hidden');
    }
  }

  const avatarCheck = document.getElementById('driver-avatar-check');
  if (avatarCheck) {
    avatarCheck.style.display = isActiveRegistered ? 'flex' : 'none';
  }

  const opEl = document.getElementById('val-operator');
  if (opEl) opEl.textContent = record.operator || '—';

  const drEl = document.getElementById('val-driver');
  if (drEl) drEl.textContent = record.driver || '—';

  const idEl = document.getElementById('val-driver-id');
  if (idEl) {
    idEl.textContent = record.driverId || (record.plateNo && record.plateNo !== '—' ? `TRD-${String(record.plateNo).replace(/^[A-Za-z]+-?/, '') || record.plateNo}` : 'TRD-0482');
  }

  const licenseRefEl = document.getElementById('val-license-ref');
  if (licenseRefEl) {
    licenseRefEl.textContent = record.driverLicenseRef || record.licenseNo || (record.plateNo && record.plateNo !== '—' ? `TRD-DRV-${String(record.plateNo).replace(/^[A-Za-z]+-?/, '') || record.plateNo}` : 'TRD-DRV-0482');
  }

  const roleEl = document.getElementById('val-driver-role');
  if (roleEl) {
    roleEl.textContent = record.driverRole || 'Authorized Driver';
  }

  // Driver Photo rendering
  const photoImg = document.getElementById('val-driver-photo');
  const photoFallback = document.getElementById('val-driver-photo-fallback');
  const photoWrap = document.getElementById('val-driver-photo-wrap');

  if (record.driverPhoto) {
    if (photoImg) {
      photoImg.src = record.driverPhoto;
      photoImg.classList.remove('hidden');
    }
    if (photoFallback) photoFallback.classList.add('hidden');
    if (photoWrap) {
      photoWrap.style.cursor = 'pointer';
      photoWrap.title = 'Click to enlarge driver photo';
      photoWrap.onclick = () => openDriverPhotoModal(record);
    }
  } else {
    if (photoImg) {
      photoImg.src = '';
      photoImg.classList.add('hidden');
    }
    if (photoFallback) photoFallback.classList.remove('hidden');
    if (photoWrap) {
      photoWrap.style.cursor = 'pointer';
      photoWrap.title = 'Click to preview driver details';
      photoWrap.onclick = () => openDriverPhotoModal(record);
    }
  }

  const plEl = document.getElementById('val-plate');
  if (plEl) plEl.textContent = record.plateNo || '—';

  const rtEl = document.getElementById('val-route');
  if (rtEl) rtEl.textContent = record.route || 'Tabaco City Route';

  const expEl = document.getElementById('val-expiry');
  if (expEl) expEl.textContent = record.expiry || '2026-12-31';

  const tourEl = document.getElementById('val-tourist');
  if (tourEl) {
    const isYes = String(record.touristGuide || 'Yes').trim().toLowerCase() === 'yes';
    if (isYes) {
      tourEl.className = 'trd-tourist-yes-badge';
      tourEl.innerHTML = `<span class="tourist-dot">●</span> Yes`;
    } else {
      tourEl.className = 'trd-tourist-no-badge';
      tourEl.innerHTML = `<span class="tourist-dot-muted">○</span> No`;
    }
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
      openReportModalForCurrentUser(isEnforcer ? 'violation' : 'passenger');
    });
  }

  const onpageIssueBtn = document.getElementById('btn-onpage-issue-citation');
  if (onpageIssueBtn) {
    onpageIssueBtn.addEventListener('click', () => {
      handleEnforcerIssueCitation(false);
    });
  }

  const onpageOpenModalBtn = document.getElementById('btn-onpage-open-modal');
  if (onpageOpenModalBtn) {
    onpageOpenModalBtn.addEventListener('click', () => {
      handleEnforcerIssueCitation(true);
    });
  }

  const rescanBtn = document.getElementById('btn-rescan-code');
  if (rescanBtn) {
    rescanBtn.addEventListener('click', () => {
      switchView('view-scan');
    });
  }

  // Demo Record Testing Listeners
  document.querySelectorAll('.btn-test-plate').forEach(btn => {
    btn.addEventListener('click', () => {
      const plate = btn.getAttribute('data-plate');
      if (plate) {
        handleScannedCode(plate);
      }
    });
  });

  // Driver Photo Modal Close Listeners
  const closePhotoBtn = document.getElementById('btn-close-driver-photo');
  const photoBackdrop = document.getElementById('driver-photo-modal-backdrop');
  const closePhotoModal = () => {
    const modal = document.getElementById('driver-photo-modal');
    if (modal) modal.classList.add('hidden');
  };
  if (closePhotoBtn) closePhotoBtn.addEventListener('click', closePhotoModal);
  if (photoBackdrop) photoBackdrop.addEventListener('click', closePhotoModal);
}

function openDriverPhotoModal(record) {
  if (!record) return;
  const modal = document.getElementById('driver-photo-modal');
  const imgEl = document.getElementById('driver-photo-modal-img');
  const nameEl = document.getElementById('driver-photo-modal-name');
  const plateEl = document.getElementById('driver-photo-modal-plate');

  if (imgEl) {
    imgEl.src = record.driverPhoto || '/pedicab.png';
  }
  if (nameEl) nameEl.textContent = record.driver && record.driver !== '—' ? record.driver : 'Authorized Driver';
  if (plateEl) plateEl.textContent = `Unit: ${record.plateNo || '—'} • ${record.vehicleType || 'Conveyance'}`;
  if (modal) modal.classList.remove('hidden');
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

export function updateFareMatrixButtonsUI() {
  const violationBtn = document.getElementById('btn-fare-violation');
  const buttonsRow = document.querySelector('.fare-buttons-row');
  const user = getCurrentUser();
  const loggedIn = isLoggedIn();
  // Remove the violation button if logged in as Passenger; if not logged in (or logged in as Enforcer), do not remove it
  const isPassenger = loggedIn && (user?.role === 'Passenger' || (user?.role && user.role !== 'Traffic Enforcer'));

  if (violationBtn) {
    violationBtn.classList.toggle('hidden', Boolean(isPassenger));
  }
  if (buttonsRow) {
    buttonsRow.classList.toggle('has-single-btn', Boolean(isPassenger));
  }
}

function renderFareMatrixPage(vehicleTypeMode, searchQuery = '') {
  updateFareMatrixButtonsUI();
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
  updateFareMatrixButtonsUI();

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
      openReportModalForCurrentUser('overcharging', 'Overcharging (Excess Fare)');
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
export const PASSENGER_REPORT_TYPES = [
  'Over speeding',
  'Abusive language/cursing (nangmumura)',
  'Drunk Driving',
  'Dropping off passenger at the wrong destination',
  'Harassment',
  'Overcharging (Excess Fare)'
];

function updatePassengerFareInputVisibility() {
  const fareWrap = document.getElementById('field-fare-wrap');
  const actualFareInput = document.getElementById('report-actual-fare');
  const reportTypeSelect = document.getElementById('report-type');
  const user = getCurrentUser();
  const isEnforcer = user?.role === 'Traffic Enforcer';

  if (!fareWrap || !actualFareInput) return;

  if (isEnforcer) {
    fareWrap.classList.add('hidden');
    actualFareInput.required = false;
    actualFareInput.value = '';
    return;
  }

  const selectedVal = (reportTypeSelect?.value || '').toLowerCase();
  const isOvercharging = selectedVal.includes('overcharging');

  if (isOvercharging) {
    fareWrap.classList.remove('hidden');
    actualFareInput.required = true;
  } else {
    fareWrap.classList.add('hidden');
    actualFareInput.required = false;
    actualFareInput.value = '';
  }
}

function openReportModalForCurrentUser(reportCategory = 'passenger', defaultType = null) {
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
  const checklistLabel = document.getElementById('checklist-main-label');

  if (modalEl) {
    modalEl.classList.toggle('theme-enforcer-modal', isEnforcer);
  }

  if (titleEl) {
    if (isEnforcer) {
      titleEl.textContent = isViolationCategory ? 'Official TRD Traffic Citation' : 'Official TRD Overcharging Citation';
    } else {
      titleEl.textContent = 'Submit Passenger Report';
    }
  }

  if (checklistLabel) {
    const titleSpan = checklistLabel.querySelector('.label-title');
    const hintSpan = checklistLabel.querySelector('.label-hint');
    if (titleSpan) titleSpan.textContent = isEnforcer ? 'Select TRD Infractions' : 'Select Violations';
    if (hintSpan) hintSpan.textContent = isEnforcer ? 'Check one or multiple official TRD infractions to cite this unit' : 'Check all violations / issues that occurred (multiple choice)';
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
  const attachTag = document.getElementById('report-attachment-tag');
  const cameraBtnText = document.getElementById('btn-camera-text');
  const uploadBtnText = document.getElementById('btn-upload-text');

  if (attachLabel) {
    attachLabel.textContent = isEnforcer ? 'Attach Photo Evidence (Required)' : 'Attach Proof / Fare Receipt';
  }
  if (attachTag) {
    if (isEnforcer) {
      attachTag.textContent = 'Required';
      attachTag.className = 'attachment-required-badge';
    } else {
      attachTag.textContent = 'Optional';
      attachTag.className = 'attachment-optional-tag';
    }
  }
  if (cameraBtnText) {
    cameraBtnText.textContent = isEnforcer ? '📷 Snap Evidence Photo' : 'Take Photo';
  }
  if (uploadBtnText) {
    uploadBtnText.textContent = isEnforcer ? '📁 Upload Photo Evidence' : 'Upload Receipt / File';
  }

  // Toggle views between Enforcer (Multi-Violation Checklist) and Passenger (Single Issue Dropdown)
  const passengerWrap = document.getElementById('field-passenger-report-type-wrap');
  const checklistSection = document.getElementById('violation-checklist-section');

  if (isEnforcer) {
    if (passengerWrap) passengerWrap.classList.add('hidden');
    if (checklistSection) checklistSection.classList.remove('hidden');

    // Reset & Populate Enforcer Multi-Violation Checklist
    modalCheckedViolationIds.clear();
    modalViolationSearchQuery = '';
    const searchInput = document.getElementById('checklist-search-input');
    const searchClearBtn = document.getElementById('btn-checklist-search-clear');
    if (searchInput) searchInput.value = '';
    if (searchClearBtn) searchClearBtn.classList.add('hidden');

    // Pre-populate if violations were selected on-page
    if (selectedViolationIds.size > 0) {
      selectedViolationIds.forEach(id => modalCheckedViolationIds.add(id));
    } else if (reportCategory === 'overcharging') {
      modalCheckedViolationIds.add('excess_fare');
    }

    if (defaultType) {
      const match = TRD_VIOLATIONS.find(v => v.title === defaultType || v.shortTitle === defaultType || v.id === defaultType);
      if (match) modalCheckedViolationIds.add(match.id);
    }

    renderModalViolationChecklist('');
    updateModalChecklistUI();
  } else {
    // Passenger Mode: Hide checklist, show standard complaint dropdown
    if (passengerWrap) passengerWrap.classList.remove('hidden');
    if (checklistSection) checklistSection.classList.add('hidden');

    const reportTypeSelect = document.getElementById('report-type');
    if (reportTypeSelect) {
      reportTypeSelect.innerHTML = PASSENGER_REPORT_TYPES.map(opt => `<option value="${opt}">${opt}</option>`).join('\n        ');
      if (defaultType && PASSENGER_REPORT_TYPES.includes(defaultType)) {
        reportTypeSelect.value = defaultType;
      } else if (reportCategory === 'overcharging') {
        reportTypeSelect.value = 'Overcharging (Excess Fare)';
      }
    }
  }

  const enforcerBadgeWrap = document.getElementById('field-enforcer-badge-wrap');
  const citationWrap = document.getElementById('field-citation-wrap');
  const submitBtn = document.getElementById('btn-report-submit');

  // Enforcer does NOT need manual badge or manual driver input (already scanned)
  if (enforcerBadgeWrap) enforcerBadgeWrap.classList.add('hidden');
  if (citationWrap) citationWrap.classList.add('hidden');

  // Show actual fare input ONLY if passenger chooses Overcharging report
  updatePassengerFareInputVisibility();

  if (submitBtn) {
    submitBtn.classList.toggle('modal-enforcer-btn', isEnforcer);
    submitBtn.textContent = isEnforcer ? '👮 Issue Official Citation' : 'Submit Report to TRD Office';
  }

  document.getElementById('report-modal').classList.remove('hidden');
}

/* ==========================================================================
   Modals
   ========================================================================== */
function setupModals() {
  setupModalChecklistControls();
  setupEmailVerificationModal();

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

  const reportTypeSelect = document.getElementById('report-type');
  if (reportTypeSelect) {
    reportTypeSelect.addEventListener('change', () => {
      updatePassengerFareInputVisibility();
    });
  }

  const reportForm = document.getElementById('report-form');
  if (reportForm) reportForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const user = getCurrentUser();
    const roleName = user?.role || 'Passenger';
    const isEnforcer = roleName === 'Traffic Enforcer';

    let violationTitles = '';

    if (isEnforcer) {
      // Validate that at least one violation is checked for Enforcers
      if (modalCheckedViolationIds.size === 0) {
        showToast('⚠️ Please check at least one violation from the checklist.');
        const checklistSection = document.getElementById('violation-checklist-section');
        if (checklistSection) {
          checklistSection.classList.add('has-error');
          checklistSection.scrollIntoView({ behavior: 'smooth', block: 'center' });
          setTimeout(() => checklistSection.classList.remove('has-error'), 1800);
        }
        return;
      }

      // MANDATORY PHOTO EVIDENCE REQUIREMENT FOR ENFORCERS
      if (!currentReportAttachment || !currentReportAttachment.dataUrl) {
        showToast('⚠️ Photo evidence is required for traffic violation citations.');
        const sectionContainer = document.getElementById('report-attachment-section');
        if (sectionContainer) {
          sectionContainer.classList.add('has-error');
          sectionContainer.scrollIntoView({ behavior: 'smooth', block: 'center' });
          setTimeout(() => sectionContainer.classList.remove('has-error'), 2500);
        }
        return;
      }

      const selectedItems = Array.from(modalCheckedViolationIds).map(id => TRD_VIOLATIONS.find(v => v.id === id)).filter(Boolean);
      violationTitles = selectedItems.map(v => v.title).join(', ');
    } else {
      // Passenger selected issue from dropdown
      violationTitles = document.getElementById('report-type')?.value || 'Over speeding';
    }

    const isPedicab = (currentVerifiedRecord?.vehicleType || '').toLowerCase().includes('ped');
    const actualFare = parseFloat(document.getElementById('report-actual-fare')?.value) || null;
    const enforcerBadge = document.getElementById('report-enforcer-id')?.value || '';
    const citationNo = document.getElementById('report-citation-no')?.value || ('CIT-' + Date.now().toString().slice(-6));
    const remarks = document.getElementById('report-remarks')?.value || '';

    const payload = {
      report_type: violationTitles,
      plate_no: currentVerifiedRecord?.plateNo || '—',
      driver_name: currentVerifiedRecord?.driver || 'Official Driver',
      operator_name: currentVerifiedRecord?.operator || 'Registered Operator',
      vehicle_type: currentVerifiedRecord?.vehicleType || (isPedicab ? 'Pedicab' : 'Tricycle'),
      reporter_name: user?.full_name || user?.username || (isEnforcer ? 'TRD Enforcer' : 'Passenger'),
      reporter_username: user?.username || '',
      reporter_role: roleName,
      fare_charged: actualFare,
      enforcer_badge: enforcerBadge || (isEnforcer ? (user?.username ? `TRD-ENF-${user.username}` : 'TRD-ENF-001') : ''),
      citation_no: citationNo,
      description: remarks ? `${remarks} | ${isEnforcer ? 'Cited Violations' : 'Reported Issue'}: ${violationTitles}` : `${isEnforcer ? 'Cited Violations' : 'Reported Issue'}: ${violationTitles}`,
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
        ? `Official TRD citation registered for ${payload.vehicle_type} Plate #${payload.plate_no}. Infractions: ${violationTitles}.`
        : `Your complaint for ${payload.vehicle_type} Plate #${payload.plate_no} has been registered with TRD Office. Issue: ${violationTitles}.`;
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

    showToast(isEnforcer ? `✅ Traffic citation registered with ${modalCheckedViolationIds.size} infractions.` : `✅ Passenger report submitted.`);
    clearReportAttachment();
    modalCheckedViolationIds.clear();
    selectedViolationIds.clear();
    updateSelectiveViolationUI();

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

  // 6. Periodic background refresh (for status updates and unread badges)
  if (notifPollInterval) clearInterval(notifPollInterval);
  notifPollInterval = setInterval(() => {
    if (isLoggedIn()) {
      loadAndRenderNotifications(false);
    }
  }, 4000);
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

    const hasAdminResponse = Boolean(item.adminResponse && item.adminResponse.trim().length > 0);
    const adminResponseText = hasAdminResponse ? item.adminResponse.trim() : null;
    const formattedAdminDate = item.adminUpdatedAt ? new Date(item.adminUpdatedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : null;

    return `
      <div class="notif-item-card ${cardStatusClass} ${isUnread ? 'is-unread' : ''}" data-id="${item.id}">
        <div class="notif-card-header">
          <span class="notif-category-tag">${item.category || (isEnforcer ? 'Official Citation' : 'Complaint Report')}</span>
          <span class="notif-status-badge ${badgeClass}">
            <span class="badge-dot"></span>
            <span>${item.status || 'Pending'}</span>
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

        <!-- Official TRD Admin Response Box (Prominent & Real-Time) -->
        ${hasAdminResponse ? `
          <div class="notif-admin-box status-${item.statusType || 'info'}">
            <div class="notif-admin-box-header">
              <div class="admin-header-title">
                <span>🏛️</span>
                <strong>Official TRD Admin Response</strong>
              </div>
              <span class="admin-status-tag ${badgeClass}">${item.status}</span>
            </div>
            <div class="notif-admin-box-message">${adminResponseText}</div>
            ${formattedAdminDate ? `<div class="notif-admin-box-date">Decision timestamp: ${formattedAdminDate}</div>` : ''}
          </div>
        ` : `
          <div class="notif-admin-box status-warning">
            <div class="notif-admin-box-header">
              <div class="admin-header-title">
                <span>⏳</span>
                <strong>TRD Administration Review</strong>
              </div>
              <span class="admin-status-tag badge-warning">${item.status || 'Pending Review'}</span>
            </div>
            <div class="notif-admin-box-message text-muted">Awaiting TRD Officer administrative action. Case status is currently marked as <strong>${item.status || 'Pending'}</strong>.</div>
          </div>
        `}

        <!-- User Original Filed Report Box -->
        <div class="notif-user-box">
          <span class="user-box-label">${isEnforcer ? 'Apprehension Citation Details:' : 'Your Filed Report / Incident Details:'}</span>
          <p class="user-box-content">${item.description || 'Report queued for TRD administrative review.'}</p>
        </div>

        ${item.evidenceImage ? `
          <div class="notif-evidence-box">
            <a href="${item.evidenceImage}" target="_blank" rel="noopener noreferrer" class="evidence-thumb-link">
              <img src="${item.evidenceImage}" alt="Evidence" class="evidence-thumb-img" onerror="this.style.display='none'" />
              <span>📎 View Attached Proof (${item.evidenceFilename || 'Photo'})</span>
            </a>
          </div>
        ` : ''}

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
