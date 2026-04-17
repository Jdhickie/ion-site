const RATE_LIMIT_MAP = new Map(); // ip -> { count, resetAt }
const RATE_LIMIT_MAX = 3;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;

const VALID_SERVICES = ['saas', 'ai', 'process', 'other'];

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

export default function handler(req, res) {
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
    name: name.trim(),
    email: email.trim().toLowerCase(),
    service: service || null,
    message: message.trim(),
    submittedAt: new Date().toISOString(),
  };

  console.log('[contact] New submission:', lead);

  // TODO: Supabase — insert lead into `leads` table
  // TODO: Resend — send notification email to john@ion.ie
  // TODO: Claude API — draft personalised reply based on lead.message
  // TODO: Resend — send AI-drafted reply to lead.email

  return res.status(200).json({ success: true });
}
