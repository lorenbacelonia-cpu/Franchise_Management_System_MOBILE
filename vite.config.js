import { defineConfig, loadEnv } from 'vite';
import nodemailer from 'nodemailer';

function emailDispatchPlugin(env = {}) {
  return {
    name: 'email-dispatch-plugin',
    configureServer(server) {
      server.middlewares.use('/api/send-verification', (req, res) => {
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

            const senderEmail = 'lorenbacelonia@gmail.com';
            const appPassword = (
              env.GMAIL_APP_PASSWORD || 
              env.VITE_GMAIL_APP_PASSWORD || 
              process.env.GMAIL_APP_PASSWORD || 
              process.env.VITE_GMAIL_APP_PASSWORD || 
              ''
            ).trim();

            console.log(`\n========================================`);
            console.log(`📧 [TRD MOBILE VERIFICATION DISPATCH]`);
            console.log(`ROLE:            ${role}`);
            console.log(`FROM (SENDER):   ${senderEmail}`);
            console.log(`TO (RECEIVER):   ${toEmail}`);
            console.log(`CODE:            ${code}`);
            console.log(`DIRECT SMTP:     ${appPassword ? 'ACTIVE (Instant Delivery)' : 'INACTIVE (Using Relay)'}`);
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
                      Official security dispatch sent from <strong>${senderEmail}</strong> to <strong>${toEmail}</strong>.
                      Transportation Regulation Division — City Government of Tabaco
                    </div>
                  </div>
                `,
              });

              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ success: true, delivered: true, sender: senderEmail, receiver: toEmail }));
              return;
            }

            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({
              success: true,
              delivered: false,
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
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    base: './',
    plugins: [emailDispatchPlugin(env)],
    server: {
      host: true,
      allowedHosts: true, // Allow external tunnel (Cloudflare, ngrok, etc.)
    }
  };
});
