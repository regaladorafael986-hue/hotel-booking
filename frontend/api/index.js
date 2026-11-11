// Vercel Serverless Function: the existing StayEase Express API (backend/src/app.js), unchanged.
// frontend/vercel.json rewrites every /api/* request here; the Express routes see the original URL.
// The Vercel project's Root Directory is `frontend`, so the backend is loaded from the folder beside it.
const { createApp } = require('../../backend/src/app');

module.exports = createApp();
