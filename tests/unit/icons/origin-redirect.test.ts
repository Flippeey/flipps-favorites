import { describe, expect, it } from 'vitest';
import { isCrossRootRedirect } from '@/background/icons/icon-classify';

// Guard against login-redirect poisoning: when https://<host>/ lands on another
// registrable domain, the final HTML belongs to a login provider and its icons
// must not be harvested as the bookmark's "origin" icons.
describe('isCrossRootRedirect', () => {
  it('flags redirects to a different registrable domain', () => {
    expect(isCrossRootRedirect('dev.azure.com', 'https://login.microsoftonline.com/common/oauth2')).toBe(true);
    expect(isCrossRootRedirect('cadacgroup.sharepoint.com', 'https://login.microsoftonline.com/')).toBe(true);
    expect(isCrossRootRedirect('manage.auth0.com', 'https://accounts.auth0.io/login')).toBe(true);
  });

  it('allows same-root redirects (www, locale paths, sibling subdomains)', () => {
    expect(isCrossRootRedirect('example.com', 'https://www.example.com/')).toBe(false);
    expect(isCrossRootRedirect('dev.azure.com', 'https://aex.dev.azure.com/me')).toBe(false);
    expect(isCrossRootRedirect('claude.ai', 'https://claude.ai/new')).toBe(false);
  });

  it('treats an unparseable final URL as not gated', () => {
    expect(isCrossRootRedirect('example.com', '')).toBe(false);
  });
});
