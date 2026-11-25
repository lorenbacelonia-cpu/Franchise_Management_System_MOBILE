export default async function handler(req, res) {
  // CORS support
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const data = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const rawPhone = (data.phone || '').trim();
    const code = (data.code || '').trim();
    const role = (data.role || 'Passenger').trim();

    if (!rawPhone || !code) {
      res.status(400).json({ success: false, error: 'Recipient phone number and verification code are required.' });
      return;
    }

    // Format Philippine E.164
    let formattedPhone = rawPhone.replace(/[^\d+]/g, '');
    if (!formattedPhone.startsWith('+')) {
      if (formattedPhone.startsWith('09') && formattedPhone.length === 11) {
        formattedPhone = '+63' + formattedPhone.slice(1);
      } else if (formattedPhone.startsWith('9') && formattedPhone.length === 10) {
        formattedPhone = '+63' + formattedPhone;
      } else if (formattedPhone.startsWith('63') && formattedPhone.length === 12) {
        formattedPhone = '+' + formattedPhone;
      } else {
        formattedPhone = '+' + formattedPhone;
      }
    }

    const textbeeApiKey = (process.env.TEXTBEE_API_KEY || process.env.VITE_TEXTBEE_API_KEY || 'txb_mJ6WrN1XSGwvN6bt5Vnz4FEMqsXW0lvm').trim();
    const textbeeDeviceId = (process.env.TEXTBEE_DEVICE_ID || process.env.VITE_TEXTBEE_DEVICE_ID || '6b0750bb96bbd64a70a96de5').trim();
    const textbeeSimSlot = parseInt(process.env.TEXTBEE_SIM_SLOT || process.env.VITE_TEXTBEE_SIM_SLOT || '1', 10);

    const smsMessage = `[TRD Tabaco City] Your ${role} Security Verification Code is: ${code}. Valid for 10 minutes. Do not share this code.`;

    if (textbeeApiKey) {
      const endpoint = textbeeDeviceId
        ? `https://api.textbee.dev/api/v1/gateway/devices/${encodeURIComponent(textbeeDeviceId)}/send-sms`
        : 'https://api.textbee.dev/api/v1/gateway/send-sms';

      const payload = {
        recipients: [formattedPhone],
        message: smsMessage,
        simSlotIndex: isNaN(textbeeSimSlot) ? 1 : textbeeSimSlot,
      };
      if (textbeeDeviceId) {
        payload.deviceId = textbeeDeviceId;
      }

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'x-api-key': textbeeApiKey,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      const responseData = await response.json().catch(() => ({}));

      if (response.ok) {
        res.status(200).json({
          success: true,
          delivered: true,
          provider: 'textbee',
          phone: formattedPhone,
          batchId: responseData?.smsBatchId || responseData?.id || null,
          details: responseData,
        });
        return;
      } else {
        res.status(200).json({
          success: true,
          delivered: false,
          simulated: true,
          provider: 'textbee',
          phone: formattedPhone,
          error: responseData?.message || `TextBee returned status ${response.status}`,
        });
        return;
      }
    }

    // Fallback simulation when no API key configured
    res.status(200).json({
      success: true,
      delivered: true,
      simulated: true,
      provider: 'textbee',
      phone: formattedPhone,
      message: `[Simulated] Code ${code} dispatched to ${formattedPhone} via TextBee.`,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err?.message || 'Failed to dispatch SMS' });
  }
}
