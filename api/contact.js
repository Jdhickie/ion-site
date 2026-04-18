import crypto from 'crypto';
import supabase from './_lib/supabase.js';
import resend from './_lib/resend.js';
import claude from './_lib/claude.js';

const RATE_LIMIT_MAP = new Map(); // ip -> { count, resetAt }
const RATE_LIMIT_MAX = 3;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;

const VALID_SERVICES = ['saas', 'ai', 'process', 'other'];

const SERVICE_LABELS = {
  saas: 'SaaS / Web Application',
  ai: 'AI Automation',
  process: 'Process Consulting',
  other: 'Something else',
};

function getRateLimit(ip) {
  const now = Date.now();
  const entry = RATE_LIMIT_MAP.get(ip);
  if (!entry || now > entry.resetAt) {
    RATE_LIMIT_MAP.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return { allowed: true };
  }
  if (entry.count >= RATE_LIMIT_MAX) return { allowed: false };
  entry.count++;
  return { allowed: true };
}

function getBaseUrl() {
  if (process.env.PUBLIC_BASE_URL) return process.env.PUBLIC_BASE_URL;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return 'http://localhost:3000';
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function buildNotificationHtml({ lead, draft, id, token }) {
  const baseUrl = getBaseUrl();
  const approveUrl = `${baseUrl}/api/leads/${id}/send?token=${token}`;
  const rejectUrl  = `${baseUrl}/api/leads/${id}/reject?token=${token}`;
  const svcLabel   = SERVICE_LABELS[lead.service] || lead.service || 'Not specified';

  return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:600px;margin:0 auto;padding:20px;background:#f5f5f5;color:#1a1a1a;">

  <div style="background:#fff;border-radius:8px;padding:24px;margin-bottom:16px;border:1px solid #e0e0e0;">
    <h2 style="margin:0 0 16px;font-size:18px;">New enquiry from ${escapeHtml(lead.name)}</h2>
    <table style="width:100%;font-size:14px;border-collapse:collapse;">
      <tr><td style="padding:5px 0;color:#666;width:90px;">Name</td><td>${escapeHtml(lead.name)}</td></tr>
      <tr><td style="padding:5px 0;color:#666;">Email</td><td><a href="mailto:${escapeHtml(lead.email)}">${escapeHtml(lead.email)}</a></td></tr>
      <tr><td style="padding:5px 0;color:#666;">Service</td><td>${escapeHtml(svcLabel)}</td></tr>
      <tr><td style="padding:5px 0;color:#666;">Submitted</td><td>${new Date().toUTCString()}</td></tr>
    </table>
    <div style="margin-top:16px;padding:12px;background:#f9f9f9;border-radius:4px;font-size:14px;line-height:1.65;">
      <div style="font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:#888;margin-bottom:6px;">Message</div>
      ${escapeHtml(lead.message).replace(/\n/g, '<br>')}
    </div>
  </div>

  <div style="background:#fff;border-radius:8px;padding:24px;margin-bottom:20px;border:1px solid #e0e0e0;">
    <div style="font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:#888;margin-bottom:10px;">Claude's draft reply</div>
    <div style="padding:14px;background:#f0faf5;border-left:3px solid #1D9E75;font-size:14px;line-height:1.7;">
      ${escapeHtml(draft).replace(/\n/g, '<br>')}
    </div>
  </div>

  <div style="text-align:center;padding:4px 0 20px;">
    <a href="${approveUrl}" style="display:inline-block;background:#1D9E75;color:#fff;text-decoration:none;padding:14px 32px;border-radius:6px;font-size:15px;font-weight:600;margin-right:10px;">Approve &amp; Send</a>
    <a href="${rejectUrl}"  style="display:inline-block;background:#ebebeb;color:#555;text-decoration:none;padding:14px 20px;border-radius:6px;font-size:13px;">Reject Draft</a>
  </div>

  <p style="text-align:center;font-size:12px;color:#aaa;">
    <a href="#" style="color:#aaa;">View in dashboard</a> (coming soon)
  </p>

</body>
</html>`;
}

function buildErrorNotificationHtml({ lead, error }) {
  const svcLabel = SERVICE_LABELS[lead.service] || lead.service || 'Not specified';

  return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:600px;margin:0 auto;padding:20px;background:#f5f5f5;color:#1a1a1a;">

  <div style="background:#fff;border-radius:8px;padding:24px;border:1px solid #e0e0e0;">
    <h2 style="margin:0 0 16px;font-size:18px;">New enquiry — draft generation failed</h2>
    <table style="width:100%;font-size:14px;border-collapse:collapse;">
      <tr><td style="padding:5px 0;color:#666;width:90px;">Name</td><td>${escapeHtml(lead.name)}</td></tr>
      <tr><td style="padding:5px 0;color:#666;">Email</td><td><a href="mailto:${escapeHtml(lead.email)}">${escapeHtml(lead.email)}</a></td></tr>
      <tr><td style="padding:5px 0;color:#666;">Service</td><td>${escapeHtml(svcLabel)}</td></tr>
    </table>
    <div style="margin-top:16px;padding:12px;background:#f9f9f9;border-radius:4px;font-size:14px;line-height:1.65;">
      <div style="font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:#888;margin-bottom:6px;">Message</div>
      ${escapeHtml(lead.message).replace(/\n/g, '<br>')}
    </div>
    <div style="margin-top:16px;padding:12px;background:#fff3f3;border-left:3px solid #e05555;font-size:13px;line-height:1.5;">
      <strong>Draft generation error:</strong> ${escapeHtml(String(error))}
    </div>
  </div>

  <p style="text-align:center;font-size:12px;color:#aaa;margin-top:16px;">
    Lead saved to Supabase. Please reply manually to
    <a href="mailto:${escapeHtml(lead.email)}" style="color:#aaa;">${escapeHtml(lead.email)}</a>.
  </p>

</body>
</html>`;
}

function isAutoSend() {
  return process.env.AUTO_SEND_LEADS === 'true';
}

function buildAutoSentNotificationHtml({ lead, draft }) {
  const svcLabel = SERVICE_LABELS[lead.service] || lead.service || 'Not specified';
  return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:600px;margin:0 auto;padding:20px;background:#f5f5f5;color:#1a1a1a;">

  <div style="background:#fff;border-radius:8px;padding:24px;margin-bottom:16px;border:1px solid #e0e0e0;">
    <h2 style="margin:0 0 16px;font-size:18px;">New enquiry from ${escapeHtml(lead.name)} <span style="font-size:13px;font-weight:400;color:#1D9E75;">(auto-sent)</span></h2>
    <table style="width:100%;font-size:14px;border-collapse:collapse;">
      <tr><td style="padding:5px 0;color:#666;width:90px;">Name</td><td>${escapeHtml(lead.name)}</td></tr>
      <tr><td style="padding:5px 0;color:#666;">Email</td><td><a href="mailto:${escapeHtml(lead.email)}">${escapeHtml(lead.email)}</a></td></tr>
      <tr><td style="padding:5px 0;color:#666;">Service</td><td>${escapeHtml(svcLabel)}</td></tr>
      <tr><td style="padding:5px 0;color:#666;">Submitted</td><td>${new Date().toUTCString()}</td></tr>
    </table>
    <div style="margin-top:16px;padding:12px;background:#f9f9f9;border-radius:4px;font-size:14px;line-height:1.65;">
      <div style="font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:#888;margin-bottom:6px;">Message</div>
      ${escapeHtml(lead.message).replace(/\n/g, '<br>')}
    </div>
  </div>

  <div style="background:#fff;border-radius:8px;padding:24px;margin-bottom:20px;border:1px solid #e0e0e0;">
    <div style="font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:#888;margin-bottom:10px;">Reply sent to lead</div>
    <div style="padding:14px;background:#f0faf5;border-left:3px solid #1D9E75;font-size:14px;line-height:1.7;">
      ${escapeHtml(draft).replace(/\n/g, '<br>')}
    </div>
  </div>

  <p style="font-size:13px;color:#555;text-align:center;line-height:1.6;">
    This reply was auto-sent to ${escapeHtml(lead.email)}.<br>
    If it was off, reply to the lead directly from your inbox.
  </p>
  <p style="text-align:center;margin-top:12px;">
    <a href="#" style="font-size:12px;color:#aaa;">View in dashboard</a> (coming soon)
  </p>

</body>
</html>`;
}

function buildAutoSendFailedHtml({ lead, draft, error }) {
  const svcLabel = SERVICE_LABELS[lead.service] || lead.service || 'Not specified';
  return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:600px;margin:0 auto;padding:20px;background:#f5f5f5;color:#1a1a1a;">

  <div style="background:#fff;border-radius:8px;padding:24px;border:1px solid #e0e0e0;">
    <h2 style="margin:0 0 16px;font-size:18px;">Auto-send failed — ${escapeHtml(lead.name)}</h2>
    <table style="width:100%;font-size:14px;border-collapse:collapse;">
      <tr><td style="padding:5px 0;color:#666;width:90px;">Name</td><td>${escapeHtml(lead.name)}</td></tr>
      <tr><td style="padding:5px 0;color:#666;">Email</td><td><a href="mailto:${escapeHtml(lead.email)}">${escapeHtml(lead.email)}</a></td></tr>
      <tr><td style="padding:5px 0;color:#666;">Service</td><td>${escapeHtml(svcLabel)}</td></tr>
    </table>
    <div style="margin-top:16px;padding:12px;background:#fff3f3;border-left:3px solid #e05555;font-size:13px;line-height:1.5;">
      <strong>Auto-send error:</strong> ${escapeHtml(String(error))}
    </div>
    <div style="margin-top:16px;">
      <div style="font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:#888;margin-bottom:8px;">Draft (send manually)</div>
      <div style="padding:14px;background:#f9f9f9;border-left:3px solid #ccc;font-size:14px;line-height:1.7;">
        ${escapeHtml(draft).replace(/\n/g, '<br>')}
      </div>
    </div>
  </div>

  <p style="text-align:center;font-size:12px;color:#aaa;margin-top:16px;">
    Lead saved to Supabase. Please reply manually to
    <a href="mailto:${escapeHtml(lead.email)}" style="color:#aaa;">${escapeHtml(lead.email)}</a>.
  </p>

</body>
</html>`;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const ip =
    (req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
    req.socket?.remoteAddress ||
    'unknown';

  if (!getRateLimit(ip).allowed) {
    return res.status(429).json({ error: 'Too many requests. Please try again later.' });
  }

  const { name, email, service, message } = req.body || {};

  if (!name || !email || !message) {
    return res.status(400).json({ error: 'Name, email, and message are required.' });
  }
  if (typeof name !== 'string' || name.trim().length > 100) {
    return res.status(400).json({ error: 'Name must be 100 characters or fewer.' });
  }
  if (typeof message !== 'string' || message.trim().length > 5000) {
    return res.status(400).json({ error: 'Message must be 5,000 characters or fewer.' });
  }
  if (service && !VALID_SERVICES.includes(service)) {
    return res.status(400).json({ error: 'Invalid service selection.' });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Please enter a valid email address.' });
  }

  const lead = {
    name:    name.trim(),
    email:   email.trim().toLowerCase(),
    service: service || null,
    message: message.trim(),
  };

  // ── 1. Insert lead into Supabase ────────────────────────────────────────────
  const approvalToken = crypto.randomBytes(32).toString('hex');

  const { data: row, error: insertError } = await supabase
    .from('leads')
    .insert({ ...lead, status: 'new', approval_token: approvalToken })
    .select('id')
    .single();

  if (insertError) {
    console.error('[contact] Supabase insert error:', insertError);
    return res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }

  const leadId = row.id;
  const svcLabel = SERVICE_LABELS[lead.service] || lead.service || 'enquiry';

  // ── 2. Draft reply with Claude ───────────────────────────────────────────────
  let draft = null;

  try {
    const completion = await claude.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 512,
      system: `You are drafting a reply on behalf of John, founder of Íon — a one-person software and automation consultancy based in Ireland. You help operators, founders, and non-profits replace manual work with systems that compound over time.

Tone: warm, direct, UK/Irish English, no fluff, no emojis, no corporate speak. Write like a thoughtful founder replying personally, because that's what this is.

Your task: draft a reply to the lead below that:
1. Acknowledges what they specifically asked about (don't be generic)
2. Shows you understood their ask
3. Suggests one clear next step: either a 15-minute call, some clarifying questions, or a pointer to a case study if relevant
4. Keeps it under 150 words
5. Signs off: 'John — Íon'

Do not invent case studies or claim capabilities that weren't mentioned. Do not quote prices. If the ask is vague, ask one or two focused clarifying questions rather than pitching.

Lead submission:
Name: ${lead.name}
Looking to build: ${SERVICE_LABELS[lead.service] || lead.service || 'Not specified'}
Message:
${lead.message}`,
      messages: [{ role: 'user', content: 'Draft the reply.' }],
    });

    draft = completion.content.find(b => b.type === 'text')?.text ?? null;

    if (isAutoSend()) {
      // ── Auto-send path ────────────────────────────────────────────────────
      try {
        await resend.emails.send({
          from:    process.env.RESEND_FROM_EMAIL,
          to:      lead.email,
          subject: 'Re: Your enquiry to Íon',
          text:    draft,
        });
        await supabase
          .from('leads')
          .update({ draft_reply: draft, draft_status: 'sent',
                    status: 'responded', responded_at: new Date().toISOString() })
          .eq('id', leadId);
        try {
          await resend.emails.send({
            from:    process.env.RESEND_FROM_EMAIL,
            to:      process.env.RESEND_NOTIFY_EMAIL,
            subject: `[Íon Lead] AUTO-SENT · ${lead.name} — ${svcLabel}`,
            html:    buildAutoSentNotificationHtml({ lead, draft }),
          });
        } catch (notifyErr) {
          console.error('[contact] Auto-sent notify failed:', notifyErr);
        }
      } catch (sendErr) {
        console.error('[contact] Auto-send Resend error:', sendErr);
        await supabase
          .from('leads')
          .update({ draft_reply: draft, draft_status: 'failed' })
          .eq('id', leadId);
        try {
          await resend.emails.send({
            from:    process.env.RESEND_FROM_EMAIL,
            to:      process.env.RESEND_NOTIFY_EMAIL,
            subject: `[Íon Lead] AUTO-SEND FAILED · ${lead.name}`,
            html:    buildAutoSendFailedHtml({ lead, draft, error: sendErr }),
          });
        } catch (notifyErr) {
          console.error('[contact] Auto-send failed notify failed:', notifyErr);
        }
      }
    } else {
      // ── Manual approval path ──────────────────────────────────────────────
      await supabase
        .from('leads')
        .update({ draft_reply: draft, draft_status: 'pending_approval' })
        .eq('id', leadId);
    }

  } catch (claudeErr) {
    console.error('[contact] Claude error:', claudeErr);

    await supabase
      .from('leads')
      .update({ draft_status: 'failed' })
      .eq('id', leadId);

    try {
      await resend.emails.send({
        from:    process.env.RESEND_FROM_EMAIL,
        to:      process.env.RESEND_NOTIFY_EMAIL,
        subject: `[Íon Lead] ${lead.name} — ${svcLabel} (draft failed)`,
        html:    buildErrorNotificationHtml({ lead, error: claudeErr }),
      });
    } catch (resendErr) {
      console.error('[contact] Resend notify (error path) failed:', resendErr);
    }

    return res.status(200).json({ success: true });
  }

  // ── 3. Notify me (manual approval path only) ─────────────────────────────
  if (!isAutoSend()) {
    try {
      await resend.emails.send({
        from:    process.env.RESEND_FROM_EMAIL,
        to:      process.env.RESEND_NOTIFY_EMAIL,
        subject: `[Íon Lead] ${lead.name} — ${svcLabel}`,
        html:    buildNotificationHtml({ lead, draft, id: leadId, token: approvalToken }),
      });
    } catch (resendErr) {
      console.error('[contact] Resend notify failed:', resendErr);
    }
  }

  return res.status(200).json({ success: true });
}
