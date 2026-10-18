import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { LogoMark } from './Logo';

describe('LogoMark', () => {
  it('uses a unique SVG gradient for every rendered logo', () => {
    const { container } = render(
      <>
        <LogoMark />
        <LogoMark />
      </>,
    );

    const gradients = [...container.querySelectorAll('linearGradient')];
    expect(gradients).toHaveLength(2);
    expect(gradients[0].id).not.toBe(gradients[1].id);
    expect(container.querySelectorAll(`[fill="url(#${gradients[0].id})"]`)).toHaveLength(1);
    expect(container.querySelectorAll(`[fill="url(#${gradients[1].id})"]`)).toHaveLength(1);
  });
});
