import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { normaliseGatewayPhone, buildGatewayChatLink } from '@/lib/whatsapp/gatewayPhone';

/**
 * The natural thing to paste is the number as written locally — 08134052165 —
 * and wa.me does nothing useful with it. No error, no bounce: the link simply
 * fails to open a chat, on the QR code the owner has already printed.
 */

beforeEach(() => { delete process.env.BOOKA_GATEWAY_PHONE; });

describe('normaliseGatewayPhone', () => {
  it('expands a Nigerian local number to international form', () => {
    // The leading 0 is a national trunk prefix and is never part of the
    // international number, so it is replaced, not kept.
    expect(normaliseGatewayPhone('08134052165')).toBe('2348134052165');
  });

  it('accepts the number exactly as Meta shows it', () => {
    expect(normaliseGatewayPhone('+234 813 405 2165')).toBe('2348134052165');
    expect(normaliseGatewayPhone('+2348134052165')).toBe('2348134052165');
  });

  it('leaves an already-international number alone', () => {
    expect(normaliseGatewayPhone('2348134052165')).toBe('2348134052165');
  });

  it('strips the punctuation people paste', () => {
    expect(normaliseGatewayPhone('0813-405-2165')).toBe('2348134052165');
    expect(normaliseGatewayPhone(' (0813) 405 2165 ')).toBe('2348134052165');
  });

  it('rejects something too short to be a real number', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    expect(normaliseGatewayPhone('12345')).toBeNull();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('rejects something too long for E.164', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    expect(normaliseGatewayPhone('1234567890123456')).toBeNull();
    warn.mockRestore();
  });

  it('returns null rather than a partial number when unset', () => {
    expect(normaliseGatewayPhone(undefined)).toBeNull();
    expect(normaliseGatewayPhone('')).toBeNull();
    expect(normaliseGatewayPhone('   ')).toBeNull();
  });
});

describe('buildGatewayChatLink', () => {
  it('builds a link wa.me will actually open, from the local form', () => {
    process.env.BOOKA_GATEWAY_PHONE = '08134052165';
    expect(buildGatewayChatLink('GLAM01')).toBe('https://wa.me/2348134052165?text=GLAM01');
  });

  it('encodes the prefilled text', () => {
    process.env.BOOKA_GATEWAY_PHONE = '2348134052165';
    expect(buildGatewayChatLink('BOOK ME #1')).toContain('text=BOOK%20ME%20%231');
  });

  it('returns null when nothing is configured, rather than a broken link', () => {
    expect(buildGatewayChatLink('GLAM01')).toBeNull();
  });
});
