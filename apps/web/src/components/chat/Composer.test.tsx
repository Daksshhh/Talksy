import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Composer } from './Composer';

describe('Composer', () => {
  it('Enter sends, Shift+Enter adds a newline', async () => {
    const onSend = vi.fn(() => true);
    render(<Composer onSend={onSend} maxChars={20} />);
    const box = screen.getByLabelText('Message');
    await userEvent.type(box, 'hi{Shift>}{Enter}{/Shift}there');
    expect(onSend).not.toHaveBeenCalled();
    await userEvent.type(box, '{Enter}');
    expect(onSend).toHaveBeenCalledWith('hi\nthere');
    expect(box).toHaveValue('');
  });

  it('blocks sending over the character limit and when disabled', async () => {
    const onSend = vi.fn(() => true);
    const { rerender } = render(<Composer onSend={onSend} maxChars={5} />);
    await userEvent.type(screen.getByLabelText('Message'), 'toolong');
    expect(screen.getByRole('button', { name: 'Send message' })).toBeDisabled();
    rerender(<Composer onSend={onSend} maxChars={5} disabled />);
    expect(screen.getByLabelText('Message')).toBeDisabled();
  });

  it('sends typing start/stop signals', async () => {
    const onTyping = vi.fn();
    render(<Composer onSend={() => true} onTyping={onTyping} maxChars={50} />);
    await userEvent.type(screen.getByLabelText('Message'), 'a');
    expect(onTyping).toHaveBeenCalledWith(true);
    await userEvent.type(screen.getByLabelText('Message'), '{Enter}');
    expect(onTyping).toHaveBeenLastCalledWith(false);
  });
});
