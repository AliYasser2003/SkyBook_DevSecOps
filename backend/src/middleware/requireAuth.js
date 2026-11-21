const jwt = require('jsonwebtoken');

module.exports = (req, res, next) => {
  try {
    // Read the authentication token from the HTTP-only cookie
    const token = req.cookies?.flight_session;

    if (!token) {
      return res.status(401).json({
        message: 'Please sign in.'
      });
    }

    // Verify token signature and expiration
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Attach authenticated user information to the request
    req.user = {
      id: decoded.id,
      email: decoded.email,
      role: decoded.role
    };

    return next();

  } catch (error) {
    if (
      error instanceof jwt.TokenExpiredError ||
      error instanceof jwt.JsonWebTokenError
    ) {
      return res.status(401).json({
        message: 'Invalid or expired session. Please sign in again.'
      });
    }

    return next(error);
  }
};
