USE flight_booking;

-- 1. Countries
CREATE TABLE IF NOT EXISTS countries (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    iso2_code CHAR(2) NOT NULL UNIQUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- 2. Cities
CREATE TABLE IF NOT EXISTS cities (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    country_id BIGINT UNSIGNED NOT NULL,
    name VARCHAR(100) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_city_country
        FOREIGN KEY (country_id) REFERENCES countries(id),

    UNIQUE KEY uq_city_country_name (country_id, name)
) ENGINE=InnoDB;

-- 3. Airports
CREATE TABLE IF NOT EXISTS airports (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    city_id BIGINT UNSIGNED NOT NULL,
    name VARCHAR(150) NOT NULL,
    iata_code CHAR(3) NOT NULL UNIQUE,
    icao_code CHAR(4) NULL UNIQUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_airport_city
        FOREIGN KEY (city_id) REFERENCES cities(id)
) ENGINE=InnoDB;

-- 4. Connect flights to airports.
-- Nullable to preserve existing flights until destinations are confirmed.
ALTER TABLE flights
    ADD COLUMN origin_airport_id BIGINT UNSIGNED NULL,
    ADD COLUMN destination_airport_id BIGINT UNSIGNED NULL,
    ADD INDEX idx_flight_origin_airport (origin_airport_id),
    ADD INDEX idx_flight_destination_airport (destination_airport_id),
    ADD CONSTRAINT fk_flight_origin_airport
        FOREIGN KEY (origin_airport_id) REFERENCES airports(id),
    ADD CONSTRAINT fk_flight_destination_airport
        FOREIGN KEY (destination_airport_id) REFERENCES airports(id);

-- 5. Initial country catalog
INSERT IGNORE INTO countries (name, iso2_code) VALUES
('Egypt', 'EG'),
('United Arab Emirates', 'AE'),
('United Kingdom', 'GB'),
('Saudi Arabia', 'SA'),
('Turkey', 'TR'),
('France', 'FR');

-- 6. Initial city catalog
INSERT IGNORE INTO cities (country_id, name)
SELECT id, 'Cairo' FROM countries WHERE iso2_code = 'EG';

INSERT IGNORE INTO cities (country_id, name)
SELECT id, 'Dubai' FROM countries WHERE iso2_code = 'AE';

INSERT IGNORE INTO cities (country_id, name)
SELECT id, 'London' FROM countries WHERE iso2_code = 'GB';

INSERT IGNORE INTO cities (country_id, name)
SELECT id, 'Jeddah' FROM countries WHERE iso2_code = 'SA';

INSERT IGNORE INTO cities (country_id, name)
SELECT id, 'Istanbul' FROM countries WHERE iso2_code = 'TR';

-- 7. Initial airport catalog
INSERT IGNORE INTO airports (city_id, name, iata_code, icao_code)
SELECT id, 'Cairo International Airport', 'CAI', 'HECA'
FROM cities WHERE name = 'Cairo'
AND country_id = (SELECT id FROM countries WHERE iso2_code = 'EG');

INSERT IGNORE INTO airports (city_id, name, iata_code, icao_code)
SELECT id, 'Dubai International Airport', 'DXB', 'OMDB'
FROM cities WHERE name = 'Dubai'
AND country_id = (SELECT id FROM countries WHERE iso2_code = 'AE');

INSERT IGNORE INTO airports (city_id, name, iata_code, icao_code)
SELECT id, 'London Heathrow Airport', 'LHR', 'EGLL'
FROM cities WHERE name = 'London'
AND country_id = (SELECT id FROM countries WHERE iso2_code = 'GB');

INSERT IGNORE INTO airports (city_id, name, iata_code, icao_code)
SELECT id, 'King Abdulaziz International Airport', 'JED', 'OEJN'
FROM cities WHERE name = 'Jeddah'
AND country_id = (SELECT id FROM countries WHERE iso2_code = 'SA');

INSERT IGNORE INTO airports (city_id, name, iata_code, icao_code)
SELECT id, 'Istanbul Airport', 'IST', 'LTFM'
FROM cities WHERE name = 'Istanbul'
AND country_id = (SELECT id FROM countries WHERE iso2_code = 'TR');
