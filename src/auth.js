/**
 * Tabaco City TRD - Verifier Authentication
 * Uses 2 separate Supabase tables with strictly username, fullname, and password:
 * 1. 'account_enforcer_mobile' (for Traffic Enforcer accounts)
 * 2. 'account_passenger_mobile' (for Passenger accounts)
 */
import { supabase } from './supabase.js';

const SESSION_KEY = 'trd_verifier_user';
const LOCAL_ENFORCERS_KEY = 'trd_local_account_enforcer_mobile';
const LOCAL_PASSENGERS_KEY = 'trd_local_account_passenger_mobile';

// Primary table names in Supabase
const ENFORCER_TABLES = ['account_enforcer_mobile', 'account_enforcermobile', 'mobile_enforcers'];
const PASSENGER_TABLES = ['account_passenger_mobile', 'account_passengermobile', 'mobile_passengers'];

// Default pre-seeded accounts
const DEFAULT_ENFORCERS = [
  {
    id: 'seed_enf_1',
    username: 'enforcer',
    fullname: 'Officer Juan Dela Cruz',
    password: 'enforcer123'
  },
  {
    id: 'seed_enf_2',
    username: 'andrie',
    fullname: 'Andrie Barasona',
    password: 'andrie123'
  },
  {
    id: 'seed_enf_3',
    username: 'admin',
    fullname: 'TRD Admin Officer',
    password: 'admin123'
  }
];

const DEFAULT_PASSENGERS = [
  {
    id: 'seed_pass_1',
    username: 'passenger',
    fullname: 'Maria Santos',
    password: 'passenger123'
  },
  {
    id: 'seed_pass_2',
    username: 'pedro',
    fullname: 'Pedro Penduko',
    password: 'pedro123'
  }
];

function getLocalAccounts(isEnforcer) {
  const key = isEnforcer ? LOCAL_ENFORCERS_KEY : LOCAL_PASSENGERS_KEY;
  const defaults = isEnforcer ? DEFAULT_ENFORCERS : DEFAULT_PASSENGERS;
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : [...defaults];
  } catch {
    return [...defaults];
  }
}

function saveLocalAccount(isEnforcer, user) {
  const key = isEnforcer ? LOCAL_ENFORCERS_KEY : LOCAL_PASSENGERS_KEY;
  try {
    const list = getLocalAccounts(isEnforcer);
    const idx = list.findIndex(u => u.username.toLowerCase() === user.username.toLowerCase());
    if (idx >= 0) {
      list[idx] = user;
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
 * Register a new user into the corresponding mobile table.
 * @param {string} fullName
 * @param {string} username
 * @param {string} password
 * @param {string} role ('Passenger' | 'Traffic Enforcer')
 */
export async function registerUser(fullName, username, password, role = 'Passenger') {
  if (!fullName || !username || !password) {
    return { success: false, error: 'All fields are required.' };
  }

  if (password.length < 4) {
    return { success: false, error: 'Password must be at least 4 characters.' };
  }

  const isEnforcer = role === 'Traffic Enforcer';
  const targetTables = isEnforcer ? ENFORCER_TABLES : PASSENGER_TABLES;
  const formalUsername = formatFormalUsername(username);
  const cleanUsername = username.trim().toLowerCase();
  const formalFullName = formatFormalName(fullName);
  const assignedRole = isEnforcer ? 'Traffic Enforcer' : 'Passenger';

  // 1. Check if username already exists in target table
  for (const table of targetTables) {
    try {
      const { data: existing, error: checkErr } = await supabase
        .from(table)
        .select('username')
        .ilike('username', cleanUsername)
        .limit(1);

      if (!checkErr && existing && existing.length > 0) {
        return { success: false, error: `Username already taken in ${assignedRole}s. Please choose another or log in.` };
      }
    } catch {
      /* continue */
    }
  }

  // 2. Insert record strictly as: username, fullname, password
  const newAccount = {
    username: formalUsername,
    fullname: formalFullName,
    password: password
  };

  for (const table of targetTables) {
    try {
      const { data: inserted, error: insertErr } = await supabase
        .from(table)
        .insert([newAccount])
        .select();

      if (!insertErr && inserted && inserted.length > 0) {
        const user = inserted[0];
        saveLocalAccount(isEnforcer, user);
        return {
          success: true,
          user: {
            id: user.id,
            username: user.username,
            full_name: user.fullname || formalFullName,
            role: assignedRole
          }
        };
      }
    } catch {
      /* try next table alias */
    }
  }

  // 3. Fallback save to local accounts cache
  const localUser = {
    id: 'usr_' + Date.now(),
    username: formalUsername,
    fullname: formalFullName,
    password: password
  };
  saveLocalAccount(isEnforcer, localUser);

  return {
    success: true,
    user: {
      id: localUser.id,
      username: localUser.username,
      full_name: formalFullName,
      role: assignedRole
    }
  };
}

/**
 * Log in by querying 'account_enforcer_mobile' or 'account_passenger_mobile'.
 * @param {string} username
 * @param {string} password
 * @param {string} selectedRole ('Passenger' | 'Traffic Enforcer')
 */
export async function loginUser(username, password, selectedRole = 'Passenger') {
  if (!username || !password) {
    return { success: false, error: 'Please enter username and password.' };
  }

  const isEnforcer = selectedRole === 'Traffic Enforcer';
  const targetTables = isEnforcer ? ENFORCER_TABLES : PASSENGER_TABLES;
  const otherTables = isEnforcer ? PASSENGER_TABLES : ENFORCER_TABLES;
  const targetRoleName = isEnforcer ? 'Traffic Enforcer' : 'Passenger';
  const otherRoleName = isEnforcer ? 'Passenger' : 'Traffic Enforcer';

  const cleanUsername = username.trim().toLowerCase();

  // 1. Query target role table in Supabase
  for (const table of targetTables) {
    try {
      const { data, error } = await supabase
        .from(table)
        .select('*')
        .ilike('username', cleanUsername)
        .limit(1);

      if (!error && data && data.length > 0) {
        const user = data[0];

        if (user.password !== password) {
          return { success: false, error: 'Incorrect password. Please try again.' };
        }

        const sessionUser = {
          id: user.id,
          username: user.username,
          full_name: user.fullname || user.username,
          role: targetRoleName
        };

        sessionStorage.setItem(SESSION_KEY, JSON.stringify(sessionUser));
        saveLocalAccount(isEnforcer, user);
        return { success: true, user: sessionUser };
      }
    } catch {
      /* continue */
    }
  }

  // 2. Check if account exists in the other role table to give friendly guidance
  for (const table of otherTables) {
    try {
      const { data: otherData } = await supabase
        .from(table)
        .select('username')
        .ilike('username', cleanUsername)
        .limit(1);

      if (otherData && otherData.length > 0) {
        return {
          success: false,
          error: `This account is registered under "${otherRoleName}". Please switch to the ${otherRoleName} tab.`
        };
      }
    } catch {
      /* continue */
    }
  }

  // 3. Check local accounts cache
  const localTargetList = getLocalAccounts(isEnforcer);
  const foundTarget = localTargetList.find(u => u.username.toLowerCase() === cleanUsername);

  if (foundTarget) {
    if (foundTarget.password !== password) {
      return { success: false, error: 'Incorrect password. Please try again.' };
    }

    const sessionUser = {
      id: foundTarget.id,
      username: foundTarget.username,
      full_name: foundTarget.fullname || foundTarget.username,
      role: targetRoleName
    };

    sessionStorage.setItem(SESSION_KEY, JSON.stringify(sessionUser));
    return { success: true, user: sessionUser };
  }

  const localOtherList = getLocalAccounts(!isEnforcer);
  const foundOther = localOtherList.find(u => u.username.toLowerCase() === cleanUsername);
  if (foundOther) {
    return {
      success: false,
      error: `This account is registered under "${otherRoleName}". Please switch to the ${otherRoleName} tab.`
    };
  }

  return { success: false, error: `No ${targetRoleName} account found with that username. Please check your username or sign up.` };
}

/**
 * Log out user & clear session
 */
export function logoutUser() {
  sessionStorage.removeItem(SESSION_KEY);
}

/**
 * Get current logged in user object
 */
export function getCurrentUser() {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
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
