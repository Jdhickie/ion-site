import crypto from 'crypto';
import supabase from '../../_lib/supabase.js';

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
      '<h1>Invalid link</h1><p>This link is missing required parameters.</p>'));
  }

  const { data: lead, error } = await supabase
    .from('leads')
    .select('id, approval_token, draft_status, email')
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

  if (lead.draft_status === 'rejected') {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(200).send(htmlPage('Already rejected',
      '<h1>Already rejected</h1><p>This draft was already rejected. You can close this tab.</p>'));
  }

  if (lead.draft_status === 'sent') {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(409).send(htmlPage('Already sent',
      `<h1>Already sent</h1><p>A reply was already sent to ${lead.email} — it can't be rejected now.</p>`));
  }

  await supabase
    .from('leads')
    .update({ draft_status: 'rejected' })
    .eq('id', id);

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  return res.status(200).send(htmlPage('Draft rejected',
    '<h1>Draft rejected</h1><p>The draft has been rejected. You can reply manually. You can close this tab.</p>'));
}
