
import React, { useEffect, useState } from 'react';

const API = import.meta.env.VITE_API_URL || 'http://localhost:5000';

async function api(path, opts = {}) {
  const response = await fetch(API + path, {
    ...opts,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(opts.headers || {})
    }
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.message || 'Request failed');
  }

  return data;
}

const money = (amount, currency = 'USD') =>
  new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency
  }).format(Number(amount));

const localDate = value =>
  value ? new Date(value).toLocaleString() : '';

const makeIdempotencyKey = () =>
  globalThis.crypto?.randomUUID?.() ||
  `${Date.now()}-${Math.random().toString(36).slice(2)}`;

function Status({ value }) {
  const status = String(value || 'UNKNOWN').toUpperCase();

  return (
    <span className={`status status-${status.toLowerCase()}`}>
      {status.replaceAll('_', ' ')}
    </span>
  );
}

export default function App() {
  const [user, setUser] = useState(null);
  const [mode, setMode] = useState('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');

  const [page, setPage] = useState('search');
  const [busy, setBusy] = useState(false);
  const [paymentBusy, setPaymentBusy] = useState(false);
  const [cardError, setCardError] = useState('');
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  const [origin, setOrigin] = useState('');
  const [destination, setDestination] = useState('');
  const [airports, setAirports] = useState([]);
  const [originSuggestions, setOriginSuggestions] = useState([]);
  const [destinationSuggestions, setDestinationSuggestions] = useState([]);
  const [activeAirportField, setActiveAirportField] = useState('');
  const [date, setDate] = useState('');
  const [count, setCount] = useState(1);

  const [flights, setFlights] = useState([]);
  const [bookings, setBookings] = useState([]);
  const [adminBookings, setAdminBookings] = useState([]);

  const [selected, setSelected] = useState(null);
  const [passengers, setPassengers] = useState([]);
  const [checkout, setCheckout] = useState(null);
  const [checkoutResult, setCheckoutResult] = useState(null);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [seatMap, setSeatMap] = useState([]);
  const [selectedSeats, setSelectedSeats] = useState([]);
  const [seatMapLoading, setSeatMapLoading] = useState(false);
  const [seatMapError, setSeatMapError] = useState('');

  const [flightForm, setFlightForm] = useState({
    flightNumber: '',
    airline: 'SkyBook Airways',
    origin: 'Cairo',
    destination: '',
    departureAt: '',
    arrivalAt: '',
    price: '',
    currency: 'USD',
    totalSeats: 180
  });

  function notice(message, error = '') {
    setMsg(message);
    setErr(error);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function updateAirportSearch(field, value) {
    if (field === 'origin') {
      setOrigin(value);
    } else {
      setDestination(value);
    }

    setActiveAirportField(field);

    const search = value.trim().toLowerCase();

    const matches = search
      ? airports.filter(airport =>
          [
            airport.iataCode,
            airport.airportName,
            airport.city,
            airport.country
          ].some(item => item?.toLowerCase().includes(search))
        )
      : [];

    if (field === 'origin') {
      setOriginSuggestions(matches);
    } else {
      setDestinationSuggestions(matches);
    }
  }

  function selectAirport(field, airport) {
    const value = airport.iataCode;
    if (field === 'origin') {
      setOrigin(value);
      setOriginSuggestions([]);
    } else {
      setDestination(value);
      setDestinationSuggestions([]);
    }

    setActiveAirportField('');
  }


  useEffect(() => {
    api('/api/auth/me')
      .then(data => setUser(data.user))
      .catch(() => {});
  }, []);

  useEffect(() => {
    api('/api/airports')
      .then(data => setAirports(data.airports || []))
      .catch(error => console.error('Failed to load airports:', error));
  }, []);

  useEffect(() => {
    if (user && page === 'search') searchFlights();
    if (user && page === 'bookings') loadBookings();

    if (user?.role === 'ADMIN' && page === 'adminBookings') {
      loadAdminBookings();
    }
  }, [user, page]);

  useEffect(() => {
    if (!checkout?.booking?.expiresAt) {
      setSecondsLeft(0);
      return;
    }

    const updateCountdown = () => {
      const remaining = Math.max(
        0,
        Math.floor(
          (new Date(checkout.booking.expiresAt).getTime() - Date.now()) / 1000
        )
      );

      setSecondsLeft(remaining);
    };

    updateCountdown();

    const interval = setInterval(updateCountdown, 1000);
    return () => clearInterval(interval);
  }, [checkout]);

  async function authSubmit(event) {
    event.preventDefault();
    setBusy(true);
    notice('');

    try {
      const data = await api(`/api/auth/${mode}`, {
        method: 'POST',
        body: JSON.stringify(
          mode === 'login'
            ? { email, password }
            : { email, password, fullName }
        )
      });

      setUser(data.user);
      setPassword('');
      setPage('search');
      notice(data.message);
    } catch (error) {
      notice('', error.message);
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    try {
      await api('/api/auth/logout', { method: 'POST' });
    } finally {
      setUser(null);
      setCheckout(null);
      setSelected(null);
      setPage('search');
      notice('You have signed out.');
    }
  }

  async function searchFlights(event) {
    event?.preventDefault();
    setBusy(true);

    try {
      const query = new URLSearchParams({
        origin,
        destination,
        date,
        passengers: String(count)
      });

      const data = await api('/api/flights?' + query);
      setFlights(data.flights);

      if (!data.flights.length) {
        notice('No matching flights found. Try another destination or date.');
      } else {
        notice(`${data.flights.length} flight(s) found.`);
      }
    } catch (error) {
      notice('', error.message);
    } finally {
      setBusy(false);
    }
  }

  async function beginBooking(flight) {
    setSelected(flight);

    setPassengers(
      Array.from({ length: count }, () => ({
        fullName: '',
        email: user.email,
        passportNumber: ''
      }))
    );

    setSelectedSeats([]);
    setSeatMap([]);
    setSeatMapError('');
    setSeatMapLoading(true);

    notice('');

    try {
      const data = await api(`/api/flights/${flight.id}/seats`);
      setSeatMap(data.seats || []);
    } catch (error) {
      setSeatMapError(error.message || 'Could not load the seat map.');
    } finally {
      setSeatMapLoading(false);
    }
  }

async function confirmBooking(event) {
  event.preventDefault();
  if (!selected) return;

  if (selectedSeats.length !== passengers.length) {
    notice('Please select one seat for each passenger.');
    return;
  }

  setBusy(true);

  try {
    const data = await api('/api/bookings', {
      method: 'POST',
      headers: {
        'Idempotency-Key': makeIdempotencyKey()
      },
      body: JSON.stringify({
        flightId: selected.id,
        passengers,
        seatNumbers: selectedSeats
      })
    });

    setSelected(null);

    setCheckout({
      booking: data.booking,
      payment: data.payment
    });

    setCheckoutResult(null);
    notice('Your seats are reserved. Complete payment to confirm your booking.');
  } catch (error) {
    notice('', error.message);
  } finally {
    setBusy(false);
  }
}
  function openExistingCheckout(booking) {
    setCheckout({
      booking: {
        id: booking.id,
        reference: booking.reference,
        status: booking.status,
        totalAmount: booking.totalAmount,
        currency: booking.currency,
        expiresAt: booking.expiresAt
      },
      payment: {
        id: booking.paymentId,
        status: booking.paymentStatus
      }
    });

    setCheckoutResult(null);
    notice('');
  }

  async function payNow(outcome) {
    if (!checkout?.booking?.id || paymentBusy) return;

    setPaymentBusy(true);

    try {
      const data = await api(
        `/api/bookings/${checkout.booking.id}/pay`,
        {
          method: 'POST',
          body: JSON.stringify({ outcome })
        }
      );

      setCheckoutResult(data);
      await loadBookings();

      if (data.booking?.status === 'CONFIRMED') {
        notice(
          data.emailSent
            ? 'Payment successful. Confirmation email sent.'
            : 'Payment successful. Your booking is confirmed.'
        );
      }
    } catch (error) {
      setCheckout(null);
      setCheckoutResult(null);
      await loadBookings();
      notice('', error.message);
    } finally {
      setPaymentBusy(false);
    }
  }
  async function submitSimulatedPayment(event) {
    event.preventDefault();

    const form = event.currentTarget;
    if (!form.reportValidity()) return;

    const values = new FormData(form);
    const cardNumber = String(values.get('cardNumber')).replace(/\D/g, '');
    const expiry = String(values.get('expiry')).trim();
    const cvv = String(values.get('cvv')).trim();

    // Luhn validation
    let sum = 0;
    let doubleDigit = false;

    for (let i = cardNumber.length - 1; i >= 0; i--) {
      let digit = Number(cardNumber[i]);

      if (doubleDigit) {
        digit *= 2;
        if (digit > 9) digit -= 9;
      }

      sum += digit;
      doubleDigit = !doubleDigit;
    }

    if (cardNumber.length < 13 || cardNumber.length > 19 || sum % 10 !== 0) {
      setCardError('Please enter a valid card number.');
      return;
    }

    const [month, year] = expiry.split('/').map(Number);
    const expiryDate = new Date(2000 + year, month);

    if (
      !month || month > 12 ||
      expiryDate <= new Date(new Date().getFullYear(), new Date().getMonth())
    ) {
      setCardError('Please enter a valid future expiry date.');
      return;
    }

    if (!/^\d{3,4}$/.test(cvv)) {
      setCardError('Please enter a valid security code.');
      return;
    }

    setCardError('');
    form.reset();
    await payNow('success');
  }
  async function loadBookings() {
    try {
      const data = await api('/api/bookings');
      setBookings(data.bookings);
    } catch (error) {
      notice('', error.message);
    }
  }

 async function cancelBooking(id) {
   if (!window.confirm(
     'Are you sure you want to cancel this booking? Any successful payment will receive a simulated refund.'
   )) return;

   setBusy(true);

   try {
     const data = await api(`/api/bookings/${id}/cancel`, {
       method: 'POST'
     });

     notice(data.message);
     await loadBookings();
   } catch (error) {
     notice('', error.message);
   } finally {
     setBusy(false);
   }
 }

 async function downloadTicket(booking) {
   try {
     const response = await fetch(
       `${API}/api/bookings/${booking.id}/ticket`,
       { credentials: 'include' }
     );

     if (!response.ok) {
       const data = await response.json().catch(() => ({}));
       throw new Error(data.message || 'Ticket download failed.');
     }

     const blob = await response.blob();
     const url = URL.createObjectURL(blob);
     const link = document.createElement('a');

     link.href = url;
     link.download = `SkyBook-${booking.reference}.pdf`;

     document.body.appendChild(link);
     link.click();
     link.remove();

     URL.revokeObjectURL(url);
     notice('Your e-ticket has been downloaded.');
   } catch (error) {
     notice('', error.message);
   }
 }
async function loadAdminFlights() {
  try {
    const data = await api('/api/flights/admin/all');
    setFlights(data.flights || []);
  } catch (error) {
    notice('', error.message);
  }
}
  async function loadAdminBookings() {
    try {
      const data = await api('/api/bookings/admin/all');
      setAdminBookings(data.bookings);
    } catch (error) {
      notice('', error.message);
    }
  }

  async function createFlight(event) {
    event.preventDefault();
    setBusy(true);

    try {
      await api('/api/flights', {
        method: 'POST',
        body: JSON.stringify({
          ...flightForm,
          price: Number(flightForm.price),
          totalSeats: Number(flightForm.totalSeats),
          departureAt: new Date(flightForm.departureAt)
            .toISOString()
            .slice(0, 19)
            .replace('T', ' '),
          arrivalAt: new Date(flightForm.arrivalAt)
            .toISOString()
            .slice(0, 19)
            .replace('T', ' ')
        })
      });

      notice('Flight created successfully.');

      setFlightForm({
        ...flightForm,
        flightNumber: '',
        destination: '',
        departureAt: '',
        arrivalAt: '',
        price: ''
      });

await loadAdminFlights();
    } catch (error) {
      notice('', error.message);
    } finally {
      setBusy(false);
    }
  }

  async function cancelFlight(id) {
    if (!window.confirm('Cancel this flight?')) return;

    try {
      await api(`/api/flights/${id}/cancel`, { method: 'PATCH' });
      notice('Flight cancelled.');
      await loadAdminFlights();
    } catch (error) {
      notice('', error.message);
    }
  }

  if (!user) {
    return (
      <main className="auth">
        <div className="auth-decoration auth-decoration-one" />
        <div className="auth-decoration auth-decoration-two" />

        <section className="auth-card">
          <div className="logo">
            <span className="logo-symbol">✈</span> SKYBOOK
          </div>

          <p className="eyebrow">YOUR JOURNEY STARTS HERE</p>

          <h1>
            {mode === 'login'
              ? 'Welcome aboard.'
              : 'Create your account.'}
          </h1>

          <p className="sub">
            {mode === 'login'
              ? 'Sign in to discover flights and manage your journeys.'
              : 'Join SkyBook and make your next journey simple.'}
          </p>

          {err && <div className="alert error">{err}</div>}
          {msg && <div className="alert">{msg}</div>}

          <form onSubmit={authSubmit}>
            {mode === 'register' && (
              <label>
                Full name
                <input
                  required
                  minLength="2"
                  value={fullName}
                  onChange={event => setFullName(event.target.value)}
                  placeholder="Your full name"
                />
              </label>
            )}

            <label>
              Email address
              <input
                required
                type="email"
                value={email}
                onChange={event => setEmail(event.target.value)}
                placeholder="you@example.com"
              />
            </label>

            <label>
              Password
              <input
                required
                type="password"
                minLength={mode === 'register' ? 10 : 1}
                value={password}
                onChange={event => setPassword(event.target.value)}
                placeholder={
                  mode === 'register' ? 'At least 10 characters' : 'Password'
                }
              />
            </label>

            <button className="primary auth-submit" disabled={busy}>
              {busy
                ? 'Please wait...'
                : mode === 'login'
                  ? 'Sign in to SkyBook'
                  : 'Create account'}
            </button>
          </form>

          <p className="switch">
            {mode === 'login'
              ? 'New to SkyBook?'
              : 'Already have an account?'}
            <button
              onClick={() => {
                setMode(mode === 'login' ? 'register' : 'login');
                notice('');
              }}
            >
              {mode === 'login' ? 'Create account' : 'Sign in'}
            </button>
          </p>

          <div className="auth-footer">
            A better way to get where you're going.
          </div>
        </section>
      </main>
    );
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="logo">
          <span className="logo-symbol">✈</span> SKYBOOK
        </div>

        <div className="userline">
          <div className="user-avatar">
            {(user.fullName || user.email || 'U').charAt(0).toUpperCase()}
          </div>

          <div className="user-details">
            <b>{user.fullName}</b>
            <span>{user.role}</span>
          </div>

          <button className="ghost" onClick={logout}>
            Sign out
          </button>
        </div>
      </header>

      <div className="layout">
        <aside className="sidebar">
          <div className="side-label">WORKSPACE</div>

          <button
            className={page === 'search' ? 'active' : ''}
            onClick={() => {
              setPage('search');
              setSelected(null);
            }}
          >
            <span className="nav-icon">⌕</span>
            Search flights
          </button>

          <button
            className={page === 'bookings' ? 'active' : ''}
            onClick={() => setPage('bookings')}
          >
            <span className="nav-icon">▤</span>
            My bookings
          </button>

          {user.role === 'ADMIN' && (
            <>
              <div className="side-label admin-label">ADMINISTRATION</div>

<button
  className={page === 'manage' ? 'active' : ''}
  onClick={() => {
    setPage('manage');
    loadAdminFlights();
  }}
>
  <span className="nav-icon">＋</span>
  Manage flights
</button>

              <button
                className={page === 'adminBookings' ? 'active' : ''}
                onClick={() => setPage('adminBookings')}
              >
                <span className="nav-icon">▣</span>
                All bookings
              </button>
            </>
          )}

          <div className="sidebar-bottom">
            <div className="sidebar-promo">
              <span className="promo-icon">✈</span>
              <b>Travel without limits.</b>
              <p>Your next destination is closer than you think.</p>
            </div>
            <span className="sidebar-version">SKYBOOK · CUSTOMER PORTAL</span>
          </div>
        </aside>

        <main className="content">
          {(msg || err) && (
            <div className={`alert ${err ? 'error' : ''}`}>
              {err || msg}
              <button onClick={() => notice('')}>×</button>
            </div>
          )}

          {page === 'search' && (
            <>
              <section className="hero">
                <div>
                  <p className="eyebrow">EXPLORE THE WORLD WITH SKYBOOK</p>
                  <h1>Where would you like to go?</h1>
                  <p>
                    Find your flight, reserve your seat, and get ready to fly.
                  </p>
                </div>
                <div className="hero-plane">✈</div>
              </section>

              <form className="searchbox" onSubmit={searchFlights}>
<label className="airport-field">
  <span className="field-icon">⌖</span>
  FROM
  <input
    value={origin}
    onChange={event => updateAirportSearch('origin', event.target.value)}
    onFocus={() => updateAirportSearch('origin', origin)}
    placeholder="Departure city or airport"
    autoComplete="off"
  />

  {activeAirportField === 'origin' && originSuggestions.length > 0 && (
    <div className="airport-suggestions">
      {originSuggestions.map(airport => (
        <button
          type="button"
          key={airport.id}
          onMouseDown={event => event.preventDefault()}
          onClick={() => selectAirport('origin', airport)}
        >
          <strong>{airport.city} ({airport.iataCode})</strong>
          <small>{airport.airportName} · {airport.country}</small>
        </button>
      ))}
    </div>
  )}
</label>

<label className="airport-field">
  <span className="field-icon">⌖</span>
  TO
  <input
    value={destination}
    onChange={event => updateAirportSearch('destination', event.target.value)}
    onFocus={() => updateAirportSearch('destination', destination)}
    placeholder="Destination city or airport"
    autoComplete="off"
  />

  {activeAirportField === 'destination' && destinationSuggestions.length > 0 && (
    <div className="airport-suggestions">
      {destinationSuggestions.map(airport => (
        <button
          type="button"
          key={airport.id}
          onMouseDown={event => event.preventDefault()}
          onClick={() => selectAirport('destination', airport)}
        >
          <strong>{airport.city} ({airport.iataCode})</strong>
          <small>{airport.airportName} · {airport.country}</small>
        </button>
      ))}
    </div>
  )}
</label>
                <label>
                  <span className="field-icon">▦</span>
                  DEPARTURE
                  <input
                    type="date"
                    value={date}
                    min={new Date().toISOString().slice(0, 10)}
                    onChange={event => setDate(event.target.value)}
                  />
                </label>

                <label>
                  <span className="field-icon">♙</span>
                  PASSENGERS
                  <select
                    value={count}
                    onChange={event => setCount(Number(event.target.value))}
                  >
                    {[1, 2, 3, 4, 5, 6, 7, 8, 9].map(number => (
                      <option key={number} value={number}>
                        {number} {number === 1 ? 'Passenger' : 'Passengers'}
                      </option>
                    ))}
                  </select>
                </label>

                <button className="primary search-button" disabled={busy}>
                  {busy ? 'Searching...' : 'Search flights'}
                  <span>→</span>
                </button>
              </form>

              <div className="section-head">
                <div>
                  <p className="eyebrow">YOUR OPTIONS</p>
                  <h2>Available flights</h2>
                </div>
                <span className="result-count">
                  {flights.length} results
                </span>
              </div>

              <div className="flight-list">
                {flights.map(flight => (
                  <article className="flight" key={flight.id}>
                    <div className="flight-airline">
                      <div className="airline-mark">✈</div>
                      <div>
                        <b>{flight.flightNumber}</b>
                        <span>{flight.airline}</span>
                      </div>
                    </div>

                    <div className="route">
                      <div className="route-point">
                        <b>{flight.origin}</b>
                        <small>{localDate(flight.departureAt)}</small>
                      </div>

                      <div className="route-connector">
                        <span>DIRECT FLIGHT</span>
                        <div>────────✈────────</div>
                      </div>

                      <div className="route-point">
                        <b>{flight.destination}</b>
                        <small>{localDate(flight.arrivalAt)}</small>
                      </div>
                    </div>

                    <div className="flight-price">
                      <b>{money(flight.price, flight.currency)}</b>
                      <span>per passenger</span>
                      <small>{flight.availableSeats} seats left</small>
                    </div>


<button
  className="primary small book-button"
  disabled={busy || flight.availableSeats < count}
  onClick={() => beginBooking(flight)}
>
  Select flight
</button>

                  </article>
                ))}

                {!flights.length && (
                  <div className="empty">
                    <div className="empty-icon">✈</div>
                    <h3>Ready for takeoff?</h3>
                    <p>
                      Search for a route to discover available flights.
                      Try Cairo to Dubai, London, or Jeddah.
                    </p>
                  </div>
                )}
              </div>
            </>
          )}

          {page === 'bookings' && (
            <>
              <div className="page-heading">
                <p className="eyebrow">YOUR TRAVEL HISTORY</p>
                <h1>My bookings</h1>
                <p className="sub">
                  Track your reservations and manage your upcoming journeys.
                </p>
              </div>

              {bookings.length ? (
                <div className="booking-list">
                  {bookings.map(booking => (
                    <article className="booking" key={booking.id}>
                      <div className="booking-top">
                        <div>
                          <span className="booking-reference-label">
                            BOOKING REFERENCE
                          </span>
                          <b>{booking.reference}</b>
                        </div>
                        <Status value={booking.status} />
                      </div>

                      <div className="booking-route">
                        <div>
                          <span>FROM</span>
                          <h2>{booking.origin}</h2>
                        </div>
                        <div className="booking-plane">✈</div>
                        <div>
                          <span>TO</span>
                          <h2>{booking.destination}</h2>
                        </div>
                      </div>

                      <div className="booking-meta">
                        <span>{booking.flightNumber} · {booking.airline}</span>
                        <span>{localDate(booking.departureAt)}</span>
                        <span>{booking.passengerCount} passenger(s)</span>
                        <b>{money(booking.totalAmount, booking.currency)}</b>
                      </div>

                      <div className="booking-footer">
                        <div>
                          <span>PAYMENT</span>
                          <Status value={booking.paymentStatus || 'UNKNOWN'} />
                        </div>
<details className="payment-activity">
  <summary>Payment activity</summary>

  <div className="payment-transactions">
    {booking.transactions?.length ? (
      booking.transactions.map(transaction => (
        <div
          className="payment-transaction"
          key={transaction.id}
        >
          <div>
            <strong>
              {transaction.transactionType === 'PAYMENT'
                ? 'Original payment'
                : 'Refund'}
            </strong>

            <small>{transaction.description}</small>
          </div>

          <strong>
            {transaction.transactionType === 'PAYMENT' ? '-' : '+'}
            {money(transaction.amount, transaction.currency)}
          </strong>
        </div>
      ))
    ) : (
      <p>No completed transactions yet.</p>
    )}
  </div>

  <div className="payment-net">
    <span>Net amount paid</span>
    <strong>{money(booking.netPaid || 0, booking.currency)}</strong>
  </div>
</details>
                        <details>
                          <summary>Passenger details</summary>
                          {booking.passengers.map((passenger, index) => (
                            <p key={index}>
                              {passenger.fullName} — {passenger.email}
                            </p>
                          ))}
                        </details>

{booking.status === 'PENDING_PAYMENT' && (
  <button
    className="primary small"
    onClick={() => openExistingCheckout(booking)}
  >
    Complete payment
  </button>
)}

{booking.status === 'CONFIRMED' &&
  booking.paymentStatus === 'SUCCEEDED' && (
    <button
      className="primary small"
      disabled={busy}
      onClick={() => downloadTicket(booking)}
    >
      Download PDF ticket
    </button>
  )}

{['PENDING_PAYMENT', 'CONFIRMED'].includes(booking.status) && (
  <button
    className="danger"
    disabled={busy}
    onClick={() => cancelBooking(booking.id)}
  >
    Cancel booking
  </button>
)}
                    </div>
                    </article>
                  ))}
                </div>
              ) : (
                <div className="empty">
                  <div className="empty-icon">▤</div>
                  <h3>Your journey starts here</h3>
                  <p>You haven't made any bookings yet.</p>
                  <button
                    className="primary"
                    onClick={() => setPage('search')}
                  >
                    Explore flights
                  </button>
                </div>
              )}
            </>
          )}

          {page === 'manage' && user.role === 'ADMIN' && (
            <>
              <div className="page-heading">
                <p className="eyebrow">ADMINISTRATION</p>
                <h1>Manage flights</h1>
                <p className="sub">
                  Create and manage the flight schedules available to customers.
                </p>
              </div>

              <form className="admin-form" onSubmit={createFlight}>
                <label>
                  Flight number
                  <input
                    required
                    value={flightForm.flightNumber}
                    onChange={event =>
                      setFlightForm({
                        ...flightForm,
                        flightNumber: event.target.value
                      })
                    }
                    placeholder="SB700"
                  />
                </label>

                <label>
                  Airline
                  <input
                    required
                    value={flightForm.airline}
                    onChange={event =>
                      setFlightForm({
                        ...flightForm,
                        airline: event.target.value
                      })
                    }
                  />
                </label>

                <label>
                  Origin
                  <input
                    required
                    value={flightForm.origin}
                    onChange={event =>
                      setFlightForm({
                        ...flightForm,
                        origin: event.target.value
                      })
                    }
                  />
                </label>

                <label>
                  Destination
                  <input
                    required
                    value={flightForm.destination}
                    onChange={event =>
                      setFlightForm({
                        ...flightForm,
                        destination: event.target.value
                      })
                    }
                  />
                </label>

                <label>
                  Departure
                  <input
                    required
                    type="datetime-local"
                    value={flightForm.departureAt}
                    onChange={event =>
                      setFlightForm({
                        ...flightForm,
                        departureAt: event.target.value
                      })
                    }
                  />
                </label>

                <label>
                  Arrival
                  <input
                    required
                    type="datetime-local"
                    value={flightForm.arrivalAt}
                    onChange={event =>
                      setFlightForm({
                        ...flightForm,
                        arrivalAt: event.target.value
                      })
                    }
                  />
                </label>

                <label>
                  Price
                  <input
                    required
                    type="number"
                    min="0"
                    step="0.01"
                    value={flightForm.price}
                    onChange={event =>
                      setFlightForm({
                        ...flightForm,
                        price: event.target.value
                      })
                    }
                  />
                </label>

                <label>
                  Currency
                  <input
                    required
                    maxLength="3"
                    value={flightForm.currency}
                    onChange={event =>
                      setFlightForm({
                        ...flightForm,
                        currency: event.target.value.toUpperCase()
                      })
                    }
                  />
                </label>

                <label>
                  Total seats
                  <input
                    required
                    type="number"
                    min="1"
                    value={flightForm.totalSeats}
                    onChange={event =>
                      setFlightForm({
                        ...flightForm,
                        totalSeats: event.target.value
                      })
                    }
                  />
                </label>

                <button className="primary" disabled={busy}>
                  {busy ? 'Creating...' : '＋ Create flight'}
                </button>
              </form>

              <div className="section-head">
                <h2>Current flights</h2>
                <button className="secondary" onClick={loadAdminFlights}>
                  Refresh
                </button>
              </div>

              <div className="flight-list">
                {flights.map(flight => (
                  <article className="flight admin-flight" key={flight.id}>
                    <div>
                      <b>{flight.flightNumber}</b>
                      <span>{flight.origin} → {flight.destination}</span>
                    </div>
                    <div>
                      <small>{localDate(flight.departureAt)}</small>
                      <b>{flight.availableSeats}/{flight.totalSeats} seats</b>
                    </div>
                    <button
                      className="danger"
                      onClick={() => cancelFlight(flight.id)}
                    >
                      Cancel flight
                    </button>
                  </article>
                ))}
              </div>
            </>
          )}

          {page === 'adminBookings' && user.role === 'ADMIN' && (
            <>
              <div className="page-heading">
                <p className="eyebrow">ADMINISTRATION</p>
                <h1>All bookings</h1>
                <p className="sub">
                  Review customer reservations and payment statuses.
                </p>
              </div>

              <div className="booking-list">
                {adminBookings.map(booking => (
                  <article className="booking admin-booking" key={booking.reference}>
                    <div className="booking-top">
                      <b>{booking.reference}</b>
                      <Status value={booking.status} />
                    </div>

                    <h3>
                      {booking.origin} → {booking.destination}
                      <span className="flight-number">
                        {booking.flightNumber}
                      </span>
                    </h3>

                    <p>
                      Customer: {booking.customerName} · {booking.email}
                    </p>

                    <div className="admin-booking-bottom">
                      <span>{booking.passengerCount} passenger(s)</span>
                      <b>{money(booking.totalAmount, booking.currency)}</b>
                      <Status value={booking.paymentStatus || 'UNKNOWN'} />
                      <small>{localDate(booking.createdAt)}</small>
                    </div>
                  </article>
                ))}
              </div>
            </>
          )}
        </main>
      </div>

      {selected && (
        <div className="modal-backdrop" onMouseDown={event => {
          if (event.target === event.currentTarget) setSelected(null);
        }}>
          <form className="modal" onSubmit={confirmBooking}>
            <button
              type="button"
              className="close"
              onClick={() => setSelected(null)}
            >
              ×
            </button>

            <p className="eyebrow">STEP 1 · PASSENGER INFORMATION</p>
            <h2>Complete your reservation</h2>
            <p className="sub">
              Review your flight and enter the details of everyone travelling.
            </p>

            <div className="checkout-flight">
              <div>
                <span>YOUR ROUTE</span>
                <h2>{selected.origin} → {selected.destination}</h2>
                <p>{selected.flightNumber} · {selected.airline}</p>
              </div>
              <div className="checkout-flight-price">
                <span>PRICE PER PERSON</span>
                <b>{money(selected.price, selected.currency)}</b>
              </div>
            </div>
<h3>Select your seats ({selectedSeats.length}/{passengers.length})</h3>

<div className="seat-legend">
  <span><i className="seat-dot available-dot" /> Available</span>
  <span><i className="seat-dot selected-dot" /> Selected</span>
  <span><i className="seat-dot occupied-dot" /> Occupied</span>
</div>

{seatMapLoading ? (
  <p>Loading available seats...</p>
) : seatMapError ? (
  <p className="checkout-warning">{seatMapError}</p>
) : (
  <div className="seat-map">
    {Array.from(new Set(seatMap.map(seat => seat.seatRow))).map(row => (
      <div className="seat-row" key={row}>
        <span className="seat-row-number">{row}</span>

        {seatMap
          .filter(seat => seat.seatRow === row)
          .map(seat => {
            const isSelected = selectedSeats.includes(seat.seatNumber);
            const isAvailable = seat.status === 'AVAILABLE';

            return (
              <button
                key={seat.seatNumber}
                type="button"
                className={`seat ${isSelected ? 'selected' : isAvailable ? 'available' : 'occupied'}`}
                disabled={!isAvailable && !isSelected}
                onClick={() => {
                  setSelectedSeats(previous => {
                    if (previous.includes(seat.seatNumber)) {
                      return previous.filter(item => item !== seat.seatNumber);
                    }

                    if (previous.length >= passengers.length) {
                      return previous;
                    }

                    return [...previous, seat.seatNumber];
                  });
                }}
                title={`${seat.seatNumber} - ${seat.status}`}
              >
                {seat.seatLetter}
              </button>
            );
          })}
      </div>
    ))}
  </div>
)}

{selectedSeats.length > 0 && (
  <p className="selected-seat-summary">
    Selected seats: <strong>{selectedSeats.join(', ')}</strong>
  </p>
)}
            <h3>Passenger details ({passengers.length})</h3>

            {passengers.map((passenger, index) => (
              <div className="passenger" key={index}>
                <b>Passenger {index + 1}</b>

                <label>
                  Full name
                  <input
                    required
                    minLength="2"
                    value={passenger.fullName}
                    onChange={event =>
                      setPassengers(passengers.map((item, i) =>
                        i === index
                          ? { ...item, fullName: event.target.value }
                          : item
                      ))
                    }
                    placeholder="Full name"
                  />
                </label>

                <label>
                  Email
                  <input
                    required
                    type="email"
                    value={passenger.email}
                    onChange={event =>
                      setPassengers(passengers.map((item, i) =>
                        i === index
                          ? { ...item, email: event.target.value }
                          : item
                      ))
                    }
                    placeholder="Passenger email"
                  />
                </label>

                <label>
                  Passport number (optional)
                  <input
                    value={passenger.passportNumber}
                    onChange={event =>
                      setPassengers(passengers.map((item, i) =>
                        i === index
                          ? { ...item, passportNumber: event.target.value }
                          : item
                      ))
                    }
                    placeholder="Passport number"
                  />
                </label>
              </div>
            ))}

            <div className="total">
              <span>Total amount</span>
              <b>
                {money(
                  Number(selected.price) * passengers.length,
                  selected.currency
                )}
              </b>
            </div>

            <div className="checkout-note">
              Your seats will be held for 15 minutes after reservation.
              Payment is simulated for this project.
            </div>

            <button className="primary modal-submit" disabled={busy}>
              {busy ? 'Reserving seats...' : 'Reserve seats and continue →'}
            </button>
          </form>
        </div>
      )}

      {checkout && (
        <div className="modal-backdrop" onMouseDown={event => {
          if (event.target === event.currentTarget && !paymentBusy) {
            setCheckout(null);
            setCheckoutResult(null);
          }
        }}>
          <section className="modal payment-modal">
            <button
              type="button"
              className="close"
              disabled={paymentBusy}
              onClick={() => {
                setCheckout(null);
                setCheckoutResult(null);
              }}
            >
              ×
            </button>

            {!checkoutResult ? (
              <>
                <p className="eyebrow">STEP 2 · CHECKOUT</p>
                <div className="payment-icon">◇</div>
                <h2>Complete your payment</h2>
                <p className="sub">
                  Your reservation is pending. Complete the simulated payment
                  before your seat reservation expires.
                </p>

                <div className="payment-summary">
                  <div>
                    <span>BOOKING REFERENCE</span>
                    <b>{checkout.booking.reference}</b>
                  </div>
                  <div>
                    <span>BOOKING STATUS</span>
                    <Status value={checkout.booking.status} />
                  </div>
                  <div>
                    <span>PAYMENT METHOD</span>
                    <b>SkyBook Demo Payment</b>
                  </div>
                  <div>
                    <span>PAYMENT STATUS</span>
                    <Status value={checkout.payment.status} />
                  </div>
                  <div className="payment-total">
                    <span>AMOUNT TO PAY</span>
                    <b>
                      {money(
                        checkout.booking.totalAmount,
                        checkout.booking.currency
                      )}
                    </b>
                  </div>
                </div>

                <div className={`countdown ${secondsLeft < 120 ? 'countdown-warning' : ''}`}>
                  <span>TIME REMAINING</span>
                  <b>
                    {String(Math.floor(secondsLeft / 60)).padStart(2, '0')}:
                    {String(secondsLeft % 60).padStart(2, '0')}
                  </b>
                </div>

{secondsLeft > 0 ? (
  <form className="payment-card-form" onSubmit={submitSimulatedPayment}>
    <label>
      Cardholder name
      <input
        name="cardholder"
        type="text"
        placeholder="Name on card"
        autoComplete="off"
        required
      />
    </label>

    <label>
      Card number
      <input
        name="cardNumber"
        type="text"
        inputMode="numeric"
        placeholder="1234 5678 9012 3456"
        maxLength={23}
        autoComplete="off"
        pattern="[0-9 ]{13,23}"
        required
      />
    </label>

    <div className="payment-card-row">
      <label>
        Expiry date
        <input
          name="expiry"
          type="text"
          placeholder="MM/YY"
          maxLength={5}
          pattern="(0[1-9]|1[0-2])/[0-9]{2}"
          autoComplete="off"
          required
        />
      </label>

      <label>
        Security code (CVV)
        <input
          name="cvv"
          type="password"
          inputMode="numeric"
          placeholder="123"
          maxLength={4}
          pattern="[0-9]{3,4}"
          autoComplete="off"
          required
        />
      </label>
    </div>

    {cardError && <p className="checkout-warning">{cardError}</p>}

    <button
      type="submit"
      className="primary modal-submit"
      disabled={paymentBusy}
    >
      {paymentBusy ? 'Processing payment...' : 'Pay now'}
    </button>

    <p className="demo-disclaimer">
      SIMULATED PAYMENT · No real charge will be made.
    </p>
  </form>
) : (
  <p className="checkout-note checkout-warning">
    The reservation time has expired. Your reserved seats will be released.
  </p>
)}              </>
            ) : (
              <div className="payment-result">
                <div className="success-icon">✓</div>
                <p className="eyebrow">PAYMENT COMPLETED</p>
                <h2>Your booking is confirmed!</h2>
                <p className="sub">
                  Your simulated payment was successful. Your reservation is
                  now confirmed.
                </p>

                <div className="payment-summary">
                  <div>
                    <span>BOOKING REFERENCE</span>
                    <b>{checkoutResult.booking.reference}</b>
                  </div>
                  <div>
                    <span>BOOKING STATUS</span>
                    <Status value={checkoutResult.booking.status} />
                  </div>
                  <div>
                    <span>PAYMENT STATUS</span>
                    <Status value={checkoutResult.payment.status} />
                  </div>
                  <div>
                    <span>EMAIL</span>
                    <b>
                      {checkoutResult.emailSent
                        ? 'Confirmation email sent'
                        : 'Booking confirmed; email not sent'}
                    </b>
                  </div>
                </div>

                <button
                  className="primary modal-submit"
                  onClick={() => {
                    setCheckout(null);
                    setCheckoutResult(null);
                    setPage('bookings');
                    loadBookings();
                  }}
                >
                  View my bookings →
                </button>
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
