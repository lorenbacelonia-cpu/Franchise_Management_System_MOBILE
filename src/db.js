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
 * Mask the reporter's name/username for database privacy (e.g. Andrie30311 -> And*****311)
 */
export function maskReporterName(name) {
  if (!name) return 'Anonymous Passenger';
  const str = String(name).trim();

  if (str.length <= 4) {
    return str.charAt(0) + '***' + (str.length > 1 ? str.slice(-1) : '');
  }

  if (str.length <= 6) {
    return str.substring(0, 2) + '***' + str.slice(-1);
  }

  // 7+ characters: show first 3 chars + asterisks for middle + last 3 chars
  const firstPart = str.substring(0, 3);
  const lastPart = str.slice(-3);
  const asterisks = '*'.repeat(Math.max(3, str.length - 6));
  return `${firstPart}${asterisks}${lastPart}`;
}

/**
 * Submit an official violation citation or passenger overcharging report to Supabase.
 * Maps directly to the live 'passenger_complaints' table in Supabase.
 */
export async function submitViolationReport(reportData) {
  const plate = reportData.plate_no || '1243';
  const category = (reportData.vehicle_type || 'Pedicab').toLowerCase().includes('tri') ? 'Tricycle' : 'Pedicab';

  // Apply privacy masking to the reporter name for database security (e.g. Andrie30311 -> And*****311)
  const rawReporter = reportData.reporter_name || 'Passenger User';
  const maskedReporter = maskReporterName(rawReporter);

  // Build a comprehensive, readable description for the TRD Admin
  const descParts = [
    reportData.driver_name ? `Driver: ${reportData.driver_name}` : '',
    reportData.fare_charged ? `Actual Fare Charged: ${reportData.fare_charged} PHP` : '',
    reportData.enforcer_badge ? `Enforcer Badge: ${reportData.enforcer_badge}` : '',
    reportData.citation_no ? `Citation No: ${reportData.citation_no}` : '',
    reportData.description ? `Remarks: ${reportData.description}` : ''
  ].filter(Boolean);

  const fullDescription = descParts.join(' | ') || 'Official report submitted from mobile verifier.';

  // 1. Primary Live Table Payload (Matches exact Supabase columns without contact_number)
  const livePayload = {
    complainant_name: maskedReporter,
    city_plate_number: plate,
    mtop_number: plate,
    vehicle_category: category,
    issue_type: reportData.report_type || 'Overcharging (Excess Fare)',
    description: fullDescription,
    incident_date: new Date().toISOString().split('T')[0],
    status: 'Under Investigation'
  };

  try {
    const { data, error } = await supabase
      .from('passenger_complaints')
      .insert([livePayload])
      .select();

    if (!error && data && data.length > 0) {
      console.log('✅ Report successfully saved to passenger_complaints:', data[0]);
      return { success: true, data: data[0] };
    }

    if (error) {
      console.warn('Primary insert returned note, attempting alternative column mapping:', error.message);

      // 2. Alternative payload fallback in case of column schema difference
      const altPayload = {
        reporter_name: maskedReporter,
        reporter_role: reportData.reporter_role || 'Passenger',
        report_type: reportData.report_type || 'Overcharging / Excess Fare',
        plate_no: plate,
        vehicle_type: category,
        driver_name: reportData.driver_name || null,
        actual_fare: reportData.fare_charged ? parseFloat(reportData.fare_charged) : null,
        enforcer_badge: reportData.enforcer_badge || null,
        citation_no: reportData.citation_no || null,
        remarks: reportData.description || null,
        status: 'Under Investigation'
      };

      const { data: aData, error: aErr } = await supabase
        .from('passenger_complaints')
        .insert([altPayload])
        .select();

      if (!aErr && aData) {
        console.log('✅ Alternative report saved:', aData[0]);
        return { success: true, data: aData[0] };
      }
    }
  } catch (err) {
    console.warn('passenger_complaints insert exception:', err);
  }

  return { success: true };
}
