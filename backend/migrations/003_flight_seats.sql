USE flight_booking;

-- 1. Individual seat inventory for each flight.
CREATE TABLE flight_seats (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    flight_id BIGINT UNSIGNED NOT NULL,
    seat_number VARCHAR(5) NOT NULL,
    seat_row SMALLINT UNSIGNED NOT NULL,
    seat_letter CHAR(1) NOT NULL,
    seat_class ENUM('ECONOMY') NOT NULL DEFAULT 'ECONOMY',

    status ENUM(
        'AVAILABLE',
        'RESERVED',
        'BOOKED',
        'LEGACY_OCCUPIED'
    ) NOT NULL DEFAULT 'AVAILABLE',

    booking_id BIGINT UNSIGNED NULL,
    passenger_id BIGINT UNSIGNED NULL,
    reserved_until DATETIME NULL,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        ON UPDATE CURRENT_TIMESTAMP,

    CONSTRAINT fk_seat_flight
        FOREIGN KEY (flight_id) REFERENCES flights(id),

    CONSTRAINT fk_seat_booking
        FOREIGN KEY (booking_id) REFERENCES bookings(id),

    CONSTRAINT fk_seat_passenger
        FOREIGN KEY (passenger_id) REFERENCES passengers(id),

    UNIQUE KEY uq_flight_seat (flight_id, seat_number),
    UNIQUE KEY uq_seat_passenger (passenger_id),

    INDEX idx_seat_availability (flight_id, status),
    INDEX idx_seat_booking (booking_id),
    INDEX idx_seat_expiration (status, reserved_until)
) ENGINE=InnoDB;

-- 2. Generate six-seat rows (A-F) for every existing flight.
-- Existing occupied capacity is preserved as LEGACY_OCCUPIED.
INSERT INTO flight_seats (
    flight_id,
    seat_number,
    seat_row,
    seat_letter,
    seat_class,
    status
)
WITH RECURSIVE seat_numbers (n, max_seats) AS (
    SELECT 1, COALESCE(MAX(total_seats), 1)
    FROM flights

    UNION ALL

    SELECT n + 1, max_seats
    FROM seat_numbers
    WHERE n < max_seats
)
SELECT
    f.id,
    CONCAT(
        CEIL(s.n / 6),
        SUBSTRING('ABCDEF', MOD(s.n - 1, 6) + 1, 1)
    ),
    CEIL(s.n / 6),
    SUBSTRING('ABCDEF', MOD(s.n - 1, 6) + 1, 1),
    'ECONOMY',
    CASE
        WHEN s.n <= f.total_seats - f.available_seats
            THEN 'LEGACY_OCCUPIED'
        ELSE 'AVAILABLE'
    END
FROM flights f
JOIN seat_numbers s ON s.n <= f.total_seats;

-- Existing bookings and passengers remain unchanged.
