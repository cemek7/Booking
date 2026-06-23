import { decideSend } from '@/lib/whatsapp/v2/deliverability/metaSendGate';

const now = Date.parse('2026-06-23T12:00:00Z');
const recent = '2026-06-23T11:30:00Z';
const old = '2026-06-21T12:00:00Z';
const template = { name: 'rebooking_followup_v1', language: 'en_US' };

describe('decideSend', () => {
  it('holds initiated send to opted-out customer', () => {
    expect(
      decideSend({
        initiated: true,
        lastInboundAt: recent,
        optedOutAt: recent,
        messageType: 'rebooking_followup',
        template,
        now,
      }).mode,
    ).toBe('hold');
  });

  it('replies are always freeform', () => {
    expect(
      decideSend({
        initiated: false,
        lastInboundAt: old,
        optedOutAt: null,
        messageType: 'reply',
        template: null,
        now,
      }).mode,
    ).toBe('freeform');
  });

  it('initiated within 24h window is freeform', () => {
    expect(
      decideSend({
        initiated: true,
        lastInboundAt: recent,
        optedOutAt: null,
        messageType: 'rebooking_followup',
        template,
        now,
      }).mode,
    ).toBe('freeform');
  });

  it('initiated outside window with template -> template', () => {
    const decision = decideSend({
      initiated: true,
      lastInboundAt: old,
      optedOutAt: null,
      messageType: 'rebooking_followup',
      template,
      now,
    });

    expect(decision.mode).toBe('template');
    expect(decision.templateName).toBe('rebooking_followup_v1');
  });

  it('initiated outside window with no template -> hold', () => {
    expect(
      decideSend({
        initiated: true,
        lastInboundAt: old,
        optedOutAt: null,
        messageType: 'rebooking_followup',
        template: null,
        now,
      }).mode,
    ).toBe('hold');
  });

  it('no prior inbound at all + initiated -> hold without template', () => {
    expect(
      decideSend({
        initiated: true,
        lastInboundAt: null,
        optedOutAt: null,
        messageType: 'rebooking_followup',
        template: null,
        now,
      }).mode,
    ).toBe('hold');
  });
});
