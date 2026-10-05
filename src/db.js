/**
 * Tabaco City TRD - Supabase Database Queries
 */
import { supabase } from './supabase.js';

/**
 * Look up a franchise record in Supabase from Admin tables:
 * - 'franchise_records_pedicab_admin'
 * - 'franchise_records_tricycle_admin'
 * 
 * Returns enriched record or null if not in DB.
 */
export async function fetchFranchiseByPlate(plateNo, rawText = '') {
  if (!plateNo && !rawText) return null;

  const cleanPlate = (plateNo && plateNo !== '—') ? plateNo.trim() : '';

  // Search across both official admin franchise tables
  const targetTables = ['franchise_records_tricycle_admin', 'franchise_records_pedicab_admin'];

  for (const tableName of targetTables) {
    try {
      // 1. Search across city_plate_number, plate_number, mtop_number, application_no
      if (cleanPlate) {
        const { data, error } = await supabase
          .from(tableName)
          .select('*')
          .or(`city_plate_number.ilike.%${cleanPlate}%,plate_number.ilike.%${cleanPlate}%,mtop_number.ilike.%${cleanPlate}%,application_no.ilike.%${cleanPlate}%`)
          .limit(1);

        if (!error && data && data.length > 0) {
          return { ...data[0], _sourceTable: tableName };
        }
      }

      // 2. Exact match fallback
      if (cleanPlate) {
        const { data: cData, error: cErr } = await supabase
          .from(tableName)
          .select('*')
          .eq('city_plate_number', cleanPlate)
          .limit(1);

        if (!cErr && cData && cData.length > 0) {
          return { ...cData[0], _sourceTable: tableName };
        }
      }
    } catch (err) {
      // Table may not exist or column difference, proceed to next table
    }
  }

  return null;
}

/**
 * Convert an Admin Supabase DB row into the app's internal verified record format.
 */
export function dbRowToRecord(row, rawText = '') {
  const sourceTable = row._sourceTable || '';
  const isTricycle = sourceTable.includes('tricycle') || /tricycle|trike/i.test(row.vehicle_category || row.vehicle_type || row.type || '');
  const vehicleType = isTricycle ? 'Tricycle' : 'Pedicab';

  return {
    type: 'franchise',
    vehicleType,
    vehicleTitle: `${vehicleType} Verified Unit`,
    operator: row.operator_name || row.operator || row.owner || row.fullname || '—',
    driver: row.driver_name || row.driver || row.drivername || '—',
    plateNo: row.city_plate_number || row.plate_number || row.mtop_number || row.plate_no || row.plate || '—',
    route: row.route_parada || row.route || row.parada || row.line || row.route_name || 'Tabaco City Route',
    expiry: row.expiration_date || row.expiry || row.expiry_date || row.valid_until ? String(row.expiration_date || row.expiry || row.expiry_date || row.valid_until).substring(0, 10) : '2026-12-31',
    touristGuide: (row.tourist_guide === true || row.tourist_guide === 'Yes' || row.tourist === 'Yes') ? 'Yes' : 'No',
    availability: row.availability || row.status || 'Available',
    status: row.status || 'Active',
    fareFee: row.standard_fare || row.fare_fee || row.fare || null,
    fareMatrix: Array.isArray(row.fare_matrix) ? row.fare_matrix : null,
    violationsCount: row.violations_count || 0,
    documentsVerified: row.documents_verified ?? true,
    raw: rawText || row.city_plate_number || row.plate_number || '',
    fromDatabase: true,
  };
}

/**
 * Mask the passenger's account username/name for database privacy and anonymity.
 * Example: 'andrie3011' -> 'and****011', 'Maria Santos' -> 'Mar*********tos'
 */
export function maskReporterName(name) {
  if (!name) return 'Anonymous Passenger';
  const str = String(name).trim();

  if (str.length <= 4) {
    if (str.length <= 2) return str.charAt(0) + '*';
    return str.charAt(0) + '*'.repeat(str.length - 2) + str.slice(-1);
  }

  if (str.length <= 6) {
    return str.substring(0, 2) + '*'.repeat(str.length - 4) + str.slice(-2);
  }

  // 7+ characters: show first 3 chars + asterisks for middle + last 3 chars
  // e.g. 'andrie3011' (length 10) -> 'and' + '****' + '011' = 'and****011'
  const firstPart = str.substring(0, 3);
  const lastPart = str.slice(-3);
  const asterisks = '*'.repeat(Math.max(3, str.length - 6));
  return `${firstPart}${asterisks}${lastPart}`;
}

/**
 * Submit an official violation citation or passenger overcharging report to Supabase.
 * Maps directly to the live 'passenger_complaints' table in Supabase.
 */
/**
 * Submit a report or violation.
 * Routes dynamically to:
 * - 'enforcer_violations' if submitted by a Traffic Enforcer
 * - 'passenger_complaints' if submitted by a Passenger
 */
export async function submitViolationReport(reportData) {
  const isEnforcer = (reportData.reporter_role || '').toLowerCase().includes('enforcer');

  if (isEnforcer) {
    return await submitEnforcerViolation(reportData);
  } else {
    return await submitPassengerReport(reportData);
  }
}

/**
 * Upload an attachment dataUrl to Supabase Storage bucket 'complaint_evidence'
 * Returns the clean, public image URL (e.g. https://.../evidence.jpg) for viewing actual photos in Supabase & Admin
 */
export async function uploadEvidenceToStorage(attachment, subfolder = 'evidence') {
  if (!attachment?.dataUrl) return null;

  try {
    const dataUrl = attachment.dataUrl;
    const parts = dataUrl.split(',');
    const mime = parts[0].match(/:(.*?);/)?.[1] || 'image/jpeg';
    const ext = mime.includes('png') ? 'png' : 'jpg';
    const fileName = `${subfolder}/${Date.now()}_${Math.random().toString(36).substring(2, 8)}.${ext}`;

    let fileBody;
    if (typeof fetch !== 'undefined') {
      const res = await fetch(dataUrl);
      fileBody = await res.blob();
    } else if (typeof Buffer !== 'undefined') {
      fileBody = Buffer.from(parts[1], 'base64');
    }

    if (fileBody) {
      const { data, error } = await supabase.storage
        .from('complaint_evidence')
        .upload(fileName, fileBody, {
          contentType: mime,
          upsert: true
        });

      if (!error && data?.path) {
        const { data: urlData } = supabase.storage.from('complaint_evidence').getPublicUrl(data.path);
        if (urlData?.publicUrl) {
          console.log('✅ Actual photo uploaded to Supabase Storage:', urlData.publicUrl);
          return urlData.publicUrl;
        }
      }
    }
  } catch (err) {
    console.warn('Storage bucket note, using direct image data:', err);
  }

  return attachment.dataUrl;
}

/**
 * 1. TRAFFIC ENFORCER VIOLATION CITATION STORAGE
 * Table: 'enforcer_violations' & 'violation_attachments'
 */
export async function submitEnforcerViolation(reportData) {
  const plate = reportData.plate_no || '—';
  const category = (reportData.vehicle_type || 'Pedicab').toLowerCase().includes('tri') ? 'Tricycle' : 'Pedicab';
  const enforcerName = reportData.reporter_name || 'Traffic Enforcer';
  const enforcerBadge = reportData.enforcer_badge || 'TRD-ENF';
  const citationNo = reportData.citation_no || `CIT-${Date.now().toString().slice(-6)}`;
  const violationType = reportData.report_type || 'Official Traffic Violation';

  // Keep description concise and lightweight (Admin already has driver/franchise linked by city_plate_number)
  const descParts = [
    reportData.fare_charged ? `Excess Fare: ${reportData.fare_charged} PHP` : '',
    citationNo ? `Citation: ${citationNo}` : '',
    enforcerBadge ? `Badge: ${enforcerBadge}` : '',
    reportData.attachment?.name ? `📎 Photo: ${reportData.attachment.name}` : '',
    reportData.description ? `Remarks: ${reportData.description}` : ''
  ].filter(Boolean);

  const fullDescription = descParts.join(' | ') || (reportData.description || 'Traffic citation issued.');

  const hasAttachment = Boolean(reportData.attachment?.dataUrl);
  const evidenceFileName = hasAttachment ? (reportData.attachment.name || 'citation_photo.jpg') : null;
  const evidenceImageUrl = hasAttachment ? await uploadEvidenceToStorage(reportData.attachment, 'violations') : null;

  // Local cache for Enforcer Citation History
  cacheLocalReport(reportData, enforcerName, fullDescription, 'enforcer_violations');

  // Payload for Dedicated 'enforcer_violations' table
  const enforcerPayload = {
    enforcer_name: enforcerName,
    enforcer_badge: enforcerBadge,
    citation_no: citationNo,
    city_plate_number: plate,
    mtop_number: plate,
    vehicle_category: category,
    driver_name: reportData.driver_name || null,
    violation_type: violationType,
    remarks: reportData.description || fullDescription,
    description: fullDescription,
    incident_date: new Date().toISOString().split('T')[0],
    status: 'Pending TRD Review',
    evidence_image: evidenceImageUrl,
    evidence_filename: evidenceFileName
  };

  // 1. Try dedicated 'enforcer_violations' table
  try {
    const { data: enfData, error: enfErr } = await supabase
      .from('enforcer_violations')
      .insert([enforcerPayload])
      .select();

    if (!enfErr && enfData && enfData.length > 0) {
      console.log('✅ Violation Citation saved to enforcer_violations:', enfData[0]);
      if (hasAttachment) {
        await saveAttachmentRecord('violation_attachments', 'violation_id', enfData[0].id, reportData.attachment);
      }
      return { success: true, data: enfData[0], table: 'enforcer_violations' };
    }
  } catch (err) {
    console.warn('enforcer_violations table notice, falling back:', err);
  }

  // 2. Fallback to unified passenger_complaints with enforcer metadata
  try {
    const fallbackPayload = {
      complainant_name: `[Enforcer] ${enforcerName} (${enforcerBadge})`,
      city_plate_number: plate,
      mtop_number: plate,
      vehicle_category: category,
      issue_type: `[Citation] ${violationType}`,
      description: fullDescription,
      incident_date: new Date().toISOString().split('T')[0],
      status: 'Under Investigation',
      evidence_image: evidenceImageUrl,
      evidence_filename: evidenceFileName
    };

    const { data: fbData, error: fbErr } = await supabase
      .from('passenger_complaints')
      .insert([fallbackPayload])
      .select();

    if (!fbErr && fbData && fbData.length > 0) {
      console.log('✅ Enforcer citation saved via passenger_complaints fallback:', fbData[0]);
      return { success: true, data: fbData[0], table: 'passenger_complaints' };
    }
  } catch (err) {
    console.warn('Fallback violation insert exception:', err);
  }

  return { success: true };
}

/**
 * 2. PASSENGER OVERCHARGING & COMPLAINT STORAGE
 * Table: 'passenger_complaints' & 'complaint_attachments'
 */
export async function submitPassengerReport(reportData) {
  const plate = reportData.plate_no || '—';
  const category = (reportData.vehicle_type || 'Pedicab').toLowerCase().includes('tri') ? 'Tricycle' : 'Pedicab';
  const rawReporter = reportData.reporter_username || reportData.reporter_name || 'Passenger User';
  const maskedReporter = maskReporterName(rawReporter);

  // Keep description concise and avoid duplicate space-consuming driver details
  const descParts = [
    reportData.fare_charged ? `Actual Fare: ₱${reportData.fare_charged}` : '',
    reportData.attachment?.name ? `📎 Proof: ${reportData.attachment.name}` : '',
    reportData.description ? `Remarks: ${reportData.description}` : ''
  ].filter(Boolean);

  const fullDescription = descParts.join(' | ') || (reportData.description || 'Passenger report filed.');

  const hasAttachment = Boolean(reportData.attachment?.dataUrl);
  const evidenceFileName = hasAttachment ? (reportData.attachment.name || 'evidence.jpg') : null;
  const evidenceImageUrl = hasAttachment ? await uploadEvidenceToStorage(reportData.attachment, 'reports') : null;

  // Local cache for Passenger Report History
  cacheLocalReport(reportData, maskedReporter, fullDescription, 'passenger_complaints');

  const passengerPayloadWithImage = {
    complainant_name: maskedReporter,
    city_plate_number: plate,
    mtop_number: plate,
    vehicle_category: category,
    issue_type: reportData.report_type || 'Overcharging (Excess Fare)',
    description: fullDescription,
    incident_date: new Date().toISOString().split('T')[0],
    status: 'Under Investigation',
    evidence_image: evidenceImageUrl,
    evidence_filename: evidenceFileName
  };

  const passengerPayloadStandard = {
    complainant_name: maskedReporter,
    city_plate_number: plate,
    mtop_number: plate,
    vehicle_category: category,
    issue_type: reportData.report_type || 'Overcharging (Excess Fare)',
    description: fullDescription,
    incident_date: new Date().toISOString().split('T')[0],
    status: 'Under Investigation'
  };

  // 1. Try insert with image evidence column
  try {
    if (hasAttachment || evidenceImageUrl) {
      const { data: imgData, error: imgErr } = await supabase
        .from('passenger_complaints')
        .insert([passengerPayloadWithImage])
        .select();

      if (!imgErr && imgData && imgData.length > 0) {
        console.log('✅ Passenger report with photo saved:', imgData[0]);
        await saveAttachmentRecord('complaint_attachments', 'complaint_id', imgData[0].id, reportData.attachment);
        return { success: true, data: imgData[0], table: 'passenger_complaints' };
      }
    }
  } catch (err) {
    console.warn('Image column insert note:', err);
  }

  // 2. Standard passenger_complaints insert
  try {
    const { data, error } = await supabase
      .from('passenger_complaints')
      .insert([passengerPayloadStandard])
      .select();

    if (!error && data && data.length > 0) {
      console.log('✅ Passenger report saved:', data[0]);
      if (hasAttachment) {
        await saveAttachmentRecord('complaint_attachments', 'complaint_id', data[0].id, reportData.attachment);
      }
      return { success: true, data: data[0], table: 'passenger_complaints' };
    }
  } catch (err) {
    console.warn('passenger_complaints insert exception:', err);
  }

  return { success: true };
}

/**
 * Helper to cache report locally in localStorage
 */
function cacheLocalReport(reportData, reporterDisplay, fullDescription, storageType) {
  try {
    if (typeof localStorage !== 'undefined') {
      const localReports = JSON.parse(localStorage.getItem('trd_submitted_reports') || '[]');
      localReports.unshift({
        id: 'rep_' + Date.now(),
        ...reportData,
        reporter_display: reporterDisplay,
        storage_type: storageType,
        full_description: fullDescription,
        submitted_at: new Date().toISOString()
      });
      localStorage.setItem('trd_submitted_reports', JSON.stringify(localReports.slice(0, 40)));
    }
  } catch (storageErr) {
    console.warn('Local storage cache note:', storageErr);
  }
}

/**
 * Helper to store high-res PNG/JPEG evidence in attachment tables
 */
async function saveAttachmentRecord(tableName, foreignKeyField, foreignId, attachment) {
  if (!attachment?.dataUrl) return;

  try {
    const payload = {
      [foreignKeyField]: foreignId,
      file_name: attachment.name || 'evidence.jpg',
      file_type: attachment.type || 'image/jpeg',
      file_size: attachment.size || 0,
      image_data: attachment.dataUrl
    };

    await supabase.from(tableName).insert([payload]);
  } catch {
    // Non-critical if table not yet migrated
  }
}

/**
 * ==============================================================================
 * ROLE-BASED STATUS NOTIFICATIONS SYSTEM
 * ==============================================================================
 */

const NOTIFS_READ_KEY = 'trd_read_notifications_ids';

export function getReadNotificationIds() {
  try {
    return JSON.parse(localStorage.getItem(NOTIFS_READ_KEY) || '[]');
  } catch {
    return [];
  }
}

export function markNotificationAsRead(notifId) {
  try {
    const ids = getReadNotificationIds();
    if (!ids.includes(notifId)) {
      ids.push(notifId);
      localStorage.setItem(NOTIFS_READ_KEY, JSON.stringify(ids));
    }
  } catch (err) {
    console.warn('Error marking notification read:', err);
  }
}

export function markAllNotificationsRead(notifIds = []) {
  try {
    const ids = Array.from(new Set([...getReadNotificationIds(), ...notifIds]));
    localStorage.setItem(NOTIFS_READ_KEY, JSON.stringify(ids));
  } catch (err) {
    console.warn('Error marking all notifications read:', err);
  }
}

/**
 * Fetch live status notifications tailored to the current user's role:
 * - If Passenger: Fetches complaint & overcharging reports submitted by this passenger
 * - If Traffic Enforcer: Fetches violations and citations issued by this officer
 */
export async function fetchRoleNotifications(currentUser) {
  if (!currentUser) return [];

  const isEnforcer = (currentUser.role || '').toLowerCase().includes('enforcer');
  const readIds = getReadNotificationIds();

  if (isEnforcer) {
    return await fetchEnforcerNotifications(currentUser, readIds);
  } else {
    return await fetchPassengerNotifications(currentUser, readIds);
  }
}

/**
 * Helper to map any Admin status update (Review, Investigation, Resolve, etc.)
 * to visual badge types and 4-step progress index.
 */
export function parseCaseStatus(rawStatus) {
  const status = (rawStatus || 'Pending TRD Review').trim();
  const lower = status.toLowerCase();

  // 1. Resolved / Settled / Action Taken / Sanctions / Refunded / Dismissed / Completed / Done
  if (/resolved|settled|cleared|closed|sanction|refund|penalized|penalty|paid|approved|dismiss|complete|done|finish|action taken|concluded/i.test(lower)) {
    return {
      status,
      statusType: /dismiss|revok|suspend/i.test(lower) ? 'danger' : 'success',
      stepProgress: 4
    };
  }

  // 2. Hearing / Summons / Driver Summoned / Adjudication / Impounded
  if (/hearing|summon|adjudicat|impound/i.test(lower)) {
    return {
      status,
      statusType: 'info',
      stepProgress: 3
    };
  }

  // 3. Investigation / Under Investigation / Investigating
  if (/investigat/i.test(lower)) {
    return {
      status,
      statusType: 'warning',
      stepProgress: 3
    };
  }

  // 4. Review / Under Review / In Review / Processing / Queued
  if (/review|process|evaluat|queue/i.test(lower)) {
    return {
      status,
      statusType: 'info',
      stepProgress: 2
    };
  }

  // 5. Initial Pending / Filed
  if (/pending|filed|submitted|received/i.test(lower)) {
    return {
      status,
      statusType: 'warning',
      stepProgress: 1
    };
  }

  // Fallback
  return {
    status: status || 'Pending TRD Review',
    statusType: 'warning',
    stepProgress: 2
  };
}

/**
 * Match a complainant name string (which may be masked like 'pas***ger' or 'Mar***tos')
 * to the logged-in passenger account.
 */
function isMatchingPassengerReporter(compStr, currentUser, userPlates = []) {
  if (!compStr || !currentUser) return false;
  const comp = compStr.trim().toLowerCase();
  if (comp.includes('[enforcer]')) return false; // Ignore enforcer citations

  const rawUser = (currentUser.username || '').trim().toLowerCase();
  const rawFull = (currentUser.full_name || '').trim().toLowerCase();

  // Direct exact/substring matches
  if (rawUser && (comp === rawUser || comp.includes(rawUser) || rawUser.includes(comp))) return true;
  if (rawFull && (comp === rawFull || comp.includes(rawFull) || rawFull.includes(comp))) return true;

  // Masked string match (exact match against current masking algorithm)
  const maskedUser = maskReporterName(currentUser.username || '').toLowerCase();
  const maskedFull = maskReporterName(currentUser.full_name || '').toLowerCase();
  if (comp === maskedUser || comp === maskedFull) return true;

  // Masked fuzzy pattern match (e.g. 'pas***ger' or 'mar***tos' or 'and***011')
  if (comp.includes('*')) {
    const parts = comp.split(/\*+/).filter(Boolean);
    if (parts.length >= 2) {
      const prefix = parts[0];
      const suffix = parts[parts.length - 1];
      if (rawUser && rawUser.startsWith(prefix) && rawUser.endsWith(suffix)) return true;
      if (rawFull && rawFull.startsWith(prefix) && rawFull.endsWith(suffix)) return true;
      // Also check if any word in full name matches
      const fullWords = rawFull.split(' ').filter(Boolean);
      if (fullWords.length > 0 && fullWords[0].startsWith(prefix) && fullWords[fullWords.length - 1].endsWith(suffix)) return true;
    } else if (parts.length === 1 && parts[0].length >= 3) {
      if (rawUser && rawUser.startsWith(parts[0])) return true;
      if (rawFull && rawFull.startsWith(parts[0])) return true;
    }
  }

  // Check if passenger account has first name matching
  if (rawFull) {
    const firstName = rawFull.split(' ')[0];
    if (firstName && firstName.length >= 3 && comp.startsWith(firstName)) return true;
  }

  // If this device submitted reports for this plate under this account
  if (userPlates.length > 0 && userPlates.includes(compStr)) {
    return true;
  }

  return false;
}

/**
 * Match an enforcer record in DB to the logged-in officer account.
 */
function isMatchingEnforcerOfficer(enfNameStr, enfBadgeStr, compStr, currentUser, userPlates = []) {
  if (!currentUser) return false;
  const rawUser = (currentUser.username || '').trim().toLowerCase();
  const rawFull = (currentUser.full_name || '').trim().toLowerCase();

  const enfName = (enfNameStr || '').trim().toLowerCase();
  const enfBadge = (enfBadgeStr || '').trim().toLowerCase();
  const comp = (compStr || '').trim().toLowerCase();

  // 1. Name & badge checks
  if (rawUser && (enfName.includes(rawUser) || enfBadge.includes(rawUser) || comp.includes(rawUser))) return true;
  if (rawFull && (enfName.includes(rawFull) || comp.includes(rawFull))) return true;

  // 2. Check parts of full name (e.g. "Juan Dela Cruz" matches "Juan")
  if (rawFull) {
    const words = rawFull.split(' ').filter(w => w.length > 2);
    if (words.some(w => enfName.includes(w) || comp.includes(w))) return true;
  }

  // 3. Fallback generic officer matching
  if (comp.includes('[enforcer]') && (rawUser === 'enforcer' || rawUser === 'admin')) return true;

  return false;
}

/**
 * Sync Supabase status updates back into local storage reports cache
 */
function syncStatusToLocalReports(plateNo, status, reportType) {
  try {
    const raw = localStorage.getItem('trd_submitted_reports');
    if (!raw) return;
    const local = JSON.parse(raw);
    let changed = false;

    local.forEach(item => {
      if (item.plate_no === plateNo && (!reportType || item.report_type === reportType || item.issue_type === reportType)) {
        if (item.status !== status) {
          item.status = status;
          changed = true;
        }
      }
    });

    if (changed) {
      localStorage.setItem('trd_submitted_reports', JSON.stringify(local));
    }
  } catch (err) {
    console.warn('Sync local reports note:', err);
  }
}

/**
 * Fetch Passenger Report Status Notifications strictly for the logged-in account.
 * Preserves all previous cases and dynamically reflects Admin status changes.
 */
async function fetchPassengerNotifications(currentUser, readIds) {
  if (!currentUser?.username && !currentUser?.full_name) return [];

  const notifs = [];
  const rawUsername = (currentUser.username || '').trim().toLowerCase();
  const rawFullName = (currentUser.full_name || '').trim().toLowerCase();

  // Get plates submitted locally by this user to assist matching
  let userSubmittedPlates = [];
  try {
    const localReports = JSON.parse(localStorage.getItem('trd_submitted_reports') || '[]');
    userSubmittedPlates = localReports
      .filter(r => {
        const u = (r.reporter_username || '').trim().toLowerCase();
        const n = (r.reporter_name || r.reporter_display || '').trim().toLowerCase();
        return (rawUsername && u === rawUsername) || (rawFullName && n.includes(rawFullName));
      })
      .map(r => r.plate_no)
      .filter(Boolean);
  } catch {
    userSubmittedPlates = [];
  }

  // 1. Fetch all cases from Supabase 'passenger_complaints'
  try {
    const { data, error } = await supabase
      .from('passenger_complaints')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(100);

    if (!error && data && data.length > 0) {
      // Filter strictly to previous and current reports filed by THIS user
      const userReports = data.filter(item => {
        return isMatchingPassengerReporter(item.complainant_name, currentUser, userSubmittedPlates);
      });

      userReports.forEach((item, index) => {
        const { status, statusType, stepProgress } = parseCaseStatus(item.status);
        const notifId = `notif_pass_${item.id || index}_${status}`;

        // Sync fresh status to local storage cache so offline view is consistent
        if (item.city_plate_number) {
          syncStatusToLocalReports(item.city_plate_number, item.status || status, item.issue_type);
        }

        notifs.push({
          id: notifId,
          recordId: item.id,
          role: 'Passenger',
          category: 'Report Status',
          title: item.issue_type || 'Overcharging Report',
          subtitle: `Plate #${item.city_plate_number || '—'} (${item.vehicle_category || 'Pedicab'})`,
          plateNo: item.city_plate_number || '—',
          driverName: item.driver_name || 'Assigned Driver',
          vehicleType: item.vehicle_category || 'Pedicab',
          actualFare: item.actual_fare ? `₱${item.actual_fare}` : null,
          status: status,
          statusType: statusType,
          stepProgress: stepProgress,
          incidentDate: item.incident_date || (item.created_at ? item.created_at.substring(0, 10) : 'Recent'),
          description: item.description || 'Report registered with TRD Office.',
          evidenceImage: item.evidence_image || null,
          evidenceFilename: item.evidence_filename || null,
          isRead: readIds.includes(notifId),
          timestamp: item.created_at || new Date().toISOString()
        });
      });
    }
  } catch (err) {
    console.warn('Error fetching passenger report notifications:', err);
  }

  // 2. Only merge local pending submissions if offline or submitted within the last 30 seconds
  try {
    const local = JSON.parse(localStorage.getItem('trd_submitted_reports') || '[]');
    const nowMs = Date.now();
    const passLocals = local.filter(r => {
      const repUser = (r.reporter_username || '').trim().toLowerCase();
      const repName = (r.reporter_name || r.reporter_display || '').trim().toLowerCase();
      const role = (r.reporter_role || '').toLowerCase();
      if (role.includes('enforcer')) return false;

      // Only keep very recent local-only items (e.g. < 30s) to prevent resurrecting database-deleted items
      const isVeryRecent = r.submitted_at && (nowMs - new Date(r.submitted_at).getTime() < 30000);
      return isVeryRecent && ((rawUsername && repUser === rawUsername) || (rawFullName && repName.includes(rawFullName)));
    });

    passLocals.forEach((loc, idx) => {
      const { status, statusType, stepProgress } = parseCaseStatus(loc.status || 'Pending TRD Review');
      const locId = `notif_loc_pass_${loc.id || idx}_${status}`;
      const isAlreadyInNotifs = notifs.some(n => n.plateNo === loc.plate_no || n.recordId === loc.id);
      if (!isAlreadyInNotifs) {
        notifs.push({
          id: locId,
          recordId: loc.id,
          role: 'Passenger',
          category: 'Report Status',
          title: loc.report_type || 'Passenger Report',
          subtitle: `Plate #${loc.plate_no || '—'} (${loc.vehicle_type || 'Pedicab'})`,
          plateNo: loc.plate_no || '—',
          driverName: loc.driver_name || 'Assigned Driver',
          vehicleType: loc.vehicle_type || 'Pedicab',
          actualFare: loc.fare_charged ? `₱${loc.fare_charged}` : null,
          status: status,
          statusType: statusType,
          stepProgress: stepProgress,
          incidentDate: loc.submitted_at ? loc.submitted_at.substring(0, 10) : 'Today',
          description: loc.description || loc.full_description || 'Report filed and queued for TRD review.',
          evidenceImage: loc.attachment?.dataUrl || null,
          evidenceFilename: loc.attachment?.name || null,
          isRead: readIds.includes(locId),
          timestamp: loc.submitted_at || new Date().toISOString()
        });
      }
    });
  } catch (err) {
    console.warn('Local reports read note:', err);
  }

  // Sort newest first
  notifs.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  return notifs;
}

/**
 * Fetch Traffic Enforcer Violation Status Notifications strictly for the logged-in officer.
 * Preserves all previous citations and dynamically reflects Admin status changes.
 */
async function fetchEnforcerNotifications(currentUser, readIds) {
  if (!currentUser?.username && !currentUser?.full_name) return [];

  const notifs = [];
  const enforcerBadge = currentUser.username ? `TRD-ENF-${currentUser.username}` : 'TRD-ENF';

  // 1. Fetch from 'enforcer_violations' table strictly matching this officer
  try {
    const { data: enfData, error: enfErr } = await supabase
      .from('enforcer_violations')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(100);

    if (!enfErr && enfData && enfData.length > 0) {
      const officerViolations = enfData.filter(item => {
        return isMatchingEnforcerOfficer(item.enforcer_name, item.enforcer_badge, null, currentUser);
      });

      officerViolations.forEach((item, index) => {
        const { status, statusType, stepProgress } = parseCaseStatus(item.status);
        const notifId = `notif_enf_${item.id || index}_${status}`;

        if (item.city_plate_number) {
          syncStatusToLocalReports(item.city_plate_number, item.status || status, item.violation_type);
        }

        notifs.push({
          id: notifId,
          recordId: item.id,
          role: 'Traffic Enforcer',
          category: 'Citation Status',
          title: `Citation: ${item.violation_type || 'Traffic Violation'}`,
          subtitle: `Ticket #${item.citation_no || 'CIT-' + (item.id || '').substring(0, 6)} • Plate #${item.city_plate_number || '—'}`,
          citationNo: item.citation_no || 'CIT-2026',
          badgeNo: item.enforcer_badge || enforcerBadge,
          plateNo: item.city_plate_number || '—',
          driverName: item.driver_name || 'Apprehended Driver',
          vehicleType: item.vehicle_category || 'Pedicab',
          status: status,
          statusType: statusType,
          stepProgress: stepProgress,
          incidentDate: item.incident_date || (item.created_at ? item.created_at.substring(0, 10) : 'Recent'),
          description: item.remarks || item.description || 'Violation citation logged.',
          evidenceImage: item.evidence_image || null,
          evidenceFilename: item.evidence_filename || null,
          isRead: readIds.includes(notifId),
          timestamp: item.created_at || new Date().toISOString()
        });
      });
    }
  } catch (err) {
    console.warn('Error fetching enforcer_violations notifications:', err);
  }

  // 2. Also check passenger_complaints for fallback citations submitted by this officer
  try {
    const { data: compData, error: compErr } = await supabase
      .from('passenger_complaints')
      .select('*')
      .ilike('complainant_name', '%[enforcer]%')
      .order('created_at', { ascending: false })
      .limit(50);

    if (!compErr && compData && compData.length > 0) {
      const officerCompCitations = compData.filter(item => {
        return isMatchingEnforcerOfficer(null, null, item.complainant_name, currentUser);
      });

      officerCompCitations.forEach((item, index) => {
        const { status, statusType, stepProgress } = parseCaseStatus(item.status);
        const notifId = `notif_enf_comp_${item.id || index}_${status}`;

        if (item.city_plate_number) {
          syncStatusToLocalReports(item.city_plate_number, item.status || status, item.issue_type);
        }

        if (!notifs.some(n => n.plateNo === item.city_plate_number)) {
          notifs.push({
            id: notifId,
            recordId: item.id,
            role: 'Traffic Enforcer',
            category: 'Citation Status',
            title: `Citation: ${item.issue_type || 'Traffic Violation'}`,
            subtitle: `Plate #${item.city_plate_number || '—'} (${item.vehicle_category || 'Pedicab'})`,
            citationNo: 'CIT-TRD',
            badgeNo: enforcerBadge,
            plateNo: item.city_plate_number || '—',
            driverName: item.driver_name || 'Driver',
            vehicleType: item.vehicle_category || 'Pedicab',
            status: status,
            statusType: statusType,
            stepProgress: stepProgress,
            incidentDate: item.incident_date || 'Recent',
            description: item.description || 'Citation logged via TRD portal.',
            evidenceImage: item.evidence_image || null,
            evidenceFilename: item.evidence_filename || null,
            isRead: readIds.includes(notifId),
            timestamp: item.created_at || new Date().toISOString()
          });
        }
      });
    }
  } catch (err) {
    console.warn('Enforcer fallback query note:', err);
  }

  // 3. Only merge recent local citations if offline or submitted within the last 30 seconds
  try {
    const rawUsername = (currentUser.username || '').trim().toLowerCase();
    const rawFullName = (currentUser.full_name || '').trim().toLowerCase();
    const local = JSON.parse(localStorage.getItem('trd_submitted_reports') || '[]');
    const nowMs = Date.now();
    const enfLocals = local.filter(r => {
      const role = (r.reporter_role || '').toLowerCase();
      if (!role.includes('enforcer')) return false;

      const isVeryRecent = r.submitted_at && (nowMs - new Date(r.submitted_at).getTime() < 30000);
      const repUser = (r.reporter_username || '').trim().toLowerCase();
      const repName = (r.reporter_name || r.reporter_display || '').trim().toLowerCase();

      return isVeryRecent && ((rawUsername && repUser === rawUsername) ||
             (rawFullName && repName.includes(rawFullName)));
    });

    enfLocals.forEach((loc, idx) => {
      const { status, statusType, stepProgress } = parseCaseStatus(loc.status || 'Pending TRD Review');
      const locId = `notif_loc_enf_${loc.id || idx}_${status}`;
      if (!notifs.some(n => n.plateNo === loc.plate_no || n.recordId === loc.id)) {
        notifs.push({
          id: locId,
          recordId: loc.id,
          role: 'Traffic Enforcer',
          category: 'Citation Status',
          title: `Citation: ${loc.report_type || 'Traffic Violation'}`,
          subtitle: `Plate #${loc.plate_no || '—'} (${loc.vehicle_type || 'Pedicab'})`,
          citationNo: loc.citation_no || 'CIT-' + Date.now().toString().slice(-4),
          badgeNo: loc.enforcer_badge || enforcerBadge,
          plateNo: loc.plate_no || '—',
          driverName: loc.driver_name || 'Driver',
          vehicleType: loc.vehicle_type || 'Pedicab',
          status: status,
          statusType: statusType,
          stepProgress: stepProgress,
          incidentDate: loc.submitted_at ? loc.submitted_at.substring(0, 10) : 'Today',
          description: loc.description || loc.full_description || 'Citation submitted to TRD central division.',
          evidenceImage: loc.attachment?.dataUrl || null,
          evidenceFilename: loc.attachment?.name || null,
          isRead: readIds.includes(locId),
          timestamp: loc.submitted_at || new Date().toISOString()
        });
      }
    });
  } catch (err) {
    console.warn('Enforcer local reports read note:', err);
  }

  // Sort newest first
  notifs.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  return notifs;
}

/**
 * Delete a report or violation citation directly from Supabase database
 * and keep local cache synchronized in real-time.
 */
export async function deleteReportRecord(recordId, tableHint = '') {
  if (!recordId) return { success: false, error: 'Missing record ID' };

  let deletedFromDb = false;

  // 1. Try deleting from 'passenger_complaints'
  if (!tableHint || tableHint.includes('complaint')) {
    try {
      const { error } = await supabase
        .from('passenger_complaints')
        .delete()
        .eq('id', recordId);

      if (!error) {
        console.log('✅ Deleted from passenger_complaints:', recordId);
        deletedFromDb = true;
      }
    } catch (err) {
      console.warn('passenger_complaints delete note:', err);
    }
  }

  // 2. Try deleting from 'enforcer_violations'
  if (!tableHint || tableHint.includes('violation')) {
    try {
      const { error } = await supabase
        .from('enforcer_violations')
        .delete()
        .eq('id', recordId);

      if (!error) {
        console.log('✅ Deleted from enforcer_violations:', recordId);
        deletedFromDb = true;
      }
    } catch (err) {
      console.warn('enforcer_violations delete note:', err);
    }
  }

  // 3. Purge from local storage cache
  try {
    const raw = localStorage.getItem('trd_submitted_reports');
    if (raw) {
      const local = JSON.parse(raw);
      const filtered = local.filter(item => item.id !== recordId && item.recordId !== recordId);
      localStorage.setItem('trd_submitted_reports', JSON.stringify(filtered));
    }
  } catch (err) {
    console.warn('Local storage purge note:', err);
  }

  return { success: true, deletedFromDb };
}

/**
 * Delete a franchise record from Supabase Admin tables
 */
export async function deleteFranchiseRecord(plateNo, vehicleType = '') {
  if (!plateNo) return { success: false, error: 'Missing plate number' };

  const cleanPlate = plateNo.trim();
  const tables = vehicleType.toLowerCase().includes('tri')
    ? ['franchise_records_tricycle_admin', 'franchise_records_pedicab_admin']
    : ['franchise_records_pedicab_admin', 'franchise_records_tricycle_admin'];

  let deletedCount = 0;
  for (const tableName of tables) {
    try {
      const { error } = await supabase
        .from(tableName)
        .delete()
        .or(`city_plate_number.eq.${cleanPlate},plate_number.eq.${cleanPlate},mtop_number.eq.${cleanPlate}`);

      if (!error) {
        deletedCount++;
      }
    } catch (err) {
      console.warn(`Error deleting from ${tableName}:`, err);
    }
  }

  return { success: true, deletedCount };
}

/**
 * Real-time listener for Supabase inserts, updates, and DELETIONS made by Admin or Mobile
 */
let activeRealtimeChannel = null;

export function subscribeToRealtimeStatusUpdates(currentUser, onUpdateCallback) {
  if (!currentUser || !supabase) return () => {};

  if (activeRealtimeChannel) {
    try {
      supabase.removeChannel(activeRealtimeChannel);
    } catch {
      /* ignore */
    }
    activeRealtimeChannel = null;
  }

  const channelId = `realtime_sync_${currentUser.username || 'user'}_${Date.now()}`;
  const channel = supabase.channel(channelId);

  channel
    .on('postgres_changes', { event: '*', schema: 'public', table: 'passenger_complaints' }, (payload) => {
      console.log('⚡ Supabase realtime sync [passenger_complaints]:', payload.eventType, payload);
      // If deleted by Admin in Supabase, purge from local storage cache
      if (payload.eventType === 'DELETE' && payload.old?.id) {
        purgeLocalReportById(payload.old.id);
      }
      if (typeof onUpdateCallback === 'function') {
        onUpdateCallback(payload);
      }
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'enforcer_violations' }, (payload) => {
      console.log('⚡ Supabase realtime sync [enforcer_violations]:', payload.eventType, payload);
      if (payload.eventType === 'DELETE' && payload.old?.id) {
        purgeLocalReportById(payload.old.id);
      }
      if (typeof onUpdateCallback === 'function') {
        onUpdateCallback(payload);
      }
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'franchise_records_pedicab_admin' }, (payload) => {
      console.log('⚡ Supabase realtime sync [franchise_records_pedicab_admin]:', payload.eventType, payload);
      if (typeof onUpdateCallback === 'function') {
        onUpdateCallback(payload);
      }
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'franchise_records_tricycle_admin' }, (payload) => {
      console.log('⚡ Supabase realtime sync [franchise_records_tricycle_admin]:', payload.eventType, payload);
      if (typeof onUpdateCallback === 'function') {
        onUpdateCallback(payload);
      }
    })
    .subscribe();

  activeRealtimeChannel = channel;

  return () => {
    if (activeRealtimeChannel) {
      try {
        supabase.removeChannel(activeRealtimeChannel);
      } catch {
        /* ignore */
      }
      activeRealtimeChannel = null;
    }
  };
}

function purgeLocalReportById(id) {
  try {
    const raw = localStorage.getItem('trd_submitted_reports');
    if (raw) {
      const local = JSON.parse(raw);
      const filtered = local.filter(item => item.id !== id && item.recordId !== id);
      localStorage.setItem('trd_submitted_reports', JSON.stringify(filtered));
    }
  } catch {
    /* ignore */
  }
}



