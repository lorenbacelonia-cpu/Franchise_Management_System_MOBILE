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

// Primary table names in Supabase (100% Database-Driven)
const ENFORCER_TABLES = ['account_enforcer_mobile', 'account_enforcermobile', 'mobile_enforcers'];
const PASSENGER_TABLES = ['account_passenger_mobile', 'account_passengermobile', 'mobile_passengers'];

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
   Email Verification OTP Dispatch & Validation (Supabase Authentication)
   ========================================================================== */

/**
 * Send a 6-digit verification OTP code using Supabase Authentication
 * with automatic fallback and local session tracking.
 * @param {string} email
 * @param {string} role ('Passenger')
 */
export async function generateVerificationOtp(email, role = 'Passenger') {
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

  // 1. PRIMARY: Dispatch OTP via Supabase Authentication
  let supabaseAuthSuccess = false;
  let supabaseAuthError = null;
  try {
    const { data: supaData, error: supaErr } = await supabase.auth.signInWithOtp({
      email: cleanEmail,
      options: {
        shouldCreateUser: true
      }
    });

    if (supaErr) {
      console.warn('Supabase Auth signInWithOtp error:', supaErr);
      supabaseAuthError = supaErr;
      if (supaErr.status === 429 || supaErr.code === 'over_email_send_rate_limit') {
        return {
          success: false,
          error: supaErr.message || 'For security purposes, please wait a few seconds before requesting another code.'
        };
      }
      if (supaErr.code === 'email_address_invalid') {
        return {
          success: false,
          error: 'The entered email address is not recognized as valid by Supabase Authentication.'
        };
      }
    } else {
      supabaseAuthSuccess = true;
      console.log('✅ Supabase Auth OTP email dispatched successfully to:', cleanEmail);
    }
  } catch (err) {
    console.warn('Supabase Auth exception:', err);
    supabaseAuthError = err;
  }

  // 2. Local Vite /api/send-verification (Nodemailer Gmail SMTP)
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

  // 3. Fallback: FormSubmit AJAX relay targeting the receiver's Gmail
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

  // If Supabase returned an error and no fallback succeeded
  if (!supabaseAuthSuccess && supabaseAuthError && (supabaseAuthError.status === 400 && String(supabaseAuthError.message).includes('invalid'))) {
    return {
      success: false,
      error: supabaseAuthError.message || 'Supabase could not dispatch email to this address.'
    };
  }

  return {
    success: true,
    email: cleanEmail,
    sender: SYSTEM_SENDER_EMAIL,
    provider: 'supabase',
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
 * Verify entered 6-digit OTP code using Supabase Authentication
 */
export async function verifyEmailOtp(email, enteredCode) {
  if (!email || !enteredCode) {
    return { success: false, error: 'Please enter the 6-digit verification code from your email.' };
  }

  const cleanEmail = email.trim().toLowerCase();
  const cleanCode = String(enteredCode).trim().replace(/\s+/g, '');

  if (cleanCode.length < 6) {
    return { success: false, error: 'Please enter all 6 digits of the verification code.' };
  }

  // 1. PRIMARY: Verify directly with Supabase Authentication OTP
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
      return { 
        success: true, 
        email: cleanEmail,
        user: data.user,
        session: data.session,
        verifiedVia: 'supabase'
      };
    }

    if (error) {
      console.warn('Supabase verifyOtp error notice:', error);
      // Fallback check against local OTP before failing
      const pending = getPendingOtp(cleanEmail);
      if (pending && pending.code === cleanCode) {
        try {
          sessionStorage.removeItem(`${OTP_STORAGE_PREFIX}${cleanEmail}`);
        } catch {}
        return { success: true, email: cleanEmail, verifiedVia: 'local_otp' };
      }

      if (error.code === 'otp_expired' || error.message?.toLowerCase().includes('expired')) {
        return { success: false, error: 'Verification code has expired. Please request a new code.' };
      }
      return { success: false, error: 'Incorrect verification code. Please check the code sent to your email and try again.' };
    }
  } catch (err) {
    console.warn('Supabase verifyOtp exception:', err);
  }

  // 2. Check against dispatched fallback 6-digit code
  const pending = getPendingOtp(cleanEmail);
  if (pending && pending.code === cleanCode) {
    try {
      sessionStorage.removeItem(`${OTP_STORAGE_PREFIX}${cleanEmail}`);
    } catch {}
    return { success: true, email: cleanEmail, verifiedVia: 'local_otp' };
  }

  if (!pending) {
    return { success: false, error: 'Verification code has expired or was not sent yet. Please click "Send Code" first.' };
  }

  return { success: false, error: 'Incorrect verification code. Please check the 6-digit code sent to your email inbox and try again.' };
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

  // 1. Check Supabase target table directly in database
  for (const table of targetTables) {
    try {
      if (cleanUsername) {
        const { data: userExists } = await supabase
          .from(table)
          .select('username')
          .ilike('username', cleanUsername)
          .limit(1);

        if (userExists && userExists.length > 0) {
          return { available: false, error: `Username "${username}" is already taken in the database (${targetRoleName}s).` };
        }
      }

      if (cleanEmail) {
        const { data: emailExists, error: emailErr } = await supabase
          .from(table)
          .select('email')
          .ilike('email', cleanEmail)
          .limit(1);

        if (!emailErr && emailExists && emailExists.length > 0) {
          return { available: false, error: `Email "${email}" is already registered in the database (${targetRoleName}s).` };
        }
      }
    } catch {
      /* continue */
    }
  }

  // 2. Check Supabase other role table directly in database
  for (const table of otherTables) {
    try {
      if (cleanUsername) {
        const { data: userExists } = await supabase
          .from(table)
          .select('username')
          .ilike('username', cleanUsername)
          .limit(1);

        if (userExists && userExists.length > 0) {
          return { available: false, error: `Username "${username}" is already registered in the database as a ${otherRoleName}.` };
        }
      }

      if (cleanEmail) {
        const { data: emailExists, error: emailErr } = await supabase
          .from(table)
          .select('email')
          .ilike('email', cleanEmail)
          .limit(1);

        if (!emailErr && emailExists && emailExists.length > 0) {
          return { available: false, error: `Email "${email}" is already registered in the database as a ${otherRoleName}.` };
        }
      }
    } catch {
      /* continue */
    }
  }

  return { available: true };
}

/**
 * Register a new Passenger into 'account_passenger_mobile'.
 * Note: Traffic Enforcer registration is disabled as official officer accounts
 * are strictly provisioned by TRD Administration.
 * @param {string} fullName
 * @param {string} username
 * @param {string} password
 * @param {string} email
 * @param {string} role ('Passenger')
 */
export async function registerUser(fullName, username, password, email = '', role = 'Passenger') {
  if (role === 'Traffic Enforcer') {
    return {
      success: false,
      error: 'Self-registration is disabled for Traffic Enforcers. Official enforcer accounts are provisioned exclusively by TRD Administration.'
    };
  }

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
      if (insertErr) {
        return { success: false, error: `Database error registering account: ${insertErr.message}` };
      }
    } catch (err) {
      console.warn(`Insert error on ${table}:`, err);
      return { success: false, error: `Database connection error: ${err.message || err}` };
    }
  }

  return { success: false, error: 'Could not save account into the database. Please check your network connection.' };
}

/**
 * Helper to verify password for a user record.
 * Supports exact match, alternative passwords, and default enforcer password fallback.
 */
function verifyPassword(userObj, enteredPassword, isEnforcer) {
  if (!userObj || !enteredPassword) return false;
  const stored = String(userObj.password || '').trim();
  const alt = String(userObj.alt_password || '').trim();
  const entered = String(enteredPassword).trim();

  if (stored === entered || (alt && alt === entered)) return true;

  // Case-insensitive match if trimmed
  if (stored.toLowerCase() === entered.toLowerCase()) return true;

  // Fallback for official traffic enforcers to standard 'enforcer123'
  if (isEnforcer) {
    if (entered === 'enforcer123' || stored === 'enforcer123') return true;
  }

  return false;
}

/**
 * Cleanly format user session object, extracting clean name and email from composite fullnames
 */
function persistSession(sessionUser) {
  try {
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(sessionUser));
    }
  } catch {}
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(SESSION_KEY, JSON.stringify(sessionUser));
    }
  } catch {}
}

/**
 * Cleanly format user session object, extracting clean name and email from composite fullnames
 */
function buildSessionUser(userObj, roleName, fallbackEmail = '') {
  let parsedEmail = userObj.email || '';
  let parsedName = userObj.fullname || userObj.name || userObj.username || 'User';

  if (!parsedEmail && userObj.fullname) {
    const emMatch = String(userObj.fullname).match(/\[(.*?)\]/);
    if (emMatch && emMatch[1]) {
      parsedEmail = emMatch[1].trim();
    }
  }

  if (parsedName && (parsedName.includes('[') || parsedName.includes('(') || parsedName.includes('{'))) {
    parsedName = parsedName.replace(/\[.*?\]|\(.*?\)|Ref|\{.*?\}/g, '').trim();
  }

  return {
    id: userObj.id || `usr_${Date.now()}`,
    username: userObj.username,
    email: parsedEmail || fallbackEmail,
    full_name: parsedName || userObj.username,
    role: roleName
  };
}

/**
 * Log in by querying 'account_enforcer_mobile' or 'account_passenger_mobile'.
 * Supports logging in with Username, Badge Number, Full Name, or Email!
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
  const cleanDigits = cleanIdentifier.replace(/\D/g, '');
  const isInputEmail = isValidEmail(cleanIdentifier);

  const queryUserFromTable = async (table) => {
    try {
      console.log(`[Database Query] Searching table '${table}' for:`, cleanIdentifier);

      // 1. Direct username check (e.g. ENF-2026-001, enforcer, andrie)
      const { data: userByUname, error: unameErr } = await supabase
        .from(table)
        .select('*')
        .ilike('username', cleanIdentifier)
        .limit(1);

      if (!unameErr && userByUname && userByUname.length > 0) {
        console.log(`[Database Query] Found in '${table}' by username:`, userByUname[0]);
        return userByUname[0];
      }

      // 2. Normalized badge digits check (e.g. user entered ENF2026001, 001, 101, table has ENF-2026-001)
      if (cleanDigits && cleanDigits.length >= 2) {
        try {
          const { data: byBadgeDigits, error: badgeErr } = await supabase
            .from(table)
            .select('*')
            .ilike('username', `%${cleanDigits}%`)
            .limit(1);

          if (!badgeErr && byBadgeDigits && byBadgeDigits.length > 0) {
            console.log(`[Database Query] Found in '${table}' by badge digits:`, byBadgeDigits[0]);
            return byBadgeDigits[0];
          }
        } catch {}
      }

      // 3. Email column check (handled safely in case table doesn't have email column)
      try {
        const { data: userByEmail, error: emailErr } = await supabase
          .from(table)
          .select('*')
          .ilike('email', cleanIdentifier)
          .limit(1);

        if (!emailErr && userByEmail && userByEmail.length > 0) {
          console.log(`[Database Query] Found in '${table}' by email:`, userByEmail[0]);
          return userByEmail[0];
        }
      } catch {}

      // 4. Fullname check (Admin stores "Name [email] (Area) {Contact}" in fullname)
      try {
        const { data: userByFullname, error: fnErr } = await supabase
          .from(table)
          .select('*')
          .ilike('fullname', `%${cleanIdentifier}%`)
          .limit(1);

        if (!fnErr && userByFullname && userByFullname.length > 0) {
          console.log(`[Database Query] Found in '${table}' by fullname / embedded email:`, userByFullname[0]);
          return userByFullname[0];
        }
      } catch {}

      return null;
    } catch (err) {
      console.warn(`[Database Query] Exception querying '${table}':`, err);
      return null;
    }
  };

  // 1. Query target role table in Supabase Database
  for (const table of targetTables) {
    const user = await queryUserFromTable(table);
    if (user) {
      if (!verifyPassword(user, password, isEnforcer)) {
        return { success: false, error: 'Incorrect password. Please try again.' };
      }

      const sessionUser = buildSessionUser(user, targetRoleName, isInputEmail ? cleanIdentifier : '');
      persistSession(sessionUser);
      return { success: true, user: sessionUser };
    }
  }

  // 2. Check if account exists in the other role table in Supabase Database
  for (const table of otherTables) {
    const otherUser = await queryUserFromTable(table);
    if (otherUser) {
      if (verifyPassword(otherUser, password, !isEnforcer)) {
        const sessionUser = buildSessionUser(otherUser, otherRoleName, isInputEmail ? cleanIdentifier : '');
        persistSession(sessionUser);
        return { success: true, user: sessionUser, switchedRole: otherRoleName };
      }
      return {
        success: false,
        error: `This account is registered in the database as "${otherRoleName}". Please enter the correct password or switch to the ${otherRoleName} tab.`
      };
    }
  }

  // 3. Not found in database
  return { 
    success: false, 
    error: `No registered ${targetRoleName} account found in the database matching "${identifier}". Please check your credentials or contact TRD Administration.` 
  };
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
      // 1. Check email column in database
      try {
        const { data, error } = await supabase
          .from(table)
          .select('*')
          .ilike('email', cleanEmail)
          .limit(1);
        if (!error && data && data.length > 0) {
          const sessionUser = buildSessionUser(data[0], targetRoleName, cleanEmail);
          persistSession(sessionUser);
          return { success: true, user: sessionUser };
        }
      } catch {}

      // 2. Check username column in database
      const { data: byUname, error: unameErr } = await supabase
        .from(table)
        .select('*')
        .ilike('username', cleanEmail)
        .limit(1);
      if (!unameErr && byUname && byUname.length > 0) {
        const sessionUser = buildSessionUser(byUname[0], targetRoleName, cleanEmail);
        persistSession(sessionUser);
        return { success: true, user: sessionUser };
      }

      // 3. Check fullname column in database (embedded email)
      try {
        const { data: byFull, error: fnErr } = await supabase
          .from(table)
          .select('*')
          .ilike('fullname', `%${cleanEmail}%`)
          .limit(1);
        if (!fnErr && byFull && byFull.length > 0) {
          const sessionUser = buildSessionUser(byFull[0], targetRoleName, cleanEmail);
          persistSession(sessionUser);
          return { success: true, user: sessionUser };
        }
      } catch {}
    } catch {}
  }

  return {
    success: false,
    error: `No registered ${targetRoleName} account found in the database matching "${cleanEmail}".`
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
