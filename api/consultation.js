'use strict';

const ALLOWED_ORIGINS = ['https://am2am.ai', 'https://www.am2am.ai'];

const LIMITS = {
  firstName: 80,
  lastName: 80,
  email: 200,
  company: 160,
  phone: 60,
  systems: 80,
  notes: 2000,
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function clean(value, max) {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, max);
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function applyCors(req, res) {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.indexOf(origin) !== -1) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Max-Age', '86400');
}

function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string' && req.body) {
    try { return JSON.parse(req.body); } catch (err) { return null; }
  }
  return {};
}

async function sendEmail(payload) {
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + process.env.RESEND_API_KEY,
    },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const detail = await response.text().catch(function () { return ''; });
    throw new Error('Resend responded ' + response.status + ': ' + detail);
  }
  return response.json().catch(function () { return {}; });
}

module.exports = async (req, res) => {
  applyCors(req, res);

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST, OPTIONS');
    res.status(405).json({ ok: false, error: 'Method not allowed.' });
    return;
  }

  const body = readBody(req);
  if (!body) {
    res.status(400).json({ ok: false, error: 'Invalid request body.' });
    return;
  }

  // Honeypot: silently accept, never send.
  if (clean(body.website, 200)) {
    res.status(200).json({ ok: true });
    return;
  }

  const data = {
    firstName: clean(body.firstName, LIMITS.firstName),
    lastName: clean(body.lastName, LIMITS.lastName),
    email: clean(body.email, LIMITS.email),
    company: clean(body.company, LIMITS.company),
    phone: clean(body.phone, LIMITS.phone),
    systems: clean(body.systems, LIMITS.systems),
    notes: clean(body.notes, LIMITS.notes),
  };

  const missing = ['firstName', 'lastName', 'email', 'company'].filter(function (key) {
    return !data[key];
  });
  if (!data.email || !EMAIL_RE.test(data.email)) {
    if (missing.indexOf('email') === -1) missing.push('email');
  }
  if (missing.length) {
    res.status(400).json({ ok: false, error: 'Some required details are missing.', fields: missing });
    return;
  }

  if (!process.env.RESEND_API_KEY) {
    console.error('[consultation] RESEND_API_KEY is not set');
    res.status(500).json({ ok: false, error: 'Unable to send your request right now.' });
    return;
  }

  const name = data.firstName + ' ' + data.lastName;
  const to = process.env.LEAD_TO || 'hello@am2am.ai';
  const from = process.env.LEAD_FROM || 'am2am.ai <noreply@am2am.ai>';
  const subject = 'Consultation request — ' + data.company + ' (' + name + ')';

  const rows = [
    ['Name', name],
    ['Work email', data.email],
    ['Company', data.company],
    ['Phone / WhatsApp', data.phone || '—'],
    ['Records live in', data.systems || '—'],
    ['What Amy should handle first', data.notes || '—'],
  ];

  const html =
    '<div style="font-family:Inter,Segoe UI,Helvetica,Arial,sans-serif;color:#2A1505;line-height:1.6">' +
    '<h2 style="margin:0 0 16px;font-size:18px">New consultation request</h2>' +
    '<table cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:14px">' +
    rows
      .map(function (row) {
        return (
          '<tr>' +
          '<td style="padding:6px 16px 6px 0;color:#8C7A6B;vertical-align:top;white-space:nowrap">' +
          escapeHtml(row[0]) +
          '</td>' +
          '<td style="padding:6px 0;vertical-align:top">' +
          escapeHtml(row[1]).replace(/\n/g, '<br />') +
          '</td>' +
          '</tr>'
        );
      })
      .join('') +
    '</table></div>';

  const text = rows
    .map(function (row) {
      return row[0] + ': ' + row[1];
    })
    .join('\n');

  try {
    await sendEmail({
      from: from,
      to: [to],
      reply_to: data.email,
      subject: subject,
      html: html,
      text: 'New consultation request\n\n' + text,
    });
  } catch (err) {
    console.error('[consultation] failed to send lead email:', err);
    res.status(502).json({ ok: false, error: 'Unable to send your request right now.' });
    return;
  }

  if (process.env.SEND_AUTOREPLY === '1') {
    try {
      await sendEmail({
        from: from,
        to: [data.email],
        reply_to: to,
        subject: 'Thanks — we received your consultation request',
        html:
          '<div style="font-family:Inter,Segoe UI,Helvetica,Arial,sans-serif;color:#2A1505;line-height:1.6">' +
          '<p>Hi ' + escapeHtml(data.firstName) + ',</p>' +
          '<p>Thanks for reaching out about am2am.ai. We have your request for ' +
          escapeHtml(data.company) +
          ' and someone will get back to you shortly to set up a time.</p>' +
          '<p>&mdash; The am2am.ai team</p></div>',
        text:
          'Hi ' + data.firstName + ',\n\n' +
          'Thanks for reaching out about am2am.ai. We have your request for ' + data.company +
          ' and someone will get back to you shortly to set up a time.\n\n— The am2am.ai team\n',
      });
    } catch (err) {
      console.error('[consultation] autoreply failed (non-fatal):', err);
    }
  }

  res.status(200).json({ ok: true });
};
