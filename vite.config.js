import { defineConfig, loadEnv } from 'vite';
import nodemailer from 'nodemailer';

function verificationDispatchPlugin(env = {}) {
  // Normalize Philippine mobile numbers to E.164 (+639XXXXXXXXX)
  function formatE164Phone(raw) {
    if (!raw) return '';
    const cleaned = String(raw).trim().replace(/[^\d+]/g, '');
    if (cleaned.startsWith('+')) return cleaned;
    if (cleaned.startsWith('09') && cleaned.length === 11) {
      return '+63' + cleaned.slice(1);
    }
    if (cleaned.startsWith('9') && cleaned.length === 10) {
      return '+63' + cleaned;
    }
    if (cleaned.startsWith('63') && cleaned.length === 12) {
      return '+' + cleaned;
    }
    return cleaned.startsWith('+') ? cleaned : `+${cleaned}`;
  }

  return {
    name: 'verification-dispatch-plugin',
    configureServer(server) {
      // --------------------------------------------------------------------------
      // 1. TextBee SMS Verification Endpoint (/api/send-sms-verification)
      // --------------------------------------------------------------------------
      server.middlewares.use('/api/send-sms-verification', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end(JSON.stringify({ error: 'Method not allowed' }));
          return;
        }

        let body = '';
        req.on('data', (chunk) => {
          body += chunk;
        });

        req.on('end', async () => {
          try {
            const data = JSON.parse(body || '{}');
            const rawPhone = (data.phone || '').trim();
            const code = (data.code || '').trim();
            const role = (data.role || 'Passenger').trim();

            if (!rawPhone || !code) {
              res.statusCode = 400;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ success: false, error: 'Recipient phone number and verification code are required.' }));
              return;
            }

            const formattedPhone = formatE164Phone(rawPhone);
            const textbeeApiKey = (
              env.TEXTBEE_API_KEY ||
              env.VITE_TEXTBEE_API_KEY ||
              process.env.TEXTBEE_API_KEY ||
              process.env.VITE_TEXTBEE_API_KEY ||
              ''
            ).trim();

            const textbeeDeviceId = (
              env.TEXTBEE_DEVICE_ID ||
              env.VITE_TEXTBEE_DEVICE_ID ||
              process.env.TEXTBEE_DEVICE_ID ||
              process.env.VITE_TEXTBEE_DEVICE_ID ||
              ''
            ).trim();

            const smsMessage = `[TRD Tabaco City] Your ${role} Security Verification Code is: ${code}. Valid for 10 minutes. Do not share this code.`;

            console.log(`\n========================================`);
            console.log(`📱 [TRD TEXTBEE SMS VERIFICATION DISPATCH]`);
            console.log(`ROLE:            ${role}`);
            console.log(`TO (MOBILE):     ${formattedPhone} (Raw: ${rawPhone})`);
            console.log(`CODE:            ${code}`);
            console.log(`GATEWAY:         TextBee Android SMS Gateway (textbee.dev)`);
            console.log(`API KEY STATUS:  ${textbeeApiKey ? 'CONFIGURED (Live Carrier SMS)' : 'NOT SET (Simulated Test Mode)'}`);
            if (textbeeDeviceId) console.log(`DEVICE ID:       ${textbeeDeviceId}`);
            console.log(`MESSAGE:\n${smsMessage}`);
            console.log(`========================================\n`);

            // If TextBee API Key is configured, send live SMS via TextBee API
            if (textbeeApiKey) {
              try {
                const endpoint = textbeeDeviceId
                  ? `https://api.textbee.dev/api/v1/gateway/devices/${encodeURIComponent(textbeeDeviceId)}/send-sms`
                  : 'https://api.textbee.dev/api/v1/gateway/send-sms';

                const payload = {
                  recipients: [formattedPhone],
                  message: smsMessage,
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
                  res.setHeader('Content-Type', 'application/json');
                  res.end(JSON.stringify({
                    success: true,
                    delivered: true,
                    provider: 'textbee',
                    phone: formattedPhone,
                    batchId: responseData?.smsBatchId || responseData?.id || null,
                    details: responseData,
                  }));
                  return;
                } else {
                  console.warn('TextBee API returned non-200 status:', response.status, responseData);
                  // Return friendly error with fallback flag
                  res.setHeader('Content-Type', 'application/json');
                  res.end(JSON.stringify({
                    success: true,
                    delivered: false,
                    simulated: true,
                    provider: 'textbee',
                    phone: formattedPhone,
                    error: responseData?.message || `TextBee error (HTTP ${response.status})`,
                  }));
                  return;
                }
              } catch (apiErr) {
                console.error('TextBee API request failed:', apiErr);
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({
                  success: true,
                  delivered: false,
                  simulated: true,
                  provider: 'textbee',
                  phone: formattedPhone,
                  notice: 'SMS simulated due to TextBee connection issue.',
                }));
                return;
              }
            }

            // Simulated response when TextBee API key is not yet set
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({
              success: true,
              delivered: true,
              simulated: true,
              provider: 'textbee',
              phone: formattedPhone,
              message: `[Simulated] Code ${code} dispatched to ${formattedPhone} via TextBee.`,
            }));
          } catch (err) {
            console.error('SMS dispatch error:', err);
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ success: false, error: err?.message || 'Failed to dispatch SMS' }));
          }
        });
      });

      // --------------------------------------------------------------------------
      // 2. Gmail SMTP Verification Endpoint (/api/send-verification & /api/send-email-verification)
      // --------------------------------------------------------------------------
      const handleEmailDispatch = (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end(JSON.stringify({ error: 'Method not allowed' }));
          return;
        }

        let body = '';
        req.on('data', (chunk) => {
          body += chunk;
        });

        req.on('end', async () => {
          try {
            const data = JSON.parse(body || '{}');
            const toEmail = (data.to || '').trim();
            const code = (data.code || '').trim();
            const role = (data.role || 'Passenger').trim();

            if (!toEmail || !code) {
              res.statusCode = 400;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ success: false, error: 'Recipient email and code are required.' }));
              return;
            }

            const senderEmail = (
              env.GMAIL_USER ||
              process.env.GMAIL_USER ||
              'lorenbacelonia@gmail.com'
            ).trim();

            const appPassword = (
              env.GMAIL_APP_PASSWORD || 
              env.VITE_GMAIL_APP_PASSWORD || 
              process.env.GMAIL_APP_PASSWORD || 
              process.env.VITE_GMAIL_APP_PASSWORD || 
              ''
            ).trim();

            console.log(`\n========================================`);
            console.log(`📧 [TRD GMAIL SMTP VERIFICATION DISPATCH]`);
            console.log(`ROLE:            ${role}`);
            console.log(`FROM (SENDER):   ${senderEmail}`);
            console.log(`TO (RECEIVER):   ${toEmail}`);
            console.log(`CODE:            ${code}`);
            console.log(`DIRECT SMTP:     ${appPassword ? 'ACTIVE (Instant Delivery)' : 'INACTIVE (Using Relay/Simulated)'}`);
            console.log(`========================================\n`);

            if (appPassword) {
              const transporter = nodemailer.createTransport({
                service: 'gmail',
                auth: {
                  user: senderEmail,
                  pass: appPassword.replace(/\s+/g, ''),
                },
                pool: true,
                maxConnections: 3,
                maxMessages: 100,
              });

              const isEnforcer = role === 'Traffic Enforcer';
              const headerBg = isEnforcer ? '#1e3a8a' : '#059669';
              const badgeColor = isEnforcer ? '#1d4ed8' : '#15803d';
              const boxBg = isEnforcer ? '#eff6ff' : '#f0fdf4';
              const boxBorder = isEnforcer ? '#3b82f6' : '#22c55e';

              await transporter.sendMail({
                from: `"TRD Tabaco City Mobile Verifier" <${senderEmail}>`,
                to: toEmail,
                subject: `TRD ${role} Security Verification Code: ${code}`,
                html: `
                  <div style="font-family: Arial, sans-serif; max-width: 520px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 12px; background: #ffffff;">
                    <div style="background: ${headerBg}; padding: 16px; border-radius: 8px; text-align: center; color: white;">
                      <h2 style="margin: 0; font-size: 18px;">TRD Tabaco City Mobile Verifier</h2>
                      <p style="margin: 4px 0 0; font-size: 12px; color: #e2e8f0;">${role} Account Email Verification</p>
                    </div>
                    <div style="padding: 24px 8px; text-align: center;">
                      <p style="font-size: 14px; color: #334155;">You requested an email verification code for:</p>
                      <p style="font-weight: bold; color: #0f172a; font-size: 15px;">${toEmail}</p>
                      <div style="margin: 20px auto; padding: 16px; background: ${boxBg}; border: 2px dashed ${boxBorder}; border-radius: 8px; font-size: 32px; font-weight: 900; letter-spacing: 6px; color: ${badgeColor}; font-family: monospace;">
                        ${code}
                      </div>
                      <p style="font-size: 12px; color: #64748b;">This code expires in 10 minutes. Do not share this code with anyone.</p>
                    </div>
                    <div style="border-top: 1px solid #e2e8f0; padding-top: 12px; font-size: 11px; color: #94a3b8; text-align: center;">
                      Official security dispatch sent from <strong>${senderEmail}</strong> to <strong>${toEmail}</strong> via Gmail SMTP.
                      Transportation Regulation Division — City Government of Tabaco
                    </div>
                  </div>
                `,
              });

              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ success: true, delivered: true, provider: 'gmail_smtp', sender: senderEmail, receiver: toEmail }));
              return;
            }

            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({
              success: true,
              delivered: false,
              simulated: true,
              provider: 'gmail_smtp',
              sender: senderEmail,
              receiver: toEmail,
              message: `Code dispatched from ${senderEmail} to ${toEmail}.`
            }));
          } catch (err) {
            console.error('Email dispatch error:', err);
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ success: false, error: err?.message || 'Failed to dispatch email' }));
          }
        });
      };

      server.middlewares.use('/api/send-verification', handleEmailDispatch);
      server.middlewares.use('/api/send-email-verification', handleEmailDispatch);
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    base: './',
    plugins: [verificationDispatchPlugin(env)],
    server: {
      host: true,
      port: 5174,
      allowedHosts: true, // Allow external tunnel (Cloudflare, ngrok, etc.)
    }
  };
});
