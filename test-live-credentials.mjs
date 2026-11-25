import nodemailer from 'nodemailer';
import fs from 'fs';
import path from 'path';

// Parse .env manually
function loadEnvFile() {
  const envPath = path.resolve(process.cwd(), '.env');
  const env = {};
  if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, 'utf8').split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx !== -1) {
        const key = trimmed.slice(0, eqIdx).trim();
        const val = trimmed.slice(eqIdx + 1).trim().replace(/^['"]|['"]$/g, '');
        env[key] = val;
      }
    }
  }
  return env;
}

const env = loadEnvFile();

const textbeeApiKey = (process.env.TEXTBEE_API_KEY || env.TEXTBEE_API_KEY || env.VITE_TEXTBEE_API_KEY || '').trim();
const textbeeDeviceId = (process.env.TEXTBEE_DEVICE_ID || env.TEXTBEE_DEVICE_ID || env.VITE_TEXTBEE_DEVICE_ID || '').trim();
const gmailUser = (process.env.GMAIL_USER || env.GMAIL_USER || 'lorenbacelonia@gmail.com').trim();
const gmailAppPassword = (process.env.GMAIL_APP_PASSWORD || env.GMAIL_APP_PASSWORD || env.VITE_GMAIL_APP_PASSWORD || '').trim();

console.log('\n======================================================');
console.log('🔍 [TRD VERIFICATION CREDENTIALS STATUS CHECK]');
console.log('======================================================');
console.log('1. GMAIL SMTP:');
console.log('   Sender Email:  ', gmailUser);
console.log('   App Password:  ', gmailAppPassword ? `Configured (${gmailAppPassword.length} chars) ✅` : 'MISSING ❌');
console.log('');
console.log('2. TEXTBEE SMS GATEWAY:');
console.log('   API Key:       ', textbeeApiKey ? `Configured (${textbeeApiKey.slice(0, 6)}...) ✅` : 'MISSING ❌');
console.log('   Device ID:     ', textbeeDeviceId || '(Using default active device)');
console.log('======================================================\n');

async function testGmailSMTP(targetEmail = null) {
  if (!gmailAppPassword) {
    console.log('⚠️ [Gmail SMTP Test Skipped]: GMAIL_APP_PASSWORD is not set in .env.');
    return;
  }

  console.log(`📡 Connecting to Gmail SMTP with account: ${gmailUser}...`);
  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: gmailUser,
      pass: gmailAppPassword.replace(/\s+/g, ''),
    },
  });

  try {
    await transporter.verify();
    console.log('✅ [Gmail SMTP Success]: Authentication verified! Gmail is ready to send live verification emails.');

    if (targetEmail) {
      console.log(`📤 Dispatching test email to ${targetEmail}...`);
      const testCode = String(Math.floor(100000 + Math.random() * 900000));
      await transporter.sendMail({
        from: `"TRD Tabaco City Mobile Verifier" <${gmailUser}>`,
        to: targetEmail,
        subject: `TRD Verification Live Test Code: ${testCode}`,
        text: `Your TRD Verification Test Code is: ${testCode}. Valid for 10 minutes.`,
      });
      console.log(`✅ [Gmail Sent]: Live test verification email successfully delivered to ${targetEmail}!`);
    }
  } catch (err) {
    console.error('❌ [Gmail SMTP Error]: Authentication failed:', err.message);
  }
}

async function testTextBeeSMS(targetPhone = null) {
  if (!textbeeApiKey) {
    console.log('⚠️ [TextBee SMS Test Skipped]: TEXTBEE_API_KEY is not set in .env.');
    return;
  }

  console.log('📡 Connecting to TextBee API (https://api.textbee.dev)...');
  try {
    const endpoint = textbeeDeviceId
      ? `https://api.textbee.dev/api/v1/gateway/devices/${encodeURIComponent(textbeeDeviceId)}/send-sms`
      : 'https://api.textbee.dev/api/v1/gateway/send-sms';

    if (targetPhone) {
      let formattedPhone = targetPhone.replace(/[^\d+]/g, '');
      if (!formattedPhone.startsWith('+')) {
        if (formattedPhone.startsWith('09')) formattedPhone = '+63' + formattedPhone.slice(1);
        else formattedPhone = '+63' + formattedPhone;
      }

      const testCode = String(Math.floor(100000 + Math.random() * 900000));
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'x-api-key': textbeeApiKey,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify({
          recipients: [formattedPhone],
          message: `[TRD Tabaco City] Your Passenger Verification Code is: ${testCode}. Valid for 10 minutes.`,
          ...(textbeeDeviceId ? { deviceId: textbeeDeviceId } : {}),
        }),
      });

      const resData = await res.json().catch(() => ({}));
      if (res.ok) {
        console.log(`✅ [TextBee SMS Success]: Live test SMS sent to ${formattedPhone}! Batch ID:`, resData?.smsBatchId || resData?.id);
      } else {
        console.error('❌ [TextBee SMS API Error]:', resData);
      }
    } else {
      console.log('ℹ️ Provide a target phone number to send a live test SMS: node test-live-credentials.mjs <phone> <email>');
    }
  } catch (err) {
    console.error('❌ [TextBee Exception]:', err.message);
  }
}

const argPhone = process.argv[2];
const argEmail = process.argv[3];

await testGmailSMTP(argEmail || (gmailAppPassword ? gmailUser : null));
console.log('');
await testTextBeeSMS(argPhone);
