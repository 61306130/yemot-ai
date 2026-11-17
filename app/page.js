import { redirect } from 'next/navigation';

// הדף הראשי מעביר ישר לאתר הניהול
export default function Home() {
  redirect('/admin');
}
