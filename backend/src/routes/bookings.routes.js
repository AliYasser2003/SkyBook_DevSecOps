
const express = require('express');
const crypto = require('crypto');

const pool = require('../config/db');
const auth = require('../middleware/requireAuth');
const admin = require('../middleware/requireAdmin');
const {
  sendBookingConfirmation,
  sendBookingCancellation
} = require('../services/email');
const { createTicketPdf } = require('../services/ticket-pdf');
const router = express.Router();

router.use(auth);

const ref = () =>
  `SKY${Date.now().toString(36).toUpperCase()}${crypto
    .randomBytes(3)
    .toString('hex')
    .toUpperCase()}`;

const toIso = value =>
  value instanceof Date ? value.toISOString() : new Date(value).toISOString();

// Create a pending booking and reserve seats.
router.post('/', async (req, res, next) => {
  const { flightId, passengers, seatNumbers } = req.body;
  const idempotencyKey = req.get('Idempotency-Key');

  if (!idempotencyKey || idempotencyKey.length > 64) {
    return res.status(400).json({
      message: 'A valid Idempotency-Key header is required.'
    });
  }

  if (
    !Number.isInteger(Number(flightId)) ||
    Number(flightId) < 1 ||
    !Array.isArray(passengers) ||
    passengers.length < 1 ||
    passengers.length > 9 ||
    !Array.isArray(seatNumbers) ||
    seatNumbers.length !== passengers.length ||
    seatNumbers.some(
      seat => typeof seat !== 'string' ||
        !/^[1-9][0-9]{0,2}[A-F]$/.test(seat)
    ) ||
    new Set(seatNumbers).size !== seatNumbers.length
  ) {
    return res.status(400).json({
      message: 'Select a flight and enter between 1 and 9 passengers.'
    });
  }

  for (const p of passengers) {
    if (!p || typeof p !== 'object' || Array.isArray(p)) {
      return res.status(400).json({
        message: 'Invalid passenger data.'
      });
    }

    const fullName =
      typeof p.fullName === 'string' ? p.fullName.trim() : '';

    const email =
      typeof p.email === 'string' ? p.email.trim() : '';

    const passportNumber =
      typeof p.passportNumber === 'string'
        ? p.passportNumber.trim()
        : '';

    if (
      fullName.length < 2 ||
      fullName.length > 120 ||
      email.length > 254 ||
      !/^\S+@\S+\.\S+$/.test(email) ||
      passportNumber.length > 40
    ) {
      return res.status(400).json({
        message:
          'Invalid passenger details. Check name, email and passport number.'
      });
    }
  }

  const conn = await pool.getConnection();

  try {
    await conn.beginTransaction();

    // Return the original booking if this request was already processed.
    const [existing] = await conn.execute(
      `SELECT
         b.id,
         b.booking_reference AS reference,
         b.status,
         b.total_amount AS totalAmount,
         b.currency,
         p.id AS paymentId,
         p.status AS paymentStatus
       FROM bookings b
       LEFT JOIN payments p ON p.booking_id = b.id
       WHERE b.user_id = ?
         AND b.idempotency_key = ?
       FOR UPDATE`,
      [req.user.id, idempotencyKey]
    );

    if (existing.length) {
      await conn.commit();

      return res.status(200).json({
        message: 'This booking request was already processed.',
        booking: {
          id: existing[0].id,
          reference: existing[0].reference,
          status: existing[0].status,
          totalAmount: existing[0].totalAmount,
          currency: existing[0].currency
        },
        payment: {
          id: existing[0].paymentId,
          status: existing[0].paymentStatus
        }
      });
    }

    const [flights] = await conn.execute(
      `SELECT *
       FROM flights
       WHERE id = ?
         AND status = 'SCHEDULED'
         AND departure_at > UTC_TIMESTAMP()
       FOR UPDATE`,
      [flightId]
    );

    if (!flights.length) {
      await conn.rollback();

      return res.status(404).json({
        message: 'Flight not found or no longer available.'
      });
    }

    const flight = flights[0];

    if (flight.available_seats < passengers.length) {
      await conn.rollback();

      return res.status(409).json({
        message: `Only ${flight.available_seats} seats remain.`
      });
    }

    // Lock the requested seats to prevent concurrent allocation.
    const placeholders = seatNumbers.map(() => '?').join(', ');

    const [selectedSeats] = await conn.execute(
      `SELECT id, seat_number, status
       FROM flight_seats
       WHERE flight_id = ?
         AND seat_number IN (${placeholders})
       ORDER BY seat_row, seat_letter
       FOR UPDATE`,
      [flight.id, ...seatNumbers]
    );

    if (
      selectedSeats.length !== seatNumbers.length ||
      selectedSeats.some(seat => seat.status !== 'AVAILABLE')
    ) {
      await conn.rollback();

      return res.status(409).json({
        message: 'One or more selected seats are no longer available.',
        unavailableSeats: selectedSeats
          .filter(seat => seat.status !== 'AVAILABLE')
          .map(seat => seat.seat_number)
      });
    }

    const seatsByNumber = new Map(
      selectedSeats.map(seat => [seat.seat_number, seat])
    );

    const total = Number(flight.price) * passengers.length;
    const bookingRef = ref();

    const [booking] = await conn.execute(
      `INSERT INTO bookings
       (
         booking_reference,
         user_id,
         flight_id,
         passenger_count,
         total_amount,
         currency,
         status,
         expires_at,
         idempotency_key
       )
       VALUES (?, ?, ?, ?, ?, ?, 'PENDING_PAYMENT',
               DATE_ADD(UTC_TIMESTAMP(), INTERVAL 15 MINUTE), ?)`,
      [
        bookingRef,
        req.user.id,
        flight.id,
        passengers.length,
        total,
        flight.currency,
        idempotencyKey
      ]
    );

    const seatAssignments = [];

    for (let i = 0; i < passengers.length; i++) {
      const p = passengers[i];
      const seatNumber = seatNumbers[i];

      const [passenger] = await conn.execute(
        `INSERT INTO passengers
         (booking_id, full_name, email, passport_number)
         VALUES (?, ?, ?, ?)`,
        [
          booking.insertId,
          p.fullName.trim(),
          p.email.trim().toLowerCase(),
          p.passportNumber?.trim() || null
        ]
      );

      const seat = seatsByNumber.get(seatNumber);

      const [seatUpdate] = await conn.execute(
        `UPDATE flight_seats
         SET status = 'RESERVED',
             booking_id = ?,
             passenger_id = ?,
             reserved_until = DATE_ADD(UTC_TIMESTAMP(), INTERVAL 15 MINUTE)
         WHERE id = ?
           AND status = 'AVAILABLE'`,
        [booking.insertId, passenger.insertId, seat.id]
      );

      if (seatUpdate.affectedRows !== 1) {
        throw new Error(`Could not reserve seat ${seatNumber}.`);
      }

      seatAssignments.push({
        passengerId: passenger.insertId,
        seatNumber
      });
    }

    const [payment] = await conn.execute(
      `INSERT INTO payments
       (booking_id, amount, currency, provider, status)
       VALUES (?, ?, ?, 'SIMULATED', 'PENDING')`,
      [booking.insertId, total, flight.currency]
    );

    await conn.execute(
      `UPDATE flights
       SET available_seats = available_seats - ?
       WHERE id = ?`,
      [passengers.length, flight.id]
    );

    await conn.commit();

    return res.status(201).json({
      message: 'Booking created. Payment is required within 15 minutes.',
      booking: {
        id: booking.insertId,
        reference: bookingRef,
        status: 'PENDING_PAYMENT',
        totalAmount: total,
        currency: flight.currency,
        expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
        seats: seatAssignments
      },
      payment: {
        id: payment.insertId,
        provider: 'SIMULATED',
        status: 'PENDING'
      }
    });

  } catch (error) {
    await conn.rollback();

    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({
        message: 'This idempotency key has already been used.'
      });
    }

    return next(error);
  } finally {
    conn.release();
  }
});

// Simulate payment success or failure.
router.post('/:id/pay', async (req, res, next) => {
  const bookingId = Number(req.params.id);
  const outcome = req.body.outcome || 'success';

  if (!Number.isInteger(bookingId) || bookingId < 1) {
    return res.status(400).json({ message: 'Invalid booking ID.' });
  }

  if (!['success', 'failure'].includes(outcome)) {
    return res.status(400).json({
      message: 'Outcome must be success or failure.'
    });
  }

  const conn = await pool.getConnection();
  let bookingInfo = null;
  let customerEmail = null;
  let result;

  try {
    await conn.beginTransaction();

    const [bookings] = await conn.execute(
      `SELECT *
       FROM bookings
       WHERE id = ? AND user_id = ?
       FOR UPDATE`,
      [bookingId, req.user.id]
    );

    if (!bookings.length) {
      await conn.rollback();

      return res.status(404).json({ message: 'Booking not found.' });
    }

    const booking = bookings[0];

    const [payments] = await conn.execute(
      `SELECT *
       FROM payments
       WHERE booking_id = ?
       FOR UPDATE`,
      [bookingId]
    );

    if (!payments.length) {
      await conn.rollback();

      return res.status(404).json({ message: 'Payment not found.' });
    }

    const payment = payments[0];

    // Idempotent response for a payment already processed.
    if (booking.status === 'CONFIRMED' && payment.status === 'SUCCEEDED') {
      await conn.commit();

      return res.json({
        message: 'Payment was already completed.',
        booking: {
          id: booking.id,
          reference: booking.booking_reference,
          status: booking.status
        },
        payment: {
          id: payment.id,
          status: payment.status
        }
      });
    }

    if (
      booking.status !== 'PENDING_PAYMENT' ||
      payment.status !== 'PENDING'
    ) {
      await conn.rollback();

      return res.status(409).json({
        message: `Booking cannot be paid. Current status: ${booking.status}.`
      });
    }

    const [flights] = await conn.execute(
      `SELECT *
       FROM flights
       WHERE id = ?
       FOR UPDATE`,
      [booking.flight_id]
    );

    if (!flights.length) {
      throw new Error('The associated flight could not be found.');
    }

    const flight = flights[0];

    const [users] = await conn.execute(
      'SELECT email FROM users WHERE id = ?',
      [req.user.id]
    );

    customerEmail = users[0]?.email;

    const [passengers] = await conn.execute(
      `SELECT full_name AS fullName
       FROM passengers
       WHERE booking_id = ?`,
      [bookingId]
    );

    const expired =
      new Date(booking.expires_at).getTime() <= Date.now();

    if (expired || outcome === 'failure') {
      // Release this booking's reserved individual seats.
      await conn.execute(
        `UPDATE flight_seats
         SET status = 'AVAILABLE',
             booking_id = NULL,
             passenger_id = NULL,
             reserved_until = NULL
         WHERE booking_id = ?
           AND status = 'RESERVED'`,
        [bookingId]
      );

      // Restore the flight's available capacity.
      await conn.execute(
        `UPDATE flights
         SET available_seats = LEAST(total_seats, available_seats + ?)
         WHERE id = ?`,
        [booking.passenger_count, booking.flight_id]
      );

      const newBookingStatus = expired ? 'EXPIRED' : 'CANCELLED';
      const reason = expired ? 'Payment window expired.' : 'Simulated payment failure.';

      await conn.execute(
        `UPDATE bookings SET status = ? WHERE id = ?`,
        [newBookingStatus, bookingId]
      );

      await conn.execute(
        `UPDATE payments
         SET status = 'FAILED', failure_reason = ?
         WHERE id = ?`,
        [reason, payment.id]
      );

      await conn.commit();

      return res.status(expired ? 410 : 402).json({
        message: reason,
        booking: {
          id: bookingId,
          reference: booking.booking_reference,
          status: newBookingStatus
        },
        payment: {
          id: payment.id,
          status: 'FAILED'
        },
        seatsReleased: booking.passenger_count
      });
    }

    const providerReference = `SIM-${crypto.randomUUID()}`;

    await conn.execute(
      `UPDATE payments
       SET status = 'SUCCEEDED',
           paid_at = UTC_TIMESTAMP(),
           provider_reference = ?,
           failure_reason = NULL
       WHERE id = ?`,
      [providerReference, payment.id]
    );
await conn.execute(
  `INSERT INTO payment_transactions (
     payment_id,
     transaction_type,
     amount,
     currency,
     status,
     provider_reference,
     description
   ) VALUES (?, 'PAYMENT', ?, ?, 'SUCCEEDED', ?, ?)`,
  [
    payment.id,
    payment.amount,
    payment.currency,
    providerReference,
    'Original booking payment'
  ]
);
    await conn.execute(
      `UPDATE bookings
       SET status = 'CONFIRMED', expires_at = NULL
       WHERE id = ?`,
      [bookingId]
    );

    await conn.execute(
      `UPDATE flight_seats
       SET status = 'BOOKED',
           reserved_until = NULL
       WHERE booking_id = ?
         AND status = 'RESERVED'`,
      [bookingId]
    );

    await conn.commit();

    bookingInfo = {
      reference: booking.booking_reference,
      totalAmount: booking.total_amount,
      currency: booking.currency,
      passengers,
      flight: {
        flightNumber: flight.flight_number,
        origin: flight.origin,
        destination: flight.destination,
        departureAt: toIso(flight.departure_at)
      }
    };

    result = {
      message: 'Payment successful. Booking confirmed.',
      booking: {
        id: bookingId,
        reference: booking.booking_reference,
        status: 'CONFIRMED'
      },
      payment: {
        id: payment.id,
        status: 'SUCCEEDED',
        providerReference
      }
    };

  } catch (error) {
    await conn.rollback();
    return next(error);
  } finally {
    conn.release();
  }

  // Send confirmation only after successful payment and database commit.
  let emailSent = false;

  try {
    if (customerEmail) {
      await sendBookingConfirmation(customerEmail, bookingInfo);
      emailSent = true;
    }
  } catch (error) {
    console.error('Confirmation email failed:', error.message);
  }

  return res.json({ ...result, emailSent });
});


// Customer cancels their own booking and receives a simulated refund.
router.post('/:id/cancel', async (req, res, next) => {
  const bookingId = Number(req.params.id);

  if (!Number.isInteger(bookingId) || bookingId < 1) {
    return res.status(400).json({ message: 'Invalid booking ID.' });
  }

  const conn = await pool.getConnection();
  let emailTo = null;
  let emailBooking = null;
  let paymentStatus = 'UNKNOWN';
  let seatsReleased = 0;

  try {
    await conn.beginTransaction();

    // Lock order: booking -> payment -> flight.
    const [bookings] = await conn.execute(
      `SELECT *
       FROM bookings
       WHERE id = ? AND user_id = ?
       FOR UPDATE`,
      [bookingId, req.user.id]
    );

    if (!bookings.length) {
      await conn.rollback();
      return res.status(404).json({ message: 'Booking not found.' });
    }

    const booking = bookings[0];

    if (!['PENDING_PAYMENT', 'CONFIRMED'].includes(booking.status)) {
      await conn.rollback();
      return res.status(409).json({
        message: `This booking cannot be cancelled. Status: ${booking.status}.`
      });
    }

    const [payments] = await conn.execute(
      `SELECT *
       FROM payments
       WHERE booking_id = ?
       FOR UPDATE`,
      [bookingId]
    );

    const payment = payments[0] || null;

    const [flights] = await conn.execute(
      `SELECT *,
              departure_at > UTC_TIMESTAMP() AS isFuture
       FROM flights
       WHERE id = ?
       FOR UPDATE`,
      [booking.flight_id]
    );

    if (!flights.length) {
      throw new Error('Associated flight not found.');
    }

    const flight = flights[0];

    if (!Number(flight.isFuture)) {
      await conn.rollback();
      return res.status(409).json({
        message: 'A booking cannot be cancelled after departure.'
      });
    }



if (payment?.status === 'SUCCEEDED') {
  const [refundEligibility] = await conn.execute(
    `SELECT
       paid_at IS NOT NULL
       AND paid_at >= UTC_TIMESTAMP() - INTERVAL 15 MINUTE
       AS eligible
     FROM payments
     WHERE id = ?`,
    [payment.id]
  );

  // Calculate refund eligibility and amount first.
  const isWithinRefundWindow =
    Number(refundEligibility[0].eligible) === 1;

  const refundAmount = isWithinRefundWindow
    ? Number(payment.amount)
    : Number((Number(payment.amount) * 0.5).toFixed(2));

  paymentStatus = isWithinRefundWindow
    ? 'REFUNDED'
    : 'PARTIALLY_REFUNDED';

  // Update the original payment record.
  await conn.execute(
    `UPDATE payments
     SET status = ?,
         refunded_amount = ?,
         failure_reason = ?
     WHERE id = ?`,
    [
      paymentStatus,
      refundAmount,
      isWithinRefundWindow
        ? 'Simulated full refund: cancelled within 15 minutes.'
        : 'Simulated 50% partial refund: cancelled after 15 minutes.',
      payment.id
    ]
  );

  // Record the refund as a separate ledger transaction.
  const refundReference = `SIM-REFUND-${crypto.randomUUID()}`;

  await conn.execute(
    `INSERT INTO payment_transactions (
       payment_id,
       transaction_type,
       amount,
       currency,
       status,
       provider_reference,
       description
     ) VALUES (?, 'REFUND', ?, ?, 'SUCCEEDED', ?, ?)`,
    [
      payment.id,
      refundAmount,
      payment.currency,
      refundReference,
      isWithinRefundWindow
        ? 'Full booking refund'
        : '50% partial booking refund'
    ]
  );

} else if (payment?.status === 'PENDING') {
  paymentStatus = 'FAILED';

  await conn.execute(
    `UPDATE payments
     SET status = 'FAILED',
         failure_reason = 'Booking cancelled by customer.'
     WHERE id = ?`,
    [payment.id]
  );

} else if (payment) {
  paymentStatus = payment.status;
}

    await conn.execute(
      `UPDATE bookings
       SET status = 'CANCELLED'
       WHERE id = ?`,
      [bookingId]
    );

    await conn.execute(
      `UPDATE flight_seats
       SET status = 'AVAILABLE',
           booking_id = NULL,
           passenger_id = NULL,
           reserved_until = NULL
       WHERE booking_id = ?
         AND status IN ('RESERVED', 'BOOKED')`,
      [bookingId]
    );

    await conn.execute(
      `UPDATE flights
       SET available_seats = LEAST(
         total_seats,
         available_seats + ?
       )
       WHERE id = ?`,
      [booking.passenger_count, booking.flight_id]
    );

    const [users] = await conn.execute(
      'SELECT email FROM users WHERE id = ?',
      [req.user.id]
    );

    emailTo = users[0]?.email || null;

    emailBooking = {
      reference: booking.booking_reference,
      flightNumber: flight.flight_number,
      origin: flight.origin,
      destination: flight.destination,
      paymentStatus
    };

    seatsReleased = booking.passenger_count;

    await conn.commit();

  } catch (error) {
    await conn.rollback();
    return next(error);
  } finally {
    conn.release();
  }

  // Send notification only after the cancellation is committed.
  let emailSent = false;

  try {
    if (emailTo) {
      await sendBookingCancellation(emailTo, emailBooking);
      emailSent = true;
    }
  } catch (error) {
    console.error('Cancellation email failed:', error.message);
  }

  return res.json({
message: paymentStatus === 'REFUNDED'
  ? 'Booking cancelled. Simulated full refund processed.'
  : paymentStatus === 'PARTIALLY_REFUNDED'
    ? 'Booking cancelled. Simulated 50% partial refund processed.'
    : paymentStatus === 'SUCCEEDED'
      ? 'Booking cancelled. No automatic refund was processed.'
      : 'Booking cancelled. Reserved seats released.',
    booking: {
      id: bookingId,
      reference: emailBooking.reference,
      status: 'CANCELLED'
    },
    payment: {
      status: paymentStatus
    },
    seatsReleased,
    emailSent
  });
});

// Download a confirmed booking's PDF e-ticket.
router.get('/:id/ticket', async (req, res, next) => {
  const bookingId = Number(req.params.id);

  if (!Number.isInteger(bookingId) || bookingId < 1) {
    return res.status(400).json({ message: 'Invalid booking ID.' });
  }

  try {
    const [rows] = await pool.execute(
      `SELECT
         b.id,
         b.booking_reference AS reference,
         b.total_amount AS totalAmount,
         b.currency,
         b.status,
         p.status AS paymentStatus,
         f.flight_number AS flightNumber,
         f.airline,
         f.origin,
         f.destination,
         f.departure_at AS departureAt,
         f.arrival_at AS arrivalAt
       FROM bookings b
       JOIN flights f ON f.id = b.flight_id
       LEFT JOIN payments p ON p.booking_id = b.id
       WHERE b.id = ? AND b.user_id = ?
       LIMIT 1`,
      [bookingId, req.user.id]
    );

    if (!rows.length) {
      return res.status(404).json({ message: 'Booking not found.' });
    }

    const booking = rows[0];

    if (
      booking.status !== 'CONFIRMED' ||
      booking.paymentStatus !== 'SUCCEEDED'
    ) {
      return res.status(409).json({
        message: 'An e-ticket is available only for confirmed, paid bookings.'
      });
    }

    const [passengers] = await pool.execute(
      `SELECT
         p.full_name AS fullName,
         fs.seat_number AS seatNumber
       FROM passengers p
       LEFT JOIN flight_seats fs ON fs.passenger_id = p.id
       WHERE p.booking_id = ?
       ORDER BY p.id`,
      [bookingId]
    );

    const pdf = createTicketPdf({
      ...booking,
      flight: {
        flightNumber: booking.flightNumber,
        airline: booking.airline,
        origin: booking.origin,
        destination: booking.destination,
        departureAt: booking.departureAt,
        arrivalAt: booking.arrivalAt
      },
      passengers
    });

    const filename = `SkyBook-${booking.reference}.pdf`;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${filename}"`
    );
    res.setHeader('Cache-Control', 'private, no-store');

    pdf.pipe(res);

  } catch (error) {
    return next(error);
  }
});

// Get current customer's bookings.
router.get('/', async (req, res, next) => {
  try {
    const [rows] = await pool.execute(
      `SELECT
         b.id,
         b.booking_reference AS reference,
         b.passenger_count AS passengerCount,
         b.total_amount AS totalAmount,
         b.currency,
         b.status,
         b.expires_at AS expiresAt,
         b.created_at AS createdAt,
         f.flight_number AS flightNumber,
         f.airline,
         f.origin,
         f.destination,
         f.departure_at AS departureAt,
         f.arrival_at AS arrivalAt,
         p.id AS paymentId,
         p.status AS paymentStatus,
         p.provider AS paymentProvider
       FROM bookings b
       JOIN flights f ON f.id = b.flight_id
       LEFT JOIN payments p ON p.booking_id = b.id
       WHERE b.user_id = ?
       ORDER BY b.created_at DESC`,
      [req.user.id]
    );

    for (const booking of rows) {
      const [passengers] = await pool.execute(
        `SELECT
           p.full_name AS fullName,
           p.email,
           fs.seat_number AS seatNumber
         FROM passengers p
         LEFT JOIN flight_seats fs ON fs.passenger_id = p.id
         WHERE p.booking_id = ?
         ORDER BY p.id`,
        [booking.id]
      );


      booking.passengers = passengers;

      const [transactions] = await pool.execute(
        `SELECT
           id,
           transaction_type AS transactionType,
           amount,
           currency,
           status,
           description,
           created_at AS createdAt
         FROM payment_transactions
         WHERE payment_id = ?
         ORDER BY created_at ASC, id ASC`,
        [booking.paymentId]
      );

      booking.transactions = transactions;

      booking.netPaid = transactions.reduce((total, transaction) => {
        if (transaction.status !== 'SUCCEEDED') return total;

        const amount = Number(transaction.amount);

        return total + (
          transaction.transactionType === 'PAYMENT'
            ? amount
            : -amount
        );
      }, 0);

booking.netPaid = transactions.reduce((total, transaction) => {
  if (transaction.status !== 'SUCCEEDED') return total;

  const amount = Number(transaction.amount);

  return total + (
    transaction.transactionType === 'PAYMENT'
      ? amount
      : -amount
  );
}, 0);
    }

    return res.json({ bookings: rows });
  } catch (error) {
    return next(error);
  }
});

// Get all bookings (administrators only).
router.get('/admin/all', admin, async (req, res, next) => {
  try {
    const [rows] = await pool.execute(
      `SELECT
         b.id,
         b.booking_reference AS reference,
         b.passenger_count AS passengerCount,
         b.total_amount AS totalAmount,
         b.currency,
         b.status,
         b.expires_at AS expiresAt,
         b.created_at AS createdAt,
         u.full_name AS customerName,
         u.email,
         f.flight_number AS flightNumber,
         f.origin,
         f.destination,
         p.status AS paymentStatus,
         p.provider AS paymentProvider
       FROM bookings b
       JOIN users u ON u.id = b.user_id
       JOIN flights f ON f.id = b.flight_id
       LEFT JOIN payments p ON p.booking_id = b.id
       ORDER BY b.created_at DESC
       LIMIT 300`
    );

    return res.json({ bookings: rows });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
