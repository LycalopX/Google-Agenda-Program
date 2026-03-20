const RATE_LIMIT_WINDOW = 15 * 60 * 1000; // 15 minutes
const MAX_ATTEMPTS = 10; // 10 attempts per window

const attemptsMap = new Map();

/**
 * Simple In-Memory Rate Limiter Middleware.
 * Prevents Brute Force on sensitive routes.
 */
function rateLimiter(req, res, next) {
    // Get IP (handles Proxy if 'trust proxy' is set in Express, otherwise socket IP)
    // Since MasterHub might proxy, looking at x-forwarded-for is good practice, 
    // but req.ip usually handles it if app.set('trust proxy', true) is on.
    // For now, we use req.ip which is standard.
    const ip = req.ip || req.connection.remoteAddress;
    const now = Date.now();

    if (!attemptsMap.has(ip)) {
        attemptsMap.set(ip, []);
    }

    const timestamps = attemptsMap.get(ip);
    
    // Filter: Keep only timestamps within the window
    const recentTimestamps = timestamps.filter(time => now - time < RATE_LIMIT_WINDOW);
    
    // Update the map with cleaned history
    attemptsMap.set(ip, recentTimestamps);

    if (recentTimestamps.length >= MAX_ATTEMPTS) {
        // Blocks the request
        return res.status(429).json({ 
            success: false, 
            message: "Muitas tentativas incorretas. Aguarde 15 minutos." 
        });
    }

    // Records this attempt
    // NOTE: Ideally we only count *failed* attempts for login, but counting all attempts 
    // on a sensitive route like /upload is a safe default for brute-force prevention.
    recentTimestamps.push(now);
    
    next();
}

// Cleanup: Every 10 minutes, remove IPs that have no recent attempts
setInterval(() => {
    const now = Date.now();
    for (const [ip, timestamps] of attemptsMap.entries()) {
        const valid = timestamps.filter(t => now - t < RATE_LIMIT_WINDOW);
        if (valid.length === 0) {
            attemptsMap.delete(ip);
        } else {
            attemptsMap.set(ip, valid);
        }
    }
}, 10 * 60 * 1000);

module.exports = rateLimiter;