const pool = require('../config/db');

async function expireBooking(bookingId) {
  const conn = await pool.getConnection();

  try {
    await conn.beginTransaction();

    // Recheck and lock the booking. Another worker may have processed it.
    const [bookings] = await conn.execute(
      `SELECT id, flight_id, passenger_count
       FROM bookings
       WHERE id = ?
         AND status = 'PENDING_PAYMENT'
         AND expires_at <= UTC_TIMESTAMP()
       FOR UPDATE`,
      [bookingId]
    );

    if (!bookings.length) {
      await conn.rollback();
      return false;
    }

    const booking = bookings[0];

    // Follow the same booking -> payment -> flight lock order.
    const [payments] = await conn.execute(
      `SELECT id, status
       FROM payments
       WHERE booking_id = ?
       FOR UPDATE`,
      [bookingId]
    );

    const [flights] = await conn.execute(
      `SELECT id
       FROM flights
       WHERE id = ?
       FOR UPDATE`,
      [booking.flight_id]
    );

    if (!flights.length) {
      throw new Error(`Flight not found for booking ${bookingId}`);
    }

    // Expire the booking before releasing seats, within this transaction.
    const [updated] = await conn.execute(
      `UPDATE bookings
       SET status = 'EXPIRED'
       WHERE id = ?
         AND status = 'PENDING_PAYMENT'`,
      [bookingId]
    );

    if (updated.affectedRows !== 1) {
      await conn.rollback();
      return false;
    }

    if (payments.length && payments[0].status === 'PENDING') {
      await conn.execute(
        `UPDATE payments
         SET status = 'FAILED',
             failure_reason = 'Payment window expired.'
         WHERE id = ?`,
        [payments[0].id]
      );
    }

    // Release this booking's individual reserved seats.
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
       SET available_seats = LEAST(
         total_seats,
         available_seats + ?
       )
       WHERE id = ?`,
      [booking.passenger_count, booking.flight_id]
    );

    await conn.commit();

    console.log(`Booking ${bookingId} automatically expired.`);
    return true;

  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}

async function expirePendingBookings() {
  // Limit each sweep to avoid holding too many locks or running too long.
  const [expiredBookings] = await pool.execute(
    `SELECT id
     FROM bookings
     WHERE status = 'PENDING_PAYMENT'
       AND expires_at <= UTC_TIMESTAMP()
     ORDER BY expires_at ASC
     LIMIT 100`
  );

  for (const booking of expiredBookings) {
    try {
      await expireBooking(booking.id);
    } catch (error) {
      console.error(
        `Failed to expire booking ${booking.id}:`,
        error.message
      );
    }
  }
}

module.exports = { expirePendingBookings };

