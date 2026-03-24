import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'O2C Graph Intelligence',
  description: 'SAP Order-to-Cash Graph Visualization & AI Query System',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="bg-[#080c14] text-white antialiased overflow-hidden">
        {children}
      </body>
    </html>
  );
}
