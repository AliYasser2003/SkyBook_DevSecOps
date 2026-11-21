
const express = require('express');
const pool = require('../config/db');
const auth = require('../middleware/requireAuth');
const admin = require('../middleware/requireAdmin');

const router = express.Router();

// Convert incoming flight data into a consistent format
function input(b = {}) {
  return [
    String(b.flightNumber || '').trim().toUpperCase(),
    String(b.airline || '').trim(),
    String(b.origin || '').trim(),
    String(b.destination || '').trim(),
    b.departureAt,
    b.arrivalAt,
    Number(b.price),
    String(b.currency || 'USD').trim().toUpperCase(),
    Number(b.totalSeats)
  ];
}

// Validate flight data against database constraints
function valid(v) {
  const departure = new Date(v[4]);
  const arrival = new Date(v[5]);

  const validDates =
    !Number.isNaN(departure.getTime()) &&
    !Number.isNaN(arrival.getTime()) &&
    departure < arrival;

  return (
    v[0].length >= 1 &&
    v[0].length <= 20 &&
    v[1].length >= 1 &&
    v[1].length <= 80 &&
    v[2].length >= 1 &&
    v[2].length <= 100 &&
    v[3].length >= 1 &&
    v[3].length <= 100 &&
    validDates &&
    Number.isFinite(v[6]) &&
    v[6] >= 0 &&
    v[6] <= 99999999.99 &&
    Number.isInteger(v[8]) &&
    v[8] > 0 &&
    v[8] <= 4294967295 &&
    /^[A-Z]{3}$/.test(v[7])
  );
}


 // Search available flights by city name or IATA code
router.get('/', async (req, res, next) => {
  try {
    const {
      origin = '',
      destination = '',
      date = '',
      passengers = '1'
    } = req.query;

    const n = Math.max(1, Math.min(9, Number(passengers) || 1));

    let sql = `
      SELECT
        f.id,
        f.flight_number AS flightNumber,
        f.airline,
        f.origin,
        f.destination,

        oa.iata_code AS originIataCode,
        oa.name AS originAirportName,
        oc.name AS originCity,
        oco.name AS originCountry,

        da.iata_code AS destinationIataCode,
        da.name AS destinationAirportName,
        dc.name AS destinationCity,
        dco.name AS destinationCountry,

        DATE_FORMAT(f.departure_at, '%Y-%m-%dT%H:%i:%sZ') AS departureAt,
        DATE_FORMAT(f.arrival_at, '%Y-%m-%dT%H:%i:%sZ') AS arrivalAt,
        f.price,
        f.currency,
        f.total_seats AS totalSeats,
        f.available_seats AS availableSeats,
        f.status

      FROM flights f

      LEFT JOIN airports oa ON oa.id = f.origin_airport_id
      LEFT JOIN cities oc ON oc.id = oa.city_id
      LEFT JOIN countries oco ON oco.id = oc.country_id

      LEFT JOIN airports da ON da.id = f.destination_airport_id
      LEFT JOIN cities dc ON dc.id = da.city_id
      LEFT JOIN countries dco ON dco.id = dc.country_id

      WHERE f.status = 'SCHEDULED'
        AND f.departure_at > UTC_TIMESTAMP()
        AND f.available_seats >= ?
    `;

    const args = [n];

    if (origin.trim()) {
      sql += `
        AND (
          LOWER(f.origin) = LOWER(?)
          OR LOWER(oa.iata_code) = LOWER(?)
          OR LOWER(oc.name) = LOWER(?)
        )
      `;
      args.push(origin.trim(), origin.trim(), origin.trim());
    }

    if (destination.trim()) {
      sql += `
        AND (
          LOWER(f.destination) = LOWER(?)
          OR LOWER(da.iata_code) = LOWER(?)
          OR LOWER(dc.name) = LOWER(?)
        )
      `;
      args.push(
        destination.trim(),
        destination.trim(),
        destination.trim()
      );
    }

    if (date) {
      sql += ' AND DATE(f.departure_at) = ?';
      args.push(date);
    }

    sql += ' ORDER BY f.departure_at LIMIT 100';

    const [rows] = await pool.execute(sql, args);

    return res.json({ flights: rows });

  } catch (error) {
    return next(error);
  }
});

// Admin: retrieve all flights, including past and cancelled flights
router.get('/admin/all', auth, admin, async (req, res, next) => {
  try {
    const [flights] = await pool.execute(`
      SELECT
        f.id,
        f.flight_number AS flightNumber,
        f.airline,
        f.origin,
        f.destination,
        oa.iata_code AS originIataCode,
        da.iata_code AS destinationIataCode,
        DATE_FORMAT(f.departure_at, '%Y-%m-%dT%H:%i:%sZ') AS departureAt,
        DATE_FORMAT(f.arrival_at, '%Y-%m-%dT%H:%i:%sZ') AS arrivalAt,
        f.price,
        f.currency,
        f.total_seats AS totalSeats,
        f.available_seats AS availableSeats,
        f.status
      FROM flights f
      LEFT JOIN airports oa ON oa.id = f.origin_airport_id
      LEFT JOIN airports da ON da.id = f.destination_airport_id
      ORDER BY f.departure_at DESC
    `);

    return res.json({ flights });
  } catch (error) {
    return next(error);
  }
});

// Get individual seat availability for a flight
router.get('/:id/seats', async (req, res, next) => {
  try {
    const flightId = Number(req.params.id);

    if (!Number.isSafeInteger(flightId) || flightId <= 0) {
      return res.status(400).json({
        message: 'Invalid flight ID.'
      });
    }

    const [flights] = await pool.execute(
      `SELECT id, flight_number AS flightNumber
       FROM flights
       WHERE id = ?`,
      [flightId]
    );

    if (!flights.length) {
      return res.status(404).json({
        message: 'Flight not found.'
      });
    }

    const [seats] = await pool.execute(
      `SELECT
         id,
         seat_number AS seatNumber,
         seat_row AS seatRow,
         seat_letter AS seatLetter,
         seat_class AS seatClass,
         status
       FROM flight_seats
       WHERE flight_id = ?
       ORDER BY seat_row ASC, seat_letter ASC`,
      [flightId]
    );

    return res.json({
      flight: flights[0],
      totalSeats: seats.length,
      seats
    });

  } catch (error) {
    return next(error);
  }
});


// Create a flight (admin only)

router.post('/', auth, admin, async (req, res, next) => {
  const conn = await pool.getConnection();

  try {
    const v = input(req.body);

    if (!valid(v)) {
      return res.status(400).json({
        message: 'Enter valid flight details.'
      });
    }

    await conn.beginTransaction();

    // 1. Create the flight.
    const [result] = await conn.execute(
      `INSERT INTO flights (
        flight_number,
        airline,
        origin,
        destination,
        departure_at,
        arrival_at,
        price,
        currency,
        total_seats,
        available_seats
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [...v, v[8]]
    );

    const flightId = result.insertId;
    const totalSeats = v[8];
    const seatLetters = ['A', 'B', 'C', 'D', 'E', 'F'];

    // 2. Generate the seat inventory.
    const seats = [];

    for (let row = 1; seats.length < totalSeats; row++) {
      for (const letter of seatLetters) {
        if (seats.length >= totalSeats) break;

        seats.push([
          flightId,
          `${row}${letter}`,
          row,
          letter
        ]);
      }
    }

    // 3. Insert all seats in one bulk operation.
    await conn.query(
      `INSERT INTO flight_seats (
        flight_id,
        seat_number,
        seat_row,
        seat_letter
      ) VALUES ?`,
      [seats]
    );

    // 4. Commit flight and seats together.
    await conn.commit();

    return res.status(201).json({
      message: 'Flight created with seat inventory.',
      id: flightId,
      generatedSeats: seats.length
    });

  } catch (error) {
    await conn.rollback();

    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({
        message: 'Flight number already exists.'
      });
    }

    return next(error);

  } finally {
    conn.release();
  }
});

// Update a flight (admin only)

router.put('/:id', auth, admin, async (req, res, next) => {
  const conn = await pool.getConnection();

  try {
    const v = input(req.body);

    if (!valid(v)) {
      return res.status(400).json({
        message: 'Invalid flight details.'
      });
    }

    await conn.beginTransaction();

    // Lock the flight while checking its bookings
    const [flights] = await conn.execute(
      'SELECT id FROM flights WHERE id = ? FOR UPDATE',
      [req.params.id]
    );

    if (!flights.length) {
      await conn.rollback();

      return res.status(404).json({
        message: 'Flight not found.'
      });
    }

    // Check for existing confirmed bookings
    const [bookings] = await conn.execute(
      `SELECT COUNT(*) AS total
       FROM bookings
       WHERE flight_id = ?
         AND status = 'CONFIRMED'`,
      [req.params.id]
    );

    if (bookings[0].total > 0) {
      await conn.rollback();

      return res.status(409).json({
        message: 'Cannot modify a flight with confirmed bookings.'
      });
    }

    await conn.execute(
      `UPDATE flights SET
        flight_number = ?,
        airline = ?,
        origin = ?,
        destination = ?,
        departure_at = ?,
        arrival_at = ?,
        price = ?,
        currency = ?,
        total_seats = ?,
        available_seats = ?
       WHERE id = ?`,
      [...v, v[8], req.params.id]
    );

    await conn.commit();

    return res.json({
      message: 'Flight updated successfully.'
    });

  } catch (error) {
    await conn.rollback();

    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({
        message: 'Flight number already exists.'
      });
    }

    return next(error);

  } finally {
    conn.release();
  }
});

// Delete a flight (admin only)

router.delete('/:id', auth, admin, async (req, res, next) => {
  const conn = await pool.getConnection();

  try {
    await conn.beginTransaction();

    const [flights] = await conn.execute(
      'SELECT id FROM flights WHERE id = ? FOR UPDATE',
      [req.params.id]
    );

    if (!flights.length) {
      await conn.rollback();

      return res.status(404).json({
        message: 'Flight not found.'
      });
    }

    const [bookings] = await conn.execute(
      'SELECT COUNT(*) AS total FROM bookings WHERE flight_id = ?',
      [req.params.id]
    );

    if (bookings[0].total > 0) {
      await conn.rollback();

      return res.status(409).json({
        message: 'Cannot delete a flight with booking history. Cancel the flight instead.'
      });
    }

    await conn.execute(
      'DELETE FROM flights WHERE id = ?',
      [req.params.id]
    );

    await conn.commit();

    return res.json({
      message: 'Flight deleted successfully.'
    });

  } catch (error) {
    await conn.rollback();
    return next(error);

  } finally {
    conn.release();
  }
});

// Cancel a flight (admin only)

// Cancel a flight (admin only)
router.patch('/:id/cancel', auth, admin, async (req, res, next) => {
  const conn = await pool.getConnection();

  try {
    await conn.beginTransaction();

    const [flights] = await conn.execute(
      'SELECT id, status FROM flights WHERE id = ? FOR UPDATE',
      [req.params.id]
    );

    if (!flights.length) {
      await conn.rollback();

      return res.status(404).json({
        message: 'Flight not found.'
      });
    }

    if (flights[0].status === 'CANCELLED') {
      await conn.rollback();

      return res.status(409).json({
        message: 'Flight is already cancelled.'
      });
    }

    await conn.execute(
      "UPDATE flights SET status = 'CANCELLED' WHERE id = ?",
      [req.params.id]
    );

    await conn.commit();

    return res.json({
      message: 'Flight cancelled. Existing bookings require customer support/refund handling.'
    });

  } catch (error) {
    await conn.rollback();
    return next(error);

  } finally {
    conn.release();
  }
});

module.exports = router;
