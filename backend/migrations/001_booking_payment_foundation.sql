
-- SkyBook: Booking and Payment Foundation
-- MySQL 8.4
-- Additive migration: preserves existing bookings and passengers.

USE flight_booking;

-- 1. Extend booking lifecycle.
ALTER TABLE bookings
  MODIFY COLUMN status ENUM(
    'PENDING_PAYMENT',
    'CONFIRMED',
    'CANCELLED',
    'EXPIRED'
  ) NOT NULL DEFAULT 'PENDING_PAYMENT',
  ADD COLUMN expires_at DATETIME NULL AFTER status,
  ADD COLUMN idempotency_key VARCHAR(64) NULL AFTER expires_at,
  ADD UNIQUE KEY uq_booking_user_idempotency (
    user_id,
    idempotency_key
  );

-- 2. Create payment records.
CREATE TABLE IF NOT EXISTS payments (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  booking_id BIGINT UNSIGNED NOT NULL,
  amount DECIMAL(10,2) NOT NULL,
  currency CHAR(3) NOT NULL,
  provider VARCHAR(30) NOT NULL DEFAULT 'SIMULATED',
  provider_reference VARCHAR(100) NULL,
  status ENUM(
    'PENDING',
    'SUCCEEDED',
    'FAILED',
    'REFUNDED'
  ) NOT NULL DEFAULT 'PENDING',
  failure_reason VARCHAR(255) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ON UPDATE CURRENT_TIMESTAMP,

  CONSTRAINT fk_payment_booking
    FOREIGN KEY (booking_id)
    REFERENCES bookings(id),

  UNIQUE KEY uq_payment_provider_reference (
    provider_reference
  ),

  INDEX idx_payment_booking (booking_id),
  INDEX idx_payment_status (status)
) ENGINE=InnoDB;
