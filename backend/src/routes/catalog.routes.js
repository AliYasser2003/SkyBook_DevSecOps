const express = require('express');
const pool = require('../config/db');

const router = express.Router();

// GET /api/airports
// Search airports by IATA code, name, city or country.
router.get('/airports', async (req, res, next) => {
  try {
    const search = String(req.query.search || '').trim();

    let sql = `
      SELECT
        a.id,
        a.name AS airportName,
        a.iata_code AS iataCode,
        a.icao_code AS icaoCode,
        c.name AS city,
        co.name AS country,
        co.iso2_code AS countryCode
      FROM airports a
      JOIN cities c ON c.id = a.city_id
      JOIN countries co ON co.id = c.country_id
    `;

    const args = [];

    if (search) {
      sql += `
        WHERE a.iata_code LIKE ?
           OR a.name LIKE ?
           OR c.name LIKE ?
           OR co.name LIKE ?
      `;

      const term = `%${search}%`;
      args.push(term, term, term, term);
    }

    sql += ' ORDER BY co.name, c.name, a.name LIMIT 50';

    const [airports] = await pool.execute(sql, args);

    return res.json({ airports });
  } catch (error) {
    return next(error);
  }
});

// GET /api/airports/:id
router.get('/airports/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);

    if (!Number.isSafeInteger(id) || id < 1) {
      return res.status(400).json({
        message: 'Invalid airport ID.'
      });
    }

    const [rows] = await pool.execute(
      `SELECT
        a.id,
        a.name AS airportName,
        a.iata_code AS iataCode,
        a.icao_code AS icaoCode,
        c.name AS city,
        co.name AS country,
        co.iso2_code AS countryCode
       FROM airports a
       JOIN cities c ON c.id = a.city_id
       JOIN countries co ON co.id = c.country_id
       WHERE a.id = ?`,
      [id]
    );

    if (!rows.length) {
      return res.status(404).json({
        message: 'Airport not found.'
      });
    }

    return res.json({ airport: rows[0] });
  } catch (error) {
    return next(error);
  }
});

// GET /api/countries
router.get('/countries', async (req, res, next) => {
  try {
    const [countries] = await pool.execute(
      `SELECT id, name, iso2_code AS iso2Code
       FROM countries
       ORDER BY name`
    );

    return res.json({ countries });
  } catch (error) {
    return next(error);
  }
});

// GET /api/cities?country=EG
router.get('/cities', async (req, res, next) => {
  try {
    const country = String(req.query.country || '').trim().toUpperCase();

    let sql = `
      SELECT
        ci.id,
        ci.name,
        co.name AS country,
        co.iso2_code AS countryCode
      FROM cities ci
      JOIN countries co ON co.id = ci.country_id
    `;

    const args = [];

    if (country) {
      if (!/^[A-Z]{2}$/.test(country)) {
        return res.status(400).json({
          message: 'Invalid country code.'
        });
      }

      sql += ' WHERE co.iso2_code = ?';
      args.push(country);
    }

    sql += ' ORDER BY co.name, ci.name';

    const [cities] = await pool.execute(sql, args);

    return res.json({ cities });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
