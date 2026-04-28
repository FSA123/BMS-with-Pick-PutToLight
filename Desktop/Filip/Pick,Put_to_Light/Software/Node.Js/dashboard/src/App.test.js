import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from './App';

test('renders brand name', () => {
  render(<App />);
  expect(screen.getByText(/PICK·LIGHT/i)).toBeInTheDocument();
});

test('renders system online status', () => {
  render(<App />);
  expect(screen.getByText(/SYSTEM ONLINE/i)).toBeInTheDocument();
});

test('renders edit layout button', () => {
  render(<App />);
  expect(screen.getByText(/Edit Layout/i)).toBeInTheDocument();
});

test('search input accepts text', async () => {
  render(<App />);
  const input = screen.getByPlaceholderText(/Search name or SKU/i);
  await userEvent.type(input, 'bolts');
  expect(input.value).toBe('bolts');
});

test('edit layout button toggles to done editing', async () => {
  render(<App />);
  const btn = screen.getByText(/Edit Layout/i);
  await userEvent.click(btn);
  expect(screen.getByText(/Done Editing/i)).toBeInTheDocument();
});

test('done editing returns to normal mode', async () => {
  render(<App />);
  await userEvent.click(screen.getByText(/Edit Layout/i));
  await userEvent.click(screen.getByText(/Done Editing/i));
  expect(screen.getByText(/Edit Layout/i)).toBeInTheDocument();
});
