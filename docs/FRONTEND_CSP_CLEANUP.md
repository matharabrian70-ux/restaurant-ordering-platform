# Frontend CSP Cleanup

The static frontend previously placed `frame-ancestors 'none'` inside a CSP meta element.

That directive is not supported in a CSP meta element. It must be delivered in the HTTP `Content-Security-Policy` response header.

The unsupported directive has therefore been removed from the static HTML instead of leaving a misleading security control in place.

## Production requirement

When the frontend moves to its final hosting/domain setup, configure the hosting layer to send:

`Content-Security-Policy: frame-ancestors 'none';`

and, where appropriate:

`X-Frame-Options: DENY`

Do not add browser-extension origins such as Binance Wallet to the application's CSP merely because an extension injected a connection attempt. Extension traffic is not an application dependency.

The remaining meta CSP can continue to protect static pages, but the production deployment should use an HTTP CSP header for the complete policy.
