import { render, screen } from '@testing-library/react';
import { SafeText } from './SafeText';

describe('SafeText', () => {
  it('renders links as non-clickable text and escapes HTML', () => {
    const { container } = render(<SafeText text={'visit https://evil.example/x <img src=x onerror=alert(1)>'} />);
    expect(container.querySelector('a')).toBeNull();
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByText('https://evil.example/x')).toBeInTheDocument();
    expect(screen.getByText(/not clickable/)).toBeInTheDocument();
  });
});
