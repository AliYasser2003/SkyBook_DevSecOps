
const { SESv2Client, SendEmailCommand } = require('@aws-sdk/client-sesv2');

const provider = (process.env.EMAIL_PROVIDER || 'mailpit').toLowerCase();

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[char]);
}

async function deliverEmail(to, subject, html, text) {
  if (!to) throw new Error('A recipient email address is required.');

  if (provider === 'ses') {
    const region = process.env.AWS_REGION;

    if (!region || !process.env.SES_FROM_EMAIL) {
      throw new Error('AWS_REGION and SES_FROM_EMAIL are required for SES.');
    }

    const client = new SESv2Client({ region });

    await client.send(new SendEmailCommand({
      FromEmailAddress: process.env.SES_FROM_EMAIL,
      Destination: { ToAddresses: [to] },
      Content: {
        Simple: {
          Subject: { Data: subject, Charset: 'UTF-8' },
          Body: {
            Html: { Data: html, Charset: 'UTF-8' },
            Text: { Data: text, Charset: 'UTF-8' }
          }
        }
      }
    }));

    return;
  }

  const nodemailer = require('nodemailer');

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'mailpit',
    port: Number(process.env.SMTP_PORT || 1025),
    secure: false
  });

  await transporter.sendMail({
    from: process.env.SMTP_FROM || 'SkyBook <no-reply@skybook.local>',
    to,
    subject,
    text,
    html
  });
}

async function sendBookingConfirmation(to, booking) {
  const f = booking.flight || {};

  const passengers = (booking.passengers || [])
    .map(p => `<li>${escapeHtml(p.fullName)}</li>`)
    .join('');

  const subject = `Booking confirmed - ${booking.reference}`;

  const html = `
    <div style="font-family:Arial,sans-serif;max-width:620px;margin:auto">
      <h2>Your SkyBook flight is confirmed</h2>
      <p>Your payment was successful and your booking is confirmed.</p>
      <p><b>Booking reference:</b> ${escapeHtml(booking.reference)}</p>
      <p><b>Flight:</b> ${escapeHtml(f.flightNumber)} -
        ${escapeHtml(f.origin)} to ${escapeHtml(f.destination)}</p>
      <p><b>Departure:</b> ${escapeHtml(f.departureAt)}</p>
      <p><b>Passengers:</b></p>
      <ul>${passengers}</ul>
      <p><b>Total paid:</b> ${escapeHtml(booking.currency)}
        ${escapeHtml(booking.totalAmount)}</p>
      <p>Thank you for choosing SkyBook.</p>
    </div>`;

  const text = [
    'Your SkyBook flight is confirmed.',
    `Booking reference: ${booking.reference}`,
    `Flight: ${f.flightNumber} ${f.origin} to ${f.destination}`,
    `Departure: ${f.departureAt}`,
    `Passengers: ${(booking.passengers || []).map(p => p.fullName).join(', ')}`,
    `Total paid: ${booking.currency} ${booking.totalAmount}`
  ].join('\n');

  return deliverEmail(to, subject, html, text);
}

async function sendBookingCancellation(to, booking) {
  const refunded = booking.paymentStatus === 'REFUNDED';
  const paidWithoutRefund = booking.paymentStatus === 'SUCCEEDED';

  const subject = `Booking cancelled - ${booking.reference}`;

  let paymentMessage;

  if (refunded) {
    paymentMessage =
      'Your booking was cancelled and a simulated refund was processed because cancellation occurred within 15 minutes of successful payment.';
  } else if (paidWithoutRefund) {
    paymentMessage =
      'Your booking was cancelled, but the 15-minute refund window had expired. No automatic refund was processed.';
  } else {
    paymentMessage =
      'Your pending payment was cancelled and reserved seats were released.';
  }

  const html = `
    <div style="font-family:Arial,sans-serif;max-width:620px;margin:auto">
      <h2>Your SkyBook booking has been cancelled</h2>
      <p><b>Booking reference:</b> ${escapeHtml(booking.reference)}</p>
      <p><b>Flight:</b> ${escapeHtml(booking.flightNumber)} -
        ${escapeHtml(booking.origin)} to ${escapeHtml(booking.destination)}</p>
      <p><b>Payment status:</b> ${escapeHtml(booking.paymentStatus || 'UNKNOWN')}</p>
      <p>${escapeHtml(paymentMessage)}</p>
      <p>Thank you for choosing SkyBook.</p>
    </div>`;

  const text = [
    'Your SkyBook booking has been cancelled.',
    `Booking reference: ${booking.reference}`,
    `Flight: ${booking.flightNumber} ${booking.origin} to ${booking.destination}`,
    `Payment status: ${booking.paymentStatus || 'UNKNOWN'}`,
    paymentMessage
  ].join('\n');

  return deliverEmail(to, subject, html, text);
}
module.exports = {
  sendBookingConfirmation,
  sendBookingCancellation
};
