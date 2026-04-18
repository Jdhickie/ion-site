import crypto from 'crypto';
import supabase from '../../_lib/supabase.js';
import resend from '../../_lib/resend.js';

function htmlPage(title, body) {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title} — Íon</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
           max-width: 480px; margin: 80px auto; padding: 0 24px; color: #1a1a1a; }
    h1   { font-size: 22px; margin-bottom: 12px; }
    p    { color: #555; line-height: 1.6; }
  </style>
</head>
<body>${body}</body>
</html>`;
}

function tokenMatch(stored, given) {
  // timingSafeEqual requires equal-length buffers; length check is not timing-sensitive
  const a = Buffer.from(stored || '', 'utf8');
  const b = Buffer.from(given  || '', 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(405).send(htmlPage('Error', '<h1>Method not allowed</h1>'));
  }

  const { id, token } = req.query;

  if (!id || !token) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(400).send(htmlPage('Invalid link',
      '<h1>Invalid link</h1><p>This approval link is missing required parameters.</p>'));
  }

  const { data: lead, error } = await supabase
    .from('leads')
    .select('*')
    .eq('id', id)
    .single();

  if (error || !lead) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(404).send(htmlPage('Not found',
      '<h1>Not found</h1><p>This lead no longer exists.</p>'));
  }

  if (!tokenMatch(lead.approval_token, token)) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(403).send(htmlPage('Forbidden',
      '<h1>Invalid token</h1><p>This link is not valid.</p>'));
  }

  if (lead.draft_status === 'sent') {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(200).send(htmlPage('Already sent',
      `<h1>Already sent</h1><p>A reply was already sent to ${lead.email}. You can close this tab.</p>`));
  }

  if (!lead.draft_reply) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(400).send(htmlPage('No draft',
      '<h1>No draft available</h1><p>Draft generation failed for this lead. Please reply manually.</p>'));
  }

  try {
    await resend.emails.send({
      from:    process.env.RESEND_FROM_EMAIL,
      to:      lead.email,
      subject: 'Re: Your enquiry to Íon',
      text:    lead.draft_reply,
    });
  } catch (err) {
    console.error('[send] Resend error:', err);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(500).send(htmlPage('Send failed',
      '<h1>Failed to send</h1><p>The email could not be delivered. Please try again or reply manually.</p>'));
  }

  await supabase
    .from('leads')
    .update({ status: 'responded', draft_status: 'sent', responded_at: new Date().toISOString() })
    .eq('id', id);

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  return res.status(200).send(htmlPage('Reply sent',
    `<h1>Reply sent</h1><p>Your reply has been sent to ${lead.email}. You can close this tab.</p>`));
}
