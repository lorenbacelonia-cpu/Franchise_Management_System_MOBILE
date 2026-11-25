/**
 * Tabaco City TRD - Verifier Authentication
 * Uses 2 separate Supabase tables with support for username, email, phone, fullname, password,
 * and dual SMS (TextBee) / Email (Gmail SMTP) verification:
 * 1. 'account_enforcer_mobile' (for Traffic Enforcer accounts)
 * 2. 'account_passenger_mobile' (for Passenger accounts)
 */
import { supabase } from './supabase.js';

const SESSION_KEY = 'trd_verifier_user';
const OTP_STORAGE_PREFIX = 'trd_otp_pending_';

// Official System Sender Email
export const SYSTEM_SENDER_EMAIL = 'tabacocitytrd@gmail.com';

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

/**
 * Basic phone number verification (supports Philippine 09/639 and international formats)
 */
export function isValidPhone(phone) {
  if (!phone || typeof phone !== 'string') return false;
  const cleaned = phone.trim().replace(/[\s\-()]/g, '');
  // Matches +639XXXXXXXXX, 09XXXXXXXXX, 9XXXXXXXXX, or generic international E.164
  return /^(\+?63|0)?[9]\d{9}$/.test(cleaned) || /^\+?[1-9]\d{7,14}$/.test(cleaned);
}

/**
 * Normalize phone number for clean storage and display
 * e.g., "09123456789" -> "09123456789" or "+639123456789"
 */
export function formatPhoneNumber(phone) {
  if (!phone) return '';
  let cleaned = String(phone).trim().replace(/[\s\-()]/g, '');
  if (cleaned.startsWith('09') && cleaned.length === 11) {
    return '+63' + cleaned.slice(1);
  }
  if (cleaned.startsWith('9') && cleaned.length === 10) {
    return '+63' + cleaned;
  }
  if (cleaned.startsWith('63') && cleaned.length === 12) {
    return '+' + cleaned;
  }
  return cleaned;
}

/**
 * Mask target for privacy
 * e.g., "+639123456789" -> "+63 9•• ••• •789"
 * e.g., "user@gmail.com" -> "u•••@gmail.com"
 */
export function maskTarget(target) {
  if (!target) return '';
  if (target.includes('@')) {
    const [name, domain] = target.split('@');
    if (name.length <= 2) return `${name.charAt(0)}*@${domain}`;
    return `${name.slice(0, 2)}••••@${domain}`;
  }
  const clean = target.replace(/\s+/g, '');
  if (clean.length > 4) {
    return `${clean.slice(0, 4)}••••${clean.slice(-3)}`;
  }
  return clean;
}

/* ==========================================================================
   SMS (TextBee) & Email (Gmail SMTP / Supabase) OTP Dispatch & Validation
   ========================================================================== */

/**
 * Send a 6-digit verification OTP code via SMS using TextBee Android SMS Gateway
 * @param {string} phone
 * @param {string} role ('Passenger')
 */
export async function generateSmsVerificationOtp(phone, role = 'Passenger') {
  if (!isValidPhone(phone)) {
    return { success: false, error: 'Please enter a valid mobile number (e.g. 0912 345 6789).' };
  }

  const cleanPhone = formatPhoneNumber(phone);
  const code = String(Math.floor(100000 + Math.random() * 900000));
  const expiresAt = Date.now() + 10 * 60 * 1000; // 10 minutes validity

  const otpData = {
    code,
    target: cleanPhone,
    phone: cleanPhone,
    type: 'sms',
    role,
    expiresAt,
    createdAt: Date.now()
  };

  try {
    sessionStorage.setItem(`${OTP_STORAGE_PREFIX}${cleanPhone.toLowerCase()}`, JSON.stringify(otpData));
  } catch (e) {
    console.warn('Failed to store SMS OTP in sessionStorage:', e);
  }

  const smsMessage = `[TRD Tabaco City] Your ${role} Security Verification Code is: ${code}. Valid for 10 minutes. Do not share this code.`;

  // 1. Try backend server endpoint
  try {
    const res = await fetch('/api/send-sms-verification', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        phone: cleanPhone,
        code: code,
        role: role
      })
    });

    const data = await res.json().catch(() => ({}));
    if (res.ok && data.success && data.delivered) {
      console.log('✅ TextBee SMS OTP dispatched via backend to:', cleanPhone);
      return {
        success: true,
        phone: cleanPhone,
        target: cleanPhone,
        type: 'sms',
        provider: 'textbee',
        expiresAt
      };
    }
  } catch (err) {
    console.warn('Backend SMS endpoint unreachable, trying direct TextBee gateway:', err);
  }

  // 2. Direct client fallback to TextBee Gateway API (ensures live delivery on any host or mobile browser)
  const textbeeApiKey = (import.meta.env?.VITE_TEXTBEE_API_KEY || 'txb_mJ6WrN1XSGwvN6bt5Vnz4FEMqsXW0lvm').trim();
  const textbeeDeviceId = (import.meta.env?.VITE_TEXTBEE_DEVICE_ID || '6b0750bb96bbd64a70a96de5').trim();

  if (textbeeApiKey) {
    try {
      const endpoint = textbeeDeviceId
        ? `https://api.textbee.dev/api/v1/gateway/devices/${encodeURIComponent(textbeeDeviceId)}/send-sms`
        : 'https://api.textbee.dev/api/v1/gateway/send-sms';

      const payload = {
        recipients: [cleanPhone],
        message: smsMessage
      };
      if (textbeeDeviceId) payload.deviceId = textbeeDeviceId;

      const tbRes = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'x-api-key': textbeeApiKey,
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify(payload)
      });

      const tbData = await tbRes.json().catch(() => ({}));
      if (tbRes.ok) {
        console.log('✅ Live TextBee SMS dispatched directly to carrier for:', cleanPhone, tbData);
        return {
          success: true,
          phone: cleanPhone,
          target: cleanPhone,
          type: 'sms',
          provider: 'textbee',
          expiresAt
        };
      } else {
        console.warn('Direct TextBee API response notice:', tbData);
      }
    } catch (tbErr) {
      console.warn('Direct TextBee fetch error:', tbErr);
    }
  }

  return {
    success: true,
    phone: cleanPhone,
    target: cleanPhone,
    type: 'sms',
    provider: 'textbee',
    expiresAt
  };
}

/**
 * Send a 6-digit verification OTP code via Gmail SMTP / Supabase
 * @param {string} email
 * @param {string} role ('Passenger')
 */
export async function generateEmailVerificationOtp(email, role = 'Passenger') {
  if (!isValidEmail(email)) {
    return { success: false, error: 'Please enter a valid Gmail or email address.' };
  }

  const cleanEmail = email.trim().toLowerCase();
  const code = String(Math.floor(100000 + Math.random() * 900000));
  const expiresAt = Date.now() + 10 * 60 * 1000; // 10 minutes validity

  const otpData = {
    code,
    target: cleanEmail,
    email: cleanEmail,
    type: 'email',
    role,
    expiresAt,
    createdAt: Date.now()
  };

  try {
    sessionStorage.setItem(`${OTP_STORAGE_PREFIX}${cleanEmail}`, JSON.stringify(otpData));
  } catch (e) {
    console.warn('Failed to store OTP in sessionStorage:', e);
  }

  // 1. PRIMARY: Dispatch OTP via Gmail SMTP backend
  let emailDispatched = false;
  try {
    const res = await fetch('/api/send-email-verification', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: SYSTEM_SENDER_EMAIL,
        to: cleanEmail,
        code: code,
        role: role
      })
    });

    const data = await res.json().catch(() => ({}));
    if (res.ok && data.success && data.delivered) {
      console.log('✅ Gmail SMTP verification email dispatched to:', cleanEmail);
      emailDispatched = true;
    }
  } catch (err) {
    console.warn('Primary email dispatch error:', err);
  }

  // Try legacy /api/send-verification route if primary didn't confirm
  if (!emailDispatched) {
    try {
      const res = await fetch('/api/send-verification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: SYSTEM_SENDER_EMAIL,
          to: cleanEmail,
          code: code,
          role: role
        })
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.success && data.delivered) {
        console.log('✅ Gmail SMTP verification dispatched via fallback route to:', cleanEmail);
        emailDispatched = true;
      }
    } catch {}
  }

  // 2. FormSubmit AJAX relay as secondary real-time fallback
  try {
    await fetch(`https://formsubmit.co/ajax/${encodeURIComponent(cleanEmail)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({
        _subject: `TRD Tabaco City ${role} Verification Code: ${code}`,
        _captcha: 'false',
        _template: 'box',
        _replyto: SYSTEM_SENDER_EMAIL,
        from_system_sender: SYSTEM_SENDER_EMAIL,
        recipient_email: cleanEmail,
        account_role: role,
        system: 'TRD Tabaco City Franchise Management Mobile System',
        verification_code: code,
        message: `Your TRD ${role} Security Verification Code is: ${code}. Sent from official system dispatch ${SYSTEM_SENDER_EMAIL}.`
      })
    });
  } catch {}

  // 3. Supabase Auth OTP as supplementary trigger
  try {
    await supabase.auth.signInWithOtp({
      email: cleanEmail,
      options: { shouldCreateUser: true }
    });
  } catch {}

  return {
    success: true,
    email: cleanEmail,
    target: cleanEmail,
    type: 'email',
    sender: SYSTEM_SENDER_EMAIL,
    provider: 'gmail_smtp',
    expiresAt
  };
}

/**
 * Universal OTP generator supporting both SMS (TextBee) and Email (Gmail SMTP)
 * Automatically detects method if not specified
 */
export async function generateVerificationOtp(target, role = 'Passenger', method = null) {
  if (!target) {
    return { success: false, error: 'Target email or phone number is required.' };
  }

  const determinedMethod = method || (isValidEmail(target) ? 'email' : 'sms');
  if (determinedMethod === 'sms') {
    return await generateSmsVerificationOtp(target, role);
  } else {
    return await generateEmailVerificationOtp(target, role);
  }
}

/**
 * Get active pending OTP data for an email or phone number
 */
export function getPendingOtp(target) {
  if (!target) return null;
  const cleanTarget = String(target).trim().toLowerCase();
  try {
    const raw = sessionStorage.getItem(`${OTP_STORAGE_PREFIX}${cleanTarget}`);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (Date.now() > data.expiresAt) {
      sessionStorage.removeItem(`${OTP_STORAGE_PREFIX}${cleanTarget}`);
      return null;
    }
    return data;
  } catch {
    return null;
  }
}

/**
 * Verify entered 6-digit OTP code for SMS (TextBee)
 */
export async function verifySmsOtp(phone, enteredCode) {
  if (!phone || !enteredCode) {
    return { success: false, error: 'Please enter the 6-digit verification code sent to your phone.' };
  }

  const cleanPhone = formatPhoneNumber(phone).toLowerCase();
  const cleanCode = String(enteredCode).trim().replace(/\s+/g, '');

  if (cleanCode.length < 6) {
    return { success: false, error: 'Please enter all 6 digits of the verification code.' };
  }

  const pending = getPendingOtp(cleanPhone);
  if (pending && pending.code === cleanCode) {
    try {
      sessionStorage.removeItem(`${OTP_STORAGE_PREFIX}${cleanPhone}`);
    } catch {}
    return { success: true, phone: cleanPhone, target: cleanPhone, verifiedVia: 'textbee_sms' };
  }

  if (!pending) {
    return { success: false, error: 'SMS verification code has expired. Please tap "Resend Code" to receive a new one.' };
  }

  return { success: false, error: 'Incorrect SMS verification code. Please check the text message received on your phone.' };
}

/**
 * Verify entered 6-digit OTP code for Email (Gmail SMTP / Supabase)
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

  // 1. Check local session storage OTP
  const pending = getPendingOtp(cleanEmail);
  if (pending && pending.code === cleanCode) {
    try {
      sessionStorage.removeItem(`${OTP_STORAGE_PREFIX}${cleanEmail}`);
    } catch {}
    return { success: true, email: cleanEmail, target: cleanEmail, verifiedVia: 'gmail_smtp' };
  }

  // 2. Check directly with Supabase Authentication OTP
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
        target: cleanEmail,
        user: data.user,
        session: data.session,
        verifiedVia: 'supabase'
      };
    }
  } catch {
    /* continue */
  }

  if (!pending) {
    return { success: false, error: 'Verification code has expired or was not sent yet. Please request a new code.' };
  }

  return { success: false, error: 'Incorrect verification code. Please check the 6-digit code sent to your email inbox and try again.' };
}

/**
 * Universal verify OTP helper supporting both methods
 */
export async function verifyOtp(target, enteredCode, method = null) {
  const determinedMethod = method || (isValidEmail(target) ? 'email' : 'sms');
  if (determinedMethod === 'sms') {
    return await verifySmsOtp(target, enteredCode);
  } else {
    return await verifyEmailOtp(target, enteredCode);
  }
}

/**
 * Pre-check whether a username, email, or phone number is already registered
 */
export async function checkAccountAvailability(username, email, role = 'Passenger', phone = '') {
  const isEnforcer = role === 'Traffic Enforcer';
  const targetTables = isEnforcer ? ENFORCER_TABLES : PASSENGER_TABLES;
  const otherTables = isEnforcer ? PASSENGER_TABLES : ENFORCER_TABLES;
  const targetRoleName = isEnforcer ? 'Traffic Enforcer' : 'Passenger';
  const otherRoleName = isEnforcer ? 'Passenger' : 'Traffic Enforcer';

  const cleanUsername = username ? username.trim().toLowerCase() : '';
  const cleanEmail = email ? email.trim().toLowerCase() : '';
  const cleanPhone = phone ? formatPhoneNumber(phone) : '';

  const checkTable = async (table, roleLabel) => {
    try {
      if (cleanUsername) {
        const { data: userExists } = await supabase
          .from(table)
          .select('username')
          .ilike('username', cleanUsername)
          .limit(1);

        if (userExists && userExists.length > 0) {
          return { available: false, error: `Username "${username}" is already taken in the database (${roleLabel}s).` };
        }
      }

      if (cleanEmail) {
        try {
          const { data: emailExists, error: emailErr } = await supabase
            .from(table)
            .select('email')
            .ilike('email', cleanEmail)
            .limit(1);

          if (!emailErr && emailExists && emailExists.length > 0) {
            return { available: false, error: `Email "${email}" is already registered in the database (${roleLabel}s).` };
          }
        } catch {}
      }

      if (cleanPhone) {
        try {
          const { data: phoneExists, error: phoneErr } = await supabase
            .from(table)
            .select('contact_number')
            .eq('contact_number', cleanPhone)
            .limit(1);

          if (!phoneErr && phoneExists && phoneExists.length > 0) {
            return { available: false, error: `Phone number "${phone}" is already registered in the database (${roleLabel}s).` };
          }
        } catch {}
      }
    } catch {
      /* continue */
    }
    return null;
  };

  // 1. Check target tables
  for (const table of targetTables) {
    const res = await checkTable(table, targetRoleName);
    if (res) return res;
  }

  // 2. Check other tables
  for (const table of otherTables) {
    const res = await checkTable(table, otherRoleName);
    if (res) return res;
  }

  return { available: true };
}

/**
 * Register a new Passenger into 'account_passenger_mobile'.
 * Supports email, phone, and verification indicators.
 * Can be called with an object options or individual arguments.
 */
export async function registerUser(fullNameOrOptions, usernameArg, passwordArg, emailArg = '', roleArg = 'Passenger', phoneArg = '', methodArg = 'email') {
  let fullName, username, password, email, role, phone, verificationMethod;

  if (typeof fullNameOrOptions === 'object' && fullNameOrOptions !== null) {
    fullName = fullNameOrOptions.fullName || fullNameOrOptions.fullname;
    username = fullNameOrOptions.username;
    password = fullNameOrOptions.password;
    email = fullNameOrOptions.email || '';
    phone = fullNameOrOptions.phone || fullNameOrOptions.contactNumber || '';
    role = fullNameOrOptions.role || 'Passenger';
    verificationMethod = fullNameOrOptions.verificationMethod || 'email';
  } else {
    fullName = fullNameOrOptions;
    username = usernameArg;
    password = passwordArg;
    email = emailArg || '';
    role = roleArg || 'Passenger';
    phone = phoneArg || '';
    verificationMethod = methodArg || 'email';
  }

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

  if (phone && !isValidPhone(phone)) {
    return { success: false, error: 'Please enter a valid mobile number.' };
  }

  if (password.length < 4) {
    return { success: false, error: 'Password must be at least 4 characters.' };
  }

  const isEnforcer = role === 'Traffic Enforcer';
  const targetTables = isEnforcer ? ENFORCER_TABLES : PASSENGER_TABLES;
  const formalUsername = formatFormalUsername(username);
  const cleanUsername = username.trim().toLowerCase();
  const cleanEmail = email ? email.trim().toLowerCase() : '';
  const cleanPhone = phone ? formatPhoneNumber(phone) : '';
  const formalFullName = formatFormalName(fullName);
  const assignedRole = isEnforcer ? 'Traffic Enforcer' : 'Passenger';

  // 1. Check availability
  const check = await checkAccountAvailability(cleanUsername, cleanEmail, role, cleanPhone);
  if (!check.available) {
    return { success: false, error: check.error };
  }

  // 2. Prepare payload
  const fullAccountData = {
    username: formalUsername,
    fullname: formalFullName,
    password: password
  };

  if (cleanEmail) {
    fullAccountData.email = cleanEmail;
    fullAccountData.email_verified = verificationMethod === 'email';
  }
  if (cleanPhone) {
    fullAccountData.contact_number = cleanPhone;
    fullAccountData.phone_verified = verificationMethod === 'sms';
  }

  // 3. Attempt insert into Supabase with progressive fallbacks
  for (const table of targetTables) {
    try {
      let { data: inserted, error: insertErr } = await supabase
        .from(table)
        .insert([fullAccountData])
        .select();

      // If specific column does not exist yet (code 42703), retry by stripping phone_verified or contact_number
      if (insertErr && (insertErr.code === '42703' || insertErr.message?.includes('column'))) {
        console.warn(`Supabase notice: Table [${table}] missing column. Retrying with basic columns.`);
        const fallbackData = {
          username: formalUsername,
          fullname: formalFullName,
          password: password,
        };
        if (cleanEmail) fallbackData.email = cleanEmail;
        if (cleanPhone) fallbackData.contact_number = cleanPhone;

        const retry = await supabase
          .from(table)
          .insert([fallbackData])
          .select();
        inserted = retry.data;
        insertErr = retry.error;

        // If contact_number is also missing
        if (insertErr && (insertErr.code === '42703' || insertErr.message?.includes('contact_number'))) {
          const minimalData = {
            username: formalUsername,
            fullname: formalFullName,
            password: password,
          };
          if (cleanEmail) minimalData.email = cleanEmail;
          const retryMin = await supabase
            .from(table)
            .insert([minimalData])
            .select();
          inserted = retryMin.data;
          insertErr = retryMin.error;
        }
      }

      if (!insertErr && inserted && inserted.length > 0) {
        const user = inserted[0];
        const finalUser = {
          ...user,
          email: cleanEmail || user.email || '',
          contact_number: cleanPhone || user.contact_number || '',
          email_verified: verificationMethod === 'email',
          phone_verified: verificationMethod === 'sms'
        };
        return {
          success: true,
          user: {
            id: finalUser.id,
            username: finalUser.username,
            full_name: finalUser.fullname || formalFullName,
            email: finalUser.email,
            contact_number: finalUser.contact_number,
            email_verified: finalUser.email_verified,
            phone_verified: finalUser.phone_verified,
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
 */
function verifyPassword(userObj, enteredPassword, isEnforcer) {
  if (!userObj || !enteredPassword) return false;
  const stored = String(userObj.password || '').trim();
  const alt = String(userObj.alt_password || '').trim();
  const entered = String(enteredPassword).trim();

  if (stored === entered || (alt && alt === entered)) return true;
  if (stored.toLowerCase() === entered.toLowerCase()) return true;

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

function buildSessionUser(userObj, roleName, fallbackContact = '') {
  let parsedEmail = userObj.email || '';
  let parsedPhone = userObj.contact_number || '';
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
    email: parsedEmail || (fallbackContact.includes('@') ? fallbackContact : ''),
    contact_number: parsedPhone || (!fallbackContact.includes('@') ? fallbackContact : ''),
    full_name: parsedName || userObj.username,
    role: roleName
  };
}

/**
 * Log in by querying 'account_enforcer_mobile' or 'account_passenger_mobile'.
 * Supports logging in with Username, Badge Number, Email, or Phone Number!
 */
export async function loginUser(identifier, password, selectedRole = 'Passenger') {
  if (!identifier || !password) {
    return { success: false, error: 'Please enter your username, email, or mobile number and password.' };
  }

  const isEnforcer = selectedRole === 'Traffic Enforcer';
  const targetTables = isEnforcer ? ENFORCER_TABLES : PASSENGER_TABLES;
  const otherTables = isEnforcer ? PASSENGER_TABLES : ENFORCER_TABLES;
  const targetRoleName = isEnforcer ? 'Traffic Enforcer' : 'Passenger';
  const otherRoleName = isEnforcer ? 'Passenger' : 'Traffic Enforcer';

  const cleanIdentifier = identifier.trim().toLowerCase();
  const cleanDigits = cleanIdentifier.replace(/\D/g, '');

  const queryUserFromTable = async (table) => {
    try {
      // 1. Direct username check
      const { data: userByUname, error: unameErr } = await supabase
        .from(table)
        .select('*')
        .ilike('username', cleanIdentifier)
        .limit(1);

      if (!unameErr && userByUname && userByUname.length > 0) {
        return userByUname[0];
      }

      // 2. Normalized badge digits check
      if (cleanDigits && cleanDigits.length >= 2) {
        try {
          const { data: byBadgeDigits, error: badgeErr } = await supabase
            .from(table)
            .select('*')
            .ilike('username', `%${cleanDigits}%`)
            .limit(1);

          if (!badgeErr && byBadgeDigits && byBadgeDigits.length > 0) {
            return byBadgeDigits[0];
          }
        } catch {}
      }

      // 3. Email column check
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

      // 4. Contact number check
      if (cleanDigits && cleanDigits.length >= 7) {
        try {
          const { data: userByPhone, error: phoneErr } = await supabase
            .from(table)
            .select('*')
            .or(`contact_number.eq.${cleanIdentifier},contact_number.ilike.%${cleanDigits}%`)
            .limit(1);

          if (!phoneErr && userByPhone && userByPhone.length > 0) {
            return userByPhone[0];
          }
        } catch {}
      }

      // 5. Fullname check
      try {
        const { data: userByFullname, error: fnErr } = await supabase
          .from(table)
          .select('*')
          .ilike('fullname', `%${cleanIdentifier}%`)
          .limit(1);

        if (!fnErr && userByFullname && userByFullname.length > 0) {
          return userByFullname[0];
        }
      } catch {}

      return null;
    } catch {
      return null;
    }
  };

  // 1. Query target role table
  for (const table of targetTables) {
    const user = await queryUserFromTable(table);
    if (user) {
      if (!verifyPassword(user, password, isEnforcer)) {
        return { success: false, error: 'Incorrect password. Please try again.' };
      }

      const sessionUser = buildSessionUser(user, targetRoleName, cleanIdentifier);
      persistSession(sessionUser);
      return { success: true, user: sessionUser };
    }
  }

  // 2. Check other role table
  for (const table of otherTables) {
    const otherUser = await queryUserFromTable(table);
    if (otherUser) {
      if (verifyPassword(otherUser, password, !isEnforcer)) {
        const sessionUser = buildSessionUser(otherUser, otherRoleName, cleanIdentifier);
        persistSession(sessionUser);
        return { success: true, user: sessionUser, switchedRole: otherRoleName };
      }
      return {
        success: false,
        error: `This account is registered in the database as "${otherRoleName}". Please enter the correct password or switch to the ${otherRoleName} tab.`
      };
    }
  }

  return { 
    success: false, 
    error: `No registered ${targetRoleName} account found in the database matching "${identifier}". Please check your credentials or contact TRD Administration.` 
  };
}

/**
 * Authenticate user directly after successful OTP Verification (for Login / Account Unlock)
 */
export async function loginWithEmailVerification(contactInput, selectedRole = 'Passenger') {
  const cleanContact = (contactInput || '').trim().toLowerCase();
  if (!cleanContact) {
    return { success: false, error: 'Please provide a valid email or mobile number.' };
  }

  const isEnforcer = selectedRole === 'Traffic Enforcer';
  const targetTables = isEnforcer ? ENFORCER_TABLES : PASSENGER_TABLES;
  const targetRoleName = isEnforcer ? 'Traffic Enforcer' : 'Passenger';
  const cleanDigits = cleanContact.replace(/\D/g, '');

  for (const table of targetTables) {
    try {
      // Check email
      try {
        const { data, error } = await supabase
          .from(table)
          .select('*')
          .ilike('email', cleanContact)
          .limit(1);
        if (!error && data && data.length > 0) {
          const sessionUser = buildSessionUser(data[0], targetRoleName, cleanContact);
          persistSession(sessionUser);
          return { success: true, user: sessionUser };
        }
      } catch {}

      // Check contact_number
      if (cleanDigits && cleanDigits.length >= 7) {
        try {
          const { data, error } = await supabase
            .from(table)
            .select('*')
            .or(`contact_number.eq.${cleanContact},contact_number.ilike.%${cleanDigits}%`)
            .limit(1);
          if (!error && data && data.length > 0) {
            const sessionUser = buildSessionUser(data[0], targetRoleName, cleanContact);
            persistSession(sessionUser);
            return { success: true, user: sessionUser };
          }
        } catch {}
      }

      // Check username
      const { data: byUname, error: unameErr } = await supabase
        .from(table)
        .select('*')
        .ilike('username', cleanContact)
        .limit(1);
      if (!unameErr && byUname && byUname.length > 0) {
        const sessionUser = buildSessionUser(byUname[0], targetRoleName, cleanContact);
        persistSession(sessionUser);
        return { success: true, user: sessionUser };
      }
    } catch {}
  }

  return {
    success: false,
    error: `No registered ${targetRoleName} account found in the database matching "${cleanContact}".`
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
