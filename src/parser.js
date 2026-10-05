/**
 * Tabaco City TRD - Intelligent Dynamic QR Code Parser
 * Supports: JSON, Key-Value pairs, URL query params, Delimited strings, and Raw Text
 */

export function parseQRCode(rawText, currentMode = 'pedicab') {
  if (!rawText) {
    return createDefaultRecord(currentMode);
  }

  const text = rawText.trim();

  // 1. Try parsing JSON format
  try {
    let jsonStr = text;
    // Extract JSON object if embedded in text
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) jsonStr = jsonMatch[0];
    
    const json = JSON.parse(jsonStr);
    if (typeof json === 'object' && json !== null) {
      const vehicleType = detectVehicleType(json.vehicleType || json.vehicle_type || json.type || text, currentMode);
      
      return {
        type: 'franchise',
        vehicleType,
        vehicleTitle: `${vehicleType} Verified Unit`,
        operator: json.operator || json.operator_name || json.operatorName || json.owner || '—',
        driver: json.driver || json.driver_name || json.driverName || json.name || '—',
        plateNo: String(json.plateNo || json.plate_no || json.plate || json.city_plate_no || json.body_no || json.id || '—'),
        route: json.route || json.parada || json.route_name || json.line || json.destination || 'Tabaco City Route',
        expiry: json.expiry || json.expiry_date || json.valid_until || json.expiration || '2026-12-31',
        touristGuide: parseTouristGuide(json.touristGuide || json.tourist_guide || json.tourist || json.isTouristGuide),
        availability: json.availability || json.status || 'Available',
        status: json.status || 'Active',
        fareFee: json.fareFee || json.fare || json.rate || json.fee || null,
        raw: text
      };
    }
  } catch (e) {
    // Not valid JSON, continue to next parsers
  }

  // 2. Try URL Query Parameter Parsing (e.g. https://domain.com/verify?plate=123&driver=Juan...)
  if (text.includes('?') || text.startsWith('http://') || text.startsWith('https://')) {
    try {
      const urlStr = text.startsWith('http') ? text : `http://dummy.local/?${text.split('?')[1] || text}`;
      const url = new URL(urlStr);
      const params = url.searchParams;

      const plate = params.get('plate') || params.get('plate_no') || params.get('plateNo') || params.get('id');
      const driver = params.get('driver') || params.get('driver_name') || params.get('driverName') || params.get('name');
      const operator = params.get('operator') || params.get('operator_name') || params.get('owner');
      const route = params.get('route') || params.get('parada') || params.get('destination');
      const type = params.get('type') || params.get('vehicle_type') || params.get('vehicleType');
      const expiry = params.get('expiry') || params.get('expiry_date') || params.get('exp');
      const fare = params.get('fare') || params.get('fare_fee') || params.get('fee');
      const tourist = params.get('tourist') || params.get('tourist_guide');
      const status = params.get('status') || params.get('availability');

      if (plate || driver || operator || route) {
        const isTri = isTricycle(type || text || currentMode);
        const vehicleType = isTri ? 'Tricycle' : 'Pedicab';
        return {
          type: 'franchise',
          vehicleType,
          vehicleTitle: `${vehicleType} Verified Unit`,
          operator: operator || '—',
          driver: driver || '—',
          plateNo: plate || '—',
          route: route || 'Tabaco City Route',
          expiry: expiry || '2026-12-31',
          touristGuide: parseTouristGuide(tourist),
          availability: status || 'Available',
          status: 'Active',
          fareFee: fare || null,
          raw: text
        };
      }
    } catch (e) {
      // Not a valid URL query
    }
  }

  // 3. Try Key-Value / Multi-Line / Delimited Parsing (e.g. "Driver: Juan | Plate: 1234")
  const extracted = extractKeyValuePairs(text);
  if (extracted.matchedCount >= 2 || extracted.plateNo || extracted.driver) {
    const isTri = isTricycle(extracted.vehicleType || text || currentMode);
    const vehicleType = isTri ? 'Tricycle' : 'Pedicab';
    return {
      type: 'franchise',
      vehicleType,
      vehicleTitle: `${vehicleType} Verified Unit`,
      operator: extracted.operator || '—',
      driver: extracted.driver || '—',
      plateNo: extracted.plateNo || '—',
      route: extracted.route || 'Tabaco City Route',
      expiry: extracted.expiry || '2026-12-31',
      touristGuide: parseTouristGuide(extracted.touristGuide),
      availability: extracted.availability || 'Available',
      status: extracted.status || 'Active',
      fareFee: extracted.fareFee || null,
      raw: text
    };
  }

  // 4. Try Delimited Segment Parsing (e.g. "TRD:PEDICAB:1243:Juan Dela Cruz:Pedro Santos:Sua-Igot:2026-12-31" or "TRD:TRICYCLE:T-999:...")
  const rawSegments = text.split(/[:|,\n\r]+/).map(s => s.trim()).filter(Boolean);
  if (rawSegments.length >= 3) {
    let vehicleType = isTricycle(text || currentMode) ? 'Tricycle' : 'Pedicab';
    let plateNo = '';
    let driver = '';
    let operator = '';
    let route = '';
    let expiry = '';

    const meaningfulSegments = rawSegments.filter(seg => {
      const s = seg.toUpperCase();
      if (s === 'TRD' || s === 'TABACOROUTE' || s === 'FRANCHISE' || s === 'QR') return false;
      if (s === 'PEDICAB' || s === 'TRICYCLE') {
        vehicleType = s === 'TRICYCLE' ? 'Tricycle' : 'Pedicab';
        return false;
      }
      return true;
    });

    for (const seg of meaningfulSegments) {
      if (/^\d{4}-\d{2}-\d{2}$/.test(seg) || /^\d{2}\/\d{2}\/\d{4}$/.test(seg)) {
        expiry = seg;
      } else if (!plateNo && (/^[A-Za-z]{0,3}[-_ ]?\d{2,6}[-_ ]?[A-Za-z]{0,3}$/.test(seg) || /^[A-Za-z0-9\-_]{2,8}$/.test(seg))) {
        plateNo = seg;
      } else if (!operator) {
        operator = seg;
      } else if (!driver) {
        driver = seg;
      } else if (!route) {
        route = seg;
      }
    }

    if (plateNo || driver || operator) {
      return {
        type: 'franchise',
        vehicleType,
        vehicleTitle: `${vehicleType} Verified Unit`,
        operator: operator || '—',
        driver: driver || operator || '—',
        plateNo: plateNo || '—',
        route: route || 'Tabaco City Route',
        expiry: expiry || '2026-12-31',
        touristGuide: 'Yes',
        availability: 'Available',
        status: 'Active',
        fareFee: null,
        raw: text
      };
    }
  }

  // 5. Fallback for raw text: extract any plate numbers or text segments dynamically
  const isTri = isTricycle(text || currentMode);
  const vehicleType = isTri ? 'Tricycle' : 'Pedicab';

  let extractedPlate = '—';
  if (/^[A-Za-z0-9\-_ ]{2,15}$/.test(text)) {
    extractedPlate = text.trim();
  } else {
    const numMatch = text.match(/\b[A-Za-z]{0,3}[-_ ]?\d{2,6}[-_ ]?[A-Za-z]{0,3}\b/);
    extractedPlate = numMatch ? numMatch[0].trim() : (text.replace(/[^0-9A-Za-z]/g, '').substring(0, 8) || '—');
  }

  return {
    type: 'franchise',
    vehicleType,
    vehicleTitle: `${vehicleType} Verified Unit`,
    operator: 'Official Operator',
    driver: text.length < 35 ? text : 'Verified Driver',
    plateNo: extractedPlate,
    route: 'Tabaco City Route',
    expiry: '2026-12-31',
    touristGuide: 'Yes',
    availability: 'Available',
    status: 'Active',
    fareFee: null,
    raw: text
  };
}

export function detectVehicleType(str = '', fallbackMode = 'Pedicab') {
  const s = String(str).toLowerCase();
  if (s.includes('tricycle') || s.includes('trike') || s.includes('toda')) return 'Tricycle';
  if (s.includes('pedicab') || s.includes('padyak') || s.includes('poda')) return 'Pedicab';
  
  // Plate prefix detection
  if (/\b[tT][\s\-_]?\d+|\b\d+[\s\-_]?[tT][rR]\b|\b[tT][rR][\s\-_]?\d+/i.test(s)) return 'Tricycle';
  if (/\b[pP][\s\-_]?\d+|\b[pP][eE][dD][\s\-_]?\d+/i.test(s)) return 'Pedicab';

  return (fallbackMode && fallbackMode.toLowerCase().includes('tri')) ? 'Tricycle' : 'Pedicab';
}

function isTricycle(str = '') {
  return detectVehicleType(str) === 'Tricycle';
}

function parseTouristGuide(val) {
  if (val === true || val === 1 || /^(yes|true|1|y)$/i.test(String(val).trim())) return 'Yes';
  if (val === false || val === 0 || /^(no|false|0|n)$/i.test(String(val).trim())) return 'No';
  return 'Yes';
}

function extractKeyValuePairs(text) {
  const result = { matchedCount: 0 };

  const patterns = [
    { key: 'operator', regex: /(?:operator|owner|operator_name|op)\s*[:=\-]\s*([^\r\n|,;]+)/i },
    { key: 'driver', regex: /(?:driver|driver_name|driverName|name|dr)\s*[:=\-]\s*([^\r\n|,;]+)/i },
    { key: 'plateNo', regex: /(?:plate|plate_no|plateNo|city_plate|body_no|unit_no|id)\s*[:=\-]\s*([^\r\n|,;]+)/i },
    { key: 'route', regex: /(?:route|parada|line|destination|dest)\s*[:=\-]\s*([^\r\n|,;]+)/i },
    { key: 'vehicleType', regex: /(?:type|vehicle|vehicle_type|vehicleType|veh)\s*[:=\-]\s*([^\r\n|,;]+)/i },
    { key: 'expiry', regex: /(?:expiry|expiry_date|expiration|valid_until|valid)\s*[:=\-]\s*([^\r\n|,;]+)/i },
    { key: 'touristGuide', regex: /(?:tourist|tourist_guide|tg)\s*[:=\-]\s*([^\r\n|,;]+)/i },
    { key: 'availability', regex: /(?:availability|avail|status)\s*[:=\-]\s*([^\r\n|,;]+)/i },
    { key: 'fareFee', regex: /(?:fare|fare_fee|rate|fee|price)\s*[:=\-]\s*([^\r\n|,;]+)/i },
  ];

  for (const p of patterns) {
    const match = text.match(p.regex);
    if (match && match[1]) {
      result[p.key] = match[1].trim();
      result.matchedCount++;
    }
  }

  return result;
}

function createDefaultRecord(currentMode = 'pedicab') {
  const isTri = currentMode === 'tricycle';
  const vehicleType = isTri ? 'Tricycle' : 'Pedicab';
  return {
    type: 'franchise',
    vehicleType,
    vehicleTitle: `${vehicleType} Verified Unit`,
    operator: '—',
    driver: '—',
    plateNo: '—',
    route: 'Tabaco City Route',
    expiry: '2026-12-31',
    touristGuide: 'Yes',
    availability: 'Available',
    status: 'Active',
    fareFee: null,
    raw: ''
  };
}
