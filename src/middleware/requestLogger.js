function logEvent(event, details = {}) {
  console.log(JSON.stringify({
    timestamp: new Date().toISOString(),
    level: "info",
    event,
    ...details
  }));
}

function requestLogger(req, res, next) {
  const started = Date.now();

  res.on("finish", () => {
    logEvent("http.request", {
      method: req.method,
      path: req.path,
      status: res.statusCode,
      user_id: req.user?.id ?? null,
      duration_ms: Date.now() - started
    });
  });

  next();
}

module.exports = { logEvent, requestLogger };