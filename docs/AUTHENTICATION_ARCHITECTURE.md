# Authentication and frontend/API architecture foundation

## Current deployment relationship

The frontend is currently served from GitHub Pages and the API from Render. The API origin is now centralized in api-config.js so dashboard code does not own separate API URLs.

## Production target before cookie activation

Use a custom frontend domain and a custom Render API domain under the same registrable domain, for example:

- app.example.com (frontend)
- api.example.com (API)

The exact domain is intentionally not hard-coded here because the platform's final owned domain has not yet been selected/configured.

This matters for the cookie phase: the browser sends a cookie to the API host, while the frontend calls that API with credentialed requests. Keeping both hosts under one site avoids treating the authentication flow as an unrelated-site integration.

## Shared session abstraction

session-auth.js is the single frontend abstraction for Manager, Rider and Platform authentication. It currently preserves the existing Bearer-token migration path and defines the future HttpOnly cookie names without exposing cookies to JavaScript.

The backend session tables remain the source of truth. The cookie migration will change how the browser presents the existing server-side session; it will not replace tenant/role authorization.

## Migration order

1. Centralize API origin and session handling (this foundation).
2. Configure the final custom frontend/API domains and verify CORS/credential behavior.
3. Add HttpOnly, Secure, SameSite session cookies while accepting legacy Bearer sessions.
4. Add CSRF protection for cookie-authenticated state-changing requests.
5. Add session rotation and idle/absolute expiration controls.
6. Test cookie and legacy authentication in parallel.
7. Remove frontend Bearer-token storage and legacy Authorization authentication after verification.

No authentication cookie is enabled by this foundation commit.
