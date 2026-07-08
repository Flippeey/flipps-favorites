import { describe, expect, it } from 'vitest';
import { classifyHeroInput } from '@/newtab/lib/url';

describe('classifyHeroInput', () => {
  it('classifies explicit http/https input as a url', () => {
    expect(classifyHeroInput('https://a.com/x')).toEqual({ kind: 'url', url: 'https://a.com/x' });
    expect(classifyHeroInput('http://foo')).toEqual({ kind: 'url', url: 'http://foo' });
  });

  it('is case-insensitive on the scheme prefix', () => {
    expect(classifyHeroInput('HTTPS://A.com')).toEqual({ kind: 'url', url: 'HTTPS://A.com' });
  });

  it('treats bare hosts, host:port, and dotted tokens as search, not url', () => {
    expect(classifyHeroInput('example.com')).toEqual({ kind: 'search', query: 'example.com' });
    expect(classifyHeroInput('localhost:3000')).toEqual({ kind: 'search', query: 'localhost:3000' });
    expect(classifyHeroInput('3.14')).toEqual({ kind: 'search', query: '3.14' });
    expect(classifyHeroInput('node.js')).toEqual({ kind: 'search', query: 'node.js' });
    expect(classifyHeroInput('u.s')).toEqual({ kind: 'search', query: 'u.s' });
  });

  it('treats a trailing-dot host as search', () => {
    expect(classifyHeroInput('example.com.')).toEqual({ kind: 'search', query: 'example.com.' });
  });

  it('treats a single non-dotted word as search', () => {
    expect(classifyHeroInput('single')).toEqual({ kind: 'search', query: 'single' });
  });

  it('never classifies disallowed schemes as url (XSS-relevant)', () => {
    expect(classifyHeroInput('javascript:alert(1)')).toEqual({ kind: 'search', query: 'javascript:alert(1)' });
    expect(classifyHeroInput('data:text/html,x')).toEqual({ kind: 'search', query: 'data:text/html,x' });
    expect(classifyHeroInput('file:///etc/passwd')).toEqual({ kind: 'search', query: 'file:///etc/passwd' });
    expect(classifyHeroInput('chrome://settings')).toEqual({ kind: 'search', query: 'chrome://settings' });
  });

  it('treats free text as search', () => {
    expect(classifyHeroInput('how to tie a tie')).toEqual({ kind: 'search', query: 'how to tie a tie' });
  });
});
