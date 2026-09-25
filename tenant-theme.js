/* Central tenant branding layer.
 * Pages should not own restaurant colors/identity. They consume CSS variables
 * and data-tenant-* attributes applied here.
 */
(function () {
  'use strict';

  const DEFAULT_THEME = Object.freeze({
    id: '11111111-1111-4111-8111-111111111111',
    name: 'Savanna Bites',
    slug: 'savanna-bites',
    logoUrl: '',
    colors: {
      ink: '#172019',
      muted: '#6f776f',
      paper: '#f5f3ed',
      card: '#ffffff',
      line: '#deddd5',
      accent: '#c96b3b',
      accentContrast: '#ffffff'
    }
  });

  // One central tenant registry. A future tenant can be added here without
  // editing individual pages. API-provided branding can override these values.
  const TENANT_THEMES = Object.freeze({
    '11111111-1111-4111-8111-111111111111': DEFAULT_THEME,
    'savanna-bites': DEFAULT_THEME
  });

  const safeString = (value, fallback = '') =>
    typeof value === 'string' && value.trim() ? value.trim() : fallback;

  function getRequestedTenant() {
    const params = new URLSearchParams(window.location.search);
    return safeString(
      window.TENANT_ID ||
      params.get('tenant') ||
      params.get('businessId') ||
      document.body?.dataset?.tenant ||
      '',
      DEFAULT_THEME.id
    );
  }

  function cloneTheme(theme) {
    return {
      ...DEFAULT_THEME,
      ...theme,
      colors: { ...DEFAULT_THEME.colors, ...(theme?.colors || {}) }
    };
  }

  function normaliseApiTheme(data) {
    const business = data?.business || data?.restaurant || data?.tenant || {};
    const theme = data?.theme || business?.theme || {};
    const colors = theme.colors || {};

    return {
      id: safeString(business.id || data?.businessId, ''),
      name: safeString(business.name || data?.businessName || data?.restaurantName, ''),
      slug: safeString(business.slug, ''),
      logoUrl: safeString(business.logo_url || business.logoUrl || theme.logoUrl, ''),
      colors: {
        ink: safeString(colors.ink || colors.primary, ''),
        muted: safeString(colors.muted, ''),
        paper: safeString(colors.paper || colors.background, ''),
        card: safeString(colors.card || colors.surface, ''),
        line: safeString(colors.line || colors.border, ''),
        accent: safeString(colors.accent || colors.primary, ''),
        accentContrast: safeString(colors.accentContrast || colors.primaryText, '')
      }
    };
  }

  function applyTheme(input) {
    const theme = cloneTheme(input);
    const root = document.documentElement;

    Object.entries({
      '--tenant-ink': theme.colors.ink,
      '--tenant-muted': theme.colors.muted,
      '--tenant-paper': theme.colors.paper,
      '--tenant-card': theme.colors.card,
      '--tenant-line': theme.colors.line,
      '--tenant-accent': theme.colors.accent,
      '--tenant-accent-contrast': theme.colors.accentContrast
    }).forEach(([name, value]) => root.style.setProperty(name, value));

    root.dataset.tenantId = theme.id || '';
    root.dataset.tenantSlug = theme.slug || '';

    document.querySelectorAll('[data-tenant-brand]').forEach((element) => {
      element.textContent = theme.name;
    });

    document.querySelectorAll('[data-tenant-name]').forEach((element) => {
      element.textContent = theme.name;
    });

    document.querySelectorAll('[data-tenant-logo]').forEach((element) => {
      if (theme.logoUrl) {
        element.src = theme.logoUrl;
        element.alt = theme.name;
        element.hidden = false;
      } else {
        element.hidden = true;
      }
    });

    const title = document.querySelector('title');
    if (title && theme.name) {
      title.textContent = title.textContent.replace(/Savanna Bites/gi, theme.name);
    }

    const themeColor = document.querySelector('meta[name="theme-color"]');
    if (themeColor) themeColor.setAttribute('content', theme.colors.ink);

    window.TENANT_THEME = theme;
    window.TENANT_BUSINESS_ID = theme.id || DEFAULT_THEME.id;

    document.dispatchEvent(new CustomEvent('tenanttheme:ready', {
      detail: theme
    }));

    return theme;
  }

  async function loadTenantTheme() {
    const requested = getRequestedTenant();
    const configured = TENANT_THEMES[requested] || DEFAULT_THEME;

    // Always paint a complete safe theme first. A failed request must never
    // prevent a page from rendering.
    applyTheme(configured);

    try {
      const businessId = encodeURIComponent(requested);
      const response = await fetch(
        'https://restaurant-ordering-api-ow3p.onrender.com/api/menu/public?businessId=' + businessId,
        { headers: { Accept: 'application/json' } }
      );

      if (!response.ok) return window.TENANT_THEME;

      const data = await response.json();
      const apiTheme = normaliseApiTheme(data);

      const merged = cloneTheme({
        ...configured,
        ...apiTheme,
        id: apiTheme.id || configured.id,
        name: apiTheme.name || configured.name,
        slug: apiTheme.slug || configured.slug,
        logoUrl: apiTheme.logoUrl || configured.logoUrl,
        colors: {
          ...configured.colors,
          ...Object.fromEntries(
            Object.entries(apiTheme.colors).filter(([, value]) => Boolean(value))
          )
        }
      });

      return applyTheme(merged);
    } catch (error) {
      // Branding is non-critical. Keep the already-applied fallback theme.
      console.warn('Tenant theme could not be loaded; using fallback theme.', error);
      return window.TENANT_THEME;
    }
  }

  window.TENANT_THEME_DEFAULT = DEFAULT_THEME;
  window.TENANT_THEMES = TENANT_THEMES;
  window.applyTenantTheme = applyTheme;
  window.loadTenantTheme = loadTenantTheme;

  // Synchronous fallback + non-blocking API enrichment.
  applyTheme(DEFAULT_THEME);
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', loadTenantTheme, { once: true });
  } else {
    loadTenantTheme();
  }
})();
