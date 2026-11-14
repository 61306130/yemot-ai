export const metadata = { title: 'ניהול בוט AI - ימות המשיח' };

export default function RootLayout({ children }) {
  return (
    <html lang="he" dir="rtl">
      <body style={{ fontFamily: 'Arial, sans-serif', margin: 40 }}>{children}</body>
    </html>
  );
}
