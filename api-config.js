// Central platform API origin. Keep this as the single frontend/API relationship point.
// Production should use an API custom domain under the same registrable domain as the
// customer/manager/rider frontends (for example api.example.com + app.example.com).
// Do not put credentials or secrets in this file.
window.PLATFORM_API_ORIGIN = window.PLATFORM_API_ORIGIN || 'https://restaurant-ordering-api-ow3p.onrender.com';
