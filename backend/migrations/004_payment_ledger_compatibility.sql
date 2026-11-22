USE flight_booking;

-- Support all payment states used by the existing backend.
ALTER TABLE payments
  MODIFY COLUMN status ENUM(
    'PENDING',
    'SUCCEEDED',
    'FAILED',
    'REFUNDED',
    'PARTIALLY_REFUNDED'
  ) NOT NULL DEFAULT 'PENDING',
  ADD COLUMN paid_at DATETIME NULL,
  ADD COLUMN refunded_amount DECIMAL(10,2) NOT NULL DEFAULT 0.00;

-- Efficiently find bookings whose payment window has expired.
ALTER TABLE bookings
  ADD INDEX idx_booking_expiration (status, expires_at);

-- Record payment and refund ledger entries.
CREATE TABLE IF NOT EXISTS payment_transactions (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  payment_id BIGINT UNSIGNED NOT NULL,
  transaction_type ENUM('PAYMENT', 'REFUND') NOT NULL,
  amount DECIMAL(10,2) NOT NULL,
  currency CHAR(3) NOT NULL,
  status ENUM('PENDING', 'SUCCEEDED', 'FAILED') NOT NULL DEFAULT 'PENDING',
  provider_reference VARCHAR(100) NULL,
  description VARCHAR(255) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT fk_payment_transaction_payment
    FOREIGN KEY (payment_id) REFERENCES payments(id),

  UNIQUE KEY uq_payment_transaction_provider_reference (provider_reference),
  INDEX idx_payment_transaction_payment (payment_id),
  INDEX idx_payment_transaction_type (transaction_type)
) ENGINE=InnoDB;
