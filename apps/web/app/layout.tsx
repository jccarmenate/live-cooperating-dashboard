import type { Metadata, Viewport } from 'next';
import { Archivo_Black, JetBrains_Mono, Space_Grotesk } from 'next/font/google';
import type { ReactNode } from 'react';
import { IosInputZoom } from '@/ui/IosInputZoom';
import './globals.css';

const display = Archivo_Black({
  weight: '400',
  subsets: ['latin'],
  variable: '--font-archivo-black',
});
const sans = Space_Grotesk({ subsets: ['latin'], variable: '--font-space-grotesk' });
const mono = JetBrains_Mono({ subsets: ['latin'], variable: '--font-jetbrains-mono' });

export const metadata: Metadata = {
  title: 'Relay',
  description: 'A live multiplayer whiteboard where cursors, shapes and edits sync instantly.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // Draw under notches; the board pads itself back with the `safe-area` utility.
  viewportFit: 'cover',
  // The on-screen keyboard shrinks the layout, so fixed bars and the sheet stay above it.
  interactiveWidget: 'resizes-content',
  themeColor: '#f4f1ea',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${sans.variable} ${mono.variable}`}>
      <body className="bg-paper font-sans text-ink antialiased">
        <IosInputZoom />
        {children}
      </body>
    </html>
  );
}
