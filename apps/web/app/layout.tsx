import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Succra — Missions continue',
  description: 'Solana-native continuity layer for autonomous economic missions.',
};

export default function RootLayout({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <html lang="en">
      <body className="min-h-screen bg-zinc-950 text-zinc-100 antialiased">{children}</body>
    </html>
  );
}
