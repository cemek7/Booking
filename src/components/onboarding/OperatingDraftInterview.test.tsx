import { act, fireEvent, render, screen } from '@testing-library/react';
import { jest } from '@jest/globals';
import OperatingDraftInterview, { type OperatingDraftInterviewAction } from './OperatingDraftInterview';
import type { OperatingDraftView } from '@/lib/onboarding/operating-draft';

const activeDraft: OperatingDraftView = {
  answers: {
    business_profile: { status: 'answered', answer: 'A warm neighbourhood salon.' },
    offer: { status: 'unanswered' },
    handoff: { status: 'unanswered' },
    deposit: { status: 'unanswered' },
    confirmation: { status: 'unanswered' },
  },
  nextQuestion: { id: 'offer', prompt: 'What do customers usually buy or book from you?' },
  readiness: { answered: 1, skipped: 0, total: 5, percent: 20 },
  launch: { ready: false, approvalRequired: true },
};

const reviewDraft: OperatingDraftView = {
  answers: {
    business_profile: { status: 'answered', answer: 'A warm neighbourhood salon.' },
    offer: { status: 'answered', answer: 'Braids and treatments.' },
    handoff: { status: 'answered', answer: 'Escalate custom colour requests.' },
    deposit: { status: 'answered', answer: 'Collect a deposit for appointments over ₦20,000.' },
    confirmation: { status: 'answered', answer: 'Confirm the day before, then follow up once.' },
  },
  nextQuestion: null,
  readiness: { answered: 5, skipped: 0, total: 5, percent: 100 },
  launch: { ready: false, approvalRequired: true },
};

describe('OperatingDraftInterview', () => {
  it('does not render until the feature is enabled', () => {
    render(<OperatingDraftInterview enabled={false} draft={activeDraft} onAction={async () => {}} onContinue={() => {}} />);
    expect(screen.queryByText('A short front-desk interview')).not.toBeInTheDocument();
  });

  it('shows one conversational next question with readiness and submits a natural-language answer', async () => {
    const onAction = jest.fn<Promise<void>, [OperatingDraftInterviewAction]>().mockResolvedValue(undefined);
    render(<OperatingDraftInterview enabled draft={activeDraft} onAction={onAction} onContinue={() => {}} />);

    expect(screen.getByText('1 of 5 front-desk details ready')).toBeInTheDocument();
    expect(screen.getByText('What do customers usually buy or book from you?')).toBeInTheDocument();
    expect(screen.queryByText('Escalate custom colour requests.')).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Your answer'), { target: { value: 'We sell braids and take weekend appointments.' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save answer' }));
    });

    expect(onAction).toHaveBeenCalledWith({
      action: 'answer', questionId: 'offer', answer: 'We sell braids and take weekend appointments.',
    });
  });

  it('shows the final operating summary and requires an explicit approval before continuing', async () => {
    const onAction = jest.fn<Promise<void>, [OperatingDraftInterviewAction]>().mockResolvedValue(undefined);
    render(<OperatingDraftInterview enabled draft={reviewDraft} onAction={onAction} onContinue={() => {}} />);

    expect(screen.getByText('Review your front-desk setup')).toBeInTheDocument();
    expect(screen.getByText('Collect a deposit for appointments over ₦20,000.')).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Approve front-desk setup' }));
    });
    expect(onAction).toHaveBeenCalledWith({ action: 'approve' });
  });

  it('keeps the interview actionable and explains a failed save', async () => {
    const onAction = jest.fn<Promise<void>, [OperatingDraftInterviewAction]>().mockRejectedValue(new Error('Network unavailable'));
    render(<OperatingDraftInterview enabled draft={activeDraft} onAction={onAction} onContinue={() => {}} />);

    fireEvent.change(screen.getByLabelText('Your answer'), { target: { value: 'We sell braids and take weekend appointments.' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save answer' }));
    });

    expect(screen.getByText('Network unavailable')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save answer' })).toBeEnabled();
  });

  it('lets an owner finish onboarding later without presenting the draft as approved', () => {
    const onContinue = jest.fn();
    render(<OperatingDraftInterview enabled draft={activeDraft} onAction={async () => {}} onContinue={onContinue} />);

    fireEvent.click(screen.getByRole('button', { name: 'Finish this later' }));

    expect(onContinue).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Front-desk setup approved')).not.toBeInTheDocument();
  });
});
