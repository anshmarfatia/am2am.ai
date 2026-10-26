/**
 * POST /api/book — "Get started" lead form (get-started.html).
 * Sends the lead to LEAD_TO via the Resend REST API, plus an optional
 * confirmation to the prospect when SEND_AUTOREPLY=1. No npm dependencies.
 */

var LIMITS = {
  email: 254,
  name: 120,
  company: 160,
  role: 120,
  size: 60,
  channels: 400,
  systems: 400,
  otherChannel: 160,
  otherSystem: 160,
  phone: 40,
  need: 2000
};

var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[A-Za-z]{2,}$/;

function clean(value, max) {
  if (value === undefined || value === null) return '';
  return String(value).trim().slice(0, max);
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function parseBody(body) {
  if (!body) return {};
  if (typeof body === 'string') {
    try {
      return JSON.parse(body);
    } catch (e) {
      return {};
    }
  }
  if (typeof body === 'object') return body;
  return {};
}

async function sendEmail(payload) {
  var response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + process.env.RESEND_API_KEY,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });
  if (!response.ok) {
    var detail = await response.text().catch(function () {
      return '';
    });
    throw new Error('Resend responded ' + response.status + ': ' + detail);
  }
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'Method not allowed.' });
  }

  var raw = parseBody(req.body);

  // Honeypot: accept silently so bots get no signal.
  if (clean(raw._honey, 200)) return res.status(200).json({ ok: true });

  var lead = {};
  Object.keys(LIMITS).forEach(function (key) {
    lead[key] = clean(raw[key], LIMITS[key]);
  });

  if (!EMAIL_RE.test(lead.email)) {
    return res.status(400).json({ ok: false, error: 'Please enter a valid work email.' });
  }
  if (!lead.name) return res.status(400).json({ ok: false, error: 'Please tell us your name.' });
  if (!lead.company) return res.status(400).json({ ok: false, error: 'Please tell us your company.' });
  if (!lead.channels) return res.status(400).json({ ok: false, error: 'Please pick at least one chat channel.' });
  if (!lead.systems) return res.status(400).json({ ok: false, error: 'Please pick at least one system.' });

  var apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ ok: false, error: 'Booking is not configured yet.' });
  }

  var rows = [
    ['Name', lead.name],
    ['Email', lead.email],
    ['Company', lead.company],
    ['Role', lead.role],
    ['Team size', lead.size],
    ['Chat channels', lead.channels],
    ['Other chat channel', lead.otherChannel],
    ['Systems', lead.systems],
    ['Other system', lead.otherSystem],
    ['Phone', lead.phone],
    ['What Amy should handle first', lead.need]
  ].filter(function (row) {
    return row[1];
  });

  var text = rows
    .map(function (row) {
      return row[0] + ': ' + row[1];
    })
    .join('\n');

  var html =
    '<h2>New Get Started request</h2><table cellpadding="6" style="border-collapse:collapse">' +
    rows
      .map(function (row) {
        return (
          '<tr><td style="vertical-align:top"><strong>' +
          escapeHtml(row[0]) +
          '</strong></td><td style="vertical-align:top">' +
          escapeHtml(row[1]).replace(/\n/g, '<br>') +
          '</td></tr>'
        );
      })
      .join('') +
    '</table>';

  var from = process.env.LEAD_FROM || 'am2am.ai <noreply@am2am.ai>';
  var to = process.env.LEAD_TO || 'hello@am2am.ai';

  try {
    await sendEmail({
      from: from,
      to: [to],
      reply_to: lead.email,
      subject: 'Get Started: ' + lead.company + ' — ' + lead.name,
      text: text,
      html: html
    });
  } catch (err) {
    console.error('[book] failed to send lead email:', err);
    return res.status(502).json({ ok: false, error: 'We could not send your request just now. Please try again.' });
  }

  if (process.env.SEND_AUTOREPLY === '1') {
    var firstName = lead.name.split(/\s+/)[0];
    var confirmation =
      'Thanks ' + firstName + ' — we received your request and will be in touch ' +
      'within one working day to set a time.';
    try {
      await sendEmail({
        from: from,
        to: [lead.email],
        reply_to: to,
        subject: 'Thanks — we received your request',
        text: confirmation + '\n\n— The am2am.ai team\n',
        html:
          '<div style="font-family:Inter,Segoe UI,Helvetica,Arial,sans-serif;color:#2A1505;line-height:1.6">' +
          '<p>' + escapeHtml(confirmation) + '</p>' +
          '<p>&mdash; The am2am.ai team</p></div>'
      });
    } catch (err) {
      /* Non-fatal: the lead is already delivered, so the form still succeeds. */
      console.error('[book] autoreply failed (non-fatal):', err);
    }
  }

  return res.status(200).json({ ok: true });
};
