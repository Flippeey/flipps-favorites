import { describe, expect, it } from 'vitest';
import { extractBrandInfo, getBrandName } from '@/shared/url-brand';

describe('extractBrandInfo — subdomain-aware brand', () => {
  it('keeps a meaningful subdomain distinct from the registrable brand', () => {
    expect(extractBrandInfo('https://drive.google.com')).toEqual({ brand: 'google', subdomain: 'drive', isPersonalInfra: false });
    expect(extractBrandInfo('https://play.google.com/store')).toEqual({ brand: 'google', subdomain: 'play', isPersonalInfra: false });
    expect(extractBrandInfo('https://mail.google.com')).toEqual({ brand: 'google', subdomain: 'mail', isPersonalInfra: false });
  });

  it('drops generic subdomains (www/m/app/login) — no subdomain brand', () => {
    expect(extractBrandInfo('https://www.google.com')).toEqual({ brand: 'google', subdomain: '', isPersonalInfra: false });
    expect(extractBrandInfo('https://m.youtube.com')).toEqual({ brand: 'youtube', subdomain: '', isPersonalInfra: false });
    expect(extractBrandInfo('https://login.example.com')).toEqual({ brand: 'example', subdomain: '', isPersonalInfra: false });
  });

  it('has no subdomain for bare registrable domains', () => {
    expect(extractBrandInfo('https://github.com')).toEqual({ brand: 'github', subdomain: '', isPersonalInfra: false });
  });

  it('handles multi-part SLDs (.co.uk) with and without a subdomain', () => {
    expect(extractBrandInfo('https://pogdesign.co.uk')).toEqual({ brand: 'pogdesign', subdomain: '', isPersonalInfra: false });
    expect(extractBrandInfo('https://shop.pogdesign.co.uk')).toEqual({ brand: 'pogdesign', subdomain: 'shop', isPersonalInfra: false });
  });

  it('flags personal-infra hosts and never attaches a subdomain brand', () => {
    expect(extractBrandInfo('https://jellyfin.local.flippflix.com')).toEqual({ brand: 'jellyfin', subdomain: '', isPersonalInfra: true });
    expect(extractBrandInfo('https://service.local')).toEqual({ brand: 'service', subdomain: '', isPersonalInfra: true });
  });
});

describe('getBrandName — unchanged display brand (root only)', () => {
  it('returns the registrable brand, ignoring subdomain', () => {
    expect(getBrandName('https://drive.google.com')).toBe('google');
    expect(getBrandName('https://github.com')).toBe('github');
  });
});
