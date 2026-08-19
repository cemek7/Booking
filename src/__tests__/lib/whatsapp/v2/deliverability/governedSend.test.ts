jest.mock('@/lib/whatsapp/v2/deliverability/numberQuality', () => ({
  loadNumberQuality: jest.fn(),
}));
jest.mock('@/lib/whatsapp/v2/deliverability/sendGovernor', () => ({
  evaluateSend: jest.fn(),
  recordSend: jest.fn(),
}));
jest.mock('@/lib/whatsapp/v2/deliverability/templateRegistry', () => ({
  resolveTemplate: jest.fn(),
}));
jest.mock('@/lib/whatsapp/v2/deliverability/metaSendGate', () => ({
  decideSend: jest.fn(),
}));
jest.mock('@/lib/whatsapp/v2/deliverability/tenantMessagingPolicy', () => ({
  loadTenantMessagingPolicy: jest.fn(),
}));

import { sendGovernedInitiated } from '@/lib/whatsapp/v2/deliverability/governedSend';
import { decideSend } from '@/lib/whatsapp/v2/deliverability/metaSendGate';
import { loadNumberQuality } from '@/lib/whatsapp/v2/deliverability/numberQuality';
import { evaluateSend, recordSend } from '@/lib/whatsapp/v2/deliverability/sendGovernor';
import { resolveTemplate } from '@/lib/whatsapp/v2/deliverability/templateRegistry';
import { loadTenantMessagingPolicy } from '@/lib/whatsapp/v2/deliverability/tenantMessagingPolicy';

const mockedLoadNumberQuality = loadNumberQuality as jest.MockedFunction<typeof loadNumberQuality>;
const mockedEvaluateSend = evaluateSend as jest.MockedFunction<typeof evaluateSend>;
const mockedRecordSend = recordSend as jest.MockedFunction<typeof recordSend>;
const mockedResolveTemplate = resolveTemplate as jest.MockedFunction<typeof resolveTemplate>;
const mockedDecideSend = decideSend as jest.MockedFunction<typeof decideSend>;
const mockedLoadTenantMessagingPolicy = loadTenantMessagingPolicy as jest.MockedFunction<typeof loadTenantMessagingPolicy>;

describe('sendGovernedInitiated', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedLoadNumberQuality.mockResolvedValue({
      phoneNumberId: 'P',
      quality: 'GREEN',
      limitPer24h: 1000,
    });
    mockedResolveTemplate.mockResolvedValue({
      name: 'tpl_name',
      language: 'en_US',
      paramMapping: [],
    });
    mockedLoadTenantMessagingPolicy.mockResolvedValue({
      templateMessagingEnabled: false,
      paidTemplateConsent: false,
    });
  });

  it('returns unsent when governor blocks and does not call senders', async () => {
    mockedEvaluateSend.mockResolvedValue({ allow: false, reason: 'allocation_exhausted' });

    const sendFreeform = jest.fn();
    const sendTemplate = jest.fn();
    const result = await sendGovernedInitiated({} as never, {
      tenantId: 't1',
      recipient: 'cust1',
      messageType: 'rebooking_followup',
      lastInboundAt: null,
      optedOutAt: null,
      buildFreeform: () => 'hello',
      sendFreeform,
      sendTemplate,
    });

    expect(result).toEqual({ sent: false, reason: 'allocation_exhausted' });
    expect(sendFreeform).not.toHaveBeenCalled();
    expect(sendTemplate).not.toHaveBeenCalled();
  });

  it('holds when the gate decides hold and does not record a send', async () => {
    mockedEvaluateSend.mockResolvedValue({ allow: true, reason: 'ok' });
    mockedDecideSend.mockReturnValue({ mode: 'hold', reason: 'opted_out' });

    const result = await sendGovernedInitiated({} as never, {
      tenantId: 't1',
      recipient: 'cust1',
      messageType: 'rebooking_followup',
      lastInboundAt: null,
      optedOutAt: '2026-06-23T10:00:00Z',
      buildFreeform: () => 'hello',
      sendFreeform: jest.fn(),
      sendTemplate: jest.fn(),
    });

    expect(result).toEqual({ sent: false, reason: 'opted_out' });
    expect(mockedRecordSend).not.toHaveBeenCalled();
  });

  it('sends freeform and records a non-cold initiated send', async () => {
    mockedEvaluateSend.mockResolvedValue({ allow: true, reason: 'ok' });
    mockedDecideSend.mockReturnValue({ mode: 'freeform', reason: 'in_window' });

    const sendFreeform = jest.fn().mockResolvedValue(true);
    const result = await sendGovernedInitiated({} as never, {
      tenantId: 't1',
      recipient: 'cust1',
      messageType: 'rebooking_followup',
      lastInboundAt: new Date().toISOString(),
      optedOutAt: null,
      buildFreeform: () => 'hello',
      sendFreeform,
      sendTemplate: jest.fn(),
    });

    expect(sendFreeform).toHaveBeenCalledWith('hello');
    expect(mockedRecordSend).toHaveBeenCalledWith(
      {} as never,
      't1',
      expect.objectContaining({ initiated: true, cold: false, failed: false }),
    );
    expect(result).toEqual({ sent: true, mode: 'freeform', reason: 'sent' });
  });

  it('sends template and records a cold initiated send', async () => {
    mockedEvaluateSend.mockResolvedValue({ allow: true, reason: 'ok' });
    mockedDecideSend.mockReturnValue({
      mode: 'template',
      templateName: 'tpl_name',
      language: 'en_US',
      reason: 'template_out_of_window',
    });
    mockedLoadTenantMessagingPolicy.mockResolvedValue({
      templateMessagingEnabled: true,
      paidTemplateConsent: true,
    });

    const sendTemplate = jest.fn().mockResolvedValue(true);
    const result = await sendGovernedInitiated({} as never, {
      tenantId: 't1',
      recipient: 'cust1',
      messageType: 'rebooking_followup',
      lastInboundAt: '2026-06-20T12:00:00Z',
      optedOutAt: null,
      buildFreeform: () => 'hello',
      sendFreeform: jest.fn(),
      sendTemplate,
    });

    expect(sendTemplate).toHaveBeenCalledWith('tpl_name', 'en_US', []);
    expect(mockedRecordSend).toHaveBeenCalledWith(
      {} as never,
      't1',
      expect.objectContaining({ initiated: true, cold: true, failed: false }),
    );
    expect(result).toEqual({ sent: true, mode: 'template', reason: 'sent' });
  });

  it('does not send a chargeable template until the tenant enables template messaging', async () => {
    mockedEvaluateSend.mockResolvedValue({ allow: true, reason: 'ok' });
    mockedDecideSend.mockReturnValue({
      mode: 'template',
      templateName: 'tpl_name',
      language: 'en_US',
      reason: 'template_out_of_window',
    });

    const sendTemplate = jest.fn();
    const result = await sendGovernedInitiated({} as never, {
      tenantId: 't1',
      recipient: 'cust1',
      messageType: 'rebooking_followup',
      lastInboundAt: '2026-06-20T12:00:00Z',
      optedOutAt: null,
      buildFreeform: () => 'hello',
      sendFreeform: jest.fn(),
      sendTemplate,
    });

    expect(result).toEqual({ sent: false, reason: 'template_messaging_not_enabled' });
    expect(sendTemplate).not.toHaveBeenCalled();
    expect(mockedRecordSend).not.toHaveBeenCalled();
  });

  it('does not send a chargeable template without the tenant charge acknowledgement', async () => {
    mockedEvaluateSend.mockResolvedValue({ allow: true, reason: 'ok' });
    mockedDecideSend.mockReturnValue({
      mode: 'template',
      templateName: 'tpl_name',
      language: 'en_US',
      reason: 'template_out_of_window',
    });
    mockedLoadTenantMessagingPolicy.mockResolvedValue({
      templateMessagingEnabled: true,
      paidTemplateConsent: false,
    });

    const sendTemplate = jest.fn();
    const result = await sendGovernedInitiated({} as never, {
      tenantId: 't1',
      recipient: 'cust1',
      messageType: 'rebooking_followup',
      lastInboundAt: '2026-06-20T12:00:00Z',
      optedOutAt: null,
      buildFreeform: () => 'hello',
      sendFreeform: jest.fn(),
      sendTemplate,
    });

    expect(result).toEqual({ sent: false, reason: 'paid_template_consent_required' });
    expect(sendTemplate).not.toHaveBeenCalled();
    expect(mockedRecordSend).not.toHaveBeenCalled();
  });
});
