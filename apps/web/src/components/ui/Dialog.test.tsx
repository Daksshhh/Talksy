import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { Dialog } from './Dialog';

describe('Dialog', () => {
  it('keeps focus in a controlled input while its parent rerenders', async () => {
    const user = userEvent.setup({ delay: 40 });

    function Harness() {
      const [value, setValue] = useState('');
      return (
        <Dialog open onClose={() => undefined} title="Edit profile">
          <label htmlFor="profile-name">Display name</label>
          <input id="profile-name" value={value} onChange={(event) => setValue(event.target.value)} />
        </Dialog>
      );
    }

    render(<Harness />);
    const input = await screen.findByLabelText('Display name');
    await user.click(input);
    await user.type(input, 'Talksy');

    expect(input).toHaveValue('Talksy');
    expect(input).toHaveFocus();
  });
});
