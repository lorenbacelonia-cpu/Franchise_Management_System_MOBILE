/**
 * Tabaco City TRD - Verifier Authentication
 * Uses 2 separate Supabase tables with support for username, email, fullname, password, and email verification:
 * 1. 'account_enforcer_mobile' (for Traffic Enforcer accounts)
 * 2. 'account_passenger_mobile' (for Passenger accounts)
 */
import { supabase } from './supabase.js';

const SESSION_KEY = 'trd_verifier_user';
const LOCAL_ENFORCERS_KEY = 'trd_local_account_enforcer_mobile';
const LOCAL_PASSENGERS_KEY = 'trd_local_account_passenger_mobile';
const OTP_STORAGE_PREFIX = 'trd_otp_pending_';

// Official System Sender Email
export const SYSTEM_SENDER_EMAIL = 'lorenbacelonia@gmail.com';

// Primary table names in Supabase
const ENFORCER_TABLES = ['account_enforcer_mobile', 'account_enforcermobile', 'mobile_enforcers'];
const PASSENGER_TABLES = ['account_passenger_mobile', 'account_passengermobile', 'mobile_passengers'];

// Default pre-seeded accounts with official emails
export const DEFAULT_ENFORCERS = [
  {
    id: 'seed_enf_1',
    username: 'enforcer',
    email: 'enforcer@trd.tabacocity.gov.ph',
    fullname: 'Officer Juan Dela Cruz',
    password: 'enforcer123',
    email_verified: true
  },
  {
    id: 'seed_enf_2',
    username: 'andrie',
    email: 'andrie@trd.tabacocity.gov.ph',
    fullname: 'Andrie Barasona',
    password: 'andrie123',
    email_verified: true
  },
  {
    id: 'seed_enf_3',
    username: 'admin',
    email: 'admin@trd.tabacocity.gov.ph',
    fullname: 'TRD Admin Officer',
    password: 'admin123',
    email_verified: true
  }
];

export const DEFAULT_PASSENGERS = [
  {
    id: 'seed_pass_1',
    username: 'passenger',
    email: 'passenger@gmail.com',
    fullname: 'Maria Santos',
    password: 'passenger123',
    email_verified: true
  },
  {
    id: 'seed_pass_2',
    username: 'pedro',
    email: 'pedro@gmail.com',
    fullname: 'Pedro Penduko',
    password: 'pedro123',
    email_verified: true
  }
];

export function getLocalAccounts(isEnforcer) {
  const key = isEnforcer ? LOCAL_ENFORCERS_KEY : LOCAL_PASSENGERS_KEY;
  const defaults = isEnforcer ? DEFAULT_ENFORCERS : DEFAULT_PASSENGERS;
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : [...defaults];
  } catch {
    return [...defaults];
  }
}

export function saveLocalAccount(isEnforcer, user) {
  const key = isEnforcer ? LOCAL_ENFORCERS_KEY : LOCAL_PASSENGERS_KEY;
  try {
    const list = getLocalAccounts(isEnforcer);
    const idx = list.findIndex(u => 
      (u.username && user.username && u.username.toLowerCase() === user.username.toLowerCase()) ||
      (u.email && user.email && u.email.toLowerCase() === user.email.toLowerCase())
    );
    if (idx >= 0) {
      list[idx] = { ...list[idx], ...user };
    } else {
      list.push(user);
    }
    localStorage.setItem(key, JSON.stringify(list));
  } catch (err) {
    console.warn('Local storage error:', err);
  }
}

/**
 * Format string so every word has its first letter capitalized (Formal Title Case)
 * e.g., "maria santos" -> "Maria Santos"
 */
export function formatFormalName(str) {
  if (!str) return '';
  return str
    .toLowerCase()
    .split(' ')
    .filter(Boolean)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * Format string so the first letter is capitalized (Formal Case)
 * e.g., "enforcer" -> "Enforcer", "maria" -> "Maria"
 */
export function formatFormalUsername(str) {
  if (!str) return '';
  const trimmed = str.trim();
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

/**
 * Basic email format verification
 */
export function isValidEmail(email) {
  if (!email || typeof email !== 'string') return false;
  const trimmed = email.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(trimmed);
}

/* ==========================================================================
   Email Verification OTP Dispatch & Validation (Gmail Delivery)
   ========================================================================== */

/**
 * Generate a 6-digit OTP code and dispatch it to the user's Gmail inbox
 * via local SMTP (/api/send-verification), FormSubmit relay, and Supabase Auth.
 * @param {string} email
 * @param {string} role ('Passenger' | 'Traffic Enforcer')
 */
export function generateVerificationOtp(email, role = 'Passenger') {
  if (!isValidEmail(email)) {
    return { success: false, error: 'Please enter a valid Gmail or email address.' };
  }

  const cleanEmail = email.trim().toLowerCase();
  const code = String(Math.floor(100000 + Math.random() * 900000));
  const expiresAt = Date.now() + 10 * 60 * 1000; // 10 minutes validity

  const otpData = {
    code,
    email: cleanEmail,
    role,
    expiresAt,
    createdAt: Date.now()
  };

  try {
    sessionStorage.setItem(`${OTP_STORAGE_PREFIX}${cleanEmail}`, JSON.stringify(otpData));
  } catch (e) {
    console.warn('Failed to store OTP in sessionStorage:', e);
  }

  // 1. Dispatch via local Vite /api/send-verification (Nodemailer Gmail SMTP)
  fetch('/api/send-verification', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: SYSTEM_SENDER_EMAIL,
      to: cleanEmail,
      code: code,
      role: role
    })
  }).catch(() => {});

  // 2. Dispatch via FormSubmit AJAX relay targeting the receiver's Gmail
  fetch(`https://formsubmit.co/ajax/${encodeURIComponent(cleanEmail)}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    },
    body: JSON.stringify({
      _subject: `TRD ${role} Verification Code: ${code}`,
      _captcha: 'false',
      _template: 'box',
      _replyto: SYSTEM_SENDER_EMAIL,
      from_system_sender: SYSTEM_SENDER_EMAIL,
      recipient_email: cleanEmail,
      account_role: role,
      system: 'TRD Tabaco City Franchise Management Mobile System',
      verification_code: code,
      message: `Your TRD ${role} Security Verification Code is: ${code}. Sent from official system dispatch ${SYSTEM_SENDER_EMAIL} to ${cleanEmail}.`
    })
  }).catch(() => {});

  // 3. Also trigger Supabase Auth OTP in background if configured
  try {
    supabase.auth.signInWithOtp({
      email: cleanEmail,
      options: { shouldCreateUser: true }
    }).catch(() => {});
  } catch {}

  return {
    success: true,
    email: cleanEmail,
    sender: SYSTEM_SENDER_EMAIL,
    expiresAt
  };
}

/**
 * Get active pending OTP data for an email address
 */
export function getPendingOtp(email) {
  if (!email) return null;
  const cleanEmail = email.trim().toLowerCase();
  try {
    const raw = sessionStorage.getItem(`${OTP_STORAGE_PREFIX}${cleanEmail}`);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (Date.now() > data.expiresAt) {
      sessionStorage.removeItem(`${OTP_STORAGE_PREFIX}${cleanEmail}`);
      return null;
    }
    return data;
  } catch {
    return null;
  }
}

/**
 * Verify entered 6-digit OTP code received in the user's Gmail
 */
export async function verifyEmailOtp(email, enteredCode) {
  if (!email || !enteredCode) {
    return { success: false, error: 'Please enter the 6-digit verification code from your Gmail.' };
  }

  const cleanEmail = email.trim().toLowerCase();
  const cleanCode = String(enteredCode).trim().replace(/\s+/g, '');
  const pending = getPendingOtp(cleanEmail);

  // 1. Check against dispatched 6-digit code
  if (pending && pending.code === cleanCode) {
    try {
      sessionStorage.removeItem(`${OTP_STORAGE_PREFIX}${cleanEmail}`);
    } catch {}
    return { success: true, email: cleanEmail };
  }

  // 2. Fallback: Check if user entered a token generated directly by Supabase Auth email
  try {
    const { data, error } = await supabase.auth.verifyOtp({
      email: cleanEmail,
      token: cleanCode,
      type: 'email'
    });
    if (!error && data?.user) {
      try {
        sessionStorage.removeItem(`${OTP_STORAGE_PREFIX}${cleanEmail}`);
      } catch {}
      return { success: true, email: cleanEmail };
    }
  } catch {}

  if (!pending) {
    return { success: false, error: 'Verification code has expired or was not sent yet. Please click "Send Code" first.' };
  }

  return { success: false, error: 'Incorrect verification code. Please check the 6-digit code sent to your Gmail inbox (or Spam folder) and try again.' };
}

/**
 * Pre-check whether a username or email is already registered in the system
 */
export async function checkAccountAvailability(username, email, role = 'Passenger') {
  const isEnforcer = role === 'Traffic Enforcer';
  const targetTables = isEnforcer ? ENFORCER_TABLES : PASSENGER_TABLES;
  const otherTables = isEnforcer ? PASSENGER_TABLES : ENFORCER_TABLES;
  const targetRoleName = isEnforcer ? 'Traffic Enforcer' : 'Passenger';
  const otherRoleName = isEnforcer ? 'Passenger' : 'Traffic Enforcer';

  const cleanUsername = username ? username.trim().toLowerCase() : '';
  const cleanEmail = email ? email.trim().toLowerCase() : '';

  // 1. Check local accounts first
  const localTarget = getLocalAccounts(isEnforcer);
  if (cleanUsername && localTarget.some(u => u.username && u.username.toLowerCase() === cleanUsername)) {
    return { available: false, error: `Username "${username}" is already taken in ${targetRoleName}s.` };
  }
  if (cleanEmail && localTarget.some(u => u.email && u.email.toLowerCase() === cleanEmail)) {
    return { available: false, error: `Email "${email}" is already registered in ${targetRoleName}s.` };
  }

  const localOther = getLocalAccounts(!isEnforcer);
  if (cleanUsername && localOther.some(u => u.username && u.username.toLowerCase() === cleanUsername)) {
    return { available: false, error: `Username "${username}" is already registered as a ${otherRoleName}. Please log in or use a different username.` };
  }
  if (cleanEmail && localOther.some(u => u.email && u.email.toLowerCase() === cleanEmail)) {
    return { available: false, error: `Email "${email}" is already registered as a ${otherRoleName}. Please log in or switch tabs.` };
  }

  // 2. Check Supabase target table
  for (const table of targetTables) {
    try {
      if (cleanUsername) {
        const { data: userExists } = await supabase
          .from(table)
          .select('username')
          .ilike('username', cleanUsername)
          .limit(1);

        if (userExists && userExists.length > 0) {
          return { available: false, error: `Username "${username}" is already taken in ${targetRoleName}s.` };
        }
      }

      if (cleanEmail) {
        const { data: emailExists, error: emailErr } = await supabase
          .from(table)
          .select('email')
          .ilike('email', cleanEmail)
          .limit(1);

        if (!emailErr && emailExists && emailExists.length > 0) {
          return { available: false, error: `Email "${email}" is already registered in ${targetRoleName}s.` };
        }
      }
    } catch {
      /* continue */
    }
  }

  // 3. Check Supabase other role table
  for (const table of otherTables) {
    try {
      if (cleanUsername) {
        const { data: userExists } = await supabase
          .from(table)
          .select('username')
          .ilike('username', cleanUsername)
          .limit(1);

        if (userExists && userExists.length > 0) {
          return { available: false, error: `Username "${username}" is already registered as a ${otherRoleName}.` };
        }
      }

      if (cleanEmail) {
        const { data: emailExists, error: emailErr } = await supabase
          .from(table)
          .select('email')
          .ilike('email', cleanEmail)
          .limit(1);

        if (!emailErr && emailExists && emailExists.length > 0) {
          return { available: false, error: `Email "${email}" is already registered as a ${otherRoleName}.` };
        }
      }
    } catch {
      /* continue */
    }
  }

  return { available: true };
}

/**
 * Register a new user into the corresponding mobile table.
 * Supports email address and verified flag with graceful fallback.
 * @param {string} fullName
 * @param {string} username
 * @param {string} password
 * @param {string} email
 * @param {string} role ('Passenger' | 'Traffic Enforcer')
 */
export async function registerUser(fullName, username, password, email = '', role = 'Passenger') {
  if (!fullName || !username || !password) {
    return { success: false, error: 'Full name, username, and password are required.' };
  }

  if (email && !isValidEmail(email)) {
    return { success: false, error: 'Please enter a valid email address.' };
  }

  if (password.length < 4) {
    return { success: false, error: 'Password must be at least 4 characters.' };
  }

  const isEnforcer = role === 'Traffic Enforcer';
  const targetTables = isEnforcer ? ENFORCER_TABLES : PASSENGER_TABLES;
  const formalUsername = formatFormalUsername(username);
  const cleanUsername = username.trim().toLowerCase();
  const cleanEmail = email ? email.trim().toLowerCase() : '';
  const formalFullName = formatFormalName(fullName);
  const assignedRole = isEnforcer ? 'Traffic Enforcer' : 'Passenger';

  // 1. Check availability
  const check = await checkAccountAvailability(cleanUsername, cleanEmail, role);
  if (!check.available) {
    return { success: false, error: check.error };
  }

  // 2. Prepare payload with email & email_verified
  const fullAccountData = {
    username: formalUsername,
    fullname: formalFullName,
    password: password
  };
  if (cleanEmail) {
    fullAccountData.email = cleanEmail;
    fullAccountData.email_verified = true;
  }

  // Minimal fallback payload if table doesn't have email column yet
  const minimalAccountData = {
    username: formalUsername,
    fullname: formalFullName,
    password: password
  };

  // 3. Attempt insert into Supabase
  for (const table of targetTables) {
    try {
      let { data: inserted, error: insertErr } = await supabase
        .from(table)
        .insert([fullAccountData])
        .select();

      // If email column does not exist yet (code 42703), retry with minimal columns
      if (insertErr && (insertErr.code === '42703' || String(insertErr.message).includes('email'))) {
        console.warn(`Supabase notice: Table [${table}] does not have 'email' column yet. Retrying without it.`);
        const retry = await supabase
          .from(table)
          .insert([minimalAccountData])
          .select();
        inserted = retry.data;
        insertErr = retry.error;
      }

      if (!insertErr && inserted && inserted.length > 0) {
        const user = inserted[0];
        const finalUser = {
          ...user,
          email: cleanEmail || user.email || '',
          email_verified: true
        };
        saveLocalAccount(isEnforcer, finalUser);
        return {
          success: true,
          user: {
            id: finalUser.id,
            username: finalUser.username,
            full_name: finalUser.fullname || formalFullName,
            email: finalUser.email,
            email_verified: true,
            role: assignedRole
          }
        };
      }
    } catch (err) {
      console.warn(`Insert error on ${table}:`, err);
    }
  }

  // 4. Fallback save to local accounts cache
  const localUser = {
    id: 'usr_' + Date.now(),
    username: formalUsername,
    fullname: formalFullName,
    email: cleanEmail,
    email_verified: true,
    password: password
  };
  saveLocalAccount(isEnforcer, localUser);

  return {
    success: true,
    user: {
      id: localUser.id,
      username: localUser.username,
      full_name: formalFullName,
      email: cleanEmail,
      email_verified: true,
      role: assignedRole
    }
  };
}

/**
 * Log in by querying 'account_enforcer_mobile' or 'account_passenger_mobile'.
 * Supports logging in with EITHER Username OR Email!
 */
export async function loginUser(identifier, password, selectedRole = 'Passenger') {
  if (!identifier || !password) {
    return { success: false, error: 'Please enter your username/email and password.' };
  }

  const isEnforcer = selectedRole === 'Traffic Enforcer';
  const targetTables = isEnforcer ? ENFORCER_TABLES : PASSENGER_TABLES;
  const otherTables = isEnforcer ? PASSENGER_TABLES : ENFORCER_TABLES;
  const targetRoleName = isEnforcer ? 'Traffic Enforcer' : 'Passenger';
  const otherRoleName = isEnforcer ? 'Passenger' : 'Traffic Enforcer';

  const cleanIdentifier = identifier.trim().toLowerCase();
  const isInputEmail = isValidEmail(cleanIdentifier);

  const queryUserFromTable = async (table) => {
    try {
      if (isInputEmail) {
        try {
          const { data, error } = await supabase
            .from(table)
            .select('*')
            .ilike('email', cleanIdentifier)
            .limit(1);

          if (!error && data && data.length > 0) return data[0];
        } catch {}
      }

      const { data: userByUname, error: unameErr } = await supabase
        .from(table)
        .select('*')
        .ilike('username', cleanIdentifier)
        .limit(1);

      if (!unameErr && userByUname && userByUname.length > 0) {
        return userByUname[0];
      }

      try {
        const { data: userByEmail, error: emailErr } = await supabase
          .from(table)
          .select('*')
          .ilike('email', cleanIdentifier)
          .limit(1);

        if (!emailErr && userByEmail && userByEmail.length > 0) {
          return userByEmail[0];
        }
      } catch {}

      return null;
    } catch {
      return null;
    }
  };

  // 1. Query target role table in Supabase
  for (const table of targetTables) {
    const user = await queryUserFromTable(table);
    if (user) {
      if (user.password !== password) {
        return { success: false, error: 'Incorrect password. Please try again.' };
      }

      const sessionUser = {
        id: user.id,
        username: user.username,
        email: user.email || (isInputEmail ? cleanIdentifier : ''),
        full_name: user.fullname || user.username,
        role: targetRoleName
      };

      sessionStorage.setItem(SESSION_KEY, JSON.stringify(sessionUser));
      try { localStorage.setItem(SESSION_KEY, JSON.stringify(sessionUser)); } catch {}
      saveLocalAccount(isEnforcer, user);
      return { success: true, user: sessionUser };
    }
  }

  // 2. Check if account exists in the other role table
  for (const table of otherTables) {
    const otherUser = await queryUserFromTable(table);
    if (otherUser) {
      if (otherUser.password === password) {
        const sessionUser = {
          id: otherUser.id,
          username: otherUser.username,
          email: otherUser.email || (isInputEmail ? cleanIdentifier : ''),
          full_name: otherUser.fullname || otherUser.username,
          role: otherRoleName
        };
        sessionStorage.setItem(SESSION_KEY, JSON.stringify(sessionUser));
        try { localStorage.setItem(SESSION_KEY, JSON.stringify(sessionUser)); } catch {}
        saveLocalAccount(!isEnforcer, otherUser);
        return { success: true, user: sessionUser, switchedRole: otherRoleName };
      }
      return {
        success: false,
        error: `This account is registered as "${otherRoleName}". Please enter the correct password or switch to the ${otherRoleName} tab.`
      };
    }
  }

  // 3. Check local accounts cache
  const localTargetList = getLocalAccounts(isEnforcer);
  const foundTarget = localTargetList.find(u => 
    (u.username && u.username.toLowerCase() === cleanIdentifier) ||
    (u.email && u.email.toLowerCase() === cleanIdentifier)
  );

  if (foundTarget) {
    if (foundTarget.password !== password) {
      return { success: false, error: 'Incorrect password. Please try again.' };
    }

    const sessionUser = {
      id: foundTarget.id,
      username: foundTarget.username,
      email: foundTarget.email || '',
      full_name: foundTarget.fullname || foundTarget.username,
      role: targetRoleName
    };

    sessionStorage.setItem(SESSION_KEY, JSON.stringify(sessionUser));
    return { success: true, user: sessionUser };
  }

  const localOtherList = getLocalAccounts(!isEnforcer);
  const foundOther = localOtherList.find(u => 
    (u.username && u.username.toLowerCase() === cleanIdentifier) ||
    (u.email && u.email.toLowerCase() === cleanIdentifier)
  );

  if (foundOther) {
    return {
      success: false,
      error: `This account is registered under "${otherRoleName}". Please switch to the ${otherRoleName} tab.`
    };
  }

  return { success: false, error: `No ${targetRoleName} account found with that username or email. Please check your credentials or register.` };
}

/**
 * Authenticate user directly after successful Email Verification (for Login / Account Unlock)
 */
export async function loginWithEmailVerification(emailInput, selectedRole = 'Passenger') {
  const cleanEmail = (emailInput || '').trim().toLowerCase();
  if (!cleanEmail) {
    return { success: false, error: 'Please provide a valid email address.' };
  }

  const isEnforcer = selectedRole === 'Traffic Enforcer';
  const targetTables = isEnforcer ? ENFORCER_TABLES : PASSENGER_TABLES;
  const targetRoleName = isEnforcer ? 'Traffic Enforcer' : 'Passenger';

  for (const table of targetTables) {
    try {
      // Check email column
      try {
        const { data, error } = await supabase
          .from(table)
          .select('*')
          .ilike('email', cleanEmail)
          .limit(1);
        if (!error && data && data.length > 0) {
          const user = data[0];
          const sessionUser = {
            id: user.id,
            username: user.username,
            email: user.email || cleanEmail,
            full_name: user.fullname || user.username,
            role: targetRoleName
          };
          sessionStorage.setItem(SESSION_KEY, JSON.stringify(sessionUser));
          try { localStorage.setItem(SESSION_KEY, JSON.stringify(sessionUser)); } catch {}
          return { success: true, user: sessionUser };
        }
      } catch {}

      // Check username column (in case user registered their email as username)
      const { data: byUname, error: unameErr } = await supabase
        .from(table)
        .select('*')
        .ilike('username', cleanEmail)
        .limit(1);
      if (!unameErr && byUname && byUname.length > 0) {
        const user = byUname[0];
        const sessionUser = {
          id: user.id,
          username: user.username,
          email: user.email || cleanEmail,
          full_name: user.fullname || user.username,
          role: targetRoleName
        };
        sessionStorage.setItem(SESSION_KEY, JSON.stringify(sessionUser));
        try { localStorage.setItem(SESSION_KEY, JSON.stringify(sessionUser)); } catch {}
        return { success: true, user: sessionUser };
      }
    } catch {}
  }

  // Check local accounts
  const localList = getLocalAccounts(isEnforcer);
  const foundLocal = localList.find(u =>
    (u.email && u.email.toLowerCase() === cleanEmail) ||
    (u.username && u.username.toLowerCase() === cleanEmail)
  );
  if (foundLocal) {
    const sessionUser = {
      id: foundLocal.id,
      username: foundLocal.username,
      email: foundLocal.email || cleanEmail,
      full_name: foundLocal.fullname || foundLocal.username,
      role: targetRoleName
    };
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(sessionUser));
    try { localStorage.setItem(SESSION_KEY, JSON.stringify(sessionUser)); } catch {}
    return { success: true, user: sessionUser };
  }

  return {
    success: false,
    error: `No registered ${targetRoleName} account found matching "${cleanEmail}". Please create an account first.`
  };
}

/**
 * Log out user & clear session
 */
export function logoutUser() {
  sessionStorage.removeItem(SESSION_KEY);
  try { localStorage.removeItem(SESSION_KEY); } catch {}
}

/**
 * Get current logged in user object
 */
export function getCurrentUser() {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY) || localStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/**
 * Check if a user is logged in
 */
export function isLoggedIn() {
  return getCurrentUser() !== null;
}
